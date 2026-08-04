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
	writeStorageVersionDir(t, root, "v1.1", 100) // history alone does not protect a version
	writeStorageVersionDir(t, root, "v1.3", 300) // stable
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
	if body.TotalBytes != 600 || body.ReclaimableBytes != 300 || body.OrphanCount != 2 {
		t.Fatalf("storage = %+v, want total 600 reclaimable 300 orphans 2", body)
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

func TestPruneKeepsOnlyStableAndTrimsHistory(t *testing.T) {
	root := t.TempDir()
	writeStorageStableFixture(t, root, "v1.3")
	writeStorageHistoryFixture(t, root, "v1.1", "v1.3")
	writeStorageVersionDir(t, root, "v1.1", 100) // history alone does not protect a version
	writeStorageVersionDir(t, root, "v1.3", 100) // stable
	writeStorageVersionDir(t, root, "v1.7", 100) // orphan
	writeStorageVersionDir(t, root, "v1.9", 100) // orphan
	// a non-version directory must never be touched
	miscDir := filepath.Join(root, "public", "releases", "notes")
	if err := os.MkdirAll(miscDir, 0o755); err != nil {
		t.Fatal(err)
	}

	handler := newStorageTestHandler(t, root)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, storageAuthorizedRequest(http.MethodPost, "/api/prune"))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		OK           bool `json:"ok"`
		RemovedCount int  `json:"removedCount"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || body.RemovedCount != 3 {
		t.Fatalf("prune = %+v, want ok with 3 removals", body)
	}
	for _, kept := range []string{"v1.3", "notes"} {
		if _, err := os.Stat(filepath.Join(root, "public", "releases", kept)); err != nil {
			t.Fatalf("%s must be kept: %v", kept, err)
		}
	}
	for _, removed := range []string{"v1.1", "v1.7", "v1.9"} {
		if _, err := os.Stat(filepath.Join(root, "public", "releases", removed)); !os.IsNotExist(err) {
			t.Fatalf("%s must be removed", removed)
		}
	}
	// stable is untouched; history is trimmed to the stable entry only
	if _, err := os.Stat(filepath.Join(root, "public", "stable.json")); err != nil {
		t.Fatal(err)
	}
	var history releaseHistory
	readJSONTestFile(t, filepath.Join(root, "public", "releases.json"), &history)
	if history.Schema != 1 || len(history.Releases) != 1 || history.Releases[0].Version != "v1.3" {
		raw, _ := os.ReadFile(filepath.Join(root, "public", "releases.json"))
		t.Fatalf("history after prune = %s, want only v1.3", raw)
	}
}

func TestPruneKeepsStablePointerVersions(t *testing.T) {
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
	writeStorageHistoryFixture(t, root, "v1.1", "v1.2", "v1.3")
	writeStorageVersionDir(t, root, "v1.1", 100)
	writeStorageVersionDir(t, root, "v1.2", 100)
	writeStorageVersionDir(t, root, "v1.3", 100)

	handler := newStorageTestHandler(t, root)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, storageAuthorizedRequest(http.MethodPost, "/api/prune"))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "public", "releases", "v1.1")); !os.IsNotExist(err) {
		t.Fatal("v1.1 must be removed")
	}
	for _, kept := range []string{"v1.2", "v1.3"} {
		if _, err := os.Stat(filepath.Join(root, "public", "releases", kept)); err != nil {
			t.Fatalf("%s must be kept: %v", kept, err)
		}
	}
	var history releaseHistory
	readJSONTestFile(t, filepath.Join(root, "public", "releases.json"), &history)
	if len(history.Releases) != 2 || history.Releases[0].Version != "v1.2" || history.Releases[1].Version != "v1.3" {
		raw, _ := os.ReadFile(filepath.Join(root, "public", "releases.json"))
		t.Fatalf("history after prune = %s, want v1.2 and v1.3", raw)
	}
}

func TestPruneRefusesWhenStableIsMissing(t *testing.T) {
	root := t.TempDir()
	writeStorageHistoryFixture(t, root, "v1.1")
	writeStorageVersionDir(t, root, "v1.9", 100)

	handler := newStorageTestHandler(t, root)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, storageAuthorizedRequest(http.MethodPost, "/api/prune"))
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409, body = %s", recorder.Code, recorder.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "public", "releases", "v1.9")); err != nil {
		t.Fatal("orphan must survive when stable is missing")
	}
}

func TestPruneRefusesWhenStableIsCorrupt(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "public", "stable.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	writeStorageVersionDir(t, root, "v1.9", 100)

	handler := newStorageTestHandler(t, root)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, storageAuthorizedRequest(http.MethodPost, "/api/prune"))
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body = %s", recorder.Code, recorder.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "public", "releases", "v1.9")); err != nil {
		t.Fatal("orphan must survive when stable is corrupt")
	}
}

func TestPruneRequiresPublisherToken(t *testing.T) {
	handler := newStorageTestHandler(t, t.TempDir())
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/prune", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
}
