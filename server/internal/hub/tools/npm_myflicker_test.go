package tools

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

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
		if hasNPMTestPackage(resp.(npmCommandResponse).Hub.Packages, myFlickerPackageName) {
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
