# Android Native Bridge Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Repair Android response-image sharing and make every sensitive native-bridge flow use native user-presence evidence, bounded payloads, and server-scoped transient state.

**Architecture:** Keep the exact-origin, main-frame, Base Path, and action-allowlist boundary introduced by the secure WebMessage bridge. Replace page-authored gesture timestamps with a one-shot native gesture gate plus short-lived, action-bound grants for operations that legitimately finish preparation after the tap; stream PNG bytes through a bounded begin/chunk/commit protocol instead of one oversized JSON message. Clear all grants, partial transfers, speech state, and buffered diagnostics when switching servers, and harden both Web clients against oversized messages and unanswered requests.

**Tech Stack:** Kotlin/JVM, Android WebViewCompat WebMessageListener, TypeScript, React, Jest, JUnit 4, Go embedded assets

---

## File structure

- Create `mobile/android/app/src/main/java/com/wheelmaker/android/TrustedNativeUserAction.kt`: one-shot native gesture gate and action-bound deferred grant store.
- Create `mobile/android/app/src/test/java/com/wheelmaker/android/TrustedNativeUserActionTest.kt`: time, action, consumption, capacity, and clear semantics.
- Create `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidImageShareTransferStore.kt`: bounded sequential file-backed PNG transfer state.
- Create `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidImageShareTransferStoreTest.kt`: chunk order, byte limit, expiry, commit, cancel, and clear behavior.
- Modify `mobile/android/app/src/main/java/com/wheelmaker/android/TrustedWebMessagePolicy.kt`: remove page gesture data and obtain sensitive-action authorization from the native gate.
- Modify `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`: record trusted native touches, use the gate for WebMessages/file chooser, and clear transient state on server switch.
- Modify `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`: issue/consume deferred grants and dispatch the image transfer protocol.
- Modify `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidImageShareRuntime.kt`: decode one bounded chunk at a time and share only a committed PNG.
- Modify `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidWebDiagnostics.kt`: clear buffered records without changing the selected log level.
- Modify the matching Android unit tests under `mobile/android/app/src/test/java/com/wheelmaker/android/`.
- Modify `app/web/src/platform/android/androidNativeMessageBridge.ts`: remove Web-authored gesture data, add message-size preflight, deferred-grant RPC, and chunk RPCs.
- Modify `app/web/src/chat/export/responseImageOutput.ts`: reserve before rendering and send Blob bytes as chunks.
- Modify `app/web/src/platform/android/androidNativeSpeechRuntime.ts`: reserve speech start and pass the grant only to `speech.start`.
- Modify `app/web/src/app/WorkspaceApp.tsx`: carry the image grant through asynchronous rendering and reserve speech before connection/credential work.
- Modify `app/__tests__/web-android-native-message-bridge.test.ts`, `app/__tests__/web-response-image-output.test.ts`, `app/__tests__/web-android-native-speech-runtime.test.ts`, and `app/__tests__/web-chat-ui.test.ts`: cross-boundary protocol and ordering regressions.
- Create `app/__tests__/web-android-native-action-contract.test.ts`: keep Web requests, Android policy actions, and Android dispatch actions identical.
- Modify `server/cmd/wheelmaker-desktop/bootstrap/index.html` and `server/cmd/wheelmaker-desktop/app_test.go`: timeout-safe request handling with no page gesture field.
- Modify `docs/security.md`: document the actual native-gesture and bounded-transfer boundary.

### Task 1: Replace page gesture timestamps with native evidence and deferred grants

**Files:**
- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/TrustedNativeUserAction.kt`
- Create: `mobile/android/app/src/test/java/com/wheelmaker/android/TrustedNativeUserActionTest.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/TrustedWebMessagePolicy.kt`
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/TrustedWebMessagePolicyTest.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`

- [x] **Step 1: Write failing native gesture and grant tests**

```kotlin
@Test
fun gestureIsRecentSingleUseAndClearable() {
    val gate = TrustedUserGestureGate(maxAgeMillis = 5_000)
    gate.record(10_000)
    assertTrue(gate.consume(14_999))
    assertFalse(gate.consume(15_000))
    gate.record(20_000)
    gate.clear()
    assertFalse(gate.consume(20_001))
}

@Test
fun grantsAreActionBoundSingleUseExpiredAndClearable() {
    var now = 1_000L
    val grants = TrustedNativeActionGrantStore(now = { now }, ttlMillis = 60_000, capacity = 2)
    val token = grants.issue("image.share")
    assertFalse(grants.consume(token, "speech.start"))
    assertTrue(grants.consume(token, "image.share"))
    assertFalse(grants.consume(token, "image.share"))
    val expired = grants.issue("speech.start")
    now = 61_001
    assertFalse(grants.consume(expired, "speech.start"))
    val cleared = grants.issue("image.share")
    grants.clear()
    assertFalse(grants.consume(cleared, "image.share"))
}
```

- [x] **Step 2: Run the focused Android tests and confirm the new types are missing**

Run: `gradle :app:testDebugUnitTest --tests com.wheelmaker.android.TrustedNativeUserActionTest --tests com.wheelmaker.android.TrustedWebMessagePolicyTest` from `mobile/android`

Expected: FAIL because `TrustedUserGestureGate` and `TrustedNativeActionGrantStore` do not exist and the policy still requires `userGestureAt`.

- [x] **Step 3: Implement the native gesture and deferred-grant primitives**

```kotlin
class TrustedUserGestureGate(private val maxAgeMillis: Long = 5_000L) {
    private var recordedAt = 0L

    @Synchronized fun record(nowElapsedRealtime: Long) { recordedAt = nowElapsedRealtime }
    @Synchronized fun consume(nowElapsedRealtime: Long): Boolean {
        val age = nowElapsedRealtime - recordedAt
        if (recordedAt <= 0 || age !in 0..maxAgeMillis) return false
        recordedAt = 0
        return true
    }
    @Synchronized fun clear() { recordedAt = 0 }
}

class TrustedNativeActionGrantStore(
    private val now: () -> Long,
    private val ttlMillis: Long = 60_000L,
    private val capacity: Int = 8
) {
    private data class Grant(val action: String, val expiresAt: Long)
    private val grants = LinkedHashMap<String, Grant>()

    @Synchronized fun issue(action: String): String {
        require(action in setOf("image.share", "speech.start"))
        prune()
        while (grants.size >= capacity.coerceAtLeast(1)) grants.remove(grants.keys.first())
        return UUID.randomUUID().toString().also { grants[it] = Grant(action, now() + ttlMillis) }
    }
    @Synchronized fun consume(token: String, action: String): Boolean {
        prune()
        val grant = grants.remove(token) ?: return false
        return grant.action == action
    }
    @Synchronized fun clear() = grants.clear()
    private fun prune() {
        val current = now()
        grants.entries.removeAll { it.value.expiresAt < current }
    }
}
```

- [x] **Step 4: Make policy authorization consume native evidence only after source validation**

Change `TrustedWebMessageRequest` to contain only `requestId` and `action`. Change `authorize`/`isAllowed` to accept `consumeTrustedUserGesture: () -> Boolean = { false }`; after frame, allowlist, exact origin, and Base Path checks, reject sensitive actions unless that callback returns true. Add `userAction.reserve` to business and sensitive actions, replace `image.share` with `image.share.begin/chunk/commit/cancel`, and leave `speech.start` out of the immediate-sensitive set because dispatch will require its action-bound grant.

```kotlin
if (request.action in SENSITIVE_ACTIONS && !consumeTrustedUserGesture()) return null
return capability(request.action, nowElapsedRealtime)
```

- [x] **Step 5: Wire MainActivity and WheelMakerBridge to the new primitives**

Instantiate one gesture gate and one grant store. Record `ACTION_DOWN` only when the current top-level URL is the exact bootstrap URL or is contained by the configured Base Path. Pass `gestureGate::consume` to policy authorization, consume the same gate for file chooser, parse no `userGestureAt`, and use `userAction.reserve` to return `{token}` only for `image.share` or `speech.start`.

```kotlin
"userAction.reserve" -> JSONObject()
    .put("token", actionGrantStore.issue(payload.optString("action")))
    .toString()
"speech.start" -> {
    require(actionGrantStore.consume(payload.optString("userActionToken"), "speech.start"))
    payload.remove("userActionToken")
    androidSpeechRuntime.start(payload.toString())
}
```

- [x] **Step 6: Run the focused Android policy tests**

Run: `gradle :app:testDebugUnitTest --tests com.wheelmaker.android.TrustedNativeUserActionTest --tests com.wheelmaker.android.TrustedWebMessagePolicyTest --tests com.wheelmaker.android.SecureWebViewPolicyTest` from `mobile/android`

Expected: PASS; forged page timestamps are absent, trusted origin/path checks still reject untrusted messages, and a native gesture can authorize only one sensitive action.

### Task 2: Stream response images through a bounded native transfer

**Files:**
- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidImageShareTransferStore.kt`
- Create: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidImageShareTransferStoreTest.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidImageShareRuntime.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidImageShareRuntimeTest.kt`
- Modify: `app/web/src/platform/android/androidNativeMessageBridge.ts`
- Modify: `app/web/src/chat/export/responseImageOutput.ts`
- Modify: `app/__tests__/web-android-native-message-bridge.test.ts`
- Modify: `app/__tests__/web-response-image-output.test.ts`

- [x] **Step 1: Write failing transfer-store tests**

```kotlin
@Test
fun transferRequiresSequentialBoundedChunksAndExactCommitSize() {
    val root = temporaryFolder.newFolder("shares")
    val store = AndroidImageShareTransferStore(root, maxTotalBytes = 8, now = { 1_000 })
    val id = store.begin(expectedBytes = 6)
    assertTrue(store.append(id, 0, byteArrayOf(1, 2, 3)))
    assertFalse(store.append(id, 2, byteArrayOf(4)))
    assertTrue(store.append(id, 1, byteArrayOf(4, 5, 6)))
    assertNotNull(store.commit(id))
    assertNull(store.commit(id))
}

@Test
fun transferRejectsOversizeExpiresAndDeletesPartialFiles() {
    var now = 1_000L
    val root = temporaryFolder.newFolder("shares")
    val store = AndroidImageShareTransferStore(root, maxTotalBytes = 4, ttlMillis = 60_000, now = { now })
    assertNull(store.begin(expectedBytes = 5))
    val id = requireNotNull(store.begin(expectedBytes = 4))
    assertTrue(store.append(id, 0, byteArrayOf(1, 2)))
    now = 61_001
    assertFalse(store.append(id, 1, byteArrayOf(3, 4)))
    store.clear()
    assertFalse(root.walkTopDown().any { it.isFile })
}
```

- [x] **Step 2: Run the transfer tests and confirm failure**

Run: `gradle :app:testDebugUnitTest --tests com.wheelmaker.android.AndroidImageShareTransferStoreTest --tests com.wheelmaker.android.AndroidImageShareRuntimeTest` from `mobile/android`

Expected: FAIL because the transfer store and begin/chunk/commit/cancel runtime methods do not exist.

- [x] **Step 3: Implement the file-backed transfer store and runtime methods**

Allow one active PNG transfer, maximum 16 MiB, maximum decoded chunk size 128 KiB, 60-second expiry, sequential zero-based indexes, exact expected-byte commit, random transfer IDs, and recursive cleanup on cancel/clear. `AndroidImageShareRuntime.begin` consumes an already-validated expected byte count, `chunk` Base64-decodes only one chunk, `commit` launches `ACTION_SEND`, and `cancel` removes partial files.

```kotlin
fun begin(rawJson: String): String
fun append(rawJson: String): String
fun commit(rawJson: String): String
fun cancel(rawJson: String): String
fun clear()
```

Dispatch exactly:

```kotlin
"image.share.begin" -> {
    require(actionGrantStore.consume(payload.optString("userActionToken"), "image.share"))
    androidImageShareRuntime.begin(payload.toString())
}
"image.share.chunk" -> androidImageShareRuntime.append(payload.toString())
"image.share.commit" -> androidImageShareRuntime.commit(payload.toString())
"image.share.cancel" -> androidImageShareRuntime.cancel(payload.toString())
```

- [x] **Step 4: Write failing Web bridge and large-image tests**

Assert that the request envelope has only `requestId`, `action`, and `payload`; a serialized request over 512 KiB rejects before `postMessage`; a 400 KiB Blob produces `userAction.reserve`, `image.share.begin`, at least four bounded chunks, and `image.share.commit`; any failed chunk triggers `image.share.cancel`; desktop clipboard and browser download paths remain unchanged.

```ts
expect(requests.map(request => request.action)).toEqual([
  'userAction.reserve',
  'image.share.begin',
  'image.share.chunk',
  'image.share.chunk',
  'image.share.chunk',
  'image.share.chunk',
  'image.share.commit',
]);
expect(Math.max(...posted.map(message => message.length))).toBeLessThanOrEqual(512 * 1024);
```

- [x] **Step 5: Run focused Jest tests and confirm protocol failures**

Run: `npm test -- --runInBand web-android-native-message-bridge.test.ts web-response-image-output.test.ts` from `app`

Expected: FAIL because the current client emits `userGestureAt` and sends one Base64 data URL through `image.share`.

- [x] **Step 6: Implement Web request preflight and chunked output**

Serialize the request once, reject when `message.length > 512 * 1024`, call any previous `onmessage` handler inside its own `try/catch`, and expose these facade methods:

```ts
reserveUserAction(action: 'image.share' | 'speech.start'): Promise<string>;
beginResponseImageShare(fileName: string, size: number, userActionToken: string): Promise<string>;
appendResponseImageShare(transferId: string, index: number, data: string): Promise<string>;
commitResponseImageShare(transferId: string): Promise<string>;
cancelResponseImageShare(transferId: string): Promise<string>;
```

Encode Blob slices of 128 KiB independently so no request approaches the native envelope cap. Parse `{token}` and `{transferId}` strictly, attempt cancel after begin on every failure, and keep Android from falling back to a browser download.

- [x] **Step 7: Run focused Web and Android image tests**

Run: `npm test -- --runInBand web-android-native-message-bridge.test.ts web-response-image-output.test.ts` from `app`

Run: `gradle :app:testDebugUnitTest --tests com.wheelmaker.android.AndroidImageShareTransferStoreTest --tests com.wheelmaker.android.AndroidImageShareRuntimeTest` from `mobile/android`

Expected: PASS with every WebMessage below 512 KiB and native commit sharing the exact transferred bytes.

### Task 3: Reserve delayed image and speech operations at the original tap

**Files:**
- Modify: `app/web/src/chat/export/responseImageOutput.ts`
- Modify: `app/web/src/platform/android/androidNativeSpeechRuntime.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-response-image-output.test.ts`
- Modify: `app/__tests__/web-android-native-speech-runtime.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`

- [x] **Step 1: Write failing reservation-order tests**

Add tests proving `reserveResponseImageShare()` produces the token before `MarkdownImageExportRequest` is created and that native speech exposes `reserveStart()` separately from `start(payload, token)`. The Workspace source regression must ensure reservation is above the first awaited reconnect/credential operation.

```ts
const reserveIndex = mainTsx.indexOf('await androidSpeechRuntime.reserveStart()');
const connectIndex = mainTsx.indexOf('if (!connectedRef.current) await connect', reserveIndex);
const startIndex = mainTsx.indexOf('await androidSpeechRuntime.start(', connectIndex);
expect(reserveIndex).toBeGreaterThan(-1);
expect(reserveIndex).toBeLessThan(connectIndex);
expect(connectIndex).toBeLessThan(startIndex);
```

- [x] **Step 2: Run focused Jest tests and confirm failure**

Run: `npm test -- --runInBand web-response-image-output.test.ts web-android-native-speech-runtime.test.ts web-chat-ui.test.ts` from `app`

Expected: FAIL because image render and speech reconnect currently happen before the sensitive native request.

- [x] **Step 3: Carry the image grant through render state**

Add `userActionToken?: string` to `MarkdownImageExportRequest`. In the click handler, reserve only when an Android message target is present, report update/authorization errors immediately, then store the token. Pass it from `MarkdownImageExportSurface` into `outputResponseImage`; the output function requires it on Android but ignores it on desktop/browser.

- [x] **Step 4: Reserve native speech before reconnect and credential synchronization**

Add `reserveStart(): Promise<string>` and change `start(payload, userActionToken)`. At the first line of the native speech branch, reserve the grant; then reconnect/synchronize; finally pass that token to `speech.start`. Do not reserve for Registry speech, reconnects of an already-authorized native session, finish, or cancel.

```ts
const nativeSpeechStartToken = await androidSpeechRuntime.reserveStart();
if (!connectedRef.current) await connect({silentReconnect: true});
await synchronizeAndroidSpeechCredential(/* existing arguments */);
const response = await androidSpeechRuntime.start(payload, nativeSpeechStartToken);
```

- [x] **Step 5: Run focused delayed-operation tests**

Run: `npm test -- --runInBand web-response-image-output.test.ts web-android-native-speech-runtime.test.ts web-chat-ui.test.ts` from `app`

Expected: PASS; both slow paths reserve at the original native-confirmed tap.

### Task 4: Harden bootstrap requests and server-switch cleanup

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/bootstrap/index.html`
- Modify: `server/cmd/wheelmaker-desktop/app_test.go`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidWebDiagnostics.kt`
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidWebDiagnosticsTest.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidImageShareRuntimeTest.kt`
- Modify: `docs/security.md`

- [x] **Step 1: Write failing bootstrap and lifecycle tests**

Make the Go embedded-bootstrap test require a 30-second timeout, a UUID fallback, timeout cleanup, no `userGestureAt`, and form/retry/reset handlers with `try/catch/finally`. Add Android tests for `AndroidWebDiagnostics.clear()` retaining log level and source assertions that server switch clears the gesture gate, grant store, image transfer, diagnostics, and speech credential.

```kotlin
diagnostics.record("old_server", level = "error")
diagnostics.clear()
assertEquals("error", diagnostics.getLogLevel())
assertEquals(0, JSONObject(diagnostics.drainJson()).getJSONArray("records").length())
```

- [x] **Step 2: Run Go and Android tests and confirm failure**

Run: `go test ./cmd/wheelmaker-desktop` from `server`

Run: `gradle :app:testDebugUnitTest --tests com.wheelmaker.android.AndroidWebDiagnosticsTest --tests com.wheelmaker.android.AndroidImageShareRuntimeTest` from `mobile/android`

Expected: FAIL because bootstrap has no timeout/fallback/finally and server switch does not clear all transient bridge state.

- [x] **Step 3: Harden bootstrap without changing desktop direct-method fallback**

Generate request IDs with `crypto.randomUUID?.()` or a monotonic timestamp fallback, register a 30-second timer per pending request, clear timers on replies, reject on timeout/post failure, remove page gesture listeners/fields, and funnel button actions through a helper that renders errors and always restores disabled state.

- [x] **Step 4: Clear all server-scoped native state**

Add synchronized `AndroidWebDiagnostics.clear()`. At the beginning of `clearCurrentServerState`, clear the speech credential (which cancels the active session), gesture, deferred grants, partial image transfer, and buffered diagnostics; preserve the diagnostic preference itself. Keep Web storage/cookie/cache clearing and business-listener replacement unchanged.

- [x] **Step 5: Update the security model**

Document that WebMessage source origin/main frame/Base Path/action allowlists remain mandatory; native `ACTION_DOWN` is one-shot and five seconds old at most; image/speech preparation receives a random action-bound, single-use, 60-second grant; image messages are 128 KiB decoded chunks under a 16 MiB total cap; server switches erase all transient native state.

- [x] **Step 6: Run bootstrap and lifecycle tests**

Run: `go test ./cmd/wheelmaker-desktop` from `server`

Run: `gradle :app:testDebugUnitTest --tests com.wheelmaker.android.AndroidWebDiagnosticsTest --tests com.wheelmaker.android.AndroidImageShareRuntimeTest --tests com.wheelmaker.android.TrustedNativeUserActionTest` from `mobile/android`

Expected: PASS.

### Task 5: Cross-boundary verification and delivery

**Files:**
- Modify: `docs/plans/nospec/2026-07-14-android-native-bridge-hardening/plan-android-native-bridge-hardening.md`

- [x] **Step 1: Verify the Web action inventory matches Android**

Run: `rg -o "request\('[^']+'" app/web/src/platform/android/androidNativeMessageBridge.ts`

Run: `rg '"(userAction|device|diagnostics|speech|notification|apk|image|relay)\.' mobile/android/app/src/main/java/com/wheelmaker/android/TrustedWebMessagePolicy.kt mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`

Expected: the facade, policy allowlist, and dispatcher contain the same actions; `userGestureAt` and the legacy `image.share` action are absent.

- [x] **Step 2: Run the complete Web verification**

Run: `npm test -- --runInBand` from `app`

Run: `npm run tsc:web` from `app`

Expected: all Jest suites pass and TypeScript reports no errors.

- [x] **Step 3: Run the complete Android verification**

Run: `gradle :app:testDebugUnitTest :app:assembleDebug :app:lintDebug` from `mobile/android`

Expected: unit tests, debug assembly, and lint pass.

- [x] **Step 4: Run desktop and repository security checks**

Run: `go test ./cmd/wheelmaker-desktop` from `server`

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security_acceptance.ps1` from the repository root.

Expected: Go tests and repository security checks pass.

- [x] **Step 5: Review the final diff and mark completed plan checkboxes**

Run: `git status --short`

Run: `git diff --check`

Run: `git diff --stat`

Expected: only the bridge plan, implementation, tests, bootstrap, and security documentation are changed; no whitespace errors.

- [x] **Step 6: Commit and push the unified repair**

Run exactly as the final command sequence:

```powershell
git add -A
git commit -m "fix: harden Android native bridge flows"
git push origin main
```

Expected: commit succeeds and `main` is pushed to `origin`.
