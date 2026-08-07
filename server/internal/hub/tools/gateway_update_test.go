package tools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

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
