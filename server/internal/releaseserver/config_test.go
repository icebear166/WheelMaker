package releaseserver

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func TestWriteAndLoadConfigRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	want := Config{
		Schema:    1,
		Listen:    "127.0.0.1:9680",
		PublicURL: "https://release.example.com",
		DataRoot:  filepath.Join(t.TempDir(), "release-data"),
	}

	if err := WriteConfig(path, want); err != nil {
		t.Fatalf("WriteConfig() error = %v", err)
	}
	got, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if got != want {
		t.Fatalf("LoadConfig() = %+v, want %+v", got, want)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) == 0 || raw[len(raw)-1] != '\n' {
		t.Fatalf("config must end with one newline: %q", raw)
	}
}

func TestLoadConfigReadsReleaseFromGatewayConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gateway.json")
	dataRoot := filepath.Join(t.TempDir(), "release-data")
	raw := fmt.Sprintf(`{"schema":1,"acme":{"email":""},"log":{"level":"info"},"relay":{"listenPort":0},"registry":{"publicUrl":""},"release":{"publicUrl":"https://release.example.com","listen":"127.0.0.1:9680","dataRoot":%q,"tokenSha256":""},"share":{"publicUrl":""}}`, dataRoot)
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.PublicURL != "https://release.example.com" || cfg.DataRoot != dataRoot {
		t.Fatalf("release config = %+v", cfg)
	}
}

func TestGatewayReleaseUpdatesPreserveOtherSections(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "gateway.json")
	dataRoot := filepath.Join(dir, "release-data")
	newDataRoot := filepath.Join(dir, "new-release-data")
	raw := fmt.Sprintf(`{"schema":1,"acme":{"email":"ops@example.com"},"log":{"level":"debug"},"relay":{"listenPort":28810},"registry":{"publicUrl":"https://registry.example.com","tls":{"certificateFile":"/etc/registry.crt","keyFile":"/etc/registry.key"}},"release":{"publicUrl":"https://old-release.example.com","listen":"127.0.0.1:9680","dataRoot":%q,"tokenSha256":"","tls":{"certificateFile":"/etc/release.crt","keyFile":"/etc/release.key"}},"share":{"publicUrl":"https://share.example.com","tls":{"certificateFile":"/etc/share.crt","keyFile":"/etc/share.key"}}}`, dataRoot)
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	var before map[string]any
	if err := json.Unmarshal([]byte(raw), &before); err != nil {
		t.Fatal(err)
	}

	digest := strings.Repeat("a", 64)
	if err := ConfigureTokenHash(path, digest); err != nil {
		t.Fatalf("ConfigureTokenHash() error = %v", err)
	}
	if err := ConfigurePublicURLWithDataRoot(path, "https://new-release.example.com/", newDataRoot); err != nil {
		t.Fatalf("ConfigurePublicURLWithDataRoot() error = %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var after map[string]any
	if err := json.Unmarshal(data, &after); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"schema", "acme", "log", "relay", "registry", "share"} {
		if !reflect.DeepEqual(after[key], before[key]) {
			t.Fatalf("Gateway section %q changed: before=%#v after=%#v", key, before[key], after[key])
		}
	}
	release, ok := after["release"].(map[string]any)
	if !ok {
		t.Fatalf("release section = %#v", after["release"])
	}
	if release["publicUrl"] != "https://new-release.example.com" || release["dataRoot"] != newDataRoot || release["tokenSha256"] != digest {
		t.Fatalf("updated release section = %#v", release)
	}
	if !reflect.DeepEqual(release["tls"], before["release"].(map[string]any)["tls"]) {
		t.Fatalf("release TLS changed: %#v", release["tls"])
	}
}

func TestMigrateLegacyConfigCreatesFullGatewayConfig(t *testing.T) {
	dir := t.TempDir()
	legacyPath := filepath.Join(dir, "release-server.json")
	gatewayPath := filepath.Join(dir, "gateway", "config.json")
	dataRoot := filepath.Join(dir, "data")
	legacy := Config{
		Schema:      1,
		Listen:      "127.0.0.1:9680",
		PublicURL:   "https://release.example.com",
		DataRoot:    dataRoot,
		TokenSHA256: strings.Repeat("b", 64),
	}
	if err := WriteConfig(legacyPath, legacy); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(gatewayPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := MigrateLegacyConfig(legacyPath, gatewayPath, dataRoot); err != nil {
		t.Fatalf("MigrateLegacyConfig() error = %v", err)
	}
	if _, err := LoadConfig(gatewayPath); err != nil {
		t.Fatalf("LoadConfig(migrated Gateway config) error = %v", err)
	}
	data, err := os.ReadFile(gatewayPath)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"schema", "acme", "log", "relay", "registry", "release", "share"} {
		if _, ok := document[key]; !ok {
			t.Fatalf("migrated Gateway config missing %q", key)
		}
	}
}

func TestConfigureTokenHashWritesOnlyDigest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := Config{
		Schema:    1,
		Listen:    "127.0.0.1:9680",
		PublicURL: "https://release.example.com",
		DataRoot:  filepath.Join(t.TempDir(), "data"),
	}
	if err := WriteConfig(path, cfg); err != nil {
		t.Fatal(err)
	}
	digest := strings.Repeat("a", 64)
	if err := ConfigureTokenHash(path, digest); err != nil {
		t.Fatalf("ConfigureTokenHash() error = %v", err)
	}
	got, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.TokenSHA256 != digest {
		t.Fatalf("tokenSha256 = %q, want %q", got.TokenSHA256, digest)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("Bearer")) || bytes.Contains(raw, []byte("release-token")) {
		t.Fatalf("config contains a raw token: %s", raw)
	}
}

func TestConfigurePublicURLUpgradesLegacyConfigWithoutChangingToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	dataRoot := filepath.Join(t.TempDir(), "data")
	digest := strings.Repeat("a", 64)
	legacy := fmt.Sprintf(
		`{"schema":1,"listen":"127.0.0.1:9680","dataRoot":%q,"tokenSha256":%q}`,
		dataRoot,
		digest,
	)
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ConfigurePublicURL(path, "https://release.example.com:8443/"); err != nil {
		t.Fatalf("ConfigurePublicURL() error = %v", err)
	}
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PublicURL != "https://release.example.com:8443" || cfg.DataRoot != dataRoot || cfg.TokenSHA256 != digest {
		t.Fatalf("config = %+v", cfg)
	}
}

func TestConfigRejectsInvalidPublicURL(t *testing.T) {
	for name, value := range map[string]string{
		"missing":     "",
		"credentials": "https://user@example.com",
		"path":        "https://example.com/releases",
		"query":       "https://example.com?x=1",
		"fragment":    "https://example.com#x",
		"scheme":      "ftp://example.com",
	} {
		t.Run(name, func(t *testing.T) {
			cfg := Config{Schema: 1, Listen: "127.0.0.1:9680", PublicURL: value, DataRoot: t.TempDir()}
			if err := cfg.Validate(); err == nil {
				t.Fatal("Validate() error = nil")
			}
		})
	}
}

func TestConfigRejectsUnknownFieldsAndInvalidBoundaries(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	absoluteRoot := filepath.Join(dir, "data")
	for name, raw := range map[string]string{
		"unknown field": fmt.Sprintf(
			`{"schema":1,"listen":"127.0.0.1:9680","publicUrl":"https://release.example.com","dataRoot":%q,"tokenSha256":"","extra":true}`,
			absoluteRoot,
		),
		"wrong listen": fmt.Sprintf(
			`{"schema":1,"listen":"0.0.0.0:9680","publicUrl":"https://release.example.com","dataRoot":%q,"tokenSha256":""}`,
			absoluteRoot,
		),
		"relative root": `{"schema":1,"listen":"127.0.0.1:9680","publicUrl":"https://release.example.com","dataRoot":"data","tokenSha256":""}`,
		"uppercase hash": fmt.Sprintf(
			`{"schema":1,"listen":"127.0.0.1:9680","publicUrl":"https://release.example.com","dataRoot":%q,"tokenSha256":"%s"}`,
			absoluteRoot,
			strings.Repeat("A", 64),
		),
	} {
		t.Run(name, func(t *testing.T) {
			if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := LoadConfig(path); err == nil {
				t.Fatal("LoadConfig() error = nil")
			}
		})
	}
}

func TestConfigModeAllowsOnlyRootWriteAndServiceGroupRead(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows does not report POSIX group mode bits")
	}
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := Config{Schema: 1, Listen: "127.0.0.1:9680", PublicURL: "https://release.example.com", DataRoot: t.TempDir()}
	if err := WriteConfig(path, cfg); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o640 {
		t.Fatalf("mode = %#o, want 0640", info.Mode().Perm())
	}
}
