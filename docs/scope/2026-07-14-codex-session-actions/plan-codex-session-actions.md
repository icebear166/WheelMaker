# Codex Session Status and Context Compaction Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-neutral `/status` and `/compact` session actions, implemented by the Codex App Server adapter and exposed through WheelMaker's existing Registry and chat surfaces.

**Architecture:** Registry adds two project-scoped session methods and session summaries advertise generic action capabilities. `client.Session` separates provider initialization from ACP session loading, uses its existing execution mutex to serialize prompts and compaction, and records compaction lifecycle events through `SessionRecorder`; the Codex adapter owns App Server payload normalization and an independent compaction tracker. The web app extends its memory-only queue to a `prompt | compact` union, renders a unified command/skill menu, opens an immediate cached-first status dialog, and folds durable operation events into one row.

**Tech Stack:** Go 1.26, JSON-RPC Registry protocol, Codex App Server v2, React 19, TypeScript 5.8, Jest 30, Webpack.

---

### Task 1: Define provider-neutral session action contracts and Registry routes

**Files:**
- Create: `server/internal/protocol/session_actions.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/hub/agent/factory.go`
- Modify: `server/internal/hub/agent/instance.go`
- Test: `server/internal/hub/agent/agent_test.go`

- [x] **Step 1: Write failing protocol and capability tests**

Add assertions that `session.status` and `session.compact` are project-scoped `RegistryRouteSessionForward` methods, protocol version is `2.7`, the default Codex factory advertises both actions, and a non-Codex provider advertises neither.

```go
func TestRegistrySessionActionMethods(t *testing.T) {
	for _, method := range []string{RegistryMethodSessionStatus, RegistryMethodSessionCompact} {
		desc, ok := RegistryMethodDescriptors[method]
		if !ok || desc.Route != RegistryRouteSessionForward || !desc.RequiresProjectID {
			t.Fatalf("descriptor %q = %+v, ok=%t", method, desc, ok)
		}
	}
}

func TestFactorySessionActions(t *testing.T) {
	f := newACPFactoryWithDefaults()
	if got := f.SessionActions(protocol.ACPProviderCodex); !got.Status || !got.Compact {
		t.Fatalf("codex actions = %+v", got)
	}
	if got := f.SessionActions(protocol.ACPProviderClaude); got.Status || got.Compact {
		t.Fatalf("claude actions = %+v", got)
	}
}
```

- [x] **Step 2: Run focused tests and verify they fail**

Run: `go test ./internal/protocol ./internal/hub/agent -run 'TestRegistrySessionActionMethods|TestFactorySessionActions'`

Expected: FAIL because the methods, version, and capability registry do not exist.

- [x] **Step 3: Add neutral wire types and action errors**

Define `SessionActionCapability`, `SessionActionCapabilities`, `SessionActionStatusResult`, limit/account/context payloads, `SessionCompactAccepted`, and `SessionOperationPayload` in `session_actions.go`. Use optional JSON fields and RFC3339 strings; model reset credits as `{availableCount}` rather than a scalar.

```go
const SessionTurnMethodOperation = "session_operation"

type SessionActionCapability struct {
	Supported bool   `json:"supported"`
	Reason    string `json:"reason,omitempty"`
}

type SessionActionCapabilities struct {
	Status  SessionActionCapability `json:"status"`
	Compact SessionActionCapability `json:"compact"`
}

type SessionOperationPayload struct {
	OperationID string `json:"operationId"`
	Type        string `json:"type"`
	Status      string `json:"status"`
	StartedAt   string `json:"startedAt,omitempty"`
	CompletedAt string `json:"completedAt,omitempty"`
	Message     string `json:"message,omitempty"`
}
```

Add `ErrSessionActionUnsupported` and `ErrSessionBusy`, plus optional `SessionStatusProvider` and `SessionCompactor` interfaces in `instance.go`. `SessionCompactor.CompactSession` returns a buffered completion channel after App Server acceptance. Add delegating methods on concrete `instance`; keep them out of the mandatory `Instance` interface.

- [x] **Step 4: Register Registry methods and factory action metadata**

Add both constants and descriptors. Extend `ACPFactory` with a cloned `sessionActions map[ACPProvider]SessionActionSupport`, register Codex support beside its built-in creator, and expose `RegisterSessionActions`/`SessionActions`. Bump Go and TypeScript protocol versions to `2.7` in their respective tasks.

- [x] **Step 5: Run focused tests**

Run: `go test ./internal/protocol ./internal/hub/agent`

Expected: PASS.

- [x] **Step 6: Commit the neutral contracts**

```powershell
git add server/internal/protocol server/internal/hub/agent/factory.go server/internal/hub/agent/instance.go server/internal/hub/agent/agent_test.go
git commit -m "feat: define session action contracts"
```

### Task 2: Implement Codex status normalization and native compaction tracking

**Files:**
- Modify: `server/internal/hub/agent/codexapp_convert.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Test: `server/internal/hub/agent/agent_test.go`

- [x] **Step 1: Write failing Codex adapter tests**

Use the existing fake Codex transport/runtime helpers to verify:

```go
func TestCodexappSessionStatusNormalizesRateLimits(t *testing.T) {
	// Respond to account/rateLimits/read with legacy + multi-bucket snapshots.
	// Assert stable sorted primary/secondary limits, clamped percentages,
	// RFC3339 reset times, plan/credits/individualLimit/reset-credit fields.
}

func TestCodexappCompactTracksContextCompaction(t *testing.T) {
	// Assert thread/compact/start receives the mapped runtime threadId.
	// Emit item/started and item/completed with type=contextCompaction.
	// Assert the independent completion channel returns one successful result.
}

func TestCodexappCompactFailsOnTurnFailureAndRuntimeExit(t *testing.T) {
	// Cover failed turn status, timeout, duplicate terminal notifications,
	// and process exit without touching promptDone.
}
```

- [x] **Step 2: Run the adapter tests and verify they fail**

Run: `go test ./internal/hub/agent -run 'TestCodexapp(SessionStatus|Compact)'`

Expected: FAIL because the adapter methods and payloads do not exist.

- [x] **Step 3: Add exact App Server v2 payload structs**

Add request/response structs for `account/rateLimits/read` and `thread/compact/start`, including `RateLimitSnapshot`, `RateLimitWindow`, credits, spend-control limit, and reset-credit summary. Implement deterministic normalization:

```go
func normalizeCodexappRateLimits(resp appServerGetAccountRateLimitsResponse, now time.Time) protocol.SessionActionStatusResult {
	// Prefer rateLimitsByLimitId when non-empty; otherwise use rateLimits.
	// Emit primary/secondary windows only, sort by limit ID then window kind,
	// clamp usedPercent, derive remainingPercent, and convert Unix seconds.
}
```

- [x] **Step 4: Implement status and compaction on `codexappConn`**

`SessionStatus` calls `account/rateLimits/read` without binding/loading a thread. `CompactSession` resolves the persisted-to-runtime thread mapping, installs `compactDone` before the request, calls `thread/compact/start`, and returns the completion channel after `{}` response acceptance.

Track `compactDone`, compact turn/item identifiers, and a generation token separately from `promptDone`. Route `contextCompaction` item lifecycle, `turn/completed`, deprecated `thread/compacted`, timeout, and runtime close to exactly one terminal result. A compaction notification must never call `completePrompt`.

- [x] **Step 5: Run adapter tests and the full agent package**

Run: `go test ./internal/hub/agent`

Expected: PASS.

- [x] **Step 6: Commit the Codex adapter**

```powershell
git add server/internal/hub/agent/codexapp_agent.go server/internal/hub/agent/codexapp_convert.go server/internal/hub/agent/agent_test.go
git commit -m "feat: add codex status and compaction adapter"
```

### Task 3: Split Session initialization and serialize prompt/compact execution

**Files:**
- Modify: `server/internal/hub/client/session.go`
- Modify: `server/internal/hub/client/client.go`
- Test: `server/internal/hub/client/client_test.go`

- [x] **Step 1: Extend the injected instance and write failing lifecycle tests**

Add test hooks implementing the optional provider interfaces, then cover cached-only initialization and execution mutual exclusion.

```go
func TestSessionStatusInitializesWithoutLoading(t *testing.T) {
	// Persist a Codex session, inject a status-capable instance, call session.status.
	// Assert Initialize called once, SessionLoad not called, stable sessionId/context returned.
}

func TestSessionCompactRejectsBusyAndBlocksPromptOverlap(t *testing.T) {
	// Hold a prompt, assert compact returns ErrSessionBusy.
	// Start compact, assert a concurrent session.send returns ErrSessionBusy.
}
```

- [x] **Step 2: Run tests and verify they fail**

Run: `go test ./internal/hub/client -run 'TestSession(Status|Compact)'`

Expected: FAIL because the new request handlers and initialization state are absent.

- [x] **Step 3: Separate initialize from load**

Add `initialized` and `loading` state to `Session`. Implement `ensureInitialized(ctx)` to create the instance, call ACP initialize once, persist returned agent metadata, and never call `SessionLoad`. Refactor `ensureReady` to call `ensureInitialized` first and guard only the load phase. New sessions start with both `initialized=true` and `ready=true`; suspend, delete, switch, and dead-connection reset clear both flags.

- [x] **Step 4: Make the existing execution mutex fail-fast**

Change prompt entry to acquire `promptMu.TryLock()` before recording a prompt request; return `agent.ErrSessionBusy` when locked. Track an execution kind under `Session.mu` so `isRunning()` is true during initialization, prompts, and compaction.

```go
func (s *Session) beginExecution(kind string) error {
	if !s.promptMu.TryLock() { return agent.ErrSessionBusy }
	s.mu.Lock()
	s.executionKind = kind
	s.mu.Unlock()
	return nil
}
```

- [x] **Step 5: Add Client handlers for `session.status` and `session.compact`**

Validate `sessionId`, consult factory capability metadata before starting a process, and return typed unsupported/busy errors. Status attaches the stable WheelMaker session ID and persisted usage. Compact generates a UUID operation ID, acquires execution ownership, records start/final lifecycle through the recorder task below, and releases ownership only after the provider completion channel reaches a terminal result.

- [x] **Step 6: Run client tests**

Run: `go test ./internal/hub/client -run 'TestSession(Status|Compact)|TestHandleSessionRequest'`

Expected: PASS.

- [x] **Step 7: Commit Session orchestration**

```powershell
git add server/internal/hub/client/session.go server/internal/hub/client/client.go server/internal/hub/client/client_test.go
git commit -m "feat: orchestrate session status and compaction"
```

### Task 4: Persist and publish compaction operation lifecycle

**Files:**
- Modify: `server/internal/protocol/session_turn.go`
- Modify: `server/internal/hub/client/session_recorder.go`
- Test: `server/internal/hub/client/client_test.go`

- [x] **Step 1: Write failing recorder tests**

```go
func TestSessionRecorderPersistsOperationLifecycle(t *testing.T) {
	// Record started then completed with the same operationId.
	// Assert two durable turns, session_operation method, ordered indices,
	// session.message publication, running true then false, and unique terminal state.
}
```

- [x] **Step 2: Run the recorder test and verify it fails**

Run: `go test ./internal/hub/client -run TestSessionRecorderPersistsOperationLifecycle`

Expected: FAIL because standalone operation persistence is not implemented.

- [x] **Step 3: Add standalone operation recording**

Add an `activeOperations` map to `SessionRecorder` and a `RecordSessionOperation` method. Under `writeMu`, validate operation/type/status, allocate the next turn index, append one finished `session_operation` turn to the existing turn store, update `SessionSyncProjection.LatestPersistedTurnIndex`, publish `session.message`, update the active map, and publish `session.updated`. Do not alter prompt done/read cursors.

- [x] **Step 4: Include active operations in the summary running flag**

`sessionViewSummaryFromRecordLocked` sets `Running` when either prompt state is unfinished or the session has an active operation. Add `sessionActions` to the summary via an action lookup callback wired to `ACPFactory.SessionActions`.

- [x] **Step 5: Run recorder and client packages**

Run: `go test ./internal/hub/client`

Expected: PASS.

- [x] **Step 6: Commit operation persistence**

```powershell
git add server/internal/protocol/session_turn.go server/internal/hub/client/session_recorder.go server/internal/hub/client/client_test.go
git commit -m "feat: persist session operation lifecycle"
```

### Task 5: Add web Registry methods, types, and normalization

**Files:**
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Test: `app/__tests__/web-session-actions-service.test.ts`
- Test: `app/__tests__/web-session-list-schema.test.ts`

- [x] **Step 1: Write failing web Registry tests**

Mock the Registry client and assert `statusSession`/`compactSession` send the correct project-scoped methods, normalize optional/malformed fields, preserve stable session IDs, and normalize `sessionActions` from list/read/event summaries.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --runInBand web-session-actions-service.test.ts web-session-list-schema.test.ts`

Expected: FAIL because the web contracts do not exist.

- [x] **Step 3: Add typed web contracts and repository normalizers**

Define action capability, status context/limit/account response, compact response, and operation payload interfaces. Add `SessionStatus`/`SessionCompact` methods and bump `RegistryProtocolVersion` to `2.7`. Repository methods use a 30-second request timeout and do not expose unknown provider payload fields.

- [x] **Step 4: Expose workspace service methods**

Add `statusProjectSession(projectId, sessionId)` and `compactProjectSession(projectId, sessionId)` wrappers, plus selected-project convenience methods if existing call sites benefit.

- [x] **Step 5: Run web Registry tests and TypeScript**

Run: `npm test -- --runInBand web-session-actions-service.test.ts web-session-list-schema.test.ts`

Run: `npm run tsc:web`

Expected: PASS.

- [x] **Step 6: Commit web protocol support**

```powershell
git add app/web/src/registry app/__tests__/web-session-actions-service.test.ts app/__tests__/web-session-list-schema.test.ts
git commit -m "feat: add web session action protocol"
```

### Task 6: Generalize the frontend queue and slash option model

**Files:**
- Modify: `app/web/src/chat/session/chatPromptQueue.ts`
- Create: `app/web/src/chat/session/chatSessionActions.ts`
- Test: `app/__tests__/web-chat-prompt-queue-state.test.ts`
- Create: `app/__tests__/web-chat-session-actions.test.ts`

- [x] **Step 1: Write failing pure-state tests**

Cover FIFO order across `prompt -> compact -> prompt`, one waiting compact per runtime key, compact busy retry without shifting, prompt filtering for the existing queued prompt UI, fixed command ordering, search, disabled reasons, and exact standalone parsing with argument/attachment rejection.

```ts
expect(queueKinds(enqueueCompact(enqueuePrompt({}, key, first), key, compact))).toEqual(['prompt', 'compact']);
expect(resolveStandaloneSessionAction('/compact', 0)).toEqual({kind: 'compact'});
expect(resolveStandaloneSessionAction('/compact now', 0)).toEqual({kind: 'invalid', command: '/compact'});
```

- [x] **Step 2: Run tests and verify they fail**

Run: `npm test -- --runInBand web-chat-prompt-queue-state.test.ts web-chat-session-actions.test.ts`

Expected: FAIL because the queue and action model are prompt/skill-only.

- [x] **Step 3: Convert the queue to a discriminated union**

Define `QueuedChatItem = QueuedChatPrompt | QueuedChatCompact`, `QueuedChatItemsByKey`, generic enqueue/shift/cancel/prioritize helpers, `hasQueuedCompact`, and prompt-only projection helpers. Preserve cloning of content blocks and existing queued prompt message behavior.

- [x] **Step 4: Define unified slash options**

`chatSessionActions.ts` exports options with explicit `kind: 'command' | 'skill'`, `behavior: 'invoke' | 'insert'`, icon, description, enabled state, and disabled reason. `/compact` and `/status` are fixed first; skills remain sorted. Add a helper that removes only the active slash query so invoking an action preserves unrelated composer text.

- [x] **Step 5: Run pure-state tests**

Run: `npm test -- --runInBand web-chat-prompt-queue-state.test.ts web-chat-session-actions.test.ts`

Expected: PASS.

- [x] **Step 6: Commit state helpers**

```powershell
git add app/web/src/chat/session app/__tests__/web-chat-prompt-queue-state.test.ts app/__tests__/web-chat-session-actions.test.ts
git commit -m "feat: add session actions to chat queue"
```

### Task 7: Render operation rows and the status dialog

**Files:**
- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Modify: `app/web/src/chat/turns/chatDisplayIndex.ts`
- Modify: `app/web/src/shell/AppDialogs.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/web/src/styles/shell.css`
- Test: `app/__tests__/web-chat-turn-rendering.test.ts`
- Create: `app/__tests__/web-session-status-dialog.test.tsx`

- [x] **Step 1: Write failing rendering tests**

Assert multiple durable operation events with one `operationId` produce one display item at the latest turn, and verify queued/running/completed/failed labels/icons. Render `AppSessionStatusDialog` with cached context, loading, multiple limit windows, missing optional account fields, and refresh failure.

- [x] **Step 2: Run tests and verify they fail**

Run: `npm test -- --runInBand web-chat-turn-rendering.test.ts web-session-status-dialog.test.tsx`

Expected: FAIL because operation rows and the dialog are missing.

- [x] **Step 3: Fold and render operation events**

In `buildChatDisplayIndex`, precompute the latest source index per operation ID and skip earlier `session_operation` messages. Estimate a compact fixed row height. In `ChatTurnView`, render a dedicated system operation row with a ring/loading icon and status text; do not route it through markdown or tool-call rendering.

- [x] **Step 4: Add the cached-first status dialog**

Export `AppSessionStatusDialog`. It always renders the stable Session ID, prefers refreshed context over cached summary usage, renders each normalized limit with a progress bar and reset time, adds available plan/credits/individual-limit fields, preserves cached values during loading/errors, and closes via backdrop, button, or Escape.

- [x] **Step 5: Add restrained matching styles**

Use the existing overlay tokens. Slash icons and operation/status icons use Codicons (`codicon-circle-large-outline`, `codicon-dashboard`) with no command/skill badges or group headers. Limit bars use existing state/accent colors and remain readable on mobile.

- [x] **Step 6: Run rendering tests and TypeScript**

Run: `npm test -- --runInBand web-chat-turn-rendering.test.ts web-session-status-dialog.test.tsx`

Run: `npm run tsc:web`

Expected: PASS.

- [x] **Step 7: Commit the UI components**

```powershell
git add app/web/src/chat app/web/src/shell/AppDialogs.tsx app/web/src/styles app/__tests__/web-chat-turn-rendering.test.ts app/__tests__/web-session-status-dialog.test.tsx
git commit -m "feat: render session status and compaction progress"
```

### Task 8: Wire actions into WorkspaceApp

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Test: `app/__tests__/web-chat-ui.test.ts`
- Test: `app/__tests__/web-connection-status.test.ts`

- [x] **Step 1: Add failing Workspace source/behavior tests**

Assert the unified menu uses explicit option behavior, action icons/descriptions/disabled reasons, command invocation methods, exact typed-command interception before `session.send`, union queue draining, and queue clearing in the Registry `onClose` handler.

- [x] **Step 2: Run tests and verify they fail**

Run: `npm test -- --runInBand web-chat-ui.test.ts web-connection-status.test.ts`

Expected: FAIL because Workspace still inserts every slash option as a skill.

- [x] **Step 3: Replace the skill-only menu with unified options**

Build menu options from fixed actions plus project skills. Keep only insertable skills in `ChatRichComposer.slashCommands`. Render icon/name/description in one list; unsupported actions remain visible and disabled with their reason in title/description.

- [x] **Step 4: Implement status invocation**

Open dialog state immediately from the selected session summary, then call `service.statusProjectSession`. Update refreshed data on success; on failure retain cached data and set the error/last-success state. `/status` never enters the queue or history.

- [x] **Step 5: Implement compact invocation and queue draining**

When idle and the runtime queue is empty, call `compactProjectSession`; otherwise enqueue one compact item. Drain the union queue only while selected session is not running/submitting. On busy, restore compact to the head and wait for the next `session.updated`/operation event; on accepted response, wait for durable operation terminal state before draining the next item.

- [x] **Step 6: Intercept typed native commands**

Before attachment upload or pending prompt creation, parse composer text. Exact standalone `/status` or `/compact` invokes the action and clears that command; arguments or attachments show a local error; unsupported actions show the capability reason. No native command reaches `session.send`.

- [x] **Step 7: Clear all pending queue items on Registry disconnect**

In the existing `service.onClose` subscription, set the queue ref and state to `{}` before reconnect scheduling. Do not reconstruct queued items after reconnect.

- [x] **Step 8: Run Workspace tests, TypeScript, and production build**

Run: `npm test -- --runInBand web-chat-ui.test.ts web-connection-status.test.ts web-chat-prompt-queue-state.test.ts web-chat-session-actions.test.ts`

Run: `npm run tsc:web`

Run: `npm run build:web`

Expected: PASS.

- [x] **Step 9: Commit Workspace integration**

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/__tests__
git commit -m "feat: wire codex session actions into workspace"
```

### Task 9: Cross-layer verification, documentation consistency, and release handoff

**Files:**
- Modify if needed: `docs/scope/2026-07-14-codex-session-actions/spec-codex-session-actions.md`
- Track: `docs/scope/2026-07-14-codex-session-actions/plan-codex-session-actions.md`

- [x] **Step 1: Run Go formatting and full backend tests**

Run: `gofmt -w server/internal/protocol/session_actions.go server/internal/protocol/registry_methods.go server/internal/protocol/registry.go server/internal/hub/agent/factory.go server/internal/hub/agent/instance.go server/internal/hub/agent/codexapp_convert.go server/internal/hub/agent/codexapp_agent.go server/internal/hub/client/session.go server/internal/hub/client/client.go server/internal/hub/client/session_recorder.go server/internal/protocol/session_turn.go`

Run: `go test ./...` from `server`.

Expected: PASS.

- [x] **Step 2: Run full web verification**

Run: `npm test -- --runInBand`

Run: `npm run tsc:web`

Run: `npm run build:web`

Expected: PASS.

- [x] **Step 3: Review the implementation against every spec acceptance criterion**

Confirm: no frontend `agentType === 'codex'` action branch; status never loads a thread; compact uses runtime thread mapping; prompt/compact cannot overlap; queued work is memory-only and cleared on disconnect; unsupported actions remain visible; operation history folds after reload; no runtime thread ID leaks.

- [x] **Step 4: Run repository hygiene checks**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors and only intended files changed.

- [x] **Step 5: Commit any final verification fixes, then perform the repository completion gate**

```powershell
git add -A
git commit -m "feat: add codex session status and compaction"
git push
```

Expected: commit succeeds (or reports no remaining changes after task commits) and push updates the configured remote branch.
