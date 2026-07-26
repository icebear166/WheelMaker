# Session Goal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-neutral Session Goal creation, control, persistence, automatic continuation, restore, and responsive Goal console UI, with Codex App Server as the first provider.

**Architecture:** Registry 2.6 gains compatible `session.goal.*` methods and a Goal action capability/snapshot. Session owns the multi-Turn Goal execution lifecycle while a new optional Agent controller maps set/get/clear to Codex `thread/goal/*`; Web treats `/goal` as an ordinary queued prompt and renders the persisted snapshot in a Goal surface above Plan.

**Tech Stack:** Go 1.24, Codex App Server JSON-RPC, SQLite-backed Session records, TypeScript, React, Jest, Testing Library, project CSS and shared Lucide `Icon`.

---

### Task 1: Provider-neutral Goal protocol and Registry descriptors

**Files:**
- Modify: `server/internal/protocol/session_actions.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Test: `server/internal/protocol/registry_methods_test.go`

- [x] **Step 1: Write the failing protocol tests**

Add a table test that requires all Goal methods to be project-scoped Session forwards and requires `goal` in action capabilities:

```go
func TestRegistryGoalMethodsAreProjectScopedSessionForwards(t *testing.T) {
    methods := []string{
        RegistryMethodSessionGoalCreate,
        RegistryMethodSessionGoalGet,
        RegistryMethodSessionGoalUpdate,
        RegistryMethodSessionGoalStop,
        RegistryMethodSessionGoalClear,
    }
    for _, method := range methods {
        desc, ok := RegistryMethod(method)
        if !ok {
            t.Fatalf("RegistryMethod(%q) missing", method)
        }
        if desc.Route != RegistryRouteSessionForward || !desc.RequiresProjectID {
            t.Fatalf("%s descriptor = %#v", method, desc)
        }
    }
    if RegistryProtocolVersion != "2.6" {
        t.Fatalf("protocol version = %q", RegistryProtocolVersion)
    }
}
```

- [x] **Step 2: Run the protocol test and verify RED**

Run: `go test ./internal/protocol -run 'TestRegistryGoalMethods|TestSessionAction' -count=1`

Expected: FAIL because Goal constants/types do not exist.

- [x] **Step 3: Add Goal types and descriptors**

Add the following provider-neutral model to `session_actions.go`:

```go
const (
    SessionActionGoal = "goal"

    SessionGoalStatusActive        = "active"
    SessionGoalStatusPaused        = "paused"
    SessionGoalStatusBlocked       = "blocked"
    SessionGoalStatusUsageLimited  = "usageLimited"
    SessionGoalStatusBudgetLimited = "budgetLimited"
    SessionGoalStatusComplete      = "complete"
)

type SessionGoal struct {
    SessionID       string `json:"sessionId"`
    Objective       string `json:"objective"`
    Status          string `json:"status"`
    TokenBudget     *int64 `json:"tokenBudget"`
    TokensUsed      int64  `json:"tokensUsed"`
    TimeUsedSeconds int64  `json:"timeUsedSeconds"`
    CreatedAt       int64  `json:"createdAt"`
    UpdatedAt       int64  `json:"updatedAt"`
}

type OptionalInt64 struct {
    Present bool
    Value   *int64
}

type SessionGoalSetParams struct {
    SessionID   string
    Objective   *string
    Status      *string
    TokenBudget OptionalInt64
}
```

Add `Goal SessionActionCapability` to `SessionActionCapabilities`, define the five `RegistryMethodSessionGoal*` constants, and register each with `registryProjectMethod(method, RegistryRouteSessionForward)`.

- [x] **Step 4: Run the protocol package and verify GREEN**

Run: `go test ./internal/protocol -count=1`

Expected: PASS and protocol version remains `2.6`.

- [x] **Step 5: Commit the protocol contract**

```powershell
git add server/internal/protocol/session_actions.go server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go
git commit -m "feat(protocol): add session goal contracts"
```

### Task 2: Agent capability and optional Goal controller

**Files:**
- Modify: `server/internal/hub/agent/factory.go`
- Modify: `server/internal/hub/agent/instance.go`
- Test: `server/internal/hub/agent/agent_test.go`

- [x] **Step 1: Write failing optional-interface tests**

Use one fake connection implementing Goal and one without it:

```go
func TestInstanceSessionGoalController(t *testing.T) {
    conn := &fakeGoalConn{goal: protocol.SessionGoal{
        SessionID: "sess-1", Objective: "ship", Status: protocol.SessionGoalStatusActive,
    }}
    inst := newTestInstance(conn)
    got, err := inst.SessionGoalGet(context.Background(), "sess-1")
    if err != nil || got == nil || got.Objective != "ship" {
        t.Fatalf("SessionGoalGet() = %#v, %v", got, err)
    }
}

func TestInstanceSessionGoalControllerUnsupported(t *testing.T) {
    inst := newTestInstance(&fakeConn{})
    _, err := inst.SessionGoalGet(context.Background(), "sess-1")
    if !errors.Is(err, ErrSessionActionUnsupported) {
        t.Fatalf("error = %v", err)
    }
}
```

- [x] **Step 2: Run and verify RED**

Run: `go test ./internal/hub/agent -run 'TestInstanceSessionGoal' -count=1`

Expected: FAIL because the controller methods do not exist.

- [x] **Step 3: Add capability and forwarding interface**

Add `Goal bool` to `SessionActionSupport`, set Codex to true and all other providers to false. Add:

```go
type SessionGoalController interface {
    SessionGoalSet(context.Context, protocol.SessionGoalSetParams) (protocol.SessionGoal, error)
    SessionGoalGet(context.Context, string) (*protocol.SessionGoal, error)
    SessionGoalClear(context.Context, string) error
}

func (i *instance) SessionGoalSet(ctx context.Context, p protocol.SessionGoalSetParams) (protocol.SessionGoal, error) {
    controller, ok := i.conn.(SessionGoalController)
    if !ok {
        return protocol.SessionGoal{}, ErrSessionActionUnsupported
    }
    return controller.SessionGoalSet(ctx, p)
}
```

Implement equivalent `SessionGoalGet` and `SessionGoalClear` forwarders.

- [x] **Step 4: Run and verify GREEN**

Run: `go test ./internal/hub/agent -run 'TestInstanceSessionGoal|TestACPFactory' -count=1`

Expected: PASS.

- [x] **Step 5: Commit the Agent boundary**

```powershell
git add server/internal/hub/agent/factory.go server/internal/hub/agent/instance.go server/internal/hub/agent/agent_test.go
git commit -m "feat(agent): expose optional session goal controller"
```

### Task 3: Codex Goal wire model and control requests

**Files:**
- Modify: `server/internal/hub/agent/codexapp_convert.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Test: `server/internal/hub/agent/agent_test.go`

- [x] **Step 1: Write failing Codex request/response tests**

Cover create, patch omitted versus null, get, clear, and runtime thread ID hiding:

```go
func TestCodexAppSessionGoalSetPreservesNullableBudgetPatch(t *testing.T) {
    conn, rpc := newCodexAppTestConn(t, "sess-1", "thread-runtime")
    budget := protocol.OptionalInt64{Present: true, Value: nil}
    done := make(chan error, 1)
    go func() {
        _, err := conn.SessionGoalSet(context.Background(), protocol.SessionGoalSetParams{
            SessionID: "sess-1", TokenBudget: budget,
        })
        done <- err
    }()
    req := rpc.nextRequest(t, "thread/goal/set")
    var params map[string]json.RawMessage
    mustUnmarshal(t, req.Params, &params)
    if raw, ok := params["tokenBudget"]; !ok || string(raw) != "null" {
        t.Fatalf("tokenBudget = %s, present=%t", raw, ok)
    }
    if _, ok := params["objective"]; ok {
        t.Fatal("objective must be omitted")
    }
    rpc.respond(t, req.ID, map[string]any{"goal": codexGoalFixture("thread-runtime", "ship", "active")})
    if err := <-done; err != nil {
        t.Fatal(err)
    }
}
```

- [x] **Step 2: Run and verify RED**

Run: `go test ./internal/hub/agent -run 'TestCodexAppSessionGoal(Set|Get|Clear)' -count=1`

Expected: FAIL because Codex Goal types and methods are missing.

- [x] **Step 3: Add exact App Server JSON models and methods**

Define private wire structs with custom request map building so omitted/null is preserved:

```go
type codexappThreadGoal struct {
    ThreadID        string `json:"threadId"`
    Objective       string `json:"objective"`
    Status          string `json:"status"`
    TokenBudget     *int64 `json:"tokenBudget"`
    TokensUsed      int64  `json:"tokensUsed"`
    TimeUsedSeconds int64  `json:"timeUsedSeconds"`
    CreatedAt       int64  `json:"createdAt"`
    UpdatedAt       int64  `json:"updatedAt"`
}

func codexappGoalSetParams(threadID string, p protocol.SessionGoalSetParams) map[string]any {
    params := map[string]any{"threadId": threadID}
    if p.Objective != nil {
        params["objective"] = *p.Objective
    }
    if p.Status != nil {
        params["status"] = *p.Status
    }
    if p.TokenBudget.Present {
        params["tokenBudget"] = p.TokenBudget.Value
    }
    return params
}
```

Implement `SessionGoalSet`, `SessionGoalGet`, and `SessionGoalClear` through the existing App Server request helper and stable-to-runtime thread lookup.

- [x] **Step 4: Run focused Codex tests and verify GREEN**

Run: `go test ./internal/hub/agent -run 'TestCodexAppSessionGoal(Set|Get|Clear)' -count=1`

Expected: PASS.

- [x] **Step 5: Commit Codex control calls**

```powershell
git add server/internal/hub/agent/codexapp_convert.go server/internal/hub/agent/codexapp_agent.go server/internal/hub/agent/agent_test.go
git commit -m "feat(codex): map native goal controls"
```

### Task 4: Codex Goal notifications, automatic Turns, and Steer

**Files:**
- Modify: `server/internal/protocol/acp.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Test: `server/internal/hub/agent/agent_test.go`

- [x] **Step 1: Write failing notification lifecycle tests**

Add cases for `thread/goal/updated`, `thread/goal/cleared`, Goal `turn/started` without `promptDone`, continuation count, `turn/completed`, and Steer during an automatic Goal Turn:

```go
func TestCodexAppGoalTurnCanSteerWithoutPromptDone(t *testing.T) {
    conn, rpc, updates := newBoundCodexGoalConn(t)
    conn.handleAppServerNotification("thread/goal/updated", mustRaw(map[string]any{
        "threadId": "thread-runtime",
        "goal": codexGoalFixture("thread-runtime", "ship", "active"),
    }))
    conn.handleAppServerNotification("turn/started", mustRaw(map[string]any{
        "threadId": "thread-runtime", "turn": map[string]any{"id": "turn-goal-1"},
    }))
    go conn.SteerSession(context.Background(), "sess-1", "client-1", textBlocks("fix tests"))
    req := rpc.nextRequest(t, "turn/steer")
    assertJSONField(t, req.Params, "expectedTurnId", "turn-goal-1")
    assertUpdateKind(t, updates, "goal_turn_started")
}
```

- [x] **Step 2: Run and verify RED**

Run: `go test ./internal/hub/agent -run 'TestCodexAppGoal(Notification|Turn|Steer|Load)' -count=1`

Expected: FAIL because Goal events are dropped and Steer still requires `promptDone`.

- [x] **Step 3: Add provider-neutral Goal lifecycle updates**

Extend `protocol.SessionUpdateParams` with control-only update kinds and payload:

```go
const (
    SessionUpdateGoalUpdated       = "goal_updated"
    SessionUpdateGoalCleared       = "goal_cleared"
    SessionUpdateGoalTurnStarted   = "goal_turn_started"
    SessionUpdateGoalTurnCompleted = "goal_turn_completed"
)

type SessionGoalLifecycleUpdate struct {
    Goal   *SessionGoal `json:"goal,omitempty"`
    TurnID string       `json:"turnId,omitempty"`
}
```

Track `goal`, `goalTurnActive`, and `goalTurnCount` in `codexappConn`. Goal `turn/started` must call `setActiveTurnID` even when `promptDone == nil`; `SteerSession` accepts either ordinary prompt or active Goal turn. Emit lifecycle updates in per-thread notification order. Bind session/runtime IDs and update sink before `thread/resume`.

- [x] **Step 4: Run focused lifecycle tests and verify GREEN**

Run: `go test ./internal/hub/agent -run 'TestCodexAppGoal(Notification|Turn|Steer|Load)' -count=1`

Expected: PASS.

- [x] **Step 5: Commit Codex streaming behavior**

```powershell
git add server/internal/protocol/acp.go server/internal/hub/agent/codexapp_agent.go server/internal/hub/agent/agent_test.go
git commit -m "feat(codex): stream native goal lifecycle"
```

### Task 5: Session Goal state machine, command recognition, and persistence

**Files:**
- Create: `server/internal/hub/client/session_goal.go`
- Modify: `server/internal/hub/client/session.go`
- Modify: `server/internal/hub/client/client.go`
- Modify: `server/internal/hub/client/session_recorder.go`
- Test: `server/internal/hub/client/session_goal_test.go`
- Test: `server/internal/hub/client/client_test.go`

- [x] **Step 1: Write failing command and state-machine tests**

Cover raw command recording, objective validation, unfinished conflict, complete replacement, multi-Turn ownership, delayed release, and ordinary Prompt Resume upgrade:

```go
func TestSessionSendGoalRecordsRawCommandWithoutPromptingAgent(t *testing.T) {
    c, fake := newGoalClient(t)
    _, err := c.HandleSessionRequest(context.Background(), protocol.RegistryMethodSessionSend, "proj", mustRaw(
        map[string]any{"sessionId": "sess-1", "text": "/goal  Ship release  "},
    ))
    if err != nil {
        t.Fatal(err)
    }
    if fake.promptCalls != 0 || fake.goalSetCalls != 1 {
        t.Fatalf("prompt=%d goalSet=%d", fake.promptCalls, fake.goalSetCalls)
    }
    turns := readTurns(t, c, "sess-1")
    assertPromptRequestText(t, turns, "/goal  Ship release  ")
}

func TestSessionGoalDoesNotBecomeIdleBetweenNativeTurns(t *testing.T) {
    sess := newRunningGoalSession(t)
    sess.SessionUpdate(protocol.SessionUpdateParams{Update: protocol.SessionUpdateGoalTurnCompleted})
    if !sess.isRunning() || sess.executionKind != "goal" {
        t.Fatalf("goal ownership released between turns")
    }
}
```

- [x] **Step 2: Run and verify RED**

Run: `go test ./internal/hub/client -run 'TestSession(SendGoal|Goal)' -count=1`

Expected: FAIL because Goal routing and lifecycle do not exist.

- [x] **Step 3: Implement the Session Goal controller**

Create a focused runtime state:

```go
type sessionGoalState struct {
    snapshot          *protocol.SessionGoal
    turnActive        bool
    continuationCount int
    releaseAfterTurn  bool
    cleared           bool
}

func parseGoalCommand(blocks []protocol.ContentBlock) (raw string, objective string, matched bool, err error) {
    if len(blocks) != 1 || blocks[0].Type != protocol.ContentBlockTypeText {
        return "", "", false, nil
    }
    raw = blocks[0].Text
    trimmed := strings.TrimSpace(raw)
    if trimmed == "/goal" {
        return raw, "", true, fmt.Errorf("goal objective is required")
    }
    if !strings.HasPrefix(trimmed, "/goal ") {
        return "", "", false, nil
    }
    objective = strings.TrimSpace(strings.TrimPrefix(trimmed, "/goal"))
    if utf8.RuneCountInString(objective) > 4000 {
        return raw, "", true, fmt.Errorf("goal objective must be at most 4000 characters")
    }
    return raw, objective, true, nil
}
```

Add `Goal *protocol.SessionGoal` to `SessionAgentState`, deep-clone it, and include it in recorder summaries. Add `goal sessionGoalState` to `Session`. Implement:

- `createGoalFromCommand`: record raw prompt request, acquire `executionKind=goal`, set active Goal;
- `getGoal`, `updateGoal`, `stopGoal`, `clearGoal`;
- `handleGoalLifecycleUpdate`: persist snapshot before publishing, add `Goal continued` system turn for continuation 2+, suppress idle between Turns, delay `prompt_done` until the physical Turn completes;
- ordinary Prompt ownership upgrade when status becomes active during `executionKind=prompt`.

Route the five Registry methods through these Session methods. Decode update patch with raw JSON presence so omitted and explicit null remain distinct.

- [x] **Step 4: Run focused Session tests and verify GREEN**

Run: `go test ./internal/hub/client -run 'TestSession(SendGoal|Goal)' -count=1`

Expected: PASS.

- [x] **Step 5: Run existing Prompt, Steer, Compact, and recorder regressions**

Run: `go test ./internal/hub/client -run 'Test(SessionPrompt|HandleSessionRequestSessionSend|SessionSteer|SessionCompact|SessionRecorder)' -count=1`

Expected: PASS; ordinary execution behavior is unchanged.

- [x] **Step 6: Commit Session ownership**

```powershell
git add server/internal/hub/client/session_goal.go server/internal/hub/client/session.go server/internal/hub/client/client.go server/internal/hub/client/session_recorder.go server/internal/hub/client/session_goal_test.go server/internal/hub/client/client_test.go
git commit -m "feat(session): own persistent goal execution"
```

### Task 6: Active Goal restore, reconnect, and Fork boundary

**Files:**
- Modify: `server/internal/hub/client/client.go`
- Modify: `server/internal/hub/client/session.go`
- Verify: `server/internal/hub/hub.go`
- Test: `server/internal/hub/client/session_goal_test.go`
- Verify: `server/internal/hub/hub_test.go`

- [x] **Step 1: Write failing restart, reconnect, and Fork tests**

```go
func TestClientStartRestoresOnlyActiveGoals(t *testing.T) {
    store, registry := seededGoalStore(t,
        goalRecord("active", protocol.SessionGoalStatusActive),
        goalRecord("paused", protocol.SessionGoalStatusPaused),
        goalRecord("complete", protocol.SessionGoalStatusComplete),
    )
    c := NewWithRuntime(store, "proj", t.TempDir(), RuntimeConfig{AgentFactory: registry})
    if err := c.Start(context.Background()); err != nil {
        t.Fatal(err)
    }
    if registry.loads("active") != 1 || registry.loads("paused") != 0 || registry.loads("complete") != 0 {
        t.Fatalf("unexpected loads: %#v", registry.loadCounts)
    }
}

func TestForkDoesNotCopyGoalSnapshot(t *testing.T) {
    result := forkRunningGoal(t)
    if result.Session.agentState.Goal != nil {
        t.Fatal("fork inherited goal")
    }
}

func TestClientRecoversActiveGoalAfterAgentRuntimeStops(t *testing.T) {
    client, session, stoppedRuntime := runningGoalSession(t)
    stoppedRuntime.alive = false
    client.recoverActiveGoals(context.Background())
    if session.instance == stoppedRuntime || session.agentState.Goal.Status != protocol.SessionGoalStatusActive {
        t.Fatal("active Goal did not reconnect")
    }
}
```

- [x] **Step 2: Run and verify RED**

Run: `go test ./internal/hub/client ./internal/hub -run 'Test(ClientStartRestoresOnlyActiveGoals|ForkDoesNotCopyGoal|HubRestoresActiveGoal)' -count=1`

Expected: FAIL because startup does not scan active Goals and clone code copies the snapshot.

- [x] **Step 3: Implement targeted eager restore**

After `Client.Start` has its sink/runtime ready, list Session records, parse `SessionAgentState`, check `Goal.Status == active` and provider Goal capability, then call `SessionByID` and `ensureReadyAndNotify`. Mark the restored Session as Goal-owned before loading so early Codex notifications are accepted. Keep failures isolated per Session and logged; startup itself remains available.

While the Client is running, probe only materialized active Goals. When a provider runtime becomes unavailable, clear the ended physical Turn, replace the dead instance, load the stable Session ID, and call Goal get to reconcile the snapshot. Keep Goal execution ownership across reconnect; paused and terminal Goals must not reconnect.

Explicitly set `forkState.Goal = nil` in all fork/new-session clone paths.

- [x] **Step 4: Run restore tests and verify GREEN**

Run: `go test ./internal/hub/client ./internal/hub -run 'Test(ClientStartRestoresOnlyActiveGoals|ClientRecoversActiveGoalAfterAgentRuntimeStops|ForkDoesNotCopyGoal|HubRestoresActiveGoal)' -count=1`

Expected: PASS.

- [x] **Step 5: Commit restore behavior**

```powershell
git add server/internal/hub/client/client.go server/internal/hub/client/session_goal_test.go
git commit -m "feat(session): restore active goals"
```

### Task 7: Web Registry types, normalization, and service calls

**Files:**
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Test: `app/__tests__/web-session-actions-service.test.ts`
- Create: `app/__tests__/web-registry-session-goal.test.ts`

- [x] **Step 1: Write failing Web transport tests**

```ts
it('normalizes goal capability and snapshot', () => {
  const session = normalizeSession({
    sessionId: 'sess-1',
    sessionActions: {goal: {supported: true}},
    goal: {
      sessionId: 'sess-1',
      objective: 'ship',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 42,
      timeUsedSeconds: 7,
      createdAt: 10,
      updatedAt: 11,
    },
  });
  expect(session.sessionActions?.goal.supported).toBe(true);
  expect(session.goal?.tokenBudget).toBeNull();
});

it('preserves explicit null in goal update', async () => {
  await service.updateProjectSessionGoal('proj', 'sess-1', {tokenBudget: null});
  expect(sendRequest).toHaveBeenCalledWith(
    RegistryMethods.SessionGoalUpdate,
    expect.objectContaining({projectId: 'proj', payload: {sessionId: 'sess-1', tokenBudget: null}}),
  );
});
```

- [x] **Step 2: Run and verify RED**

Run from `app`: `npm test -- --runInBand __tests__/web-session-actions-service.test.ts __tests__/web-registry-session-goal.test.ts`

Expected: FAIL because Goal methods/types are absent.

- [x] **Step 3: Add Web contracts and service methods**

Add:

```ts
export type RegistrySessionGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete';

export interface RegistrySessionGoal {
  sessionId: string;
  objective: string;
  status: RegistrySessionGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export type RegistrySessionGoalPatch = {
  objective?: string;
  tokenBudget?: number | null;
  status?: 'active' | 'paused';
};
```

Add `goal` to capabilities and session summary; add five method constants. Implement repository/service create/get/update/stop/clear calls without serializing absent patch keys and normalize every numeric/status field conservatively.

- [x] **Step 4: Run and verify GREEN**

Run from `app`: `npm test -- --runInBand __tests__/web-session-actions-service.test.ts __tests__/web-registry-session-goal.test.ts`

Expected: PASS.

- [x] **Step 5: Commit Web transport**

```powershell
git add app/web/src/registry/registryMethods.ts app/web/src/registry/registryTypes.ts app/web/src/registry/RegistryRepository.ts app/web/src/registry/RegistryWorkspaceService.ts app/__tests__/web-session-actions-service.test.ts app/__tests__/web-registry-session-goal.test.ts
git commit -m "feat(web): add session goal transport"
```

### Task 8: `/goal` slash insertion and ordinary queue semantics

**Files:**
- Modify: `app/web/src/chat/session/chatSessionActions.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Test: `app/__tests__/web-chat-session-actions.test.ts`
- Test: `app/__tests__/web-chat-ui.test.ts`

- [x] **Step 1: Write failing slash menu tests**

```ts
it('shows Goal only when supported and inserts plain command text', () => {
  const options = buildChatSlashOptions([], {
    goal: {supported: true},
  } as RegistrySessionActionCapabilities);
  expect(options).toContainEqual(expect.objectContaining({
    name: '/goal',
    behavior: 'insert-command',
    insertText: '/goal ',
  }));
});

it('does not resolve /goal as an immediate standalone action', () => {
  expect(resolveStandaloneSessionAction('/goal ship')).toEqual({kind: 'none'});
});
```

- [x] **Step 2: Run and verify RED**

Run from `app`: `npm test -- --runInBand __tests__/web-chat-session-actions.test.ts __tests__/web-chat-ui.test.ts`

Expected: FAIL because `/goal` is absent.

- [x] **Step 3: Add capability-gated plain-text insertion**

Extend slash option behavior with:

```ts
export type ChatSlashOptionBehavior = 'invoke' | 'insert' | 'insert-command';

if (capabilities?.goal?.supported === true) {
  options.push({
    name: '/goal',
    description: 'Run toward an objective across turns',
    behavior: 'insert-command',
    insertText: '/goal ',
  });
}
```

In the menu selection handler, replace the trigger range with `insertText` for `insert-command` and keep the composer focused. Do not add `/goal` to `resolveStandaloneSessionAction`; existing send/queue/drain code must handle it unchanged.

- [x] **Step 4: Run and verify GREEN**

Run from `app`: `npm test -- --runInBand __tests__/web-chat-session-actions.test.ts __tests__/web-chat-ui.test.ts`

Expected: PASS.

- [x] **Step 5: Commit slash behavior**

```powershell
git add app/web/src/chat/session/chatSessionActions.ts app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-session-actions.test.ts app/__tests__/web-chat-ui.test.ts
git commit -m "feat(chat): insert queued goal commands"
```

### Task 9: Goal surface component and visual system

**Files:**
- Modify: `app/web/src/common/Icon.tsx`
- Create: `app/web/src/chat/chatGoal.ts`
- Create: `app/web/src/chat/ChatGoalSurface.tsx`
- Modify: `app/web/src/styles/chat.css`
- Test: `app/__tests__/web-chat-goal-surface.test.tsx`

- [x] **Step 1: Verify and sync the required shared icons**

Run:

```powershell
better-icons get lucide:target
better-icons get lucide:pause
better-icons get lucide:play
better-icons get lucide:pencil
better-icons get lucide:trash-2
```

Expected: valid 24×24 stroke SVGs. Add only missing `target` and `pause` glyph bodies to the existing `GLYPHS`; reuse existing `play`, `pencil`, and `trash`.

- [x] **Step 2: Write failing component tests**

```tsx
it('renders active goal with tabular stats and Pause', () => {
  render(
    <ChatGoalSurface
      mode="desktop"
      goal={goal({status: 'active', tokenBudget: null})}
      onPause={jest.fn()}
      onResume={jest.fn()}
      onEdit={jest.fn()}
      onClear={jest.fn()}
    />,
  );
  expect(screen.getByText('Unlimited')).toBeTruthy();
  expect(screen.getByRole('button', {name: 'Pause goal'})).toBeTruthy();
  expect(screen.queryByRole('button', {name: 'Resume goal'})).toBeNull();
});

it.each(['paused', 'blocked', 'usageLimited', 'budgetLimited'] as const)(
  'offers Resume for %s',
  status => {
    render(<GoalHarness status={status} />);
    expect(screen.getByRole('button', {name: 'Resume goal'})).toBeTruthy();
  },
);
```

- [x] **Step 3: Run and verify RED**

Run from `app`: `npm test -- --runInBand __tests__/web-chat-goal-surface.test.tsx`

Expected: FAIL because the component/helper does not exist.

- [x] **Step 4: Implement formatting and the responsive surface**

In `chatGoal.ts`, implement pure helpers:

```ts
export function formatGoalTokens(value: number): string {
  return new Intl.NumberFormat('en', {notation: value >= 10_000 ? 'compact' : 'standard'}).format(value);
}

export function formatGoalElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function canResumeGoal(status: RegistrySessionGoalStatus): boolean {
  return status === 'paused' || status === 'blocked' ||
    status === 'usageLimited' || status === 'budgetLimited';
}
```

Implement `ChatGoalSurface` with `ChatEdgeSurfaceHeader` in desktop mode and an expandable compact mobile pill. The objective is the primary content; status uses one restrained semantic dot; token and elapsed values use `font-variant-numeric: tabular-nums`. Icon-only controls require `title` and `aria-label`. Use existing theme variables, edge-surface glass, 8px rhythm, no gradient, glow, or new animation.

- [x] **Step 5: Run and verify GREEN**

Run from `app`: `npm test -- --runInBand __tests__/web-chat-goal-surface.test.tsx`

Expected: PASS.

- [x] **Step 6: Commit the surface**

```powershell
git add app/web/src/common/Icon.tsx app/web/src/chat/chatGoal.ts app/web/src/chat/ChatGoalSurface.tsx app/web/src/styles/chat.css app/__tests__/web-chat-goal-surface.test.tsx
git commit -m "feat(chat): add responsive goal console"
```

### Task 10: Workspace Goal controls, edit dialog, confirmation, Stop, and placement

**Files:**
- Modify: `app/web/src/shell/AppDialogs.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`
- Test: `app/__tests__/web-chat-goal-workspace.test.tsx`
- Test: `app/__tests__/web-chat-plan-surface.test.tsx`
- Test: `app/__tests__/web-chat-ui.test.ts`

- [x] **Step 1: Write failing Workspace integration tests**

Test the exact stack order, mobile order, edit patch, Pause/Resume, destructive confirmation, and Stop routing:

```ts
it('places Goal above Plan on desktop and mobile', () => {
  const source = readWorkspaceSource();
  const desktop = source.slice(source.indexOf('chat-edge-surface-stack'));
  expect(desktop.indexOf('<ChatGoalSurface')).toBeLessThan(desktop.indexOf('<ChatPlanSurface'));
  const mobile = source.slice(source.indexOf('mode="mobile"'));
  expect(mobile.indexOf('<ChatGoalSurface')).toBeLessThan(mobile.indexOf('<ChatPlanSurface'));
});

it('routes stop to session.goal.stop while an active goal owns the session', async () => {
  renderWorkspace({goal: goal({status: 'active'}), running: true});
  fireEvent.click(screen.getByRole('button', {name: 'Stop'}));
  expect(workspaceService.stopProjectSessionGoal).toHaveBeenCalledWith('proj', 'sess-1');
  expect(workspaceService.cancelProjectSession).not.toHaveBeenCalled();
});

it('confirms clear and explains the current turn continues', async () => {
  renderWorkspace({goal: goal({status: 'paused'})});
  fireEvent.click(screen.getByRole('button', {name: 'Clear goal'}));
  expect(screen.getByText(/current turn will continue/i)).toBeTruthy();
});
```

- [x] **Step 2: Run and verify RED**

Run from `app`: `npm test -- --runInBand __tests__/web-chat-goal-workspace.test.tsx __tests__/web-chat-plan-surface.test.tsx __tests__/web-chat-ui.test.ts`

Expected: FAIL because Goal is not wired into Workspace.

- [x] **Step 3: Implement dialogs and control handlers**

Add `goalClear` to `ConfirmTarget` and render it through the existing accessible `AppConfirmDialog`. Add a focused edit dialog with objective textarea, optional positive integer token budget input, inline validation, Cancel, and Save changes.

In `WorkspaceApp`:

```ts
const selectedGoal = selectedChatSession?.sessionActions?.goal.supported
  ? selectedChatSession.goal ?? null
  : null;

const handlePauseGoal = () =>
  workspaceService.updateProjectSessionGoal(projectId, sessionId, {status: 'paused'});

const handleResumeGoal = () =>
  workspaceService.updateProjectSessionGoal(projectId, sessionId, {status: 'active'});
```

Update selected session state from every returned Goal response and continue relying on `session.updated` for multi-client/reconnect updates. Insert desktop `ChatGoalSurface` immediately before desktop Plan and mobile Goal immediately before mobile Plan. When `selectedGoal.status === active` and the Session is running, the composer Stop handler calls `stopProjectSessionGoal`; all other running executions retain `cancelProjectSession`.

- [x] **Step 4: Update shared stack CSS**

Add `.chat-goal-surface.desktop` to all stack child, expanded/collapsed, and glass selector groups currently listing Recent/Plan/Function. Keep the existing fixed width and fade geometry. Add mobile safe spacing above composer without fixed positioning.

- [x] **Step 5: Run and verify GREEN**

Run from `app`: `npm test -- --runInBand __tests__/web-chat-goal-workspace.test.tsx __tests__/web-chat-plan-surface.test.tsx __tests__/web-chat-ui.test.ts`

Expected: PASS.

- [x] **Step 6: Commit Workspace controls**

```powershell
git add app/web/src/shell/AppDialogs.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-goal-workspace.test.tsx app/__tests__/web-chat-plan-surface.test.tsx app/__tests__/web-chat-ui.test.ts
git commit -m "feat(chat): wire goal controls into workspace"
```

### Task 11: Cross-layer regression suite and documentation audit

**Files:**
- Modify: `docs/scope/2026-07-26-session-goal/plan-session-goal.md`
- Verify: `docs/scope/2026-07-26-session-goal/spec-session-goal.md`
- Verify: `docs/wiki/agents/agents.md`
- Verify: `docs/wiki/agents/session-capabilities.md`
- Verify: `docs/wiki/agents/codex.md`
- Verify: `docs/wiki/architecture/session-management-and-sync.md`
- Verify: `docs/wiki/architecture/server-runtime.md`
- Verify: `docs/wiki/protocols/registry.md`
- Verify: `docs/wiki/frontend-interaction/composer.md`
- Verify: `docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md`

- [x] **Step 1: Run focused Go suites**

Run:

```powershell
Set-Location server
go test ./internal/protocol ./internal/hub/agent ./internal/hub/client ./internal/hub -count=1
```

Expected: PASS.

- [x] **Step 2: Run the full Go suite**

Run from `server`: `go test ./... -count=1`

Expected: PASS.

- [x] **Step 3: Run focused and full Web tests**

Run from `app`:

```powershell
npm test -- --runInBand __tests__/web-chat-session-actions.test.ts __tests__/web-session-actions-service.test.ts __tests__/web-registry-session-goal.test.ts __tests__/web-chat-goal-surface.test.tsx __tests__/web-chat-goal-workspace.test.tsx __tests__/web-chat-plan-surface.test.tsx __tests__/web-chat-ui.test.ts
npm test -- --runInBand
```

Expected: PASS.

- [x] **Step 4: Run Web typecheck and production build**

Run from `app`:

```powershell
npm run tsc:web
npm run build:web
```

Expected: both commands exit 0 without new warnings.

- [x] **Step 5: Audit spec, wiki, and version**

Run from repository root:

```powershell
rg -n "T[B]D|T[O]DO|implement[ ]later|fill[ ]in[ ]details" docs/scope/2026-07-26-session-goal docs/wiki/agents
rg -n "RegistryProtocolVersion|PROTOCOL_VERSION" server app/web/src
git diff --check
```

Expected: placeholder search has no matches; protocol remains `2.6`; `git diff --check` exits 0.

- [x] **Step 6: Mark every completed plan checkbox**

Change each completed `- [ ]` in this file to `- [x]`. Leave none checked unless its command and expected result were actually observed.

- [x] **Step 7: Run final status and diff review**

Run:

```powershell
git status -sb
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- server/internal/protocol server/internal/hub/agent server/internal/hub/client app/web/src docs
```

Expected: only Session Goal implementation, tests, scope, and approved Agent wiki changes.

- [ ] **Step 8: Rebase, perform the required final commit tail, and push**

Fetch and rebase the feature branch without touching the user’s dirty main worktree:

```powershell
git fetch origin
git rebase origin/main
git add -A
git commit -m "docs(goal): finalize session goal implementation"
git push -u origin feat/session-goal
```

Expected: push succeeds and the final commit contains only plan completion/document reconciliation left after the logical implementation commits.

- [ ] **Step 9: Merge only from a clean main worktree**

Check `git -C D:\Code\WheelMaker status -sb`. If clean, fast-forward or merge `feat/session-goal` into `main`, push `origin/main`, and remove the feature worktree/branch according to `docs/user/git-preferences.md`. If dirty, do not stash, overwrite, or merge; leave the pushed feature branch intact and report the exact dirty-main blocker.
