# MyFlicker Latest ACP Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WheelMaker interoperate with the current `myflicker` ACP bundle by preserving upstream session lifecycle behavior and only injecting the config/session compatibility WheelMaker still requires.

**Architecture:** Treat the latest `myflicker` bundle as the source of truth for `initialize`, `session/load`, and `session/list`. Replace the brittle “rewrite the whole resume flow” patch with a smaller compatibility layer that augments capability/result shapes and adds config option handlers without depending on one exact minified token sequence.

**Tech Stack:** Go, Node ESM loader patching, regex-based source transforms, `go test`

---

### Task 1: Replace legacy-only loader tests with latest-shape regression coverage

**Files:**
- Modify: `server/internal/hub/agent/agent_test.go`
- Test: `server/internal/hub/agent/agent_test.go`

- [ ] **Step 1: Write the failing latest-shape regression test**

```go
func TestFlickerLoaderPatchesLatestMyFlickerBundleShape(t *testing.T) {
	tempDir := t.TempDir()
	fixturePath := filepath.Join(tempDir, "myflicker-latest-fragment.mjs")
	if err := os.WriteFile(fixturePath, []byte(myFlickerLatestBundleFragment), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	patched := runFlickerLoaderPatch(t, fixturePath)
	wantSnippets := []string{
		"function WMF(",
		"agentCapabilities:WMFC(",
		"{sessionId:Q,configOptions:WMF(D,this.__wmfConfig)}",
		"return{configOptions:WMF(J,this.__wmfConfig)}",
		"async unstable_resumeSession(A){return await this.loadSession(A)}",
		"async unstable_setSessionConfigOption(A){let Q=A.configId,B=A.value;",
	}
	for _, snippet := range wantSnippets {
		if !strings.Contains(patched, snippet) {
			t.Fatalf("patched source missing %q:\n%s", snippet, patched)
		}
	}
	for _, stale := range []string{
		"{sessionId:Q,models:D||void 0}",
		"return await $.replay(B),rG(\"Session loaded successfully:\",A.sessionId),{models:J||void 0}",
	} {
		if strings.Contains(patched, stale) {
			t.Fatalf("patched source still contains stale snippet %q:\n%s", stale, patched)
		}
	}
}
```

- [ ] **Step 2: Run the focused test to verify RED**

Run: `go test ./internal/hub/agent -run TestFlickerLoaderPatchesLatestMyFlickerBundleShape -count=1`

Expected: FAIL because the current loader still looks for the legacy `agentCapabilities:{}}}async getCanUseModels()` shape and rewrites the whole `loadSession` body.

- [ ] **Step 3: Refresh the installed-bundle regression to match the latest contract**

```go
func TestFlickerLoaderPatchesInstalledMyFlickerBundleWhenAvailable(t *testing.T) {
	// existing setup unchanged...
	patched := runFlickerLoaderPatch(t, distPath)
	for _, snippet := range []string{
		"function WMF(",
		"function WMFC(",
		"configOptions:WMF(",
		"async unstable_resumeSession(A){return await this.loadSession(A)}",
		"async unstable_setSessionConfigOption(A){let Q=A.configId,B=A.value;",
	} {
		if !strings.Contains(patched, snippet) {
			t.Fatalf("patched installed bundle missing %q", snippet)
		}
	}
	if strings.Contains(patched, "session.messages.list") {
		t.Fatalf("latest patch should preserve upstream loadSession flow")
	}
}
```

- [ ] **Step 4: Run the focused latest-only test set**

Run: `go test ./internal/hub/agent -run "TestFlickerLoaderPatchesLatestMyFlickerBundleShape|TestFlickerLoaderPatchesInstalledMyFlickerBundleWhenAvailable" -count=1`

Expected: FAIL with the current loader, and the failure should point at missing latest-shape patch output rather than test setup errors.

- [ ] **Step 5: Commit the red test scaffolding after the green fix lands**

```bash
git add server/internal/hub/agent/agent_test.go
git commit -m "test: cover latest myflicker loader shape"
```

### Task 2: Shrink the loader patch to latest-compatible capability and config augmentation

**Files:**
- Modify: `server/internal/hub/agent/flicker_loader.go`
- Modify: `server/internal/hub/agent/agent_test.go`
- Test: `server/internal/hub/agent/agent_test.go`

- [ ] **Step 1: Add a capability wrapper helper instead of overwriting a fixed literal**

```javascript
function wrapCapabilitiesPatchSource() {
  return "function WMFC(A){A=A&&typeof A===\"object\"?A:{};return{...A,loadSession:!0}}";
}
```

- [ ] **Step 2: Rewrite only the capability expression and the `newSession` / `loadSession` return payloads**

```javascript
source = replaceOnceRegex(
  source,
  /(\{protocolVersion:\w+,agentCapabilities:)([^}][\s\S]*?)(\}\}async getCanUseModels\(\))/,
  "$1WMFC($2)$3",
  "initialize capabilities"
);
source = replaceOnceRegex(
  source,
  /\{sessionId:(\w+),models:(\w+)\|\|void 0\}/,
  "{sessionId:$1,configOptions:WMF($2,this.__wmfConfig)}",
  "newSession config options"
);
source = replaceOnceRegex(
  source,
  /return await (\w+)\.replay\((\w+)\),(\w+)\(\"Session loaded successfully:\",A\.sessionId\),\{models:(\w+)\|\|void 0\}/,
  "return await $1.replay($2),$3(\"Session loaded successfully:\",A.sessionId),{configOptions:WMF($4,this.__wmfConfig)}",
  "loadSession config options"
);
```

- [ ] **Step 3: Keep only WheelMaker-owned config helpers and method shims**

```javascript
source = replaceOnce(
  source,
  "unstable_resumeSession(A){throw Error(\"Method not implemented.\")}",
  "async unstable_resumeSession(A){return await this.loadSession(A)}",
  "resumeSession"
);
source = replaceOnce(
  source,
  "unstable_setSessionConfigOption(A){throw Error(\"Method not implemented.\")}",
  "async unstable_setSessionConfigOption(A){let Q=A.configId,B=A.value;if(!Q)throw Error(\"configId is required\");if(Q===\"model\"||Q===\"access\"||Q===\"effort\")return await WMFS(this,Q,B);throw Error(\"Unsupported config option \"+Q)}",
  "setSessionConfigOption"
);
```

- [ ] **Step 4: Run the focused tests to verify GREEN**

Run: `go test ./internal/hub/agent -run "TestFlickerLoaderPatchesLatestMyFlickerBundleShape|TestFlickerLoaderPatchesInstalledMyFlickerBundleWhenAvailable|TestFlickerACPProvider_LaunchArgs" -count=1`

Expected: PASS

- [ ] **Step 5: Run the broader package verification**

Run: `go test ./internal/hub/agent -count=1`

Expected: PASS

- [ ] **Step 6: Commit the latest-compat implementation**

```bash
git add server/internal/hub/agent/flicker_loader.go server/internal/hub/agent/agent_test.go
git commit -m "fix: align flicker loader with latest myflicker"
```
