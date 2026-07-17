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
		Schema:   1,
		Listen:   "127.0.0.1:9680",
		DataRoot: filepath.Join(t.TempDir(), "release-data"),
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
		Schema:   1,
		Listen:   "127.0.0.1:9680",
		DataRoot: filepath.Join(t.TempDir(), "data"),
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

func TestConfigRejectsUnknownFieldsAndInvalidBoundaries(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	absoluteRoot := filepath.Join(dir, "data")
	for name, raw := range map[string]string{
		"unknown field": fmt.Sprintf(
			`{"schema":1,"listen":"127.0.0.1:9680","dataRoot":%q,"tokenSha256":"","extra":true}`,
			absoluteRoot,
		),
		"wrong listen": fmt.Sprintf(
			`{"schema":1,"listen":"0.0.0.0:9680","dataRoot":%q,"tokenSha256":""}`,
			absoluteRoot,
		),
		"relative root": `{"schema":1,"listen":"127.0.0.1:9680","dataRoot":"data","tokenSha256":""}`,
		"uppercase hash": fmt.Sprintf(
			`{"schema":1,"listen":"127.0.0.1:9680","dataRoot":%q,"tokenSha256":"%s"}`,
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
	cfg := Config{Schema: 1, Listen: "127.0.0.1:9680", DataRoot: t.TempDir()}
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
