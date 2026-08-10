package main

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunVersion(t *testing.T) {
	var stdout, stderr strings.Builder
	if err := run([]string{"version"}, &stdout, &stderr); err != nil {
		t.Fatalf("run(version) error = %v", err)
	}
	if !strings.Contains(stdout.String(), "wheelmaker-gateway") {
		t.Fatalf("version output = %q", stdout.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("version stderr = %q", stderr.String())
	}
}

func TestRunPathsPrintsStableLayout(t *testing.T) {
	home := filepath.Join(t.TempDir(), "gateway")
	var stdout, stderr strings.Builder
	if err := run([]string{"paths", "--home", home}, &stdout, &stderr); err != nil {
		t.Fatalf("run(paths) error = %v", err)
	}
	var paths map[string]string
	if err := json.Unmarshal([]byte(stdout.String()), &paths); err != nil {
		t.Fatalf("paths output is not JSON: %v", err)
	}
	if paths["generatedConfig"] != filepath.Join(home, "generated", "caddy.json") {
		t.Fatalf("generatedConfig = %q", paths["generatedConfig"])
	}
	if paths["registryWebRoot"] != filepath.Join(filepath.Dir(home), "web") {
		t.Fatalf("registryWebRoot = %q", paths["registryWebRoot"])
	}
	if paths["releaseDataRoot"] != filepath.Join(filepath.Dir(home), "release-server", "data") {
		t.Fatalf("releaseDataRoot = %q", paths["releaseDataRoot"])
	}
	if paths["sharePublicRoot"] != filepath.Join(filepath.Dir(home), "shares", "public") {
		t.Fatalf("sharePublicRoot = %q", paths["sharePublicRoot"])
	}
}

func TestRunValidateReadsGatewayConfig(t *testing.T) {
	home := filepath.Join(t.TempDir(), "gateway")
	paths := gatewayPathsForTest(home)
	if err := os.MkdirAll(filepath.Dir(paths.configFile), 0o755); err != nil {
		t.Fatal(err)
	}
	config := `{"schema":2,"acme":{"email":"ops@example.com"},"wm_sites":{"tls":{"certificateFile":"","keyFile":""},"registry":{"urlMode":"sync_hub"},"release":{"publicUrl":"http://release.example.com","listen":"127.0.0.1:9680","dataRoot":"` + filepath.ToSlash(filepath.Join(t.TempDir(), "release-data")) + `","tokenSha256":""},"share":{"urlMode":"sync_hub"}}}`
	if err := os.WriteFile(paths.configFile, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}

	var stdout, stderr strings.Builder
	if err := run([]string{"validate", "--home", home}, &stdout, &stderr); err != nil {
		t.Fatalf("run(validate) error = %v\nstderr=%s", err, stderr.String())
	}
	if !strings.Contains(stdout.String(), "valid") {
		t.Fatalf("validate output = %q", stdout.String())
	}
}

func TestRunRejectsUnknownCommand(t *testing.T) {
	if err := run([]string{"unknown"}, io.Discard, io.Discard); err == nil {
		t.Fatal("run(unknown) returned nil")
	}
}

type testGatewayPaths struct {
	configFile string
}

func gatewayPathsForTest(home string) testGatewayPaths {
	return testGatewayPaths{
		configFile: filepath.Join(home, "config.json"),
	}
}
