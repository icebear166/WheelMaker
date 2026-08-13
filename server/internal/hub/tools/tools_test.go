package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func TestManagerRoutesToolCommands(t *testing.T) {
	manager := NewManager(ManagerConfig{HubID: "hub-a", StateDir: t.TempDir()})

	resp, cmdErr := manager.Handle(context.Background(), "cmd.update", rawToolPayload(t, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle cmd.update error=%v", cmdErr)
	}
	body := resp.(updateCommandResponse)
	if !body.OK || body.HubID != "hub-a" || body.Status != "not_installed" {
		t.Fatalf("cmd.update response=%#v", body)
	}

	_, cmdErr = manager.Handle(context.Background(), "cmd.unknown", rawToolPayload(t, map[string]any{}))
	if cmdErr == nil || cmdErr.Code != rp.CodeInvalidArgument {
		t.Fatalf("unknown command error=%#v, want INVALID_ARGUMENT", cmdErr)
	}
}

func TestManagerWiresNPMOperationCallback(t *testing.T) {
	called := false
	manager := NewManager(ManagerConfig{
		HubID: "hub-a",
		OnNPMOperationDone: func() {
			called = true
		},
	})

	manager.npmCommand.notifyOperationDone(manager.npmCommand.operationDone)

	if !called {
		t.Fatal("npm operation callback was not wired")
	}
}

func TestManagerWiresNPMMetadataCallback(t *testing.T) {
	called := false
	manager := NewManager(ManagerConfig{
		HubID: "hub-a",
		OnNPMMetadataChanged: func() {
			called = true
		},
	})

	manager.npmCommand.notifyMetadataChanged(manager.npmCommand.metadataChanged)

	if !called {
		t.Fatal("npm metadata callback was not wired")
	}
}

func TestManagerRoutesReleaseCommand(t *testing.T) {
	source := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "scripts", "release.mjs"), []byte("// test"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := newBlockingReleaseRunner()
	manager := NewManager(ManagerConfig{
		HubID:          "hub-a",
		StateDir:       t.TempDir(),
		ReleaseCommand: newReleaseCommandWithDependencies(t.TempDir(), runner, nil),
	})
	response, commandErr := manager.Handle(context.Background(), "cmd.release", rawToolPayload(t, map[string]any{
		"action": "start", "hubId": "hub-a", "kind": "version", "sourcePath": source, "baseUrl": "https://release.wheelmaker.top",
	}))
	if commandErr != nil {
		t.Fatalf("Handle() error=%v", commandErr)
	}
	if !response.(releaseCommandResponse).Accepted {
		t.Fatalf("response=%#v", response)
	}
	<-runner.calls
	runner.complete(nil)
}

func TestReleaseCommandStartsVersionPublishAfterRequestReturns(t *testing.T) {
	source := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "scripts", "release.mjs"), []byte("// test"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := newBlockingReleaseRunner()
	command := newReleaseCommandWithDependencies(t.TempDir(), runner, nil)

	response, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action":     "start",
		"hubId":      "publisher-hub",
		"kind":       "version",
		"sourcePath": source,
		"baseUrl":    "https://release.wheelmaker.top",
		"desktop":    true,
		"android":    true,
		"gateway":    true,
	}))
	if commandErr != nil {
		t.Fatalf("Handle() error=%v", commandErr)
	}
	accepted := response.(releaseCommandResponse)
	if !accepted.Accepted || accepted.Status != "running" || accepted.Job == nil {
		t.Fatalf("response=%#v", accepted)
	}
	select {
	case call := <-runner.calls:
		if call.WorkingDir != source {
			t.Fatalf("workingDir=%q, want %q", call.WorkingDir, source)
		}
		if !reflect.DeepEqual(call.Args, []string{"scripts/release.mjs", "--publish", "--with-desktop", "--with-android", "--with-gateway"}) {
			t.Fatalf("args=%#v", call.Args)
		}
	case <-time.After(time.Second):
		t.Fatal("release runner did not start after request returned")
	}
	runner.complete(nil)
	assertReleaseStatus(t, command, accepted.Job.ID, "success")
}

func TestReleaseCommandPublishesPersistedTransitionsButNotLogWrites(t *testing.T) {
	source := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "scripts", "release.mjs"), []byte("// test"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := newBlockingReleaseRunner()
	command := newReleaseCommandWithDependencies(t.TempDir(), runner, nil)
	updates := make(chan ReleasePublishJob, 4)
	command.SetJobUpdatedHandler(func(job ReleasePublishJob) {
		updates <- job
	})

	response, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "start", "hubId": "publisher-hub", "kind": "version", "sourcePath": source, "baseUrl": "https://release.wheelmaker.top",
	}))
	if commandErr != nil {
		t.Fatal(commandErr)
	}
	jobID := response.(releaseCommandResponse).Job.ID
	if got := (<-updates).Status; got != "running" {
		t.Fatalf("first update status=%q, want running", got)
	}
	call := <-runner.calls
	call.Log("build output\n")
	select {
	case update := <-updates:
		t.Fatalf("log write published update=%#v", update)
	case <-time.After(50 * time.Millisecond):
	}
	runner.complete(nil)
	if got := (<-updates).Status; got != "success" {
		t.Fatalf("terminal update status=%q, want success", got)
	}
	assertReleaseStatus(t, command, jobID, "success")
}

func TestReleaseCommandRejectsMissingSourceEntryAndRedactsLogs(t *testing.T) {
	command := newReleaseCommandWithDependencies(t.TempDir(), newBlockingReleaseRunner(), nil)
	_, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "start", "hubId": "publisher-hub", "kind": "version", "sourcePath": t.TempDir(), "baseUrl": "https://release.wheelmaker.top",
	}))
	if commandErr == nil || commandErr.Code != rp.CodeInvalidArgument {
		t.Fatalf("missing source error=%#v", commandErr)
	}

	source := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "scripts", "release.mjs"), []byte("// test"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := newBlockingReleaseRunner()
	command = newReleaseCommandWithDependencies(t.TempDir(), runner, nil)
	response, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "start", "hubId": "publisher-hub", "kind": "version", "sourcePath": source, "baseUrl": "https://release.wheelmaker.top",
	}))
	if commandErr != nil {
		t.Fatal(commandErr)
	}
	call := <-runner.calls
	call.Log("Authorization: Bearer secret-release-token")
	runner.complete(nil)
	status := assertReleaseStatus(t, command, response.(releaseCommandResponse).Job.ID, "success")
	if strings.Contains(status.Job.Log, "secret-release-token") || !strings.Contains(status.Job.Log, "[REDACTED]") {
		t.Fatalf("job log was not redacted: %q", status.Job.Log)
	}
}

func TestReleaseCommandDoesNotPersistSourcePathOrToken(t *testing.T) {
	stateDir := t.TempDir()
	source := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "scripts", "release.mjs"), []byte("// test"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := newBlockingReleaseRunner()
	command := newReleaseCommandWithDependencies(stateDir, runner, nil)
	result, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "start", "hubId": "publisher-hub", "kind": "version", "sourcePath": source, "baseUrl": "https://release.wheelmaker.top",
	}))
	if commandErr != nil {
		t.Fatal(commandErr)
	}
	jobID := result.(releaseCommandResponse).Job.ID
	raw, err := os.ReadFile(filepath.Join(stateDir, releaseJobDirectoryName, jobID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), source) || strings.Contains(strings.ToLower(string(raw)), "token") {
		t.Fatalf("persistent job leaked browser configuration: %s", raw)
	}
	<-runner.calls
	runner.complete(nil)
	assertReleaseStatus(t, command, jobID, "success")
}

func TestReleaseCommandNotifiesTargetOnlyAfterSuccessfulAutoPullPublish(t *testing.T) {
	source := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "scripts", "release.mjs"), []byte("// test"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := newBlockingReleaseRunner()
	notifier := &fakeReleaseNotifier{result: ReleaseTargetStatus{Status: "accepted"}}
	command := newReleaseCommandWithDependencies(t.TempDir(), runner, notifier)
	result, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "start", "hubId": "publisher-hub", "kind": "version", "sourcePath": source, "baseUrl": "https://release.wheelmaker.top",
		"targetHubId": "server-hub", "autoPull": true,
	}))
	if commandErr != nil {
		t.Fatal(commandErr)
	}
	<-runner.calls
	runner.complete(nil)
	status := assertReleaseStatus(t, command, result.(releaseCommandResponse).Job.ID, "success")
	if status.Job.TargetState != "accepted" {
		t.Fatalf("target state=%q", status.Job.TargetState)
	}
	if notifier.targetHubID != "server-hub" || notifier.kind != "version" || notifier.baseURL != "https://release.wheelmaker.top" {
		t.Fatalf("notification=%#v", notifier)
	}
}

func TestReleaseCommandSkipsTargetNotificationWhenAutoPullIsOff(t *testing.T) {
	source := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "scripts", "release.mjs"), []byte("// test"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := newBlockingReleaseRunner()
	notifier := &fakeReleaseNotifier{result: ReleaseTargetStatus{Status: "accepted"}}
	command := newReleaseCommandWithDependencies(t.TempDir(), runner, notifier)
	result, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "start", "hubId": "publisher-hub", "kind": "version", "sourcePath": source, "baseUrl": "https://release.wheelmaker.top",
		"targetHubId": "server-hub", "autoPull": false,
	}))
	if commandErr != nil {
		t.Fatal(commandErr)
	}
	<-runner.calls
	runner.complete(nil)
	assertReleaseStatus(t, command, result.(releaseCommandResponse).Job.ID, "success")
	if notifier.targetHubID != "" {
		t.Fatalf("unexpected notification=%#v", notifier)
	}
}

func TestReleaseCommandBuildsAndTransfersDebugWebArtifact(t *testing.T) {
	source := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "scripts", "release"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "scripts", "release", "debug-web.mjs"), []byte("// test"), 0o600); err != nil {
		t.Fatal(err)
	}
	stateDir := t.TempDir()
	runner := newBlockingReleaseRunner()
	notifier := &fakeReleaseNotifier{result: ReleaseTargetStatus{Status: "success"}}
	command := newReleaseCommandWithDependencies(stateDir, runner, notifier)
	result, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "start", "hubId": "publisher-hub", "kind": "debugWeb", "sourcePath": source, "webHubId": "web-hub",
	}))
	if commandErr != nil {
		t.Fatal(commandErr)
	}
	jobID := result.(releaseCommandResponse).Job.ID
	call := <-runner.calls
	wantArchive := filepath.Join(stateDir, releaseJobDirectoryName, jobID, "debug-web.zip")
	if !reflect.DeepEqual(call.Args, []string{"scripts/release/debug-web.mjs", "--output", wantArchive}) {
		t.Fatalf("args=%#v", call.Args)
	}
	archive := debugWebZip(t, map[string]string{"index.html": "new"})
	if err := os.MkdirAll(filepath.Dir(wantArchive), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(wantArchive, archive, 0o600); err != nil {
		t.Fatal(err)
	}
	runner.complete(nil)
	status := assertReleaseStatus(t, command, jobID, "success")
	if status.Job.TargetState != "success" || notifier.transferTargetHubID != "web-hub" || notifier.transferID != jobID || notifier.transferPath != wantArchive || notifier.transferSize != int64(len(archive)) || notifier.transferSHA256 != debugWebDigest(archive) {
		t.Fatalf("status=%#v notifier=%#v", status, notifier)
	}
	if _, err := os.Stat(wantArchive); err != nil {
		t.Fatalf("debug web artifact was not retained: %v", err)
	}
}

func TestReleaseCommandRetainsDebugWebArtifactWhenTransferFails(t *testing.T) {
	source := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "scripts", "release"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "scripts", "release", "debug-web.mjs"), []byte("// test"), 0o600); err != nil {
		t.Fatal(err)
	}
	stateDir := t.TempDir()
	runner := newBlockingReleaseRunner()
	notifier := &fakeReleaseNotifier{result: ReleaseTargetStatus{Status: "failed", ErrorCode: "target_hub_offline"}}
	command := newReleaseCommandWithDependencies(stateDir, runner, notifier)
	result, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "start", "hubId": "publisher-hub", "kind": "debugWeb", "sourcePath": source, "webHubId": "web-hub",
	}))
	if commandErr != nil {
		t.Fatal(commandErr)
	}
	jobID := result.(releaseCommandResponse).Job.ID
	<-runner.calls
	archivePath := filepath.Join(stateDir, releaseJobDirectoryName, jobID, "debug-web.zip")
	archive := debugWebZip(t, map[string]string{"index.html": "new"})
	if err := os.MkdirAll(filepath.Dir(archivePath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archivePath, archive, 0o600); err != nil {
		t.Fatal(err)
	}
	runner.complete(nil)
	status := assertReleaseStatus(t, command, jobID, "failed")
	if status.Job.ErrorCode != "target_hub_offline" || status.Job.TargetState != "failed" {
		t.Fatalf("status=%#v", status)
	}
	if _, err := os.Stat(archivePath); err != nil {
		t.Fatalf("failed transfer removed artifact: %v", err)
	}
}

func TestReleaseCommandRequiresWebHubForDebugWeb(t *testing.T) {
	source := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "scripts", "release"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "scripts", "release", "debug-web.mjs"), []byte("// test"), 0o600); err != nil {
		t.Fatal(err)
	}
	command := newReleaseCommandWithDependencies(t.TempDir(), newBlockingReleaseRunner(), &fakeReleaseNotifier{})
	_, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{"action": "start", "hubId": "publisher-hub", "kind": "debugWeb", "sourcePath": source}))
	if commandErr == nil || commandErr.Code != rp.CodeInvalidArgument {
		t.Fatalf("commandErr=%#v", commandErr)
	}
}

type fakeReleaseNotifier struct {
	targetHubID         string
	kind                string
	baseURL             string
	result              ReleaseTargetStatus
	err                 error
	transferTargetHubID string
	transferID          string
	transferPath        string
	transferSize        int64
	transferSHA256      string
}

func (n *fakeReleaseNotifier) TransferDebugWeb(_ context.Context, targetHubID, transferID, archivePath string, size int64, sha256 string) (ReleaseTargetStatus, error) {
	n.transferTargetHubID, n.transferID, n.transferPath, n.transferSize, n.transferSHA256 = targetHubID, transferID, archivePath, size, sha256
	return n.result, n.err
}

func (n *fakeReleaseNotifier) NotifyRelease(_ context.Context, targetHubID, kind, baseURL string) (ReleaseTargetStatus, error) {
	n.targetHubID, n.kind, n.baseURL = targetHubID, kind, baseURL
	return n.result, n.err
}

type releaseRunnerCall struct {
	WorkingDir string
	Args       []string
	Log        func(string)
}

type blockingReleaseRunner struct {
	calls chan releaseRunnerCall
	done  chan error
}

func newBlockingReleaseRunner() *blockingReleaseRunner {
	return &blockingReleaseRunner{calls: make(chan releaseRunnerCall, 1), done: make(chan error, 1)}
}

func (r *blockingReleaseRunner) Run(_ context.Context, workingDir string, args []string, log func(string)) error {
	r.calls <- releaseRunnerCall{WorkingDir: workingDir, Args: append([]string(nil), args...), Log: log}
	return <-r.done
}

func (r *blockingReleaseRunner) complete(err error) { r.done <- err }

func assertReleaseStatus(t *testing.T, command *ReleaseCommand, jobID, want string) releaseCommandResponse {
	t.Helper()
	var response releaseCommandResponse
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		result, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{"action": "status", "jobId": jobID, "hubId": "publisher-hub"}))
		if commandErr != nil {
			t.Fatal(commandErr)
		}
		response = result.(releaseCommandResponse)
		if response.Job != nil && response.Job.Status == want {
			return response
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("job %s did not reach %s: %#v", jobID, want, response)
	return releaseCommandResponse{}
}

func rawToolPayload(t *testing.T, payload map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

type fakeNPMRunner struct {
	mu        sync.Mutex
	calls     []npmCommandCall
	results   map[string]npmCommandResult
	blockKeys map[string]chan struct{}
}

func newFakeNPMRunner() *fakeNPMRunner {
	return &fakeNPMRunner{
		results:   map[string]npmCommandResult{},
		blockKeys: map[string]chan struct{}{},
	}
}

func (f *fakeNPMRunner) Run(ctx context.Context, name string, args ...string) npmCommandResult {
	key := npmCallKey(name, args...)
	f.mu.Lock()
	f.calls = append(f.calls, npmCommandCall{Name: name, Args: append([]string(nil), args...)})
	block := f.blockKeys[key]
	result, ok := f.results[key]
	f.mu.Unlock()
	if block != nil {
		select {
		case <-block:
		case <-ctx.Done():
			return npmCommandResult{ExitCode: -1, Err: ctx.Err()}
		}
	}
	if ok {
		return result
	}
	return npmCommandResult{Stdout: "", ExitCode: 0}
}

func (f *fakeNPMRunner) set(name string, args []string, result npmCommandResult) {
	f.mu.Lock()
	f.results[npmCallKey(name, args...)] = result
	f.mu.Unlock()
}

func (f *fakeNPMRunner) block(name string, args []string) chan struct{} {
	ch := make(chan struct{})
	f.mu.Lock()
	f.blockKeys[npmCallKey(name, args...)] = ch
	f.mu.Unlock()
	return ch
}

func (f *fakeNPMRunner) hasCall(name string, args ...string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	want := npmCommandCall{Name: name, Args: args}
	for _, call := range f.calls {
		if reflect.DeepEqual(call, want) {
			return true
		}
	}
	return false
}

func (f *fakeNPMRunner) snapshot() []npmCommandCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]npmCommandCall(nil), f.calls...)
}

func npmCallKey(name string, args ...string) string {
	return name + "\x00" + strings.Join(args, "\x00")
}

// fakeNPMLatestFetcher stands in for the registry HTTP lookup so tests never
// touch the network.
type fakeNPMLatestFetcher struct {
	mu       sync.Mutex
	versions map[string]string
	errs     map[string]error
	calls    []string
	fallback string
	hold     chan struct{}
}

func newFakeNPMLatestFetcher() *fakeNPMLatestFetcher {
	return &fakeNPMLatestFetcher{
		versions: map[string]string{},
		errs:     map[string]error{},
		fallback: "9.9.9",
	}
}

func (f *fakeNPMLatestFetcher) LatestVersion(ctx context.Context, packageName string) (string, error) {
	f.mu.Lock()
	hold := f.hold
	f.mu.Unlock()
	if hold != nil {
		select {
		case <-hold:
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, packageName)
	if err, ok := f.errs[packageName]; ok {
		return "", err
	}
	if version, ok := f.versions[packageName]; ok {
		return version, nil
	}
	return f.fallback, nil
}

func (f *fakeNPMLatestFetcher) setVersion(packageName, version string) {
	f.mu.Lock()
	f.versions[packageName] = version
	f.mu.Unlock()
}

func (f *fakeNPMLatestFetcher) setError(packageName string, err error) {
	f.mu.Lock()
	f.errs[packageName] = err
	f.mu.Unlock()
}

// holdLatest blocks every LatestVersion call until the returned channel is
// closed, letting a test keep a scan_latest operation running while it drives
// other actions.
func (f *fakeNPMLatestFetcher) holdLatest() chan struct{} {
	ch := make(chan struct{})
	f.mu.Lock()
	f.hold = ch
	f.mu.Unlock()
	return ch
}

func (f *fakeNPMLatestFetcher) callCount(packageName string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	count := 0
	for _, call := range f.calls {
		if call == packageName {
			count++
		}
	}
	return count
}

func newNPMTestCommand(runner npmCommandRunner) (*NPMCommand, *fakeNPMLatestFetcher) {
	return newNPMTestCommandWithProbe(runner, func(context.Context) bool { return true })
}

func newNPMTestCommandWithProbe(runner npmCommandRunner, probe func(context.Context) bool) (*NPMCommand, *fakeNPMLatestFetcher) {
	fetcher := newFakeNPMLatestFetcher()
	return newNPMCommandWithDependencies(runner, fetcher, probe), fetcher
}

func newNPMCommandWithRunner(runner npmCommandRunner) *NPMCommand {
	cmd, _ := newNPMTestCommand(runner)
	return cmd
}

func TestNPMCurrentOperationSnapshotReturnsMostRecentlyFinishedOperation(t *testing.T) {
	cmd, _ := newNPMTestCommand(newFakeNPMRunner())
	cmd.operation = &npmOperationSnapshot{
		Action:     "install",
		Status:     "succeeded",
		StartedAt:  "2026-08-04T01:00:00Z",
		FinishedAt: "2026-08-04T01:01:00Z",
	}
	cmd.latestOperation = &npmOperationSnapshot{
		Action:       "scan_latest",
		Status:       "failed",
		StartedAt:    "2026-08-04T02:00:00Z",
		FinishedAt:   "2026-08-04T02:01:00Z",
		ErrorSummary: "registry unavailable",
	}

	got := cmd.currentOperationSnapshot()
	if got == nil || got.Action != "scan_latest" || got.ErrorSummary != "registry unavailable" {
		t.Fatalf("snapshot=%#v, want the newer completed scan_latest operation", got)
	}
}

// seedNPMPrivateRegistryState pre-caches the private registry decision so a
// test can assert scan output without waiting for the async probe.
func seedNPMPrivateRegistryState(cmd *NPMCommand, available bool) {
	cmd.mu.Lock()
	cmd.flicker = npmPrivateRegistryState{known: true, available: available, probedAt: cmd.now()}
	cmd.mu.Unlock()
}

func TestNPMCommandScanReturnsRuntimeAndDeprecatedPackageRows(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@openai/codex":{"version":"0.129.0"},"@zed-industries/claude-agent-acp":{"version":"0.13.0"}}}`,
		ExitCode: 0,
	})

	cmd, fetcher := newNPMTestCommand(runner)
	fetcher.setVersion("@openai/codex", "0.130.0")
	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(npmCommandResponse)
	if !body.OK || body.Hub.HubID != "hub-a" {
		t.Fatalf("response=%#v", body)
	}
	if body.Operation == nil || body.Operation.Action != "scan_latest" || !body.Operation.Running {
		t.Fatalf("operation=%#v, want running scan_latest", body.Operation)
	}
	if runner.hasCall("node", "--version") || runner.hasCall("npm", "--version") || runner.hasCall("npm", "prefix", "-g") {
		t.Fatalf("scan should not call hidden metadata commands: %#v", runner.calls)
	}
	for _, call := range runner.snapshot() {
		if call.Name == "npm" && len(call.Args) > 0 && call.Args[0] == "view" {
			t.Fatalf("latest lookup should not spawn npm view: %#v", call)
		}
	}

	codex := findNPMTestPackage(t, body.Hub.Packages, "@openai/codex")
	if codex.Status != "checking_latest" || codex.InstalledVersion != "0.129.0" || codex.LatestVersion != "" {
		t.Fatalf("codex package before latest=%#v", codex)
	}
	if !reflect.DeepEqual(codex.AgentTypes, []string{"codex"}) {
		t.Fatalf("@openai/codex agentTypes=%v, want [codex]", codex.AgentTypes)
	}
	if codex.CanInstall || codex.CanUpdate {
		t.Fatalf("codex install/update flags should be disabled while latest is checking: %#v", codex)
	}
	if !codex.CanUninstall {
		t.Fatalf("installed runtime codex should be uninstallable: %#v", codex)
	}

	waitForNPMTestOperation(t, cmd)
	resp, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle second scan error: %#v", cmdErr)
	}
	codex = findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@openai/codex")
	if codex.Status != "update_available" || codex.InstalledVersion != "0.129.0" || codex.LatestVersion != "0.130.0" {
		t.Fatalf("codex package=%#v", codex)
	}
	if !codex.CanUpdate || !codex.CanUninstall {
		t.Fatalf("codex action flags=%#v, want CanUpdate and CanUninstall", codex)
	}

	deprecated := findNPMTestPackage(t, body.Hub.Packages, "@zed-industries/claude-agent-acp")
	if deprecated.Kind != "deprecated" || deprecated.Status != "deprecated" || !deprecated.CanUninstall {
		t.Fatalf("deprecated package=%#v", deprecated)
	}
}

func TestNPMCommandScanIncludesMyFlickerFromPrivateRegistry(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@myflicker/cli":{"version":"1.0.0"},"@openai/codex":{"version":"0.129.0"}}}`,
		ExitCode: 0,
	})

	cmd, fetcher := newNPMTestCommand(runner)
	fetcher.setVersion("@openai/codex", "0.130.0")
	fetcher.setVersion(myFlickerPackageName, "1.1.0")
	seedNPMPrivateRegistryState(cmd, true)
	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(npmCommandResponse)
	myFlicker := findNPMTestPackage(t, body.Hub.Packages, "@myflicker/cli")
	if myFlicker.Status != "checking_latest" || myFlicker.InstalledVersion != "1.0.0" {
		t.Fatalf("myflicker package before latest=%#v", myFlicker)
	}
	if !reflect.DeepEqual(myFlicker.AgentTypes, []string{"flicker"}) || !myFlicker.CanUninstall {
		t.Fatalf("myflicker package metadata=%#v", myFlicker)
	}

	waitForNPMTestOperation(t, cmd)
	resp, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle second scan error: %#v", cmdErr)
	}
	myFlicker = findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@myflicker/cli")
	if myFlicker.Status != "update_available" || myFlicker.LatestVersion != "1.1.0" || !myFlicker.CanUpdate {
		t.Fatalf("myflicker package=%#v", myFlicker)
	}
	if fetcher.callCount(myFlickerPackageName) == 0 {
		t.Fatal("scan should query MyFlicker latest version")
	}
	if npmRegistryForPackage(myFlickerPackageName) != myFlickerRegistry {
		t.Fatalf("MyFlicker latest lookup registry=%q, want %q", npmRegistryForPackage(myFlickerPackageName), myFlickerRegistry)
	}
}

func TestNPMCommandScanIncludesKimiCodePackage(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@moonshot-ai/kimi-code":{"version":"0.30.0"}}}`,
		ExitCode: 0,
	})

	cmd, fetcher := newNPMTestCommand(runner)
	fetcher.setVersion("@moonshot-ai/kimi-code", "0.31.1")
	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	kimi := findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@moonshot-ai/kimi-code")
	if kimi.Kind != "runtime" || kimi.DisplayName != "Kimi Code CLI" {
		t.Fatalf("kimi package metadata=%#v", kimi)
	}
	if !reflect.DeepEqual(kimi.AgentTypes, []string{"kimi"}) {
		t.Fatalf("kimi agentTypes=%v, want [kimi]", kimi.AgentTypes)
	}
	if kimi.InstalledVersion != "0.30.0" || !kimi.Installed || !kimi.CanUninstall {
		t.Fatalf("kimi package=%#v", kimi)
	}

	waitForNPMTestOperation(t, cmd)
	resp, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle second scan error: %#v", cmdErr)
	}
	kimi = findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@moonshot-ai/kimi-code")
	if kimi.Status != "update_available" || kimi.LatestVersion != "0.31.1" || !kimi.CanUpdate {
		t.Fatalf("kimi package after latest=%#v", kimi)
	}

	_, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@moonshot-ai/kimi-code",
		"version":     "latest",
	}))
	if cmdErr != nil {
		t.Fatalf("kimi install error: %#v", cmdErr)
	}
	waitForNPMTestOperation(t, cmd)
	if !runner.hasCall("npm", "install", "-g", "@moonshot-ai/kimi-code@latest") {
		t.Fatalf("kimi install call not found: %#v", runner.calls)
	}
	if runner.hasCall("npm", "install", "-g", "@moonshot-ai/kimi-code@latest", "--registry="+myFlickerRegistry) {
		t.Fatalf("kimi install was routed through MyFlicker registry: %#v", runner.calls)
	}
}

func TestNPMCommandScanIncludesQoderPackage(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@qodercn-ai/qoderclicn":{"version":"0.1.0"}}}`,
		ExitCode: 0,
	})

	cmd, fetcher := newNPMTestCommand(runner)
	fetcher.setVersion("@qodercn-ai/qoderclicn", "0.2.0")
	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	qoder := findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@qodercn-ai/qoderclicn")
	if qoder.Kind != "runtime" || qoder.DisplayName != "Qoder CLI (CN)" {
		t.Fatalf("qoder package metadata=%#v", qoder)
	}
	if !reflect.DeepEqual(qoder.AgentTypes, []string{"qoder"}) {
		t.Fatalf("qoder agentTypes=%v, want [qoder]", qoder.AgentTypes)
	}
	if qoder.InstalledVersion != "0.1.0" || !qoder.Installed || !qoder.CanUninstall {
		t.Fatalf("qoder package=%#v", qoder)
	}

	waitForNPMTestOperation(t, cmd)
	resp, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle second scan error: %#v", cmdErr)
	}
	qoder = findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@qodercn-ai/qoderclicn")
	if qoder.Status != "update_available" || qoder.LatestVersion != "0.2.0" || !qoder.CanUpdate {
		t.Fatalf("qoder package after latest=%#v", qoder)
	}

	_, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@qodercn-ai/qoderclicn",
		"version":     "latest",
	}))
	if cmdErr != nil {
		t.Fatalf("qoder install error: %#v", cmdErr)
	}
	waitForNPMTestOperation(t, cmd)
	if !runner.hasCall("npm", "install", "-g", "@qodercn-ai/qoderclicn@latest") {
		t.Fatalf("qoder install call not found: %#v", runner.calls)
	}
	if runner.hasCall("npm", "install", "-g", "@qodercn-ai/qoderclicn@latest", "--registry="+myFlickerRegistry) {
		t.Fatalf("qoder install was routed through MyFlicker registry: %#v", runner.calls)
	}
}

func TestNPMCommandScanDeprecatedCodexACPUsesEmptyAgentTypes(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@zed-industries/codex-acp":{"version":"0.1.0"}}}`,
		ExitCode: 0,
	})

	cmd := newNPMCommandWithRunner(runner)
	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	deprecatedCodex := findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@zed-industries/codex-acp")
	if deprecatedCodex.AgentTypes == nil {
		t.Fatalf("deprecated codex-acp agentTypes is nil; UI requires an empty array")
	}
	if len(deprecatedCodex.AgentTypes) != 0 {
		t.Fatalf("deprecated codex-acp agentTypes=%v, want empty", deprecatedCodex.AgentTypes)
	}
}

func TestNPMCommandScanListFailureReturnsHubError(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stderr:   "npm list exploded\n",
		ExitCode: 1,
		Err:      errors.New("exit status 1"),
	})
	cmd := newNPMCommandWithRunner(runner)

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(npmCommandResponse)
	if body.OK || body.Hub.Error == "" || len(body.Hub.Packages) != 0 {
		t.Fatalf("body=%#v, want hub-level scan error with empty packages", body)
	}
}

func TestNPMCommandScanMarksMissingPackageLatestFailureAsCheckingFailed(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{}}`,
		ExitCode: 0,
	})
	cmd, fetcher := newNPMTestCommand(runner)
	fetcher.setError("@openai/codex", errors.New("registry unavailable"))

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	pkg := findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@openai/codex")
	if pkg.Status != "checking_latest" || pkg.CanInstall || pkg.CanUpdate || pkg.Error != "" {
		t.Fatalf("pkg=%#v, want checking_latest package without actions while latest query runs", pkg)
	}
	waitForNPMTestOperation(t, cmd)
	resp, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle second scan error: %#v", cmdErr)
	}
	pkg = findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@openai/codex")
	if pkg.Status != "latest_unknown" || pkg.CanInstall || pkg.CanUpdate || pkg.Error == "" {
		t.Fatalf("pkg=%#v, want latest_unknown package without actions after latest failure", pkg)
	}
}

func TestNPMPackageLatestURLTargetsSingleManifestEndpoint(t *testing.T) {
	tests := []struct {
		packageName string
		wantURL     string
	}{
		{packageName: "@openai/codex", wantURL: defaultNPMRegistry + "/@openai%2fcodex/latest"},
		{packageName: "opencode-ai", wantURL: defaultNPMRegistry + "/opencode-ai/latest"},
		{packageName: myFlickerPackageName, wantURL: myFlickerRegistry + "/@myflicker%2fcli/latest"},
	}
	for _, tt := range tests {
		got := npmPackageLatestURL(npmRegistryForPackage(tt.packageName), tt.packageName)
		if got != tt.wantURL {
			t.Fatalf("npmPackageLatestURL(%s)=%q, want %q", tt.packageName, got, tt.wantURL)
		}
	}
}

func TestNPMCommandScanServesStaleLatestWhileRefreshing(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@openai/codex":{"version":"0.129.0"}}}`,
		ExitCode: 0,
	})
	cmd, fetcher := newNPMTestCommand(runner)
	fetcher.setVersion("@openai/codex", "0.131.0")
	base := time.Date(2026, 7, 31, 10, 0, 0, 0, time.UTC)
	cmd.now = func() time.Time { return base }
	cmd.mu.Lock()
	cmd.latestCache["@openai/codex"] = npmLatestCacheEntry{
		result:    npmLatestResult{version: "0.130.0"},
		fetchedAt: base.Add(-npmLatestSuccessTTL - time.Minute),
	}
	cmd.mu.Unlock()

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(npmCommandResponse)
	pkg := findNPMTestPackage(t, body.Hub.Packages, "@openai/codex")
	if pkg.LatestVersion != "0.130.0" || pkg.Status != "update_available" {
		t.Fatalf("pkg=%#v, want the stale latest version served while refreshing", pkg)
	}
	if body.Operation == nil || !body.Operation.Running || body.Operation.Action != "scan_latest" {
		t.Fatalf("operation=%#v, want a running background refresh", body.Operation)
	}

	waitForNPMTestOperation(t, cmd)
	resp, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle second scan error: %#v", cmdErr)
	}
	pkg = findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@openai/codex")
	if pkg.LatestVersion != "0.131.0" {
		t.Fatalf("pkg=%#v, want the refreshed latest version", pkg)
	}
}

func TestNPMCommandReusesInMemoryLatestCacheWithinTTL(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@openai/codex":{"version":"0.129.0"}}}`,
		ExitCode: 0,
	})
	cmd, fetcher := newNPMTestCommand(runner)
	fetcher.setVersion("@openai/codex", "0.130.0")
	seedNPMPrivateRegistryState(cmd, false)

	if _, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	})); cmdErr != nil {
		t.Fatalf("first scan error: %#v", cmdErr)
	}
	waitForNPMTestOperation(t, cmd)

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("second scan error: %#v", cmdErr)
	}
	pkg := findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@openai/codex")
	if pkg.LatestVersion != "0.130.0" || pkg.Status != "update_available" {
		t.Fatalf("pkg=%#v, want the cached latest version", pkg)
	}
	if count := fetcher.callCount("@openai/codex"); count != 1 {
		t.Fatalf("latest lookups=%d, want 1 within the cache TTL", count)
	}
}

func TestNPMCommandInstallInvalidatesCachedLatestVersion(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@openai/codex":{"version":"0.129.0"}}}`,
		ExitCode: 0,
	})
	cmd, fetcher := newNPMTestCommand(runner)
	fetcher.setVersion("@openai/codex", "0.130.0")
	seedNPMPrivateRegistryState(cmd, false)

	if _, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	})); cmdErr != nil {
		t.Fatalf("first scan error: %#v", cmdErr)
	}
	waitForNPMTestOperation(t, cmd)

	// npm resolves a newer latest than the cached one, which is what makes the
	// stale cache report a phantom update after the install.
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@openai/codex":{"version":"0.131.0"}}}`,
		ExitCode: 0,
	})
	fetcher.setVersion("@openai/codex", "0.131.0")
	if _, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
		"version":     "latest",
	})); cmdErr != nil {
		t.Fatalf("install error: %#v", cmdErr)
	}
	waitForNPMTestOperationWithoutScan(t, cmd)

	cmd.mu.Lock()
	_, cached := cmd.latestCache["@openai/codex"]
	cmd.mu.Unlock()
	if cached {
		t.Fatal("install should drop the cached latest version for the installed package")
	}

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("scan after install error: %#v", cmdErr)
	}
	pkg := findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@openai/codex")
	if pkg.Status != "checking_latest" || pkg.CanUpdate {
		t.Fatalf("pkg=%#v, want checking_latest without an update action right after install", pkg)
	}

	waitForNPMTestOperation(t, cmd)
	resp, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("scan after latest refresh error: %#v", cmdErr)
	}
	pkg = findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@openai/codex")
	if pkg.Status != "up_to_date" || pkg.LatestVersion != "0.131.0" || pkg.CanUpdate {
		t.Fatalf("pkg=%#v, want up_to_date at the freshly installed version", pkg)
	}
}

func TestNPMCommandBulkInstallInvalidatesOnlyInstalledPackages(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@openai/codex":{"version":"0.129.0"},"@anthropic-ai/claude-code":{"version":"2.0.0"}}}`,
		ExitCode: 0,
	})
	runner.set("npm", []string{"install", "-g", "@anthropic-ai/claude-code@latest"}, npmCommandResult{
		Stderr:   "install exploded\n",
		ExitCode: 1,
		Err:      errors.New("exit status 1"),
	})
	cmd, _ := newNPMTestCommand(runner)
	seedNPMPrivateRegistryState(cmd, false)

	if _, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	})); cmdErr != nil {
		t.Fatalf("first scan error: %#v", cmdErr)
	}
	waitForNPMTestOperation(t, cmd)

	if _, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":       "install_many",
		"hubId":        "hub-a",
		"packageNames": []string{"@openai/codex", "@anthropic-ai/claude-code"},
		"version":      "latest",
	})); cmdErr != nil {
		t.Fatalf("bulk install error: %#v", cmdErr)
	}
	operation := waitForNPMTestOperationWithoutScan(t, cmd)
	if operation.Status != "failed" {
		t.Fatalf("operation=%#v, want failed because one install failed", operation)
	}

	cmd.mu.Lock()
	_, installedCached := cmd.latestCache["@openai/codex"]
	_, failedCached := cmd.latestCache["@anthropic-ai/claude-code"]
	cmd.mu.Unlock()
	if installedCached {
		t.Fatal("successfully installed package should drop its cached latest version")
	}
	if !failedCached {
		t.Fatal("failed install should keep its cached latest version")
	}
}

func TestNPMCommandAcceptsRuntimeInstallAndDeprecatedUninstall(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunner(runner)

	installResp, installErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
		"version":     "latest",
	}))
	if installErr != nil {
		t.Fatalf("install error: %#v", installErr)
	}
	installBody := installResp.(npmCommandResponse)
	if installBody.Operation == nil || installBody.Operation.Action != "install" || installBody.Operation.PackageName != "@openai/codex" {
		t.Fatalf("install operation=%#v", installBody.Operation)
	}
	waitForNPMTestOperation(t, cmd)
	if !runner.hasCall("npm", "install", "-g", "@openai/codex@latest") {
		t.Fatalf("install call not found: %#v", runner.calls)
	}

	uninstallResp, uninstallErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "uninstall",
		"hubId":       "hub-a",
		"packageName": "@zed-industries/claude-agent-acp",
	}))
	if uninstallErr != nil {
		t.Fatalf("uninstall error: %#v", uninstallErr)
	}
	uninstallBody := uninstallResp.(npmCommandResponse)
	if uninstallBody.Operation == nil || uninstallBody.Operation.Action != "uninstall" || uninstallBody.Operation.PackageName != "@zed-industries/claude-agent-acp" {
		t.Fatalf("uninstall operation=%#v", uninstallBody.Operation)
	}
	waitForNPMTestOperation(t, cmd)
	if !runner.hasCall("npm", "uninstall", "-g", "@zed-industries/claude-agent-acp") {
		t.Fatalf("uninstall call not found: %#v", runner.calls)
	}
}

func TestNPMCommandNotifiesAfterSuccessfulRuntimeOperation(t *testing.T) {
	cmd := newNPMCommandWithRunner(newFakeNPMRunner())
	done := make(chan struct{}, 1)
	cmd.setOperationDoneHandler(func() {
		done <- struct{}{}
	})

	_, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
		"version":     "latest",
	}))
	if cmdErr != nil {
		t.Fatalf("install error: %#v", cmdErr)
	}
	waitForNPMTestOperation(t, cmd)

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("successful npm operation did not notify runtime reload")
	}
}

func TestNPMCommandAcceptsBulkRuntimeInstallAsSingleOperation(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunner(runner)

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":       "install_many",
		"hubId":        "hub-a",
		"packageNames": []string{"@openai/codex", "@anthropic-ai/claude-code"},
		"version":      "latest",
	}))
	if cmdErr != nil {
		t.Fatalf("bulk install error: %#v", cmdErr)
	}
	body := resp.(npmCommandResponse)
	if !body.Accepted || body.Operation == nil || body.Operation.Action != "install_many" {
		t.Fatalf("response=%#v, want accepted install_many operation", body)
	}
	if !reflect.DeepEqual(body.Operation.PackageNames, []string{"@openai/codex", "@anthropic-ai/claude-code"}) {
		t.Fatalf("package names=%#v", body.Operation.PackageNames)
	}

	operation := waitForNPMTestOperation(t, cmd)
	if operation.Status != "succeeded" || !strings.Contains(operation.Message, "Installed 2 npm packages") {
		t.Fatalf("operation=%#v, want succeeded bulk install", operation)
	}
	if !runner.hasCall("npm", "install", "-g", "@openai/codex@latest") {
		t.Fatalf("codex install call not found: %#v", runner.calls)
	}
	if !runner.hasCall("npm", "install", "-g", "@anthropic-ai/claude-code@latest") {
		t.Fatalf("claude install call not found: %#v", runner.calls)
	}
}

func TestNPMCommandReinstallUninstallsThenInstallsLatest(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunner(runner)

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "reinstall",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
	}))
	if cmdErr != nil {
		t.Fatalf("reinstall error: %#v", cmdErr)
	}
	body := resp.(npmCommandResponse)
	if !body.Accepted || body.Operation == nil || body.Operation.Action != "reinstall" || body.Operation.PackageName != "@openai/codex" {
		t.Fatalf("reinstall response=%#v", body)
	}

	operation := waitForNPMTestOperation(t, cmd)
	if operation.Status != "succeeded" {
		t.Fatalf("operation=%#v, want succeeded reinstall", operation)
	}
	if !runner.hasCall("npm", "uninstall", "-g", "@openai/codex") {
		t.Fatalf("reinstall uninstall call not found: %#v", runner.calls)
	}
	if !runner.hasCall("npm", "install", "-g", "@openai/codex@latest") {
		t.Fatalf("reinstall install call not found: %#v", runner.calls)
	}
}

func TestNPMCommandUninstallAcceptsRuntimePackages(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunner(runner)

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "uninstall",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
	}))
	if cmdErr != nil {
		t.Fatalf("runtime uninstall error: %#v", cmdErr)
	}
	body := resp.(npmCommandResponse)
	if body.Operation == nil || body.Operation.Action != "uninstall" {
		t.Fatalf("runtime uninstall response=%#v", body)
	}
	operation := waitForNPMTestOperation(t, cmd)
	if operation.Message != "Uninstalled @openai/codex. Agent availability is refreshing." {
		t.Fatalf("uninstall message = %q", operation.Message)
	}
	if !runner.hasCall("npm", "uninstall", "-g", "@openai/codex") {
		t.Fatalf("runtime uninstall call not found: %#v", runner.calls)
	}
}

func TestNPMCommandRejectsUnsupportedPackagePolicy(t *testing.T) {
	cmd := newNPMCommandWithRunner(newFakeNPMRunner())
	cases := []struct {
		name    string
		payload map[string]any
		code    string
	}{
		{
			name: "unsupported install package",
			payload: map[string]any{
				"action":      "install",
				"hubId":       "hub-a",
				"packageName": "left-pad",
			},
			code: rp.CodeForbidden,
		},
		{
			name: "deprecated install package",
			payload: map[string]any{
				"action":      "install",
				"hubId":       "hub-a",
				"packageName": "@zed-industries/claude-agent-acp",
			},
			code: rp.CodeForbidden,
		},
		{
			name: "unsupported version",
			payload: map[string]any{
				"action":      "install",
				"hubId":       "hub-a",
				"packageName": "@openai/codex",
				"version":     "0.130.0",
			},
			code: rp.CodeInvalidArgument,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, tc.payload))
			if cmdErr == nil || cmdErr.Code != tc.code {
				t.Fatalf("cmdErr=%#v, want code %s", cmdErr, tc.code)
			}
		})
	}
}

func TestNPMCommandRejectsConcurrentOperationsAndQueryIsUnsupported(t *testing.T) {
	runner := newFakeNPMRunner()
	block := runner.block("npm", []string{"install", "-g", "@openai/codex@latest"})
	cmd := newNPMCommandWithRunner(runner)

	_, queryErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	}))
	if queryErr == nil || queryErr.Code != rp.CodeInvalidArgument {
		t.Fatalf("queryErr=%#v, want INVALID_ARGUMENT", queryErr)
	}

	_, installErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
	}))
	if installErr != nil {
		t.Fatalf("first install error: %#v", installErr)
	}
	_, conflictErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@agentclientprotocol/claude-agent-acp",
	}))
	if conflictErr == nil || conflictErr.Code != rp.CodeConflict {
		t.Fatalf("conflictErr=%#v, want CONFLICT", conflictErr)
	}
	close(block)
	waitForNPMTestOperation(t, cmd)
}

func TestNPMCommandScanLatestDoesNotBlockInstall(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{}`,
		ExitCode: 0,
	})
	fetcher := newFakeNPMLatestFetcher()
	fetcher.setVersion("@openai/codex", "0.130.0")
	releaseLatest := fetcher.holdLatest()
	cmd := newNPMCommandWithDependencies(runner, fetcher, func(context.Context) bool { return true })

	if _, err := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	})); err != nil {
		t.Fatalf("scan error: %#v", err)
	}

	// scan_latest is still running (the fetcher is held). Installing a package
	// is a write operation and must not be rejected as a conflicting op.
	installBlock := runner.block("npm", []string{"install", "-g", "@openai/codex@latest"})
	_, installErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
	}))
	if installErr != nil {
		t.Fatalf("install must not be blocked by scan_latest: %#v", installErr)
	}

	close(installBlock)
	close(releaseLatest)
	waitForNPMTestOperation(t, cmd)
}

func TestNPMCommandFailedTaskSummarizesLastStderrSegment(t *testing.T) {
	longTail := strings.Repeat("x", 650)
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"install", "-g", "@openai/codex@latest"}, npmCommandResult{
		Stderr:   "first failure\n\n" + longTail,
		ExitCode: 7,
		Err:      errors.New("exit status 7"),
	})
	cmd := newNPMCommandWithRunner(runner)

	_, installErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
	}))
	if installErr != nil {
		t.Fatalf("install error: %#v", installErr)
	}
	operation := waitForNPMTestOperation(t, cmd)
	if operation.Status != "failed" || operation.ExitCode == nil || *operation.ExitCode != 7 {
		t.Fatalf("operation=%#v, want failed exit 7", operation)
	}
	if !strings.Contains(operation.ErrorSummary, "exit code 7") {
		t.Fatalf("summary=%q, want exit code", operation.ErrorSummary)
	}
	if strings.Contains(operation.ErrorSummary, "first failure") {
		t.Fatalf("summary=%q should use last non-empty stderr segment", operation.ErrorSummary)
	}
	if len(operation.ErrorSummary) > len("exit code 7: ")+500 {
		t.Fatalf("summary length=%d, want truncated to 500 char segment", len(operation.ErrorSummary))
	}
}

func TestNPMCommandFailedTaskIncludesExecErrorWhenOutputEmpty(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"install", "-g", "@openai/codex@latest"}, npmCommandResult{
		ExitCode: -1,
		Err:      errors.New(`exec: "npm": executable file not found in $PATH`),
	})
	cmd := newNPMCommandWithRunner(runner)

	_, installErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
	}))
	if installErr != nil {
		t.Fatalf("install error: %#v", installErr)
	}
	operation := waitForNPMTestOperation(t, cmd)
	if operation.Status != "failed" || operation.ExitCode == nil || *operation.ExitCode != -1 {
		t.Fatalf("operation=%#v, want failed exit -1", operation)
	}
	if !strings.Contains(operation.ErrorSummary, `exec: "npm"`) {
		t.Fatalf("summary=%q, want exec error", operation.ErrorSummary)
	}
}

func rawNPMCommandPayload(t *testing.T, payload map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return raw
}

func findNPMTestPackage(t *testing.T, packages []npmPackageStatus, name string) npmPackageStatus {
	t.Helper()
	for _, pkg := range packages {
		if pkg.PackageName == name {
			return pkg
		}
	}
	t.Fatalf("package %s not found in %#v", name, packages)
	return npmPackageStatus{}
}

func hasNPMTestPackage(packages []npmPackageStatus, name string) bool {
	for _, pkg := range packages {
		if pkg.PackageName == name {
			return true
		}
	}
	return false
}

func waitForNPMTestOperation(t *testing.T, cmd *NPMCommand) *npmOperationSnapshot {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
			"action": "scan",
			"hubId":  "hub-a",
		}))
		if cmdErr != nil {
			t.Fatalf("scan operation: %#v", cmdErr)
		}
		operation := resp.(npmCommandResponse).Operation
		if operation != nil && !operation.Running {
			return operation
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("operation did not finish")
	return nil
}

// waitForNPMTestOperationWithoutScan waits on the operation snapshot directly, so
// the wait itself does not trigger scans that would start a follow-up refresh.
func waitForNPMTestOperationWithoutScan(t *testing.T, cmd *NPMCommand) *npmOperationSnapshot {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		operation := cmd.currentOperationSnapshot()
		if operation != nil && !operation.Running {
			return operation
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("operation did not finish")
	return nil
}

type fakeSkillsRunner struct {
	mu      sync.Mutex
	calls   []skillsCommandCall
	results map[string]skillsCommandResult
	blocks  map[string]chan struct{}
}

func newFakeSkillsRunner() *fakeSkillsRunner {
	return &fakeSkillsRunner{results: map[string]skillsCommandResult{}, blocks: map[string]chan struct{}{}}
}

func (f *fakeSkillsRunner) Run(_ context.Context, dir string, name string, args ...string) skillsCommandResult {
	key := skillsCallKey(dir, name, args...)
	f.mu.Lock()
	call := skillsCommandCall{Dir: dir, Name: name, Args: append([]string(nil), args...)}
	f.calls = append(f.calls, call)
	result, ok := f.results[key]
	block := f.blocks[key]
	f.mu.Unlock()
	if block != nil {
		<-block
	}
	if ok {
		return result
	}
	if name == "node" && reflect.DeepEqual(args, []string{"--version"}) {
		return skillsCommandResult{ExitCode: 0, Stdout: "v22.20.0\n"}
	}
	if name == "skills" && reflect.DeepEqual(args, []string{"--version"}) {
		return skillsCommandResult{ExitCode: 0, Stdout: "1.5.18\n"}
	}
	return skillsCommandResult{ExitCode: 0, Stdout: "[]"}
}

func (f *fakeSkillsRunner) set(dir string, name string, args []string, result skillsCommandResult) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.results[skillsCallKey(dir, name, args...)] = result
}

func (f *fakeSkillsRunner) block(dir string, name string, args ...string) chan struct{} {
	f.mu.Lock()
	defer f.mu.Unlock()
	ch := make(chan struct{})
	f.blocks[skillsCallKey(dir, name, args...)] = ch
	return ch
}

func (f *fakeSkillsRunner) hasCall(dir string, name string, args ...string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	want := skillsCommandCall{Dir: dir, Name: name, Args: append([]string(nil), args...)}
	for _, call := range f.calls {
		if reflect.DeepEqual(call, want) {
			return true
		}
	}
	return false
}

func skillsCallKey(dir string, name string, args ...string) string {
	return dir + "\x00" + name + "\x00" + strings.Join(args, "\x00")
}

func waitForSkillsCall(t *testing.T, runner *fakeSkillsRunner, dir string, name string, args ...string) {
	t.Helper()
	for i := 0; i < 100; i++ {
		if runner.hasCall(dir, name, args...) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("call not found: dir=%q name=%q args=%#v calls=%#v", dir, name, args, runner.calls)
}

func waitForSkillsOperationDone(t *testing.T, cmd *SkillsCommand) *skillsOperationSnapshot {
	t.Helper()
	var operation *skillsOperationSnapshot
	for i := 0; i < 100; i++ {
		operation = cmd.currentOperationSnapshot()
		if operation != nil && !operation.Running {
			return operation
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("operation still running: %#v", operation)
	return operation
}

func countSkillsCalls(runner *fakeSkillsRunner, dir string, name string, args ...string) int {
	runner.mu.Lock()
	defer runner.mu.Unlock()
	want := skillsCommandCall{Dir: dir, Name: name, Args: append([]string(nil), args...)}
	count := 0
	for _, call := range runner.calls {
		if reflect.DeepEqual(call, want) {
			count++
		}
	}
	return count
}

func assertDirExists(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	if !info.IsDir() {
		t.Fatalf("%s is not a directory", path)
	}
}

func TestSkillsCommandInstallsMissingSkillsCLIBeforeRunningCommand(t *testing.T) {
	runner := newFakeSkillsRunner()
	lookPath := func(name string) (string, error) {
		if name == "skills" && runner.hasCall("", "npm", "install", "-g", "skills@1.5.18") {
			return "C:/npm/skills.cmd", nil
		}
		return "", errors.New("not found")
	}
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:    "hub-a",
		LookPath: lookPath,
	})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK {
		t.Fatalf("response=%#v, want successful scan", body)
	}
	if !runner.hasCall("", "node", "--version") {
		t.Fatalf("Node.js compatibility was not checked: %#v", runner.calls)
	}
	if !runner.hasCall("", "npm", "install", "-g", "skills@1.5.18") {
		t.Fatalf("pinned skills CLI was not installed: %#v", runner.calls)
	}
	if !runner.hasCall("", "skills", "--version") {
		t.Fatalf("installed skills CLI version was not verified: %#v", runner.calls)
	}
	if !runner.hasCall("", "skills", "list", "-g", "--json") {
		t.Fatalf("skills list was not called after install: %#v", runner.calls)
	}
	if runner.hasCall("", "npx", "--yes", "skills@1.5.18", "list", "-g", "--json") {
		t.Fatalf("npx fallback should not run after install succeeds: %#v", runner.calls)
	}
}

func TestSkillsCommandFallsBackToNpxWhenAutoInstallFailsOnce(t *testing.T) {
	baseDir := t.TempDir()
	projectRoot := filepath.Join(baseDir, "project")
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	runner := newFakeSkillsRunner()
	runner.set("", "npm", []string{"install", "-g", "skills@1.5.18"}, skillsCommandResult{
		ExitCode: 1,
		Stderr:   "npm install failed",
		Err:      errors.New("exit status 1"),
	})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:    "hub-a",
		LookPath: func(string) (string, error) { return "", errors.New("not found") },
		Projects: []ProjectInfo{{
			Name:   "WheelMaker",
			Path:   projectRoot,
			Online: true,
		}},
	})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK {
		t.Fatalf("response=%#v, want npx fallback scan to succeed", body)
	}
	if got := countSkillsCalls(runner, "", "npm", "install", "-g", "skills@1.5.18"); got != 1 {
		t.Fatalf("npm install calls=%d, want 1", got)
	}
	if !runner.hasCall("", "npx", "--yes", "skills@1.5.18", "list", "-g", "--json") {
		t.Fatalf("global npx fallback not called: %#v", runner.calls)
	}
	if !runner.hasCall(projectRoot, "npx", "--yes", "skills@1.5.18", "list", "--json") {
		t.Fatalf("project npx fallback not called: %#v", runner.calls)
	}
}

func TestSkillsCommandRejectsOldNodeBeforeRunningCLI(t *testing.T) {
	runner := newFakeSkillsRunner()
	runner.set("", "node", []string{"--version"}, skillsCommandResult{ExitCode: 0, Stdout: "v12.22.12\n"})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if body.OK || !strings.Contains(body.ErrorSummary, "Node.js 22+") {
		t.Fatalf("response=%#v, want actionable old Node error", body)
	}
	if runner.hasCall("", "skills", "list", "-g", "--json") || runner.hasCall("", "npx", "--yes", "skills@1.5.18", "list", "-g", "--json") {
		t.Fatalf("skills CLI should not run with old Node: %#v", runner.calls)
	}
}

func TestSkillsCommandRechecksNodeAfterFailedCompatibilityCheck(t *testing.T) {
	runner := newFakeSkillsRunner()
	runner.set("", "node", []string{"--version"}, skillsCommandResult{ExitCode: 0, Stdout: "v12.22.9\n"})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	if got := cmd.ensureSkillsNode(context.Background()); !strings.Contains(got, "found v12.22.9") {
		t.Fatalf("first ensureSkillsNode()=%q, want old Node error", got)
	}

	runner.set("", "node", []string{"--version"}, skillsCommandResult{ExitCode: 0, Stdout: "v22.20.0\n"})
	if got := cmd.ensureSkillsNode(context.Background()); got != "" {
		t.Fatalf("second ensureSkillsNode()=%q, want recovered compatibility check", got)
	}
	if got := countSkillsCalls(runner, "", "node", "--version"); got != 2 {
		t.Fatalf("node version calls=%d, want 2", got)
	}
}

func TestSkillsCommandReplacesMismatchedGlobalCLIWithPinnedFallback(t *testing.T) {
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"--version"}, skillsCommandResult{ExitCode: 0, Stdout: "1.5.19\n"})
	runner.set("", "npm", []string{"install", "-g", "skills@1.5.18"}, skillsCommandResult{
		ExitCode: 1,
		Stderr:   "global install denied",
		Err:      errors.New("exit status 1"),
	})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK {
		t.Fatalf("response=%#v, want pinned npx fallback scan to succeed", body)
	}
	if !runner.hasCall("", "npm", "install", "-g", "skills@1.5.18") {
		t.Fatalf("mismatched global CLI was not replaced: %#v", runner.calls)
	}
	if !runner.hasCall("", "npx", "--yes", "skills@1.5.18", "list", "-g", "--json") {
		t.Fatalf("pinned npx fallback not called: %#v", runner.calls)
	}
	if runner.hasCall("", "skills", "list", "-g", "--json") {
		t.Fatalf("mismatched global CLI must not handle scan: %#v", runner.calls)
	}
}

func TestSkillsCommandScanReturnsHubAndProjectSkillsWithCategories(t *testing.T) {
	baseDir := t.TempDir()
	projectRoot := filepath.Join(baseDir, "project")
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	globalLock := filepath.Join(baseDir, "global-lock.json")
	writeSkillsLockForTest(t, globalLock, map[string]string{"tdd": "mattpocock-skills"})
	writeSkillsLockForTest(t, filepath.Join(projectRoot, "skills-lock.json"), map[string]string{"diagnose": "mattpocock-skills"})

	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"list", "-g", "--json"}, skillsCommandResult{
		Stdout:   `[{"name":"tdd","path":"C:/skills/tdd","scope":"global","agents":["Codex"]},{"name":"manual-global","path":"C:/skills/manual-global","scope":"global","agents":["Codex"]}]`,
		ExitCode: 0,
	})
	runner.set(projectRoot, "skills", []string{"list", "--json"}, skillsCommandResult{
		Stdout:   `[{"name":"diagnose","path":"C:/skills/diagnose","scope":"project","agents":["Codex","Claude Code"]},{"name":"manual-project","path":"C:/skills/manual-project","scope":"project","agents":["Codex"]}]`,
		ExitCode: 0,
	})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:          "hub-a",
		GlobalLockPath: globalLock,
		Projects:       []ProjectInfo{{Name: "WheelMaker", Path: projectRoot, Online: true}},
	})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK || body.HubID != "hub-a" || body.HubSkills.Scope != "hub" {
		t.Fatalf("response=%#v", body)
	}
	if len(body.HubSkills.Skills) != 2 || body.HubSkills.Skills[0].Name != "tdd" || body.HubSkills.Skills[1].Name != "manual-global" {
		t.Fatalf("hub skills=%#v", body.HubSkills.Skills)
	}
	if body.HubSkills.Skills[0].Category != "Mattpocock Skills" || body.HubSkills.Skills[0].CategoryKey != "mattpocock-skills" {
		t.Fatalf("hub skill category=%#v", body.HubSkills.Skills[0])
	}
	if body.HubSkills.Skills[1].Category != "General" || body.HubSkills.Skills[1].CategoryKey != "general" {
		t.Fatalf("unlocked hub skill category=%#v", body.HubSkills.Skills[1])
	}
	hubManaged := skillManagedFlagsForTest(t, body.HubSkills.Skills)
	if !hubManaged["tdd"] || hubManaged["manual-global"] {
		t.Fatalf("hub managed flags=%#v", hubManaged)
	}
	if len(body.Projects) != 1 || body.Projects[0].ProjectName != "WheelMaker" || len(body.Projects[0].Skills) != 2 {
		t.Fatalf("projects=%#v", body.Projects)
	}
	if body.Projects[0].Skills[0].Name != "diagnose" || body.Projects[0].Skills[0].Category != "Mattpocock Skills" {
		t.Fatalf("project skill=%#v", body.Projects[0].Skills[0])
	}
	projectManaged := skillManagedFlagsForTest(t, body.Projects[0].Skills)
	if !projectManaged["diagnose"] || projectManaged["manual-project"] {
		t.Fatalf("project managed flags=%#v", projectManaged)
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal skills scan response: %v", err)
	}
	if strings.Contains(string(encoded), `"online"`) {
		t.Fatalf("Skills response still exposes the removed online field: %s", encoded)
	}
}

func TestSkillsCommandListParsesGroupedSourceOutput(t *testing.T) {
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"add", "mattpocock/skills", "--list"}, skillsCommandResult{
		Stdout: `Source: mattpocock/skills

Available Skills

Mattpocock Skills
  tdd
    Practice test-driven development
  diagnose
    Debug with a disciplined loop
`,
		ExitCode: 0,
	})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "list",
		"hubId":  "hub-a",
		"source": "mattpocock/skills",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle list error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK || len(body.Candidates) != 2 {
		t.Fatalf("response=%#v, want two candidates", body)
	}
	if body.Candidates[0].Name != "tdd" || body.Candidates[0].Category != "Mattpocock Skills" || body.Candidates[0].CategoryKey != "mattpocock-skills" {
		t.Fatalf("first candidate=%#v", body.Candidates[0])
	}
	if body.Candidates[1].Name != "diagnose" || !strings.Contains(body.Candidates[1].Description, "Debug") {
		t.Fatalf("second candidate=%#v", body.Candidates[1])
	}
}

func TestSkillsCommandInstallUsesGlobalSymlinkAndProjectCopy(t *testing.T) {
	baseDir := t.TempDir()
	homeRoot := filepath.Join(baseDir, "home")
	projectRoot := filepath.Join(baseDir, "project")
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	t.Setenv("CLAUDE_CONFIG_DIR", filepath.Join(homeRoot, ".claude"))
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"list", "-g", "--json"}, skillsCommandResult{Stdout: "[]", ExitCode: 0})
	runner.set(projectRoot, "skills", []string{"list", "--json"}, skillsCommandResult{Stdout: "[]", ExitCode: 0})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:   "hub-a",
		HomeDir: homeRoot,
		Projects: []ProjectInfo{{
			Name:   "WheelMaker",
			Path:   projectRoot,
			Online: true,
		}},
	})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "install",
		"hubId":  "hub-a",
		"scope":  "hub",
		"source": "mattpocock/skills",
		"skills": []string{"tdd"},
	}))
	if cmdErr != nil {
		t.Fatalf("hub install error: %#v", cmdErr)
	}
	waitForSkillsCall(t, runner, "", "skills", "add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "-y")
	assertDirExists(t, filepath.Join(homeRoot, ".agents", "skills"))
	assertDirExists(t, filepath.Join(homeRoot, ".claude", "skills"))
	if operation := waitForSkillsOperationDone(t, cmd); operation.Status != "succeeded" {
		t.Fatalf("operation=%#v, want succeeded", operation)
	}
	if runner.hasCall("", "skills", "add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "--copy", "-y") {
		t.Fatalf("global install should not request copy mode: %#v", runner.calls)
	}

	_, cmdErr = cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"scope":       "project",
		"projectName": "WheelMaker",
		"source":      "mattpocock/skills",
		"skills":      []string{"diagnose"},
	}))
	if cmdErr != nil {
		t.Fatalf("project install error: %#v", cmdErr)
	}
	waitForSkillsCall(t, runner, projectRoot, "skills", "add", "mattpocock/skills", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "diagnose", "--copy", "-y")
	assertDirExists(t, filepath.Join(projectRoot, ".agents", "skills"))
	assertDirExists(t, filepath.Join(projectRoot, ".claude", "skills"))
}

func TestSkillsCommandUninstallRemovesManagedAndUnmanagedSkillDirectories(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	globalLock := filepath.Join(root, "global-lock.json")
	if err := os.WriteFile(globalLock, []byte(`{"version":1,"skills":{"tdd":{"source":"https://github.com/example/catalog.git"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, directory := range []string{
		filepath.Join(home, ".agents", "skills", "tdd"),
		filepath.Join(home, ".claude", "skills", "tdd"),
		filepath.Join(home, ".agents", "skills", "local"),
		filepath.Join(home, ".claude", "skills", "local"),
	} {
		writeSkillSourceFixture(t, directory, "# TDD\n", nil)
	}
	runner := newFakeSkillsRunner()
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a", HomeDir: home, GlobalLockPath: globalLock})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "uninstall",
		"hubId":  "hub-a",
		"scope":  "hub",
		"skills": []string{"tdd", "local"},
	}))
	if cmdErr != nil {
		t.Fatalf("uninstall error: %#v", cmdErr)
	}
	operation := waitForSkillsOperationDone(t, cmd)
	if operation.Status != "succeeded" {
		t.Fatalf("operation=%#v, want succeeded", operation)
	}
	for _, directory := range []string{
		filepath.Join(home, ".agents", "skills", "tdd"),
		filepath.Join(home, ".claude", "skills", "tdd"),
		filepath.Join(home, ".agents", "skills", "local"),
		filepath.Join(home, ".claude", "skills", "local"),
	} {
		if _, err := os.Lstat(directory); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("skill directory %s still exists, err=%v", directory, err)
		}
	}
	if countSkillsCalls(runner, "", "skills", "remove", "-g", "--skill", "tdd", "--agent", "codex", "claude-code", "opencode", "github-copilot", "-y") != 0 {
		t.Fatalf("uninstall should remove managed directories directly: %#v", runner.calls)
	}
	if entries := readNativeSkillSourceEntries(globalLock); len(entries) != 0 {
		t.Fatalf("native skill lock retained removed skill: %#v", entries)
	}
}

func TestSkillsCommandUpdateUsesHubAndProjectScopes(t *testing.T) {
	baseDir := t.TempDir()
	homeRoot := filepath.Join(baseDir, "home")
	projectRoot := filepath.Join(baseDir, "project")
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	globalLock := filepath.Join(baseDir, "global-lock.json")
	writeSkillsLockSourcesForTest(t, globalLock, map[string]string{"tdd": "mattpocock/skills"})
	writeSkillsLockSourcesForTest(t, filepath.Join(projectRoot, "skills-lock.json"), map[string]string{"diagnose": "mattpocock/skills"})
	t.Setenv("CLAUDE_CONFIG_DIR", filepath.Join(homeRoot, ".claude"))
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"list", "-g", "--json"}, skillsCommandResult{Stdout: "[]", ExitCode: 0})
	runner.set(projectRoot, "skills", []string{"list", "--json"}, skillsCommandResult{Stdout: "[]", ExitCode: 0})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:          "hub-a",
		HomeDir:        homeRoot,
		GlobalLockPath: globalLock,
		Projects:       []ProjectInfo{{Name: "WheelMaker", Path: projectRoot, Online: true}},
	})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "update",
		"hubId":  "hub-a",
		"scope":  "hub",
	}))
	if cmdErr != nil {
		t.Fatalf("hub update error: %#v", cmdErr)
	}
	waitForSkillsCall(t, runner, "", "skills", "add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "-y")
	assertDirExists(t, filepath.Join(homeRoot, ".agents", "skills"))
	assertDirExists(t, filepath.Join(homeRoot, ".claude", "skills"))
	waitForSkillsOperationDone(t, cmd)
	_, cmdErr = cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action":      "update",
		"hubId":       "hub-a",
		"scope":       "project",
		"projectName": "WheelMaker",
	}))
	if cmdErr != nil {
		t.Fatalf("project update error: %#v", cmdErr)
	}
	waitForSkillsCall(t, runner, projectRoot, "skills", "add", "mattpocock/skills", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "diagnose", "--copy", "-y")
}

func TestSkillsCommandWriteActionsReturnAcceptedOperation(t *testing.T) {
	runner := newFakeSkillsRunner()
	block := runner.block("", "skills", "remove", "-g", "--skill", "tdd", "--agent", "codex", "claude-code", "opencode", "github-copilot", "-y")
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "uninstall",
		"hubId":  "hub-a",
		"scope":  "hub",
		"skills": []string{"tdd"},
	}))
	if cmdErr != nil {
		t.Fatalf("uninstall error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK || !body.Accepted || body.Operation == nil || !body.Operation.Running {
		t.Fatalf("response=%#v, want accepted running operation", body)
	}
	if body.Operation.Action != "uninstall" || body.Operation.Scope != "hub" || body.Operation.Status != "running" {
		t.Fatalf("operation=%#v, want uninstall hub running", body.Operation)
	}
	close(block)
	waitForSkillsOperationDone(t, cmd)
}

func TestSkillsCommandOnOperationDoneCalledAfterSuccess(t *testing.T) {
	baseDir := t.TempDir()
	projectRoot := filepath.Join(baseDir, "project")
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"list", "-g", "--json"}, skillsCommandResult{Stdout: "[]", ExitCode: 0})
	runner.set(projectRoot, "skills", []string{"list", "--json"}, skillsCommandResult{Stdout: "[]", ExitCode: 0})

	callbackDone := make(chan struct{})
	var callbackScope, callbackProject string
	var callbackOperation SkillsOperationSnapshot
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID: "hub-a",
		Projects: []ProjectInfo{{
			Name: "proj",
			Path: projectRoot,
		}},
		OnOperationDone: func(scope, projectName string, operation SkillsOperationSnapshot) {
			callbackScope = scope
			callbackProject = projectName
			callbackOperation = operation
			close(callbackDone)
		},
	})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"scope":       "project",
		"projectName": "proj",
		"source":      "mattpocock/skills",
		"skills":      []string{"tdd"},
	}))
	if cmdErr != nil {
		t.Fatalf("install error: %#v", cmdErr)
	}

	select {
	case <-callbackDone:
	case <-time.After(5 * time.Second):
		t.Fatal("OnOperationDone callback not called within timeout")
	}
	if callbackScope != "project" {
		t.Fatalf("callback scope = %q, want %q", callbackScope, "project")
	}
	if callbackProject != "proj" {
		t.Fatalf("callback projectName = %q, want %q", callbackProject, "proj")
	}
	if callbackOperation.Running || callbackOperation.Status != "succeeded" {
		t.Fatalf("callback operation = %+v, want terminal success", callbackOperation)
	}
}

func TestSkillsCommandOnOperationDoneCalledAfterFailure(t *testing.T) {
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "-y"}, skillsCommandResult{
		ExitCode: 1,
		Stderr:   "install failed",
	})
	runner.set("", "npx", []string{"--yes", "skills@1.5.18", "add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "-y"}, skillsCommandResult{
		ExitCode: 1,
		Stderr:   "install failed",
	})

	callbackCalled := make(chan struct{}, 1)
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID: "hub-a",
		OnOperationDone: func(scope, projectName string, operation SkillsOperationSnapshot) {
			if operation.Running || operation.Status != "failed" {
				t.Errorf("callback operation = %+v, want terminal failure", operation)
			}
			callbackCalled <- struct{}{}
		},
	})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "install",
		"hubId":  "hub-a",
		"scope":  "hub",
		"source": "mattpocock/skills",
		"skills": []string{"tdd"},
	}))
	if cmdErr != nil {
		t.Fatalf("install error: %#v", cmdErr)
	}

	waitForSkillsOperationDone(t, cmd)

	select {
	case <-callbackCalled:
	case <-time.After(5 * time.Second):
		t.Fatal("OnOperationDone callback not called after failure")
	}
}

func TestSkillsCommandRejectsConcurrentWriteOperations(t *testing.T) {
	runner := newFakeSkillsRunner()
	block := runner.block("", "skills", "add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "-y")
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "install",
		"hubId":  "hub-a",
		"scope":  "hub",
		"source": "mattpocock/skills",
		"skills": []string{"tdd"},
	}))
	if cmdErr != nil {
		t.Fatalf("first install error: %#v", cmdErr)
	}
	waitForSkillsCall(t, runner, "", "skills", "add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "-y")
	_, cmdErr = cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "uninstall",
		"hubId":  "hub-a",
		"scope":  "hub",
		"skills": []string{"tdd"},
	}))
	if cmdErr == nil || cmdErr.Code != rp.CodeConflict {
		t.Fatalf("cmdErr=%#v, want CONFLICT", cmdErr)
	}
	close(block)
	waitForSkillsOperationDone(t, cmd)
}

func TestSkillsCommandUpdateStaysWithinHubScope(t *testing.T) {
	baseDir := t.TempDir()
	projectRoot := filepath.Join(baseDir, "project")
	globalLock := filepath.Join(baseDir, "global-lock.json")
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	writeSkillsLockSourcesForTest(t, globalLock, map[string]string{"tdd": "mattpocock/skills"})
	writeSkillsLockSourcesForTest(t, filepath.Join(projectRoot, "skills-lock.json"), map[string]string{"diagnose": "mattpocock/skills"})
	runner := newFakeSkillsRunner()
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:          "hub-a",
		HomeDir:        filepath.Join(baseDir, "home"),
		GlobalLockPath: globalLock,
		Projects:       []ProjectInfo{{Name: "WheelMaker", Path: projectRoot, Online: true}},
	})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "update",
		"hubId":  "hub-a",
		"scope":  "hub",
	}))
	if cmdErr != nil {
		t.Fatalf("hub update error: %#v", cmdErr)
	}
	waitForSkillsCall(t, runner, "", "skills", "add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "-y")
	operation := waitForSkillsOperationDone(t, cmd)
	if operation.Status != "succeeded" {
		t.Fatalf("operation=%#v, want succeeded hub-only update", operation)
	}
	if runner.hasCall(projectRoot, "skills", "add", "mattpocock/skills", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "diagnose", "--copy", "-y") {
		t.Fatalf("hub update must not schedule project update: %#v", runner.calls)
	}
}

func TestSkillsCommandUpdateFiltersRequestedSkills(t *testing.T) {
	baseDir := t.TempDir()
	globalLock := filepath.Join(baseDir, "global-lock.json")
	writeSkillsLockSourcesForTest(t, globalLock, map[string]string{
		"diagnose": "mattpocock/skills",
		"tdd":      "mattpocock/skills",
	})
	runner := newFakeSkillsRunner()
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:          "hub-a",
		HomeDir:        filepath.Join(baseDir, "home"),
		GlobalLockPath: globalLock,
	})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "update",
		"hubId":  "hub-a",
		"scope":  "hub",
		"skills": []string{"tdd"},
	}))
	if cmdErr != nil {
		t.Fatalf("hub update error: %#v", cmdErr)
	}
	operation := waitForSkillsOperationDone(t, cmd)
	if operation.Status != "succeeded" {
		t.Fatalf("operation=%#v, want succeeded single-skill update", operation)
	}
	if !runner.hasCall("", "skills", "add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "-y") {
		t.Fatalf("single-skill update call missing: %#v", runner.calls)
	}
	if runner.hasCall("", "skills", "add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "diagnose", "tdd", "-y") {
		t.Fatalf("single-skill update included an unrequested skill: %#v", runner.calls)
	}
}

func TestSkillsCommandDetailReturnsSkillContentAndInstallMetadata(t *testing.T) {
	baseDir := t.TempDir()
	homeRoot := filepath.Join(baseDir, "home")
	t.Setenv("HOME", homeRoot)
	t.Setenv("USERPROFILE", homeRoot)
	skillRoot := filepath.Join(homeRoot, ".agents", "skills", "tdd")
	if err := os.MkdirAll(filepath.Join(skillRoot, "references"), 0o755); err != nil {
		t.Fatalf("mkdir skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillRoot, "SKILL.md"), []byte("---\nname: tdd\n---\n# TDD\nPractice test-driven development.\n"), 0o644); err != nil {
		t.Fatalf("write skill md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillRoot, "references", "checklist.md"), []byte("red green refactor"), 0o644); err != nil {
		t.Fatalf("write support file: %v", err)
	}
	globalLock := filepath.Join(baseDir, "global-lock.json")
	writeDetailedSkillsLockForTest(t, globalLock, map[string]detailedLockSkillForTest{
		"tdd": {
			Source:      "mattpocock/skills",
			SourceURL:   "https://github.com/mattpocock/skills.git",
			SourceType:  "github",
			Ref:         "main",
			SkillPath:   "skills/tdd/SKILL.md",
			PluginName:  "mattpocock-skills",
			InstalledAt: "2026-06-01T00:00:00Z",
			UpdatedAt:   "2026-06-02T00:00:00Z",
		},
	})
	runner := newFakeSkillsRunner()
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:          "hub-a",
		GlobalLockPath: globalLock,
		HomeDir:        homeRoot,
		Projects:       []ProjectInfo{{Name: "WheelMaker", Path: baseDir, Agents: []string{"codex"}}},
	})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "detail",
		"hubId":  "hub-a",
		"scope":  "hub",
		"skills": []string{"tdd"},
	}))
	if cmdErr != nil {
		t.Fatalf("detail error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK || body.Detail == nil {
		t.Fatalf("response=%#v, want detail", body)
	}
	if body.Detail.Name != "tdd" || !strings.Contains(body.Detail.SkillMarkdown, "Practice test-driven development.") {
		t.Fatalf("detail=%#v, want skill content", body.Detail)
	}
	if body.Detail.Source != "mattpocock/skills" || body.Detail.SkillPath != "skills/tdd/SKILL.md" || body.Detail.InstalledAt == "" {
		t.Fatalf("detail metadata=%#v", body.Detail)
	}
	if len(body.Detail.SupportingFiles) != 1 || body.Detail.SupportingFiles[0].RelativePath != "references/checklist.md" {
		t.Fatalf("supporting files=%#v", body.Detail.SupportingFiles)
	}
	if runner.hasCall("", "skills", "list", "-g", "--json") {
		t.Fatalf("detail should read the discovered local file without invoking skills list: %#v", runner.calls)
	}
}

func TestSkillsCommandDetailReadsMimoNativeProjectSkillWithoutCLI(t *testing.T) {
	projectRoot := t.TempDir()
	skillRoot := filepath.Join(projectRoot, ".mimocode", "skills", "native-detail")
	if err := os.MkdirAll(skillRoot, 0o755); err != nil {
		t.Fatalf("mkdir skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillRoot, "SKILL.md"), []byte("---\nname: native-detail\n---\n# Native detail\n"), 0o644); err != nil {
		t.Fatalf("write skill md: %v", err)
	}
	runner := newFakeSkillsRunner()
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID: "hub-a",
		Projects: []ProjectInfo{{
			Name:   "WheelMaker",
			Path:   projectRoot,
			Agents: []string{"mimo"},
		}},
	})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action":      "detail",
		"hubId":       "hub-a",
		"scope":       "project",
		"projectName": "WheelMaker",
		"skills":      []string{"native-detail"},
	}))
	if cmdErr != nil {
		t.Fatalf("detail error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK || body.Detail == nil || !strings.Contains(body.Detail.SkillMarkdown, "Native detail") {
		t.Fatalf("response=%#v, want native skill detail", body)
	}
	if body.Detail.Source != "" || body.Detail.PluginName != "" {
		t.Fatalf("unavailable install metadata should be omitted: %#v", body.Detail)
	}
	if runner.hasCall(projectRoot, "skills", "list", "--json") {
		t.Fatalf("native detail should not invoke skills list: %#v", runner.calls)
	}
}

func TestSkillsCommandDetailReturnsNotFoundForUnknownSkill(t *testing.T) {
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"list", "-g", "--json"}, skillsCommandResult{
		Stdout:   `[{"name":"tdd","path":"C:/skills/tdd","scope":"global","agents":["Codex"]}]`,
		ExitCode: 0,
	})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "detail",
		"hubId":  "hub-a",
		"scope":  "hub",
		"skills": []string{"missing"},
	}))
	if cmdErr == nil || cmdErr.Code != rp.CodeNotFound {
		t.Fatalf("cmdErr=%#v, want NOT_FOUND", cmdErr)
	}
}

func TestSkillsCommandRejectsUnsupportedSources(t *testing.T) {
	cmd := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a"})
	for _, source := range []string{"../local", "git@github.com:a/b.git", "https://example.com/repo.git"} {
		t.Run(source, func(t *testing.T) {
			_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
				"action": "list",
				"hubId":  "hub-a",
				"source": source,
			}))
			if cmdErr == nil || cmdErr.Code != rp.CodeForbidden {
				t.Fatalf("cmdErr=%#v, want FORBIDDEN", cmdErr)
			}
		})
	}
}

func TestSkillsCommandFailureReturnsStructuredSummary(t *testing.T) {
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"add", "mattpocock/skills", "--list"}, skillsCommandResult{
		Stderr:   "first problem\n\n" + strings.Repeat("x", 650),
		ExitCode: 7,
		Err:      errors.New("exit status 7"),
	})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "list",
		"hubId":  "hub-a",
		"source": "mattpocock/skills",
	}))
	if cmdErr != nil {
		t.Fatalf("list error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if body.OK || !strings.Contains(body.ErrorSummary, "exit code 7") {
		t.Fatalf("response=%#v, want failed summary", body)
	}
	if strings.Contains(body.ErrorSummary, "first problem") {
		t.Fatalf("summary=%q should use last non-empty stderr segment", body.ErrorSummary)
	}
	if len(body.ErrorSummary) > len("exit code 7: ")+500 {
		t.Fatalf("summary length=%d, want truncated segment", len(body.ErrorSummary))
	}
}

func TestSkillsCommandFailureIncludesNpxExecErrorWhenFallbackOutputEmpty(t *testing.T) {
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"add", "mattpocock/skills", "--list"}, skillsCommandResult{
		ExitCode: -1,
		Err:      errors.New(`exec: "skills": executable file not found in $PATH`),
	})
	runner.set("", "npx", []string{"--yes", "skills@1.5.18", "add", "mattpocock/skills", "--list"}, skillsCommandResult{
		ExitCode: -1,
		Err:      errors.New(`exec: "npx": executable file not found in $PATH`),
	})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "list",
		"hubId":  "hub-a",
		"source": "mattpocock/skills",
	}))
	if cmdErr != nil {
		t.Fatalf("list error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if body.OK {
		t.Fatalf("response=%#v, want failed response", body)
	}
	if !strings.Contains(body.ErrorSummary, `exec: "npx"`) {
		t.Fatalf("summary=%q, want npx exec error", body.ErrorSummary)
	}
}

func TestSkillsCommandUnknownProjectReturnsNotFound(t *testing.T) {
	cmd := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a"})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action":      "update",
		"hubId":       "hub-a",
		"scope":       "project",
		"projectName": "Missing",
	}))
	if cmdErr == nil || cmdErr.Code != rp.CodeNotFound {
		t.Fatalf("cmdErr=%#v, want NOT_FOUND", cmdErr)
	}
}

func rawSkillsCommandPayload(t *testing.T, payload map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return raw
}

func writeSkillsLockForTest(t *testing.T, path string, plugins map[string]string) {
	t.Helper()
	type lockSkill struct {
		PluginName string `json:"pluginName"`
	}
	body := struct {
		Version int                  `json:"version"`
		Skills  map[string]lockSkill `json:"skills"`
	}{
		Version: 1,
		Skills:  map[string]lockSkill{},
	}
	for name, pluginName := range plugins {
		body.Skills[name] = lockSkill{PluginName: pluginName}
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal lock: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write lock: %v", err)
	}
}

func skillManagedFlagsForTest(t *testing.T, skills []skillsSkillSnapshot) map[string]bool {
	t.Helper()
	raw, err := json.Marshal(skills)
	if err != nil {
		t.Fatalf("marshal skills: %v", err)
	}
	var items []struct {
		Name    string `json:"name"`
		Managed *bool  `json:"managed"`
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		t.Fatalf("unmarshal skills: %v", err)
	}
	out := make(map[string]bool, len(items))
	for _, item := range items {
		if item.Managed == nil {
			t.Fatalf("skill %q is missing managed flag in %s", item.Name, string(raw))
		}
		out[item.Name] = *item.Managed
	}
	return out
}

func writeSkillsLockSourcesForTest(t *testing.T, path string, sources map[string]string) {
	t.Helper()
	type lockSkill struct {
		Source     string `json:"source"`
		SourceType string `json:"sourceType"`
	}
	body := struct {
		Version int                  `json:"version"`
		Skills  map[string]lockSkill `json:"skills"`
	}{
		Version: 1,
		Skills:  map[string]lockSkill{},
	}
	for name, source := range sources {
		body.Skills[name] = lockSkill{Source: source, SourceType: "github"}
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal lock: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write lock: %v", err)
	}
}

type detailedLockSkillForTest struct {
	Source      string `json:"source"`
	SourceURL   string `json:"sourceUrl"`
	SourceType  string `json:"sourceType"`
	Ref         string `json:"ref"`
	SkillPath   string `json:"skillPath"`
	PluginName  string `json:"pluginName"`
	InstalledAt string `json:"installedAt"`
	UpdatedAt   string `json:"updatedAt"`
}

func writeDetailedSkillsLockForTest(t *testing.T, path string, skills map[string]detailedLockSkillForTest) {
	t.Helper()
	body := struct {
		Version int                                 `json:"version"`
		Skills  map[string]detailedLockSkillForTest `json:"skills"`
	}{
		Version: 3,
		Skills:  skills,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal detailed lock: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write detailed lock: %v", err)
	}
}

func TestUpdateQueryReadsOnlyInstalledReleaseAndLocalJobState(t *testing.T) {
	baseDir := t.TempDir()
	installed := installedRelease{
		SchemaVersion: 2,
		Version:       "v1.22",
		PublishedAt:   "2026-07-15T09:00:00Z",
		SourceSHA:     strings.Repeat("a", 40),
		ManifestSHA:   strings.Repeat("c", 64),
		InstalledAt:   "2026-07-15T09:05:00Z",
	}
	writeInstalledReleaseForTest(t, baseDir, installed)
	cmd := newUpdateCommandWithDependencies(baseDir, &fakeUpdateTrigger{})
	got := handleUpdateForTest(t, cmd, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	})

	if got.Status != "installed" || got.Installed == nil || got.Installed.Version != "v1.22" {
		t.Fatalf("response=%+v", got)
	}
	if !got.OK || !got.CanRequest {
		t.Fatalf("response=%+v, want installed requestable Hub", got)
	}
	if got.Stable != nil || got.PublishStatus != nil {
		t.Fatalf("response includes global metadata: %+v", got)
	}
}

func TestUpdateQueryRejectsInvalidInstalledRelease(t *testing.T) {
	baseDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(baseDir, "release.json"), []byte("{\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cmd := newUpdateCommandWithDependencies(baseDir, &fakeUpdateTrigger{})

	got := handleUpdateForTest(t, cmd, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	})
	if got.Status != "checking_failed" || got.ErrorCode != "installed_release_invalid" {
		t.Fatalf("response=%+v", got)
	}
	if got.CanRequest {
		t.Fatalf("canRequestUpdate=true for invalid installed release")
	}
}

func TestUpdateRequestTriggersCoreWithoutCreatingJobState(t *testing.T) {
	baseDir := t.TempDir()
	trigger := &fakeUpdateTrigger{}
	cmd := newUpdateCommandWithDependencies(baseDir, trigger)
	response := handleUpdateForTest(t, cmd, map[string]any{
		"action": "request",
		"hubId":  "hub-a",
	})
	if !response.OK || !response.Accepted || response.Status != "update_pending" {
		t.Fatalf("response=%+v, want accepted pending response", response)
	}
	if response.JobID != "" || response.Job != nil {
		t.Fatalf("response=%+v, update.go must not allocate a job", response)
	}
	if trigger.Calls() != 1 {
		t.Fatalf("trigger calls=%d, want 1", trigger.Calls())
	}
	if _, err := os.Stat(filepath.Join(baseDir, "staging")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("request created update state: %v", err)
	}
}

func TestUpdateRequestSharesStateCreatedByCore(t *testing.T) {
	baseDir := t.TempDir()
	trigger := &fakeUpdateTrigger{onTrigger: func() {
		writeUpdateLeaseForTest(t, baseDir, updateLease{
			Schema:      1,
			JobID:       "core-job",
			Owner:       "timer",
			State:       "queued",
			StartedAt:   "2026-08-06T09:00:00Z",
			HeartbeatAt: "2026-08-06T09:00:00Z",
		})
		writeUpdateStatusForTest(t, baseDir, updateJobStatus{
			Schema:    1,
			JobID:     "core-job",
			State:     "queued",
			StartedAt: "2026-08-06T09:00:00Z",
			UpdatedAt: "2026-08-06T09:00:00Z",
		})
	}}
	cmd := newUpdateCommandWithDependencies(baseDir, trigger)

	response := handleUpdateForTest(t, cmd, map[string]any{
		"action": "request",
		"hubId":  "hub-a",
	})
	if response.JobID != "core-job" || response.Job == nil || response.Job.State != "queued" {
		t.Fatalf("response=%+v, want state created by core", response)
	}
}

func TestUpdateCommandNotifiesOnceWhenExternalUpdaterReachesTerminalState(t *testing.T) {
	baseDir := t.TempDir()
	cmd := newUpdateCommandWithDependencies(baseDir, &fakeUpdateTrigger{})
	writeUpdateLeaseForTest(t, baseDir, updateLease{
		Schema:      1,
		JobID:       "core-job",
		Owner:       "timer",
		State:       "downloading",
		StartedAt:   "2026-08-06T09:00:00Z",
		HeartbeatAt: "2026-08-06T09:00:01Z",
	})
	writeUpdateStatusForTest(t, baseDir, updateJobStatus{
		Schema:    1,
		JobID:     "core-job",
		State:     "downloading",
		StartedAt: "2026-08-06T09:00:00Z",
		UpdatedAt: "2026-08-06T09:00:01Z",
	})
	done := make(chan struct{}, 2)
	cmd.setOperationDoneHandler(func() {
		done <- struct{}{}
	})
	response := handleUpdateForTest(t, cmd, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	})
	if response.Job == nil || response.Job.JobID != "core-job" {
		t.Fatalf("query response=%+v", response)
	}
	writeUpdateStatusForTest(t, baseDir, updateJobStatus{
		Schema:    1,
		JobID:     "core-job",
		State:     "failed",
		StartedAt: time.Now().UTC().Format(time.RFC3339Nano),
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		ErrorCode: "download_failed",
	})

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("update completion callback was not called")
	}
	select {
	case <-done:
		t.Fatal("update completion callback was called more than once")
	case <-time.After(100 * time.Millisecond):
	}
}

func TestUpdateQueryReportsActiveJobWithoutRetriggering(t *testing.T) {
	baseDir := t.TempDir()
	writeInstalledReleaseForTest(t, baseDir, installedRelease{
		SchemaVersion: 2,
		Version:       "v1.22",
		PublishedAt:   "2026-07-15T09:00:00Z",
		SourceSHA:     strings.Repeat("a", 40),
		ManifestSHA:   strings.Repeat("c", 64),
		InstalledAt:   "2026-07-15T09:05:00Z",
	})
	trigger := &fakeUpdateTrigger{}
	cmd := newUpdateCommandWithDependencies(baseDir, trigger)
	writeUpdateLeaseForTest(t, baseDir, updateLease{
		Schema:      1,
		JobID:       "core-job",
		Owner:       "timer",
		State:       "queued",
		StartedAt:   "2026-08-06T09:00:00Z",
		HeartbeatAt: "2026-08-06T09:00:00Z",
	})
	writeUpdateStatusForTest(t, baseDir, updateJobStatus{
		Schema:    1,
		JobID:     "core-job",
		State:     "queued",
		StartedAt: "2026-08-06T09:00:00Z",
		UpdatedAt: "2026-08-06T09:00:00Z",
	})

	queried := handleUpdateForTest(t, cmd, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	})
	if queried.Job == nil || queried.Job.JobID != "core-job" || queried.Job.State != "queued" {
		t.Fatalf("queried=%+v", queried)
	}
	if queried.CanRequest {
		t.Fatalf("canRequestUpdate=true while job is active")
	}
	if trigger.Calls() != 0 {
		t.Fatalf("trigger calls=%d, want 0 for query", trigger.Calls())
	}
}

func TestUpdateQueryDoesNotMutateStaleJob(t *testing.T) {
	baseDir := t.TempDir()
	writeInstalledReleaseForTest(t, baseDir, installedRelease{
		SchemaVersion: 2,
		Version:       "v1.22",
		PublishedAt:   "2026-07-15T09:00:00Z",
		SourceSHA:     strings.Repeat("a", 40),
		ManifestSHA:   strings.Repeat("c", 64),
		InstalledAt:   "2026-07-15T09:05:00Z",
	})
	writeUpdateLeaseForTest(t, baseDir, updateLease{
		Schema:      1,
		JobID:       "stale-job",
		Owner:       "timer",
		State:       "downloading",
		StartedAt:   "2026-08-03T07:00:00Z",
		HeartbeatAt: "2026-08-03T08:00:00Z",
	})
	cmd := newUpdateCommandWithDependencies(baseDir, &fakeUpdateTrigger{})
	writeUpdateStatusForTest(t, baseDir, updateJobStatus{
		Schema:    1,
		JobID:     "stale-job",
		State:     "downloading",
		StartedAt: "2026-08-03T07:00:00Z",
		UpdatedAt: "2026-08-03T08:00:00Z",
	})

	got := handleUpdateForTest(t, cmd, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	})
	if got.Job == nil || got.Job.State != "downloading" {
		t.Fatalf("job=%+v, want read-only stale state", got.Job)
	}
	if got.Status != "update_pending" || got.CanRequest {
		t.Fatalf("response=%+v, want active update", got)
	}
	lock, err := os.ReadFile(filepath.Join(baseDir, "staging", "lock.json"))
	if err != nil {
		t.Fatalf("read stale lock: %v", err)
	}
	if !strings.Contains(string(lock), `"jobId":"stale-job"`) {
		t.Fatalf("stale lock was changed: %s", lock)
	}
	status, err := os.ReadFile(filepath.Join(baseDir, "staging", "status.json"))
	if err != nil {
		t.Fatalf("read stale status: %v", err)
	}
	if !strings.Contains(string(status), `"state":"downloading"`) {
		t.Fatalf("stale status was changed: %s", status)
	}
}

func TestUpdateRequestDoesNotRetriggerFreshQueuedJob(t *testing.T) {
	baseDir := t.TempDir()
	writeUpdateLeaseForTest(t, baseDir, updateLease{
		Schema:      1,
		JobID:       "queued-job",
		Owner:       "timer",
		State:       "queued",
		StartedAt:   "2026-08-03T11:59:00Z",
		HeartbeatAt: "2026-08-03T11:59:30Z",
	})
	trigger := &fakeUpdateTrigger{}
	cmd := newUpdateCommandWithDependencies(baseDir, trigger)
	writeUpdateStatusForTest(t, baseDir, updateJobStatus{
		Schema:    1,
		JobID:     "queued-job",
		State:     "queued",
		StartedAt: "2026-08-03T11:59:00Z",
		UpdatedAt: "2026-08-03T11:59:30Z",
	})

	got := handleUpdateForTest(t, cmd, map[string]any{
		"action": "request",
		"hubId":  "hub-a",
	})
	if got.JobID != "queued-job" {
		t.Fatalf("response=%+v, want existing queued job", got)
	}
	if trigger.Calls() != 0 {
		t.Fatalf("trigger calls=%d, want 0 within grace", trigger.Calls())
	}
}

func TestUpdateRequestLeavesActiveJobUntouched(t *testing.T) {
	baseDir := t.TempDir()
	writeUpdateLeaseForTest(t, baseDir, updateLease{
		Schema:      1,
		JobID:       "active-job",
		Owner:       "timer",
		State:       "downloading",
		StartedAt:   "2026-08-03T11:50:00Z",
		HeartbeatAt: "2026-08-03T11:57:00Z",
	})
	trigger := &fakeUpdateTrigger{}
	cmd := newUpdateCommandWithDependencies(baseDir, trigger)
	writeUpdateStatusForTest(t, baseDir, updateJobStatus{
		Schema:    1,
		JobID:     "active-job",
		State:     "downloading",
		StartedAt: "2026-08-03T11:50:00Z",
		UpdatedAt: "2026-08-03T11:57:00Z",
	})

	got := handleUpdateForTest(t, cmd, map[string]any{
		"action": "request",
		"hubId":  "hub-a",
	})
	if got.JobID != "active-job" || got.Job == nil || got.Job.State != "downloading" {
		t.Fatalf("response=%+v, want untouched active job", got)
	}
	if trigger.Calls() != 0 {
		t.Fatalf("trigger calls=%d, want 0 for active job", trigger.Calls())
	}
}

func TestUpdaterTriggerSpecUsesKnownCurrentUserRuntime(t *testing.T) {
	windows := updaterTriggerSpec("windows", "501")
	if windows.Name != "powershell" || !strings.Contains(strings.Join(windows.Args, " "), "Start-ScheduledTask") || !strings.Contains(strings.Join(windows.Args, " "), "WheelMakerUpdater") {
		t.Fatalf("windows spec=%+v", windows)
	}
	linux := updaterTriggerSpec("linux", "501")
	if linux.Name != "systemctl" || !reflect.DeepEqual(linux.Args, []string{"--user", "--no-block", "start", "wheelmaker-updater.service"}) {
		t.Fatalf("linux spec=%+v", linux)
	}
	darwin := updaterTriggerSpec("darwin", "501")
	if darwin.Name != "launchctl" || !strings.Contains(strings.Join(darwin.Args, " "), "gui/501/com.wheelmaker.updater") {
		t.Fatalf("darwin spec=%+v", darwin)
	}
}

const ()

func handleUpdateForTest(t *testing.T, cmd *UpdateCommand, payload map[string]any) updateCommandResponse {
	t.Helper()
	resp, cmdErr := cmd.Handle(context.Background(), rawUpdateCommandPayload(t, payload))
	if cmdErr != nil {
		t.Fatalf("Handle update: %v", cmdErr)
	}
	out, ok := resp.(updateCommandResponse)
	if !ok {
		t.Fatalf("response=%T, want updateCommandResponse", resp)
	}
	return out
}

func rawUpdateCommandPayload(t *testing.T, payload map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return raw
}

func writeInstalledReleaseForTest(t *testing.T, baseDir string, release installedRelease) {
	t.Helper()
	raw, err := json.Marshal(release)
	if err != nil {
		t.Fatalf("marshal installed release: %v", err)
	}
	if err := os.WriteFile(filepath.Join(baseDir, "release.json"), append(raw, '\n'), 0o644); err != nil {
		t.Fatalf("write installed release: %v", err)
	}
}

func writeUpdateLeaseForTest(t *testing.T, baseDir string, lease updateLease) {
	t.Helper()
	raw, err := json.Marshal(lease)
	if err != nil {
		t.Fatalf("marshal update lease: %v", err)
	}
	stagingDir := filepath.Join(baseDir, "staging")
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		t.Fatalf("create staging dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(stagingDir, "lock.json"), append(raw, '\n'), 0o600); err != nil {
		t.Fatalf("write update lease: %v", err)
	}
}

func writeUpdateStatusForTest(t *testing.T, baseDir string, status updateJobStatus) {
	t.Helper()
	raw, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("marshal update status: %v", err)
	}
	stagingDir := filepath.Join(baseDir, "staging")
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		t.Fatalf("create staging dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(stagingDir, "status.json"), append(raw, '\n'), 0o600); err != nil {
		t.Fatalf("write update status: %v", err)
	}
}

type fakeUpdateTrigger struct {
	mu        sync.Mutex
	calls     int
	err       error
	onTrigger func()
}

func (f *fakeUpdateTrigger) Trigger(context.Context) error {
	f.mu.Lock()
	f.calls++
	onTrigger := f.onTrigger
	err := f.err
	f.mu.Unlock()
	if onTrigger != nil {
		onTrigger()
	}
	return err
}

func (f *fakeUpdateTrigger) Calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

type stubReleaseRunner struct {
	output string
	err    error
	calls  []releaseRunnerCall
}

func (r *stubReleaseRunner) Run(_ context.Context, workingDir string, args []string, log func(string)) error {
	r.calls = append(r.calls, releaseRunnerCall{WorkingDir: workingDir, Args: append([]string(nil), args...)})
	if r.output != "" {
		log(r.output)
	}
	return r.err
}

type controlledReleaseRunnerCall struct {
	releaseRunnerCall
	done chan error
}

type controlledReleaseRunner struct {
	calls chan controlledReleaseRunnerCall
}

func newControlledReleaseRunner() *controlledReleaseRunner {
	return &controlledReleaseRunner{calls: make(chan controlledReleaseRunnerCall, 2)}
}

func (r *controlledReleaseRunner) Run(_ context.Context, workingDir string, args []string, log func(string)) error {
	call := controlledReleaseRunnerCall{
		releaseRunnerCall: releaseRunnerCall{WorkingDir: workingDir, Args: append([]string(nil), args...), Log: log},
		done:              make(chan error, 1),
	}
	r.calls <- call
	return <-call.done
}

func makeReleaseSourceDir(t *testing.T) string {
	t.Helper()
	source := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "scripts", "release.mjs"), []byte("// test"), 0o600); err != nil {
		t.Fatal(err)
	}
	return source
}

func TestReleaseCommandStorageRunsScriptAndParsesReport(t *testing.T) {
	source := makeReleaseSourceDir(t)
	runner := &stubReleaseRunner{output: `{"totalBytes":600,"reclaimableBytes":200,"orphanCount":1}` + "\n"}
	command := newReleaseCommandWithDependencies(t.TempDir(), runner, nil)

	response, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "storage", "hubId": "publisher-hub", "sourcePath": source,
	}))
	if commandErr != nil {
		t.Fatalf("Handle() error=%v", commandErr)
	}
	body := response.(releaseCommandResponse)
	if !body.OK || body.Storage == nil {
		t.Fatalf("response=%#v", body)
	}
	if body.Storage.TotalBytes != 600 || body.Storage.ReclaimableBytes != 200 || body.Storage.OrphanCount != 1 {
		t.Fatalf("storage=%#v", body.Storage)
	}
	if len(runner.calls) != 1 || runner.calls[0].WorkingDir != source || runner.calls[0].Args[0] != "scripts/release/storage.mjs" {
		t.Fatalf("runner calls=%#v", runner.calls)
	}
}

func TestReleaseCommandStorageDoesNotBlockPublishBuild(t *testing.T) {
	source := makeReleaseSourceDir(t)
	runner := newControlledReleaseRunner()
	command := newReleaseCommandWithDependencies(t.TempDir(), runner, nil)
	storageFinished := make(chan *releaseCommandError, 1)
	go func() {
		_, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
			"action": "storage", "hubId": "publisher-hub", "sourcePath": source,
		}))
		storageFinished <- commandErr
	}()

	storageCall := <-runner.calls
	if got := storageCall.Args[0]; got != "scripts/release/storage.mjs" {
		t.Fatalf("first script=%q, want storage", got)
	}
	response, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "start", "hubId": "publisher-hub", "kind": "version", "sourcePath": source, "baseUrl": "https://release.wheelmaker.top",
	}))
	if commandErr != nil || !response.(releaseCommandResponse).Accepted {
		t.Fatalf("start response=%#v error=%v", response, commandErr)
	}

	publishStartedBeforeStorageFinished := true
	var publishCall controlledReleaseRunnerCall
	select {
	case publishCall = <-runner.calls:
	case <-time.After(250 * time.Millisecond):
		publishStartedBeforeStorageFinished = false
		storageCall.Log(`{"totalBytes":600,"reclaimableBytes":200,"orphanCount":1}` + "\n")
		storageCall.done <- nil
		publishCall = <-runner.calls
	}
	if publishStartedBeforeStorageFinished {
		storageCall.Log(`{"totalBytes":600,"reclaimableBytes":200,"orphanCount":1}` + "\n")
		storageCall.done <- nil
	}
	publishCall.done <- nil
	if storageErr := <-storageFinished; storageErr != nil {
		t.Fatalf("storage error=%v", storageErr)
	}
	assertReleaseStatus(t, command, response.(releaseCommandResponse).Job.ID, "success")
	if !publishStartedBeforeStorageFinished {
		t.Fatal("publish waited for a read-only storage query to release buildMu")
	}
}

func TestReleaseCommandPruneRunsScriptAndReturnsRemovedCount(t *testing.T) {
	source := makeReleaseSourceDir(t)
	runner := &stubReleaseRunner{output: `{"ok":true,"removedCount":2}` + "\n"}
	command := newReleaseCommandWithDependencies(t.TempDir(), runner, nil)

	response, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "prune", "hubId": "publisher-hub", "sourcePath": source,
	}))
	if commandErr != nil {
		t.Fatalf("Handle() error=%v", commandErr)
	}
	body := response.(releaseCommandResponse)
	if !body.OK || body.RemovedCount != 2 {
		t.Fatalf("response=%#v", body)
	}
	if runner.calls[0].Args[0] != "scripts/release/prune.mjs" {
		t.Fatalf("runner calls=%#v", runner.calls)
	}
}

func TestReleaseCommandStorageRequiresValidSourcePath(t *testing.T) {
	command := newReleaseCommandWithDependencies(t.TempDir(), &stubReleaseRunner{}, nil)
	_, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "storage", "hubId": "publisher-hub", "sourcePath": t.TempDir(),
	}))
	if commandErr == nil || commandErr.Code != rp.CodeInvalidArgument {
		t.Fatalf("error=%v, want INVALID_ARGUMENT", commandErr)
	}
}

func TestReleaseCommandStorageFailsWhenScriptHasNoResult(t *testing.T) {
	source := makeReleaseSourceDir(t)
	runner := &stubReleaseRunner{output: "some log noise\n"}
	command := newReleaseCommandWithDependencies(t.TempDir(), runner, nil)
	_, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "storage", "hubId": "publisher-hub", "sourcePath": source,
	}))
	if commandErr == nil || commandErr.Code != rp.CodeInternal {
		t.Fatalf("error=%v, want INTERNAL", commandErr)
	}
}

func TestReleaseCommandStoragePropagatesScriptFailure(t *testing.T) {
	source := makeReleaseSourceDir(t)
	runner := &stubReleaseRunner{err: errors.New("exit code 1"), output: "[release-storage] unauthorized\n"}
	command := newReleaseCommandWithDependencies(t.TempDir(), runner, nil)
	_, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "storage", "hubId": "publisher-hub", "sourcePath": source,
	}))
	if commandErr == nil || commandErr.Code != rp.CodeInternal {
		t.Fatalf("error=%v, want INTERNAL", commandErr)
	}
}

func TestSkillSourceLockPathUsesScopeAndGlobalLockDirectory(t *testing.T) {
	projectRoot := t.TempDir()
	if got, want := skillSourceLockPath(projectRoot, "", ""), filepath.Join(projectRoot, ".skill-source-lock.json"); got != want {
		t.Fatalf("project lock path=%q, want %q", got, want)
	}

	globalDir := t.TempDir()
	upstreamLock := filepath.Join(globalDir, ".skill-lock.json")
	if got, want := skillSourceLockPath("", upstreamLock, t.TempDir()), filepath.Join(globalDir, ".skill-source-lock.json"); got != want {
		t.Fatalf("global lock path=%q, want %q", got, want)
	}
}

func TestSkillSourceLockPathUsesXDGThenAgentsHome(t *testing.T) {
	xdg := t.TempDir()
	home := t.TempDir()
	t.Setenv("XDG_STATE_HOME", xdg)
	if got, want := skillSourceLockPath("", "", home), filepath.Join(xdg, "skills", ".skill-source-lock.json"); got != want {
		t.Fatalf("xdg lock path=%q, want %q", got, want)
	}

	t.Setenv("XDG_STATE_HOME", "")
	if got, want := skillSourceLockPath("", "", home), filepath.Join(home, ".agents", ".skill-source-lock.json"); got != want {
		t.Fatalf("home lock path=%q, want %q", got, want)
	}
}

func TestSkillSourceIdentityNormalizesHTTPSAndSSHRepositories(t *testing.T) {
	tests := []struct {
		input      string
		wantSource string
		wantKey    string
	}{
		{
			input:      "https://GitHub.com/OpenAI/skills.git/",
			wantSource: "https://github.com/OpenAI/skills.git",
			wantKey:    "github.com/openai/skills",
		},
		{
			input:      "git@GitHub.com:OpenAI/skills.git",
			wantSource: "git@github.com:OpenAI/skills.git",
			wantKey:    "github.com/openai/skills",
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.input, func(t *testing.T) {
			source, key, err := normalizeSkillGitSource(testCase.input)
			if err != nil {
				t.Fatalf("normalizeSkillGitSource() error=%v", err)
			}
			if source != testCase.wantSource || key != testCase.wantKey {
				t.Fatalf("normalizeSkillGitSource()=(%q, %q), want (%q, %q)", source, key, testCase.wantSource, testCase.wantKey)
			}
		})
	}
}

func TestSkillSourceIdentityRejectsEmbeddedHTTPSecretsAndLocalSources(t *testing.T) {
	for _, source := range []string{
		"https://token@github.com/openai/skills.git",
		"https://github.com/openai/skills.git?token=secret",
		"https://github.com/openai/skills.git#secret",
		"C:/local/skills",
		"../local/skills",
		"file:///tmp/skills",
	} {
		t.Run(source, func(t *testing.T) {
			if _, _, err := normalizeSkillGitSource(source); err == nil {
				t.Fatalf("normalizeSkillGitSource(%q) succeeded, want rejection", source)
			}
		})
	}
}

func TestSkillSourceDirectoryHashIncludesPathsAndSupportingFiles(t *testing.T) {
	rootA := t.TempDir()
	rootB := t.TempDir()
	for _, root := range []string{rootA, rootB} {
		if err := os.MkdirAll(filepath.Join(root, "references"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "SKILL.md"), []byte("# Skill\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "references", "guide.md"), []byte("guide\r\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, ".git", "HEAD"), []byte(root), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	hashA, err := hashSkillDirectory(rootA)
	if err != nil {
		t.Fatalf("hashSkillDirectory(rootA) error=%v", err)
	}
	hashB, err := hashSkillDirectory(rootB)
	if err != nil {
		t.Fatalf("hashSkillDirectory(rootB) error=%v", err)
	}
	if hashA != hashB || len(hashA) != 64 {
		t.Fatalf("hashes=(%q, %q), want identical SHA-256 values", hashA, hashB)
	}

	if err := os.WriteFile(filepath.Join(rootB, "references", "guide.md"), []byte("changed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	changed, err := hashSkillDirectory(rootB)
	if err != nil {
		t.Fatal(err)
	}
	if changed == hashA {
		t.Fatal("supporting-file content change did not change directory hash")
	}

	if err := os.Rename(filepath.Join(rootB, "references", "guide.md"), filepath.Join(rootB, "references", "renamed.md")); err != nil {
		t.Fatal(err)
	}
	renamed, err := hashSkillDirectory(rootB)
	if err != nil {
		t.Fatal(err)
	}
	if renamed == changed {
		t.Fatal("relative path change did not change directory hash")
	}
}

func TestSkillSourceDirectoryHashRejectsEscapingSymlink(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(filepath.Join(root, "SKILL.md"), []byte("# Skill\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outside, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "outside.txt")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := hashSkillDirectory(root); err == nil {
		t.Fatal("hashSkillDirectory() accepted a symlink escaping the skill root")
	}
}

func TestSkillSourceStoreWritesStableValidatedJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".skill-source-lock.json")
	lock := skillSourceLock{
		Version:       skillSourceLockVersion,
		HashAlgorithm: skillSourceHashAlgorithm,
		Sources: []skillSourceSnapshot{
			{
				Source:         "https://github.com/example/b.git",
				SourceKey:      "github.com/example/b",
				ResolvedCommit: strings.Repeat("b", 40),
				RefreshedAt:    "2026-08-12T12:00:00Z",
				SkillList: []skillSourceSkillSnapshot{
					{Name: "z-skill", SkillPath: "z/SKILL.md", ContentSHA256: strings.Repeat("f", 64)},
					{Name: "a-skill", SkillPath: "a/SKILL.md", ContentSHA256: strings.Repeat("a", 64)},
				},
			},
			{
				Source:    "https://github.com/example/a.git",
				SourceKey: "github.com/example/a",
			},
		},
	}
	revision, err := writeSkillSourceLockFile(path, skillSourceMissingRevision, lock)
	if err != nil {
		t.Fatalf("writeSkillSourceLockFile() error=%v", err)
	}
	if revision == "" || revision == skillSourceMissingRevision {
		t.Fatalf("revision=%q, want content revision", revision)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Index(string(raw), "example/a") > strings.Index(string(raw), "example/b") ||
		strings.Index(string(raw), "a-skill") > strings.Index(string(raw), "z-skill") {
		t.Fatalf("source lock is not stably sorted:\n%s", raw)
	}
	if !bytes.Contains(raw, []byte(`"version": 2`)) || bytes.Contains(raw, []byte(`"ref"`)) {
		t.Fatalf("source lock is not ref-free V2:\n%s", raw)
	}
	loaded, loadedRevision, err := readSkillSourceLockFile(path)
	if err != nil {
		t.Fatalf("readSkillSourceLockFile() error=%v", err)
	}
	if loadedRevision != revision || len(loaded.Sources) != 2 || loaded.Sources[0].SourceKey != "github.com/example/a" {
		t.Fatalf("loaded=%#v revision=%q, want sorted lock revision %q", loaded, loadedRevision, revision)
	}
}

func TestSkillSourceStoreRejectsUnknownVersionAndDuplicateSource(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".skill-source-lock.json")
	invalidValues := []string{
		`{"version":3,"hashAlgorithm":"sha256-v1","sources":[]}`,
		`{"version":2,"hashAlgorithm":"sha256-v1","sources":[{"source":"https://github.com/a/b.git","sourceKey":"github.com/a/b"},{"source":"git@github.com:a/b.git","sourceKey":"github.com/a/b"}]}`,
		`{"version":2,"hashAlgorithm":"sha256-v1","sources":[]} {}`,
		`{"version":2,"hashAlgorithm":"sha256-v1","sources":[{"source":"https://github.com/a/b.git","sourceKey":"github.com/a/b","ref":"main"}]}`,
	}
	for index, raw := range invalidValues {
		if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, _, err := readSkillSourceLockFile(path); err == nil {
			t.Fatalf("invalid source lock %d was accepted", index)
		}
	}
}

func TestSkillSourceStoreAtomicallyReplacesMatchingRevision(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".skill-source-lock.json")
	initial := skillSourceLock{Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm}
	revision, err := writeSkillSourceLockFile(path, skillSourceMissingRevision, initial)
	if err != nil {
		t.Fatal(err)
	}
	updated := initial
	updated.Sources = []skillSourceSnapshot{{
		Source: "https://github.com/example/new.git", SourceKey: "github.com/example/new",
	}}
	updatedRevision, err := writeSkillSourceLockFile(path, revision, updated)
	if err != nil {
		t.Fatalf("writeSkillSourceLockFile(update) error=%v", err)
	}
	loaded, loadedRevision, err := readSkillSourceLockFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if loadedRevision != updatedRevision || len(loaded.Sources) != 1 || loaded.Sources[0].SourceKey != "github.com/example/new" {
		t.Fatalf("loaded=%#v revision=%q, want updated revision %q", loaded, loadedRevision, updatedRevision)
	}
}

func TestSkillSourceStoreCompareAndSwapPreservesExternalEdit(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".skill-source-lock.json")
	initial := skillSourceLock{Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm}
	revision, err := writeSkillSourceLockFile(path, skillSourceMissingRevision, initial)
	if err != nil {
		t.Fatal(err)
	}
	external := []byte("{\"external\":true}\n")
	if err := os.WriteFile(path, external, 0o600); err != nil {
		t.Fatal(err)
	}
	updated := initial
	updated.Sources = []skillSourceSnapshot{{
		Source: "https://github.com/example/new.git", SourceKey: "github.com/example/new",
	}}
	if _, err := writeSkillSourceLockFile(path, revision, updated); !errors.Is(err, errSkillSourceLockChanged) {
		t.Fatalf("writeSkillSourceLockFile() error=%v, want errSkillSourceLockChanged", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(external) {
		t.Fatalf("external bytes changed to %q", raw)
	}
}

func TestSkillSourceResolverPinsRemoteDefaultHEADAndDiscoversCompleteCatalog(t *testing.T) {
	for _, branch := range []string{"main", "master", "trunk"} {
		t.Run(branch, func(t *testing.T) {
			repository := t.TempDir()
			runSkillSourceGit(t, repository, "init", "-b", branch)
			runSkillSourceGit(t, repository, "config", "user.email", "skills@example.com")
			runSkillSourceGit(t, repository, "config", "user.name", "Skills Test")
			writeSkillSourceFixture(t, filepath.Join(repository, "skills", "zeta"), "# Zeta\n", map[string]string{
				"references/guide.md": "guide one\n",
			})
			writeSkillSourceFixture(t, filepath.Join(repository, "skills", "alpha"), "# Alpha\n", nil)
			runSkillSourceGit(t, repository, "add", ".")
			runSkillSourceGit(t, repository, "commit", "-m", "initial catalog")
			wantCommit := strings.TrimSpace(runSkillSourceGit(t, repository, "rev-parse", "HEAD"))

			temporaryRoot := t.TempDir()
			resolver := newSkillSourceResolver(temporaryRoot)
			snapshot, err := resolver.Resolve(context.Background(), skillSourceSnapshot{
				Source: repository, SourceKey: "x/y",
			})
			if err != nil {
				t.Fatalf("Resolve() error=%v", err)
			}
			if snapshot.ResolvedCommit != wantCommit || snapshot.RefreshedAt == "" {
				t.Fatalf("snapshot commit/time=(%q, %q), want %q and timestamp", snapshot.ResolvedCommit, snapshot.RefreshedAt, wantCommit)
			}
			if got := []string{snapshot.SkillList[0].Name, snapshot.SkillList[1].Name}; !reflect.DeepEqual(got, []string{"alpha", "zeta"}) {
				t.Fatalf("catalog names=%v, want alpha,zeta", got)
			}
			if snapshot.SkillList[1].SkillPath != "skills/zeta/SKILL.md" || len(snapshot.SkillList[1].ContentSHA256) != 64 {
				t.Fatalf("zeta snapshot=%#v", snapshot.SkillList[1])
			}
			entries, err := os.ReadDir(temporaryRoot)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 0 {
				t.Fatalf("temporary resolver entries remain: %v", entries)
			}
		})
	}
}

func TestSkillSourceResolverDiscoversOnlyNestedSkillsDirectoryCatalog(t *testing.T) {
	checkout := t.TempDir()
	writeSkillSourceFixture(t, filepath.Join(checkout, "skills", "published"), "# Published\n", nil)
	writeSkillSourceFixture(t, filepath.Join(checkout, "skills", "groups", "deep", "nested"), "# Nested\n", map[string]string{
		"references/guide.md":         "guide\n",
		"references/example/SKILL.md": "# Supporting fixture\n",
	})
	for _, root := range []string{
		filepath.Join(checkout, ".agents", "skills", "installed-copy"),
		filepath.Join(checkout, ".claude", "skills", "installed-copy"),
		filepath.Join(checkout, ".github", "skills", "github-only"),
		filepath.Join(checkout, "skills-zh", "translated"),
		filepath.Join(checkout, "skills.bak", "backup"),
	} {
		writeSkillSourceFixture(t, root, "# Ignored\n", nil)
	}

	skills, err := discoverSkillSourceCatalog(checkout)
	if err != nil {
		t.Fatalf("discoverSkillSourceCatalog() error=%v", err)
	}
	if len(skills) != 2 {
		t.Fatalf("catalog=%#v, want exactly two skills", skills)
	}
	if got := []string{skills[0].Name, skills[1].Name}; !reflect.DeepEqual(got, []string{"nested", "published"}) {
		t.Fatalf("catalog names=%v, want nested,published", got)
	}
	if skills[0].SkillPath != "skills/groups/deep/nested/SKILL.md" {
		t.Fatalf("nested skill path=%q, want skills/groups/deep/nested/SKILL.md", skills[0].SkillPath)
	}
}

func TestSkillSourceResolverTreatsSkillsRootAsOneSkill(t *testing.T) {
	checkout := t.TempDir()
	writeSkillSourceFixture(t, filepath.Join(checkout, "skills"), "---\nname: catalog-root\n---\n# Root\n", nil)
	writeSkillSourceFixture(t, filepath.Join(checkout, "skills", "nested"), "# Must not be discovered\n", nil)

	skills, err := discoverSkillSourceCatalog(checkout)
	if err != nil {
		t.Fatalf("discoverSkillSourceCatalog() error=%v", err)
	}
	if len(skills) != 1 || skills[0].Name != "catalog-root" || skills[0].SkillPath != "skills/SKILL.md" {
		t.Fatalf("catalog=%#v, want only skills/SKILL.md", skills)
	}
}

func TestSkillSourceResolverRejectsMissingOrEmptySkillsDirectory(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		configure func(string)
		wantError string
	}{
		{name: "missing", configure: func(string) {}, wantError: "skills directory was not found"},
		{name: "empty", configure: func(checkout string) {
			if err := os.MkdirAll(filepath.Join(checkout, "skills", "docs"), 0o755); err != nil {
				t.Fatal(err)
			}
		}, wantError: "skills directory does not contain any skills"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			checkout := t.TempDir()
			testCase.configure(checkout)
			_, err := discoverSkillSourceCatalog(checkout)
			if err == nil || !strings.Contains(err.Error(), testCase.wantError) {
				t.Fatalf("discoverSkillSourceCatalog() error=%v, want %q", err, testCase.wantError)
			}
		})
	}
}

func TestSkillSourceResolverRejectsCaseInsensitiveDuplicateNamesWithRelativePaths(t *testing.T) {
	checkout := t.TempDir()
	writeSkillSourceFixture(t, filepath.Join(checkout, "skills", "one"), "---\nname: Shared\n---\n# One\n", nil)
	writeSkillSourceFixture(t, filepath.Join(checkout, "skills", "two"), "---\nname: shared\n---\n# Two\n", nil)

	_, err := discoverSkillSourceCatalog(checkout)
	if err == nil {
		t.Fatal("discoverSkillSourceCatalog() accepted duplicate names")
	}
	message := filepath.ToSlash(err.Error())
	for _, expected := range []string{`duplicate skill name "shared"`, "skills/one/SKILL.md", "skills/two/SKILL.md"} {
		if !strings.Contains(strings.ToLower(message), strings.ToLower(expected)) {
			t.Fatalf("error=%q, want relative conflict detail %q", message, expected)
		}
	}
	if strings.Contains(message, filepath.ToSlash(checkout)) {
		t.Fatalf("error leaks temporary checkout path: %q", message)
	}
}

func TestSkillSourceResolverTracksAdditionsDeletionsAndSupportingFiles(t *testing.T) {
	repository := t.TempDir()
	runSkillSourceGit(t, repository, "init", "-b", "main")
	runSkillSourceGit(t, repository, "config", "user.email", "skills@example.com")
	runSkillSourceGit(t, repository, "config", "user.name", "Skills Test")
	writeSkillSourceFixture(t, filepath.Join(repository, "skills", "first"), "# First\n", map[string]string{"guide.md": "one\n"})
	runSkillSourceGit(t, repository, "add", ".")
	runSkillSourceGit(t, repository, "commit", "-m", "first")

	resolver := newSkillSourceResolver(t.TempDir())
	before, err := resolver.Resolve(context.Background(), skillSourceSnapshot{Source: repository, SourceKey: "x/y"})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(repository, "skills", "first")); err != nil {
		t.Fatal(err)
	}
	writeSkillSourceFixture(t, filepath.Join(repository, "skills", "second"), "# Second\n", map[string]string{"guide.md": "two\n"})
	runSkillSourceGit(t, repository, "add", "-A")
	runSkillSourceGit(t, repository, "commit", "-m", "second")
	after, err := resolver.Resolve(context.Background(), skillSourceSnapshot{Source: repository, SourceKey: "x/y"})
	if err != nil {
		t.Fatal(err)
	}
	if len(before.SkillList) != 1 || before.SkillList[0].Name != "first" || len(after.SkillList) != 1 || after.SkillList[0].Name != "second" {
		t.Fatalf("before=%#v after=%#v", before.SkillList, after.SkillList)
	}
	if before.ResolvedCommit == after.ResolvedCommit {
		t.Fatal("branch movement did not resolve to a new immutable commit")
	}
}

func TestSkillSourceResolverCleansTemporaryCheckoutAfterFailure(t *testing.T) {
	repository := t.TempDir()
	runSkillSourceGit(t, repository, "init", "-b", "main")
	temporaryRoot := t.TempDir()
	resolver := newSkillSourceResolver(temporaryRoot)
	if _, err := resolver.Resolve(context.Background(), skillSourceSnapshot{
		Source: repository, SourceKey: "x/y",
	}); err == nil {
		t.Fatal("Resolve() succeeded for a repository without a resolvable HEAD")
	}
	entries, err := os.ReadDir(temporaryRoot)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("temporary resolver entries remain after failure: %v", entries)
	}
}

func runSkillSourceGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = dir
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, output)
	}
	return string(output)
}

func writeSkillSourceFixture(t *testing.T, root, skillMarkdown string, files map[string]string) {
	t.Helper()
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "SKILL.md"), []byte(skillMarkdown), 0o600); err != nil {
		t.Fatal(err)
	}
	for relativePath, content := range files {
		path := filepath.Join(root, filepath.FromSlash(relativePath))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSkillSourceRebuildsV1AndMissingLockWithoutRefs(t *testing.T) {
	root := t.TempDir()
	nativePath := filepath.Join(root, "skills-lock.json")
	native := []byte(`{
  "version": 1,
  "skills": {
	"alpha": {"source":"https://github.com/example/catalog.git","sourceUrl":"https://github.com/example/catalog.git","sourceType":"github","skillPath":"skills/alpha/SKILL.md"},
	"beta": {"source":"https://github.com/example/catalog","sourceType":"github","ref":"main","skillPath":"skills/beta/SKILL.md"},
	"gamma": {"source":"https://github.com/example/catalog.git","sourceType":"github","ref":"release","skillPath":"skills/gamma/SKILL.md"},
    "local-one": {"source":"../local-one","sourceType":"local"}
  }
}`)
	if err := os.WriteFile(nativePath, native, 0o600); err != nil {
		t.Fatal(err)
	}

	for _, testCase := range []struct {
		name string
		v1   string
	}{
		{name: "missing"},
		{name: "v1", v1: `{"version":1,"hashAlgorithm":"sha256-v1","sources":[{"source":"https://github.com/old/only.git","sourceKey":"github.com/old/only","ref":"v1.0.0","resolvedCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","refreshedAt":"2026-08-12T12:00:00Z","skillList":[]}]}`},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			sourcePath := filepath.Join(root, testCase.name+".skill-source-lock.json")
			if testCase.v1 != "" {
				if err := os.WriteFile(sourcePath, []byte(testCase.v1), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			result, err := readOrMigrateSkillSourceLock(nativePath, sourcePath)
			if err != nil {
				t.Fatalf("readOrMigrateSkillSourceLock() error=%v", err)
			}
			if !result.Migrated || result.Lock.Version != 2 || len(result.Lock.Sources) != 1 {
				t.Fatalf("rebuild result=%#v, want one V2 source", result)
			}
			source := result.Lock.Sources[0]
			if source.SourceKey != "github.com/example/catalog" || source.ResolvedCommit != "" || len(source.SkillList) != 0 {
				t.Fatalf("rebuilt source=%#v, want repository-only needs-refresh source", source)
			}
			if !reflect.DeepEqual(result.UnmanagedSkills, []string{"local-one"}) || len(result.NeedsResolutionSkills) != 0 {
				t.Fatalf("rebuild classifications=%#v", result)
			}
			raw, err := os.ReadFile(sourcePath)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Contains(raw, []byte(`"version": 2`)) || bytes.Contains(raw, []byte(`"ref"`)) {
				t.Fatalf("rebuilt lock is not ref-free V2:\n%s", raw)
			}
		})
	}
	afterNative, err := os.ReadFile(nativePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(afterNative, native) {
		t.Fatal("rebuild changed upstream native lock bytes")
	}
}

func TestSkillSourceRebuildFailurePreservesV1Bytes(t *testing.T) {
	root := t.TempDir()
	nativePath := filepath.Join(root, "skills-lock.json")
	sourcePath := filepath.Join(root, ".skill-source-lock.json")
	before := []byte(`{"version":1,"hashAlgorithm":"sha256-v1","sources":[{"source":"https://github.com/old/only.git","sourceKey":"github.com/old/only","ref":"main","skillList":[]}]}`)
	if err := os.WriteFile(sourcePath, before, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(nativePath, []byte(`{"version":1,"skills":`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readOrMigrateSkillSourceLock(nativePath, sourcePath); err == nil {
		t.Fatal("rebuild succeeded with malformed native lock")
	}
	after, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, before) {
		t.Fatalf("V1 bytes changed after failed rebuild:\nbefore=%s\nafter=%s", before, after)
	}
}

func TestSkillSourceCatalogReconcilesLiveDirectoryHashesAndRemovedUpstream(t *testing.T) {
	root := t.TempDir()
	alphaOne := filepath.Join(root, "agents", "alpha")
	alphaTwo := filepath.Join(root, "claude", "alpha")
	beta := filepath.Join(root, "agents", "beta")
	removed := filepath.Join(root, "agents", "removed")
	unmanaged := filepath.Join(root, "agents", "unmanaged")
	for _, dir := range []string{alphaOne, alphaTwo} {
		writeSkillSourceFixture(t, dir, "# Alpha\n", map[string]string{"guide.md": "same\n"})
	}
	writeSkillSourceFixture(t, beta, "# Beta local\n", nil)
	writeSkillSourceFixture(t, removed, "# Removed\n", nil)
	writeSkillSourceFixture(t, unmanaged, "# Unmanaged\n", nil)
	alphaHash, err := hashSkillDirectory(alphaOne)
	if err != nil {
		t.Fatal(err)
	}
	remoteBeta := filepath.Join(root, "remote-beta")
	writeSkillSourceFixture(t, remoteBeta, "# Beta remote\n", nil)
	betaHash, err := hashSkillDirectory(remoteBeta)
	if err != nil {
		t.Fatal(err)
	}
	deltaRemote := filepath.Join(root, "remote-delta")
	writeSkillSourceFixture(t, deltaRemote, "# Delta\n", nil)
	deltaHash, err := hashSkillDirectory(deltaRemote)
	if err != nil {
		t.Fatal(err)
	}
	lock := skillSourceLock{
		Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm,
		Sources: []skillSourceSnapshot{{
			Source: "https://github.com/example/catalog.git", SourceKey: "github.com/example/catalog",
			ResolvedCommit: strings.Repeat("a", 40), RefreshedAt: "2026-08-12T12:00:00Z",
			SkillList: []skillSourceSkillSnapshot{
				{Name: "alpha", SkillPath: "alpha/SKILL.md", ContentSHA256: alphaHash},
				{Name: "beta", SkillPath: "beta/SKILL.md", ContentSHA256: betaHash},
				{Name: "delta", SkillPath: "delta/SKILL.md", ContentSHA256: deltaHash},
			},
		}},
	}
	native := []nativeSkillSourceEntry{
		{Name: "alpha", Source: "https://github.com/example/catalog.git"},
		{Name: "beta", Source: "https://github.com/example/catalog.git"},
		{Name: "removed", Source: "https://github.com/example/catalog.git"},
	}
	installed := []skillSourceInstalledSnapshot{
		{Name: "alpha", Managed: true, Locations: []string{filepath.Join(alphaOne, "SKILL.md"), filepath.Join(alphaTwo, "SKILL.md")}},
		{Name: "beta", Managed: true, Locations: []string{filepath.Join(beta, "SKILL.md")}},
		{Name: "removed", Managed: true, Locations: []string{filepath.Join(removed, "SKILL.md")}},
		{Name: "unmanaged", Locations: []string{filepath.Join(unmanaged, "SKILL.md")}},
	}

	catalog := composeSkillSourceCatalog(lock, native, installed, nil)
	if len(catalog.Sources) != 1 || len(catalog.UnmanagedSkills) != 1 || catalog.UnmanagedSkills[0].Name != "unmanaged" || !catalog.UnmanagedSkills[0].CanUninstall {
		t.Fatalf("catalog groups=%#v", catalog)
	}
	rows := skillSourceRowsByName(catalog.Sources[0].Skills)
	if rows["alpha"].Status != "up_to_date" || rows["alpha"].CanUpdate {
		t.Fatalf("alpha row=%#v", rows["alpha"])
	}
	if rows["beta"].Status != "update_available" || !rows["beta"].CanUpdate || rows["beta"].LocalContentSHA256 == betaHash {
		t.Fatalf("beta row=%#v", rows["beta"])
	}
	if rows["delta"].Status != "uninstalled" || !rows["delta"].CanInstall || rows["delta"].Installed {
		t.Fatalf("delta row=%#v", rows["delta"])
	}
	if rows["removed"].Status != "removed_upstream" || !rows["removed"].CanUninstall || rows["removed"].CanUpdate {
		t.Fatalf("removed row=%#v", rows["removed"])
	}
}

func TestSkillSourceCatalogDistinguishesCopiesDifferAndNeedsRefresh(t *testing.T) {
	root := t.TempDir()
	first := filepath.Join(root, "agents", "alpha")
	second := filepath.Join(root, "claude", "alpha")
	writeSkillSourceFixture(t, first, "# Alpha one\n", nil)
	writeSkillSourceFixture(t, second, "# Alpha two\n", nil)
	remoteHash, err := hashSkillDirectory(first)
	if err != nil {
		t.Fatal(err)
	}
	native := []nativeSkillSourceEntry{{Name: "alpha", Source: "https://github.com/example/catalog.git"}}
	installed := []skillSourceInstalledSnapshot{{
		Name: "alpha", Managed: true,
		Locations: []string{filepath.Join(first, "SKILL.md"), filepath.Join(second, "SKILL.md")},
	}}
	ready := skillSourceLock{
		Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm,
		Sources: []skillSourceSnapshot{{
			Source: "https://github.com/example/catalog.git", SourceKey: "github.com/example/catalog",
			ResolvedCommit: strings.Repeat("a", 40), RefreshedAt: "2026-08-12T12:00:00Z",
			SkillList: []skillSourceSkillSnapshot{{Name: "alpha", SkillPath: "alpha/SKILL.md", ContentSHA256: remoteHash}},
		}},
	}
	row := composeSkillSourceCatalog(ready, native, installed, nil).Sources[0].Skills[0]
	if row.Status != "copies_differ" || !row.CanUpdate || row.Error != "" {
		t.Fatalf("ready row=%#v, want actionable copies_differ", row)
	}

	needsRefresh := skillSourceLock{
		Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm,
		Sources: []skillSourceSnapshot{{
			Source: "https://github.com/example/catalog.git", SourceKey: "github.com/example/catalog",
			SkillList: []skillSourceSkillSnapshot{},
		}},
	}
	view := composeSkillSourceCatalog(needsRefresh, native, installed, nil).Sources[0]
	if view.Status != "needs_refresh" || len(view.Skills) != 1 {
		t.Fatalf("needs-refresh source=%#v", view)
	}
	row = view.Skills[0]
	if row.Status != "needs_refresh" || row.CanUpdate || row.Error != "" {
		t.Fatalf("needs-refresh row=%#v, want non-error ownership row", row)
	}
}

func TestSkillSourceCatalogTreatsSymlinkedCopiesAsSameContent(t *testing.T) {
	root := t.TempDir()
	first := filepath.Join(root, "agents", "alpha")
	second := filepath.Join(root, "claude", "alpha")
	writeSkillSourceFixture(t, first, "# Alpha\n", nil)
	if err := os.MkdirAll(filepath.Dir(second), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(first, second); err != nil {
		if runtime.GOOS != "windows" {
			t.Skipf("directory symlinks are unavailable: %v", err)
		}
		if output, junctionErr := exec.Command("cmd.exe", "/c", "mklink", "/J", second, first).CombinedOutput(); junctionErr != nil {
			t.Skipf("directory links are unavailable: symlink=%v junction=%v (%s)", err, junctionErr, output)
		}
	}
	remoteHash, err := hashSkillDirectory(first)
	if err != nil {
		t.Fatal(err)
	}
	native := []nativeSkillSourceEntry{{Name: "alpha", Source: "https://github.com/example/catalog.git"}}
	installed := []skillSourceInstalledSnapshot{{
		Name: "alpha", Managed: true,
		Locations: []string{filepath.Join(first, "SKILL.md"), filepath.Join(second, "SKILL.md")},
	}}
	lock := skillSourceLock{
		Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm,
		Sources: []skillSourceSnapshot{{
			Source: "https://github.com/example/catalog.git", SourceKey: "github.com/example/catalog",
			ResolvedCommit: strings.Repeat("a", 40), RefreshedAt: "2026-08-12T12:00:00Z",
			SkillList: []skillSourceSkillSnapshot{{Name: "alpha", SkillPath: "alpha/SKILL.md", ContentSHA256: remoteHash}},
		}},
	}
	row := composeSkillSourceCatalog(lock, native, installed, nil).Sources[0].Skills[0]
	if row.Status != "up_to_date" || row.CanUpdate || row.Error != "" {
		t.Fatalf("symlinked copies row=%#v, want up_to_date", row)
	}
}

func TestSkillSourceCatalogBlocksEverySameNameSourceRow(t *testing.T) {
	local := filepath.Join(t.TempDir(), "shared")
	writeSkillSourceFixture(t, local, "# Shared\n", nil)
	hash, err := hashSkillDirectory(local)
	if err != nil {
		t.Fatal(err)
	}
	lock := skillSourceLock{Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm}
	for _, repository := range []string{"one", "two"} {
		lock.Sources = append(lock.Sources, skillSourceSnapshot{
			Source: "https://github.com/example/" + repository + ".git", SourceKey: "github.com/example/" + repository,
			ResolvedCommit: strings.Repeat(repository[:1], 40), RefreshedAt: "2026-08-12T12:00:00Z",
			SkillList: []skillSourceSkillSnapshot{{Name: "Shared", SkillPath: "Shared/SKILL.md", ContentSHA256: hash}},
		})
	}
	installed := []skillSourceInstalledSnapshot{{Name: "shared", Locations: []string{filepath.Join(local, "SKILL.md")}}}
	catalog := composeSkillSourceCatalog(lock, nil, installed, nil)
	for _, source := range catalog.Sources {
		row := source.Skills[0]
		if row.Status != "conflict" || !row.Conflict || row.CanInstall || row.CanUpdate || row.CanUninstall {
			t.Fatalf("conflicting row=%#v", row)
		}
	}
}

func TestSkillSourceCatalogRetainsStaleSnapshotWithoutInferringDeletion(t *testing.T) {
	local := filepath.Join(t.TempDir(), "removed")
	writeSkillSourceFixture(t, local, "# Removed\n", nil)
	lock := skillSourceLock{
		Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm,
		Sources: []skillSourceSnapshot{{
			Source: "https://github.com/example/catalog.git", SourceKey: "github.com/example/catalog",
			ResolvedCommit: strings.Repeat("a", 40), RefreshedAt: "2026-08-12T12:00:00Z", SkillList: []skillSourceSkillSnapshot{},
		}},
	}
	native := []nativeSkillSourceEntry{{Name: "removed", Source: "https://github.com/example/catalog.git"}}
	installed := []skillSourceInstalledSnapshot{{Name: "removed", Managed: true, Locations: []string{filepath.Join(local, "SKILL.md")}}}
	catalog := composeSkillSourceCatalog(lock, native, installed, map[string]string{"github.com/example/catalog": "fetch failed"})
	if catalog.Sources[0].Status != "stale" || catalog.Sources[0].Error != "fetch failed" {
		t.Fatalf("stale source=%#v", catalog.Sources[0])
	}
	if len(catalog.Sources[0].Skills) != 0 {
		t.Fatalf("stale source inferred removed rows: %#v", catalog.Sources[0].Skills)
	}
}

func TestSkillsCommandFailedRefreshPublishesStaleErrorWithoutChangingSavedCatalog(t *testing.T) {
	root := t.TempDir()
	globalLock := filepath.Join(root, ".skill-lock.json")
	sourceLockPath := filepath.Join(root, ".skill-source-lock.json")
	oldHash := strings.Repeat("a", 64)
	initial := skillSourceLock{
		Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm,
		Sources: []skillSourceSnapshot{{
			Source: "https://github.com/example/catalog.git", SourceKey: "github.com/example/catalog",
			ResolvedCommit: strings.Repeat("b", 40), RefreshedAt: "2026-08-12T12:00:00Z",
			SkillList: []skillSourceSkillSnapshot{{Name: "alpha", SkillPath: "skills/alpha/SKILL.md", ContentSHA256: oldHash}},
		}},
	}
	if _, err := writeSkillSourceLockFile(sourceLockPath, skillSourceMissingRevision, initial); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(sourceLockPath)
	if err != nil {
		t.Fatal(err)
	}
	cmd := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{
		HubID: "hub-a", GlobalLockPath: globalLock, HomeDir: filepath.Join(root, "home"),
		ResolveSource: func(context.Context, skillSourceSnapshot) (skillSourceSnapshot, error) {
			return skillSourceSnapshot{}, errors.New("fetch failed for https://github.com/example/catalog.git?token=secret")
		},
	})

	_, commandErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "previewSource", "hubId": "hub-a", "scope": "hub",
		"source": "https://github.com/example/catalog.git",
	}))
	if commandErr == nil {
		t.Fatal("previewSource error=nil, want resolver failure")
	}
	after, err := os.ReadFile(sourceLockPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("failed refresh changed the saved source lock")
	}
	errorsBySource := cmd.SkillSourceErrors("hub", "")
	message := errorsBySource["github.com/example/catalog"]
	if message == "" || strings.Contains(message, "token=secret") {
		t.Fatalf("stale error=%q, want sanitized resolver error", message)
	}
	snapshot, err := ScanSkillsSourceScope(context.Background(), SkillsSourceScopeInput{
		GlobalLockPath: globalLock,
		HomeDir:        filepath.Join(root, "home"),
		StaleErrors:    errorsBySource,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Sources) != 1 || snapshot.Sources[0].Status != "stale" || len(snapshot.Sources[0].Skills) != 1 {
		t.Fatalf("stale snapshot=%#v", snapshot)
	}
	row := snapshot.Sources[0].Skills[0]
	if row.Name != "alpha" || row.CanInstall || row.CanUpdate {
		t.Fatalf("stale catalog row=%#v", row)
	}
}

func skillSourceRowsByName(rows []skillsSourceCatalogSkillSnapshot) map[string]skillsSourceCatalogSkillSnapshot {
	out := make(map[string]skillsSourceCatalogSkillSnapshot, len(rows))
	for _, row := range rows {
		out[strings.ToLower(row.Name)] = row
	}
	return out
}

func TestSkillsCommandRejectsExplicitRefBeforePreview(t *testing.T) {
	root := t.TempDir()
	resolveCalls := 0
	cmd := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{
		HubID: "hub-a", GlobalLockPath: filepath.Join(root, ".skill-lock.json"), HomeDir: filepath.Join(root, "home"),
		ResolveSource: func(_ context.Context, source skillSourceSnapshot) (skillSourceSnapshot, error) {
			resolveCalls++
			source.ResolvedCommit = strings.Repeat("a", 40)
			source.RefreshedAt = "2026-08-12T12:00:00Z"
			source.SkillList = []skillSourceSkillSnapshot{}
			return source, nil
		},
	})
	testCases := []map[string]any{
		{"source": "example/catalog#next"},
		{"source": "https://github.com/example/catalog#v1.0.0"},
		{"source": "https://github.com/example/catalog/tree/release/skills/alpha"},
		{"source": "https://github.com/example/catalog.git", "ref": "release"},
	}
	for index, testCase := range testCases {
		payload := map[string]any{
			"action": "previewSource", "hubId": "hub-a", "scope": "hub",
		}
		for key, value := range testCase {
			payload[key] = value
		}
		if _, commandErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, payload)); commandErr == nil || commandErr.Code != rp.CodeInvalidArgument {
			t.Fatalf("case %d error=%#v, want invalid_argument", index, commandErr)
		}
	}
	if resolveCalls != 0 {
		t.Fatalf("explicit refs reached resolver %d time(s)", resolveCalls)
	}
	if _, err := os.Stat(filepath.Join(root, ".skill-source-lock.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("explicit ref preview wrote source lock: %v", err)
	}
}

func TestSkillsLockInstallGroupsIgnoreRef(t *testing.T) {
	path := filepath.Join(t.TempDir(), "skills-lock.json")
	raw := `{"version":1,"skills":{"alpha":{"source":"https://github.com/example/catalog.git","ref":"main"},"beta":{"source":"https://github.com/example/catalog.git","ref":"release"}}}`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	groups := readSkillsLockInstallGroups(path)
	if len(groups) != 1 || groups[0].Source != "https://github.com/example/catalog.git" || !reflect.DeepEqual(groups[0].Skills, []string{"alpha", "beta"}) {
		t.Fatalf("install groups=%#v, want one repository-only group", groups)
	}
}

func TestSkillsCommandSourcePreviewAndApplySavesCatalogWithoutInstalling(t *testing.T) {
	root := t.TempDir()
	globalLock := filepath.Join(root, ".skill-lock.json")
	remoteHash := strings.Repeat("a", 64)
	resolveCalls := 0
	runner := newFakeSkillsRunner()
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID: "hub-a", GlobalLockPath: globalLock, HomeDir: filepath.Join(root, "home"),
		ResolveSource: func(_ context.Context, source skillSourceSnapshot) (skillSourceSnapshot, error) {
			resolveCalls++
			source.ResolvedCommit = strings.Repeat("b", 40)
			source.RefreshedAt = "2026-08-12T12:00:00Z"
			source.SkillList = []skillSourceSkillSnapshot{{Name: "alpha", SkillPath: "skills/alpha/SKILL.md", ContentSHA256: remoteHash}}
			return source, nil
		},
	})

	response, commandErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "previewSource", "hubId": "hub-a", "scope": "hub",
		"source": "https://github.com/example/catalog.git",
	}))
	if commandErr != nil {
		t.Fatalf("previewSource error=%#v", commandErr)
	}
	preview := response.(skillsCommandResponse).Preview
	if preview == nil || preview.ID == "" || preview.ResolvedCommit != strings.Repeat("b", 40) || len(preview.SkillList) != 1 {
		t.Fatalf("preview=%#v", preview)
	}
	previewJSON, err := json.Marshal(preview)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(previewJSON, []byte(`"ref"`)) {
		t.Fatalf("preview contains logical ref: %s", previewJSON)
	}
	bootstrap, _, err := readSkillSourceLockFile(filepath.Join(root, ".skill-source-lock.json"))
	if err != nil || len(bootstrap.Sources) != 0 {
		t.Fatalf("preview persisted candidate source before confirmation: lock=%#v err=%v", bootstrap, err)
	}

	_, commandErr = cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "applyPreview", "hubId": "hub-a", "previewId": preview.ID,
	}))
	if commandErr != nil {
		t.Fatalf("applyPreview error=%#v", commandErr)
	}
	operation := waitForSkillsOperationDone(t, cmd)
	if operation.Status != "succeeded" || resolveCalls != 1 {
		t.Fatalf("operation=%#v resolveCalls=%d", operation, resolveCalls)
	}
	lock, _, err := readSkillSourceLockFile(filepath.Join(root, ".skill-source-lock.json"))
	if err != nil || len(lock.Sources) != 1 || lock.Sources[0].ResolvedCommit != strings.Repeat("b", 40) {
		t.Fatalf("saved lock=%#v error=%v", lock, err)
	}
	for _, call := range runner.calls {
		if slices.Contains(call.Args, "add") {
			t.Fatalf("bare source unexpectedly installed a skill: %#v", runner.calls)
		}
	}
}

func TestSkillsCommandPreviewInstallUsesResolvedSourceAndExplicitSkills(t *testing.T) {
	root := t.TempDir()
	globalLock := filepath.Join(root, ".skill-lock.json")
	sourceLockPath := filepath.Join(root, ".skill-source-lock.json")
	initial := skillSourceLock{
		Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm,
		Sources: []skillSourceSnapshot{{
			Source: "https://github.com/example/catalog.git", SourceKey: "github.com/example/catalog", SkillList: []skillSourceSkillSnapshot{},
		}},
	}
	if _, err := writeSkillSourceLockFile(sourceLockPath, skillSourceMissingRevision, initial); err != nil {
		t.Fatal(err)
	}
	runner := newFakeSkillsRunner()
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID: "hub-a", GlobalLockPath: globalLock, HomeDir: filepath.Join(root, "home"),
		ResolveSource: func(_ context.Context, source skillSourceSnapshot) (skillSourceSnapshot, error) {
			source.ResolvedCommit = strings.Repeat("c", 40)
			source.RefreshedAt = "2026-08-12T12:00:00Z"
			source.SkillList = []skillSourceSkillSnapshot{
				{Name: "alpha", SkillPath: "skills/alpha/SKILL.md", ContentSHA256: strings.Repeat("a", 64)},
				{Name: "new-skill", SkillPath: "skills/new-skill/SKILL.md", ContentSHA256: strings.Repeat("d", 64)},
			}
			return source, nil
		},
	})

	response, commandErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "previewInstall", "hubId": "hub-a", "scope": "hub",
		"source": "https://github.com/example/catalog.git", "skills": []string{"alpha"},
	}))
	if commandErr != nil {
		t.Fatalf("previewInstall error=%#v", commandErr)
	}
	preview := response.(skillsCommandResponse).Preview
	if preview == nil || !reflect.DeepEqual(preview.Skills, []string{"alpha"}) || len(preview.SkillList) != 2 {
		t.Fatalf("preview=%#v", preview)
	}
	_, commandErr = cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "applyPreview", "hubId": "hub-a", "previewId": preview.ID,
	}))
	if commandErr != nil {
		t.Fatalf("applyPreview error=%#v", commandErr)
	}
	operation := waitForSkillsOperationDone(t, cmd)
	if operation.Status != "succeeded" {
		t.Fatalf("operation=%#v", operation)
	}
	pinnedSource := "https://github.com/example/catalog.git"
	if !runner.hasCall("", "skills", "add", pinnedSource, "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "alpha", "-y") {
		t.Fatalf("pinned install call missing: %#v", runner.calls)
	}
	if runner.hasCall("", "skills", "add", pinnedSource, "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "alpha", "new-skill", "-y") {
		t.Fatalf("explicit install included an unselected catalog skill: %#v", runner.calls)
	}
}

func TestSkillsCommandPreviewUpdateAllSelectsOnlyInstalledChangedSkills(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	globalLock := filepath.Join(root, ".skill-lock.json")
	sourceLockPath := filepath.Join(root, ".skill-source-lock.json")
	for _, name := range []string{"alpha", "removed"} {
		for _, profile := range []string{".agents", ".claude"} {
			writeSkillSourceFixture(t, filepath.Join(home, profile, "skills", name), "# "+name+" local\n", nil)
		}
	}
	native := `{"version":1,"skills":{"alpha":{"source":"https://github.com/example/catalog.git","sourceType":"github","ref":"main"},"removed":{"source":"https://github.com/example/catalog.git","sourceType":"github","ref":"main"}}}`
	if err := os.WriteFile(globalLock, []byte(native), 0o600); err != nil {
		t.Fatal(err)
	}
	initial := skillSourceLock{
		Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm,
		Sources: []skillSourceSnapshot{{Source: "https://github.com/example/catalog.git", SourceKey: "github.com/example/catalog"}},
	}
	if _, err := writeSkillSourceLockFile(sourceLockPath, skillSourceMissingRevision, initial); err != nil {
		t.Fatal(err)
	}
	remoteRoot := filepath.Join(root, "remote-alpha")
	writeSkillSourceFixture(t, remoteRoot, "# alpha remote\n", nil)
	remoteHash, err := hashSkillDirectory(remoteRoot)
	if err != nil {
		t.Fatal(err)
	}
	runner := newFakeSkillsRunner()
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID: "hub-a", GlobalLockPath: globalLock, HomeDir: home,
		ResolveSource: func(_ context.Context, source skillSourceSnapshot) (skillSourceSnapshot, error) {
			source.ResolvedCommit = strings.Repeat("e", 40)
			source.RefreshedAt = "2026-08-12T12:00:00Z"
			source.SkillList = []skillSourceSkillSnapshot{
				{Name: "alpha", SkillPath: "alpha/SKILL.md", ContentSHA256: remoteHash},
				{Name: "new-skill", SkillPath: "new-skill/SKILL.md", ContentSHA256: strings.Repeat("f", 64)},
			}
			return source, nil
		},
	})

	response, commandErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "previewUpdate", "hubId": "hub-a", "scope": "hub",
		"source": "https://github.com/example/catalog.git",
	}))
	if commandErr != nil {
		t.Fatalf("previewUpdate error=%#v", commandErr)
	}
	preview := response.(skillsCommandResponse).Preview
	if preview == nil || !reflect.DeepEqual(preview.Skills, []string{"alpha"}) || !preview.OverwritesLocal {
		t.Fatalf("preview=%#v, want alpha-only overwrite", preview)
	}
	_, commandErr = cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "applyPreview", "hubId": "hub-a", "previewId": preview.ID,
	}))
	if commandErr != nil {
		t.Fatal(commandErr)
	}
	operation := waitForSkillsOperationDone(t, cmd)
	if operation.Status != "succeeded" {
		t.Fatalf("operation=%#v", operation)
	}
	results := map[string]skillsOperationItemResult{}
	for _, result := range operation.Results {
		results[result.Skill] = result
	}
	if results["alpha"].Status != "succeeded" || results["new-skill"].Status != "skipped" || results["removed"].Status != "skipped" {
		t.Fatalf("itemized update results=%#v", operation.Results)
	}
	pinnedSource := "https://github.com/example/catalog.git"
	if !runner.hasCall("", "skills", "add", pinnedSource, "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "alpha", "-y") {
		t.Fatalf("alpha update missing: %#v", runner.calls)
	}
	for _, forbidden := range []string{"new-skill", "removed"} {
		for _, call := range runner.calls {
			if slices.Contains(call.Args, forbidden) {
				t.Fatalf("update all included %q: %#v", forbidden, runner.calls)
			}
		}
	}
}

func TestSkillsCommandPreviewUpdateContinuesAfterItemFailure(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	globalLock := filepath.Join(root, ".skill-lock.json")
	sourceLockPath := filepath.Join(root, ".skill-source-lock.json")
	for _, name := range []string{"alpha", "beta"} {
		for _, profile := range []string{".agents", ".claude"} {
			writeSkillSourceFixture(t, filepath.Join(home, profile, "skills", name), "# local "+name+"\n", nil)
		}
	}
	if err := os.WriteFile(globalLock, []byte(`{"version":1,"skills":{"alpha":{"source":"https://github.com/example/catalog.git","ref":"main"},"beta":{"source":"https://github.com/example/catalog.git","ref":"main"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	initial := skillSourceLock{Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm, Sources: []skillSourceSnapshot{{
		Source: "https://github.com/example/catalog.git", SourceKey: "github.com/example/catalog",
	}}}
	if _, err := writeSkillSourceLockFile(sourceLockPath, skillSourceMissingRevision, initial); err != nil {
		t.Fatal(err)
	}
	resolvedCommit := strings.Repeat("a", 40)
	pinnedSource := "https://github.com/example/catalog.git"
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"add", pinnedSource, "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "alpha", "-y"}, skillsCommandResult{ExitCode: 1, Stderr: "alpha failed"})
	runner.set("", "npx", []string{"--yes", "skills@1.5.18", "add", pinnedSource, "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "alpha", "-y"}, skillsCommandResult{ExitCode: 1, Stderr: "alpha failed"})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID: "hub-a", GlobalLockPath: globalLock, HomeDir: home,
		ResolveSource: func(_ context.Context, source skillSourceSnapshot) (skillSourceSnapshot, error) {
			source.ResolvedCommit = resolvedCommit
			source.RefreshedAt = "2026-08-12T12:00:00Z"
			source.SkillList = []skillSourceSkillSnapshot{
				{Name: "alpha", SkillPath: "alpha/SKILL.md", ContentSHA256: strings.Repeat("1", 64)},
				{Name: "beta", SkillPath: "beta/SKILL.md", ContentSHA256: strings.Repeat("2", 64)},
			}
			return source, nil
		},
	})
	response, commandErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "previewUpdate", "hubId": "hub-a", "scope": "hub",
		"source": "https://github.com/example/catalog.git",
	}))
	if commandErr != nil {
		t.Fatal(commandErr)
	}
	preview := response.(skillsCommandResponse).Preview
	_, commandErr = cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "applyPreview", "hubId": "hub-a", "previewId": preview.ID,
	}))
	if commandErr != nil {
		t.Fatal(commandErr)
	}
	operation := waitForSkillsOperationDone(t, cmd)
	if operation.Status != "partial" || len(operation.Results) != 2 || operation.Results[0].Status != "failed" || operation.Results[1].Status != "succeeded" {
		t.Fatalf("operation=%#v", operation)
	}
	if !runner.hasCall("", "skills", "add", pinnedSource, "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "beta", "-y") {
		t.Fatalf("beta did not continue after alpha failure: %#v", runner.calls)
	}
}

func TestSkillsCommandPreviewUpdateAllContinuesAfterSourceRefreshFailure(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	globalLock := filepath.Join(root, ".skill-lock.json")
	sourceLockPath := filepath.Join(root, ".skill-source-lock.json")
	for _, name := range []string{"alpha", "beta"} {
		for _, profile := range []string{".agents", ".claude"} {
			writeSkillSourceFixture(t, filepath.Join(home, profile, "skills", name), "# local "+name+"\n", nil)
		}
	}
	if err := os.WriteFile(globalLock, []byte(`{"version":1,"skills":{"alpha":{"source":"https://github.com/example/bad.git","ref":"main"},"beta":{"source":"https://github.com/example/good.git","ref":"main"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	initial := skillSourceLock{Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm, Sources: []skillSourceSnapshot{
		{
			Source: "https://github.com/example/bad.git", SourceKey: "github.com/example/bad",
			ResolvedCommit: strings.Repeat("a", 40), RefreshedAt: "2026-08-12T10:00:00Z",
			SkillList: []skillSourceSkillSnapshot{{Name: "alpha", SkillPath: "alpha/SKILL.md", ContentSHA256: strings.Repeat("1", 64)}},
		},
		{
			Source: "https://github.com/example/good.git", SourceKey: "github.com/example/good",
			ResolvedCommit: strings.Repeat("b", 40), RefreshedAt: "2026-08-12T10:00:00Z",
			SkillList: []skillSourceSkillSnapshot{{Name: "beta", SkillPath: "beta/SKILL.md", ContentSHA256: strings.Repeat("2", 64)}},
		},
	}}
	if _, err := writeSkillSourceLockFile(sourceLockPath, skillSourceMissingRevision, initial); err != nil {
		t.Fatal(err)
	}
	goodCommit := strings.Repeat("c", 40)
	runner := newFakeSkillsRunner()
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID: "hub-a", GlobalLockPath: globalLock, HomeDir: home,
		ResolveSource: func(_ context.Context, source skillSourceSnapshot) (skillSourceSnapshot, error) {
			if strings.Contains(source.SourceKey, "/bad") {
				return skillSourceSnapshot{}, errors.New("fetch failed")
			}
			source.ResolvedCommit = goodCommit
			source.RefreshedAt = "2026-08-12T12:00:00Z"
			source.SkillList = []skillSourceSkillSnapshot{{
				Name: "beta", SkillPath: "beta/SKILL.md", ContentSHA256: strings.Repeat("f", 64),
			}}
			return source, nil
		},
	})

	response, commandErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "previewUpdate", "hubId": "hub-a", "scope": "hub",
	}))
	if commandErr != nil {
		t.Fatalf("previewUpdate error=%#v", commandErr)
	}
	preview := response.(skillsCommandResponse).Preview
	if preview == nil || !reflect.DeepEqual(preview.Skills, []string{"beta"}) {
		t.Fatalf("preview=%#v", preview)
	}
	_, commandErr = cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "applyPreview", "hubId": "hub-a", "previewId": preview.ID,
	}))
	if commandErr != nil {
		t.Fatal(commandErr)
	}
	operation := waitForSkillsOperationDone(t, cmd)
	results := map[string]skillsOperationItemResult{}
	for _, result := range operation.Results {
		results[result.Skill] = result
	}
	if operation.Status != "succeeded" || results["alpha"].Status != "skipped" || results["beta"].Status != "succeeded" {
		t.Fatalf("best-effort source results=%#v operation=%#v", operation.Results, operation)
	}
	if !runner.hasCall("", "skills", "add", "https://github.com/example/good.git", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "beta", "-y") {
		t.Fatalf("good source update missing: %#v", runner.calls)
	}
	if message := cmd.SkillSourceErrors("hub", "")["github.com/example/bad"]; message == "" {
		t.Fatal("failed source was not retained as stale")
	}
}

func TestSkillUpdateNonActionResultReportsConflict(t *testing.T) {
	result, include := skillUpdateNonActionResult(SkillsSourceCatalogSkillSnapshot{
		Name: "shared", Status: "conflict", Conflict: true, Error: "Same name exists in multiple sources.",
	})
	if !include || result.Status != "conflict" || result.ErrorSummary == "" {
		t.Fatalf("conflict result=%#v include=%t", result, include)
	}
}

func TestSkillsCommandPreviewDeleteRemovesInstalledSkillsBeforeSource(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	globalLock := filepath.Join(root, ".skill-lock.json")
	sourceLockPath := filepath.Join(root, ".skill-source-lock.json")
	if err := os.WriteFile(globalLock, []byte(`{"version":1,"skills":{"alpha":{"source":"https://github.com/example/catalog.git","ref":"main"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	initial := skillSourceLock{Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm, Sources: []skillSourceSnapshot{{
		Source: "https://github.com/example/catalog.git", SourceKey: "github.com/example/catalog",
	}}}
	if _, err := writeSkillSourceLockFile(sourceLockPath, skillSourceMissingRevision, initial); err != nil {
		t.Fatal(err)
	}
	for _, directory := range []string{
		filepath.Join(home, ".agents", "skills", "alpha"),
		filepath.Join(home, ".claude", "skills", "alpha"),
	} {
		writeSkillSourceFixture(t, directory, "# Alpha\n", nil)
	}
	runner := newFakeSkillsRunner()
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a", GlobalLockPath: globalLock, HomeDir: home})
	response, commandErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "previewDeleteSource", "hubId": "hub-a", "scope": "hub",
		"source": "https://github.com/example/catalog.git",
	}))
	if commandErr != nil {
		t.Fatal(commandErr)
	}
	preview := response.(skillsCommandResponse).Preview
	if preview == nil || !reflect.DeepEqual(preview.Skills, []string{"alpha"}) {
		t.Fatalf("preview=%#v", preview)
	}
	_, commandErr = cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "applyPreview", "hubId": "hub-a", "previewId": preview.ID,
	}))
	if commandErr != nil {
		t.Fatal(commandErr)
	}
	operation := waitForSkillsOperationDone(t, cmd)
	if operation.Status != "succeeded" || len(operation.Results) != 1 || operation.Results[0].Skill != "alpha" {
		t.Fatalf("operation=%#v", operation)
	}
	for _, directory := range []string{
		filepath.Join(home, ".agents", "skills", "alpha"),
		filepath.Join(home, ".claude", "skills", "alpha"),
	} {
		if _, err := os.Lstat(directory); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("source skill directory %s still exists, err=%v", directory, err)
		}
	}
	if runner.hasCall("", "skills", "remove", "-g", "--skill", "alpha", "--agent", "codex", "claude-code", "opencode", "github-copilot", "-y") {
		t.Fatalf("source skill uninstall should remove managed directories directly: %#v", runner.calls)
	}
	if entries := readNativeSkillSourceEntries(globalLock); len(entries) != 0 {
		t.Fatalf("native skill lock retained removed source skill: %#v", entries)
	}
	lock, _, err := readSkillSourceLockFile(sourceLockPath)
	if err != nil || len(lock.Sources) != 0 {
		t.Fatalf("source retained after successful uninstall: %#v err=%v", lock, err)
	}
}

func TestSkillsCommandPreviewInstallRejectsUnmanagedSameNameConflict(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	globalLock := filepath.Join(root, ".skill-lock.json")
	if err := os.WriteFile(globalLock, []byte(`{"version":1,"skills":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	writeSkillSourceFixture(t, filepath.Join(home, ".agents", "skills", "shared"), "# unmanaged shared\n", nil)
	cmd := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{
		HubID: "hub-a", GlobalLockPath: globalLock, HomeDir: home,
		ResolveSource: func(_ context.Context, source skillSourceSnapshot) (skillSourceSnapshot, error) {
			source.ResolvedCommit = strings.Repeat("a", 40)
			source.RefreshedAt = "2026-08-12T12:00:00Z"
			source.SkillList = []skillSourceSkillSnapshot{{
				Name: "shared", SkillPath: "shared/SKILL.md", ContentSHA256: strings.Repeat("b", 64),
			}}
			return source, nil
		},
	})
	_, commandErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "previewInstall", "hubId": "hub-a", "scope": "hub",
		"source": "https://github.com/example/catalog.git", "skills": []string{"shared"},
	}))
	if commandErr == nil || commandErr.Code != rp.CodeConflict {
		t.Fatalf("previewInstall error=%#v, want conflict", commandErr)
	}
}

func TestSkillSourceCatalogRestoresPendingRemovalFromLocalReconciliation(t *testing.T) {
	projectRoot := t.TempDir()
	nativePath := filepath.Join(projectRoot, "skills-lock.json")
	sourcePath := filepath.Join(projectRoot, ".skill-source-lock.json")
	reconciliationPath := filepath.Join(t.TempDir(), "project-skills.json")
	if err := os.WriteFile(nativePath, []byte(`{"version":1,"skills":{"alpha":{"source":"https://github.com/example/catalog.git","ref":"main"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	writeSkillSourceFixture(t, filepath.Join(projectRoot, ".agents", "skills", "alpha"), "# Alpha\n", nil)
	initial := skillSourceLock{Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm, Sources: []skillSourceSnapshot{{
		Source: "https://github.com/example/catalog.git", SourceKey: "github.com/example/catalog",
	}}}
	revision, err := writeSkillSourceLockFile(sourcePath, skillSourceMissingRevision, initial)
	if err != nil || revision == "" {
		t.Fatal(err)
	}
	input := SkillsSourceScopeInput{
		ProjectRoot: projectRoot, ReconciliationPath: reconciliationPath,
		Installed: []SkillsInstalledSkillSnapshot{{
			Name: "alpha", Managed: true, Locations: []string{filepath.Join(projectRoot, ".agents", "skills", "alpha", "SKILL.md")},
		}},
	}
	first, err := ScanSkillsSourceScope(context.Background(), input)
	if err != nil || len(first.Sources) != 1 {
		t.Fatalf("initial scan=%#v err=%v", first, err)
	}
	empty := newSkillSourceLock()
	if _, err := writeSkillSourceLockFile(sourcePath, revision, empty); err != nil {
		t.Fatal(err)
	}
	second, err := ScanSkillsSourceScope(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Sources) != 1 || second.Sources[0].Status != "pending_removal" || len(second.Sources[0].Skills) != 1 || !second.Sources[0].Skills[0].CanUninstall {
		t.Fatalf("pending removal snapshot=%#v", second)
	}
	if err := os.WriteFile(nativePath, []byte(`{"version":1,"skills":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	third, err := ScanSkillsSourceScope(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if len(third.Sources) != 0 {
		t.Fatalf("resolved pending removal retained: %#v", third.Sources)
	}
}

func TestSkillSourceCatalogTreatsDeletedProjectSourceLockAsPendingRemovalAfterReconciliation(t *testing.T) {
	projectRoot := t.TempDir()
	nativePath := filepath.Join(projectRoot, "skills-lock.json")
	sourcePath := filepath.Join(projectRoot, ".skill-source-lock.json")
	reconciliationPath := filepath.Join(t.TempDir(), "project-skills.json")
	if err := os.WriteFile(nativePath, []byte(`{"version":1,"skills":{"alpha":{"source":"https://github.com/example/catalog.git","ref":"main"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	writeSkillSourceFixture(t, filepath.Join(projectRoot, ".agents", "skills", "alpha"), "# Alpha\n", nil)
	initial := skillSourceLock{Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm, Sources: []skillSourceSnapshot{{
		Source: "https://github.com/example/catalog.git", SourceKey: "github.com/example/catalog",
	}}}
	if _, err := writeSkillSourceLockFile(sourcePath, skillSourceMissingRevision, initial); err != nil {
		t.Fatal(err)
	}
	input := SkillsSourceScopeInput{
		ProjectRoot: projectRoot, ReconciliationPath: reconciliationPath,
		Installed: []SkillsInstalledSkillSnapshot{{
			Name: "alpha", Managed: true, Locations: []string{filepath.Join(projectRoot, ".agents", "skills", "alpha", "SKILL.md")},
		}},
	}
	if _, err := ScanSkillsSourceScope(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	reconciliation, err := os.ReadFile(reconciliationPath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(reconciliation, []byte(`"ref"`)) {
		t.Fatalf("reconciliation contains logical ref: %s", reconciliation)
	}
	if err := os.Remove(sourcePath); err != nil {
		t.Fatal(err)
	}

	snapshot, err := ScanSkillsSourceScope(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Sources) != 1 || snapshot.Sources[0].Status != "pending_removal" {
		t.Fatalf("deleted source lock snapshot=%#v", snapshot)
	}
	if _, err := os.Stat(sourcePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("scan recreated an externally deleted source lock: %v", err)
	}
}

func TestSkillsCommandPreviewDeleteHandlesExternallyRemovedProjectSource(t *testing.T) {
	projectRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(projectRoot, "skills-lock.json"), []byte(`{"version":1,"skills":{"alpha":{"source":"https://github.com/example/catalog.git","ref":"main"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := writeSkillSourceLockFile(filepath.Join(projectRoot, ".skill-source-lock.json"), skillSourceMissingRevision, newSkillSourceLock()); err != nil {
		t.Fatal(err)
	}
	cmd := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{
		HubID: "hub-a", Projects: []ProjectInfo{{Name: "project", Path: projectRoot}},
	})
	response, commandErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "previewDeleteSource", "hubId": "hub-a", "scope": "project", "projectName": "project",
		"source": "https://github.com/example/catalog.git",
	}))
	if commandErr != nil {
		t.Fatalf("previewDeleteSource error=%#v", commandErr)
	}
	preview := response.(skillsCommandResponse).Preview
	if preview == nil || !reflect.DeepEqual(preview.Skills, []string{"alpha"}) {
		t.Fatalf("preview=%#v", preview)
	}
}
