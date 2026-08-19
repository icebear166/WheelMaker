package tools

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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
	deadline := time.Now().Add(30 * time.Second)
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
	for i := 0; i < 1000; i++ {
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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

func TestSkillsCommandReplacesMismatchedGlobalCLIWithPinnedFallback(t *testing.T) {
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a", HomeDir: t.TempDir()})

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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	t.Skip("replaced by native repository management")
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
	canonicalHome := t.TempDir()
	if got, want := skillSourceLockPath("", upstreamLock, canonicalHome), filepath.Join(canonicalHome, ".wheelmaker", "skills", ".skill-source-lock.json"); got != want {
		t.Fatalf("global lock path=%q, want %q", got, want)
	}
}

func TestSkillSourceLockPathUsesXDGThenAgentsHome(t *testing.T) {
	xdg := t.TempDir()
	home := t.TempDir()
	t.Setenv("XDG_STATE_HOME", xdg)
	if got, want := skillSourceLockPath("", "", home), filepath.Join(home, ".wheelmaker", "skills", ".skill-source-lock.json"); got != want {
		t.Fatalf("xdg lock path=%q, want %q", got, want)
	}

	t.Setenv("XDG_STATE_HOME", "")
	if got, want := skillSourceLockPath("", "", home), filepath.Join(home, ".wheelmaker", "skills", ".skill-source-lock.json"); got != want {
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
				Source:        "https://github.com/example/b.git",
				SourceKey:     "github.com/example/b",
				Commit:        strings.Repeat("b", 40),
				UpdatedAt:     "2026-08-12T12:00:00Z",
				ManagedSkills: []string{"z-skill", "a-skill"},
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
	if !bytes.Contains(raw, []byte(`"version": 3`)) || bytes.Contains(raw, []byte(`"skillList"`)) || bytes.Contains(raw, []byte(`"resolvedCommit"`)) {
		t.Fatalf("source lock is not V3:\n%s", raw)
	}
	loaded, loadedRevision, err := readSkillSourceLockFile(path)
	if err != nil {
		t.Fatalf("readSkillSourceLockFile() error=%v", err)
	}
	if loadedRevision != revision || len(loaded.Sources) != 2 || loaded.Sources[0].SourceKey != "github.com/example/a" || loaded.Sources[1].Commit != strings.Repeat("b", 40) {
		t.Fatalf("loaded=%#v revision=%q, want sorted lock revision %q", loaded, loadedRevision, revision)
	}
}

func TestSkillSourceStoreRejectsUnknownVersionAndDuplicateSource(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".skill-source-lock.json")
	invalidValues := []string{
		`{"version":4,"sources":[]}`,
		`{"version":3,"sources":[{"source":"https://github.com/a/b.git","sourceKey":"github.com/a/b"},{"source":"git@github.com:a/b.git","sourceKey":"github.com/a/b"}]}`,
		`{"version":3,"sources":[]} {}`,
		`{"version":3,"sources":[{"source":"https://github.com/a/b.git","sourceKey":"github.com/a/b","ref":"main"}]}`,
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

func TestSkillSourceResolverIgnoresSkillsRootSkill(t *testing.T) {
	checkout := t.TempDir()
	writeSkillSourceFixture(t, filepath.Join(checkout, "skills"), "---\nname: catalog-root\n---\n# Root\n", nil)
	writeSkillSourceFixture(t, filepath.Join(checkout, "skills", "nested"), "# Must not be discovered\n", nil)

	skills, err := discoverSkillSourceCatalog(checkout)
	if err != nil {
		t.Fatalf("discoverSkillSourceCatalog() error=%v", err)
	}
	if len(skills) != 1 || skills[0].Name != "nested" || skills[0].SkillPath != "skills/nested/SKILL.md" {
		t.Fatalf("catalog=%#v, want nested skill with repository-level skills/SKILL.md ignored", skills)
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

func TestSkillSourceRebuildsUnsupportedOrMissingLockAsEmptyV3(t *testing.T) {
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
			wantMigrated := testCase.v1 != ""
			if result.Migrated != wantMigrated || result.Lock.Version != 3 || len(result.Lock.Sources) != 0 {
				t.Fatalf("rebuild result=%#v, want empty V3 lock with migrated=%t", result, wantMigrated)
			}
			if len(result.UnmanagedSkills) != 0 || len(result.NeedsResolutionSkills) != 0 {
				t.Fatalf("rebuild classifications=%#v", result)
			}
			if !wantMigrated {
				if _, err := os.Stat(sourcePath); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("missing source lock was created: %v", err)
				}
				return
			}
			raw, err := os.ReadFile(sourcePath)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Contains(raw, []byte(`"version": 3`)) || bytes.Contains(raw, []byte(`"ref"`)) {
				t.Fatalf("rebuilt lock is not V3:\n%s", raw)
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

func TestSkillSourceRebuildFailurePreservesMalformedLockBytes(t *testing.T) {
	root := t.TempDir()
	nativePath := filepath.Join(root, "skills-lock.json")
	sourcePath := filepath.Join(root, ".skill-source-lock.json")
	before := []byte(`{"version":3,"sources":[]} {}`)
	if err := os.WriteFile(sourcePath, before, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(nativePath, []byte(`{"version":1,"skills":{}}`), 0o600); err != nil {
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
			ManagedSkills: []string{"alpha", "beta", "delta", "removed"},
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
	if rows["beta"].Status != "update_available" || rows["beta"].CanUpdate || rows["beta"].LocalContentSHA256 == betaHash {
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
	if row.Status != "copies_differ" || row.CanUpdate || row.Error != "" {
		t.Fatalf("ready row=%#v, want copies_differ without skill-level update", row)
	}

	needsRefresh := skillSourceLock{
		Version: skillSourceLockVersion, HashAlgorithm: skillSourceHashAlgorithm,
		Sources: []skillSourceSnapshot{{
			Source: "https://github.com/example/catalog.git", SourceKey: "github.com/example/catalog",
			ManagedSkills: []string{"alpha"},
			SkillList:     []skillSourceSkillSnapshot{},
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

func TestSkillSourceCatalogAllowsInstallingCachedUninstalledSkillsWhileNeedsRefresh(t *testing.T) {
	installedPath := filepath.Join(t.TempDir(), "installed")
	writeSkillSourceFixture(t, installedPath, "# installed\n", nil)
	lock := skillSourceLock{
		Version: skillSourceLockVersion,
		Sources: []skillSourceSnapshot{{
			Source:        "https://github.com/example/catalog.git",
			SourceKey:     "github.com/example/catalog",
			ManagedSkills: []string{"installed"},
			SkillList: []skillSourceSkillSnapshot{
				{Name: "installed", SkillPath: "skills/installed/SKILL.md"},
				{Name: "cached-new", SkillPath: "skills/cached-new/SKILL.md"},
			},
		}},
	}
	catalog := composeSkillSourceCatalog(lock, nil, []skillSourceInstalledSnapshot{{
		Name: "installed", Managed: true, Locations: []string{filepath.Join(installedPath, "SKILL.md")},
	}}, nil)
	if catalog.Sources[0].Status != "needs_refresh" {
		t.Fatalf("source status=%q, want needs_refresh", catalog.Sources[0].Status)
	}
	rows := skillSourceRowsByName(catalog.Sources[0].Skills)
	if rows["cached-new"].Status != "uninstalled" || !rows["cached-new"].CanInstall {
		t.Fatalf("cached uninstalled row=%#v, want installable", rows["cached-new"])
	}
	if rows["installed"].CanInstall {
		t.Fatalf("installed row=%#v, want non-installable", rows["installed"])
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

func TestSkillSourceCatalogTreatsJunctionChildCopiesAsSameContent(t *testing.T) {
	root := t.TempDir()
	targetRoot := filepath.Join(root, "agents", "skills")
	linkedRoot := filepath.Join(root, "claude", "skills")
	first := filepath.Join(targetRoot, "alpha")
	linked := filepath.Join(linkedRoot, "alpha")
	writeSkillSourceFixture(t, first, "# Alpha\n", nil)
	if err := os.MkdirAll(filepath.Dir(linkedRoot), 0o755); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("cmd.exe", "/c", "mklink", "/J", linkedRoot, targetRoot).CombinedOutput(); err != nil {
		t.Skipf("directory junctions are unavailable: %v (%s)", err, output)
	}

	remoteHash, err := hashSkillDirectory(first)
	if err != nil {
		t.Fatal(err)
	}
	native := []nativeSkillSourceEntry{{Name: "alpha", Source: "https://github.com/example/catalog.git"}}
	installed := []skillSourceInstalledSnapshot{{
		Name: "alpha", Managed: true,
		Locations: []string{filepath.Join(linked, "SKILL.md")},
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
		t.Fatalf("junction child row=%#v, want up_to_date", row)
	}
}

func TestSkillSourceCatalogUsesLastSuccessfulOwnerForSameName(t *testing.T) {
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
	if len(catalog.Sources) != 2 {
		t.Fatalf("sources=%#v", catalog.Sources)
	}
	first := catalog.Sources[0].Skills[0]
	second := catalog.Sources[1].Skills[0]
	if first.Installed || first.Managed || first.Conflict || !first.CanInstall {
		t.Fatalf("first same-name row=%#v", first)
	}
	if !second.Installed || !second.Managed || second.Conflict || second.CanInstall || !second.CanUninstall {
		t.Fatalf("last-owner same-name row=%#v", second)
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
	t.Skip("replaced by native fetch-only refresh")
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
	t.Skip("replaced by native repository actions")
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
	t.Skip("preview/apply actions were removed in 2.0")
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
	t.Skip("preview/apply actions were removed in 2.0")
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
	t.Skip("preview/apply actions were removed in 2.0")
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
	t.Skip("preview/apply actions were removed in 2.0")
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
	t.Skip("preview/apply actions were removed in 2.0")
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
	t.Skip("skill-level update/conflict blocking was removed in 2.0")
	result, include := skillUpdateNonActionResult(SkillsSourceCatalogSkillSnapshot{
		Name: "shared", Status: "conflict", Conflict: true, Error: "Same name exists in multiple sources.",
	})
	if !include || result.Status != "conflict" || result.ErrorSummary == "" {
		t.Fatalf("conflict result=%#v include=%t", result, include)
	}
}

func TestSkillsCommandPreviewDeleteRemovesInstalledSkillsBeforeSource(t *testing.T) {
	t.Skip("preview/apply actions were removed in 2.0")
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
	t.Skip("same-name conflict blocking was removed in 2.0")
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
	t.Skip("reconciliation state was removed in 2.0")
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
	t.Skip("reconciliation state was removed in 2.0")
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
	t.Skip("preview/apply actions were removed in 2.0")
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

func TestNativeSkillSourceRejectsSSHPassword(t *testing.T) {
	if _, _, err := normalizeSkillGitSource("ssh://deploy:secret@example.com/owner/repo.git"); err == nil {
		t.Fatal("normalizeSkillGitSource() accepted an SSH password")
	}
}

func TestNativeSkillSourceStoreInspectFetchesExistingClone(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "first")
	store := newSkillSourceStore(filepath.Join(t.TempDir(), "home"))
	source := skillSourceSnapshot{Source: repository, SourceKey: "local/example"}
	first, err := store.ensureRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("ensureRepo() error=%v", err)
	}
	appendSkillSourceGitCommit(t, repository, "second")

	inspected, err := store.inspectRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("inspectRepo() error=%v", err)
	}
	if inspected.RemoteCommit == "" || inspected.RemoteCommit == first.Commit {
		t.Fatalf("inspectRepo() remote commit=%q, want newer commit than %q", inspected.RemoteCommit, first.Commit)
	}
}

func TestNativeSkillSourceStoreKeepsSourceLockWhileConsumingCheckout(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "first")
	store := newSkillSourceStore(filepath.Join(t.TempDir(), "home"))
	source := skillSourceSnapshot{Source: repository, SourceKey: "local/example"}
	if _, err := store.ensureRepo(context.Background(), source); err != nil {
		t.Fatalf("ensureRepo() error=%v", err)
	}

	entered := make(chan struct{})
	release := make(chan struct{})
	firstDone := make(chan error, 1)
	go func() {
		firstDone <- store.withEnsuredRepo(context.Background(), source, func(checkout skillSourceCheckout) error {
			if checkout.Commit == "" {
				return errors.New("checkout commit is empty")
			}
			close(entered)
			<-release
			return nil
		})
	}()
	<-entered

	secondDone := make(chan error, 1)
	go func() {
		_, err := store.updateRepo(context.Background(), source)
		secondDone <- err
	}()
	select {
	case err := <-secondDone:
		t.Fatalf("updateRepo() completed while checkout was being consumed: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(release)
	if err := <-firstDone; err != nil {
		t.Fatalf("withEnsuredRepo() error=%v", err)
	}
	if err := <-secondDone; err != nil {
		t.Fatalf("updateRepo() error=%v", err)
	}
}

func TestNativeSkillSourceStoreRefreshUsesRemoteDefaultBranch(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "main-skill")
	runSkillSourceGit(t, repository, "checkout", "-b", "develop")
	writeSkillSourceFixture(t, filepath.Join(repository, "skills", "develop-skill"), "# develop\n", nil)
	runSkillSourceGit(t, repository, "add", "-A")
	runSkillSourceGit(t, repository, "commit", "-m", "develop")
	runSkillSourceGit(t, repository, "checkout", "main")

	store := newSkillSourceStore(filepath.Join(t.TempDir(), "home"))
	source := skillSourceSnapshot{Source: repository, SourceKey: "local/example"}
	checkout, err := store.ensureRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("ensureRepo() error=%v", err)
	}
	// Keep the clone's cached origin/HEAD stale after changing the remote HEAD.
	runSkillSourceGit(t, checkout.Path, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
	runSkillSourceGit(t, repository, "symbolic-ref", "HEAD", "refs/heads/develop")

	refreshed, err := store.refreshRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("refreshRepo() error=%v", err)
	}
	if refreshed.Branch != "develop" {
		t.Fatalf("refreshRepo() branch=%q, want develop", refreshed.Branch)
	}
	if refreshed.RemoteCommit == "" {
		t.Fatal("refreshRepo() returned an empty remote commit")
	}
}

func TestNativeInstalledNamesIncludeDirectoryLinks(t *testing.T) {
	home := t.TempDir()
	source := filepath.Join(t.TempDir(), "alpha")
	writeSkillSourceFixture(t, source, "# alpha\n", nil)
	link := filepath.Join(home, ".agents", "skills", "alpha")
	if err := createSkillDirectoryLink(source, link); err != nil {
		t.Skipf("directory links unavailable: %v", err)
	}
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	names, err := command.nativeInstalledNames(skillsCommandTarget{scope: "hub"})
	if err != nil {
		t.Fatalf("nativeInstalledNames() error=%v", err)
	}
	if _, ok := names["alpha"]; !ok {
		t.Fatalf("nativeInstalledNames()=%#v, want linked alpha", names)
	}
}

func TestNativeSkillTargetPathRejectsManagedRootSymlink(t *testing.T) {
	managedRoot := filepath.Join(t.TempDir(), "skills")
	outside := t.TempDir()
	if err := os.Symlink(outside, managedRoot); err != nil {
		t.Skipf("directory symlinks unavailable: %v", err)
	}
	if _, err := nativeSkillTargetPath(managedRoot, "alpha"); err == nil {
		t.Fatal("nativeSkillTargetPath() accepted a managed root symlink")
	}
}

func TestNativeGlobalV2MigrationMaterializesCentralLinks(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "alpha")
	home := t.TempDir()
	key := "github.com/example/skills"
	store := newSkillSourceStore(home)
	clonePath := store.repositoryPath(key)
	os.MkdirAll(filepath.Dir(clonePath), 0o755)
	runSkillSourceGit(t, filepath.Dir(clonePath), "clone", "--quiet", repository, clonePath)

	legacyPath := filepath.Join(home, ".agents", ".skill-source-lock.json")
	writeLegacySkillSourceLock(t, legacyPath, "https://github.com/example/skills.git", key, "alpha")
	for _, root := range []string{".agents/skills/alpha", ".claude/skills/alpha"} {
		writeSkillSourceFixture(t, filepath.Join(home, filepath.FromSlash(root)), "# legacy\n", nil)
	}

	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	target := skillsCommandTarget{scope: "hub"}
	var migrated skillSourceLock
	err := command.withNativeScopeLock(target, func() error {
		var err error
		migrated, _, err = command.readNativeScopeLock(context.Background(), target)
		return err
	})
	if err != nil {
		t.Fatalf("readNativeScopeLock() migration error=%v", err)
	}
	if len(migrated.Sources) != 1 || len(migrated.Sources[0].ManagedSkills) != 1 {
		t.Fatalf("migrated lock=%#v", migrated)
	}
	centralSkill := filepath.Join(clonePath, "skills", "alpha")
	centralInfo, err := os.Stat(centralSkill)
	if err != nil {
		t.Fatalf("stat central skill: %v", err)
	}
	for _, root := range []string{".agents/skills/alpha", ".claude/skills/alpha"} {
		installedInfo, err := os.Stat(filepath.Join(home, filepath.FromSlash(root)))
		if err != nil {
			t.Fatalf("stat migrated skill %s: %v", root, err)
		}
		if !os.SameFile(installedInfo, centralInfo) {
			t.Fatalf("migrated skill %s does not resolve to central checkout", root)
		}
	}
}

func TestNativeGlobalV2MigrationFailureLeavesCanonicalLockAndTargetsUnchanged(t *testing.T) {
	home := t.TempDir()
	legacyPath := filepath.Join(home, ".agents", ".skill-source-lock.json")
	writeLegacySkillSourceLock(t, legacyPath, "https://example.invalid/missing/skills.git", "example.invalid/missing/skills", "alpha")
	for _, root := range []string{".agents/skills/alpha", ".claude/skills/alpha"} {
		writeSkillSourceFixture(t, filepath.Join(home, filepath.FromSlash(root)), "# legacy\n", nil)
	}
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	target := skillsCommandTarget{scope: "hub"}
	err := command.withNativeScopeLock(target, func() error {
		_, _, err := command.readNativeScopeLock(context.Background(), target)
		return err
	})
	if err == nil {
		t.Fatal("readNativeScopeLock() unexpectedly migrated a source whose clone failed")
	}
	if _, statErr := os.Stat(command.sourceLockFile(target)); !os.IsNotExist(statErr) {
		t.Fatalf("canonical lock exists after failed migration: %v", statErr)
	}
	for _, root := range []string{".agents/skills/alpha", ".claude/skills/alpha"} {
		info, statErr := os.Stat(filepath.Join(home, filepath.FromSlash(root)))
		if statErr != nil || !info.IsDir() {
			t.Fatalf("migration failure changed target %s: info=%#v err=%v", root, info, statErr)
		}
	}
}

func TestNativeAddRepoDoesNotAdvanceProjectLockWithoutSynchronizingCopies(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "alpha")
	home := t.TempDir()
	project := t.TempDir()
	key := "github.com/example/skills"
	store := newSkillSourceStore(home)
	clonePath := store.repositoryPath(key)
	os.MkdirAll(filepath.Dir(clonePath), 0o755)
	runSkillSourceGit(t, filepath.Dir(clonePath), "clone", "--quiet", repository, clonePath)

	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{
		HubID: "hub-a", HomeDir: home, Projects: []ProjectInfo{{Name: "project", Path: project}},
	})
	target := skillsCommandTarget{scope: "project", projectName: "project", dir: project}
	source := "https://github.com/example/skills.git"
	if err := command.nativeAddRepo(context.Background(), target, source, key); err != nil {
		t.Fatalf("initial nativeAddRepo() error=%v", err)
	}
	if err := command.nativeInstall(context.Background(), target, source, []string{"alpha"}, false); err != nil {
		t.Fatalf("nativeInstall() error=%v", err)
	}
	lockPath := command.sourceLockFile(target)
	firstLock, _, err := readSkillSourceLockFile(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	writeSkillSourceFixture(t, filepath.Join(repository, "skills", "alpha"), "# alpha v2\n", nil)
	runSkillSourceGit(t, repository, "add", "-A")
	runSkillSourceGit(t, repository, "commit", "-m", "alpha v2")
	if _, err := command.nativeStore().updateRepo(context.Background(), skillSourceSnapshot{Source: source, SourceKey: key}); err != nil {
		t.Fatalf("central updateRepo() error=%v", err)
	}
	if err := command.nativeAddRepo(context.Background(), target, source, key); err != nil {
		t.Fatalf("duplicate nativeAddRepo() error=%v", err)
	}
	secondLock, _, err := readSkillSourceLockFile(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	if secondLock.Sources[0].Commit != firstLock.Sources[0].Commit {
		t.Fatalf("duplicate Add Repo advanced project commit from %s to %s without copying", firstLock.Sources[0].Commit, secondLock.Sources[0].Commit)
	}
	raw, err := os.ReadFile(filepath.Join(project, ".agents", "skills", "alpha", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(raw)) != "# alpha" {
		t.Fatalf("project copy changed during duplicate Add Repo: %q", raw)
	}
}

func TestSkillsCommandScopeUpdateProcessesEveryRepository(t *testing.T) {
	firstRepository := t.TempDir()
	secondRepository := t.TempDir()
	initSkillSourceGitFixture(t, firstRepository, "alpha")
	initSkillSourceGitFixture(t, secondRepository, "beta")
	home := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	target := skillsCommandTarget{scope: "hub"}
	firstSource := "https://github.com/example/first.git"
	secondSource := "https://github.com/example/second.git"
	seedNativeSkillSourceClone(t, command, firstRepository, firstSource, "github.com/example/first")
	seedNativeSkillSourceClone(t, command, secondRepository, secondSource, "github.com/example/second")
	appendSkillSourceGitCommit(t, firstRepository, "alpha-new")
	appendSkillSourceGitCommit(t, secondRepository, "beta-new")
	lock := skillSourceLock{Version: 3, Sources: []skillSourceSnapshot{
		{Source: firstSource, SourceKey: "github.com/example/first", ManagedSkills: []string{}},
		{Source: secondSource, SourceKey: "github.com/example/second", ManagedSkills: []string{}},
	}}
	if _, err := writeSkillSourceLockFile(command.sourceLockFile(target), skillSourceMissingRevision, lock); err != nil {
		t.Fatal(err)
	}

	response, cmdErr := command.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "updateScope",
		"hubId":  "hub-a",
		"scope":  "hub",
	}))
	if cmdErr != nil {
		t.Fatalf("scope update error: %#v", cmdErr)
	}
	if body := response.(skillsCommandResponse); !body.OK || !body.Accepted {
		t.Fatalf("response=%#v, want accepted scope update", body)
	}
	operation := waitForSkillsOperationDone(t, command)
	if operation.Status != "succeeded" || len(operation.Results) != 2 {
		t.Fatalf("operation=%#v, want two successful source results", operation)
	}
	for _, result := range operation.Results {
		if result.Status != "succeeded" || result.Action != "update" {
			t.Fatalf("source result=%#v, want successful update", result)
		}
	}
	updated, _, err := readSkillSourceLockFile(command.sourceLockFile(target))
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range updated.Sources {
		if source.Commit == "" {
			t.Fatalf("source=%#v has no updated commit", source)
		}
	}
}

func TestSkillsCommandScopeUpdateContinuesAfterSourceFailure(t *testing.T) {
	workingRepository := t.TempDir()
	initSkillSourceGitFixture(t, workingRepository, "alpha")
	home := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	target := skillsCommandTarget{scope: "hub"}
	workingSource := "https://github.com/example/working.git"
	missingSource := "https://github.com/example/missing.git"
	seedNativeSkillSourceClone(t, command, workingRepository, workingSource, "github.com/example/working")
	if err := os.MkdirAll(command.nativeStore().repositoryPath("github.com/example/missing"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := writeSkillSourceLockFile(command.sourceLockFile(target), skillSourceMissingRevision, skillSourceLock{
		Version: 3,
		Sources: []skillSourceSnapshot{
			{Source: workingSource, SourceKey: "github.com/example/working"},
			{Source: missingSource, SourceKey: "github.com/example/missing"},
		},
	}); err != nil {
		t.Fatal(err)
	}

	response, cmdErr := command.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "updateScope",
		"hubId":  "hub-a",
		"scope":  "hub",
	}))
	if cmdErr != nil {
		t.Fatalf("scope update error: %#v", cmdErr)
	}
	if body := response.(skillsCommandResponse); !body.OK || !body.Accepted {
		t.Fatalf("response=%#v, want accepted scope update", body)
	}
	operation := waitForSkillsOperationDone(t, command)
	if operation.Status != "partial" || len(operation.Results) != 2 {
		t.Fatalf("operation=%#v, want partial results for both sources", operation)
	}
	statuses := map[string]string{}
	for _, result := range operation.Results {
		statuses[result.Skill] = result.Status
	}
	if statuses["github.com/example/working"] != "succeeded" || statuses["github.com/example/missing"] != "failed" {
		t.Fatalf("source statuses=%#v, want working succeeded and missing failed", statuses)
	}
	if _, err := os.Stat(command.nativeStore().repositoryPath("github.com/example/working")); err != nil {
		t.Fatalf("successful source was not processed: %v", err)
	}
}

func TestSkillsCommandScopeInstallAllUpdatesBeforeInstalling(t *testing.T) {
	firstRepository := t.TempDir()
	secondRepository := t.TempDir()
	initSkillSourceGitFixture(t, firstRepository, "alpha")
	initSkillSourceGitFixture(t, secondRepository, "beta")
	projectRoot := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{
		HubID: "hub-a", HomeDir: t.TempDir(), Projects: []ProjectInfo{{Name: "project", Path: projectRoot}},
	})
	target := skillsCommandTarget{scope: "project", projectName: "project", dir: projectRoot}
	firstSource := "https://github.com/example/first.git"
	secondSource := "https://github.com/example/second.git"
	firstInitial := seedNativeSkillSourceClone(t, command, firstRepository, firstSource, "github.com/example/first")
	secondInitial := seedNativeSkillSourceClone(t, command, secondRepository, secondSource, "github.com/example/second")
	if _, err := writeSkillSourceLockFile(command.sourceLockFile(target), skillSourceMissingRevision, skillSourceLock{
		Version: 3,
		Sources: []skillSourceSnapshot{
			{Source: firstSource, SourceKey: "github.com/example/first", Commit: firstInitial, UpdatedAt: "2026-08-19T00:00:00Z"},
			{Source: secondSource, SourceKey: "github.com/example/second", Commit: secondInitial, UpdatedAt: "2026-08-19T00:00:00Z"},
		},
	}); err != nil {
		t.Fatal(err)
	}
	appendSkillSourceGitCommit(t, firstRepository, "new-alpha")
	appendSkillSourceGitCommit(t, secondRepository, "new-beta")

	response, cmdErr := command.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action":      "installAllScope",
		"hubId":       "hub-a",
		"scope":       "project",
		"projectName": "project",
	}))
	if cmdErr != nil {
		t.Fatalf("scope install all error: %#v", cmdErr)
	}
	if body := response.(skillsCommandResponse); !body.OK || !body.Accepted {
		t.Fatalf("response=%#v, want accepted scope install all", body)
	}
	operation := waitForSkillsOperationDone(t, command)
	if operation.Status != "succeeded" || len(operation.Results) != 2 {
		t.Fatalf("operation=%#v, want two successful install results", operation)
	}
	lock, _, err := readSkillSourceLockFile(command.sourceLockFile(target))
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range lock.Sources {
		if source.Commit == firstInitial || source.Commit == secondInitial {
			t.Fatalf("source=%#v did not advance before install", source)
		}
	}
	for _, root := range []string{".agents/skills/new-alpha", ".claude/skills/new-alpha", ".agents/skills/new-beta", ".claude/skills/new-beta"} {
		if _, err := os.Stat(filepath.Join(projectRoot, filepath.FromSlash(root), "SKILL.md")); err != nil {
			t.Fatalf("latest Skill copy %s missing: %v", root, err)
		}
	}
}

func TestSkillsCommandScopeInstallAllSkipsFailedSource(t *testing.T) {
	workingRepository := t.TempDir()
	initSkillSourceGitFixture(t, workingRepository, "alpha")
	projectRoot := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{
		HubID: "hub-a", HomeDir: t.TempDir(), Projects: []ProjectInfo{{Name: "project", Path: projectRoot}},
	})
	target := skillsCommandTarget{scope: "project", projectName: "project", dir: projectRoot}
	workingSource := "https://github.com/example/working.git"
	missingSource := "https://github.com/example/missing.git"
	seedNativeSkillSourceClone(t, command, workingRepository, workingSource, "github.com/example/working")
	if err := os.MkdirAll(command.nativeStore().repositoryPath("github.com/example/missing"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := writeSkillSourceLockFile(command.sourceLockFile(target), skillSourceMissingRevision, skillSourceLock{
		Version: 3,
		Sources: []skillSourceSnapshot{
			{Source: workingSource, SourceKey: "github.com/example/working"},
			{Source: missingSource, SourceKey: "github.com/example/missing"},
		},
	}); err != nil {
		t.Fatal(err)
	}

	response, cmdErr := command.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action":      "installAllScope",
		"hubId":       "hub-a",
		"scope":       "project",
		"projectName": "project",
	}))
	if cmdErr != nil {
		t.Fatalf("scope install all error: %#v", cmdErr)
	}
	if body := response.(skillsCommandResponse); !body.OK || !body.Accepted {
		t.Fatalf("response=%#v, want accepted scope install all", body)
	}
	operation := waitForSkillsOperationDone(t, command)
	if operation.Status != "partial" || len(operation.Results) != 2 {
		t.Fatalf("operation=%#v, want partial results for both sources", operation)
	}
	statuses := map[string]string{}
	for _, result := range operation.Results {
		statuses[result.Skill] = result.Status
	}
	if statuses["github.com/example/working"] != "succeeded" || statuses["github.com/example/missing"] != "failed" {
		t.Fatalf("source statuses=%#v, want working succeeded and missing failed", statuses)
	}
	if _, err := os.Stat(filepath.Join(projectRoot, ".agents", "skills", "alpha", "SKILL.md")); err != nil {
		t.Fatalf("successful source was not installed: %v", err)
	}
}

func TestSkillsOperationsHaveUniqueIDsAtSecondResolution(t *testing.T) {
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a"})
	fixed := time.Date(2026, 8, 18, 12, 0, 0, 0, time.UTC)
	command.now = func() time.Time { return fixed }
	payload := skillsCommandPayload{Action: "install", HubID: "hub-a", Scope: "hub"}
	first, err := command.acceptOperation(payload)
	if err != nil {
		t.Fatal(err)
	}
	command.finishOperation(first, "succeeded", nil, "", "")
	second, err := command.acceptOperation(payload)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == "" || second.ID == "" || first.ID == second.ID {
		t.Fatalf("operation IDs=%q,%q, want unique non-empty IDs", first.ID, second.ID)
	}
}

func TestNativeDirectoryTransactionRollbackReportsFailure(t *testing.T) {
	transaction := &nativeDirectoryTransaction{items: []nativeStagedChange{{
		nativeDirectoryChange: nativeDirectoryChange{Final: filepath.Join(t.TempDir(), "final")},
		Backup:                filepath.Join(t.TempDir(), "missing-backup"),
		HadExist:              true,
	}}}
	if err := transaction.Rollback(); err == nil {
		t.Fatal("Rollback() returned nil after failing to restore a missing backup")
	}
}

func writeLegacySkillSourceLock(t *testing.T, path, source, sourceKey, skillName string) {
	t.Helper()
	legacy := skillSourceLockV2Wire{
		Version:       2,
		HashAlgorithm: skillSourceHashAlgorithm,
		Sources: []skillSourceSnapshotV2Wire{{
			Source: source, SourceKey: sourceKey, ResolvedCommit: strings.Repeat("a", 40),
			RefreshedAt: "2026-08-18T12:00:00Z", SkillList: []skillSourceSkillSnapshot{{Name: skillName}},
		}},
	}
	raw, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(raw, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
}

func seedNativeSkillSourceClone(t *testing.T, command *SkillsCommand, repository, source, sourceKey string) string {
	t.Helper()
	clonePath := command.nativeStore().repositoryPath(sourceKey)
	if err := os.MkdirAll(filepath.Dir(clonePath), 0o755); err != nil {
		t.Fatal(err)
	}
	runSkillSourceGit(t, filepath.Dir(clonePath), "clone", "--quiet", repository, clonePath)
	checkout, err := command.nativeStore().ensureRepo(context.Background(), skillSourceSnapshot{Source: source, SourceKey: sourceKey})
	if err != nil {
		t.Fatalf("seed source %s: %v", source, err)
	}
	return checkout.Commit
}

func TestNativeSkillSourceLockWritesV3ManagedSkillsWithoutLegacyFields(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".skill-source-lock.json")
	lock := skillSourceLock{
		Version: 3,
		Sources: []skillSourceSnapshot{{
			Source:        "https://github.com/example/skills.git",
			SourceKey:     "github.com/example/skills",
			Branch:        "main",
			Commit:        strings.Repeat("a", 40),
			UpdatedAt:     "2026-08-18T12:00:00Z",
			ManagedSkills: []string{"zeta", "alpha"},
		}},
	}

	if _, err := writeSkillSourceLockFile(path, skillSourceMissingRevision, lock); err != nil {
		t.Fatalf("writeSkillSourceLockFile() error=%v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"version": 3`)) ||
		!bytes.Contains(raw, []byte(`"commit": "`+strings.Repeat("a", 40)+`"`)) ||
		!bytes.Contains(raw, []byte(`"managedSkills"`)) {
		t.Fatalf("raw lock=%s, want v3 fields", raw)
	}
	for _, legacy := range []string{"hashAlgorithm", "resolvedCommit", "refreshedAt", "skillList", "contentSha256"} {
		if bytes.Contains(raw, []byte(`"`+legacy+`"`)) {
			t.Fatalf("raw lock contains legacy field %q: %s", legacy, raw)
		}
	}
	loaded, _, err := readSkillSourceLockFile(path)
	if err != nil {
		t.Fatalf("readSkillSourceLockFile() error=%v", err)
	}
	if loaded.Sources[0].Commit != strings.Repeat("a", 40) || len(loaded.Sources[0].ManagedSkills) != 2 {
		t.Fatalf("loaded=%#v", loaded)
	}
}

func TestNativeSkillsCommandUninstallRemovesExplicitExternalSkillWithoutCreatingLock(t *testing.T) {
	home := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	target := skillsCommandTarget{scope: "hub"}
	for _, root := range []string{".agents/skills/local", ".claude/skills/local"} {
		writeSkillSourceFixture(t, filepath.Join(home, filepath.FromSlash(root)), "# local\n", nil)
	}

	if err := command.nativeUninstall(context.Background(), target, "", []string{"local"}); err != nil {
		t.Fatalf("nativeUninstall() error=%v", err)
	}
	for _, root := range []string{".agents/skills/local", ".claude/skills/local"} {
		if _, err := os.Stat(filepath.Join(home, filepath.FromSlash(root))); !os.IsNotExist(err) {
			t.Fatalf("external skill %s still exists, err=%v", root, err)
		}
	}
	if _, err := os.Stat(filepath.Join(home, ".wheelmaker", "skills", ".skill-source-lock.json")); !os.IsNotExist(err) {
		t.Fatalf("external uninstall created a source lock: %v", err)
	}
}

func TestNativeSkillSourceLockMigrationUsesOnlyLegacyListAndInstalledNames(t *testing.T) {
	legacy := skillSourceLock{
		Version:       2,
		HashAlgorithm: skillSourceHashAlgorithm,
		Sources: []skillSourceSnapshot{{
			Source:         "https://github.com/example/skills.git",
			SourceKey:      "github.com/example/skills",
			ResolvedCommit: strings.Repeat("b", 40),
			RefreshedAt:    "2026-08-18T12:00:00Z",
			SkillList: []skillSourceSkillSnapshot{
				{Name: "alpha"},
				{Name: "not-installed"},
			},
		}},
	}
	migrated, err := migrateSkillSourceLockToV3(legacy, map[string]struct{}{"alpha": {}, "external": {}})
	if err != nil {
		t.Fatalf("migrateSkillSourceLockToV3() error=%v", err)
	}
	if migrated.Version != 3 || migrated.Sources[0].Commit != strings.Repeat("b", 40) || migrated.Sources[0].UpdatedAt != legacy.Sources[0].RefreshedAt {
		t.Fatalf("migrated=%#v", migrated)
	}
	if got := migrated.Sources[0].ManagedSkills; len(got) != 1 || got[0] != "alpha" {
		t.Fatalf("managedSkills=%v, want only installed legacy skill", got)
	}
}

func TestNativeSkillSourceStoreRefreshFetchesWithoutChangingCheckout(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "first")
	store := newSkillSourceStore(filepath.Join(t.TempDir(), "home"))
	source := skillSourceSnapshot{Source: repository, SourceKey: "local/example"}
	first, err := store.ensureRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("ensureRepo() error=%v", err)
	}
	appendSkillSourceGitCommit(t, repository, "second")
	refreshed, err := store.refreshRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("refreshRepo() error=%v", err)
	}
	if refreshed.Commit != first.Commit {
		t.Fatalf("refresh changed checkout commit from %s to %s", first.Commit, refreshed.Commit)
	}
	if refreshed.RemoteCommit == "" || refreshed.RemoteCommit == first.Commit {
		t.Fatalf("refresh remote commit=%q, want newer remote SHA", refreshed.RemoteCommit)
	}
	updated, err := store.updateRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("updateRepo() error=%v", err)
	}
	if updated.Commit != refreshed.RemoteCommit {
		t.Fatalf("updated commit=%s, want remote %s", updated.Commit, refreshed.RemoteCommit)
	}
}

func TestNativeSkillSourceStoreEnsureLatestRepoClonesMissingRepository(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "alpha")
	store := newSkillSourceStore(filepath.Join(t.TempDir(), "home"))

	checkout, err := store.ensureLatestRepo(context.Background(), skillSourceSnapshot{
		Source: repository, SourceKey: "local/example",
	})
	if err != nil {
		t.Fatalf("ensureLatestRepo() error=%v", err)
	}
	if checkout.Commit == "" || checkout.Branch != "main" {
		t.Fatalf("checkout=%#v, want main branch and commit", checkout)
	}
	if len(checkout.Skills) != 1 || checkout.Skills[0].Name != "alpha" {
		t.Fatalf("checkout skills=%#v, want alpha", checkout.Skills)
	}
	if _, err := os.Stat(store.repositoryPath("local/example")); err != nil {
		t.Fatalf("latest clone missing: %v", err)
	}
}

func TestNativeSkillSourceStoreEnsureLatestRepoFetchesAndChecksOutRemoteHead(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "alpha")
	store := newSkillSourceStore(filepath.Join(t.TempDir(), "home"))
	source := skillSourceSnapshot{Source: repository, SourceKey: "local/example"}
	first, err := store.ensureLatestRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("first ensureLatestRepo() error=%v", err)
	}
	appendSkillSourceGitCommit(t, repository, "beta")

	latest, err := store.ensureLatestRepo(context.Background(), source)
	if err != nil {
		t.Fatalf("second ensureLatestRepo() error=%v", err)
	}
	if latest.Commit == first.Commit {
		t.Fatalf("latest commit=%s, want a new commit after remote advance", latest.Commit)
	}
	if latest.Branch != "main" || len(latest.Skills) != 2 {
		t.Fatalf("latest checkout=%#v, want main with alpha and beta", latest)
	}
}

func TestNativeInstallUpdatesRepositoryBeforeInstalling(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "alpha")
	home := t.TempDir()
	projectRoot := t.TempDir()
	store := newSkillSourceStore(home)
	key := "github.com/example/skills"
	clonePath := store.repositoryPath(key)
	if err := os.MkdirAll(filepath.Dir(clonePath), 0o755); err != nil {
		t.Fatal(err)
	}
	runSkillSourceGit(t, filepath.Dir(clonePath), "clone", "--quiet", repository, clonePath)
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{
		HubID: "hub-a", HomeDir: home, Projects: []ProjectInfo{{Name: "project", Path: projectRoot}},
	})
	target := skillsCommandTarget{scope: "project", projectName: "project", dir: projectRoot}
	source := "https://github.com/example/skills.git"
	initial, err := command.nativeStore().ensureRepo(context.Background(), skillSourceSnapshot{Source: source, SourceKey: key})
	if err != nil {
		t.Fatalf("ensureRepo() error=%v", err)
	}
	if _, err := writeSkillSourceLockFile(command.sourceLockFile(target), skillSourceMissingRevision, skillSourceLock{
		Version: 3,
		Sources: []skillSourceSnapshot{{Source: source, SourceKey: key, Commit: initial.Commit, UpdatedAt: "2026-08-18T12:00:00Z"}},
	}); err != nil {
		t.Fatal(err)
	}
	appendSkillSourceGitCommit(t, repository, "beta")

	if err := command.nativeInstall(context.Background(), target, source, []string{"beta"}, false); err != nil {
		t.Fatalf("nativeInstall() error=%v", err)
	}
	lock, _, err := readSkillSourceLockFile(command.sourceLockFile(target))
	if err != nil {
		t.Fatal(err)
	}
	if lock.Sources[0].Commit == initial.Commit {
		t.Fatalf("Scope commit=%s, want latest commit instead of %s", lock.Sources[0].Commit, initial.Commit)
	}
	for _, root := range []string{".agents/skills/beta", ".claude/skills/beta"} {
		if _, err := os.Stat(filepath.Join(projectRoot, filepath.FromSlash(root), "SKILL.md")); err != nil {
			t.Fatalf("latest Skill copy %s missing: %v", root, err)
		}
	}
}

func TestSkillSourceLockOperationsDoNotCreateSidecarLock(t *testing.T) {
	home := t.TempDir()
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a", HomeDir: home})
	target := skillsCommandTarget{scope: "hub"}
	path := command.sourceLockFile(target)

	if err := withSkillSourceLockFile(path, func() error { return nil }); err != nil {
		t.Fatalf("withSkillSourceLockFile() error=%v", err)
	}
	if _, err := os.Stat(path + ".lock"); !os.IsNotExist(err) {
		t.Fatalf("source lock sidecar exists after read lock: %v", err)
	}

	if err := command.withNativeScopeLock(target, func() error { return nil }); err != nil {
		t.Fatalf("withNativeScopeLock() error=%v", err)
	}
	if _, err := os.Stat(path + ".lock"); !os.IsNotExist(err) {
		t.Fatalf("source lock sidecar exists after native scope lock: %v", err)
	}
}

func TestNativeSkillSourceStoreUsesReadableSourceKeyPaths(t *testing.T) {
	home := t.TempDir()
	store := newSkillSourceStore(home)

	if got, want := filepath.ToSlash(store.repositoryPath("github.com/owner/repo")), filepath.ToSlash(filepath.Join(home, ".wheelmaker", "skills", "github.com_owner_repo")); got != want {
		t.Fatalf("repositoryPath()=%q, want %q", got, want)
	}
	if got, want := filepath.ToSlash(store.repositoryPath("github.com:8443/owner/repo")), filepath.ToSlash(filepath.Join(home, ".wheelmaker", "skills", "github.com~3A8443_owner_repo")); got != want {
		t.Fatalf("repositoryPath(port)=%q, want %q", got, want)
	}
	if got, want := filepath.ToSlash(store.repositoryPath("github.com/owner/repo-name")), filepath.ToSlash(filepath.Join(home, ".wheelmaker", "skills", "github.com_owner_repo-name")); got != want {
		t.Fatalf("repositoryPath(dash)=%q, want %q", got, want)
	}
	if got, want := filepath.ToSlash(store.repositoryPath("github.com/owner/repo_name")), filepath.ToSlash(filepath.Join(home, ".wheelmaker", "skills", "github.com_owner_repo~5Fname")); got != want {
		t.Fatalf("repositoryPath(underscore)=%q, want %q", got, want)
	}
	if got, want := filepath.ToSlash(store.lockPath("github.com/owner/repo")), filepath.ToSlash(filepath.Join(home, ".wheelmaker", "skills", ".locks", "github.com_owner_repo.lock")); got != want {
		t.Fatalf("lockPath()=%q, want %q", got, want)
	}
}

func TestNativeSkillSourceStoreDoesNotAdoptLegacyRepositoryPaths(t *testing.T) {
	key := "github.com/example/skills"
	legacyPath := func(name string, home string) string {
		switch name {
		case "flat":
			return filepath.Join(home, ".wheelmaker", "skills", "github.com--example--skills")
		case "nested":
			return filepath.Join(home, ".wheelmaker", "skills", "github.com", "example", "skills")
		case "hash":
			digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(key))))
			return filepath.Join(home, ".wheelmaker", "skills", hex.EncodeToString(digest[:]))
		default:
			t.Fatalf("unknown legacy path %q", name)
			return ""
		}
	}

	for _, name := range []string{"flat", "nested", "hash"} {
		t.Run(name, func(t *testing.T) {
			repository := t.TempDir()
			initSkillSourceGitFixture(t, repository, "alpha")
			home := t.TempDir()
			oldPath := legacyPath(name, home)
			if err := os.MkdirAll(filepath.Dir(oldPath), 0o755); err != nil {
				t.Fatal(err)
			}
			runSkillSourceGit(t, filepath.Dir(oldPath), "clone", "--quiet", repository, oldPath)

			store := newSkillSourceStore(home)
			checkout, err := store.ensureRepo(context.Background(), skillSourceSnapshot{Source: repository, SourceKey: key})
			if err != nil {
				t.Fatalf("ensureRepo() error=%v", err)
			}
			wantPath := filepath.Join(home, ".wheelmaker", "skills", "github.com_example_skills")
			if checkout.Path != wantPath {
				t.Fatalf("checkout.Path=%q, want %q", checkout.Path, wantPath)
			}
			if _, err := os.Stat(oldPath); err != nil {
				t.Fatalf("legacy repository was adopted or removed: %v", err)
			}
		})
	}
}

func TestNativeSkillSourceStoreRejectsDirtyCheckoutBeforeUpdate(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "first")
	store := newSkillSourceStore(filepath.Join(t.TempDir(), "home"))
	source := skillSourceSnapshot{Source: repository, SourceKey: "local/example"}
	checkout, err := store.ensureRepo(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(checkout.Path, "untracked.txt"), []byte("dirty\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.updateRepo(context.Background(), source); err == nil || !strings.Contains(strings.ToLower(err.Error()), "dirty") {
		t.Fatalf("updateRepo() error=%v, want dirty checkout failure", err)
	}
}

func TestNativeSkillDirectoryCopyAndLinkMaterializers(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source")
	writeSkillSourceFixture(t, source, "# Skill\n", map[string]string{"references/guide.md": "guide\n"})
	copyTarget := filepath.Join(t.TempDir(), "copy")
	if err := copySkillDirectory(source, copyTarget); err != nil {
		t.Fatalf("copySkillDirectory() error=%v", err)
	}
	copyRaw, err := os.ReadFile(filepath.Join(copyTarget, "SKILL.md"))
	if err != nil || string(copyRaw) != "# Skill\n" {
		t.Fatalf("copied skill=%q err=%v", copyRaw, err)
	}
	linkTarget := filepath.Join(t.TempDir(), "link")
	if err := createSkillDirectoryLink(source, linkTarget); err != nil {
		t.Skipf("directory links unavailable: %v", err)
	}
	linkRaw, err := os.ReadFile(filepath.Join(linkTarget, "references", "guide.md"))
	if err != nil || string(linkRaw) != "guide\n" {
		t.Fatalf("linked skill=%q err=%v", linkRaw, err)
	}
}

func initSkillSourceGitFixture(t *testing.T, repository, skillName string) {
	t.Helper()
	runSkillSourceGit(t, repository, "init", "-b", "main")
	runSkillSourceGit(t, repository, "config", "user.email", "skills@example.com")
	runSkillSourceGit(t, repository, "config", "user.name", "Skills Test")
	writeSkillSourceFixture(t, filepath.Join(repository, "skills", skillName), "# "+skillName+"\n", nil)
	runSkillSourceGit(t, repository, "add", ".")
	runSkillSourceGit(t, repository, "commit", "-m", "initial")
}

func appendSkillSourceGitCommit(t *testing.T, repository, skillName string) {
	t.Helper()
	writeSkillSourceFixture(t, filepath.Join(repository, "skills", skillName), "# "+skillName+"\n", nil)
	runSkillSourceGit(t, repository, "add", ".")
	runSkillSourceGit(t, repository, "commit", "-m", skillName)
}

func TestNativeSkillSourceLockWireShapeIsStrictJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".skill-source-lock.json")
	if err := os.WriteFile(path, []byte(`{"version":3,"sources":[]}{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readSkillSourceLockFile(path); err == nil {
		t.Fatal("readSkillSourceLockFile() accepted trailing JSON")
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(`{"version":3,"sources":[]}`), &value); err != nil {
		t.Fatal(err)
	}
}

func TestNativeSkillSourceIdentityNormalizesEquivalentAddressesAndSeparatesSSHVariants(t *testing.T) {
	equivalent := []string{
		"owner/repo",
		"https://GitHub.com/Owner/repo.git/",
		"git@github.com:Owner/repo.git",
		"ssh://git@github.com/Owner/repo.git",
	}
	var wantKey string
	for index, input := range equivalent {
		_, key, err := normalizeSkillGitSource(input)
		if err != nil {
			t.Fatalf("normalizeSkillGitSource(%q) error=%v", input, err)
		}
		if index == 0 {
			wantKey = key
		} else if key != wantKey {
			t.Fatalf("normalizeSkillGitSource(%q) key=%q, want %q", input, key, wantKey)
		}
	}

	variants := map[string]string{
		"ssh://deploy@github.com/Owner/repo.git":   "deploy@github.com/owner/repo",
		"ssh://git@github.com:2222/Owner/repo.git": "github.com:2222/owner/repo",
		"https://github.com:8443/Owner/repo.git":   "github.com:8443/owner/repo",
	}
	for input, expectedKey := range variants {
		_, key, err := normalizeSkillGitSource(input)
		if err != nil {
			t.Fatalf("normalizeSkillGitSource(%q) error=%v", input, err)
		}
		if key != expectedKey {
			t.Fatalf("normalizeSkillGitSource(%q) key=%q, want %q", input, key, expectedKey)
		}
	}
}

func TestNativeSkillSourceCatalogMarksMissingCloneWithoutNetwork(t *testing.T) {
	home := t.TempDir()
	lockPath := filepath.Join(home, ".wheelmaker", "skills", ".skill-source-lock.json")
	lock := skillSourceLock{Version: 3, Sources: []skillSourceSnapshot{{
		Source: "https://example.invalid/owner/repo.git", SourceKey: "example.invalid/owner/repo",
		Commit: strings.Repeat("a", 40), UpdatedAt: "2026-08-18T12:00:00Z", ManagedSkills: []string{"alpha"},
	}}}
	if _, err := writeSkillSourceLockFile(lockPath, skillSourceMissingRevision, lock); err != nil {
		t.Fatal(err)
	}
	installedRoot := filepath.Join(home, ".agents", "skills", "alpha")
	writeSkillSourceFixture(t, installedRoot, "# alpha\n", nil)
	snapshot, err := ScanSkillsSourceScope(context.Background(), SkillsSourceScopeInput{
		HomeDir: home,
		Installed: []SkillsInstalledSkillSnapshot{{
			Name: "alpha", Managed: true, Locations: []string{filepath.Join(installedRoot, "SKILL.md")},
		}},
	})
	if err != nil {
		t.Fatalf("ScanSkillsSourceScope() error=%v", err)
	}
	if len(snapshot.Sources) != 1 || snapshot.Sources[0].Status != "needs_clone" {
		t.Fatalf("snapshot=%#v, want needs_clone without cloning", snapshot)
	}
	if len(snapshot.Sources[0].Skills) != 1 || snapshot.Sources[0].Skills[0].Name != "alpha" || snapshot.Sources[0].Skills[0].Status != "needs_clone" {
		t.Fatalf("missing-clone managed skill=%#v, want visible installed ownership", snapshot.Sources[0].Skills)
	}
	if _, err := os.Stat(newSkillSourceStore(home).repositoryPath("example.invalid/owner/repo")); !os.IsNotExist(err) {
		t.Fatalf("passive scan created a clone: %v", err)
	}
}

func TestNativeSkillsCommandProjectUpdateDeletesUpstreamRemovedWithoutInstallingNew(t *testing.T) {
	repository := t.TempDir()
	initSkillSourceGitFixture(t, repository, "alpha")
	home := t.TempDir()
	projectRoot := t.TempDir()
	store := newSkillSourceStore(home)
	key := "github.com/example/skills"
	clonePath := store.repositoryPath(key)
	if err := os.MkdirAll(filepath.Dir(clonePath), 0o755); err != nil {
		t.Fatal(err)
	}
	runSkillSourceGit(t, filepath.Dir(clonePath), "clone", "--quiet", repository, clonePath)
	command := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{
		HubID: "hub-a", HomeDir: home, Projects: []ProjectInfo{{Name: "project", Path: projectRoot}},
	})
	target := skillsCommandTarget{scope: "project", projectName: "project", dir: projectRoot}
	initial, err := command.nativeStore().ensureRepo(context.Background(), skillSourceSnapshot{Source: "https://github.com/example/skills.git", SourceKey: key})
	if err != nil {
		t.Fatal(err)
	}
	lockPath := command.sourceLockFile(target)
	if _, err := writeSkillSourceLockFile(lockPath, skillSourceMissingRevision, skillSourceLock{
		Version: 3,
		Sources: []skillSourceSnapshot{{Source: "https://github.com/example/skills.git", SourceKey: key, Commit: initial.Commit, UpdatedAt: "2026-08-18T12:00:00Z", ManagedSkills: []string{}}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := command.nativeInstall(context.Background(), target, "https://github.com/example/skills.git", []string{"alpha"}, false); err != nil {
		t.Fatalf("nativeInstall() error=%v", err)
	}
	for _, root := range []string{".agents/skills/alpha", ".claude/skills/alpha"} {
		if _, err := os.Stat(filepath.Join(projectRoot, filepath.FromSlash(root), "SKILL.md")); err != nil {
			t.Fatalf("installed copy %s missing: %v", root, err)
		}
	}
	if err := os.RemoveAll(filepath.Join(repository, "skills", "alpha")); err != nil {
		t.Fatal(err)
	}
	writeSkillSourceFixture(t, filepath.Join(repository, "skills", "beta"), "# beta\n", nil)
	runSkillSourceGit(t, repository, "add", "-A")
	runSkillSourceGit(t, repository, "commit", "-m", "replace alpha")
	if err := command.nativeUpdateRepo(context.Background(), target, "https://github.com/example/skills.git"); err != nil {
		t.Fatalf("nativeUpdateRepo() error=%v", err)
	}
	if _, err := os.Stat(filepath.Join(projectRoot, ".agents", "skills", "alpha")); !os.IsNotExist(err) {
		t.Fatalf("removed upstream alpha still exists: %v", err)
	}
	if _, err := os.Stat(filepath.Join(projectRoot, ".agents", "skills", "beta")); !os.IsNotExist(err) {
		t.Fatalf("new upstream beta was auto-installed: %v", err)
	}
}

func TestFetchNPMLatestVersionRequiresMatchingManifest(t *testing.T) {
	tests := []struct {
		name        string
		statusCode  int
		body        string
		wantVersion string
		wantErr     bool
	}{
		{name: "matching package", statusCode: http.StatusOK, body: `{"name":"@myflicker/cli","version":"0.3.13"}`, wantVersion: "0.3.13"},
		{name: "html login page", statusCode: http.StatusOK, body: `<html>login</html>`, wantErr: true},
		{name: "wrong package", statusCode: http.StatusOK, body: `{"name":"other-package","version":"0.3.13"}`, wantErr: true},
		{name: "missing version", statusCode: http.StatusOK, body: `{"name":"@myflicker/cli"}`, wantErr: true},
		{name: "registry unavailable", statusCode: http.StatusForbidden, body: `{"error":"forbidden"}`, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var requestedPath string
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				requestedPath = request.URL.EscapedPath()
				writer.WriteHeader(tt.statusCode)
				_, _ = writer.Write([]byte(tt.body))
			}))
			defer server.Close()

			version, err := fetchNPMLatestVersion(context.Background(), server.Client(), server.URL, myFlickerPackageName)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("fetchNPMLatestVersion()=%q, want error", version)
				}
				return
			}
			if err != nil {
				t.Fatalf("fetchNPMLatestVersion() error: %v", err)
			}
			if version != tt.wantVersion {
				t.Fatalf("fetchNPMLatestVersion()=%q, want %q", version, tt.wantVersion)
			}
			if requestedPath != "/@myflicker%2fcli/latest" {
				t.Fatalf("requested path=%q, want the single-manifest endpoint", requestedPath)
			}
		})
	}
}

func TestNPMCommandHidesMyFlickerWhenPrivateRegistryUnavailableAndCachesProbe(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@myflicker/cli":{"version":"1.0.0"},"@openai/codex":{"version":"0.129.0"}}}`,
		ExitCode: 0,
	})
	var probeMu sync.Mutex
	probeCalls := 0
	cmd, fetcher := newNPMTestCommandWithProbe(runner, func(context.Context) bool {
		probeMu.Lock()
		probeCalls++
		probeMu.Unlock()
		return false
	})

	for i := 0; i < 2; i++ {
		resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
			"action": "scan",
			"hubId":  "hub-a",
		}))
		if cmdErr != nil {
			t.Fatalf("scan %d error: %#v", i+1, cmdErr)
		}
		body := resp.(npmCommandResponse)
		if body.Hub.Capabilities.MyFlicker {
			t.Fatalf("scan %d reported unavailable MyFlicker capability: %#v", i+1, resp)
		}
		if hasNPMTestPackage(body.Hub.Packages, myFlickerPackageName) {
			t.Fatalf("scan %d included unavailable MyFlicker: %#v", i+1, resp)
		}
		waitForNPMTestOperation(t, cmd)
	}

	probeMu.Lock()
	calls := probeCalls
	probeMu.Unlock()
	if calls != 1 {
		t.Fatalf("private registry probe calls=%d, want 1 within the cache TTL", calls)
	}
	if fetcher.callCount(myFlickerPackageName) != 0 {
		t.Fatal("unavailable MyFlicker should not query latest version")
	}
}

func TestNPMCommandPublishesMyFlickerCapabilityAndNotifiesAfterProbe(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@myflicker/cli":{"version":"1.0.0"}}}`,
		ExitCode: 0,
	})
	cmd, fetcher := newNPMTestCommandWithProbe(runner, func(context.Context) bool { return true })
	fetcher.setVersion(myFlickerPackageName, "1.0.1")
	changed := make(chan struct{}, 2)
	cmd.setMetadataChangedHandler(func() {
		changed <- struct{}{}
	})

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("first scan error: %#v", cmdErr)
	}
	if resp.(npmCommandResponse).Hub.Capabilities.MyFlicker {
		t.Fatal("MyFlicker capability must remain false while the first probe is pending")
	}

	select {
	case <-changed:
	case <-time.After(time.Second):
		t.Fatal("scan_latest did not notify the metadata change handler")
	}

	resp, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("second scan error: %#v", cmdErr)
	}
	body := resp.(npmCommandResponse)
	if !body.Hub.Capabilities.MyFlicker {
		t.Fatal("MyFlicker capability was not published after a successful probe")
	}
	if !hasNPMTestPackage(body.Hub.Packages, myFlickerPackageName) {
		t.Fatalf("MyFlicker row missing after successful probe: %#v", body.Hub)
	}
	select {
	case <-changed:
		t.Fatal("cached follow-up scan unexpectedly notified another metadata change")
	case <-time.After(20 * time.Millisecond):
	}
}

func TestNPMCommandReprobesPrivateRegistryAfterUnavailableTTL(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@myflicker/cli":{"version":"1.0.0"}}}`,
		ExitCode: 0,
	})
	var probeMu sync.Mutex
	probeCalls := 0
	cmd, _ := newNPMTestCommandWithProbe(runner, func(context.Context) bool {
		probeMu.Lock()
		defer probeMu.Unlock()
		probeCalls++
		// Recover on the second probe, mirroring a machine that rejoined the
		// corporate network.
		return probeCalls > 1
	})
	base := time.Date(2026, 7, 31, 10, 0, 0, 0, time.UTC)
	var clockMu sync.Mutex
	clock := base
	cmd.now = func() time.Time {
		clockMu.Lock()
		defer clockMu.Unlock()
		return clock
	}

	if _, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	})); cmdErr != nil {
		t.Fatalf("first scan error: %#v", cmdErr)
	}
	waitForNPMTestOperation(t, cmd)

	clockMu.Lock()
	clock = base.Add(npmPrivateRegistryUnavailableTTL + time.Minute)
	clockMu.Unlock()

	if _, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	})); cmdErr != nil {
		t.Fatalf("second scan error: %#v", cmdErr)
	}
	waitForNPMTestOperation(t, cmd)

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("third scan error: %#v", cmdErr)
	}
	if !hasNPMTestPackage(resp.(npmCommandResponse).Hub.Packages, myFlickerPackageName) {
		t.Fatalf("MyFlicker row missing after the registry became reachable again: %#v", resp)
	}
	probeMu.Lock()
	calls := probeCalls
	probeMu.Unlock()
	if calls != 2 {
		t.Fatalf("private registry probe calls=%d, want 2 (one per expired TTL)", calls)
	}
}

func TestNPMCommandUsesPrivateRegistryOnlyForMyFlickerOperations(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd, _ := newNPMTestCommand(runner)

	_, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": myFlickerPackageName,
		"version":     "latest",
	}))
	if cmdErr != nil {
		t.Fatalf("MyFlicker install error: %#v", cmdErr)
	}
	waitForNPMTestOperation(t, cmd)
	if !runner.hasCall("npm", "install", "-g", myFlickerPackageName+"@latest", "--registry="+myFlickerRegistry) {
		t.Fatalf("MyFlicker install did not use private registry: %#v", runner.calls)
	}

	_, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":       "install_many",
		"hubId":        "hub-a",
		"packageNames": []string{myFlickerPackageName, "@openai/codex"},
		"version":      "latest",
	}))
	if cmdErr != nil {
		t.Fatalf("bulk install error: %#v", cmdErr)
	}
	waitForNPMTestOperation(t, cmd)
	if !runner.hasCall("npm", "install", "-g", myFlickerPackageName+"@latest", "--registry="+myFlickerRegistry) {
		t.Fatalf("bulk MyFlicker install did not use private registry: %#v", runner.calls)
	}
	if !runner.hasCall("npm", "install", "-g", "@openai/codex@latest") {
		t.Fatalf("other package install call not found: %#v", runner.calls)
	}
	if runner.hasCall("npm", "install", "-g", "@openai/codex@latest", "--registry="+myFlickerRegistry) {
		t.Fatalf("other package install was routed through MyFlicker registry: %#v", runner.calls)
	}

	_, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "reinstall",
		"hubId":       "hub-a",
		"packageName": myFlickerPackageName,
	}))
	if cmdErr != nil {
		t.Fatalf("MyFlicker reinstall error: %#v", cmdErr)
	}
	waitForNPMTestOperation(t, cmd)
	if !runner.hasCall("npm", "uninstall", "-g", myFlickerPackageName) {
		t.Fatalf("MyFlicker reinstall uninstall call not found: %#v", runner.calls)
	}

	runner.mu.Lock()
	calls := append([]npmCommandCall(nil), runner.calls...)
	runner.mu.Unlock()
	for _, call := range calls {
		if call.Name == "npm" && len(call.Args) > 0 && call.Args[0] == "config" {
			t.Fatalf("NPM operation polluted npm config: %#v", calls)
		}
	}
}

func TestNPMCommandUsesMyFlickerBinaryNameInInstallMessage(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd, _ := newNPMTestCommand(runner)
	cmd.lookPath = func(name string) (string, error) {
		if name == "myflicker" {
			return "/usr/local/bin/myflicker", nil
		}
		return "", errors.New("not found")
	}

	_, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": myFlickerPackageName,
		"version":     "latest",
	}))
	if cmdErr != nil {
		t.Fatalf("MyFlicker install error: %#v", cmdErr)
	}
	operation := waitForNPMTestOperation(t, cmd)
	if !strings.Contains(operation.Message, "`myflicker` is now on PATH") || strings.Contains(operation.Message, "`flicker`") {
		t.Fatalf("MyFlicker install message=%q", operation.Message)
	}
}

type fakeGatewayUpdateRunner struct {
	calls   chan string
	release chan struct{}
	err     error
}

func (r *fakeGatewayUpdateRunner) Run(_ context.Context, stateDir string) error {
	r.calls <- stateDir
	<-r.release
	return r.err
}

func TestGatewayUpdateCommandQueryReportsNotInstalled(t *testing.T) {
	command := newGatewayUpdateCommandWithDependencies(t.TempDir(), &fakeGatewayUpdateRunner{})
	response := handleGatewayUpdateForTest(t, command, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	})
	if response.Status != "not_installed" || response.Installed != nil || response.CanRequest {
		t.Fatalf("response=%#v", response)
	}
}

func TestGatewayUpdateCommandQueryReportsInstalledRelease(t *testing.T) {
	baseDir := t.TempDir()
	statePath := filepath.Join(baseDir, "gateway", "state", "release.json")
	if err := os.MkdirAll(filepath.Dir(statePath), 0o700); err != nil {
		t.Fatal(err)
	}
	state := gatewayInstalledRelease{
		SchemaVersion: 1,
		Version:       "v1.3",
		SourceSHA:     "89abcdef0123456789abcdef0123456789abcdef",
		ManifestSHA:   "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		InstalledAt:   "2026-08-06T00:00:00Z",
	}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statePath, raw, 0o600); err != nil {
		t.Fatal(err)
	}

	command := newGatewayUpdateCommandWithDependencies(baseDir, &fakeGatewayUpdateRunner{})
	response := handleGatewayUpdateForTest(t, command, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	})
	if response.Status != "installed" || response.Installed == nil || response.Installed.Version != "v1.3" || !response.CanRequest {
		t.Fatalf("response=%#v", response)
	}
}

func TestGatewayUpdateCommandQueryReportsInstalledReleaseWithGatewaySchema(t *testing.T) {
	baseDir := t.TempDir()
	statePath := filepath.Join(baseDir, "gateway", "state", "release.json")
	if err := os.MkdirAll(filepath.Dir(statePath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statePath, []byte(`{"schema":1,"version":"v1.3","sourceSha":"89abcdef0123456789abcdef0123456789abcdef","manifestSha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","installedAt":"2026-08-06T00:00:00Z"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	command := newGatewayUpdateCommandWithDependencies(baseDir, &fakeGatewayUpdateRunner{})
	response := handleGatewayUpdateForTest(t, command, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	})
	if response.Status != "installed" || response.Installed == nil || response.Installed.SchemaVersion != 1 || response.Installed.Version != "v1.3" || !response.CanRequest {
		t.Fatalf("response=%#v", response)
	}
}

func TestGatewayUpdateCommandRequestSharesActiveJob(t *testing.T) {
	baseDir := t.TempDir()
	statePath := filepath.Join(baseDir, "gateway", "state", "release.json")
	if err := os.MkdirAll(filepath.Dir(statePath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statePath, []byte(`{"schemaVersion":1,"version":"v1.3","sourceSha":"89abcdef0123456789abcdef0123456789abcdef","manifestSha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","installedAt":"2026-08-06T00:00:00Z"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := &fakeGatewayUpdateRunner{calls: make(chan string, 1), release: make(chan struct{})}
	command := newGatewayUpdateCommandWithDependencies(baseDir, runner)
	first := handleGatewayUpdateForTest(t, command, map[string]any{"action": "request", "hubId": "hub-a"})
	if !first.Accepted || first.Status != "update_pending" || first.Job == nil || !first.JobActive() {
		t.Fatalf("first response=%#v", first)
	}
	select {
	case got := <-runner.calls:
		if got != baseDir {
			t.Fatalf("runner stateDir=%q, want %q", got, baseDir)
		}
	case <-time.After(time.Second):
		t.Fatal("gateway runner was not started")
	}
	second := handleGatewayUpdateForTest(t, command, map[string]any{"action": "request", "hubId": "hub-a"})
	if !second.Accepted || second.JobID != first.JobID || second.Status != "update_pending" {
		t.Fatalf("second response=%#v", second)
	}
	close(runner.release)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		status := handleGatewayUpdateForTest(t, command, map[string]any{"action": "query", "hubId": "hub-a"})
		if status.Job != nil && status.Job.State == "succeeded" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("gateway update did not reach succeeded state")
}

func TestGatewayUpdateCommandReapsStaleActiveJob(t *testing.T) {
	baseDir := t.TempDir()
	writeGatewayInstalledRelease(t, baseDir)
	command := newGatewayUpdateCommandWithDependencies(baseDir, &fakeGatewayUpdateRunner{})
	now := time.Date(2026, time.August, 6, 12, 0, 0, 0, time.UTC)
	command.now = func() time.Time { return now }
	stale := &gatewayUpdateJobStatus{
		Schema:    1,
		JobID:     "stale-job",
		State:     "downloading",
		StartedAt: now.Add(-staleGatewayUpdateThreshold - time.Minute).Format(time.RFC3339Nano),
		UpdatedAt: now.Add(-staleGatewayUpdateThreshold - time.Minute).Format(time.RFC3339Nano),
	}
	if err := command.writeJobStatus(stale); err != nil {
		t.Fatal(err)
	}

	response := handleGatewayUpdateForTest(t, command, map[string]any{"action": "query", "hubId": "hub-a"})
	if response.Status != "installed" || !response.CanRequest || response.Job == nil || response.Job.State != "failed" || response.Job.ErrorCode != "gateway_updater_stalled" {
		t.Fatalf("response=%#v", response)
	}
}

func TestGatewayUpdateCommandRunnerOutlivesRequestContext(t *testing.T) {
	baseDir := t.TempDir()
	writeGatewayInstalledRelease(t, baseDir)
	runner := &contextGatewayUpdateRunner{started: make(chan context.Context, 1), release: make(chan struct{}), done: make(chan struct{})}
	command := newGatewayUpdateCommandWithDependencies(baseDir, runner)
	requestContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	raw, err := json.Marshal(map[string]any{"action": "request", "hubId": "hub-a"})
	if err != nil {
		t.Fatal(err)
	}
	if _, commandErr := command.Handle(requestContext, raw); commandErr != nil {
		t.Fatalf("Handle() error=%v", commandErr)
	}
	var runnerContext context.Context
	select {
	case runnerContext = <-runner.started:
	case <-time.After(time.Second):
		t.Fatal("gateway runner was not started")
	}
	cancel()
	if runnerContext.Err() != nil {
		t.Fatalf("runner context was cancelled with request: %v", runnerContext.Err())
	}
	close(runner.release)
	select {
	case <-runner.done:
	case <-time.After(time.Second):
		t.Fatal("gateway runner did not finish")
	}
}

type contextGatewayUpdateRunner struct {
	started chan context.Context
	release chan struct{}
	done    chan struct{}
}

func (r *contextGatewayUpdateRunner) Run(ctx context.Context, _ string) error {
	defer close(r.done)
	r.started <- ctx
	<-r.release
	return nil
}

func writeGatewayInstalledRelease(t *testing.T, baseDir string) {
	t.Helper()
	statePath := filepath.Join(baseDir, "gateway", "state", "release.json")
	if err := os.MkdirAll(filepath.Dir(statePath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statePath, []byte(`{"schemaVersion":1,"version":"v1.3","sourceSha":"89abcdef0123456789abcdef0123456789abcdef","manifestSha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","installedAt":"2026-08-06T00:00:00Z"}`), 0o600); err != nil {
		t.Fatal(err)
	}
}

func (r gatewayUpdateResponse) JobActive() bool {
	return r.Job != nil && activeGatewayUpdateState(r.Job.State)
}

func handleGatewayUpdateForTest(t *testing.T, command *GatewayUpdateCommand, payload map[string]any) gatewayUpdateResponse {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	result, commandErr := command.Handle(context.Background(), raw)
	if commandErr != nil {
		t.Fatalf("Handle() error=%v", commandErr)
	}
	return result.(gatewayUpdateResponse)
}

func TestDebugWebTransferReceiverAppliesVerifiedArchive(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "web"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "web", "index.html"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	archive := debugWebZip(t, map[string]string{"index.html": "new"})
	receiver := newDebugWebTransferReceiver(root)
	transferID := "transfer-verified"
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveStart, map[string]any{"transferId": transferID, "size": len(archive), "sha256": debugWebDigest(archive)}, "accepted")
	middle := len(archive) / 2
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveChunk, map[string]any{"transferId": transferID, "sequence": 0, "data": base64.StdEncoding.EncodeToString(archive[:middle])}, "accepted")
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveChunk, map[string]any{"transferId": transferID, "sequence": 1, "data": base64.StdEncoding.EncodeToString(archive[middle:])}, "accepted")
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveFinish, map[string]any{"transferId": transferID}, "success")

	current, err := os.ReadFile(filepath.Join(root, "web", "index.html"))
	if err != nil || string(current) != "new" {
		t.Fatalf("web=%q err=%v", current, err)
	}
	if _, err := os.Stat(filepath.Join(root, updateStagingDirectoryName, updateLeaseFileName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("lease remains: %v", err)
	}
}

func TestDebugWebTransferReceiverPreservesWebOnDigestMismatch(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "web"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "web", "index.html"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	receiver := newDebugWebTransferReceiver(root)
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveStart, map[string]any{"transferId": "transfer-bad", "size": 3, "sha256": strings.Repeat("a", 64)}, "accepted")
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveChunk, map[string]any{"transferId": "transfer-bad", "sequence": 0, "data": base64.StdEncoding.EncodeToString([]byte("zip"))}, "accepted")
	raw, _ := json.Marshal(map[string]any{"transferId": "transfer-bad"})
	status, commandErr := receiver.Handle(rp.RegistryMethodHubDebugWebReceiveFinish, raw)
	if commandErr == nil || status.ErrorCode != "debug_web_digest_mismatch" {
		t.Fatalf("status=%#v err=%v", status, commandErr)
	}
	current, _ := os.ReadFile(filepath.Join(root, "web", "index.html"))
	if string(current) != "old" {
		t.Fatalf("existing web replaced: %q", current)
	}
}

func TestDebugWebTransferReceiverRejectsOutOfOrderChunk(t *testing.T) {
	receiver := newDebugWebTransferReceiver(t.TempDir())
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveStart, map[string]any{"transferId": "transfer-order", "size": 3, "sha256": debugWebDigest([]byte("zip"))}, "accepted")
	raw, _ := json.Marshal(map[string]any{"transferId": "transfer-order", "sequence": 1, "data": base64.StdEncoding.EncodeToString([]byte("zip"))})
	status, commandErr := receiver.Handle(rp.RegistryMethodHubDebugWebReceiveChunk, raw)
	if commandErr == nil || status.ErrorCode != "debug_web_sequence_mismatch" {
		t.Fatalf("status=%#v err=%v", status, commandErr)
	}
	mustHandleDebugWebTransfer(t, receiver, rp.RegistryMethodHubDebugWebReceiveAbort, map[string]any{"transferId": "transfer-order"}, "aborted")
}

func mustHandleDebugWebTransfer(t *testing.T, receiver *debugWebTransferReceiver, method string, payload map[string]any, want string) {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	status, commandErr := receiver.Handle(method, raw)
	if commandErr != nil || status.Status != want {
		t.Fatalf("method=%s status=%#v err=%v", method, status, commandErr)
	}
}

func debugWebZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}
func debugWebDigest(bytes []byte) string {
	sum := sha256.Sum256(bytes)
	return hex.EncodeToString(sum[:])
}

// Install-message verification tests. Kept in a dedicated file so the A2
// post-install LookPath checks are exercised independently of the larger
// tools_test.go update/release test suite.

func TestNPMCommandInstallMessageReportsReadyWhenBinaryOnPath(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunner(runner)
	cmd.lookPath = func(name string) (string, error) {
		if name == "codex" {
			return "/usr/local/bin/codex", nil
		}
		return "", errors.New("not found")
	}

	_, err := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
		"version":     "latest",
	}))
	if err != nil {
		t.Fatalf("install error: %#v", err)
	}
	operation := waitForNPMTestOperation(t, cmd)
	if operation.Status != "succeeded" {
		t.Fatalf("status=%q want succeeded", operation.Status)
	}
	if !strings.Contains(operation.Message, "ready to use") || strings.Contains(operation.Message, "Restart WheelMaker") {
		t.Fatalf("message=%q want ready to use (no restart)", operation.Message)
	}
}

func TestNPMCommandInstallMessageReportsRestartWhenBinaryMissing(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunner(runner)
	cmd.lookPath = func(string) (string, error) { return "", errors.New("not found") }

	_, err := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
		"version":     "latest",
	}))
	if err != nil {
		t.Fatalf("install error: %#v", err)
	}
	operation := waitForNPMTestOperation(t, cmd)
	if operation.Status != "succeeded" {
		t.Fatalf("status=%q want succeeded", operation.Status)
	}
	if !strings.Contains(operation.Message, "Restart WheelMaker") || !strings.Contains(operation.Message, "not found") {
		t.Fatalf("message=%q want restart + not found", operation.Message)
	}
}

func TestNPMCommandBulkInstallMessageReportsMissingBinaries(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunner(runner)
	cmd.lookPath = func(name string) (string, error) {
		if name == "claude" {
			return "/usr/local/bin/claude", nil
		}
		return "", errors.New("not found")
	}

	_, err := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":       "install_many",
		"hubId":        "hub-a",
		"packageNames": []string{"@openai/codex", "@anthropic-ai/claude-code"},
		"version":      "latest",
	}))
	if err != nil {
		t.Fatalf("bulk install error: %#v", err)
	}
	operation := waitForNPMTestOperation(t, cmd)
	if operation.Status != "succeeded" {
		t.Fatalf("status=%q want succeeded", operation.Status)
	}
	if !strings.Contains(operation.Message, "not found yet") || !strings.Contains(operation.Message, "codex") {
		t.Fatalf("message=%q want codex listed as not found yet", operation.Message)
	}
	if strings.Contains(operation.Message, "ready to use") {
		t.Fatalf("message should not claim ready when codex is missing: %q", operation.Message)
	}
}
