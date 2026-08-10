package gateway

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadBundleBuildsAllRoutesFromGatewayConfig(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}
	config := `{
  "schema": 1,
  "acme": {"email": "ops@example.com"},
  "log": {"level": "info"},
  "relay": {"listenPort": 28810},
  "registry": {"publicUrl": "https://registry.example.com"},
  "release": {
    "publicUrl": "https://release.example.com",
    "listen": "127.0.0.1:9680",
    "dataRoot": "` + filepath.ToSlash(filepath.Join(root, "release-data")) + `",
    "tokenSha256": ""
  },
  "share": {"publicUrl": "https://share.example.com"}
}`
	if err := os.WriteFile(paths.ConfigFile, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}

	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatalf("LoadBundle() error = %v", err)
	}
	if len(bundle.Sites) != 3 {
		t.Fatalf("LoadBundle() built %d sites, want 3: %+v", len(bundle.Sites), bundle.Sites)
	}
	wantKinds := []string{"registry", "release", "share"}
	for index, want := range wantKinds {
		if got := string(bundle.Sites[index].Kind); got != want {
			t.Errorf("site[%d].Kind = %q, want %q", index, got, want)
		}
	}
	if bundle.Sites[1].Upstream != "http://127.0.0.1:9680" {
		t.Fatalf("release upstream = %q, want loopback Release Server", bundle.Sites[1].Upstream)
	}
	if bundle.Sites[2].WebRoot != paths.SharePublicRoot {
		t.Fatalf("share web root = %q, want %q", bundle.Sites[2].WebRoot, paths.SharePublicRoot)
	}
}

func TestSemanticFingerprintOnlyTracksGatewayConfig(t *testing.T) {
	root := t.TempDir()
	paths := ResolvePaths(filepath.Join(root, "gateway"))
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.ConfigFile, []byte(`{"schema":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	first := semanticFingerprint(paths)
	siblingAppConfig := filepath.Join(filepath.Dir(paths.Home), "config.json")
	if err := os.WriteFile(siblingAppConfig, []byte(`{"share":{"publicUrl":"https://ignored.example.com"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := semanticFingerprint(paths); got != first {
		t.Fatalf("semanticFingerprint changed for sibling app config: %q -> %q", first, got)
	}
}

func TestGatewayConfigIncludesReleaseRuntimeFields(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	if err := EnsureHome(home); err != nil {
		t.Fatal(err)
	}
	config, err := loadGlobalFile(paths.ConfigFile)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	release, ok := document["release"].(map[string]any)
	if !ok {
		t.Fatalf("default Gateway config release = %#v", document["release"])
	}
	for _, field := range []string{"publicUrl", "listen", "dataRoot", "tokenSha256"} {
		if _, ok := release[field]; !ok {
			t.Errorf("default release config missing %q", field)
		}
	}
	if release["dataRoot"] != filepath.Join(filepath.Dir(home), "release-server", "data") {
		t.Errorf("default release dataRoot = %#v", release["dataRoot"])
	}
	_ = paths
}
