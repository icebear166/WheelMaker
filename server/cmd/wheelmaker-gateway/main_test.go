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
	if paths["customSitesRoot"] != filepath.Join(home, "sites") {
		t.Fatalf("customSitesRoot = %q", paths["customSitesRoot"])
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

func TestRunValidatePrintsCustomCaddyWarnings(t *testing.T) {
	home := commandGatewayHome(t, map[string]string{
		"warning.caddy": "warning.example.com {\nrespond \"ok\"\n}\n",
	})
	var stdout, stderr strings.Builder
	if err := run([]string{"validate", "--home", home}, &stdout, &stderr); err != nil {
		t.Fatalf("run(validate) error = %v", err)
	}
	if strings.TrimSpace(stdout.String()) != "valid" {
		t.Fatalf("validate stdout = %q", stdout.String())
	}
	if !strings.Contains(stderr.String(), "warning.caddy") || !strings.Contains(stderr.String(), ":2") {
		t.Fatalf("validate stderr does not include warning source position: %q", stderr.String())
	}
}

func TestRunValidateReportsImportedCustomCaddyError(t *testing.T) {
	home := commandGatewayHome(t, map[string]string{
		"entry.caddy":      "import nested/bad.caddy\n",
		"nested/bad.caddy": "bad.example.com {\n\trespond ok\n",
	})
	var stdout, stderr strings.Builder
	err := run([]string{"validate", "--home", home}, &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "bad.caddy:2") {
		t.Fatalf("run(validate) error = %v, want imported source line", err)
	}
	if stdout.Len() != 0 {
		t.Fatalf("validate stdout = %q", stdout.String())
	}
}

func TestRunRenderPromotesOnlyValidCustomCaddyBundle(t *testing.T) {
	home := commandGatewayHome(t, map[string]string{
		"app.caddy": "app.example.com {\n\trespond ok\n}\n",
	})
	generated := filepath.Join(home, "generated", "caddy.json")
	var stdout, stderr strings.Builder
	if err := run([]string{"render", "--home", home}, &stdout, &stderr); err != nil {
		t.Fatalf("run(render) error = %v", err)
	}
	if strings.TrimSpace(stdout.String()) != generated {
		t.Fatalf("render stdout = %q, want %q", stdout.String(), generated)
	}
	accepted, err := os.ReadFile(generated)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(accepted), "app.example.com") {
		t.Fatalf("generated config is missing custom site: %s", accepted)
	}

	badPath := filepath.Join(home, "sites", "app.caddy")
	if err := os.WriteFile(badPath, []byte("app.example.com {\n\trespond ok\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	stdout.Reset()
	stderr.Reset()
	if err := run([]string{"render", "--home", home}, &stdout, &stderr); err == nil {
		t.Fatal("run(render) accepted invalid custom Caddy source")
	}
	retained, err := os.ReadFile(generated)
	if err != nil {
		t.Fatal(err)
	}
	if string(retained) != string(accepted) {
		t.Fatalf("invalid render changed accepted generated config")
	}
}

func TestRunServeRejectsInvalidImportedSourceWithoutPromoting(t *testing.T) {
	home := commandGatewayHome(t, map[string]string{
		"entry.caddy":      "import nested/bad.caddy\n",
		"nested/bad.caddy": "bad.example.com {\n\trespond ok\n",
	})
	generated := filepath.Join(home, "generated", "caddy.json")
	if err := os.MkdirAll(filepath.Dir(generated), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(generated, []byte("previous"), 0o600); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr strings.Builder
	err := run([]string{"serve", "--home", home}, &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "bad.caddy:2") {
		t.Fatalf("run(serve) error = %v, want imported source line", err)
	}
	retained, readErr := os.ReadFile(generated)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(retained) != "previous" {
		t.Fatalf("invalid cold start changed generated config: %q", retained)
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

func commandGatewayHome(t *testing.T, customFiles map[string]string) string {
	t.Helper()
	home := filepath.Join(t.TempDir(), "gateway")
	configFile := filepath.Join(home, "config.json")
	if err := os.MkdirAll(filepath.Join(home, "sites"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configFile, []byte(`{
  "schema": 2,
  "wm_sites": {
    "tls": {},
    "registry": {"urlMode": "sync_hub"},
    "release": {"publicUrl": "http://release.example.com"},
    "share": {"urlMode": "sync_hub"}
  }
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	for relative, contents := range customFiles {
		path := filepath.Join(home, "sites", relative)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return home
}
