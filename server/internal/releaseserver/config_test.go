package releaseserver

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
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
