# Release 发布页配置归集与发布目录清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Release publishing 页的 Server Hub / Web Hub 合并上移到「Publishing source」卡片，并新增 release server 发布目录的占用展示与一键清理孤儿版本目录能力。

**Architecture:** 自底向上四层：release server 新增 `GET /api/storage` 与 `POST /api/prune`（Bearer token 鉴权，与 commit 共用 `commitMu`）；`scripts/release/` 新增 `storage.mjs` / `prune.mjs` 脚本入口（读取本地发布 token，stdout 打印 JSON）；发布 Hub `cmd.release` 新增 `storage` / `prune` 同步 action，Registry 新增 `release.storage.get` / `release.storage.prune` 方法复用 `RegistryRouteReleasePublish` 路由（不改 protocol version）；UI 配置归集 + 新增「Release storage」卡片。

**Tech Stack:** Go（release server、hub、registry，node:test 无关，Go testing）、Node.js ESM 脚本（node:test）、React + jest（react-test-renderer）。

**工作目录：** 所有改动都在 worktree `D:/Code/WheelMaker/.worktree/release-publish-storage` 中进行。

**Spec:** `docs/scope/2026-08-04-release-publish-storage/spec-release-publish-storage.md`（同目录）。

**关键既有约定：**

- Go 测试合并到现有 `*_test.go`；但 release server 新端点是全新模块，新建 `storage.go` + `storage_test.go` 合理。
- scripts 每个模块一个 `<name>.test.mjs`，用 `node --test`。
- app 测试用 jest：`cd app && npx jest <路径>`。
- release server 版本目录名必须匹配 `versionPattern`（`^v1\.(0|[1-9]\d*)$`，定义在 `server/internal/releaseserver/session.go:33`）。
- `releasePath(version, name)` 返回 `/releases/<version>/<name>`（`server/internal/releaseserver/commit.go:352`）。

---

### Task 1: Release server — storage 端点

**Files:**
- Create: `server/internal/releaseserver/storage.go`
- Modify: `server/internal/releaseserver/session.go`（`handleAPI` 路由，约 111-115 行处）
- Test: `server/internal/releaseserver/storage_test.go`（新建）

- [ ] **Step 1: 写失败测试**

新建 `server/internal/releaseserver/storage_test.go`：

```go
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/releaseserver/ -run TestStorage -v`
Expected: 编译失败，`/api/storage` 返回 404（`not_found`）。

- [ ] **Step 3: 实现 storage.go**

新建 `server/internal/releaseserver/storage.go`：

```go
package releaseserver

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
)

type storageResponse struct {
	TotalBytes       int64 `json:"totalBytes"`
	ReclaimableBytes int64 `json:"reclaimableBytes"`
	OrphanCount      int   `json:"orphanCount"`
}

type releaseVersionDir struct {
	version string
	size    int64
}

// referencedVersions returns every version that must keep its directory:
// the stable version, the versions pointed to by stable Desktop/Android
// pointers, and every version listed in the release history.
func (s *Server) referencedVersions() (map[string]bool, *stableDocument, error) {
	stable, err := s.readStable()
	if err != nil {
		return nil, nil, err
	}
	referenced := map[string]bool{}
	if stable != nil {
		referenced[stable.Version] = true
		if stable.Desktop != nil {
			referenced[stable.Desktop.Version] = true
		}
		if stable.Android != nil {
			referenced[stable.Android.Version] = true
		}
	}
	history, err := s.readHistory()
	if err != nil {
		return nil, nil, err
	}
	for _, entry := range history.Releases {
		referenced[entry.Version] = true
	}
	return referenced, stable, nil
}

func releaseDirectorySize(root string) (int64, error) {
	var total int64
	err := filepath.WalkDir(root, func(_ string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type().IsRegular() {
			info, infoErr := entry.Info()
			if infoErr != nil {
				return infoErr
			}
			total += info.Size()
		}
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	return total, err
}

func (s *Server) listReleaseVersionDirs() ([]releaseVersionDir, error) {
	root := filepath.Join(s.config.DataRoot, "public", "releases")
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var dirs []releaseVersionDir
	for _, entry := range entries {
		if !entry.IsDir() || !versionPattern.MatchString(entry.Name()) {
			continue
		}
		size, err := releaseDirectorySize(filepath.Join(root, entry.Name()))
		if err != nil {
			return nil, err
		}
		dirs = append(dirs, releaseVersionDir{version: entry.Name(), size: size})
	}
	return dirs, nil
}

func (s *Server) handleStorage(w http.ResponseWriter, _ *http.Request) {
	s.commitMu.Lock()
	defer s.commitMu.Unlock()
	referenced, _, err := s.referencedVersions()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_metadata_invalid")
		return
	}
	dirs, err := s.listReleaseVersionDirs()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_scan_failed")
		return
	}
	response := storageResponse{}
	for _, dir := range dirs {
		response.TotalBytes += dir.size
		if !referenced[dir.version] {
			response.ReclaimableBytes += dir.size
			response.OrphanCount++
		}
	}
	writeJSON(w, http.StatusOK, response)
}
```

在 `server/internal/releaseserver/session.go` 的 `handleAPI` 中，把路由加在 `s.handleDebugWebAPI(w, r)` 判断之后、`/api/publish/start` 判断之前：

```go
	if r.URL.Path == "/api/storage" {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return true
		}
		s.handleStorage(w, r)
		return true
	}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/releaseserver/ -v -run 'TestStorage'`
Expected: 4 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
cd server && go vet ./internal/releaseserver/
git add server/internal/releaseserver/storage.go server/internal/releaseserver/storage_test.go server/internal/releaseserver/session.go
git commit -m "feat(releaseserver): add release storage report endpoint"
```

---

### Task 2: Release server — prune 端点

**Files:**
- Modify: `server/internal/releaseserver/storage.go`
- Modify: `server/internal/releaseserver/session.go`（`handleAPI` 路由）
- Test: `server/internal/releaseserver/storage_test.go`（追加）

- [ ] **Step 1: 写失败测试**

在 `server/internal/releaseserver/storage_test.go` 追加：

```go
func TestPruneDeletesOnlyUnreferencedVersionDirs(t *testing.T) {
	root := t.TempDir()
	writeStorageStableFixture(t, root, "v1.3")
	writeStorageHistoryFixture(t, root, "v1.1", "v1.3")
	writeStorageVersionDir(t, root, "v1.1", 100) // referenced by history
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
	if !body.OK || body.RemovedCount != 2 {
		t.Fatalf("prune = %+v, want ok with 2 removals", body)
	}
	for _, kept := range []string{"v1.1", "v1.3", "notes"} {
		if _, err := os.Stat(filepath.Join(root, "public", "releases", kept)); err != nil {
			t.Fatalf("%s must be kept: %v", kept, err)
		}
	}
	for _, removed := range []string{"v1.7", "v1.9"} {
		if _, err := os.Stat(filepath.Join(root, "public", "releases", removed)); !os.IsNotExist(err) {
			t.Fatalf("%s must be removed", removed)
		}
	}
	// metadata files are untouched
	if _, err := os.Stat(filepath.Join(root, "public", "stable.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "public", "releases.json")); err != nil {
		t.Fatal(err)
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/releaseserver/ -run TestPrune -v`
Expected: FAIL —— `/api/prune` 返回 404。

- [ ] **Step 3: 实现 prune**

在 `server/internal/releaseserver/storage.go` 追加：

```go
type pruneResponse struct {
	OK           bool `json:"ok"`
	RemovedCount int  `json:"removedCount"`
}

func (s *Server) handlePrune(w http.ResponseWriter, _ *http.Request) {
	s.commitMu.Lock()
	defer s.commitMu.Unlock()
	referenced, stable, err := s.referencedVersions()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_metadata_invalid")
		return
	}
	if stable == nil {
		writeError(w, http.StatusConflict, "stable_missing")
		return
	}
	dirs, err := s.listReleaseVersionDirs()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_scan_failed")
		return
	}
	removed := 0
	for _, dir := range dirs {
		if referenced[dir.version] {
			continue
		}
		if err := os.RemoveAll(filepath.Join(s.config.DataRoot, "public", "releases", dir.version)); err != nil {
			writeError(w, http.StatusInternalServerError, "prune_failed")
			return
		}
		removed++
	}
	writeJSON(w, http.StatusOK, pruneResponse{OK: true, RemovedCount: removed})
}
```

在 `handleAPI` 的 `/api/storage` 路由块后面加：

```go
	if r.URL.Path == "/api/prune" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return true
		}
		s.handlePrune(w, r)
		return true
	}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/releaseserver/ -v -run 'TestStorage|TestPrune'`
Expected: 全部 PASS。再跑 `cd server && go test ./internal/releaseserver/` 确认整个包无回归。

- [ ] **Step 5: Commit**

```bash
git add server/internal/releaseserver/storage.go server/internal/releaseserver/storage_test.go server/internal/releaseserver/session.go
git commit -m "feat(releaseserver): add orphan release prune endpoint"
```

---

### Task 3: scripts — ReleaseServerApi.storage() / prune()

**Files:**
- Modify: `scripts/release/release-server-api.mjs`
- Test: `scripts/release/release-server-api.test.mjs`（追加）

- [ ] **Step 1: 写失败测试**

先看 `release-server-api.test.mjs` 里现有 `readStable` 的测试写法（用 `recordingHttpsRequest` 注入假 requestImpl）。在文件末尾追加：

```js
test('storage requests the storage report with the publishing token', async () => {
  const requests = [];
  const api = new ReleaseServerApi({
    baseUrl: 'https://release.example',
    token: 'token-1',
    requestImpl: recordingHttpsRequest(requests, [
      {status: 200, body: JSON.stringify({totalBytes: 600, reclaimableBytes: 200, orphanCount: 1})},
    ]),
  });
  const report = await api.storage();
  assert.deepEqual(report, {totalBytes: 600, reclaimableBytes: 200, orphanCount: 1});
  assert.equal(requests[0].url.pathname, '/api/storage');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer token-1');
});

test('prune posts to the prune endpoint', async () => {
  const requests = [];
  const api = new ReleaseServerApi({
    baseUrl: 'https://release.example',
    token: 'token-1',
    requestImpl: recordingHttpsRequest(requests, [
      {status: 200, body: JSON.stringify({ok: true, removedCount: 2})},
    ]),
  });
  const result = await api.prune();
  assert.deepEqual(result, {ok: true, removedCount: 2});
  assert.equal(requests[0].url.pathname, '/api/prune');
  assert.equal(requests[0].options.method, 'POST');
});

test('storage surfaces server error codes', async () => {
  const api = new ReleaseServerApi({
    baseUrl: 'https://release.example',
    token: 'token-1',
    requestImpl: recordingHttpsRequest([], [{status: 401, body: JSON.stringify({error: 'unauthorized'})}]),
  });
  await assert.rejects(() => api.storage(), /publishing token was rejected/);
});
```

注意：以上断言里的 `recordingHttpsRequest` 签名与 record 结构以测试文件现有实现为准（现有 `readStable` 测试怎么写就怎么写）；若 record 结构不同（例如 `record.url` / `record.options`），按现有结构改写断言。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/release/release-server-api.test.mjs`
Expected: FAIL —— `api.storage is not a function`。

- [ ] **Step 3: 实现 API 方法**

在 `scripts/release/release-server-api.mjs` 的 `readStable()` 方法后面加：

```js
  storage() {
    return this.request('/api/storage', {
      method: 'GET',
    });
  }

  prune() {
    return this.request('/api/prune', {
      method: 'POST',
    });
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test scripts/release/release-server-api.test.mjs`
Expected: 全部 PASS（含既有用例）。

- [ ] **Step 5: Commit**

```bash
git add scripts/release/release-server-api.mjs scripts/release/release-server-api.test.mjs
git commit -m "feat(release): add storage and prune release server client methods"
```

---

### Task 4: scripts — storage.mjs / prune.mjs 入口

**Files:**
- Create: `scripts/release/storage.mjs`
- Create: `scripts/release/storage.test.mjs`
- Create: `scripts/release/prune.mjs`
- Create: `scripts/release/prune.test.mjs`

两个脚本都在发布 Hub 上由 `cmd.release` 以 `node scripts/release/storage.mjs`（cwd = sourcePath 检出根）方式运行；baseUrl 从同目录 `channel.json` 读取，token 用 `readConfiguredPublisherToken`（不做首次配置，未配置直接报错）；结果 JSON 打印到 stdout 最后一行供 Hub 解析。

- [ ] **Step 1: 写失败测试**

新建 `scripts/release/storage.test.mjs`：

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {runReleaseStorage} from './storage.mjs';

test('runReleaseStorage prints the report as a JSON line', async () => {
  const lines = [];
  const report = {totalBytes: 600, reclaimableBytes: 200, orphanCount: 1};
  const result = await runReleaseStorage({
    api: {storage: async () => report},
    write: line => lines.push(line),
  });
  assert.deepEqual(result, report);
  assert.deepEqual(lines, [`${JSON.stringify(report)}\n`]);
});

test('runReleaseStorage propagates api failure without printing', async () => {
  const lines = [];
  await assert.rejects(
    () => runReleaseStorage({
      api: {storage: async () => { throw new Error('unauthorized'); }},
      write: line => lines.push(line),
    }),
    /unauthorized/,
  );
  assert.deepEqual(lines, []);
});
```

新建 `scripts/release/prune.test.mjs`：

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {runReleasePrune} from './prune.mjs';

test('runReleasePrune prints the result as a JSON line', async () => {
  const lines = [];
  const report = {ok: true, removedCount: 2};
  const result = await runReleasePrune({
    api: {prune: async () => report},
    write: line => lines.push(line),
  });
  assert.deepEqual(result, report);
  assert.deepEqual(lines, [`${JSON.stringify(report)}\n`]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/release/storage.test.mjs scripts/release/prune.test.mjs`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现两个入口**

新建 `scripts/release/storage.mjs`：

```js
import {readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {validateReleaseChannel} from './channel.mjs';
import {
  createPublisherConfigDependencies,
  readConfiguredPublisherToken,
} from './publisher-config.mjs';
import {ReleaseServerApi} from './release-server-api.mjs';

export async function runReleaseStorage({api, write = line => process.stdout.write(line)}) {
  const report = await api.storage();
  write(`${JSON.stringify(report)}\n`);
  return report;
}

async function createStorageApi() {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const channel = validateReleaseChannel(JSON.parse(
    await readFile(join(moduleDirectory, 'channel.json'), 'utf8'),
  ));
  const token = await readConfiguredPublisherToken(
    createPublisherConfigDependencies({baseUrl: channel.baseUrl}),
  );
  return new ReleaseServerApi({baseUrl: channel.baseUrl, token});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReleaseStorage({api: await createStorageApi()}).catch(error => {
    process.stderr.write(`[release-storage] ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
```

新建 `scripts/release/prune.mjs`（结构相同，调用 `api.prune()`）：

```js
import {readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {validateReleaseChannel} from './channel.mjs';
import {
  createPublisherConfigDependencies,
  readConfiguredPublisherToken,
} from './publisher-config.mjs';
import {ReleaseServerApi} from './release-server-api.mjs';

export async function runReleasePrune({api, write = line => process.stdout.write(line)}) {
  const report = await api.prune();
  write(`${JSON.stringify(report)}\n`);
  return report;
}

async function createPruneApi() {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const channel = validateReleaseChannel(JSON.parse(
    await readFile(join(moduleDirectory, 'channel.json'), 'utf8'),
  ));
  const token = await readConfiguredPublisherToken(
    createPublisherConfigDependencies({baseUrl: channel.baseUrl}),
  );
  return new ReleaseServerApi({baseUrl: channel.baseUrl, token});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReleasePrune({api: await createPruneApi()}).catch(error => {
    process.stderr.write(`[release-prune] ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test scripts/release/storage.test.mjs scripts/release/prune.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add scripts/release/storage.mjs scripts/release/storage.test.mjs scripts/release/prune.mjs scripts/release/prune.test.mjs
git commit -m "feat(release): add storage and prune script entries"
```

---

### Task 5: Hub — cmd.release storage / prune action

**Files:**
- Modify: `server/internal/hub/tools/release.go`
- Test: `server/internal/hub/tools/tools_test.go`（追加）

- [ ] **Step 1: 写失败测试**

在 `server/internal/hub/tools/tools_test.go` 追加（需要一个同步返回预设输出的 runner）：

```go
type stubReleaseRunner struct {
	output string
	err    error
	calls  []releaseRunnerCall
}

func (r *stubReleaseRunner) Run(_ context.Context, workingDir string, args []string, log func(string)) error {
	r.calls = append(r.calls, releaseRunnerCall{WorkingDir: workingDir, Args: append([]string(nil), args...)})
	if r.output != "" {
		log(r.output)
	}
	return r.err
}

func makeReleaseSourceDir(t *testing.T) string {
	t.Helper()
	source := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "scripts", "release.mjs"), []byte("// test"), 0o600); err != nil {
		t.Fatal(err)
	}
	return source
}

func TestReleaseCommandStorageRunsScriptAndParsesReport(t *testing.T) {
	source := makeReleaseSourceDir(t)
	runner := &stubReleaseRunner{output: `{"totalBytes":600,"reclaimableBytes":200,"orphanCount":1}` + "\n"}
	command := newReleaseCommandWithDependencies(t.TempDir(), runner, nil)

	response, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "storage", "hubId": "publisher-hub", "sourcePath": source,
	}))
	if commandErr != nil {
		t.Fatalf("Handle() error=%v", commandErr)
	}
	body := response.(releaseCommandResponse)
	if !body.OK || body.Storage == nil {
		t.Fatalf("response=%#v", body)
	}
	if body.Storage.TotalBytes != 600 || body.Storage.ReclaimableBytes != 200 || body.Storage.OrphanCount != 1 {
		t.Fatalf("storage=%#v", body.Storage)
	}
	if len(runner.calls) != 1 || runner.calls[0].WorkingDir != source || runner.calls[0].Args[0] != "scripts/release/storage.mjs" {
		t.Fatalf("runner calls=%#v", runner.calls)
	}
}

func TestReleaseCommandPruneRunsScriptAndReturnsRemovedCount(t *testing.T) {
	source := makeReleaseSourceDir(t)
	runner := &stubReleaseRunner{output: `{"ok":true,"removedCount":2}` + "\n"}
	command := newReleaseCommandWithDependencies(t.TempDir(), runner, nil)

	response, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "prune", "hubId": "publisher-hub", "sourcePath": source,
	}))
	if commandErr != nil {
		t.Fatalf("Handle() error=%v", commandErr)
	}
	body := response.(releaseCommandResponse)
	if !body.OK || body.RemovedCount != 2 {
		t.Fatalf("response=%#v", body)
	}
	if runner.calls[0].Args[0] != "scripts/release/prune.mjs" {
		t.Fatalf("runner calls=%#v", runner.calls)
	}
}

func TestReleaseCommandStorageRequiresValidSourcePath(t *testing.T) {
	command := newReleaseCommandWithDependencies(t.TempDir(), &stubReleaseRunner{}, nil)
	_, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "storage", "hubId": "publisher-hub", "sourcePath": t.TempDir(),
	}))
	if commandErr == nil || commandErr.Code != rp.CodeInvalidArgument {
		t.Fatalf("error=%v, want INVALID_ARGUMENT", commandErr)
	}
}

func TestReleaseCommandStorageFailsWhenScriptHasNoResult(t *testing.T) {
	source := makeReleaseSourceDir(t)
	runner := &stubReleaseRunner{output: "some log noise\n"}
	command := newReleaseCommandWithDependencies(t.TempDir(), runner, nil)
	_, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "storage", "hubId": "publisher-hub", "sourcePath": source,
	}))
	if commandErr == nil || commandErr.Code != rp.CodeInternal {
		t.Fatalf("error=%v, want INTERNAL", commandErr)
	}
}

func TestReleaseCommandStoragePropagatesScriptFailure(t *testing.T) {
	source := makeReleaseSourceDir(t)
	runner := &stubReleaseRunner{err: errors.New("exit code 1"), output: "[release-storage] unauthorized\n"}
	command := newReleaseCommandWithDependencies(t.TempDir(), runner, nil)
	_, commandErr := command.Handle(context.Background(), rawToolPayload(t, map[string]any{
		"action": "storage", "hubId": "publisher-hub", "sourcePath": source,
	}))
	if commandErr == nil || commandErr.Code != rp.CodeInternal {
		t.Fatalf("error=%v, want INTERNAL", commandErr)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/hub/tools/ -run 'TestReleaseCommandStorage|TestReleaseCommandPrune' -v`
Expected: FAIL —— `unsupported cmd.release action`。

- [ ] **Step 3: 实现 action**

修改 `server/internal/hub/tools/release.go`：

1) `releaseCommandResponse` 增加字段：

```go
type releaseCommandResponse struct {
	OK           bool                `json:"ok"`
	Accepted     bool                `json:"accepted,omitempty"`
	Status       string              `json:"status"`
	Job          *ReleasePublishJob  `json:"job,omitempty"`
	Storage      *releaseStorageInfo `json:"storage,omitempty"`
	RemovedCount int                 `json:"removedCount,omitempty"`
}

type releaseStorageInfo struct {
	TotalBytes       int64 `json:"totalBytes"`
	ReclaimableBytes int64 `json:"reclaimableBytes"`
	OrphanCount      int   `json:"orphanCount"`
}
```

2) `Handle` 的 action switch 增加两个分支：

```go
	case "storage":
		return c.storage(payload)
	case "prune":
		return c.prune(payload)
```

3) 新增方法：

```go
func (c *ReleaseCommand) storage(payload releaseCommandPayload) (releaseCommandResponse, *releaseCommandError) {
	sourcePath, err := releaseSourcePath(payload.SourcePath, "version")
	if err != nil {
		return releaseCommandResponse{}, &releaseCommandError{Code: rp.CodeInvalidArgument, Message: err.Error()}
	}
	var info releaseStorageInfo
	if err := c.runReleaseResultScript(sourcePath, "scripts/release/storage.mjs", &info); err != nil {
		return releaseCommandResponse{}, &releaseCommandError{Code: rp.CodeInternal, Message: err.Error()}
	}
	return releaseCommandResponse{OK: true, Status: "success", Storage: &info}, nil
}

func (c *ReleaseCommand) prune(payload releaseCommandPayload) (releaseCommandResponse, *releaseCommandError) {
	sourcePath, err := releaseSourcePath(payload.SourcePath, "version")
	if err != nil {
		return releaseCommandResponse{}, &releaseCommandError{Code: rp.CodeInvalidArgument, Message: err.Error()}
	}
	var result struct {
		RemovedCount int `json:"removedCount"`
	}
	if err := c.runReleaseResultScript(sourcePath, "scripts/release/prune.mjs", &result); err != nil {
		return releaseCommandResponse{}, &releaseCommandError{Code: rp.CodeInternal, Message: err.Error()}
	}
	return releaseCommandResponse{OK: true, Status: "success", RemovedCount: result.RemovedCount}, nil
}

// runReleaseResultScript runs a release script that prints its result as a
// single JSON line on stdout and decodes that line. It shares the build
// mutex so it cannot overlap a running publish build.
func (c *ReleaseCommand) runReleaseResultScript(sourcePath, script string, out any) error {
	c.buildMu.Lock()
	defer c.buildMu.Unlock()
	var output strings.Builder
	if err := c.runner.Run(context.Background(), sourcePath, []string{script}, func(text string) {
		output.WriteString(text)
	}); err != nil {
		return err
	}
	lines := strings.Split(output.String(), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		if err := json.Unmarshal([]byte(line), out); err == nil {
			return nil
		}
	}
	return errors.New("release script did not report a result")
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/hub/tools/ -v -run 'TestReleaseCommand'`
Expected: 全部 PASS（含既有用例）。

- [ ] **Step 5: Commit**

```bash
cd server && go vet ./internal/hub/tools/
git add server/internal/hub/tools/release.go server/internal/hub/tools/tools_test.go
git commit -m "feat(hub): add release storage and prune commands"
```

---

### Task 6: Protocol / Registry / Hub reporter 方法接线

**Files:**
- Modify: `server/internal/protocol/registry_methods.go`（常量区约 60 行、descriptor map 约 190 行）
- Modify: `server/internal/hub/reporter.go`（约 749-752 行）
- Test: `server/internal/protocol/registry_methods_test.go`（追加新测试）
- Test: `server/internal/registry/server_test.go`（追加路由测试）

- [ ] **Step 1: 写失败测试**

在 `server/internal/protocol/registry_methods_test.go` 追加：

```go
func TestReleaseStorageMethodsAreRegisteredWithoutVersionChange(t *testing.T) {
	for _, method := range []string{
		RegistryMethodReleaseStorageGet,
		RegistryMethodReleaseStoragePrune,
	} {
		desc, ok := RegistryMethod(method)
		if !ok {
			t.Fatalf("%s is not registered", method)
		}
		if !desc.RequiresHubID {
			t.Fatalf("%s must require hubId", method)
		}
		if desc.Route != RegistryRouteReleasePublish {
			t.Fatalf("%s route=%q, want %q", method, desc.Route, RegistryRouteReleasePublish)
		}
		if !RegistryMethodAllowed(string(RegistryRoleClient), method) {
			t.Fatalf("%s must allow client role", method)
		}
	}
	if DefaultProtocolVersion != "2.7" {
		t.Fatalf("protocol version = %q, want 2.7", DefaultProtocolVersion)
	}
}
```

在 `server/internal/registry/server_test.go` 的 `TestReleasePublishRequestRoutesToPublishingHub` 后面追加：

```go
func TestReleaseStorageRequestRoutesToPublishingHub(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialReportedHub(t, ts.URL+"/ws", "publisher")
	defer hub.Close()
	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	payload := map[string]any{"sourcePath": "D:/Code/WheelMaker"}
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    rp.RegistryMethodReleaseStorageGet,
		HubID:     "publisher",
		Payload:   payload,
	})
	_ = hub.SetReadDeadline(time.Now().Add(2 * time.Second))
	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Method != rp.RegistryMethodReleaseStorageGet || forwarded.HubID != "publisher" {
		t.Fatalf("forwarded = %#v", forwarded)
	}
	if !reflect.DeepEqual(forwarded.Payload, payload) {
		t.Fatalf("forwarded payload = %#v, want %#v", forwarded.Payload, payload)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwarded.RequestID,
		Type:      "response",
		Method:    rp.RegistryMethodReleaseStorageGet,
		HubID:     "publisher",
		Payload:   map[string]any{"ok": true, "storage": map[string]any{"totalBytes": 600}},
	})
	response := mustReadEnvelope(t, client)
	if response.RequestID != 3 || response.Method != rp.RegistryMethodReleaseStorageGet {
		t.Fatalf("response = %#v", response)
	}
	if response.Payload["ok"] != true {
		t.Fatalf("response payload = %#v", response.Payload)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/protocol/ -run TestReleaseStorage -v && go test ./internal/registry/ -run TestReleaseStorage -v`
Expected: FAIL —— `RegistryMethodReleaseStorageGet` 未定义 / 未注册。

- [ ] **Step 3: 实现接线**

`server/internal/protocol/registry_methods.go` 常量区（`RegistryMethodReleasePublishUpdated` 后）：

```go
	RegistryMethodReleaseStorageGet         = "release.storage.get"
	RegistryMethodReleaseStoragePrune       = "release.storage.prune"
```

descriptor map（`RegistryMethodReleasePublishUpdated` 条目后）：

```go
	RegistryMethodReleaseStorageGet:              registryReleasePublishMethod(RegistryMethodReleaseStorageGet, RegistryRoleClient, RegistryRouteReleasePublish),
	RegistryMethodReleaseStoragePrune:            registryReleasePublishMethod(RegistryMethodReleaseStoragePrune, RegistryRoleClient, RegistryRouteReleasePublish),
```

`server/internal/hub/reporter.go`（`replyReleasePublish` 的两个 case 后）：

```go
	case rp.RegistryMethodReleaseStorageGet:
		r.replyReleasePublish(conn, in, "storage")
	case rp.RegistryMethodReleaseStoragePrune:
		r.replyReleasePublish(conn, in, "prune")
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/protocol/ ./internal/registry/ ./internal/hub/...`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go server/internal/registry/server_test.go server/internal/hub/reporter.go
git commit -m "feat(registry): route release storage and prune methods"
```

---

### Task 7: Web registry 层（methods / types / repository / service）

**Files:**
- Modify: `app/web/src/registry/registryMethods.ts`（约 81-83 行）
- Modify: `app/web/src/registry/registryTypes.ts`（`RegistryReleasePublishResponse` 附近，约 252 行）
- Modify: `app/web/src/registry/RegistryRepository.ts`（约 2503-2511 行 `queryReleasePublish` 后）
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`（约 1090-1092 行 `queryReleasePublish` 后）
- Test: `app/web/src/registry/releasePublishState.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

在 `app/web/src/registry/releasePublishState.test.ts` 追加：

```ts
test('queries release storage through the registry', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const repository = new RegistryRepository({
    request: async (input: Record<string, unknown>) => {
      requests.push(input);
      return {payload: {ok: true, status: 'success', storage: {totalBytes: 600, reclaimableBytes: 200, orphanCount: 1}}};
    },
  } as any);

  const result = await repository.queryReleaseStorage('publisher', '/src/WheelMaker');
  expect(result.ok).toBe(true);
  expect(result.storage).toEqual({totalBytes: 600, reclaimableBytes: 200, orphanCount: 1});
  expect(requests[0]).toMatchObject({
    method: 'release.storage.get',
    hubId: 'publisher',
    payload: {sourcePath: '/src/WheelMaker'},
  });
});

test('prunes release storage through the registry', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const repository = new RegistryRepository({
    request: async (input: Record<string, unknown>) => {
      requests.push(input);
      return {payload: {ok: true, status: 'success', removedCount: 2}};
    },
  } as any);

  const result = await repository.pruneReleaseStorage('publisher', '/src/WheelMaker');
  expect(result.ok).toBe(true);
  expect(result.removedCount).toBe(2);
  expect(requests[0]).toMatchObject({
    method: 'release.storage.prune',
    hubId: 'publisher',
    payload: {sourcePath: '/src/WheelMaker'},
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx jest web/src/registry/releasePublishState.test.ts`
Expected: FAIL —— `repository.queryReleaseStorage is not a function`。

- [ ] **Step 3: 实现**

`app/web/src/registry/registryMethods.ts`（`ReleasePublishUpdated` 后）：

```ts
  ReleaseStorageGet: 'release.storage.get',
  ReleaseStoragePrune: 'release.storage.prune',
```

`app/web/src/registry/registryTypes.ts`（`RegistryReleasePublishResponse` 后）：

```ts
export interface RegistryReleaseStorageInfo {
  totalBytes: number;
  reclaimableBytes: number;
  orphanCount: number;
}

export interface RegistryReleaseStorageResponse {
  ok: boolean;
  status: string;
  error?: string;
  storage?: RegistryReleaseStorageInfo;
  removedCount?: number;
}
```

`app/web/src/registry/RegistryRepository.ts`（`queryReleasePublish` 后）：

```ts
  async queryReleaseStorage(hubId: string, sourcePath: string): Promise<RegistryReleaseStorageResponse> {
    const response = await this.client.request({
      method: RegistryMethods.ReleaseStorageGet,
      hubId,
      payload: {sourcePath},
      timeoutMs: 60000,
    });
    return response.payload as RegistryReleaseStorageResponse;
  }

  async pruneReleaseStorage(hubId: string, sourcePath: string): Promise<RegistryReleaseStorageResponse> {
    const response = await this.client.request({
      method: RegistryMethods.ReleaseStoragePrune,
      hubId,
      payload: {sourcePath},
      timeoutMs: 60000,
    });
    return response.payload as RegistryReleaseStorageResponse;
  }
```

同时在文件顶部 import 处把 `RegistryReleaseStorageResponse` 加入类型导入。

`app/web/src/registry/RegistryWorkspaceService.ts`（`queryReleasePublish` 后，模仿其包装方式）：

```ts
  async queryReleaseStorage(hubId: string, sourcePath: string): Promise<RegistryReleaseStorageResponse> {
    return this.repository.queryReleaseStorage(hubId, sourcePath);
  }

  async pruneReleaseStorage(hubId: string, sourcePath: string): Promise<RegistryReleaseStorageResponse> {
    return this.repository.pruneReleaseStorage(hubId, sourcePath);
  }
```

同样补类型导入（`RegistryReleaseStorageResponse`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && npx jest web/src/registry/releasePublishState.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/registry/registryMethods.ts app/web/src/registry/registryTypes.ts app/web/src/registry/RegistryRepository.ts app/web/src/registry/RegistryWorkspaceService.ts app/web/src/registry/releasePublishState.test.ts
git commit -m "feat(web): add release storage registry client methods"
```

---

### Task 8: UI — 配置归集（合并 Server Hub / Web Hub）

**Files:**
- Modify: `app/web/src/settings/ReleasePublishSettings.tsx`
- Test: `app/web/src/settings/ReleasePublishSettings.test.tsx`

改动点：

- `Settings` 删除 `webHubId` 字段；`load()` 做旧设置迁移（`serverHubId || webHubId`）。
- Server Hub 下拉 + Auto pull 复选框从「Version release」卡移到「Publishing source」卡（Source path 之后）。
- 「Temporary Web」卡删除 Web Hub 下拉；debugWeb 的 `webHubId` 改用 `settings.serverHubId`；`canStartDebugWeb` 改依赖 `settings.serverHubId`。
- 确认对话框 `releasePublish` target 的 `webHubId` 字段保留（`AppDialogs.tsx` 不动），传 `settings.serverHubId`。

- [ ] **Step 1: 更新既有测试并加迁移测试**

`ReleasePublishSettings.test.tsx` 中：

1) `'sends temporary Web directly to the selected Web Hub'` 改名 `'sends temporary Web to the configured Server Hub'`，期望值从 `webHubId: 'web-server'` 改为 `webHubId: 'release-server'`（localStorage 里同时有 serverHubId 与 webHubId 时 serverHubId 生效）：

```ts
  expect(start).toHaveBeenCalledWith('publisher', {
    kind: 'debugWeb',
    sourcePath: '/src/WheelMaker',
    webHubId: 'release-server',
  });
```

2) `'requires a Web Hub only for temporary Web publishing'` 改名 `'requires a Server Hub only for temporary Web publishing'`，断言 `toContain('Web Hub')` 改为 `toContain('Server Hub')`；并在 Publishing source 卡里出现（通过 select 数量/label 断言，保持现有宽松断言风格即可）。

3) 追加迁移测试：

```tsx
test('migrates a legacy Web Hub setting into the Server Hub field', async () => {
  const values = new Map<string, string>();
  values.set('wheelmaker.settings.release-publish.v1', JSON.stringify({
    publisherHubId: 'publisher',
    sourcePath: '/src/WheelMaker',
    webHubId: 'web-server',
  }));
  (global as typeof globalThis & {window: Window}).window = {
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    setInterval: () => 1,
    clearInterval: () => undefined,
  } as unknown as Window;
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<ReleasePublishSettings
      hubIds={['publisher', 'web-server']}
      start={async () => ({ok: true, status: 'running'})}
      query={async () => ({ok: true, status: 'running'})}
      queryStorage={async () => ({ok: true, status: 'success', storage: {totalBytes: 0, reclaimableBytes: 0, orphanCount: 0}})}
      pruneStorage={async () => ({ok: true, status: 'success'})}
    />);
  });
  const selects = tree!.root.findAllByType('select');
  expect(selects.some(select => select.props.value === 'web-server')).toBe(true);
  const persisted = JSON.parse(values.get('wheelmaker.settings.release-publish.v1')!);
  expect(persisted.serverHubId).toBe('web-server');
  expect('webHubId' in persisted).toBe(false);
  tree!.unmount();
});
```

（`queryStorage` / `pruneStorage` props 在 Task 9 才加入组件并设为必传；本任务的测试先行传入它们是无害的——测试文件带 `// @ts-nocheck`，jest 不做属性检查。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx jest web/src/settings/ReleasePublishSettings.test.tsx`
Expected: 迁移测试 FAIL（`web-server` 未被采用）。

- [ ] **Step 3: 实现配置归集**

`ReleasePublishSettings.tsx`：

1) `Settings` 类型与 `empty` 删除 `webHubId`；`load()` 改为：

```ts
function load(): Settings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '{}') as Record<string, unknown>;
    const merged = {...empty, ...parsed} as Settings & {webHubId?: string};
    if (!merged.serverHubId && typeof merged.webHubId === 'string' && merged.webHubId) {
      merged.serverHubId = merged.webHubId;
    }
    delete merged.webHubId;
    return merged;
  } catch {
    return empty;
  }
}
```

2) 把 Server Hub `set-field` 与 Auto pull `release-publish-check` 两个块从「Version release」卡剪切到「Publishing source」卡的 Source path `set-field` 之后。

3) 「Temporary Web」卡删除 Web Hub `set-field` 块。

4) `submit` 的 debugWeb 分支改为：

```ts
        : {kind, sourcePath: settings.sourcePath, webHubId: settings.serverHubId};
```

5) `requestPublish` 的 debugWeb 守卫改为 `if (kind === 'debugWeb' && !settings.serverHubId) return;`；`setConfirmTarget` 里 `webHubId: settings.serverHubId`。

6) `canStartDebugWeb` 改为：

```ts
  const canStartDebugWeb = Boolean(settings.publisherHubId && settings.sourcePath && settings.serverHubId) && !pending;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && npx jest web/src/settings/ReleasePublishSettings.test.tsx`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/settings/ReleasePublishSettings.tsx app/web/src/settings/ReleasePublishSettings.test.tsx
git commit -m "feat(web): consolidate release publish hub settings"
```

---

### Task 9: UI — Release storage 卡片

**Files:**
- Modify: `app/web/src/settings/ReleasePublishSettings.tsx`
- Modify: `app/web/src/shell/AppDialogs.tsx`（ConfirmTarget 新 variant + 文案）
- Test: `app/web/src/settings/ReleasePublishSettings.test.tsx`（追加）

- [ ] **Step 1: 写失败测试**

追加（组件挂载自动加载、清理确认流、孤儿为 0 时禁用）：

```tsx
function renderWithStorage({
  storageResult = {ok: true, status: 'success', storage: {totalBytes: 2048, reclaimableBytes: 1024, orphanCount: 1}},
  pruneResult = {ok: true, status: 'success', removedCount: 1},
  settings = {publisherHubId: 'publisher', sourcePath: '/src/WheelMaker'},
} = {}) {
  const values = new Map<string, string>();
  values.set('wheelmaker.settings.release-publish.v1', JSON.stringify(settings));
  (global as typeof globalThis & {window: Window}).window = {
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)},
    setInterval: () => 1,
    clearInterval: () => undefined,
  } as unknown as Window;
  const queryStorage = jest.fn(async () => storageResult);
  const pruneStorage = jest.fn(async () => pruneResult);
  return {
    queryStorage,
    pruneStorage,
    async render() {
      let tree: ReturnType<typeof create>;
      await act(async () => {
        tree = create(<ReleasePublishSettings
          hubIds={['publisher']}
          start={async () => ({ok: true, status: 'running'})}
          query={async () => ({ok: true, status: 'running'})}
          queryStorage={queryStorage}
          pruneStorage={pruneStorage}
        />);
        await Promise.resolve();
      });
      return tree!;
    },
  };
}

test('loads release storage on mount and shows totals', async () => {
  const {queryStorage, render} = renderWithStorage();
  const tree = await render();
  expect(queryStorage).toHaveBeenCalledWith('publisher', '/src/WheelMaker');
  const text = JSON.stringify(tree.toJSON());
  expect(text).toContain('Release storage');
  expect(text).toContain('2.0 KB');
  expect(text).toContain('1.0 KB');
  tree.unmount();
});

test('prunes unreferenced versions after confirmation and refreshes', async () => {
  const {queryStorage, pruneStorage, render} = renderWithStorage();
  const tree = await render();
  const cleanupButton = tree.root.findAllByType('button').find(item =>
    item.children.some(child => typeof child === 'string' && child.includes('Clean up')))!;
  await act(async () => { cleanupButton.props.onClick(); await Promise.resolve(); });
  const confirmButton = tree.root.findAllByType('button').find(item =>
    item.children.some(child => typeof child === 'string' && child.trim() === 'Clean up'))!;
  await act(async () => { confirmButton.props.onClick(); await Promise.resolve(); await Promise.resolve(); });
  expect(pruneStorage).toHaveBeenCalledWith('publisher', '/src/WheelMaker');
  expect(queryStorage.mock.calls.length).toBeGreaterThanOrEqual(2);
  tree.unmount();
});

test('disables cleanup when there is nothing to reclaim', async () => {
  const {render} = renderWithStorage({
    storageResult: {ok: true, status: 'success', storage: {totalBytes: 100, reclaimableBytes: 0, orphanCount: 0}},
  });
  const tree = await render();
  const cleanupButton = tree.root.findAllByType('button').find(item =>
    item.children.some(child => typeof child === 'string' && child.includes('Clean up')))!;
  expect(cleanupButton.props.disabled).toBe(true);
  tree.unmount();
});

test('shows storage errors in the page', async () => {
  const {render} = renderWithStorage({
    storageResult: {ok: false, status: 'failed', error: 'release token is not configured'},
  });
  const tree = await render();
  expect(JSON.stringify(tree.toJSON())).toContain('release token is not configured');
  tree.unmount();
});
```

同时更新 `'uses a single-column publish page layout'`：sections 期望改为 `['Publishing source', 'Version release', 'Temporary Web', 'Release storage']`，`release-publish-actions` 数量从 2 改为 3，并给该测试补上 `queryStorage` / `pruneStorage` props（其余既有测试也统一补齐这两个 props）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx jest web/src/settings/ReleasePublishSettings.test.tsx`
Expected: FAIL —— 没有 Release storage 卡 / props 未使用。

- [ ] **Step 3: 实现**

`ReleasePublishSettings.tsx`：

1) props 增加（必传）：

```ts
  queryStorage: (hubId: string, sourcePath: string) => Promise<RegistryReleaseStorageResponse>;
  pruneStorage: (hubId: string, sourcePath: string) => Promise<RegistryReleaseStorageResponse>;
```

并从 `../registry/registryTypes` 导入 `RegistryReleaseStorageInfo` / `RegistryReleaseStorageResponse`。

2) 组件内加 state 与 helper：

```tsx
function formatByteSize(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? size : size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}
```

```tsx
  const [storage, setStorage] = React.useState<RegistryReleaseStorageInfo | null>(null);
  const [storageLoading, setStorageLoading] = React.useState(false);
  const [pruning, setPruning] = React.useState(false);

  const canQueryStorage = Boolean(settings.publisherHubId && settings.sourcePath);

  const refreshStorage = React.useCallback(async () => {
    if (!settings.publisherHubId || !settings.sourcePath) return;
    setStorageLoading(true);
    try {
      const result = await queryStorage(settings.publisherHubId, settings.sourcePath);
      if (result.ok && result.storage) {
        setStorage(result.storage);
        setError('');
      } else {
        setError(result.error || result.status);
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setStorageLoading(false);
    }
  }, [queryStorage, settings.publisherHubId, settings.sourcePath]);

  React.useEffect(() => {
    setStorage(null);
    void refreshStorage();
  }, [refreshStorage]);
```

3) 清理流程：

```tsx
  const requestPrune = () => {
    if (!storage || storage.orphanCount === 0 || pruning) return;
    setConfirmTarget({
      kind: 'releaseStoragePrune',
      orphanCount: storage.orphanCount,
      reclaimableLabel: formatByteSize(storage.reclaimableBytes),
    });
  };

  const confirmPrune = async () => {
    if (!confirmTarget || confirmTarget.kind !== 'releaseStoragePrune') return;
    setConfirmTarget(null);
    setPruning(true);
    setError('');
    try {
      const result = await pruneStorage(settings.publisherHubId, settings.sourcePath);
      if (!result.ok) throw new Error(result.error || result.status || 'prune was rejected');
      await refreshStorage();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setPruning(false);
    }
  };
```

`confirmPublish` 保持不动；`AppConfirmDialog` 的 `onPrimary` 改为按 kind 分发：

```tsx
        onPrimary={() => {
          if (confirmTarget?.kind === 'releaseStoragePrune') {
            void confirmPrune();
          } else {
            confirmPublish();
          }
        }}
```

4) 「Temporary Web」卡后插入新卡：

```tsx
      <section className="set-card" aria-label="Release storage">
        <div className="set-card-head">
          <Icon name="database" size={15} className="port-relay-section-icon" />
          <span className="set-card-title">Release storage</span>
          <span className="set-card-spacer" />
          <button
            type="button"
            className="set-btn"
            disabled={!canQueryStorage || storageLoading}
            onClick={() => void refreshStorage()}
          >
            <Icon name="refreshCw" size={13} spin={storageLoading} />
            Refresh
          </button>
        </div>
        <div className="set-card-body">
          <div className="set-kv">
            <span className="set-kv-key">Total</span>
            <span className="set-kv-value set-num">{storage ? formatByteSize(storage.totalBytes) : '-'}</span>
          </div>
          <div className="set-kv">
            <span className="set-kv-key">Reclaimable</span>
            <span className="set-kv-value set-num">{storage ? formatByteSize(storage.reclaimableBytes) : '-'}</span>
          </div>
          <div className="release-publish-actions">
            <button
              type="button"
              className="set-btn set-btn--primary"
              disabled={!storage || storage.orphanCount === 0 || pruning || storageLoading}
              onClick={requestPrune}
            >
              <Icon name={pruning ? 'loader' : 'trash'} spin={pruning} size={13} />
              {pruning ? 'Cleaning...' : 'Clean up unreferenced versions'}
            </button>
          </div>
        </div>
      </section>
```

`AppDialogs.tsx`：

1) `ConfirmTarget` 联合类型追加：

```ts
  | {
      kind: 'releaseStoragePrune';
      orphanCount: number;
      reclaimableLabel: string;
    }
```

2) 各 resolver 追加：

```ts
// resolveConfirmTitle
  if (target.kind === 'releaseStoragePrune') return 'Clean up release storage?';
// resolveConfirmName
  if (target.kind === 'releaseStoragePrune') return `${target.orphanCount} unreferenced version${target.orphanCount === 1 ? '' : 's'}`;
// resolveConfirmCopy
  if (target.kind === 'releaseStoragePrune') {
    return `Deletes ${target.orphanCount} version ${target.orphanCount === 1 ? 'directory' : 'directories'} on the release server that are not referenced by stable.json or releases.json, reclaiming about ${target.reclaimableLabel}. Referenced versions and release metadata are kept.`;
  }
// resolveConfirmIcon
  if (target.kind === 'releaseStoragePrune') return 'trash';
// resolveConfirmPrimaryLabel
  if (target.kind === 'releaseStoragePrune') return 'Clean up';
// isDangerConfirmTarget 的条件里加
    target.kind === 'releaseStoragePrune' ||
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && npx jest web/src/settings/ReleasePublishSettings.test.tsx web/src/shell`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/settings/ReleasePublishSettings.tsx app/web/src/settings/ReleasePublishSettings.test.tsx app/web/src/shell/AppDialogs.tsx
git commit -m "feat(web): add release storage card with one-click prune"
```

---

### Task 10: WorkspaceApp 接线 + 全量验证

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（约 13606-13612 行 callbacks、约 15704-15709 行 props）

- [ ] **Step 1: 接线**

`WorkspaceApp.tsx`（`queryReleasePublish` 定义后）：

```ts
  const queryReleaseStorage = useCallback((hubId: string, sourcePath: string) => (
    service.queryReleaseStorage(hubId, sourcePath)
  ), []);

  const pruneReleaseStorage = useCallback((hubId: string, sourcePath: string) => (
    service.pruneReleaseStorage(hubId, sourcePath)
  ), []);
```

`renderReleasePublishContent` 的 props 增加：

```tsx
      <ReleasePublishSettings
        hubIds={updateHubCards.map(card => card.hubId)}
        start={startReleasePublish}
        query={queryReleasePublish}
        subscribe={listener => service.releasePublishStore.subscribe(listener)}
        queryStorage={queryReleaseStorage}
        pruneStorage={pruneReleaseStorage}
      />
```

- [ ] **Step 2: 类型检查 + 全量测试**

```bash
cd app && npx tsc --noEmit
cd app && npx jest
cd server && go build ./... && go test ./...
node --test scripts/release/
```

Expected: 全绿。（`app` 的 tsc 命令以 `app/package.json` 现有 script 为准——若有 `typecheck` script 用它；没有则用 `npx tsc --noEmit`。）

- [ ] **Step 3: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx
git commit -m "feat(web): wire release storage actions into the workspace app"
```

---

### 收尾（执行计划全部完成后）

- spec 验收标准逐条对照人工确认。
- release server 端点需要在正式发布后通过 `node scripts/release-server/deploy.mjs` 重新部署 release server 才生效（部署动作不在本计划内，需用户确认时机）。
- 按 `docs/user/git-preferences.md` 走 merge/push/cleanup 流程。
