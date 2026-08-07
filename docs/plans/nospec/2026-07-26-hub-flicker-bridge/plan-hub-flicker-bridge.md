# Hub Flicker Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the migrated MyFlicker proxy as a Windows x64 WheelMaker child process on `127.0.0.1:17999`, and control it from each Hub entry in the chat header Hub menu.

**Architecture:** Keep all proxy behavior in one Go source file at `server/internal/flickerbridge/flicker_bridge.go`. The main WheelMaker binary dispatches a hidden `--flicker-bridge` mode to that package; the normal Hub owns the re-executed child process through a small lifecycle manager. The configured `api_keys.flicker` value is reused by the child and the `cc-flicker` agent, while Registry state exposes only lifecycle status and never the key.

**Tech Stack:** Go 1.26, Windows process execution, existing Registry `hub.state.*` API, React/TypeScript, CSS.

---

### Task 1: Establish failing behavior tests for the port and Registry contract

**Files:**
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `server/internal/hub/hub_test.go`
- Modify: `app/__tests__/web-hub-menu-flicker-bridge.test.tsx`

- [ ] **Step 1: Write the failing Go endpoint expectation**

Add a `TestClaudeCompatibleFlickerProfileUsesManagedBridgePort` assertion that `NewCCFlickerProvider(...).Launch()` returns `ANTHROPIC_BASE_URL=http://127.0.0.1:17999`, while preserving the key-free error-redaction assertion already present in the file.

- [ ] **Step 2: Run the endpoint test to verify it fails**

Run: `go test ./internal/hub/agent -run TestClaudeCompatibleFlickerProfileUsesManagedBridgePort -count=1`

Expected: FAIL because the current profile still returns port `17888`.

- [ ] **Step 3: Write the failing Hub state contract tests**

Add tests that call `validateHubStateAction("flickerBridge", "start")`, `"stop"`, and `"restart"`, and that refresh the `flickerBridge` section through a Reporter. Assert the section data has no `apiKey` field and exposes `configured`, `state`, `endpoint`, and `port`.

- [ ] **Step 4: Run the Hub state tests to verify they fail**

Run: `go test ./internal/hub -run 'Test(FlickerBridge|HubStateActionValidation)' -count=1`

Expected: FAIL because `flickerBridge` is not a registered state section or allowed action.

- [ ] **Step 5: Write the failing Web menu tests**

Create the focused existing-style React test. Render a Hub menu row with each server state and assert these observable states:

```tsx
expect(screen.getByText('Flicker Bridge')).toBeTruthy();
expect(screen.getByText('Not configured')).toBeTruthy();
expect(screen.getByRole('button', {name: 'Start Flicker Bridge'}).disabled).toBe(true);
```

Then cover a configured stopped state (`Start` enabled) and a running state (`Stop` and `Restart` visible).

- [ ] **Step 6: Run the Web test to verify it fails**

Run: `npm test -- web-hub-menu-flicker-bridge.test.tsx`

Expected: FAIL because the Hub dropdown has no Flicker Bridge controls.

### Task 2: Add the single-file proxy package and hidden child mode

**Files:**
- Create: `server/internal/flickerbridge/flicker_bridge.go`
- Modify: `server/cmd/wheelmaker/main.go`
- Modify: `server/go.mod`
- Modify: `server/go.sum`
- Modify: `server/cmd/wheelmaker/main_test.go`

- [ ] **Step 1: Write the failing child-mode tests**

Add tests around the command dispatcher using `--flicker-bridge --self-test=settings-defaults`. The test must assert that the hidden mode dispatches into the proxy runner and does not invoke service, guardian, Registry, or Hub startup paths. Add an invalid port test that expects the proxy settings validation error.

- [ ] **Step 2: Run the child-mode tests to verify they fail**

Run: `go test ./cmd/wheelmaker -run TestFlickerBridge -count=1`

Expected: FAIL because `--flicker-bridge` is not parsed.

- [ ] **Step 3: Copy and adapt the validated proxy implementation**

Copy the complete Go proxy from `E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_bridge.go` into exactly one production source file, `server/internal/flickerbridge/flicker_bridge.go`. Change only its package boundary and process entrypoint:

```go
package flickerbridge

func Run(args []string) error {
    // detect --self-test, parse proxy flags, create the HTTP server,
    // and return errors instead of calling os.Exit.
}
```

Preserve all proxy conversion, authentication, upstream security, SSE, image, Anthropic, Responses, and self-test logic. Keep configuration-writing behavior absent. Change the default port fallback from `17888` to `17999`; do not weaken the loopback origin or bearer-key checks.

- [ ] **Step 4: Add the minimal WheelMaker dispatcher**

Before normal service dispatch in `run`, recognize `--flicker-bridge`, remove that internal flag, and call `flickerbridge.Run(remainingArgs)`. The normal Hub mode must stay unchanged. Add `github.com/klauspost/compress` at the source version required by the proxy and use the existing `modernc.org/sqlite` module already in WheelMaker.

- [ ] **Step 5: Run child-mode and proxy self tests to verify they pass**

Run: `go test ./cmd/wheelmaker -run TestFlickerBridge -count=1`

Expected: PASS.

Run: `go run ./cmd/wheelmaker --flicker-bridge --self-test=all`

Expected: all migrated proxy self-tests print `[PASS]`.

### Task 3: Implement child-process ownership and Hub state actions

**Files:**
- Create: `server/internal/hub/flicker_bridge.go`
- Modify: `server/internal/hub/hub.go`
- Modify: `server/internal/hub/hub_state.go`
- Modify: `server/internal/hub/hub_state_adapters.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Write failing manager lifecycle tests**

Use an injected executable resolver, process starter, health checker, and clock in `flickerBridgeManager`. Cover: no configured key reports `notConfigured` and does not start; a configured manager launches `--flicker-bridge --host 127.0.0.1 --port 17999`; the health-ready transition reports `running`; stop terminates only the manager-owned process; restart is stop then start; an exited child reports `failed`; and `Close` stops the child.

- [ ] **Step 2: Run lifecycle tests to verify they fail**

Run: `go test ./internal/hub -run TestFlickerBridgeManager -count=1`

Expected: FAIL because no child-process manager exists.

- [ ] **Step 3: Implement the minimal manager**

Define a concurrency-safe manager with this public-to-Hub surface:

```go
type flickerBridgeManager struct { /* injected process and health dependencies */ }
func (m *flickerBridgeManager) Start(context.Context) (flickerBridgeStatus, error)
func (m *flickerBridgeManager) Stop(context.Context) (flickerBridgeStatus, error)
func (m *flickerBridgeManager) Restart(context.Context) (flickerBridgeStatus, error)
func (m *flickerBridgeManager) Status(context.Context) flickerBridgeStatus
func (m *flickerBridgeManager) Close() error
```

Start the current executable with `--flicker-bridge --host 127.0.0.1 --port 17999`; use `shared.ConfigureBackgroundCommand`; let the child own its size-limited `~/.wheelmaker/log/flicker-bridge.log`; poll `http://127.0.0.1:17999/_myflicker/health`; and kill only the captured child process on stop. Pass the configured `api_keys.flicker` value as `MYFLICKER_BRIDGE_API_KEY` to the child and as the `cc-flicker` provider token. Do not include it in logs or state. Never kill an existing non-owned listener.

- [ ] **Step 4: Wire the manager into Hub construction and close**

When `api_keys.flicker` is nonempty, create the manager and pass the configured value to both the bridge process and `cc-flicker`. At the end of `Hub.Start`, attempt to start the manager but log a failure instead of failing Hub startup. Stop it first in `Hub.Close`. The manager must remain stopped only for the current Hub lifetime; a new Hub start launches it again.

- [ ] **Step 5: Expose only status and controlled actions over Registry**

Add `hubStateSectionFlickerBridge = "flickerBridge"`, refresh support, and exactly `start`, `stop`, and `restart` actions. Add it to `validateHubStateAction`. Publish a `hub.state.updated` event after lifecycle actions so a connected UI refreshes without receiving secrets.

- [ ] **Step 6: Run the Hub state and lifecycle tests to verify they pass**

Run: `go test ./internal/hub -run 'Test(FlickerBridge|HubStateActionValidation|HubStateAdapters)' -count=1`

Expected: PASS.

### Task 4: Render the controls in the existing Hub dropdown

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/shell.css`
- Modify: `app/__tests__/web-hub-menu-flicker-bridge.test.tsx`

- [ ] **Step 1: Add typed Registry helpers**

Define `RegistryFlickerBridgeStatus` with `configured`, `state`, `endpoint`, `port`, `pid`, and `error` fields. Add the `flickerBridge` section name and service methods that call existing `refreshHubState` and `runHubStateAction` with only `start`, `stop`, or `restart`.

- [ ] **Step 2: Render a compact Hub-owned row**

Within each existing `chat-hub-tree`, immediately after the Hub name row and before its project list, refresh the `flickerBridge` status when the dropdown opens. Render the following text and controls:

```tsx
<span>Flicker Bridge</span>
<span>{configured ? statusLabel : 'Not configured'}</span>
<button aria-label="Start Flicker Bridge">Start</button>
<button aria-label="Stop Flicker Bridge">Stop</button>
<button aria-label="Restart Flicker Bridge">Restart</button>
```

Only show Start for configured stopped or failed states; show Stop and Restart when running; disable all controls while an action is running; show an inline escaped error string for a failed state; and keep the `Not configured` row visible with disabled controls.

- [ ] **Step 3: Add scoped menu styles and accessible feedback**

Add `chat-hub-flicker-bridge*` styles in `shell.css`, using existing menu typography, a small neutral/running/error status dot, compact button spacing, and no new page or modal. Use `aria-live="polite"` for action outcome text.

- [ ] **Step 4: Run the focused Web test to verify it passes**

Run: `npm test -- web-hub-menu-flicker-bridge.test.tsx`

Expected: PASS.

### Task 5: Verify integrated behavior locally without committing

**Files:**
- Modify only if verification reveals a defect in the files above.

- [ ] **Step 1: Run format and focused test suites**

Run: `gofmt -w server/cmd/wheelmaker/main.go server/internal/flickerbridge/flicker_bridge.go server/internal/hub/flicker_bridge.go server/internal/hub/hub.go server/internal/hub/hub_state.go server/internal/hub/hub_state_adapters.go server/internal/hub/reporter.go`

Run: `go test ./cmd/wheelmaker ./internal/hub ./internal/hub/agent`

Run: `npm test -- web-hub-menu-flicker-bridge.test.tsx`

- [ ] **Step 2: Run full local checks**

Run: `go vet ./...`

Run: `go test ./...`

Run: `npm test`

Run: `npm run build:web:release`

- [ ] **Step 3: Build and exercise the Windows x64 child mode**

Run: `go build -trimpath -o bin/windows_amd64/wheelmaker.exe ./cmd/wheelmaker`

Run: `bin/windows_amd64/wheelmaker.exe --flicker-bridge --self-test=all`

Then launch it with a test-only local token/cache configuration on port `17999`, assert `GET /_myflicker/health` is healthy, stop the captured child PID, and confirm no process remains. Do not call a production upstream without a separately approved credential test.

- [ ] **Step 4: Inspect the diff and report without committing**

Run: `git diff --check` and `git status --short`.

Report changed files, successful checks, and any limitation. Do not stage, commit, or push because the user explicitly requested local testing only.
