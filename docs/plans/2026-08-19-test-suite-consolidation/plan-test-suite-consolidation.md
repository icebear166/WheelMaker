# 双端测试套件收敛 Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留核心行为、安全和数据契约覆盖的前提下，合并 Go 测试文件并删除前端静态结构型冗余测试。

**Scope Source:** `docs/scope/2026-08-19-test-suite-consolidation.md`

**Architecture:** Go 按测试包目录合并为单一规范测试文件，使用统一 import/helper 和表驱动子测试；前端保留真实模块/组件行为测试，删除或裁剪源码文本/CSS 结构断言，并将唯一的行为证据迁移到已有行为测试文件。

**Tech Stack:** Go `testing`、`gofmt`/`goimports`；Jest 30、Babel、React Test Renderer、TypeScript。

**Verification:** `go test ./...`；`npm test -- --runInBand --coverage=false`；`npm run tsc:web`；排除 `dist`/`node_modules` 的测试规模统计。

---

### Task 1: Remove redundant frontend source-structure suites

**Files:**
- Delete: `app/__tests__/web-chat-ui.test.ts`
- Delete: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Delete: `app/__tests__/web-chat-recent-sessions-ui.test.ts`
- Delete: `app/__tests__/web-chat-session-panel-layout.test.tsx`
- Delete: `app/__tests__/web-responsive-shell.test.ts`
- Delete: `app/__tests__/web-chat-inline-composer-wiring.test.ts`
- Delete: `app/__tests__/web-skill-management-settings.test.ts`
- Delete: `app/__tests__/web-registry-login-device-ui.test.ts`
- Delete: `app/__tests__/web-usage-workspace-integration.test.tsx`
- Delete: `app/__tests__/web-main-surface-boundary.test.ts`
- Delete: `app/__tests__/web-workspace-tab-removal.test.ts`
- Delete: `app/__tests__/web-session-fork-state-wiring.test.ts`
- Delete: `app/__tests__/web-git-browser-workspace.test.tsx`
- Delete: `app/__tests__/web-connection-settings-ui.test.ts`
- Delete: `app/__tests__/web-database-settings-ui.test.ts`
- Delete: `app/__tests__/web-release-publish-settings.test.ts`
- Delete: `app/__tests__/web-hide-tool-calls-settings.test.ts`
- Delete: `app/__tests__/web-chat-session-nav-expansion.test.ts`
- Delete: `app/__tests__/web-file-icon-startup-boundary.test.ts`
- Delete: `app/__tests__/web-git-diff-startup-boundary.test.ts`
- Delete: `app/__tests__/web-local-hub-read-ui.test.ts`
- Delete: `app/__tests__/web-app-dialog-icons.test.ts`
- Delete: `app/__tests__/web-chat-startup-default.test.ts`

**Acceptance:** 纯源码/CSS/UI wiring 断言不再单独参与 Jest discovery；对应运行时行为由 colocated component tests、service tests 或状态模型 tests 覆盖。

- [x] **Step 1: Run the current replacement tests before deletion**

Run: `npm test -- --runInBand --coverage=false web/src/app/ChatHubSkillManagement.test.tsx web/src/shell/ResponsiveShell.test.tsx web/src/chat/ChatSessionPanel.test.tsx web/src/registry/RegistryWorkspaceService.test.ts`

Expected: replacement behavior suites pass before source-only suites are removed.

- [x] **Step 2: Delete the listed source-only suites**

Remove only the listed test files; do not change production files or Jest discovery configuration.

- [x] **Step 3: Run the focused frontend regression set**

Run: `npm test -- --runInBand --coverage=false web/src/app/ChatHubSkillManagement.test.tsx web/src/settings/SkillManagementContent.test.tsx web/src/shell/ResponsiveShell.test.tsx web/src/chat/ChatSessionPanel.test.tsx web/src/git/GitHistoryPanel.test.tsx`

Expected: all retained runtime component tests pass and no deleted suite is listed by Jest.

### Task 2: Compress mixed frontend tests while preserving behavior evidence

**Files:**
- Modify: `app/__tests__/web-chat-composer-status.test.ts`
- Modify: `app/__tests__/web-chat-plan-surface.test.tsx`
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts`
- Modify: `app/__tests__/web-skill-management-service.test.ts`
- Modify: `app/__tests__/web-settings-navigation.test.ts`
- Modify: `app/__tests__/web-mobile-enter-key-settings.test.ts`
- Modify: `app/__tests__/web-setup.test.js`
- Modify: `app/__tests__/web-native-pwa-gating.test.ts`
- Modify: `app/__tests__/web-responsive-ui-state.test.ts`
- Modify: `app/__tests__/web-chat-turn-rendering.test.ts`
- Modify: `app/__tests__/web-chat-display-index.test.ts`
- Modify: `app/__tests__/web-chat-draft-sessions.test.ts`
- Modify: `app/__tests__/web-chat-turn-markdown.test.tsx`
- Modify: `app/__tests__/web-usage-history.test.ts`

**Acceptance:** 每个保留文件的主要断言针对导入的函数、服务或真实渲染结果；删除 stale API 调用、源码布局断言和 CSS 数值断言，同时保留 package metadata、PWA/native gating、persistence、usage partial-failure、composer model、plan interaction 和 settings model 的行为证据。

本轮同步移除重复的页面源码/CSS wiring 套件，以及已由 colocated 组件、状态模型、服务或协议测试覆盖的低信息 smoke 套件；未修改生产代码。

- [x] **Step 1: Preserve focused runtime behavior before trimming**

Run: `npm test -- --runInBand --coverage=false __tests__/web-chat-composer-status.test.ts __tests__/web-chat-plan-surface.test.tsx __tests__/web-agent-package-update-settings.test.ts __tests__/web-skill-management-service.test.ts __tests__/web-settings-navigation.test.ts __tests__/web-mobile-enter-key-settings.test.ts __tests__/web-setup.test.js __tests__/web-native-pwa-gating.test.ts __tests__/web-responsive-ui-state.test.ts __tests__/web-chat-turn-rendering.test.ts __tests__/web-chat-display-index.test.ts __tests__/web-chat-draft-sessions.test.ts __tests__/web-chat-turn-markdown.test.tsx __tests__/web-usage-history.test.ts`

Expected: record the current behavior failures separately from source-structure failures; do not add production changes to make this command pass.

- [x] **Step 2: Keep concrete behavior and remove static branches**

Retain the pure helper assertions in `web-chat-composer-status.test.ts`, actual React renderer interactions in `web-chat-plan-surface.test.tsx`, current release metadata/service calls in `web-agent-package-update-settings.test.ts`, current repository methods in `web-skill-management-service.test.ts`, imported settings model cases in `web-settings-navigation.test.ts`, direct `normalizeMobileEnterKeyBehavior` cases in `web-mobile-enter-key-settings.test.ts`, and real usage-history partial failure in `web-usage-history.test.ts`. Remove their `readFileSync`/CSS/source-order helpers and all calls to methods no longer present in `RegistryRepository`.

- [x] **Step 3: Compact build and platform boundary checks**

Reduce `web-setup.test.js` to a small set covering entrypoint/PWA integration, service-worker message behavior, release output/cache isolation, and CSS extraction. Reduce `web-native-pwa-gating.test.ts` to the native-shell registration boundary and keep native detection behavior in `web-native-runtime.test.ts`.

- [x] **Step 4: Run the mixed-suite regression tests**

Run: `npm test -- --runInBand --coverage=false __tests__/web-chat-composer-status.test.ts __tests__/web-chat-plan-surface.test.tsx __tests__/web-agent-package-update-settings.test.ts __tests__/web-skill-management-service.test.ts __tests__/web-settings-navigation.test.ts __tests__/web-mobile-enter-key-settings.test.ts __tests__/web-setup.test.js __tests__/web-native-pwa-gating.test.ts __tests__/web-responsive-ui-state.test.ts __tests__/web-chat-turn-rendering.test.ts __tests__/web-chat-display-index.test.ts __tests__/web-chat-draft-sessions.test.ts __tests__/web-chat-turn-markdown.test.tsx __tests__/web-usage-history.test.ts`

Expected: all retained suites pass with no production source diff.

### Task 3: Merge Go tests to one file per package

**Files:**
- Modify: `server/cmd/wheelmaker/main_test.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy_test.go`
- Modify: `server/cmd/wheelmaker-gateway/main_test.go`
- Modify: `server/cmd/wheelmaker-release-server/main_test.go`
- Modify: `server/internal/flickerbridge/flicker_bridge_test.go`
- Modify: `server/internal/gateway/single_config_test.go`
- Modify: `server/internal/hub/hub_test.go`
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `server/internal/hub/agent/cxdeepseek/catalog_test.go`
- Modify: `server/internal/hub/agent/cxflicker/catalog_test.go`
- Modify: `server/internal/hub/client/client_test.go`
- Modify: `server/internal/hub/terminal/manager_test.go`
- Modify: `server/internal/hub/tools/tools_test.go`
- Modify: `server/internal/hub/usage/providers_test.go`
- Modify: `server/internal/hubconfig/mcp_test.go`
- Modify: `server/internal/portrelay/listener_test.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/registry/server_test.go`
- Modify: `server/internal/releaseserver/commit_test.go`
- Modify: `server/internal/security/loopback_test.go`
- Modify: `server/internal/serverdata/store_test.go`
- Modify: `server/internal/shared/shared_test.go`
- Modify: `server/internal/shared/agentpath/agentpath_test.go`
- Modify: `server/internal/speech/volcengine_test.go`
- Modify: `server/internal/tts/client_test.go`
- Delete: all other `*_test.go` files in those 24 package directories after their declarations are merged into the canonical file.

**Acceptance:** Every existing Go test package directory contains one canonical `_test.go`; all retained tests compile without duplicate declarations or unused imports. The rebased remote additions in `internal/flickerbridge`, `internal/hub/agent`, and `internal/hub/agent/cxflicker` are included in the same rule.

- [x] **Step 1: Record the package/file baseline and run Go tests**

Run from `server/`: `go test ./...`

Expected: baseline Go tests pass; package/file/function/line counts match the approved spec baseline. Recorded baseline: 24 tested package directories, 97 test files, 65,323 lines, and 1,684 test functions.

- [x] **Step 2: Merge declarations and helpers package by package**

Move test declarations from each package's other files into the canonical file, deduplicate package/import blocks and identical helpers, and preserve Windows build tags on Windows-only declarations. Use `goimports`/`gofmt` after each package merge; do not alter non-test Go files. Completed for the original 17 multi-file packages and the three remote-added multi-file groups; Windows-mixed packages use a canonical file-level `windows` build tag so the single-file rule does not discard platform coverage.

- [x] **Step 3: Run package-level Go tests after each merge group**

Run: `go test ./cmd/... ./internal/flickerbridge ./internal/gateway ./internal/hub/... ./internal/hubconfig ./internal/portrelay ./internal/protocol ./internal/registry ./internal/releaseserver ./internal/security ./internal/serverdata ./internal/shared/... ./internal/speech ./internal/tts`

Expected: all package tests pass, with exactly one test file per package directory. The post-merge package run passed for all non-flaky packages; the two timing-sensitive release/hub integration cases also passed when rerun in isolation.

### Task 4: Remove duplicated Go scenarios without weakening risk coverage

**Files:**
- Modify: `server/internal/registry/server_test.go`
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `server/internal/hub/client/client_test.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/shared/shared_test.go`
- Modify: `server/cmd/wheelmaker/main_test.go`

**Acceptance:** Repeated input matrices become table-driven subtests, while distinct protocol/security/resource-lifecycle outcomes remain separately observable.

- [x] **Step 1: Convert obvious repeated matrices**

Combine the legacy registry protocol version rejection tests into one table, provider/preset name matrices into tables where the assertion contract is identical, repeated removed-field/config rejection checks into table-driven cases, unauthenticated WebSocket origin cases into one matrix, and equivalent worker-process fixtures into one matrix. Keep different error timing, cleanup, authentication, and transport-direction cases separate.

- [x] **Step 2: Remove no-op assertions and stale external-only checks**

Delete assertions that only compare a constant to itself or repeat a stronger neighboring integration test. Keep conditional platform tests and security failures that exercise a distinct branch; do not remove tests solely because they are Windows/provider-gated. Removed the Go desktop source/script scans and one redundant default-constant smoke test; retained runtime, security, persistence, and platform behavior.

- [x] **Step 3: Run focused Go regressions**

Run: `go test ./internal/registry ./internal/hub/agent ./internal/hub/client ./internal/protocol ./internal/shared ./cmd/wheelmaker`

Expected: focused packages pass and their test function/line counts are below the approved baseline.

### Task 5: Full verification and handoff

**Files:**
- Modify: all retained test files from Tasks 1–4

**Acceptance:** Both test suites are green, size reductions meet the approved spec, and the diff contains no production or protocol changes.

- [x] **Step 1: Run full Go verification**

Run from `server/`: `go test ./...`

Expected: PASS for all packages. `go test ./... -json -count=1` passed for every package, including the Windows-only test groups and the rebased `cxflicker` package on the current target; a serial `go test ./... -p 1 -count=1` retry also passed.

- [x] **Step 2: Run full frontend verification**

Run from `app/`: `npm test -- --runInBand --coverage=false`; then `npm run tsc:web`.

Expected: no failed Jest suite/test and no TypeScript diagnostics. Jest: 229 suites / 1,499 tests passed; `npm run tsc:web` passed.

- [x] **Step 3: Recompute and compare test inventory**

Run the approved baseline-count scripts excluding `dist` and `node_modules`; verify Go has one test file per tested package directory, Go lines/functions are below 65,323/1,684, and frontend files/lines are at most 75% of 308/50,851. Actual after rebasing remote additions: Go 25 files/25 package directories/64,883 lines/1,667 functions; frontend 229 files/36,906 lines. The branch diff contains 185 files relative to `origin/main`, with no production/protocol files outside approved test/spec/plan paths.

- [ ] **Step 4: Review diff and complete Git checkpoint/finalize**

Run: `git diff --check`, `git status --short`, `git diff --stat`, and `git diff -- server app/web`.

Expected: only approved test/spec/plan files changed; checkpoint each completed independent work unit and finalize with the actual verification result.
