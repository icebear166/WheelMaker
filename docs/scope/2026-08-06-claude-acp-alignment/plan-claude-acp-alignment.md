# Claude ACP Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify WheelMaker fork traffic on `session/fork`, add native Claude steering/current-session fork support, preserve Codex historical fork behavior through a `_meta.wm.fork` adapter extension, and keep old Session snapshots/calls compatible.

**Architecture:** Keep the standard ACP method at the provider boundary. Registry `session.fork` accepts an optional `turnIndex`; the Hub resolves historical Codex data before calling `session/fork`, while Claude receives the standard current-session request. Persist complete initialize metadata and normalized fork modes so Web can choose historical-turn or current-session UI without provider-name branches. Legacy `_wm/session/*` handlers remain fallback paths for old snapshots and callers.

**Tech Stack:** Go ACP/Hub/Registry, SQLite-backed SessionAgentState JSON, React/TypeScript Workspace Web, Go tests, Jest tests.

---

### Task 1: Add protocol types and persisted capability contracts

**Files:**
- Modify: `server/internal/protocol/acp.go:18-70,113-145,281-300`
- Modify: `server/internal/protocol/acp_const.go:24-40`
- Modify: `server/internal/protocol/session_actions.go:54-100`
- Modify: `server/internal/protocol/acp_wm_extension.go:226-350`
- Modify: `server/internal/hub/client/session.go:30-48,120-190`
- Test: `server/internal/protocol/acp_test.go`
- Test: `server/internal/protocol/acp_wm_extension_test.go`
- Test: `server/internal/hub/client/client_test.go` (SessionAgentState persistence fixtures)

- [x] **Step 1: Write the failing protocol tests**

Add tests that require:

```go
func TestSessionCapabilitiesRoundTripPreservesStandardLifecycleFields(t *testing.T) {
	raw := []byte(`{"sessionCapabilities":{"fork":{},"delete":{},"resume":{},"close":{},"additionalDirectories":{}}}`)
	var got AgentCapabilities
	if err := json.Unmarshal(raw, &got); err != nil { t.Fatal(err) }
	if got.SessionCapabilities == nil || got.SessionCapabilities.Fork == nil || got.SessionCapabilities.Delete == nil {
		t.Fatalf("standard session capabilities were dropped: %#v", got.SessionCapabilities)
	}
}

func TestSessionActionsProjectForkModesAndLegacyDefault(t *testing.T) {
	legacy := SessionActionsFromState(SessionCapabilityState{WMActions: WMSessionActionCapabilities{Fork: true}})
	if !legacy.Fork.Supported || !legacy.Fork.HistoricalTurn || legacy.Fork.CurrentSession {
		t.Fatalf("legacy fork projection = %#v", legacy.Fork)
	}
}
```

Add JSON fixture coverage proving `SessionAgentState.InitializeMeta` survives marshal/unmarshal and an old fixture with only `agentCapabilities` still projects historical fork support.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
go test ./internal/protocol ./internal/hub/client -run 'TestSessionCapabilitiesRoundTripPreservesStandardLifecycleFields|TestSessionActionsProjectForkModesAndLegacyDefault|TestSessionAgentState' -count=1
```

Expected: compile/test failure because standard fork fields, fork mode fields, `SessionActionsFromState`, and `InitializeMeta` do not exist yet.

- [x] **Step 3: Implement the minimum protocol/state model**

Add:

```go
const (
	MethodSessionSteering = "_session/steering"
	MethodSessionFork     = "session/fork"
)

type SessionForkCapability struct { Meta json.RawMessage `json:"_meta,omitempty"` }

type SessionCapabilities struct {
	List *SessionListCapability `json:"list,omitempty"`
	Fork *SessionForkCapability `json:"fork,omitempty"`
	Close *SessionLifecycleCapability `json:"close,omitempty"`
	Delete *SessionLifecycleCapability `json:"delete,omitempty"`
	Resume *SessionLifecycleCapability `json:"resume,omitempty"`
	AdditionalDirectories *SessionLifecycleCapability `json:"additionalDirectories,omitempty"`
	Meta json.RawMessage `json:"_meta,omitempty"`
}

type SessionForkParams struct {
	SessionID string `json:"sessionId"`
	CWD string `json:"cwd"`
	MCPServers []MCPServer `json:"mcpServers,omitempty"`
	AdditionalDirectories []string `json:"additionalDirectories,omitempty"`
	Meta json.RawMessage `json:"_meta,omitempty"`
}

type SessionForkResult struct {
	SessionID string `json:"sessionId"`
	ConfigOptions []ConfigOption `json:"configOptions,omitempty"`
	Meta json.RawMessage `json:"_meta,omitempty"`
}
```

Add native steering params/result with `Outcome` values `injected`, `promptRequired`, and `startedNewTurn`. Add `CurrentSession` and `HistoricalTurn` to `SessionActionCapability`; preserve old JSON by defaulting missing fork modes to historical-only when `Supported` is true.

Move projection input to a small `SessionCapabilityState` containing `AgentCapabilities`, top-level initialize meta, available commands, and negotiated WM actions. Keep the old `SessionActionsFromAgentCapabilities` wrapper for callers that only have old state.

Add `InitializeMeta json.RawMessage` to `SessionAgentState`, clone it with the other ACP metadata, and preserve it in the existing `sessions.agent_json` JSON without a database migration.

Add typed `_meta.wm.fork` extension data containing the existing Codex `ref` and `prompts` fields; keep the old `WMSessionForkParams` wire type unchanged for legacy calls.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run the same `go test` command. Expected: PASS, with existing protocol tests still green.

- [x] **Step 5: Refactor only after green**

Consolidate lifecycle marker types and JSON helper names if they are duplicated. Re-run the focused tests and `go test ./internal/protocol ./internal/hub/client -count=1`.

### Task 2: Implement native steering and unified provider fork adapters

**Files:**
- Modify: `server/internal/hub/agent/instance.go:40-100,176-190,419-430`
- Modify: `server/internal/hub/agent/codexapp_agent.go:760-890,1045-1065,1375-1435`
- Modify: `server/internal/hub/agent/agent_test.go:3400-3440,5850-6010`
- Modify: `server/internal/hub/agent/agent_test.go:3400-3440,5850-6010` (existing fake ACP and Codex bridge tests)

- [x] **Step 1: Write failing native-method tests**

Extend the fake ACP connection tests with assertions that:

```go
func TestInstanceSteerUsesNativeClaudeMethodAndPromptRequiredFallback(t *testing.T) { /* fake init top-level steering meta; assert _session/steering and _meta.steering.idleBehavior */ }
func TestInstanceForkUsesStandardSessionForkForClaude(t *testing.T) { /* fake init sessionCapabilities.fork; assert session/fork params include cwd */ }
func TestCodexAppStandardForkCarriesWmHistoricalExtension(t *testing.T) { /* assert method=session/fork and nested wm fork ref/prompts */ }
func TestLegacyWmForkStillWorksWhenStandardForkIsAbsent(t *testing.T) { /* assert old _wm/session/fork path */ }
```

The native steering test must cover `promptRequired` as `ErrSessionSteerInactive`; the active response must retain provider outcome and not issue a second prompt.

- [x] **Step 2: Run tests and verify RED**

Run:

```powershell
go test ./internal/hub/agent -run 'TestInstanceSteerUsesNativeClaudeMethodAndPromptRequiredFallback|TestInstanceForkUsesStandardSessionForkForClaude|TestCodexAppStandardForkCarriesWmHistoricalExtension|TestLegacyWmForkStillWorks' -count=1
```

Expected: FAIL because the instance currently gates all steer/fork calls on WM methods and sends `_wm/session/*`.

- [x] **Step 3: Implement native steering selection**

In `instance.go`, inspect `initResult.Meta` for `_meta.steering.supported`. When true, send:

```json
{
  "sessionId": "...",
  "prompt": [{"type": "text", "text": "..."}],
  "_meta": {"steering": {"idleBehavior": "promptRequired"}}
}
```

Map `promptRequired` to `ErrSessionSteerInactive`, map `injected` and `startedNewTurn` to a successful `SessionSteerResult`, and retain `ProviderTurnID` when the response supplies one. Fall back to the existing WM method when native steering is not advertised.

- [x] **Step 4: Implement standard fork dispatch**

Add `SessionForker.ForkCurrentSession` or a request form that distinguishes current from historical. For current fork, require `sessionCapabilities.fork`, send `protocol.MethodSessionFork` with `sessionId` and the Session cwd, and decode `sessionId/configOptions`. For historical Codex fork, send the same method with `_meta.wm.fork` carrying the existing `ref` and prompt history. If the standard capability is absent, retain the `_wm/session/fork` fallback.

Update Codex initialize to advertise `SessionCapabilities.Fork` and top-level steering support while retaining all existing WM capabilities. Add the standard `session/fork` handler in `codexappConn` and route its WM extension to the existing `ForkSession` implementation; no `thread/fork` changes.

- [x] **Step 5: Run the adapter tests and verify GREEN**

Run:

```powershell
go test ./internal/hub/agent -run 'TestInstanceSteer|TestInstanceFork|TestCodexApp.*Fork|TestLegacyWmFork' -count=1
```

Expected: PASS.

### Task 3: Route Hub Registry fork requests and persist full state

**Files:**
- Modify: `server/internal/hub/client/client.go:446-490,1206-1215,1449-1575`
- Modify: `server/internal/hub/client/session.go:30-48,557-610`
- Modify: `server/internal/hub/client/session_recorder.go:1320-1360`
- Modify: `server/internal/hub/client/client_test.go:7600-8000,12000-12230`
- Test: `server/internal/hub/client/session_test.go`

- [x] **Step 1: Write failing Registry routing tests**

Add tests for:

```go
func TestHandleSessionForkWithoutTurnIndexUsesCurrentSessionFork(t *testing.T) { /* fake SessionForker current result; assert no historical point lookup */ }
func TestHandleSessionForkWithTurnIndexUsesUnifiedCodexHistoricalFork(t *testing.T) { /* assert same provider fork call and forkedFrom turn */ }
func TestHandleSessionForkRejectsMissingHistoricalTurnIndex(t *testing.T) { /* explicit invalid argument, never zero */ }
func TestSessionStatePersistsInitializeMetaAndForkModes(t *testing.T) { /* save/load sessions.agent_json */ }
```

- [x] **Step 2: Run tests and verify RED**

Run:

```powershell
go test ./internal/hub/client -run 'TestHandleSessionForkWithoutTurnIndex|TestHandleSessionForkWithTurnIndex|TestHandleSessionForkRejectsMissingHistoricalTurnIndex|TestSessionStatePersistsInitializeMeta' -count=1
```

Expected: FAIL because the request decoder requires a value `int64`, current fork has no route, and initialize meta is not stored.

- [x] **Step 3: Persist initialize metadata at creation and restore**

Copy `initResult.Meta` into `SessionAgentState.InitializeMeta` in the session creation path and restore it through the existing state clone/persist functions. Change all action checks in `client.go` and `session_recorder.go` to use the full capability-state projection so old WM-only data remains supported.

- [x] **Step 4: Implement optional-turn Registry routing**

Decode `turnIndex` as `*int64`:

```go
var req struct {
	SessionID string `json:"sessionId"`
	TurnIndex *int64 `json:"turnIndex"`
}
```

Route missing `turnIndex` to `forkCurrentSession`; route present positive values to the existing historical flow, replacing its provider-specific gate with the unified `session/fork` adapter. Return an explicit invalid-argument error for zero/negative selectors and an unsupported-action error when current fork is unavailable.

Implement current child-session creation using the native returned session identity, source cwd/config/state, latest completed local turn as `forkedFrom.turnIndex`, and existing recorder/session persistence. On local creation failure, invoke the provider cleanup path already used by historical forks.

- [x] **Step 5: Run focused Hub tests and verify GREEN**

Run:

```powershell
go test ./internal/hub/client -run 'TestHandleSessionFork|TestSessionStatePersistsInitializeMeta|Test.*Fork' -count=1
```

Expected: PASS.

- [x] **Step 6: Refactor after green**

Extract a shared fork-target lifecycle helper only if current and historical paths duplicate cleanup/persistence logic. Keep historical WMT2/artifact/attachment copying unchanged and re-run the focused suite.

### Task 4: Update Web types, Registry request API, and UI entry points

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts:622-685`
- Modify: `app/web/src/registry/RegistryRepository.ts:761-813` and existing fork method
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts:756-763`
- Modify: `app/web/src/chat/ChatTurnView.tsx:300-315,850-940`
- Modify: `app/web/src/app/WorkspaceApp.tsx:17310-17435` and Session Header/Menu render path
- Test: `app/web/src/chat/ChatTurnView.test.tsx`
- Test: `app/__tests__/web-registry-session-fork.test.ts`
- Test: `app/__tests__/web-chat-ui.test.ts`

- [x] **Step 1: Write failing Web contract tests**

Add tests that require:

```ts
expect(normalizeSessionForkModes({supported: true})).toEqual({
  supported: true,
  currentSession: false,
  historicalTurn: true,
});

await repository.forkSession('project-a', 'session-a');
expect(request).toHaveBeenCalledWith(expect.objectContaining({
  method: 'session.fork',
  payload: {sessionId: 'session-a'},
}));
```

Keep the existing historical button test and add a source assertion that it sends `{sessionId, turnIndex}`. Add a current-session action test that is visible only when `currentSession` is true and sends no `turnIndex`.

- [x] **Step 2: Run Web tests and verify RED**

Run from `app`:

```powershell
npm test -- --runInBand src/chat/ChatTurnView.test.tsx ../app/__tests__/web-registry-session-fork.test.ts ../app/__tests__/web-chat-ui.test.ts
```

Expected: FAIL because fork is currently always typed/called with a required turn index and no current-session action exists.

- [x] **Step 3: Implement normalized fork modes and optional request payload**

Extend `RegistrySessionActionCapability` with optional `currentSession` and `historicalTurn`; normalize old summaries to historical-only. Change repository/service signatures to `forkSession(projectId, sessionId, turnIndex?: number)` and omit `turnIndex` from the payload when absent.

- [x] **Step 4: Implement capability-driven UI**

Keep `ChatTurnView` historical button gated by `historicalTurn`. Add the Session Header/Menu current action gated by `currentSession`, disabled while the selected session is running or a fork is pending, and on success select the returned child session. Use the existing error/toast path. Do not inspect `agentType`.

- [x] **Step 5: Run Web tests and verify GREEN**

Run the same focused Jest command. Expected: PASS, including existing chat UI tests.

### Task 5: Full verification and integration fixtures

**Files:**
- Modify: `server/internal/hub/agent/agent_test.go` (Claude initialize/steering/fork fixtures)
- Add: `server/internal/hub/agent/claude_acp_e2e_test.go` (opt-in live lifecycle fixture)
- Modify: `server/internal/hub/client/client_test.go` (old agent JSON and mixed Registry versions)
- Modify: `app/__tests__/web-registry-session-fork.test.ts`
- Modify: `docs/wiki/agents/session-capabilities.md` only if the user asks to sync wiki after implementation

- [x] **Step 1: Add the opt-in Claude ACP fixture contract**

Keep live Claude ACP execution out of default CI. Add a clearly opt-in integration command/documented fixture for the installed `claude-agent-acp` version covering native steering, current fork, target load, independent prompt, and cleanup. Unit tests use fake ACP transport.

Run from `server` with a settings file that contains usable provider configuration; the fixture copies it into a temporary `CLAUDE_CONFIG_DIR`:

```powershell
$env:WHEELMAKER_CLAUDE_ACP_E2E = '1'
$env:WHEELMAKER_CLAUDE_ACP_E2E_SETTINGS = "$env:USERPROFILE\.claude\settings.json"
go test ./internal/hub/agent -run TestClaudeACPLifecycleE2E -count=1 -v -timeout 6m
```

- [x] **Step 2: Run all focused Go and Web suites**

Run:

```powershell
go test ./internal/protocol ./internal/hub/agent ./internal/hub/client -count=1
```

```powershell
npm test -- --runInBand
```

Expected: PASS with no new warnings.

Focused suites pass. The full Jest run currently reports 263/266 suites passing; the three failures are pre-existing assertions outside this change (`web-chat-ui`/`web-responsive-ui` expect the repository's old 52px hub-row layout, and `GitHistoryPanel` expects an old child order). None of those files are modified by this feature.

- [x] **Step 3: Run repository verification**

Run the repository's normal Go build/test and Web typecheck/build commands from the existing package scripts. Review failures caused by the pre-existing dirty wiki files separately; do not rewrite them as part of this implementation.

- [x] **Step 4: Review the final diff**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Confirm only implementation files, tests, and the plan/spec are changed; no SQLite migration, protocol-version bump, or main-worktree edits were introduced.

### Task 6: Repair native steering correlation and queue completion

**Files:**
- Modify: `server/internal/protocol/agent_event.go:13-33,146-160`
- Modify: `server/internal/hub/agent/instance.go:76-118,604-635`
- Modify: `server/internal/hub/agent/agent_test.go:3477-3506,6276-6292`
- Test: `server/internal/hub/client/session_queue_test.go`

- [x] **Step 1: Write failing native-correlation tests**

Require the first identifiable Claude echo to keep its provider `messageId` while carrying provider-neutral correlation fields, and require a Session to remove a steering queue item without negotiated WM lifecycle:

```go
message := callbacks.lastEvent.Update.(protocol.AgentMessageEvent)
if message.MessageID != "provider-message" || message.ClientMessageID != "queued-1" || !message.Steered {
	t.Fatalf("native correlation = %#v", message)
}

sess.AgentEvent(protocol.AgentEvent{SessionID: "s1", Update: protocol.AgentMessageEvent{
	Kind: protocol.SessionUpdateUserMessageChunk, MessageID: "provider-message",
	ClientMessageID: "queued-1", Steered: true,
}})
if got := sess.QueueSnapshot(false).Waiting; len(got) != 0 {
	t.Fatalf("waiting queue = %#v, want empty", got)
}
```

- [x] **Step 2: Run tests and verify RED**

Run:

```powershell
go test ./internal/hub/agent ./internal/hub/client -run 'TestInstanceCorrelatesNativeSteeringEcho|Test.*NativeSteer.*Queue' -count=1
```

Expected: FAIL because `AgentMessageEvent` cannot represent provider-neutral steering correlation and the Claude event is gated by WM message lifecycle.

- [x] **Step 3: Implement provider-neutral correlation**

Add `ClientMessageID` and `Steered` to `AgentMessageEvent`, project them into `SessionUpdate`, and on the first identifiable native echo set those fields without replacing `MessageID` or synthesizing `messageComplete`. Keep the provider message ID so all content blocks merge into one WMT2 message; let the existing `SessionUpdate` steering path complete the queue item by client ID.

- [x] **Step 4: Run tests and verify GREEN**

Run the focused command from Step 2. Expected: PASS.

### Task 7: Make current fork snapshot and target validation lifecycle-safe

**Files:**
- Modify: `server/internal/hub/client/session.go:610-631`
- Modify: `server/internal/hub/client/client.go:1577-1690`
- Modify: `server/internal/hub/client/client_test.go:184-225,12257-12316`

- [x] **Step 1: Write failing fork lifecycle tests**

Add one test whose source Agent initialization records a second completed turn; assert the child snapshot includes that turn. Add another test whose independently-created validation instance rejects target `session/load`; assert the request fails, the provider target is cleaned up, and no local child remains. Add an empty-source test that asserts the provider fork callback is never invoked.

```go
runtime.initializeFn = func() {
	recordPromptWithForkPointForTest(t, c, sourceID, "second", "source-turn-2")
}
if summary.ForkedFrom == nil || summary.ForkedFrom.TurnIndex != latestDoneTurnIndex {
	t.Fatalf("forkedFrom = %#v", summary.ForkedFrom)
}
```

- [x] **Step 2: Run tests and verify RED**

Run:

```powershell
go test ./internal/hub/client -run 'TestHandleSessionForkWithoutTurnIndex|TestCurrentSessionFork' -count=1
```

Expected: FAIL because the source snapshot is read before execution ownership, target load is never attempted, and an empty source reaches provider fork.

- [x] **Step 3: Move snapshot capture under execution ownership**

Change `Session.ForkCurrentSession` to accept a `beforeFork func() error` callback. Invoke it after `beginExecution` and `ensureReady`, immediately before the provider fork request. Read `ReadSessionTurns` and `ReadSessionSummary` from that callback so provider state and WMT2 use the same no-prompt execution boundary. Reject `LastDoneTurnIndex <= 0` inside the callback before provider mutation.

- [x] **Step 4: Validate target through an isolated Agent instance**

Create a helper that uses the source Agent factory creator with the same project context and cwd, initializes an independent instance with WheelMaker client capabilities, and calls `session/load` for the returned target ID with callbacks unset. Close the probe on every path. Only create/persist the local target after this load succeeds; merge returned config options into the child state. On failure, run provider cleanup and return an error.

- [x] **Step 5: Run tests and verify GREEN**

Run the focused command from Step 2. Expected: PASS.

### Task 8: Preserve unknown capability fields and hide invalid empty-session UI

**Files:**
- Modify: `server/internal/protocol/acp.go:40-91`
- Modify: `server/internal/protocol/acp_test.go:277-330`
- Modify: `app/web/src/app/WorkspaceApp.tsx:18080-18111`
- Modify: `app/__tests__/web-session-fork-state-wiring.test.ts`

- [x] **Step 1: Write failing capability round-trip and UI tests**

Round-trip unknown Agent and Session capability fields while retaining known projections:

```go
raw := []byte(`{"loadSession":true,"providers":{"list":{}},"sessionCapabilities":{"fork":{},"futureLifecycle":{"mode":"x"}}}`)
var capabilities AgentCapabilities
if err := json.Unmarshal(raw, &capabilities); err != nil { t.Fatal(err) }
encoded, err := json.Marshal(capabilities)
if err != nil { t.Fatal(err) }
if !bytes.Contains(encoded, []byte(`"providers"`)) || !bytes.Contains(encoded, []byte(`"futureLifecycle"`)) {
	t.Fatalf("unknown capabilities lost: %s", encoded)
}
```

Require the current-fork header condition to include a positive `lastDoneTurnIndex`.

- [x] **Step 2: Run tests and verify RED**

Run:

```powershell
go test ./internal/protocol -run 'Test.*Capabilities.*Unknown' -count=1
npm test -- --runInBand ../app/__tests__/web-session-fork-state-wiring.test.ts
```

Expected: FAIL because typed capability structs discard unknown JSON and the UI only checks capability flags.

- [x] **Step 3: Implement lossless capability JSON**

Add private unknown-field maps plus custom `MarshalJSON`/`UnmarshalJSON` for `AgentCapabilities` and `SessionCapabilities`. Known fields win on key collisions; clone raw values during decode/encode. Preserve `_meta` through the existing typed field.

- [x] **Step 4: Gate the UI and verify GREEN**

Require `(selectedChatSession.lastDoneTurnIndex ?? 0) > 0` before rendering current fork. Run both focused commands from Step 2. Expected: PASS.

### Task 9: Review-fix verification

**Files:**
- Modify: `docs/scope/2026-08-06-claude-acp-alignment/plan-claude-acp-alignment.md`
- Add: `server/internal/hub/agent/claude_acp_e2e_test.go`
- Modify: `server/internal/protocol/session_actions.go`
- Modify: `server/internal/protocol/acp_test.go`

- [x] **Step 1: Run focused and full verification**

```powershell
go test ./... -count=1
npm run tsc:web
npm test -- --runInBand
git diff --check
```

Expected: all Go tests and Web typecheck pass; Jest has no new failures beyond the three documented baseline failures.

- [x] **Step 2: Attempt the opt-in Claude lifecycle E2E**

Use the installed `claude-agent-acp` with an isolated `CLAUDE_CONFIG_DIR` only when usable credentials/configuration are available. Cover source load, current fork, target load, independent prompt, native steering, and cleanup. If credentials are unavailable, leave `currentSession` release validation explicitly unverified rather than claiming acceptance.

Attempted against installed `claude-agent-acp 0.65.0`. Initialize, source prompt, source reload, and `session/fork` succeeded; independent target `session/load` failed with `Resource not found` for the returned child ID. The release gate therefore remains closed and later lifecycle steps are not claimed as accepted.

- [x] **Step 3: Keep current-session fork behind the verified release gate**

Treat standard ACP `fork + loadSession` as transport declarations only. Project `currentSession=true` only when the persisted WheelMaker action state explicitly enables `CurrentSession`; keep the runtime target-load validation and cleanup path covered by fake ACP tests.
