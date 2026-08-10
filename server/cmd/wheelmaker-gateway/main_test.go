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
	if paths["appConfigFile"] != filepath.Join(filepath.Dir(home), "config.json") {
		t.Fatalf("appConfigFile = %q", paths["appConfigFile"])
	}
	if paths["sharePublicRoot"] != filepath.Join(filepath.Dir(home), "shares", "public") {
		t.Fatalf("sharePublicRoot = %q", paths["sharePublicRoot"])
	}
}

func TestRunValidateReadsGlobalAndSiteFiles(t *testing.T) {
	home := filepath.Join(t.TempDir(), "gateway")
	paths := gatewayPathsForTest(home)
	if err := os.MkdirAll(paths.sitesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.configFile, []byte(`{"schema":1,"acme":{"email":"ops@example.com"},"log":{"level":"info"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(paths.sitesDir, "workspace.json"), []byte(`{"schema":1,"kind":"workspace","publicUrl":"http://workspace.example.com","webRoot":"`+filepath.ToSlash(filepath.Join(t.TempDir(), "web"))+`","upstream":"http://127.0.0.1:9630","tls":{"certificateFile":"","keyFile":""}}`), 0o600); err != nil {
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
	sitesDir   string
}

func gatewayPathsForTest(home string) testGatewayPaths {
	return testGatewayPaths{
		configFile: filepath.Join(home, "config.json"),
		sitesDir:   filepath.Join(home, "sites"),
	}
}
