package gateway

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadBundleBuildsAllRoutesFromHubAndGatewayConfig(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}
	hubConfig := `{
  "publicUrl": "https://registry.example.com",
  "log": {"level": "warn"},
  "registry": {
    "listen": true,
    "relayPort": 28810,
    "share": {"publicUrl": "https://share.example.com"}
  }
}`
	if err := os.WriteFile(filepath.Join(root, "config.json"), []byte(hubConfig), 0o600); err != nil {
		t.Fatal(err)
	}
	config := `{
  "schema": 1,
  "acme": {"email": "ops@example.com"},
  "registry": {"tls": {"certificateFile": "", "keyFile": ""}},
  "release": {
    "publicUrl": "https://release.example.com",
    "listen": "127.0.0.1:9680",
    "dataRoot": "` + filepath.ToSlash(filepath.Join(root, "release-data")) + `",
    "tokenSha256": ""
  },
  "share": {"tls": {"certificateFile": "", "keyFile": ""}}
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
	if bundle.Global.Registry.PublicURL != "https://registry.example.com" {
		t.Fatalf("registry publicUrl = %q, want Hub value", bundle.Global.Registry.PublicURL)
	}
	if bundle.Global.Share.PublicURL != "https://share.example.com" {
		t.Fatalf("share publicUrl = %q, want Hub value", bundle.Global.Share.PublicURL)
	}
	if bundle.Global.Relay.ListenPort != 28810 || bundle.Global.Log.Level != "warn" {
		t.Fatalf("shared runtime values = relay %d, log %q; want 28810 and warn", bundle.Global.Relay.ListenPort, bundle.Global.Log.Level)
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

func TestSemanticFingerprintTracksHubAndGatewayConfig(t *testing.T) {
	root := t.TempDir()
	paths := ResolvePaths(filepath.Join(root, "gateway"))
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.ConfigFile, []byte(`{"schema":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	first := semanticFingerprint(paths)
	hubConfig := filepath.Join(filepath.Dir(paths.Home), "config.json")
	if err := os.WriteFile(hubConfig, []byte(`{"registry":{"share":{"publicUrl":"https://share.example.com"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := semanticFingerprint(paths); got == first {
		t.Fatalf("semanticFingerprint did not change for Hub config: %q", got)
	}
}

func TestLoadBundleKeepsReleaseWhenHubShareIsInvalid(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.ConfigFile, []byte(`{
  "schema": 1,
  "release": {"publicUrl": "https://release.example.com"},
  "registry": {"tls": {"certificateFile": "", "keyFile": ""}},
  "share": {"tls": {"certificateFile": "", "keyFile": ""}}
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "config.json"), []byte(`{
  "publicUrl": "https://registry.example.com",
  "registry": {
    "listen": true,
    "share": {"publicUrl": "https://share.example.com/path"}
  }
}`), 0o600); err != nil {
		t.Fatal(err)
	}

	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatalf("LoadBundle() error = %v", err)
	}
	if len(bundle.Sites) != 2 {
		t.Fatalf("LoadBundle() built %d sites, want registry and release: %+v", len(bundle.Sites), bundle.Sites)
	}
	if bundle.Sites[0].Kind != SiteRegistry || bundle.Sites[1].Kind != SiteRelease {
		t.Fatalf("sites = %+v, want registry and release", bundle.Sites)
	}
}

func TestLoadBundleSupportsReleaseOnlyWithoutHubConfig(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.ConfigFile, []byte(`{
  "schema": 1,
  "release": {"publicUrl": "https://release.example.com"},
  "registry": {"tls": {"certificateFile": "", "keyFile": ""}},
  "share": {"tls": {"certificateFile": "", "keyFile": ""}}
}`), 0o600); err != nil {
		t.Fatal(err)
	}

	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatalf("LoadBundle() error = %v", err)
	}
	if len(bundle.Sites) != 1 || bundle.Sites[0].Kind != SiteRelease {
		t.Fatalf("sites = %+v, want Release-only bundle", bundle.Sites)
	}
}

func TestLoadBundleRejectsGatewaySharedDuplicates(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.ConfigFile, []byte(`{
  "schema": 1,
  "log": {"level": "info"},
  "relay": {"listenPort": 28810},
  "registry": {"publicUrl": "https://registry.example.com"},
  "share": {"publicUrl": "https://share.example.com"}
}`), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := LoadBundle(home); err == nil {
		t.Fatal("LoadBundle() accepted Gateway-owned shared duplicates")
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
	for _, field := range []string{"log", "relay"} {
		if _, ok := document[field]; ok {
			t.Errorf("default Gateway config contains shared field %q", field)
		}
	}
	for section := range map[string]struct{}{"registry": {}, "share": {}} {
		value, ok := document[section].(map[string]any)
		if !ok {
			t.Fatalf("default Gateway config %s = %#v", section, document[section])
		}
		if _, ok := value["publicUrl"]; ok {
			t.Errorf("default Gateway config %s contains publicUrl", section)
		}
	}
	if release["dataRoot"] != filepath.Join(filepath.Dir(home), "release-server", "data") {
		t.Errorf("default release dataRoot = %#v", release["dataRoot"])
	}
	_ = paths
}
