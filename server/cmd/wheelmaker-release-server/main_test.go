package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/swm8023/wheelmaker/internal/releaseserver"
)

func TestRunConfigureTokenUpdatesOnlyDigest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := releaseserver.Config{
		Schema:   1,
		Listen:   "127.0.0.1:9680",
		DataRoot: filepath.Join(t.TempDir(), "data"),
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

func TestRunRejectsUnknownCommandAndRawTokenFlag(t *testing.T) {
	for name, args := range map[string][]string{
		"unknown command": {"rotate-token"},
		"raw token flag":  {"configure-token", "--config", "config.json", "--token", "release-token"},
	} {
		t.Run(name, func(t *testing.T) {
			if err := run(args, &bytes.Buffer{}, &bytes.Buffer{}); err == nil {
				t.Fatal("run() error = nil")
			}
		})
	}
}
