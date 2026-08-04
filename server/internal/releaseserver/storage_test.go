package releaseserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeStorageStableFixture(t *testing.T, dataRoot string, version string) {
	t.Helper()
	sha := strings.Repeat("a", 64)
	stable := map[string]any{
		"schema":      2,
		"version":     version,
		"publishedAt": time.Now().UTC().Format(time.RFC3339),
		"sourceSha":   strings.Repeat("b", 40),
		"deploy": map[string]any{
			"mjsPath": "/releases/" + version + "/deploy.mjs", "mjsSha256": sha,
			"corePath": "/releases/" + version + "/deploy-core.mjs", "coreSha256": sha,
		},
		"release": map[string]any{
			"manifestPath": "/releases/" + version + "/release-manifest.json", "manifestSha256": sha,
		},
	}
	raw, err := json.Marshal(stable)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dataRoot, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataRoot, "public", "stable.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func writeStorageHistoryFixture(t *testing.T, dataRoot string, versions ...string) {
	t.Helper()
	entries := make([]map[string]any, 0, len(versions))
	for _, version := range versions {
		entries = append(entries, map[string]any{
			"version":        version,
			"publishedAt":    time.Now().UTC().Format(time.RFC3339),
			"sourceSha":      strings.Repeat("b", 40),
			"manifestSha256": strings.Repeat("a", 64),
			"assets":         []any{},
		})
	}
	raw, err := json.Marshal(map[string]any{"schema": 1, "releases": entries})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dataRoot, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataRoot, "public", "releases.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func writeStorageVersionDir(t *testing.T, dataRoot string, version string, size int) {
	t.Helper()
	directory := filepath.Join(dataRoot, "public", "releases", version)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "asset.bin"), make([]byte, size), 0o600); err != nil {
		t.Fatal(err)
	}
}

func newStorageTestHandler(t *testing.T, dataRoot string) *Server {
	t.Helper()
	handler, err := New(Config{Schema: 1, Listen: "127.0.0.1:9680", DataRoot: dataRoot, TokenSHA256: sha256String("release-token")})
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func storageAuthorizedRequest(method string, path string) *http.Request {
	request := httptest.NewRequest(method, path, nil)
	request.Header.Set("Authorization", "Bearer release-token")
	return request
}

func TestStorageReportsTotalAndReclaimableBytes(t *testing.T) {
	root := t.TempDir()
	writeStorageStableFixture(t, root, "v1.3")
	writeStorageHistoryFixture(t, root, "v1.1", "v1.2", "v1.3")
	writeStorageVersionDir(t, root, "v1.1", 100)
	writeStorageVersionDir(t, root, "v1.3", 300)
	writeStorageVersionDir(t, root, "v1.9", 200) // orphan: not referenced anywhere

	handler := newStorageTestHandler(t, root)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, storageAuthorizedRequest(http.MethodGet, "/api/storage"))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		TotalBytes       int64 `json:"totalBytes"`
		ReclaimableBytes int64 `json:"reclaimableBytes"`
		OrphanCount      int   `json:"orphanCount"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.TotalBytes != 600 || body.ReclaimableBytes != 200 || body.OrphanCount != 1 {
		t.Fatalf("storage = %+v, want total 600 reclaimable 200 orphans 1", body)
	}
}

func TestStorageRequiresPublisherToken(t *testing.T) {
	handler := newStorageTestHandler(t, t.TempDir())
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/storage", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
}

func TestStorageRejectsNonGetMethods(t *testing.T) {
	handler := newStorageTestHandler(t, t.TempDir())
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, storageAuthorizedRequest(http.MethodPost, "/api/storage"))
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", recorder.Code)
	}
}

func TestStorageTreatsDesktopAndAndroidPointerVersionsAsReferenced(t *testing.T) {
	root := t.TempDir()
	writeStorageStableFixture(t, root, "v1.3")
	// stable Desktop pointer references an older version directory
	stablePath := filepath.Join(root, "public", "stable.json")
	raw, err := os.ReadFile(stablePath)
	if err != nil {
		t.Fatal(err)
	}
	var stable map[string]any
	if err := json.Unmarshal(raw, &stable); err != nil {
		t.Fatal(err)
	}
	stable["desktopExe"] = map[string]any{
		"version": "v1.2", "path": "/releases/v1.2/WheelMakerDesktop.exe", "sha256": strings.Repeat("a", 64),
	}
	raw, err = json.Marshal(stable)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stablePath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	writeStorageVersionDir(t, root, "v1.2", 100)
	writeStorageVersionDir(t, root, "v1.3", 100)

	handler := newStorageTestHandler(t, root)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, storageAuthorizedRequest(http.MethodGet, "/api/storage"))
	var body struct {
		ReclaimableBytes int64 `json:"reclaimableBytes"`
		OrphanCount      int   `json:"orphanCount"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.ReclaimableBytes != 0 || body.OrphanCount != 0 {
		t.Fatalf("storage = %+v, want nothing reclaimable", body)
	}
}
