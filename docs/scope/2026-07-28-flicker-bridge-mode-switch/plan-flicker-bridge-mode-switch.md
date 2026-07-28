# Flicker Bridge V1/V2 Hub Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each Hub persist and switch its managed Flicker Bridge between the current V1 implementation and the MyFlicker AI SDK V2 implementation from the existing Hub menu.

**Architecture:** A new generic Hub config store owns `<stateDir>/db/hub-config.json`. The existing bridge manager becomes mode-aware and launches either hidden V1 or V2 mode on the same port, with transactional F1 rollback and S1 stopped-state behavior. Hub State adds mode metadata and a `switchMode` action; the Web menu renders an accessible segmented control without changing `cc-flicker` endpoint or Registry protocol version.

**Tech Stack:** Go 1.26, existing Hub State/Registry transport, private atomic JSON config writer, React 19, TypeScript 5.8, Jest/react-test-renderer, CSS.

## 2026-07-28 execution record

- Implemented V2 in the existing `server/internal/flickerbridge` package as the single production file `v2.go`; V1 remains on `Run`/`--flicker-bridge`, and V2 uses `RunV2`/`--flicker-bridge-v2`.
- Added the generic `<stateDir>/db/hub-config.json` store, mode-aware Hub lifecycle management, S1 stopped-state persistence, F1 running/startup rollback, Hub State `switchMode`, and the Hub menu V1/V2 control.
- Passed `go test ./... -count=1`, scoped `go vet` for all changed Go packages, targeted Jest, `tsc:web`, the production Web build, both bridge self-test suites, and the V2 live catalog/format suite.
- A real, non-intercepted Wanqing smoke request through the V2 Anthropic message path used `glm-5.2` and returned exactly `WHEELMAKER_V2_OK`; the worker was closed and no V2 test process remained.
- The repository-wide race command could not run because this Windows Go environment has `CGO_ENABLED=0` and no GCC. Repository-wide `go vet ./...` remains blocked by pre-existing `portrelay` lock-copy and Windows desktop `unsafe.Pointer` findings; scoped vet for the changed packages passed.

## 2026-07-28 V2 authentication and compact-control correction

**Goal:** Remove the V1 fake-key authentication mechanism from V2 while retaining `api_keys.flicker` as the Hub enablement gate, restore unauthenticated loopback model discovery, make that dynamic catalog visible through the real Claude ACP model config option, accept Claude Code system-role messages, and remove the redundant inline running label from the Hub control.

**Architecture:** V1 keeps its existing local key gate. V2 binds only to loopback, ignores Claude Code authentication headers, and obtains all real Wanqing authorization inside the Node worker through `@myflicker/cli` login/context/plugin initialization. The shared `cc-flicker` profile remains compatible with V1, so an existing Claude process may keep sending the fake header even though V2 does not inspect it. The Hub continues caching the live bridge catalog, but writes its IDs to `availableModels` as well as `models`, because `claude-agent-acp 0.61.0` uses the former—not the latter—to populate ACP `session/new.configOptions[id=model]`.

**Files:**
- Modify: `server/internal/flickerbridge/v2.go`
- Modify: `server/internal/hub/flicker_bridge.go`
- Test: `server/internal/hub/hub_test.go`
- Modify: `server/internal/hub/agent/acp_provider.go`
- Test: `server/internal/hub/agent/agent_test.go`
- Modify: `app/web/src/app/FlickerBridgeControl.tsx`
- Modify: `app/web/src/app/flickerBridgeState.ts`
- Modify: `app/web/src/styles/chat.css`
- Test: `app/__tests__/web-hub-flicker-bridge-control.test.tsx`
- Modify: `docs/scope/2026-07-28-flicker-bridge-mode-switch/spec-flicker-bridge-mode-switch.md`
- Modify: `docs/wiki/protocols/acp.md`

### Correction Task 1: Make V2 authentication exclusively MyFlicker-owned

- [x] **Step 1: Change the V2 HTTP self-test to require header-free loopback access**

In `selfTestHTTP`, remove `APIKey` from the fixture settings and remove the `authorizedRequest` argument from the request helper:

```go
do := func(method, target string, body []byte) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	server.Handler.ServeHTTP(recorder, request)
	return recorder
}
```

Assert that `/v1/models`, `/v1/messages`, and `/v1/messages/count_tokens` all succeed without `x-api-key` or `Authorization`. Keep the existing non-loopback Origin rejection test so the HTTP surface remains loopback-only.

- [x] **Step 2: Change the Hub launch test to reject V1 key injection into V2**

Replace the current positive V2 environment assertion in `TestFlickerBridgeManagerStartsSelectedV2` with:

```go
if slices.Contains(startedEnv, "MYFLICKER_WANQING_PROXY_KEY=configured-flicker-key") {
	t.Fatalf("V2 environment leaked the V1 local key: %v", startedEnv)
}
```

- [x] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
cd E:\_Code\WheelMaker\server
go test ./internal/hub -run TestFlickerBridgeManagerStartsSelectedV2 -count=1
go run ./cmd/wheelmaker --flicker-bridge-v2 --self-test=http
```

Expected: the Hub test fails because V2 still receives `MYFLICKER_WANQING_PROXY_KEY`; the HTTP self-test fails because V2 still returns 401 without a local key.

- [x] **Step 4: Remove the local key from the V2 implementation**

In `server/internal/flickerbridge/v2.go`:

- delete `defaultProxyKey`;
- delete `proxySettings.APIKey`;
- stop reading `MYFLICKER_WANQING_PROXY_KEY`;
- delete the `--key` flag and the non-empty-key validation;
- delete the now-unused `authorized` helper and `crypto/subtle` import;
- retain `loopbackOrigin` checks on `/v1/models`, `/v1/messages`, and `/v1/messages/count_tokens`;
- keep `internals.login("myflicker", cwd)`, login/userInfo context injection, `wanqingPlugin.initialized`, and `wanqing.createModel` unchanged.

Each protected handler must use this boundary:

```go
if !loopbackOrigin(request) {
	writeAnthropicError(response, http.StatusUnauthorized, "unauthorized")
	return
}
```

In `server/internal/hub/flicker_bridge.go`, make the V2 launch environment independent of the configured V1 key:

```go
case flickerBridgeModeV2:
	return append([]string{"--flicker-bridge-v2"}, baseArgs...), os.Environ()
```

Do not change `manager.configured`; a non-empty `api_keys.flicker` remains the product enablement gate selected in the approved spec.

- [x] **Step 5: Run the focused tests and verify GREEN**

Run:

```powershell
cd E:\_Code\WheelMaker\server
go test ./internal/hub -run TestFlickerBridgeManagerStartsSelectedV2 -count=1
go run ./cmd/wheelmaker --flicker-bridge-v2 --self-test=settings,http
```

Expected: all selected tests print PASS or exit 0. The V2 HTTP test performs model discovery and messages without a local authentication header.

### Correction Task 2: Reduce the Hub control to toggle and lifecycle actions

- [x] **Step 1: Change the component test to forbid the inline running label**

Rename the running-mode test to `highlights the actual running mode without an inline status label` and replace its final assertion with:

```tsx
expect(v2.props.className).toContain('running');
expect(renderer.root.findAllByProps({className: 'chat-hub-flicker-bridge-state'})).toHaveLength(0);
```

- [x] **Step 2: Run the component test and verify RED**

Run:

```powershell
cd E:\_Code\WheelMaker\app
npm test -- web-hub-flicker-bridge-control.test.tsx --runInBand
```

Expected: FAIL because `FlickerBridgeControl` still renders `chat-hub-flicker-bridge-state`.

- [x] **Step 3: Remove the normal status copy while preserving errors and running highlight**

In `FlickerBridgeControl.tsx`, remove the `flickerBridgeLabel` import and the `chat-hub-flicker-bridge-state` span. Keep the existing `running` class and `aria-current` on the actual running segment.

In `flickerBridgeState.ts`, delete the unused `flickerBridgeLabel` function.

In `chat.css`, narrow the shared overflow selector from:

```css
.chat-hub-flicker-bridge-state,
.chat-hub-flicker-bridge-error {
```

to:

```css
.chat-hub-flicker-bridge-error {
```

Do not remove `chat-hub-flicker-bridge-error`; unavailable-mode and lifecycle failures remain visible.

- [x] **Step 4: Run the component test and verify GREEN**

Run:

```powershell
cd E:\_Code\WheelMaker\app
npm test -- web-hub-flicker-bridge-control.test.tsx --runInBand
```

Expected: PASS; the running V1/V2 segment remains highlighted and no normal status label is rendered.

### Correction Task 2A: Accept Claude Code system-role messages

- [x] **Step 1: Add a failing conversion fixture**

Extend the V2 request-conversion self-test with a `messages[].role="system"` entry. Require its content to survive in the merged system prompt and require the MyFlicker base prompt to occur exactly once.

Observed RED: `request-conversion: unsupported message role "system"`.

- [x] **Step 2: Merge system-role content before turn conversion**

Collect system-role message blocks into the V3 prompt, skip them in the user/assistant turn loop, and share paragraph normalization with the top-level Anthropic `system` conversion.

Observed GREEN: the request-conversion self-test and `go test ./internal/flickerbridge` passed. A real Claude Code prompt through isolated V2 then returned exactly `WHEELMAKER_V2_AUTH_OK`.

### Correction Task 2B: Surface the dynamic bridge catalog through ACP

- [x] **Step 1: Reproduce with the installed ACP adapter**

Start `@agentclientprotocol/claude-agent-acp` 0.61.0 against isolated V2 and inspect `session/new`. With gateway discovery and `settings.models` only, the adapter returned its five fixed Claude choices and did not expose `glm-5.2`.

- [x] **Step 2: Prove the adapter input**

Add the same dynamic IDs to `settings.availableModels` in an isolated config and repeat `session/new`.

Observed: the model config option became `Default + configured dynamic IDs`, including `glm-5.2`.

- [x] **Step 3: Add RED/GREEN Hub settings coverage**

Change the existing flicker settings test to require bridge-derived IDs in `availableModels`; observe RED while only `models` is written. Update `ensureClaudeCompatibleSettings` to write both arrays, keep gateway discovery enabled, omit `enforceAvailableModels`, and delete both arrays when the shared store is empty.

Observed GREEN: the focused Hub agent test passed.

### Correction Task 3: Regression, live verification, and completion gate

- [x] **Step 1: Run scoped formatting and regression tests**

Run:

```powershell
cd E:\_Code\WheelMaker\server
gofmt -w internal\flickerbridge\v2.go internal\hub\flicker_bridge.go internal\hub\hub_test.go
go test ./internal/flickerbridge ./internal/hub ./internal/hub/agent -count=1
go run ./cmd/wheelmaker --flicker-bridge-v2 --self-test=all
go vet ./internal/flickerbridge ./internal/hub ./internal/hub/agent

cd E:\_Code\WheelMaker\app
npm test -- web-hub-flicker-bridge-control.test.tsx web-hub-flicker-bridge-menu.test.ts --runInBand
npm run tsc:web
npm run build:web
```

Expected: every scoped command exits 0.

- [x] **Step 2: Verify the real MyFlicker authentication path and model catalog**

Run the V2 live self-tests with the installed compatible npm package:

```powershell
cd E:\_Code\WheelMaker\server
go run ./cmd/wheelmaker --flicker-bridge-v2 --self-test-live=all
```

Expected: catalog and format tests pass using the MyFlicker CLI login/context/provider chain. No `MYFLICKER_WANQING_PROXY_KEY` is supplied.

Start an isolated V2 listener on an unused loopback port, wait for health, and request `/v1/models` without authentication headers. Assert HTTP 200 and a non-empty `data` array, then stop only the captured process in `finally`.

- [x] **Step 3: Run a real Claude Code prompt smoke test**

Start V2 through the Hub, create a new `cc-flicker` Session, and verify:

```text
the ACP session exposes a non-empty model list
a bounded prompt returns visible text
V2 logs/state contain no local key, MyFlicker token, signature, or authorization value
```

Do not change model ID publication rules during this correction; any remaining model-selection mismatch must be reported separately with the actual `/v1/models` response.

- [x] **Step 4: Inspect the final diff and worktree**

Run:

```powershell
cd E:\_Code\WheelMaker
git diff --check
git diff --stat
git status --short
```

Expected: only the approved authentication, compact UI, tests, spec, wiki, and this plan are modified.

- [ ] **Step 5: Execute the repository completion gate**

Run this exact tail sequence:

```powershell
git add -A
git commit -m "fix: separate flicker v2 authentication"
git push origin main
```

Expected: all three commands succeed and `main` is pushed to `origin`.

---

### Task 0: Protect the repository completion gate

**Files:**
- Inspect only: repository worktree

- [ ] **Step 1: Verify the starting worktree**

Run:

```powershell
cd E:\_Code\WheelMaker
git status --short
```

Expected before implementation: only the approved Flicker V1/V2 spec, plans and wiki updates are changed. If any unrelated user change appears, stop and obtain a clean worktree or explicit disposition before continuing; the repository completion gate later requires `git add -A`.

- [ ] **Step 2: Verify the branch has an upstream destination**

Run:

```powershell
$branch = git branch --show-current
git remote get-url origin
```

Expected: a non-empty branch and configured `origin`. Do not begin implementation on detached HEAD.

### Task 1: Add the generic Hub config store

**Files:**
- Create: `server/internal/hubconfig/store.go`
- Create: `server/internal/hubconfig/store_test.go`
- Reference: `server/internal/shared/config_write.go`

- [ ] **Step 1: Write failing store tests**

Cover missing defaults, first write, section preservation, invalid mode, corrupt input, 64 KiB limit and concurrent updates:

```go
func TestStoreFlickerBridgeModeDefaultsToV1(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "db", "hub-config.json"))
	mode, err := store.FlickerBridgeMode()
	if err != nil {
		t.Fatal(err)
	}
	if mode != FlickerBridgeModeV1 {
		t.Fatalf("mode = %q, want v1", mode)
	}
}

func TestUpdateFlickerBridgeModePreservesOtherSections(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	writeFixture(t, path, `{"version":1,"future":{"enabled":true},"flickerBridge":{"mode":"v1","futureField":7}}`)
	store := New(path)
	if err := store.UpdateFlickerBridgeMode(FlickerBridgeModeV2); err != nil {
		t.Fatal(err)
	}
	raw := readJSONMap(t, path)
	assertJSONPath(t, raw, "future.enabled", true)
	assertJSONPath(t, raw, "flickerBridge.futureField", float64(7))
	assertJSONPath(t, raw, "flickerBridge.mode", "v2")
}
```

For corrupt or oversized existing files, assert update returns an error and original bytes remain byte-for-byte unchanged.

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
cd E:\_Code\WheelMaker\server
go test ./internal/hubconfig -count=1
```

Expected: FAIL because `internal/hubconfig` does not exist.

- [ ] **Step 3: Implement the store**

Use raw JSON maps so unrelated future sections survive:

```go
package hubconfig

type FlickerBridgeMode string

const (
	FlickerBridgeModeV1 FlickerBridgeMode = "v1"
	FlickerBridgeModeV2 FlickerBridgeMode = "v2"
	maxConfigBytes                        = 64 * 1024
)

type Store struct {
	mu        sync.Mutex
	path      string
	readFile  func(string) ([]byte, error)
	writeFile func(string, []byte) error
}

func New(path string) *Store
func (s *Store) FlickerBridgeMode() (FlickerBridgeMode, error)
func (s *Store) UpdateFlickerBridgeMode(mode FlickerBridgeMode) error
```

Represent the root and `flickerBridge` section as `map[string]json.RawMessage`; validate `version == 1`, replace only the `mode` raw value, marshal with indentation and a trailing newline, then call `shared.WriteConfigFile`. Missing files synthesize `{"version":1}` in memory. Do not rewrite malformed, oversized or unknown-version files.

- [ ] **Step 4: Run package and shared-writer tests**

Run:

```powershell
go test ./internal/hubconfig ./internal/shared -count=1
```

Expected: PASS, including private atomic writer tests.

- [ ] **Step 5: Commit**

```powershell
git add server/internal/hubconfig
git commit -m "feat: add hub user config store"
```

### Task 2: Integrate the validated V2 bridge package and hidden command

**Files:**
- Create: `server/internal/flickerbridge/v2.go`
- Modify: `server/internal/flickerbridge/flicker_bridge_test.go`
- Modify: `server/cmd/wheelmaker/main.go`
- Modify: `server/cmd/wheelmaker/main_test.go`
- Source: `E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_wanqing_proxy.go`

- [ ] **Step 1: Verify the standalone V2 prerequisite**

Run:

```powershell
cd E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge
go run myflicker_wanqing_proxy.go --self-test=all
go run myflicker_wanqing_proxy.go --self-test-live=all
```

Expected: PASS. Stop if the source does not satisfy its own approved plan.

- [ ] **Step 2: Write failing dispatcher and probe tests**

In `main_test.go`, inject V1/V2 run hooks around command dispatch and assert:

```go
func TestRunDispatchesFlickerBridgeV2Only(t *testing.T) {
	restore := replaceFlickerBridgeRunners(
		func([]string) error { t.Fatal("V1 called"); return nil },
		func(args []string) error {
			if !slices.Equal(args, []string{"--self-test=all"}) {
				t.Fatalf("args = %v, want [--self-test=all]", args)
			}
			return nil
		},
	)
	defer restore()
	withArgs(t, "wheelmaker", "--flicker-bridge-v2", "--self-test=all")
	if err := run(); err != nil {
		t.Fatal(err)
	}
}
```

In the existing `flickerbridge` package test, assert `ProbeV2()` reports unavailable for a missing node and returns sanitized details.

- [ ] **Step 3: Run tests to verify RED**

Run:

```powershell
go test ./cmd/wheelmaker ./internal/flickerbridge -run 'Test.*FlickerBridgeV2' -count=1
```

Expected: FAIL because package, hidden flag and hooks are absent.

- [ ] **Step 4: Adapt the standalone source into one package file**

Copy the verified logic into `server/internal/flickerbridge/v2.go` under `package flickerbridge`. Prefix colliding private identifiers with `v2` and expose:

```go
type ProbeResult struct {
	Available        bool
	NodePath         string
	MyFlickerVersion string
	Error            string
}

func ProbeV2() V2ProbeResult
func RunV2(args []string) error
```

Remove the standalone `main()` and `//go:build ignore`; preserve all proxy, worker, model alias, self-test and fail-closed logic. Ensure Hub compatibility:

```text
GET /_myflicker/health -> {"ok":true,...}
GET /v1/models         -> gateway discovery compatible model list
```

The V2 local key reads `MYFLICKER_WANQING_PROXY_KEY`. No MJS file is embedded or generated.

- [ ] **Step 5: Add the hidden command without changing V1**

In `main.go`:

```go
const flickerBridgeV2Arg = "--flicker-bridge-v2"

var runFlickerBridgeV1 = flickerbridge.Run
var runFlickerBridgeV2 = flickerbridge.RunV2

func run() error {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case flickerBridgeArg:
			return runFlickerBridgeV1(os.Args[2:])
		case flickerBridgeV2Arg:
			return runFlickerBridgeV2(os.Args[2:])
		}
	}
	// existing flag path
}
```

- [ ] **Step 6: Run focused and full server tests**

Run:

```powershell
go test ./cmd/wheelmaker ./internal/flickerbridge -count=1
go test ./... -count=1
```

Expected: PASS; existing V1 dispatcher test remains green.

- [ ] **Step 7: Commit**

```powershell
git add server/internal/flickerbridge/v2.go server/internal/flickerbridge/flicker_bridge_test.go server/cmd/wheelmaker/main.go server/cmd/wheelmaker/main_test.go
git commit -m "feat: embed flicker bridge v2 runtime"
```

### Task 3: Make the Hub bridge manager mode-aware

**Files:**
- Modify: `server/internal/hub/flicker_bridge.go`
- Modify: `server/internal/hub/hub.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Write failing status and launch-selection tests**

Extend existing manager tests:

```go
func TestFlickerBridgeManagerDefaultsToV1AndReportsModes(t *testing.T) {
	store := newFakeHubConfigStore(hubconfig.FlickerBridgeModeV1)
	manager := newTestFlickerBridgeManager(store)
	status := manager.Status(context.Background())
	if status.Mode != "v1" || status.RunningMode != "" {
		t.Fatalf("status = %+v", status)
	}
	if !slices.Equal(status.AvailableModes, []flickerBridgeMode{"v1", "v2"}) {
		t.Fatalf("available modes = %v, want [v1 v2]", status.AvailableModes)
	}
}

func TestFlickerBridgeManagerStartsSelectedV2(t *testing.T) {
	manager := newTestFlickerBridgeManager(newFakeHubConfigStore(hubconfig.FlickerBridgeModeV2))
	manager.startProcess = captureStart(t, func(args []string, env []string) {
		assertContains(t, args, "--flicker-bridge-v2")
		assertEnv(t, env, "MYFLICKER_WANQING_PROXY_KEY", "flicker-key")
	})
	_, err := manager.Start(context.Background())
	if err != nil { t.Fatal(err) }
}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
go test ./internal/hub -run 'TestFlickerBridgeManager(Default|StartsSelected)' -count=1
```

Expected: compile failure because mode fields/dependencies are absent.

- [ ] **Step 3: Add mode definitions and status fields**

Add:

```go
type flickerBridgeMode string

const (
	flickerBridgeModeV1 flickerBridgeMode = "v1"
	flickerBridgeModeV2 flickerBridgeMode = "v2"
)

type flickerBridgeStatus struct {
	Configured    bool              `json:"configured"`
	Supported     bool              `json:"supported"`
	State         string            `json:"state"`
	Mode          flickerBridgeMode `json:"mode"`
	RunningMode   flickerBridgeMode `json:"runningMode,omitempty"`
	AvailableModes []flickerBridgeMode `json:"availableModes"`
	ModeErrors    map[flickerBridgeMode]string `json:"modeErrors,omitempty"`
	Endpoint      string            `json:"endpoint"`
	Port          int               `json:"port"`
	PID           int               `json:"pid,omitempty"`
	Error         string            `json:"error,omitempty"`
}
```

Use a narrow store interface:

```go
type flickerBridgeModeStore interface {
	FlickerBridgeMode() (hubconfig.FlickerBridgeMode, error)
	UpdateFlickerBridgeMode(hubconfig.FlickerBridgeMode) error
}
```

Add injected `modeAvailable func(flickerBridgeMode) error`, selected `mode`, and `runningMode`.

- [ ] **Step 4: Select command, environment and health by mode**

Implement:

```go
func (m *flickerBridgeManager) launchSpecLocked(mode flickerBridgeMode) (args, environ []string, health func(context.Context) error, err error)
```

V1 uses existing `--flicker-bridge`, cache/log variables and health. V2 uses:

```text
--flicker-bridge-v2 --host 127.0.0.1 --port 17999
MYFLICKER_WANQING_PROXY_KEY=<api_keys.flicker>
```

Both write diagnostics to mode-specific log paths and never place the key in args/status.

- [ ] **Step 5: Construct the shared store in `hub.New`**

Create one store at:

```go
hubConfig := hubconfig.New(filepath.Join(stateDir, "db", "hub-config.json"))
flickerBridge := newFlickerBridgeManager(stateDir, apiKeys.Flicker, hubConfig)
```

Pass the same store into the manager rebuilt by `Hub.refreshRuntimeConfig` and the Reporter fallback constructor. Keep test constructors injected so tests never read the real user file.

- [ ] **Step 6: Run manager and Hub tests**

Run:

```powershell
go test ./internal/hub -run 'Test(FlickerBridgeManager|HubUsesConfiguredFlicker)' -count=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add server/internal/hub/flicker_bridge.go server/internal/hub/hub.go server/internal/hub/reporter.go server/internal/hub/hub_test.go
git commit -m "feat: make flicker bridge manager mode aware"
```

### Task 4: Implement transactional switchMode with F1 and S1

**Files:**
- Modify: `server/internal/hub/flicker_bridge.go`
- Modify: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Write the failing switch matrix**

Add table-driven tests for:

```text
running v1 -> v2 health success       => v2 running, persisted v2
stopped v1 -> v2                      => stopped, persisted v2, no process
target start failure                  => v1 running, persisted v1, error
target health failure                 => v1 running, persisted v1, error
target persist failure                => v1 running, persisted v1, error
target failure + rollback failure     => failed, mode v1, no runningMode
switch while lifecycle action active  => busy, no store/process call
persisted v2 startup failure          => v1 running and persisted v1
```

Use channels to deterministically advance fake process health; do not use sleeps.

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
go test ./internal/hub -run 'TestFlickerBridgeManager(Switch|StartupRollback)' -count=1
```

Expected: FAIL because `SwitchMode` is absent.

- [ ] **Step 3: Add serialized lifecycle ownership**

Add one operation guard:

```go
type flickerBridgeOperation string

const (
	bridgeOperationStart   flickerBridgeOperation = "start"
	bridgeOperationStop    flickerBridgeOperation = "stop"
	bridgeOperationRestart flickerBridgeOperation = "restart"
	bridgeOperationSwitch  flickerBridgeOperation = "switchMode"
)

func (m *flickerBridgeManager) beginOperationLocked(op flickerBridgeOperation) error
func (m *flickerBridgeManager) endOperationLocked()
```

Every public lifecycle method must acquire this guard; internal rollback helpers must not recursively acquire it.

- [ ] **Step 4: Implement S1 stopped behavior**

```go
func (m *flickerBridgeManager) SwitchMode(ctx context.Context, target flickerBridgeMode) (flickerBridgeStatus, error) {
	// validate target and static availability
	// if no owned process: persist target, update selected mode, remain stopped
	// otherwise execute transactional running switch
}
```

Persist before updating in-memory selected mode. If persistence fails, return the unchanged status.

- [ ] **Step 5: Implement running switch and F1**

Factor internal helpers:

```go
func (m *flickerBridgeManager) stopOwned(ctx context.Context) error
func (m *flickerBridgeManager) startModeAndWait(ctx context.Context, mode flickerBridgeMode) error
func (m *flickerBridgeManager) rollbackMode(ctx context.Context, original flickerBridgeMode, cause error) error
```

Only call `UpdateFlickerBridgeMode(target)` after target health succeeds. If target start/health/persist fails, stop target, start original, retain original persisted mode, set a sanitized error, and publish state. If rollback fails, join both errors without worker stdout or secrets.

- [ ] **Step 6: Implement startup V2 fallback**

At automatic Hub start only, if selected V2 fails, call the same rollback helper for V1. After V1 health succeeds, persist V1. A config parse error may run in-memory V1 but must block config updates and remain visible in status.

- [ ] **Step 7: Run the switch tests repeatedly**

Run:

```powershell
go test ./internal/hub -run 'TestFlickerBridgeManager(Switch|StartupRollback)' -count=10
go test -race ./internal/hub -run TestFlickerBridgeManager -count=1
```

Expected: PASS with no race report.

- [ ] **Step 8: Commit**

```powershell
git add server/internal/hub/flicker_bridge.go server/internal/hub/hub_test.go
git commit -m "feat: switch flicker bridge modes transactionally"
```

### Task 5: Expose mode state and switchMode through Hub State

**Files:**
- Modify: `server/internal/hub/hub_state.go`
- Modify: `server/internal/hub/hub_state_adapters.go`
- Modify: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Write failing action validation tests**

Add cases:

```go
{section: "flickerBridge", action: "switchMode", params: map[string]any{"mode": "v2"}, wantOK: true}
{section: "flickerBridge", action: "switchMode", params: map[string]any{}, wantError: "mode"}
{section: "flickerBridge", action: "switchMode", params: map[string]any{"mode": "v3"}, wantError: "unsupported"}
```

Assert refreshed JSON contains `mode`, `runningMode`, `availableModes` and no key. Simulate F1 and assert a `hub.state.updated` event publishes the recovered V1 status.

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
go test ./internal/hub -run 'Test(FlickerBridge|HubStateActionValidation)' -count=1
```

Expected: FAIL because `switchMode` is unsupported.

- [ ] **Step 3: Route validated switchMode**

Update the adapter:

```go
case "switchMode":
	rawMode, ok := params["mode"].(string)
	if !ok {
		return nil, errors.New("flickerBridge switchMode requires string mode")
	}
	return r.flickerBridge.SwitchMode(ctx, flickerBridgeMode(rawMode))
```

Keep `start`, `stop`, and `restart`. Validation must reject extra non-object params at the existing Hub State boundary.

- [ ] **Step 4: Preserve recovered state on action errors**

Ensure manager state-change callbacks publish after target failure and after rollback health. The action itself returns an error so Hub State records a failed action, while a subsequent refresh returns the recovered running status.

- [ ] **Step 5: Run Hub tests**

Run:

```powershell
go test ./internal/hub -count=1
```

Expected: PASS and JSON redaction assertions remain green.

- [ ] **Step 6: Commit**

```powershell
git add server/internal/hub/hub_state.go server/internal/hub/hub_state_adapters.go server/internal/hub/hub_test.go
git commit -m "feat: expose flicker mode switch through hub state"
```

### Task 6: Extend Web state normalization and action parameters

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/web/src/app/flickerBridgeState.ts`
- Modify: `app/__tests__/web-hub-flicker-bridge-menu.test.ts`

- [ ] **Step 1: Write failing normalization and action tests**

Add:

```ts
expect(normalizeFlickerBridgeStatus({
  configured: true,
  supported: true,
  state: 'running',
  mode: 'v2',
  runningMode: 'v2',
  availableModes: ['v1', 'v2'],
})).toMatchObject({
  mode: 'v2',
  runningMode: 'v2',
  availableModes: ['v1', 'v2'],
});

expect(flickerBridgeModeActions(status)).toEqual({
  selected: 'v2',
  v1Disabled: false,
  v2Disabled: true,
});
```

Cover missing fields defaulting to V1, unavailable V2, busy state and unrelated Hub events.

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
cd E:\_Code\WheelMaker\app
npm test -- web-hub-flicker-bridge-menu.test.ts --runInBand
```

Expected: type/test failure because mode fields and helper are absent.

- [ ] **Step 3: Extend Registry types and normalizer**

Add:

```ts
export type RegistryFlickerBridgeMode = 'v1' | 'v2';

export interface RegistryFlickerBridgeStatus {
  configured: boolean;
  supported: boolean;
  state: string;
  mode: RegistryFlickerBridgeMode;
  runningMode?: RegistryFlickerBridgeMode;
  availableModes: RegistryFlickerBridgeMode[];
  modeErrors?: Partial<Record<RegistryFlickerBridgeMode, string>>;
  endpoint: string;
  port: number;
  pid?: number;
  error?: string;
}
```

Normalize unknown modes to V1 and filter `availableModes` to V1/V2.

- [ ] **Step 4: Add parameter support to the service**

Change:

```ts
async runHubStateAction(
  hubId: string,
  section: RegistryHubStateSectionName,
  action: string,
  params: Record<string, unknown> = {},
): Promise<RegistryHubState> {
  if (!this.repository) throw new Error('session is not ready');
  return this.repository.runHubStateAction(hubId, section, action, params);
}
```

The repository already accepts params; do not change wire method or protocol version.

- [ ] **Step 5: Implement mode action derivation**

```ts
export function flickerBridgeModeActions(
  status: RegistryFlickerBridgeStatus | undefined,
  busy = false,
) {
  const selected = status?.mode ?? 'v1';
  const available = new Set(status?.availableModes ?? []);
  return {
    selected,
    v1Disabled: busy || selected === 'v1' || !available.has('v1'),
    v2Disabled: busy || selected === 'v2' || !available.has('v2'),
  };
}
```

- [ ] **Step 6: Run Jest and TypeScript**

Run:

```powershell
npm test -- web-hub-flicker-bridge-menu.test.ts --runInBand
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add app/web/src/registry/registryTypes.ts app/web/src/registry/RegistryWorkspaceService.ts app/web/src/app/flickerBridgeState.ts app/__tests__/web-hub-flicker-bridge-menu.test.ts
git commit -m "feat: model flicker bridge modes in web state"
```

### Task 7: Render and test the Hub segmented control

**Files:**
- Create: `app/web/src/app/FlickerBridgeControl.tsx`
- Create: `app/__tests__/web-hub-flicker-bridge-control.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: Write the failing component tests**

Using `react-test-renderer`, assert:

```tsx
const onSwitchMode = jest.fn();
const tree = create(
  <FlickerBridgeControl
    status={normalizeFlickerBridgeStatus({
      configured: true,
      state: 'running',
      mode: 'v1',
      runningMode: 'v1',
      availableModes: ['v1', 'v2'],
    })}
    busy={false}
    onLifecycle={jest.fn()}
    onSwitchMode={onSwitchMode}
  />,
);

act(() => tree.root.findByProps({'aria-label': 'Use Flicker Bridge V2'}).props.onClick());
expect(onSwitchMode).toHaveBeenCalledWith('v2');
expect(tree.root.findByProps({'aria-label': 'Use Flicker Bridge V1'}).props['aria-pressed']).toBe(true);
```

Add cases for unavailable V2, busy disabling every button, Stopped labels and error rendering.

- [ ] **Step 2: Run the component test to verify RED**

Run:

```powershell
npm test -- web-hub-flicker-bridge-control.test.tsx --runInBand
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the focused component**

Props:

```tsx
interface FlickerBridgeControlProps {
  status?: RegistryFlickerBridgeStatus;
  busy: boolean;
  onLifecycle(action: 'start' | 'stop' | 'restart'): void;
  onSwitchMode(mode: RegistryFlickerBridgeMode): void;
}
```

Render the current status summary, a group labelled “Flicker Bridge mode”, V1/V2 `aria-pressed` buttons, existing lifecycle buttons, and the current error in an `aria-live="polite"` container.

- [ ] **Step 4: Wire `WorkspaceApp`**

Extend the callback:

```tsx
const runChatHubFlickerBridgeAction = useCallback(async (
  hubId: string,
  action: 'start' | 'stop' | 'restart' | 'switchMode',
  params: Record<string, unknown> = {},
) => {
  // existing generation and busy handling
  const state = await service.runHubStateAction(hubId, 'flickerBridge', action, params);
  // normalize returned status
}, []);
```

On action error, call `refreshChatHubFlickerBridge(hubId)` before falling back to a synthetic error. This preserves F1's recovered Running V1 state instead of forcing UI state to Failed.

Replace the inline row with:

```tsx
<FlickerBridgeControl
  status={flickerBridge}
  busy={flickerBridgeBusy}
  onLifecycle={action => runChatHubFlickerBridgeAction(hub.hubId, action)}
  onSwitchMode={mode => runChatHubFlickerBridgeAction(hub.hubId, 'switchMode', {mode})}
/>
```

- [ ] **Step 5: Add compact segmented-control styles**

Keep the existing row dimensions and variables. Add:

```css
.chat-hub-flicker-bridge-mode {
  display: inline-flex;
  padding: 1px;
  border-radius: 5px;
  background: var(--hover);
}

.chat-hub-flicker-bridge-mode button[aria-pressed="true"] {
  background: var(--surface-panel);
  color: var(--text-primary);
}
```

Use existing focus-visible, disabled and hover rules; do not add a modal or page.

- [ ] **Step 6: Run component, state, type and production build tests**

Run:

```powershell
npm test -- web-hub-flicker-bridge-menu.test.ts web-hub-flicker-bridge-control.test.tsx --runInBand
npm run tsc:web
npm run build:web
```

Expected: PASS; production output goes to the configured WheelMaker Web output, not `app/dist`.

- [ ] **Step 7: Commit**

```powershell
git add app/web/src/app/FlickerBridgeControl.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-hub-flicker-bridge-control.test.tsx
git commit -m "feat: add flicker bridge mode toggle"
```

### Task 8: Run cross-mode integration and complete documentation

**Files:**
- Modify for execution tracking: `docs/scope/2026-07-28-flicker-bridge-mode-switch/plan-flicker-bridge-mode-switch.md`
- Verify: `docs/wiki/protocols/acp.md`
- Verify: `docs/wiki/architecture/server-runtime.md`

- [ ] **Step 1: Run the complete automated suite**

Run:

```powershell
cd E:\_Code\WheelMaker\server
go test ./... -count=1
go test -race ./internal/hub ./internal/hubconfig -count=1
go vet ./...

cd E:\_Code\WheelMaker\app
npm test -- web-hub-flicker-bridge-menu.test.ts web-hub-flicker-bridge-control.test.tsx --runInBand
npm run tsc:web
npm run build:web
```

Expected: every command exits 0 with no race report.

- [ ] **Step 2: Build and self-test the Windows executable**

Run:

```powershell
cd E:\_Code\WheelMaker\server
go build -trimpath -o bin\windows_amd64\wheelmaker.test.exe .\cmd\wheelmaker
.\bin\windows_amd64\wheelmaker.test.exe --flicker-bridge --self-test=all
.\bin\windows_amd64\wheelmaker.test.exe --flicker-bridge-v2 --self-test=all
```

Expected: V1 and V2 self-tests pass independently.

- [ ] **Step 3: Run a controlled V1 → V2 → V1 lifecycle test**

Use an isolated `--dir` state directory and test key. Start V1 on 17999, switch to V2 through the real Hub State route, then switch back. At each phase assert:

```text
health 200
status.mode == status.runningMode
endpoint == http://127.0.0.1:17999
PID changes after each running switch
hub-config.json contains the committed mode
only one listener owns 17999
```

Stop exact captured processes in `finally`; do not kill unrelated listeners.

- [ ] **Step 4: Run the C1 Claude Code smoke test**

Create a `cc-flicker` Session on V1 using a model ID that maps uniquely through V2 `epModelName`. Switch to V2 without deleting the Session, send a bounded text or `Read` prompt, and assert the existing Session continues. Switch back to V1 and confirm the Session record remains present.

- [ ] **Step 5: Verify persistence, cleanup, security and wiki**

Confirm:

```text
Stopped mode switch creates no bridge/Node process
V2 forced failure restores V1 and leaves persisted v1
hub-config.json retains a seeded unrelated section
logs/state contain no local key, token or signature
no test listener or worker remains
docs/wiki/protocols/acp.md references the approved switch spec
docs/wiki/architecture/server-runtime.md documents hub-config.json ownership
```

- [ ] **Step 6: Execute the repository completion gate**

Mark completed plan checkboxes, then run this exact tail sequence:

```powershell
git add -A
git commit -m "docs: complete flicker bridge v1 v2 switch"
$branch = git branch --show-current
git push origin $branch
```

Expected: commit succeeds and the current branch is pushed to `origin`.
