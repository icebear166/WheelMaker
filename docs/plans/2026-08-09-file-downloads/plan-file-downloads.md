# File Downloads Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Invoke git-workflow-preferences through prepare/checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure, streaming downloads for every WheelMaker-managed current file to the browser, Desktop, or Android device through shared right-click and long-press file actions.

**Scope Source:** Approved spec `docs/scope/2026-08-09-file-downloads.md`

**Architecture:** The Web UI normalizes project files, Hub-local external files, and persisted session attachments into one download source descriptor and asks the authenticated Registry WebSocket for a short-lived, one-use capability URL. Registry binds the capability to the Web session, probes and then streams bounded chunks from new Hub open/read/close methods into an HTTP attachment response; Android independently validates the exact Registry origin/path and forwards only the same-origin session cookie to `DownloadManager`.

**Tech Stack:** Go 1.x HTTP/WebSocket services and tests; React 19 + TypeScript + Jest; Android Kotlin/JVM tests and `DownloadManager`; Markdown project Wiki.

**Verification:** `go test ./internal/protocol ./internal/hub ./internal/hub/client ./internal/registry ./cmd/wheelmaker-desktop`; `npm test -- --runInBand`; `npm run tsc:web`; `./gradlew.bat testDebugUnitTest`; focused manual browser/Desktop/Android smoke checklist.

---

### Task 1: Document the supported file-download contract

**Files:**
- Modify: `docs/wiki/features/file-links.md`
- Modify: `docs/plans/2026-08-09-file-downloads/plan-file-downloads.md`

**Acceptance:** The project Wiki describes all three managed source kinds, the shared right-click/long-press action, Registry-to-Hub streaming, platform-native download ownership, capability security, failure behavior, compatibility, and explicit exclusions without contradicting the approved spec.

- [x] **Step 1: Read the wiki skill and current feature page**

Run: `Get-Content -Raw D:\Code\skills\skills\wiki\SKILL.md; Get-Content -Raw docs/wiki/features/file-links.md`

Expected: the complete Wiki instructions and current file-link behavior are available before editing.

- [x] **Step 2: Update the confirmed Wiki target**

Add a `Download` section that records the user-visible entry points, source descriptor boundary, single-use session-bound URL, no-Range streaming lifecycle, browser/Desktop/Android launch paths, errors, and non-goals.

- [x] **Step 3: Verify terminology and links**

Run: `rg -n "Download|right-click|long-press|capability|Range|DownloadManager|project file|external file|attachment" docs/wiki/features/file-links.md`

Expected: every required concept appears and no text claims arbitrary HTTP URLs, directories, history blobs, resume, or an in-app download manager are supported.

- [x] **Step 4: Git checkpoint**

Invoke `git-workflow-preferences` in `checkpoint` mode for the spec, plan, and Wiki files. Record the result below; the configured policy should skip the commit until the whole task is complete.

Checkpoint: skipped — `docs/user/git-preferences.md` permits automatic commits only after the entire task is complete and verified.

### Task 2: Register the additive Registry 2.7 download methods

**Files:**
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`

**Acceptance:** `file.download.prepare` is a browser client/project-scoped Registry-local request; `file.download.open`, `file.download.read`, and `file.download.close` are internal project forwards used by Registry and Hub; `DefaultProtocolVersion` remains `2.7`.

- [x] **Step 1: Write failing descriptor and routing tests**

Add `TestFileDownloadMethodsAreAdditiveWithoutVersionChange` asserting:

```go
prepare, ok := RegistryMethod(RegistryMethodFileDownloadPrepare)
if !ok || prepare.Route != RegistryRouteFileDownload || !prepare.RequiresProjectID { t.Fatal(...) }
if !RegistryMethodAllowed(string(RegistryRoleClient), prepare.Method) { t.Fatal(...) }
for _, method := range []string{RegistryMethodFileDownloadOpen, RegistryMethodFileDownloadRead, RegistryMethodFileDownloadClose} {
    desc, ok := RegistryMethod(method)
    if !ok || desc.Route != RegistryRouteProjectForward || !desc.RequiresProjectID || len(desc.Roles) != 0 { t.Fatal(...) }
}
if DefaultProtocolVersion != "2.7" { t.Fatal(...) }
```

The role assertions also prove that open/read/close cannot be invoked by a public client connection. Registry-local dispatch is deferred to Task 4 so its first production hook follows the capability handler's failing tests.

- [x] **Step 2: Run tests to verify RED**

Run: `go test ./internal/protocol ./internal/registry -run 'FileDownload|RegistryMethodDescriptorsAreSelfConsistent'`

Expected: FAIL because the constants, route descriptor, and local dispatch do not exist.

- [x] **Step 3: Add minimal method descriptors and dispatch hook**

Define `RegistryRouteFileDownload`, the four method constants, a client-only prepare descriptor, and role-less internal project-forward descriptors; do not change the protocol version or any existing method.

- [x] **Step 4: Run focused tests to verify GREEN**

Run: `go test ./internal/protocol ./internal/registry -run 'FileDownload|RegistryMethodDescriptorsAreSelfConsistent|RegistryDefaultProtocolVersionIs27'`

Expected: PASS.

- [x] **Step 5: Git checkpoint**

Invoke checkpoint for the protocol and dispatch files; record commit or policy skip.

Checkpoint: skipped — configured Git preferences commit only after complete task verification.

### Task 3: Implement bounded Hub file transfers

**Files:**
- Create: `server/internal/hub/file_download.go`
- Create: `server/internal/hub/file_download_test.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/client/session_attachments.go`
- Modify: `server/internal/hub/client/client_test.go`

**Acceptance:** Hub opens regular project/external/attachment files, returns safe metadata and an opaque identity, reads only the requested next bounded chunk, detects offset/source changes, and closes all handles on completion, explicit close, error, or Registry disconnect.

- [x] **Step 1: Write failing project/external transfer tests**

Test a file larger than two `fileDownloadChunkSize` values and assert open metadata, consecutive decoded chunks, EOF only at the declared size, wrong offset rejection, close idempotence, path traversal rejection, directory rejection, and an external absolute file outside the project root. Instrument the reader/manager and assert no read request exceeds the chunk limit.

- [x] **Step 2: Run the transfer tests to verify RED**

Run: `go test ./internal/hub -run 'FileDownload'`

Expected: FAIL because `newFileDownloadManager` and its open/read/close behavior do not exist.

- [x] **Step 3: Implement the minimal transfer manager**

Use `os.Open`, a cryptographically random transfer ID, a mutex-protected bounded map, and sequential `ReadAt`/offset checks. Resolve project paths through `safeJoin`, external paths through `resolveExternalFilePath`, reject non-regular files, return basename/size/safe MIME/identity, compare `os.SameFile`, size, and modification time before each read, and close/remove transfers on all terminal paths. Never use `os.ReadFile` for these methods.

- [x] **Step 4: Write failing attachment resolver tests**

Add a client test that creates a persisted session attachment and asserts `ResolveSessionAttachmentDownload(ctx, sessionID, attachmentID, uri)` returns the resolved file path, original attachment name, and MIME while rejecting a mismatched session or path outside the attachment root.

- [x] **Step 5: Run attachment tests to verify RED**

Run: `go test ./internal/hub/client -run 'SessionAttachmentDownload'`

Expected: FAIL because the resolver is not exported through the narrow download interface.

- [x] **Step 6: Add the attachment resolver and Reporter handlers**

Reporter integration test added before the handler; the attachment resolver implementation is already GREEN, and the Reporter open/read/close dispatch remains pending this step.

Add the optional `SessionAttachmentDownloadResolver` interface beside `SessionHandler`, implement it on `client.Client` by reusing `resolveSessionAttachment`, and handle open/read/close in `Reporter.handleRegistryRequest`. Translate typed validation/not-found/unavailable failures to existing Registry error codes and call `CloseAll` when a Reporter WebSocket session ends.

- [x] **Step 7: Verify GREEN and regressions**

Run: `go test ./internal/hub ./internal/hub/client -run 'FileDownload|SessionAttachment|FSRead|Reporter'`

Expected: PASS, including multi-chunk bytes and cleanup assertions.

- [x] **Step 8: Git checkpoint**

Invoke checkpoint for the Hub transfer unit; record commit or policy skip.

Checkpoint: skipped — configured Git preferences commit only after complete task verification.

### Task 4: Issue and serve Registry download capabilities

**Files:**
- Create: `server/internal/registry/file_download.go`
- Create: `server/internal/registry/file_download_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/http_routes.go`
- Modify: `server/internal/registry/web_session.go`

**Acceptance:** An authenticated browser client with the correct CSRF token can obtain a high-entropy, bounded, short-lived, session/base-path/source-bound task; one same-session GET streams exact Hub bytes once with safe headers, while expiry, mismatch, duplicates, Range, cancellation, source changes, and Hub errors consume/clean up safely.

- [x] **Step 1: Write failing capability-store tests**

Use an injectable clock/random reader and assert distinct 256-bit URL-safe tokens, capacity enforcement, expiry, non-consuming session mismatch, atomic claim under concurrent GET attempts, and one-use consumption. Assert the stored task contains a source descriptor and metadata but no full file bytes or exposed host path in its URL.

- [x] **Step 2: Run capability tests to verify RED**

Run: `go test ./internal/registry -run 'FileDownloadCapability'`

Expected: FAIL because the capability store is missing.

- [x] **Step 3: Implement the bounded capability store and prepare handler**

The capability store is GREEN; a failing end-to-end prepare test now covers browser-session CSRF and Hub open/close probing before the handler is added.

Capture `DeviceID`, `BasePath`, and `CSRFToken` from the authenticated Web session into connection state. Validate the discriminated source payload and CSRF token, probe the Hub with open then close, convert unsupported-method responses to a clear unavailable error, and return only `/BASE/download/<token>`, safe filename, MIME, and size.

- [x] **Step 4: Write failing HTTP streaming tests**

Drive the real Registry handler with an authenticated cookie and fake Hub responder. Assert status/body, exact `Content-Length`, `Content-Disposition: attachment` with safe ASCII fallback plus RFC 5987 name, `Accept-Ranges: none`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, multi-chunk forwarding, exact base-path matching, no query acceptance, 401/403/404/410 outcomes, Range rejection, duplicate GET rejection, and close on client cancellation/read error/metadata mismatch.

- [x] **Step 5: Run HTTP tests to verify RED**

Run: `go test ./internal/registry -run 'FileDownloadHTTP|FileDownloadPrepare'`

Expected: FAIL because the route and streaming response do not exist.

- [x] **Step 6: Implement the minimal HTTP streaming route**

Recognize only `GET <basePath>/download/<single-token-segment>`, authenticate the same Web session, reject `Range` before streaming, atomically claim the task, open and compare Hub identity/metadata, write attachment headers, then decode and immediately write each bounded base64 chunk. Defer Hub close; terminate on context cancellation, short/oversized/invalid chunks, source changes, premature EOF, or Hub disconnect. Do not buffer the complete body.

Clear the HTTP server's normal write deadline for this verified download route through `http.NewResponseController(w).SetWriteDeadline(time.Time{})`, while leaving existing request deadlines unchanged, so valid large downloads are not capped at 30 seconds.

- [x] **Step 7: Verify GREEN and Registry regressions**

Run: `go test ./internal/registry ./internal/protocol -run 'FileDownload|HTMLPreview|WebSession|RegistryMethod'`

Expected: PASS.

- [x] **Step 8: Git checkpoint**

Invoke checkpoint for the Registry capability/HTTP unit; record commit or policy skip.

Checkpoint: skipped — configured Git preferences commit only after complete task verification.

### Task 5: Add the Web download client and platform launchers

**Files:**
- Create: `app/web/src/file/fileDownload.ts`
- Create: `app/web/src/file/fileDownload.test.ts`
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.test.ts`
- Modify: `app/web/src/platform/android/androidNativeMessageBridge.ts`
- Modify: `app/__tests__/web-android-native-message-bridge.test.ts`

**Acceptance:** Web code prepares typed downloads with current CSRF/project context and launches browser/Desktop through a transient same-origin anchor or Android through a user-action-granted native call, with no Blob/base64 accumulation or arbitrary URL support.

- [x] **Step 1: Write failing repository/service tests**

Assert `prepareFileDownload(projectId, csrfToken, source)` sends method `file.download.prepare`, the project ID, and the exact discriminated source; assert Registry error text is preserved for unavailable/invalid sources.

- [x] **Step 2: Run service tests to verify RED**

Run: `npm test -- --runInBand web/src/registry/RegistryWorkspaceService.test.ts`

Expected: FAIL because the method/types/API are absent.

- [x] **Step 3: Add minimal typed prepare API**

Define the three source variants and prepare response, add the method constant, and thread `prepareFileDownload` through Repository and WorkspaceService without fallback to preview/read methods.

- [x] **Step 4: Write failing launcher tests**

Assert project-relative versus external source normalization, stable attachment identifier validation, same-origin/base-path URL resolution, a transient anchor click/removal for browser/Desktop, and Android ordering of `reserveUserAction('file.download')` before prepare followed by `file.download.start` with URL/name/MIME/size/grant. Reject off-origin and non-download paths.

- [x] **Step 5: Run launcher tests to verify RED**

Run: `npm test -- --runInBand web/src/file/fileDownload.test.ts app/__tests__/web-android-native-message-bridge.test.ts`

Expected: FAIL because the launcher and bridge action do not exist.

- [x] **Step 6: Implement the launchers**

Reserve the Android grant synchronously from the menu action, await Registry prepare, call `file.download.start` only on Android, and otherwise click/remove an anchor pointing at the same-origin capability URL. Return normalized user-facing errors; never fetch to a Blob or set an arbitrary Hub/file URL.

- [x] **Step 7: Verify GREEN and type checking**

Run: `npm test -- --runInBand web/src/registry/RegistryWorkspaceService.test.ts web/src/file/fileDownload.test.ts app/__tests__/web-android-native-message-bridge.test.ts; npm run tsc:web`

Expected: PASS.

- [x] **Step 8: Git checkpoint**

Invoke checkpoint for the Web transport/launcher unit; record commit or policy skip.

Checkpoint: skipped — configured Git preferences commit only after complete task verification.

### Task 6: Expose one shared right-click and long-press file action model

**Files:**
- Create: `app/web/src/common/useContextMenuGesture.ts`
- Create: `app/web/src/common/useContextMenuGesture.test.tsx`
- Modify: `app/web/src/chat/ChatFileLinkContextMenu.tsx`
- Modify: `app/__tests__/web-chat-file-link-context-menu.test.tsx`
- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Modify: `app/web/src/chat/ChatTurnView.test.tsx`
- Modify: `app/web/src/file/FileExplorerTree.tsx`
- Modify: `app/__tests__/web-preview-file-regressions.test.tsx`
- Modify: `app/web/src/preview/PreviewWorkbenchChrome.tsx`
- Modify: `app/web/src/preview/PreviewWorkbenchChrome.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`

**Acceptance:** Download appears on valid chat file links, sent attachments, non-deleted Changed Files, current file previews/tabs, Preview tree/search, and quick file search; mouse right-click and touch/pen long-press open the same menu; invalid/deleted/directory/HTTP/history/diff/draft-only targets do not offer a successful download.

- [x] **Step 1: Write failing gesture tests**

Use fake timers and pointer events to assert immediate context-menu invocation for right-click, invocation after a 450 ms non-mouse press, cancellation after movement greater than 8 px/pointer up/cancel, suppression of the synthetic click after a completed long press, and cleanup on unmount.

- [x] **Step 2: Run gesture tests to verify RED**

Run: `npm test -- --runInBand web/src/common/useContextMenuGesture.test.tsx`

Expected: FAIL because the shared hook is missing.

- [x] **Step 3: Implement the minimal gesture hook**

Return context-menu and pointer handlers backed by one timer/active pointer record; report viewport coordinates to a shared callback and avoid changing normal click behavior unless a long press completed.

- [x] **Step 4: Write failing menu and surface tests**

Assert `Download` follows `Preview file`, is available without Desktop-only actions, and attachment-only menus contain only applicable actions. Add component/source-boundary tests that invoke the context callback for every accepted surface and assert hidden behavior for deleted Changed Files, directories, unresolved attachments, inline draft-only attachments, diff/history tabs, and ordinary HTTP links.

- [x] **Step 5: Run menu/surface tests to verify RED**

Run: `npm test -- --runInBand app/__tests__/web-chat-file-link-context-menu.test.tsx web/src/chat/ChatTurnView.test.tsx app/__tests__/web-preview-file-regressions.test.tsx web/src/preview/PreviewWorkbenchChrome.test.tsx app/__tests__/web-chat-file-peek-viewer.test.ts`

Expected: FAIL because Download and touch context callbacks are absent.

- [x] **Step 6: Wire all managed file surfaces**

Generalize the menu target to path or persisted attachment, derive project versus external sources from `PreviewFileLink.relativePath`, keep all existing actions unchanged, and add the shared gesture handlers to chat links, attachment chips, Changed rows, file tree/search results, quick search results, and eligible preview tabs/actions. The single action handler calls Task 5 and shows the existing app error surface on preparation/launch failure.

- [x] **Step 7: Verify GREEN, regressions, and type checking**

Run: `npm test -- --runInBand app/__tests__/web-chat-file-link-context-menu.test.tsx web/src/chat/ChatTurnView.test.tsx app/__tests__/web-preview-file-regressions.test.tsx web/src/preview/PreviewWorkbenchChrome.test.tsx app/__tests__/web-chat-file-peek-viewer.test.ts app/__tests__/web-menu-keyboard-nav.test.ts; npm run tsc:web`

Expected: PASS with existing preview/open/copy/export behavior intact.

- [x] **Step 8: Git checkpoint**

Invoke checkpoint for the shared UI action unit; record commit or policy skip.

Checkpoint: skipped — configured Git preferences commit only after complete task verification.

### Task 7: Secure Android DownloadManager handoff and preserve Desktop policy

**Files:**
- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidFileDownloadRuntime.kt`
- Create: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidFileDownloadRuntimeTest.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/TrustedNativeUserAction.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/TrustedWebMessagePolicy.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/TrustedNativeUserActionTest.kt`
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/TrustedWebMessagePolicyTest.kt`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy_test.go`

**Acceptance:** Android starts only an exact same-origin/base-path Registry capability download after consuming a `file.download` user-action grant, passes the current same-origin Cookie and metadata to DownloadManager, and rejects untrusted calls; Desktop retains trusted navigation while WebView2 owns download UI.

- [x] **Step 1: Write failing Android policy/runtime tests**

Assert `file.download.start` is a trusted business action, `file.download` grants are one-use/expiring, and URL validation rejects wrong scheme/origin/port/base path, query, fragment, userinfo, extra segments, and decoded traversal. With injected cookie/request/enqueue adapters, assert an accepted URL yields one DownloadManager request with exact URL, Cookie/User-Agent headers, safe source filename, MIME, public Downloads destination, and visible completion notification.

- [x] **Step 2: Run Android tests to verify RED**

Run: `./gradlew.bat testDebugUnitTest --tests 'com.wheelmaker.android.AndroidFileDownloadRuntimeTest' --tests 'com.wheelmaker.android.TrustedNativeUserActionTest' --tests 'com.wheelmaker.android.TrustedWebMessagePolicyTest'`

Expected: FAIL because the action/runtime are absent.

- [x] **Step 3: Implement the minimal Android runtime and bridge dispatch**

Parse the configured HTTPS Registry base with `URI`, require exact origin and `<basePath>/download/<token>`, obtain `CookieManager.getCookie(url)` only after validation, sanitize/fallback the filename, and enqueue `DownloadManager.Request`. Add runtime injection to `WheelMakerBridge`; consume and remove the `file.download` grant before calling it. Keep the generic WebView download listener behavior separate so the dedicated action is not duplicated.

- [x] **Step 4: Verify Android GREEN**

Run: `./gradlew.bat testDebugUnitTest --tests 'com.wheelmaker.android.AndroidFileDownloadRuntimeTest' --tests 'com.wheelmaker.android.TrustedNativeUserActionTest' --tests 'com.wheelmaker.android.TrustedWebMessagePolicyTest'`

Expected: PASS.

- [x] **Step 5: Write and run Desktop regression test**

Add an assertion that an exact same-origin Registry `/download/<token>` navigation is permitted by existing WebView policy while cross-origin and malformed paths remain blocked where policy applies.

Run: `go test ./cmd/wheelmaker-desktop -run 'Download|Navigation|WebView'`

Expected: PASS; no native Desktop file-reading bridge is introduced.

- [x] **Step 6: Run Android regressions**

Run: `./gradlew.bat testDebugUnitTest`

Expected: PASS.

- [x] **Step 7: Git checkpoint**

Invoke checkpoint for Android/Desktop integration; record commit or policy skip.

Checkpoint: skipped — configured Git preferences commit only after complete task verification. The repository has no `gradlew.bat`, so the installed `gradle` executable ran the same focused and full `testDebugUnitTest` tasks successfully (89 tests).

### Task 8: Complete cross-stack verification and Git finalize

**Files:**
- Modify: `docs/plans/2026-08-09-file-downloads/plan-file-downloads.md`

**Acceptance:** Automated checks demonstrate the approved behavior, no excluded fallback/whole-file path was added, manual smoke items are explicitly reported, and the configured Git workflow is completed.

- [x] **Step 1: Run server verification**

Run: `go test ./internal/protocol ./internal/hub ./internal/hub/client ./internal/registry ./cmd/wheelmaker-desktop`

Expected: PASS.

Result: PASS for all five packages. One initial `internal/hub` run failed intermittently amid runtime integration tests; an isolated rerun and a second uncached five-package run both passed.

- [x] **Step 2: Run Web verification**

Run: `npm test -- --runInBand; npm run tsc:web`

Expected: PASS.

Result: the download-focused 10 suites pass (119 tests) and `tsc:web` passes. The repository-wide Jest run remains non-green because 14 unrelated source/snapshot-style suites also fail on clean `main`; the worktree-only `motionContracts` line-ending mismatch was normalized without a Git content change and then passed (17 tests).

- [x] **Step 3: Run Android verification**

Run: `./gradlew.bat testDebugUnitTest`

Expected: PASS.

Result: PASS via installed `gradle testDebugUnitTest` (the repository does not contain `gradlew.bat`).

- [x] **Step 4: Audit scope/security invariants**

Run: `rg -n --glob '!**/dist/**' "file.download|/download/|DownloadManager" server app mobile docs/wiki/features/file-links.md`

Expected: download implementation is confined to the dedicated methods/routes/launchers; existing preview/read methods remain present and `DefaultProtocolVersion` remains `2.7`.

Run: `rg -n --glob '!**/dist/**' "os.ReadFile|readFile\(|new Blob|arrayBuffer" server/internal/hub/file_download.go server/internal/registry/file_download.go app/web/src/file/fileDownload.ts`

Expected: no matches showing whole-file reads or front-end Blob aggregation in the download path.

Result: no whole-file/Blob aggregation matches; the protocol remains `2.7`, and the dedicated download surface is confined to 24 implementation, test, and documentation files.

- [x] **Step 5: Record manual smoke status**

Report whether browser, WheelMaker Desktop, and Android devices were available. For each available platform verify small/multi-chunk files, default Downloads location, source filename, duplicate-name platform handling, native progress/cancel, offline failure, and retry; explicitly list unavailable device-only checks as residual risk rather than claiming them passed.

Result: no interactive browser, WheelMaker Desktop window, or physical/emulated Android device was available in this environment. Automated tests cover small/multi-chunk streaming, cancellation/cleanup, metadata and origin validation, and native request construction; OS Downloads placement, duplicate-name behavior, visible progress/cancel, and offline/retry UX remain device-smoke residuals.

- [x] **Step 6: Review diff and finish plan tracking**

Run: `git status -sb; git diff --check; git diff --stat; git diff -- docs/scope/2026-08-09-file-downloads.md docs/plans/2026-08-09-file-downloads/plan-file-downloads.md docs/wiki/features/file-links.md server app mobile`

Expected: only task-owned files changed, no whitespace errors, all completed steps checked, and any plan deviations recorded.

Result: PASS. `git diff --check` and `gofmt -l` are clean; normalized worktree-only line endings create no staged content; status contains only approved implementation, tests, spec, plan, and Wiki files.

- [x] **Step 7: Git finalize**

Invoke `git-workflow-preferences` in `finalize` mode with the real result. On complete verification: refresh/rebase, commit task-owned files, push `feat/file-downloads`, merge into a clean local `main`, push `main`, then remove the clean worktree and task branches as configured. If any verification fails, do not commit and report the preserved worktree/evidence.

Finalize: complete — refreshed against remote `main` through GitHub SSH-over-443, committed and pushed `feat/file-downloads`, fast-forwarded clean local `main`, and prepared the final plan-state commit before pushing `main` and removing the task worktree and branches.
