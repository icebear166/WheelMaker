# Bailian Token Plan Usage Aggregation and Native Login Repair Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Update each checkbox only after the step is verified.

**Goal:** Change the existing Qwen Bailian Token Plan integration from per-Hub Web rows to one aggregated Qwen row, retain Hub-scoped credentials and history sources, and align PC/Android login surfaces with the proven DeepSeek lifecycle without changing the official Qwen callback or field parsing.

**Scope Source:** `docs/scope/2026-08-19-bailian-token-plan-usage.md`

**Architecture:** Hub services remain unchanged and continue to own OAuth, credential storage, current snapshots, and local history. Web `UsageStore` aggregates only providers with `id === 'qwen'` and `localId === 'bailian-token-plan'`; the aggregate keeps every source Hub and never sums Credits. The first stable source is the main source for login/logout/credential writes. Desktop keeps the official local callback and protected credential extraction while adopting DeepSeek's owned-popup, timeout, completion, and teardown discipline. Android keeps the Qwen callback and allowlist while adopting DeepSeek's full-screen in-app page, wide viewport, progress, retry, and navigation-error handling.

**Tech Stack:** Go desktop bridge, React/TypeScript usage store and surfaces, Windows WebView2, Android WebView/Kotlin, Jest, Go tests, and Android source-level protocol tests.

**Verification:** Run focused Jest and Go tests, source-level Android lifecycle tests, TypeScript checking when dependencies permit, static secret/diff checks, and inspect native-login behavior boundaries. Do not run a Web production build. Real Bailian Desktop/Android login and current-snapshot probes remain unrun unless test credentials and the external account are available.

---

### Task 1: Aggregate Qwen provider sources in the Web usage store

**Files:**
- Modify: `app/web/src/usage/usageStore.ts`
- Test: `app/web/src/usage/usageStore.test.ts`

**Acceptance:** Two Hub snapshots for the same `bailian-token-plan` produce one provider with no `hubId`; its account preserves both `hubIds` and both source references, uses the newest valid source snapshot, and does not add numeric Credits or remaining values together. Non-Qwen providers retain their existing aggregation behavior.

- [x] **Step 1: Add the aggregate regression test first**

  Changed the existing Qwen isolation test to provide two dated Hub snapshots and assert one global Qwen provider, both Hub/source references, and the selected newest data. The focused Jest command first failed with the old two-provider result.

- [x] **Step 2: Implement the smallest store-key and identity change**

  Used one stable Qwen provider key and one stable source-account identity for `bailian-token-plan`; retained the existing `hubIds`, `sources`, status, and newest-account merge machinery. Added the Qwen valid-snapshot guard without changing Hub protocol payloads or summing metrics.

- [x] **Step 3: Run the focused store test green**

  Re-ran `npm test -- --runInBand web/src/usage/usageStore.test.ts` from `app`: 2 tests passed.

### Task 2: Render one aggregate Qwen row and target its main source

**Files:**
- Modify: `app/web/src/usage/UsageFeatureSurface.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/usage/QwenUsageDialog.tsx`
- Test: `app/__tests__/web-usage-feature-surface.test.tsx`
- Test: `app/web/src/usage/QwenUsageDialog.test.tsx`

**Acceptance:** Compact and detail surfaces render one Qwen row/section, show all contributing Hub identities, and use the aggregate's source list for history. Login starts directly from the trusted button event like DeepSeek; success/error/close state remains local to the selected main source. Browser hosts keep the disabled explanatory state.

- [ ] **Step 1: Add surface and login-event regression tests first**

  Add a global Qwen placeholder fixture with two Hub sources and assert one rendered row/detail with both Hub identities. Add a dialog test that mocks the native request and verifies the request is started directly by the Login button handler. Run the two focused Jest files; each new assertion must fail against the current implementation.

- [ ] **Step 2: Implement aggregate placeholder and provider targeting**

  Build Qwen placeholder source references from all aggregate Hubs, remove the Qwen-specific Hub filter when resolving the current provider, and keep the existing first-source selection for OAuth writes/history fallback. Do not change other providers.

- [ ] **Step 3: Implement the DeepSeek-style direct Qwen login click path**

  Keep Qwen's existing callback/result handling but invoke `requestNativeQwenLogin()` directly in the click handler before any asynchronous continuation, so Android's trusted-user-gesture gate sees the same event shape as DeepSeek.

- [ ] **Step 4: Run the focused surface and dialog tests green**

  Re-run both Jest files and verify that the aggregate has one target while all source references remain available to history/login logic.

### Task 3: Repair the PC Qwen login window lifecycle

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/qwen_login_windows.go`
- Test: `server/cmd/wheelmaker-desktop/qwen_login_test.go`

**Acceptance:** The PC login window remains an owned independent popup, is created and destroyed on the locked UI thread, closes on callback/window close/timeout without terminating the main client, and does not rely on DeepSeek localStorage or token field names. The official Qwen callback continues to validate state and extract only the existing protected fields.

- [ ] **Step 1: Add a lifecycle source-contract test first**

  Assert the Qwen Windows implementation contains the locked UI thread, owned-popup tracker, explicit timeout, callback/close termination, and safe DeepSeek teardown helper calls. Run the focused desktop Go test; it must fail before the lifecycle repair.

- [ ] **Step 2: Align the Windows lifecycle with DeepSeek**

  Add an explicit Qwen timeout/termination path and safe completion/close cleanup around the existing callback wait. Preserve the Qwen URL allowlist, local callback, state validation, and credential extraction; do not copy DeepSeek polling or storage assumptions.

- [ ] **Step 3: Run focused desktop tests and the Windows compile check**

  Run the package's hidden Go test runner and the repository's existing Windows cross-compile check when the required Go toolchain is available. Record compile/runtime boundaries separately.

### Task 4: Make Android Qwen login a resilient DeepSeek-style in-app page

**Files:**
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/QwenLoginDialog.kt`
- Test: `mobile/android/app/src/test/java/com/wheelmaker/android/QwenLoginProtocolTest.kt`

**Acceptance:** Android opens a full-screen in-app login page with a close action, wide viewport, progress feedback, explicit main-frame error state, retry, and visible blocked-navigation errors. It preserves the Qwen callback URL/state and allowlist and returns only the existing protected callback result. A blocked or failed page never closes the whole app.

- [ ] **Step 1: Add Android source-contract tests first**

  Assert the Qwen dialog has the DeepSeek-style full-screen/page controls, wide viewport, progress, retry, and WebView error callbacks. Run the focused Android test if a Gradle runner is available; otherwise run the source test through the repository's available Kotlin/Gradle path and record the unavailable tool.

- [ ] **Step 2: Implement the resilient Qwen WebView page**

  Port only the DeepSeek page/lifecycle mechanics into Qwen: keep Qwen's callback server, start URL, host allowlist, callback extraction, timeout, and result callback. Add explicit retry/error UI and wide viewport settings; do not change authorization policy or credentials.

- [ ] **Step 3: Run the focused Android/static checks**

  Verify the source-contract tests, callback/allowlist tests, and Kotlin formatting/static checks available in the checkout. Keep the no-Gradle boundary explicit if the runner is absent.

### Task 5: Focused verification and Git handoff

**Files:**
- Modify: this plan's checkboxes and verification notes only as evidence is produced.

**Acceptance:** Focused tests and static checks pass for the changed behavior; no Web production build is run; no secret values are introduced; `git diff --check` is clean; unrelated `.skill-source-lock.json.lock` remains untouched. Live Bailian account validation is reported as unrun when credentials are unavailable.

- [ ] **Step 1: Run the complete focused verification set**

  Run the changed Jest files, desktop Go package tests, available Android tests, and TypeScript check when dependencies permit. Do not broaden to unrelated suites.

- [ ] **Step 2: Audit the diff and serialized/source boundaries**

  Check for Qwen token/cookie/API-key leakage, accidental Hub protocol changes, unwanted Credits aggregation, unexpected Web build output, and unrelated worktree changes.

- [ ] **Step 3: Update this plan and checkpoint only scoped files**

  Record exact pass/block evidence, run `git diff --check`, stage only task files, and use `git-workflow checkpoint`/`finalize` according to the prepared Git context. Do not push or merge unless the configured workflow and all required acceptance checks permit it.
