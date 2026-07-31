package tools

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProbeNPMRegistryPackageRequiresMatchingMetadata(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		body       string
		want       bool
	}{
		{name: "matching package", statusCode: http.StatusOK, body: `{"name":"@myflicker/cli","dist-tags":{"latest":"0.3.13"}}`, want: true},
		{name: "html login page", statusCode: http.StatusOK, body: `<html>login</html>`, want: false},
		{name: "wrong package", statusCode: http.StatusOK, body: `{"name":"other-package","dist-tags":{"latest":"0.3.13"}}`, want: false},
		{name: "missing latest tag", statusCode: http.StatusOK, body: `{"name":"@myflicker/cli","dist-tags":{}}`, want: false},
		{name: "registry unavailable", statusCode: http.StatusForbidden, body: `{"error":"forbidden"}`, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.WriteHeader(tt.statusCode)
				_, _ = writer.Write([]byte(tt.body))
			}))
			defer server.Close()

			if got := probeNPMRegistryPackage(context.Background(), server.Client(), server.URL, myFlickerPackageName); got != tt.want {
				t.Fatalf("probeNPMRegistryPackage()=%v, want %v", got, tt.want)
			}
		})
	}
}

func TestNPMCommandHidesMyFlickerWhenPrivateRegistryUnavailableAndProbesOnce(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@myflicker/cli":{"version":"1.0.0"},"@openai/codex":{"version":"0.129.0"}}}`,
		ExitCode: 0,
	})
	probeCalls := 0
	cmd := newNPMCommandWithRunnerAndProbe(runner, func(context.Context) bool {
		probeCalls++
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

	if probeCalls != 1 {
		t.Fatalf("private registry probe calls=%d, want 1", probeCalls)
	}
	if runner.hasCall("npm", "view", myFlickerPackageName, "version", "--registry="+myFlickerRegistry) {
		t.Fatalf("unavailable MyFlicker should not query latest: %#v", runner.calls)
	}
}

func TestNPMCommandUsesPrivateRegistryOnlyForMyFlickerOperations(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunnerAndProbe(runner, func(context.Context) bool { return true })

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
	cmd := newNPMCommandWithRunnerAndProbe(runner, func(context.Context) bool { return true })
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
