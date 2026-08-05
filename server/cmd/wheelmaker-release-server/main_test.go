package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/swm8023/wheelmaker/internal/releaseserver"
)

func TestRunConfigureTokenUpdatesOnlyDigest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := releaseserver.Config{
		Schema:    1,
		Listen:    "127.0.0.1:9680",
		PublicURL: "https://release.example.com",
		DataRoot:  filepath.Join(t.TempDir(), "data"),
	}
	if err := releaseserver.WriteConfig(path, cfg); err != nil {
		t.Fatal(err)
	}
	digest := strings.Repeat("b", 64)
	if err := run([]string{
		"configure-token", "--config", path, "--sha256", digest,
	}, &bytes.Buffer{}, &bytes.Buffer{}); err != nil {
		t.Fatalf("run() error = %v", err)
	}
	got, err := releaseserver.LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.TokenSHA256 != digest {
		t.Fatalf("tokenSha256 = %q", got.TokenSHA256)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("release-token")) {
		t.Fatal("raw token written to config")
	}
}

func TestRunConfigurePublicURLUpdatesOnlyOrigin(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	digest := strings.Repeat("b", 64)
	legacy := `{"schema":1,"listen":"127.0.0.1:9680","dataRoot":` + fmt.Sprintf("%q", t.TempDir()) + `,"tokenSha256":"` + digest + `"}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{
		"configure-public-url", "--config", path, "--public-url", "https://release.example.com:8443/",
	}, &bytes.Buffer{}, &bytes.Buffer{}); err != nil {
		t.Fatalf("run() error = %v", err)
	}
	cfg, err := releaseserver.LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PublicURL != "https://release.example.com:8443" || cfg.TokenSHA256 != digest {
		t.Fatalf("config = %+v", cfg)
	}
}

func TestRunValidateConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := releaseserver.Config{
		Schema:    1,
		Listen:    "127.0.0.1:9680",
		PublicURL: "https://release.example.com",
		DataRoot:  filepath.Join(t.TempDir(), "data"),
	}
	if err := releaseserver.WriteConfig(path, cfg); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"validate-config", "--config", path}, &bytes.Buffer{}, &bytes.Buffer{}); err != nil {
		t.Fatalf("valid config: run() error = %v", err)
	}
	if err := os.WriteFile(path, []byte(`{"schema":1,"listen":"invalid","dataRoot":"/tmp/data"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"validate-config", "--config", path}, &bytes.Buffer{}, &bytes.Buffer{}); err == nil {
		t.Fatal("invalid config: run() error = nil")
	}
}

func TestRunRejectsUnknownCommandAndRawTokenFlag(t *testing.T) {
	for name, args := range map[string][]string{
		"unknown command":  {"rotate-token"},
		"raw token flag":   {"configure-token", "--config", "config.json", "--token", "release-token"},
		"public URL extra": {"configure-public-url", "--config", "config.json", "--public-url", "https://example.com", "extra"},
	} {
		t.Run(name, func(t *testing.T) {
			if err := run(args, &bytes.Buffer{}, &bytes.Buffer{}); err == nil {
				t.Fatal("run() error = nil")
			}
		})
	}
}
