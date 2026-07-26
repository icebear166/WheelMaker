# Codex Session Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users fork a Codex-backed WheelMaker session from any exactly mapped completed `prompt_done`, persist an independent target history, and expose the fork origin in the existing session UI.

**Architecture:** Codex completion returns its native turn ID as an internal side-band `forkPoint`, which the recorder persists inside the matching `prompt_done`. Old append-only WMT2 turns remain untouched; `session.read` conservatively enriches their response view from `thread/read` when the complete prompt sequence can be matched exactly. `session.fork` calls Codex `thread/fork`, creates a new lazy WheelMaker session, writes a rewritten history prefix plus copied artifacts/attachments, stores lineage in `session_sync_json`, and appends the existing `session_operation` turn with `type:"fork"`.

**Tech Stack:** Go 1.x, Codex app-server JSON-RPC, SQLite, WMT2 session turn files, React/TypeScript, Jest/react-test-renderer.

---

## File responsibilities

- `server/internal/protocol/acp.go`: internal prompt-result `forkPoint` side-band.
- `server/internal/protocol/session_turn.go`: additive persisted `prompt_done.param.forkPoint`.
- `server/internal/protocol/session_actions.go`: provider-neutral fork request/result, lineage, and operation types.
- `server/internal/protocol/registry_methods.go`: additive `session.fork` Registry route without a protocol-version bump.
- `server/internal/hub/agent/instance.go`: optional provider `SessionForker` capability and instance forwarding.
- `server/internal/hub/agent/codexapp_convert.go`: Codex `thread/fork` wire types.
- `server/internal/hub/agent/codexapp_agent.go`: `thread/read` exact prompt matching, `thread/fork`, and live native turn propagation.
- `server/internal/hub/agent/agent_test.go`: Codex adapter RED/GREEN tests.
- `server/internal/hub/client/session.go`: serialize fork with prompt/compact work and expose fork-point resolution.
- `server/internal/hub/client/session_recorder.go`: persist `forkPoint`, enrich read-only turns, and initialize forked history/projection.
- `server/internal/hub/client/session_attachments.go`: copy referenced source attachments and rewrite target URIs.
- `server/internal/hub/client/client.go`: `session.read` legacy enrichment and `session.fork` orchestration.
- `server/internal/hub/client/client_test.go`: recorder, enrichment, history independence, lineage, operation, and request tests.
- `server/internal/protocol/registry_methods_test.go`: Registry descriptor coverage.
- `server/internal/registry/server_test.go`: forwarding coverage.
- `app/web/src/registry/registryMethods.ts`: client method constant.
- `app/web/src/registry/registryTypes.ts`: fork point, fork response, lineage, and operation types.
- `app/web/src/registry/RegistryRepository.ts`: normalized summary lineage and fork request.
- `app/web/src/registry/RegistryWorkspaceService.ts`: project-scoped fork service.
- `app/web/src/chat/ChatIcon.tsx`: Lucide `git-fork` glyph for turn actions/operation rows.
- `app/web/src/common/Icon.tsx`: same Lucide glyph for session-list lineage.
- `app/web/src/chat/ChatTurnView.tsx`: fork action on mapped `prompt_done` and fork operation rendering.
- `app/web/src/chat/ChatTurnView.test.tsx`: turn action and operation rendering coverage.
- `app/web/src/chat/sessionlist/SessionRow.tsx`: small non-interactive fork-origin marker.
- `app/web/src/chat/sessionlist/SessionRow.test.tsx`: marker coverage.
- `app/web/src/chat/sessionlist/SessionListView.tsx`: pass lineage state to rows.
- `app/web/src/app/WorkspaceApp.tsx`: call fork, refresh list, and select the target session.
- `app/web/src/styles/chat.css`: fork operation/action styling.
- `app/web/src/styles/sessionlist.css`: session-list marker styling.
- `docs/wiki/protocols/registry.md`: document additive method and payload fields.

### Task 1: Add provider-neutral fork protocol and Codex adapter behavior

**Files:**
- Modify: `server/internal/protocol/acp.go`
- Modify: `server/internal/protocol/session_turn.go`
- Modify: `server/internal/protocol/session_actions.go`
- Modify: `server/internal/hub/agent/instance.go`
- Modify: `server/internal/hub/agent/codexapp_convert.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Test: `server/internal/hub/agent/agent_test.go`

- [x] **Step 1: Write failing Codex adapter tests**

Add tests that require:

```go
func TestCodexAppPromptResultIncludesForkPoint(t *testing.T) {
	// Complete turn-1 and assert result.ForkPoint == &protocol.SessionForkPoint{
	//   Provider: "codex", Ref: "turn-1",
	// }.
}

func TestCodexAppResolveForkPointsReadsAndExactlyMatchesPrompts(t *testing.T) {
	// thread/read returns two completed turns with userMessage inputs.
	// ResolveForkPoints receives matching WheelMaker prompt blocks and returns
	// done turn indexes 3->turn-1 and 7->turn-2.
}

func TestCodexAppResolveForkPointsDoesNotGuessOnMismatch(t *testing.T) {
	// A mismatched prompt sequence returns no mapping.
}

func TestCodexAppForkSessionUsesLastTurnIDAndRemapsTargetTurns(t *testing.T) {
	// Assert thread/fork params contain threadId and lastTurnId and result
	// contains the target thread ID plus target turn IDs keyed by source done index.
}
```

- [x] **Step 2: Run the adapter tests and verify RED**

Run:

```powershell
cd server
go test ./internal/hub/agent -run 'TestCodexApp(PromptResultIncludesForkPoint|ResolveForkPoints|ForkSession)' -count=1
```

Expected: FAIL because fork protocol types and adapter methods do not exist.

- [x] **Step 3: Add the minimal protocol shapes**

Add these additive/internal shapes:

```go
type SessionForkPoint struct {
	Provider string `json:"provider"`
	Ref      string `json:"ref"`
}

type SessionPromptResult struct {
	StopReason string
	Message    string
	Artifacts  []SessionPromptArtifactPayload `json:"-"`
	ForkPoint  *SessionForkPoint               `json:"-"`
}

type SessionTurnPromptResult struct {
	StopReason  string
	CompletedAt string
	Message     string
	Artifacts   []SessionTurnPromptArtifact
	ForkPoint   *SessionForkPoint `json:"forkPoint,omitempty"`
}

type SessionForkPrompt struct {
	DoneTurnIndex int64
	ContentBlocks []ContentBlock
}

type SessionForkResult struct {
	SessionID  string
	Title      string
	ForkPoints map[int64]SessionForkPoint
}
```

Add `SessionForker` with `ResolveForkPoints` and `ForkSession`, and forward it through the concrete instance after `ensureConn`.

- [x] **Step 4: Implement Codex read/fork conversion**

Add wire params:

```go
type appServerThreadForkParams struct {
	ThreadID   string `json:"threadId"`
	LastTurnID string `json:"lastTurnId,omitempty"`
}
```

Implement one canonical matcher that:

1. Converts WheelMaker content blocks with `codexappPromptToInputWithArtifacts`.
2. Extracts the `userMessage` inputs from completed native turns.
3. Requires equal sequence length and equal canonical JSON inputs.
4. Returns no partial/guessed mappings on any mismatch.

Use it for both `thread/read` legacy resolution and returned target turns after `thread/fork`. If fork returns incomplete turns, call `thread/read includeTurns:true` for the target. Archive the target thread and return an error if exact remapping fails.

Include the completed native turn ID in `codexappPromptResult` and then in `protocol.SessionPromptResult.ForkPoint`.

- [x] **Step 5: Run adapter tests and verify GREEN**

Run:

```powershell
cd server
go test ./internal/hub/agent -run 'TestCodexApp(PromptResultIncludesForkPoint|ResolveForkPoints|ForkSession)' -count=1
```

Expected: PASS.

### Task 2: Persist live fork points and enrich old read responses

**Files:**
- Modify: `server/internal/hub/client/session.go`
- Modify: `server/internal/hub/client/session_recorder.go`
- Modify: `server/internal/hub/client/client.go`
- Test: `server/internal/hub/client/client_test.go`

- [x] **Step 1: Write failing recorder and legacy-enrichment tests**

Add tests that assert:

```go
func TestSessionRecorderPersistsPromptForkPoint(t *testing.T) {
	// Record prompt request + prompt result with side-band forkPoint.
	// Read WMT2 and assert prompt_done.param.forkPoint is persisted.
}

func TestSessionReadEnrichesLegacyCodexPromptDoneWithoutRewritingWMT2(t *testing.T) {
	// Store a legacy prompt_done without forkPoint.
	// Provider resolves the exact prompt; response turn includes forkPoint.
	// A second raw store read still has no forkPoint.
}

func TestSessionReadLeavesLegacyPromptDoneUnforkableWhenProviderCannotMatch(t *testing.T) {
	// Provider returns no exact mapping; response remains unchanged.
}
```

- [x] **Step 2: Run tests and verify RED**

Run:

```powershell
cd server
go test ./internal/hub/client -run 'Test(SessionRecorderPersistsPromptForkPoint|SessionReadEnrichesLegacyCodex|SessionReadLeavesLegacy)' -count=1
```

Expected: FAIL because side-band propagation and enrichment do not exist.

- [x] **Step 3: Carry the side-band into `prompt_done`**

Extend `SessionViewEvent`/`parsedSessionViewEvent` with `ForkPoint`, clone it beside `Artifacts`, and pass `ev.result.ForkPoint` from `Session.handlePromptBlocks`. Update `finishPromptStateLocked` to store it in the newly-created `SessionTurnPromptResult`.

Synthetic failure/cancel completion paths pass no fork point.

- [x] **Step 4: Add conservative legacy enrichment**

Implement helpers that parse full WheelMaker history into complete prompt records:

```go
type sessionForkPromptRecord struct {
	Prompt agent.SessionForkPrompt
	Point  *acp.SessionForkPoint
}
```

For a Codex session with missing fork points:

1. Read the full WheelMaker turn view without modifying it.
2. Ask the optional provider `SessionForker.ResolveForkPoints`.
3. Cache exact mappings in `Client` memory by session ID.
4. Rewrite only the `session.read` response turn JSON.
5. On provider busy/unavailable/mismatch, return the original turns with no icon.

- [x] **Step 5: Run tests and verify GREEN**

Run:

```powershell
cd server
go test ./internal/hub/client -run 'Test(SessionRecorderPersistsPromptForkPoint|SessionReadEnrichesLegacyCodex|SessionReadLeavesLegacy)' -count=1
```

Expected: PASS.

### Task 3: Build an independent target history and expose `session.fork`

**Files:**
- Modify: `server/internal/protocol/session_actions.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/hub/client/session.go`
- Modify: `server/internal/hub/client/session_recorder.go`
- Modify: `server/internal/hub/client/session_attachments.go`
- Modify: `server/internal/hub/client/client.go`
- Test: `server/internal/hub/client/client_test.go`
- Test: `server/internal/protocol/registry_methods_test.go`
- Test: `server/internal/registry/server_test.go`

- [x] **Step 1: Write failing fork orchestration tests**

Cover:

```go
func TestHandleSessionForkCreatesIndependentTargetHistory(t *testing.T) {
	// Source has two prompts; fork from the first done.
	// Assert target WMT2 contains only the prefix, rewritten target forkPoint,
	// and a final completed session_operation type=fork.
}

func TestHandleSessionForkPersistsLineageInTargetSummary(t *testing.T) {
	// Assert summary.forkedFrom has source sessionId, turnIndex, and title.
}

func TestHandleSessionForkRejectsMissingOrMismatchedForkPoint(t *testing.T) {}

func TestForkHistoryCopiesArtifactsAndReferencedAttachments(t *testing.T) {
	// Delete source after fork and assert target artifact/attachment reads work.
}
```

Also require `RegistryMethodSessionFork` to be a project session-forward method and require Registry server forwarding.

- [x] **Step 2: Run tests and verify RED**

Run:

```powershell
cd server
go test ./internal/hub/client ./internal/protocol ./internal/registry -run 'Test.*(SessionFork|ForkHistory|RegistryMethodSessionFork)' -count=1
```

Expected: FAIL because the method, lineage, and target history initializer do not exist.

- [x] **Step 3: Add lineage and fork operation shapes**

Use:

```go
const (
	SessionOperationTypeFork = "fork"
	RegistryMethodSessionFork = "session.fork"
)

type SessionForkOrigin struct {
	SessionID string `json:"sessionId"`
	TurnIndex int64  `json:"turnIndex"`
	Title     string `json:"title,omitempty"`
}

type SessionOperationPayload struct {
	// existing fields...
	ForkedFrom *SessionForkOrigin `json:"forkedFrom,omitempty"`
}
```

Add `ForkedFrom *SessionForkOrigin` to `sessionSyncProjection` and `sessionViewSummary`; preserve it through normalization, list/read, archive, and restore.

- [x] **Step 4: Implement target history initialization**

Add one recorder entry point that:

1. Verifies the source selected turn is a finished `prompt_done` with the requested provider/ref.
2. Reads source turns `1..selectedTurnIndex`.
3. Rewrites every copied `prompt_done.forkPoint` with target refs returned by Codex.
4. Copies each referenced prompt artifact through the artifact store.
5. Copies referenced file attachments to the target attachment root, rewrites sidecar ownership/URI, and rewrites copied `contentBlocks` URIs.
6. Writes target WMT2 once from turn index 1.
7. Initializes the target projection with latest/done/read state and lineage.
8. Appends a completed `session_operation` with `type:"fork"` and the same lineage.

Source and target files must share no mutable state.

- [x] **Step 5: Implement `session.fork` request orchestration**

Decode:

```go
struct {
	SessionID string `json:"sessionId"`
	TurnIndex int64  `json:"turnIndex"`
}
```

Then:

1. Reject empty IDs, non-positive indexes, active prompt/compaction, unsupported provider, and unmapped turns.
2. Call `thread/fork` with the selected persisted/refined native turn ID.
3. Create a lazy target `Session` using the returned thread ID and cloned provider state.
4. Persist the target record and initialize independent history.
5. On local failure, delete local target files/record and archive the native target.
6. Return `{ok:true, session:<target summary>}`.

- [x] **Step 6: Run tests and verify GREEN**

Run:

```powershell
cd server
go test ./internal/hub/client ./internal/protocol ./internal/registry -run 'Test.*(SessionFork|ForkHistory|RegistryMethodSessionFork)' -count=1
```

Expected: PASS.

### Task 4: Add frontend API types and fork UI

**Files:**
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/web/src/chat/ChatIcon.tsx`
- Modify: `app/web/src/common/Icon.tsx`
- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Create: `app/web/src/chat/ChatTurnView.test.tsx`
- Modify: `app/web/src/chat/sessionlist/SessionRow.tsx`
- Modify: `app/web/src/chat/sessionlist/SessionRow.test.tsx`
- Modify: `app/web/src/chat/sessionlist/SessionListView.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/web/src/styles/sessionlist.css`

- [x] **Step 1: Confirm the Lucide glyph**

Run:

```powershell
better-icons get lucide:git-fork
```

Expected inner paths:

```xml
<circle cx="12" cy="18" r="3"/>
<circle cx="6" cy="6" r="3"/>
<circle cx="18" cy="6" r="3"/>
<path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9m6 3v3"/>
```

- [x] **Step 2: Write failing component tests**

Test:

```tsx
it('shows fork only for prompt_done with a forkPoint', async () => {
  // Render prompt_done with/without forkPoint; assert button and callback.
});

it('renders a non-clickable fork operation row', async () => {
  // type=fork/status=completed renders git-fork icon and source title text.
});

it('renders a fork-origin marker in a session row', async () => {
  // forked=true renders the icon inside the row without adding another button.
});
```

- [x] **Step 3: Run component tests and verify RED**

Run:

```powershell
cd app
npm test -- --runInBand web/src/chat/ChatTurnView.test.tsx web/src/chat/sessionlist/SessionRow.test.tsx
```

Expected: FAIL because fork rendering is absent.

- [x] **Step 4: Add API and normalized types**

Add `SessionFork: "session.fork"`, `RegistrySessionForkPoint`, `RegistrySessionForkOrigin`, and `RegistrySessionForkResponse`. Allow `RegistrySessionOperationPayload.type` to be `"compact" | "fork"` and carry optional `forkedFrom`. Normalize `summary.forkedFrom`.

Repository/service request:

```ts
async forkSession(projectId: string, sessionId: string, turnIndex: number) {
  return this.client.request({
    method: RegistryMethods.SessionFork,
    projectId,
    payload: {sessionId, turnIndex},
    timeoutMs: 30000,
  });
}
```

- [x] **Step 5: Render the action, operation, and list marker**

Add `gitFork` to the existing Lucide registries.

In `ChatTurnView`:

- Render the fork button only when `message.param.forkPoint` has non-empty `provider` and `ref`.
- Disable/spin it while its request is active.
- Branch `sessionOperationView` by `param.type`; fork is always a passive status row with origin title/session fallback.

In `SessionRow`, add a `forked` prop and a small `gitFork` glyph beside the title. It is not a separate button.

- [x] **Step 6: Wire Workspace behavior**

Add a per-turn busy key and handler:

```ts
const forkPromptDone = async (turnIndex: number) => {
  const selected = selectedChatKeyRef.current;
  if (!selected) return;
  const result = await service.forkProjectSession(selected.projectId, selected.sessionId, turnIndex);
  await refreshChatProjectSessions(selected.projectId, {force: true});
  await selectProjectChatSession(selected.projectId, result.session.sessionId);
};
```

On error, keep the source selected and show the existing toast/error surface.

- [x] **Step 7: Run component tests and verify GREEN**

Run:

```powershell
cd app
npm test -- --runInBand web/src/chat/ChatTurnView.test.tsx web/src/chat/sessionlist/SessionRow.test.tsx
```

Expected: PASS.

### Task 5: Document and verify the additive integration

**Files:**
- Modify: `docs/wiki/protocols/registry.md`
- Modify: `docs/scope-nospec/2026-07-26-codex-session-fork/plan-codex-session-fork.md`

- [x] **Step 1: Document the method and persistence rules**

Document:

```text
session.fork {sessionId, turnIndex}
prompt_done.param.forkPoint {provider, ref}
session summary forkedFrom {sessionId, turnIndex, title?}
session_operation type=fork
```

State that WMT2 and Registry protocol versions remain unchanged because all fields/methods are additive, old turns are enriched only in response memory, and forked histories are independent copies.

- [x] **Step 2: Run focused and full server verification**

Run:

```powershell
cd server
gofmt -w internal/protocol/acp.go internal/protocol/session_turn.go internal/protocol/session_actions.go internal/protocol/registry_methods.go internal/hub/agent/instance.go internal/hub/agent/codexapp_convert.go internal/hub/agent/codexapp_agent.go internal/hub/agent/agent_test.go internal/hub/client/session.go internal/hub/client/session_recorder.go internal/hub/client/session_attachments.go internal/hub/client/client.go internal/hub/client/client_test.go internal/protocol/registry_methods_test.go internal/registry/server_test.go
go test ./...
go build ./cmd/wheelmaker
```

Expected: all commands exit 0.

- [x] **Step 3: Run frontend verification**

Run:

```powershell
cd app
npm test -- --runInBand
npm run tsc:web
npm run build:web
```

Expected: all commands exit 0 and the build writes to the configured WheelMaker web output, not `app/dist`.

- [x] **Step 4: Review requirements and diff**

Run:

```powershell
git status -sb
git diff --check
git diff --stat
rg -n --glob '!**/dist/**' 'fork-points\.json|codexTurnId' .
```

Expected: no sidecar implementation, no provider-specific field name in generic turn JSON, no whitespace errors, and only scoped files changed.

- [x] **Step 5: Mark completed plan items**

Change every completed checkbox in this plan from `[ ]` to `[x]` before the final commit.

- [x] **Step 6: Commit and push using the repository completion gate**

Run this exact tail sequence:

```powershell
git add -A
git commit -m "feat: add codex session fork"
git push origin main
```

Expected: commit and push succeed.

## Self-review

- Spec coverage: live mapping, conservative old-history enrichment, any exactly mapped completed turn, independent target WMT2/artifacts/attachments, target lineage, existing operation row, prompt action, and session-list marker all have implementation and test tasks.
- Placeholder scan: no TBD/TODO/“similar to” placeholders remain.
- Type consistency: `SessionForkPoint`, `SessionForkOrigin`, `SessionForkPrompt`, `SessionForkResult`, `forkPoint`, `forkedFrom`, `SessionOperationTypeFork`, and `RegistryMethodSessionFork` are used consistently.
- Compatibility: no WMT2 or Registry protocol-version change is planned; unknown JSON fields remain ignorable.
