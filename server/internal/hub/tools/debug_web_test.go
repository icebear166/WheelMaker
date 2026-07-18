package tools

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestApplyDebugWebReplacesOnlyVerifiedArchive(t *testing.T) {
	archive := debugWebZip(t, map[string]string{"index.html": "new"})
	digest := debugWebDigest(archive)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/debug-web/current.json":
			fmt.Fprintf(w, `{"schema":1,"archivePath":"/debug-web/archives/%s.zip","size":%d,"sha256":"%s","publishedAt":"2026-07-19T00:00:00Z"}`, digest, len(archive), digest)
		case "/debug-web/archives/" + digest + ".zip":
			_, _ = w.Write(archive)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "web"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "web", "index.html"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := ApplyDebugWeb(context.Background(), root, server.URL, server.Client()); err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(filepath.Join(root, "web", "index.html"))
	if err != nil || string(bytes) != "new" {
		t.Fatalf("web=%q err=%v", bytes, err)
	}
}

func TestApplyDebugWebLeavesExistingWebOnDigestMismatch(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/debug-web/current.json" {
			_, _ = w.Write([]byte(`{"schema":1,"archivePath":"/debug-web/archives/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.zip","size":3,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","publishedAt":"2026-07-19T00:00:00Z"}`))
			return
		}
		_, _ = w.Write([]byte("bad"))
	}))
	defer server.Close()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "web"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "web", "index.html"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ApplyDebugWeb(context.Background(), root, server.URL, server.Client()); err == nil {
		t.Fatal("digest mismatch was accepted")
	}
	bytes, _ := os.ReadFile(filepath.Join(root, "web", "index.html"))
	if string(bytes) != "old" {
		t.Fatalf("old web was replaced: %q", bytes)
	}
}

func debugWebZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}
func debugWebDigest(bytes []byte) string {
	sum := sha256.Sum256(bytes)
	return hex.EncodeToString(sum[:])
}
