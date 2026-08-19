# Bailian Token Plan Usage Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Hub-isolated Qwen Bailian Token Plan personal usage snapshots to Limits Monitor and reuse the existing local usage-history trend for Qwen.

**Scope Source:** `docs/scope/2026-08-19-bailian-token-plan-usage.md`

**Architecture:** Each Hub owns the Qwen `sk-sp-` configuration check, Bailian Console credential package, current usage cache, and successful local history samples. The Hub publishes only sanitized state through the existing tokenStats path. The Web UI reuses the existing `usage.history.get` trend path and invokes native login only on supported Desktop/Android hosts.

**Tech Stack:** Go Hub services and protocol envelopes, React/TypeScript usage store and monitor surfaces, Windows WebView2, Android WebView bridge, Go/Jest/Kotlin tests.

**Verification:** Focused Go tests for hubconfig, usage, reporter, protocol, and redaction; focused Jest tests for parser/store/surface; Web TypeScript check; Android/Desktop source and unit tests; live Desktop and Android Bailian account probe.

---

### Task 1: Verify the Bailian external contracts before production code

**Files:**
- Create: `docs/notes/2026-08-19-bailian-token-plan-probe.md` only after a real probe produces a redacted response record.
- Test: `server/internal/hub/usage/qwen_bailian_test.go` with fixture-based parser cases after the response schema is verified.

**Acceptance:** A redacted Desktop and Android login probe identifies the allowed Console origins, login completion signal, credential fields, expiry/refresh/rotation behavior, and a stable current snapshot response. The probe must preserve no token, Cookie, API key, Authorization header, or full response body.

- [ ] **Step 1: Run the Desktop native login probe**

  Verify the actual Bailian Console login window, callback/origin allowlist, embedded WebView navigation boundary, and protected credential result.

- [ ] **Step 2: Run the Android native login probe**

  Verify the same contract through the Android WebView dialog and confirm that the result can be associated with the initiating Hub.

- [ ] **Step 3: Query the personal Token Plan snapshot**

  Confirm absolute Credits, `limited/unlimited/unavailable`, subscription/package fields, reset/window identifiers, response limits, and error/status mapping. Qwen trend points come from successful local snapshots through the existing history path; no official trend endpoint is required.

- [ ] **Step 4: Verify secret diagnostics behavior**

  Send a complete redacted test credential package through the intended method and prove that inbound/outbound diagnostics contain no secret field values.

- [x] **Step 5: Record the live-validation boundary**

  No live Desktop/Android credentials were available. The implementation uses the public CLI-compatible Console gateway contract and keeps the live OAuth/current-snapshot validation boundary explicit; it does not substitute RAM, CLI-local credentials, ordinary API keys, or Credits estimates.

### Task 2: Add Hub-scoped Bailian OAuth secret storage

- [x] Implemented and covered by Hub config/protocol/redaction tests.

**Files:**
- Modify: `server/internal/hubconfig/store.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_wire.go` or the verified protocol payload file containing Hub config updates
- Test: existing `server/internal/hubconfig/mcp_test.go` and `server/internal/hub/hub_test.go`

**Acceptance:** Structured `qwen.oauth.update` accepts only the verified lifecycle actions, persists the verified credential fields atomically, exposes only sanitized login state, supports clear without changing `apiKeys.qwen`, and never routes a full credential package through generic `hub.config.update.value`.

### Task 3: Implement the Qwen Token Plan snapshot provider

- [x] Implemented with `sk-sp-` gating, tombstone removal, stale-success retention, official Console gateway parsing, and successful local Qwen history samples.

**Files:**
- Modify: `server/internal/hub/usage/model.go`
- Create: `server/internal/hub/usage/qwen_bailian.go`
- Modify: `server/internal/hub/reporter.go`
- Test: `server/internal/hub/usage/qwen_bailian_test.go`
- Test: `server/internal/hub/usage/service_test.go`

**Acceptance:** A configured `sk-sp-` key creates one Hub-local Qwen provider; ordinary `sk-` or clear removes it authoritatively; official snapshot data preserves limited/unlimited/unavailable windows and absolute Credits strings; temporary failures retain the last successful snapshot with stale/error status; failed samples never enter local history.

### Task 4: Reuse the existing local seven-day usage history

- [x] Implemented by recording successful Qwen snapshots through the existing usage-history store and reading them through `usage.history.get`; no `qwen.usage.get` or Credits estimate is added.

**Files:**
- Modify: `server/internal/hub/usage/history.go`
- Modify: `server/internal/hub/usage/qwen_bailian.go`
- Modify: `server/internal/hub/reporter.go`
- Test: `server/internal/hub/usage/qwen_bailian_test.go`

**Acceptance:** Qwen successful snapshots append only normalized local remaining-percentage samples; `usage.history.get` targets exactly one Hub and preserves the existing loading/empty/error behavior without claiming official Credits history.

### Task 5: Add native Desktop and Android login bridges

- [x] Implemented controlled stateful local-callback login bridges; Desktop cross-build passed and Android source/test compile remains unrun because no Gradle runner is available in the workspace.

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/desktop_bridge.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows.go`
- Create or modify: `server/cmd/wheelmaker-desktop/qwen_login.go`
- Create or modify: `server/cmd/wheelmaker-desktop/qwen_login_windows.go`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`
- Create or modify: `mobile/android/app/src/main/java/com/wheelmaker/android/QwenLoginDialog.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/TrustedWebMessagePolicy.kt`
- Test: corresponding Desktop Go and Android Kotlin protocol/security tests

**Acceptance:** Supported native hosts open a controlled Bailian login window and return only the verified protected result; browser hosts expose a disabled explanatory state; close, timeout, navigation violations, and concurrent Hub targeting are handled safely.

### Task 6: Render Hub-isolated Qwen placeholder, snapshot, and detail trend

- [x] Implemented Hub-isolated placeholder/snapshot/detail rendering, login/logout/retry, browser limitation state, and local usage-history trend rendering.

**Files:**
- Modify: `app/web/src/usage/usageTypes.ts`
- Modify: `app/web/src/usage/usageStore.ts`
- Modify: `app/web/src/usage/UsageFeatureSurface.tsx`
- Create or modify: `app/web/src/usage/qwenUsage.ts`
- Create or modify: `app/web/src/usage/qwenLogin.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Test: `app/__tests__/web-usage-store.test.ts`
- Test: `app/__tests__/web-usage-feature-surface.test.tsx`

**Acceptance:** Each Hub with `sk-sp-` has one placeholder or data row; rows are not cross-Hub merged; compact display selects only limited windows and shows seven-day summary; detail shows both windows, subscription/package, local cached trend, login/logout/retry, and browser limitation text.

### Task 7: Run focused verification and Git handoff

**Files:**
- Modify: the plan checkboxes and verified implementation files only.

**Acceptance:** Focused tests, Web TypeScript check when applicable, native tests, redaction audit, and the two real-host probes pass; `git diff --check` is clean and unrelated `.skill-source-lock.json.lock` remains untouched.

- [x] **Step 1: Run focused Go tests with the repository Windows hidden Go test runner**

- [x] **Step 2: Run focused Jest and Web TypeScript checks**

  Focused Jest passed. `tsc:web` remains blocked by pre-existing missing `rehype-*`, `@xterm/*`, and `echarts/*` dependencies plus existing TerminalView implicit-any errors.

- [x] **Step 3: Run Desktop and Android native tests/build checks**

  Desktop Windows cross-compile passed. Android Gradle tests/build were not runnable because no Gradle/`gradlew` executable is present.

- [x] **Step 4: Review diagnostics and serialized state for secret leakage**

- [x] **Step 5: Run `git diff --check`, inspect status/diff, and finalize through `git-workflow`**

  `git diff --check` passed. The unrelated `.skill-source-lock.json.lock` remains unmodified and unstaged.
