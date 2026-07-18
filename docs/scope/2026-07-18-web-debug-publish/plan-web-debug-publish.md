# Hub 驱动发布与临时 Web 发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Settings 能委托发布 Hub 执行正式版本或最新 Debug Web 发布，并可通知独立的 Server Hub 安全应用结果。

**Architecture:** 新增一个 Hub 内持久发布任务服务，任务在后台启动 Node 发布命令、保留脱敏日志并通过 Registry 的新增控制方法通知目标 Hub。Release Server 增加与正式版本事务隔离的最新 Debug Web ZIP 通道；Server Hub 仅从固定 HTTPS 元数据端点校验并原子替换本机 Web 目录。Settings 仅在浏览器 localStorage 保存 Hub 选择与开关。

**Tech Stack:** Go、现有 Registry WebSocket 控制面、Node.js MJS、React/TypeScript、Go `net/http`、现有 release/deploy 安全校验。

---

## Planned file structure

- `server/internal/hub/release_publish.go`：发布任务、日志、源码路径验证和 Node 命令启动。
- `server/internal/hub/release_apply.go`：Server Hub 的 stable/Debug Web 应用入口及最终状态。
- `server/internal/hub/release_debug_web.go`：固定元数据 URL 的下载、SHA/大小/ZIP 校验与原子切换。
- `server/internal/hub/tools/release.go`：将 `cmd.release` 暴露给 Hub State 控制面。
- `server/internal/hub/reporter.go`、`server/internal/registry/*`、`server/internal/protocol/*`：增加不改版本号的 Hub 间发布通知路由。
- `scripts/release/debug-web.mjs`、`scripts/release/debug-web-api.mjs`：只构建 Web、生成 ZIP、调用 Debug Web Release Server API。
- `server/internal/releaseserver/debug_web.go`：受 Bearer 鉴权的上传/提交和公开当前元数据。
- `app/web/src/settings/ReleasePublishSettings.tsx`：Settings 发布面板。
- `app/web/src/registry/*`、`app/web/src/WorkspaceApp.tsx`：Hub State 请求、任务日志轮询及浏览器本地设置。

### Task 1: Define release command contracts and Registry forwarding

**Files:**
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_state_adapters.go`
- Create: `server/internal/hub/release_publish_test.go`

- [ ] **Step 1: Write failing Go tests for a Hub-originated `release.apply` notification that reaches only the selected connected Hub and preserves the Registry protocol version.**

```go
func TestReleaseApplyNotificationForwardsToTargetHub(t *testing.T) {
    target := newConnectedHub(t, "server-hub")
    publisher := newConnectedHub(t, "publisher-hub")
    result := publisher.Request(t, "hub.release.notify", map[string]any{
        "targetHubId": "server-hub", "kind": "debugWeb", "baseUrl": "https://release.wheelmaker.top",
    })
    require.Equal(t, "accepted", result.Status)
    require.Equal(t, "release.apply", target.NextRequest(t).Method)
}
```

- [ ] **Step 2: Run the focused test and confirm it fails because `hub.release.notify` is not routed.**

Run: `go test ./server/internal/registry ./server/internal/hub -run TestReleaseApplyNotificationForwardsToTargetHub -count=1`

Expected: FAIL mentioning an unsupported or unknown method.

- [ ] **Step 3: Add the additive `hub.release.notify` and `release.apply` method constants, validate target/kind/HTTPS origin, and route only an accepted final response back to the publisher.**

```go
type ReleaseApplyRequest struct {
    Kind    string `json:"kind"`
    BaseURL string `json:"baseUrl"`
}

// notifyReleaseTarget forwards a request to an already connected Hub without
// changing the protocol version or exposing a filesystem path.
func (s *Server) notifyReleaseTarget(ctx context.Context, targetHubID string, request ReleaseApplyRequest) error
```

- [ ] **Step 4: Re-run the focused test, then the Registry/Hub package tests.**

Run: `go test ./server/internal/registry ./server/internal/hub -count=1`

Expected: PASS.

- [ ] **Step 5: Commit the control-route contract.**

Run: `git add server/internal/protocol server/internal/registry server/internal/hub && git commit -m "feat(registry): route hub release apply notifications"`

### Task 2: Implement persistent publishing-Hub jobs

**Files:**
- Create: `server/internal/hub/release_publish.go`
- Create: `server/internal/hub/release_publish_test.go`
- Modify: `server/internal/hub/tools/manager.go`
- Create: `server/internal/hub/tools/release.go`
- Modify: `server/internal/hub/hub_state_adapters.go`

- [ ] **Step 1: Write failing tests for accepted background jobs, source-directory rejection, Desktop/Android argument mapping, task-status recovery, and token-redacted logs.**

```go
func TestReleasePublishJobSurvivesRequestReturn(t *testing.T) {
    runner := &blockingReleaseRunner{}
    jobs := NewReleasePublishJobs(tempDir, runner, nil)
    accepted, err := jobs.Start(context.Background(), ReleasePublishRequest{Kind: "version", SourcePath: tempDir, BaseURL: "https://release.wheelmaker.top"})
    require.NoError(t, err)
    require.Equal(t, "running", accepted.Status)
    require.Eventually(t, runner.Started, time.Second, time.Millisecond)
}
```

- [ ] **Step 2: Run `go test ./server/internal/hub ./server/internal/hub/tools -run ReleasePublish -count=1` and confirm the missing service causes failure.**

- [ ] **Step 3: Implement `ReleasePublishJobs` with a source-root allowlist check, one shared build mutex, JSON task snapshots under the Hub data root, bounded redacted logs, and a runner that invokes only source-tree MJS entry points.**

```go
type ReleasePublishRequest struct {
    Kind       string `json:"kind"` // "version" or "debugWeb"
    SourcePath string `json:"sourcePath"`
    BaseURL    string `json:"baseUrl"`
    Desktop    bool   `json:"desktop"`
    Android    bool   `json:"android"`
    TargetHubID string `json:"targetHubId,omitempty"`
    AutoPull   bool   `json:"autoPull"`
}
```

- [ ] **Step 4: Expose `cmd.release` actions `start` and `status` through the existing Hub State action adapter; reject browser token fields and never serialize a token.**

- [ ] **Step 5: Re-run focused tests and full Hub tools tests.**

Run: `go test ./server/internal/hub ./server/internal/hub/tools -count=1`

Expected: PASS.

- [ ] **Step 6: Commit the background publishing service.**

Run: `git add server/internal/hub && git commit -m "feat(hub): run persistent release publishing jobs"`

### Task 3: Build and upload one latest Debug Web ZIP

**Files:**
- Create: `scripts/release/debug-web.mjs`
- Create: `scripts/release/debug-web-api.mjs`
- Create: `scripts/release/debug-web.test.mjs`
- Modify: `scripts/release/build.mjs`
- Modify: `scripts/release/release-server-api.mjs`

- [ ] **Step 1: Write failing Node tests that package only the Web release directory, reject unsafe archive entries, send declared SHA-256/size, and never call formal stable/history APIs.**

```javascript
test('publishes debug web without reading or changing stable metadata', async () => {
  const calls = [];
  await publishDebugWeb({ baseUrl, token: 'secret', buildWeb, request: async path => calls.push(path) });
  assert.deepEqual(calls, ['/api/debug-web/start', '/api/debug-web/upload', '/api/debug-web/commit']);
});
```

- [ ] **Step 2: Run `node --test scripts/release/debug-web.test.mjs` and confirm it fails because the module is absent.**

- [ ] **Step 3: Implement a deterministic ZIP builder for ordinary Web files, call the existing release build lock and Web release command, then upload/commit using a dedicated authenticated Debug Web API client. Keep token resolution inside the publishing machine's existing protected publisher config.**

- [ ] **Step 4: Run the Node test plus current release tests.**

Run: `node --test scripts/release/debug-web.test.mjs scripts/release/*.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the Debug Web publisher.**

Run: `git add scripts/release && git commit -m "feat(release): publish latest debug web archive"`

### Task 4: Add Release Server Debug Web transaction and public metadata

**Files:**
- Create: `server/internal/releaseserver/debug_web.go`
- Create: `server/internal/releaseserver/debug_web_test.go`
- Modify: `server/internal/releaseserver/server.go`
- Modify: `scripts/release-server/nginx.conf`

- [ ] **Step 1: Write failing handler tests for missing Bearer auth, wrong declared digest/size, failed commit retaining old metadata, and a successful new ZIP atomically becoming `/debug-web/current.json`.**

```go
func TestDebugWebCommitPublishesOnlyVerifiedArchive(t *testing.T) {
    srv := newReleaseServer(t)
    old := readCurrentDebugWeb(t, srv)
    session := startDebugWeb(t, srv, archiveBytes, sha256Hex(archiveBytes))
    uploadDebugWeb(t, srv, session, archiveBytes)
    commitDebugWeb(t, srv, session)
    require.NotEqual(t, old.ArchivePath, readCurrentDebugWeb(t, srv).ArchivePath)
}
```

- [ ] **Step 2: Run `go test ./server/internal/releaseserver -run DebugWeb -count=1` and confirm it fails because routes do not exist.**

- [ ] **Step 3: Implement `/api/debug-web/start`, `/api/debug-web/upload`, and `/api/debug-web/commit` with the existing Bearer verifier, server-side staging, exact byte/digest verification, a single current ZIP, and atomic metadata replacement. Serve only same-origin public ZIP paths and `Cache-Control: no-store` for current metadata.**

- [ ] **Step 4: Re-run the focused tests and all Release Server tests.**

Run: `go test ./server/internal/releaseserver -count=1`

Expected: PASS.

- [ ] **Step 5: Commit the Release Server Debug Web flow.**

Run: `git add server/internal/releaseserver scripts/release-server && git commit -m "feat(release-server): host current debug web"`

### Task 5: Safely apply Debug Web on Server Hub

**Files:**
- Create: `server/internal/hub/release_debug_web.go`
- Create: `server/internal/hub/release_debug_web_test.go`
- Modify: `server/internal/hub/release_apply.go`
- Modify: `server/internal/hub/tools/release.go`

- [ ] **Step 1: Write failing tests for fixed `/debug-web/current.json` discovery, HTTPS/same-origin enforcement, malformed metadata, SHA/size mismatch, ZIP traversal/link rejection, successful atomic replacement, and old Web preservation after every failure.**

```go
func TestApplyDebugWebLeavesExistingWebOnDigestMismatch(t *testing.T) {
    webRoot := writeExistingWeb(t, "old")
    err := ApplyDebugWeb(context.Background(), webRoot, testServer.URL, testHTTPClient)
    require.ErrorContains(t, err, "sha256")
    require.Equal(t, "old", readFile(t, filepath.Join(webRoot, "index.html")))
}
```

- [ ] **Step 2: Run `go test ./server/internal/hub -run DebugWeb -count=1` and confirm it fails because the apply service is absent.**

- [ ] **Step 3: Implement metadata fetch and validation with a fixed suffix, download to Hub staging, safe ZIP extraction into a sibling temporary directory, and rename-based replacement under the same installer update lock used by normal updates. Derive the destination from this Hub's install root only.**

- [ ] **Step 4: Wire `release.apply` kinds so `version` delegates to the existing stable updater and `debugWeb` invokes the new applier; return only accepted/success/failure status.**

- [ ] **Step 5: Re-run focused and full Hub tests.**

Run: `go test ./server/internal/hub -count=1`

Expected: PASS.

- [ ] **Step 6: Commit the Server Hub applier.**

Run: `git add server/internal/hub && git commit -m "feat(hub): apply verified debug web snapshots"`

### Task 6: Add the Settings publishing controls and task recovery

**Files:**
- Create: `app/web/src/settings/ReleasePublishSettings.tsx`
- Create: `app/web/src/settings/ReleasePublishSettings.test.tsx`
- Modify: `app/web/src/settings/SettingsBundle.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/WorkspaceApp.tsx`

- [ ] **Step 1: Write failing component tests that restore local settings, disable auto pull without Server Hub, render only Desktop/Android for a formal publish, omit Token/URL inputs, start each action with the compiled channel URL, and recover publishing-Hub logs plus target final state.**

```tsx
it('keeps publishing settings in browser storage and never renders a token field', async () => {
  render(<ReleasePublishSettings hubs={hubs} releaseBaseUrl="https://release.wheelmaker.top" />);
  expect(screen.queryByLabelText(/token/i)).toBeNull();
  expect(screen.queryByLabelText(/release server url/i)).toBeNull();
  await userEvent.selectOptions(screen.getByLabelText(/server hub/i), 'server-hub');
  expect(screen.getByLabelText(/auto pull/i)).toBeEnabled();
});
```

- [ ] **Step 2: Run the focused web test and confirm it fails because the publishing settings component is absent.**

Run: `npm test -- --runInBand app/web/src/settings/ReleasePublishSettings.test.tsx`

- [ ] **Step 3: Add typed repository methods for `cmd.release`, a small Settings panel using the existing release channel import, browser-only `localStorage` persistence keyed to the workspace, and polling tied only to accepted task IDs. Never persist the URL, source path outside localStorage, token, or server Web path in Hub config.**

- [ ] **Step 4: Render publishing-Hub logs and only the Server Hub's final accepted/success/failed state; do not add a Debug Web manual apply action.**

- [ ] **Step 5: Run focused tests and the Web typecheck.**

Run: `npm test -- --runInBand app/web/src/settings/ReleasePublishSettings.test.tsx`

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the Settings control surface.**

Run: `git add app/web && git commit -m "feat(web): manage hub release publishing tasks"`

### Task 7: Document and verify the integrated feature

**Files:**
- Modify: `docs/wiki/release-and-build/release.md`
- Modify: `docs/scope/2026-07-18-web-debug-publish/spec-web-debug-publish.md`
- Modify: `docs/scope/2026-07-18-web-debug-publish/plan-web-debug-publish.md`

- [ ] **Step 1: Update the release/build wiki with the two Hub roles, local-only Settings data, protected publishing token, isolated Debug Web endpoint, fixed Server Hub pull path, and no-release-history semantics.**

- [ ] **Step 2: Mark every completed plan checkbox and record any test command whose platform prerequisite prevents execution.**

- [ ] **Step 3: Run the full targeted verification suite.**

Run: `go test ./server/internal/hub ./server/internal/registry ./server/internal/releaseserver -count=1`

Run: `node --test scripts/release/debug-web.test.mjs scripts/release/*.test.mjs`

Run: `npm test -- --runInBand app/web/src/settings/ReleasePublishSettings.test.tsx`

Run: `npm run typecheck`

Expected: all commands PASS; no test contacts the real Release Server or reads a real token.

- [ ] **Step 4: Inspect the staged diff for token/URL/path leakage, verify no Registry protocol version constant changed, then commit the documentation and plan.**

Run: `git diff --check && git diff --cached -- server/internal/protocol app/web server scripts | Select-String -Pattern 'release-server.json|token'`

Run: `git add docs && git commit -m "docs: describe hub release publishing"`
