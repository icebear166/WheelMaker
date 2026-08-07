# MyFlicker 0.3.11 Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore WheelMaker's legacy MyFlicker configuration behavior on `@myflicker/cli` 0.3.11 without retaining support for older bundle shapes.

**Architecture:** Leave the 0.3.11 native session lifecycle, model option, and thinking-level option intact. The loader will augment its native configuration list with the legacy Access selector and handle that selector through the upstream `approvalMode` configuration key. WheelMaker will normalize persisted legacy `effort` preferences to 0.3.11's `thought_level` before replaying them.

**Tech Stack:** Go, Node ESM loader source transformation, Go tests.

---

### Task 1: Lock the 0.3.11 behavior with regression tests

**Files:**
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Add a loader fixture test that requires native options plus Access.**

```go
wantSnippets := []string{
	"function WMFA(",
	"configOptions:WMFA(this.buildSessionConfigOptions(D),this.__wmfConfig)",
	"if(Q===\"access\")return await WMFS(this,Q,B);",
	"async unstable_resumeSession(A){return await this.loadSession(A)}",
}
```

- [ ] **Step 2: Run the loader test and verify it fails because 0.3.11 currently retains only the resume shim.**

Run: `go test ./internal/hub/agent -run TestFlickerLoaderPatchesInstalledMyFlickerBundleWhenAvailable -count=1 -v`

Expected: FAIL with a missing `WMFA`/Access assertion.

- [ ] **Step 3: Add a client regression test that replays legacy effort as thought_level.**

```go
current := []acp.ConfigOption{{ID: "thought_level", CurrentValue: "low"}}
target := []PreferenceConfigOption{{ID: "effort", CurrentValue: "maxOrXhigh"}}
updated := applyStoredConfigOptions(context.Background(), "proj", "flicker", inst, "session-1", current, target)
if got := findCurrentValue(updated, "thought_level"); got != "xhigh" {
	t.Fatalf("thought_level=%q, want xhigh", got)
}
```

- [ ] **Step 4: Run the client test and verify it fails because preferences currently match only exact IDs/categories.**

Run: `go test ./internal/hub/client -run TestApplyStoredConfigOptionsMigratesFlickerLegacyEffort -count=1 -v`

Expected: FAIL because `effort` is skipped.

### Task 2: Restore the missing 0.3.11 functionality

**Files:**
- Modify: `server/internal/hub/agent/flicker_loader.go`
- Modify: `server/internal/hub/client/session.go`

- [ ] **Step 1: Add a 0.3.11-only Access option wrapper in the loader.**

```javascript
function WMFA(options, config) {
  config = config || {};
  const access = config.access || "yolo";
  return [{ id:"access", name:"Access", category:"access", type:"select", currentValue:access,
    options:[{value:"default",name:"Default"},{value:"autoEdit",name:"Auto Edit"},{value:"auto",name:"Auto"},{value:"yolo",name:"Yolo"},{value:"plan",name:"Plan"},{value:"dontAsk",name:"Dont Ask"}] }, ...options];
}
```

- [ ] **Step 2: Intercept only `configId === "access"`, use `config.set` with `approvalMode`, clear the project context, and return the wrapped native options.**

```javascript
async function WMFS(agent, value) {
  agent.__wmfConfig = { ...agent.__wmfConfig, access:value };
  await agent.messageBus.request("config.set", { cwd:agent.defaultCwd, key:"approvalMode", value, isGlobal:true });
  await agent.messageBus.request("project.clearContext", {});
  return { configOptions:WMFA(agent.buildSessionConfigOptions(await agent.getCanUseModels()), agent.__wmfConfig) };
}
```

- [ ] **Step 3: Keep the native `model`/`thought_level` branch and inject the wrapper into native new/load result construction.**

```javascript
source = replaceOnce(source, "return Q}", "return WMFA(Q,this.__wmfConfig)}", "0.3.11 config options");
source = replaceOnce(source, "if(Q===\"model\")", "if(Q===\"access\")return await WMFS(this,B);else if(Q===\"model\")", "0.3.11 access config");
```

- [ ] **Step 4: Normalize only persisted Flicker preferences before lookup.**

```go
func normalizeFlickerStoredConfigOption(option PreferenceConfigOption) PreferenceConfigOption {
	if strings.EqualFold(option.ID, "effort") {
		option.ID = "thought_level"
		if option.CurrentValue == "maxOrXhigh" { option.CurrentValue = "xhigh" }
	}
	return option
}
```

- [ ] **Step 5: Run focused agent and client tests.**

Run: `go test ./internal/hub/agent ./internal/hub/client -count=1`

Expected: PASS.

### Task 3: Verify against the installed CLI and complete delivery

**Files:**
- Verify only: `server/internal/hub/agent/agent_test.go`

- [ ] **Step 1: Run loader tests against the installed 0.3.11 bundle.**

Run: `go test ./internal/hub/agent -run "TestFlickerLoaderPatchesLatestMyFlickerBundleShape|TestFlickerLoaderPatchesInstalledMyFlickerBundleWhenAvailable|TestFlickerACPProvider_LaunchArgs" -count=1 -v`

Expected: PASS.

- [ ] **Step 2: Run all server tests.**

Run: `go test ./... -count=1`

Expected: PASS.

- [ ] **Step 3: Commit and push.**

```bash
git add -A
git commit -m "fix: restore flicker config compatibility for 0.3.11"
git push origin main
```
