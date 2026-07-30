# Universal Session Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/status` (`session.status`) work for every agent, not just codex, by adding a provider-neutral fallback that surfaces the WheelMaker session id, agent type, and token usage without spawning the agent subprocess.

**Architecture:** `status` becomes a universal WheelMaker-layer capability. Two capability gates (`actionLookup` feeding the session summary, and `sessionSupportsAction` guarding dispatch) always report status supported. `Session.SessionStatus` reads the factory's status flag to decide: codex (flag set) keeps its live `ensureInstance` + provider path; every other provider takes a new persisted-state fallback (`s.acpSessionID` + `s.agentType` + `s.agentState.Usage`) that never calls `ensureInstance`. A new optional `agentType` response field carries the agent type to the existing dialog, which renders it and already degrades gracefully when codex-only `limits`/`account` are absent.

**Tech Stack:** Go (server `internal/hub/client` + `internal/hub/agent` + `internal/protocol`), TypeScript/React (app/web), Jest + react-test-renderer, `go test`.

**Working location:** All work happens in the existing worktree on branch `feat/universal-session-status` at `.worktree/feat/universal-session-status/`. Run server Go commands from `server/` and web commands from `app/` inside that worktree.

---

## File Structure

**Server (Go):**
- `server/internal/protocol/session_actions.go` — add optional `AgentType` field to `SessionActionStatusResult`.
- `server/internal/protocol/registry_methods_test.go` — JSON round-trip test for the new field.
- `server/internal/hub/client/client.go` — `actionLookup` (status always supported) and `sessionSupportsAction` (status always true).
- `server/internal/hub/client/client_test.go` — capability + generic-fallback dispatch tests.
- `server/internal/hub/client/session.go` — restructure `Session.SessionStatus` into live vs generic paths; add `liveStatusSupported`, `genericSessionStatusResult`, `statusContextFromUsage` helpers.

**Web (TypeScript/React):**
- `app/web/src/registry/registryTypes.ts` — add `agentType?` to `RegistrySessionStatusResult`.
- `app/web/src/registry/RegistryRepository.ts` — parse `agentType` in `statusSession`.
- `app/web/src/shell/AppDialogs.tsx` — render agent type row in `AppSessionStatusDialog`.
- `app/__tests__/web-session-status-dialog.test.tsx` — non-codex rendering test + codex agent-type assertion.

---

## Task 1: Add optional `AgentType` to the status result (protocol)

**Files:**
- Modify: `server/internal/protocol/session_actions.go` (the `SessionActionStatusResult` struct, currently around line 132)
- Test: `server/internal/protocol/registry_methods_test.go`

- [ ] **Step 1: Write the failing test**

Append to `server/internal/protocol/registry_methods_test.go` (this file is `package protocol`, so reference the type without a package prefix). If `encoding/json` or `strings` are not already imported, add them to the import block.

```go
func TestSessionActionStatusResultAgentTypeJSON(t *testing.T) {
	encoded, err := json.Marshal(SessionActionStatusResult{OK: true, SessionID: "sess-1", AgentType: "codex"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(encoded), `"agentType":"codex"`) {
		t.Fatalf("expected agentType in json, got %s", encoded)
	}

	var decoded SessionActionStatusResult
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.AgentType != "codex" {
		t.Fatalf("decoded agentType = %q", decoded.AgentType)
	}

	empty, err := json.Marshal(SessionActionStatusResult{OK: true, SessionID: "sess-1"})
	if err != nil {
		t.Fatalf("marshal empty: %v", err)
	}
	if strings.Contains(string(empty), "agentType") {
		t.Fatalf("expected omitempty, got %s", empty)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && go test ./internal/protocol/ -run TestSessionActionStatusResultAgentTypeJSON -v`
Expected: compile error `unknown field 'AgentType' in struct literal of type SessionActionStatusResult`.

- [ ] **Step 3: Add the field**

In `server/internal/protocol/session_actions.go`, add `AgentType` to `SessionActionStatusResult` (keep existing fields and order; insert the new line after `SessionID`):

```go
type SessionActionStatusResult struct {
	OK        bool                        `json:"ok"`
	SessionID string                      `json:"sessionId"`
	AgentType string                      `json:"agentType,omitempty"`
	Context   *SessionActionStatusContext `json:"context,omitempty"`
	Limits    []SessionActionRateLimit    `json:"limits"`
	Account   *SessionActionStatusAccount `json:"account,omitempty"`
	UpdatedAt string                      `json:"updatedAt"`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && go test ./internal/protocol/ -run TestSessionActionStatusResultAgentTypeJSON -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/protocol/session_actions.go server/internal/protocol/registry_methods_test.go
git commit -m "feat(protocol): add agentType to session status result

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Make the `status` capability universally supported (server gating)

**Files:**
- Modify: `server/internal/hub/client/client.go` — `actionLookup` (around line 132) and `sessionSupportsAction` (around line 1711)
- Test: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write the failing test**

Append to `server/internal/hub/client/client_test.go`:

```go
func TestSessionStatusActionAlwaysSupported(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	c := New(store, "proj1", t.TempDir())
	c.registry = agent.NewACPFactory()
	t.Cleanup(func() { _ = c.Close() })

	// status is universal: supported for known providers without status
	// capability, and for unparseable agent types.
	for _, agentType := range []string{"claude", "kimi", "unknown-agent"} {
		caps := c.sessionRecorder.actionLookup(agentType)
		if !caps.Status.Supported {
			t.Fatalf("agentType %q: status not supported", agentType)
		}
	}

	// non-status actions stay unsupported for an unregistered provider.
	if c.sessionRecorder.actionLookup("claude").Compact.Supported {
		t.Fatalf("claude: compact should be unsupported")
	}

	// dispatch gate agrees for a real session.
	sess := &Session{agentType: "claude"}
	if !c.sessionSupportsAction(sess, acp.SessionActionStatus) {
		t.Fatalf("sessionSupportsAction(status) should be true for claude")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && go test ./internal/hub/client/ -run TestSessionStatusActionAlwaysSupported -v`
Expected: FAIL — `status not supported` for `"claude"` (and `"unknown-agent"`).

- [ ] **Step 3: Make `actionLookup` always report status supported**

Replace the `c.sessionRecorder.actionLookup = func(...)` body in `server/internal/hub/client/client.go` (currently around line 132-160). The status line is removed from the struct literal and applied once at the end so it also covers the unknown-provider branch:

```go
	c.sessionRecorder.actionLookup = func(agentType string) acp.SessionActionCapabilities {
		var caps acp.SessionActionCapabilities
		provider, ok := acp.ParseACPProvider(agentType)
		if !ok || c.registry == nil {
			caps = unsupportedSessionActions("Current Agent does not support this action.")
		} else {
			support := c.registry.SessionActions(provider)
			caps = acp.SessionActionCapabilities{
				Compact: acp.SessionActionCapability{Supported: support.Compact, Reason: unsupportedSessionActionReason(support.Compact)},
				Steer:   acp.SessionActionCapability{Supported: support.Steer, Reason: unsupportedSessionActionReason(support.Steer)},
				Fork:    acp.SessionActionCapability{Supported: support.Fork, Reason: unsupportedSessionActionReason(support.Fork)},
				Goal:    acp.SessionActionCapability{Supported: support.Goal, Reason: unsupportedSessionActionReason(support.Goal)},
			}
		}
		// status is a universal WheelMaker-layer capability (DB identity +
		// token usage), independent of provider support.
		caps.Status = acp.SessionActionCapability{Supported: true}
		return caps
	}
```

- [ ] **Step 4: Make `sessionSupportsAction` always allow status**

In `server/internal/hub/client/client.go`, edit `sessionSupportsAction` (currently around line 1711). Add the status short-circuit right after the nil-guard, and remove the now-dead `SessionActionStatus` case from the switch:

```go
func (c *Client) sessionSupportsAction(sess *Session, action string) bool {
	if c == nil || c.registry == nil || sess == nil {
		return false
	}
	if strings.TrimSpace(action) == acp.SessionActionStatus {
		return true
	}
	sess.mu.Lock()
	agentType := sess.agentType
	sess.mu.Unlock()
	provider, ok := acp.ParseACPProvider(agentType)
	if !ok {
		return false
	}
	support := c.registry.SessionActions(provider)
	switch strings.TrimSpace(action) {
	case acp.SessionActionCompact:
		return support.Compact
	case acp.SessionActionSteer:
		return support.Steer
	case acp.SessionActionFork:
		return support.Fork
	case acp.SessionActionGoal:
		return support.Goal
	default:
		return false
	}
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && go test ./internal/hub/client/ -run TestSessionStatusActionAlwaysSupported -v`
Expected: PASS.

- [ ] **Step 6: Confirm no existing capability test regressed**

Run: `cd server && go test ./internal/hub/client/ -run "SessionAction|SessionStatus|Status" -v`
Expected: PASS — including the existing codex summary assertion at `client_test.go:9270` (codex status stays supported) and the codex dispatch test `TestHandleSessionRequestSessionStatusInitializesWithoutLoading`.

- [ ] **Step 7: Commit**

```bash
git add server/internal/hub/client/client.go server/internal/hub/client/client_test.go
git commit -m "feat(hub): make session status a universal capability

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Generic `Session.SessionStatus` fallback without spawning (server)

**Files:**
- Modify: `server/internal/hub/client/session.go` — `SessionStatus` (line 503) + new helpers
- Test: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write the failing test**

Append to `server/internal/hub/client/client_test.go`. This provider is registered with a creator but NO `RegisterSessionActions`, so the factory status flag is false → generic path. The stub's `Limits` must NOT appear, and the instance must NOT be initialized (no spawn):

```go
func TestHandleSessionRequestSessionStatusGenericWithoutSpawn(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	ctx := context.Background()
	if err := store.SaveSession(ctx, &SessionRecord{
		ID:          "sess-gen",
		ProjectName: "proj1",
		AgentType:   string(acp.ACPProviderClaude),
		AgentJSON:   `{"usage":{"used":9000,"size":128000,"updatedAt":"2026-07-30T10:00:00Z"}}`,
		CreatedAt:   time.Now().Add(-time.Hour),
		LastActiveAt: time.Now().Add(-time.Minute),
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	inst := &testInjectedInstance{
		name:      string(acp.ACPProviderClaude),
		sessionID: "sess-gen",
		alive:     true,
		statusResult: acp.SessionActionStatusResult{
			OK: true,
			Limits: []acp.SessionActionRateLimit{{ID: "should-not-leak", Name: "Should not appear", UsedPercent: 1, RemainingPercent: 99}},
		},
	}
	c := New(store, "proj1", t.TempDir())
	c.registry = agent.NewACPFactory()
	c.registry.Register(acp.ACPProviderClaude, func(context.Context, string) (agent.Instance, error) { return inst, nil })
	t.Cleanup(func() { _ = c.Close() })

	response, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionStatus, "proj1", json.RawMessage(`{"sessionId":"sess-gen"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.status): %v", err)
	}
	status, ok := response.(acp.SessionActionStatusResult)
	if !ok {
		t.Fatalf("status response type = %T", response)
	}
	if status.SessionID != "sess-gen" {
		t.Fatalf("SessionID = %q", status.SessionID)
	}
	if status.AgentType != string(acp.ACPProviderClaude) {
		t.Fatalf("AgentType = %q", status.AgentType)
	}
	if status.Context == nil || status.Context.Used != 9000 || status.Context.Size == nil || *status.Context.Size != 128000 {
		t.Fatalf("Context = %+v", status.Context)
	}
	if len(status.Limits) != 0 {
		t.Fatalf("Limits should be empty on generic path, got %+v", status.Limits)
	}
	if inst.initCalls != 0 {
		t.Fatalf("generic status must not spawn the agent, initCalls=%d", inst.initCalls)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && go test ./internal/hub/client/ -run TestHandleSessionRequestSessionStatusGenericWithoutSpawn -v`
Expected: FAIL — either `initCalls` is 1 (current code always `ensureInstance`s), or an `unsupported` error (current `!ok` branch returns `ErrSessionActionUnsupported`).

- [ ] **Step 3: Restructure `SessionStatus` and add helpers**

Replace the whole `Session.SessionStatus` function in `server/internal/hub/client/session.go` (currently lines 503-540) with the version below, and append the three helper funcs immediately after it:

```go
func (s *Session) SessionStatus(ctx context.Context) (acp.SessionActionStatusResult, error) {
	s.mu.Lock()
	sessionID := s.acpSessionID
	agentType := s.agentType
	usage := s.agentState.Usage
	factory := s.registry
	s.mu.Unlock()

	// status is universal: providers without rich live status (everything
	// except codex today) get a provider-neutral result built from persisted
	// state, without spawning the agent subprocess.
	if !liveStatusSupported(factory, agentType) {
		return genericSessionStatusResult(sessionID, agentType, usage), nil
	}

	// Rich live status path: connect/spawn and query the provider.
	if err := s.ensureInstance(ctx); err != nil {
		return acp.SessionActionStatusResult{}, err
	}
	if err := s.ensureInitialized(ctx); err != nil {
		return acp.SessionActionStatusResult{}, err
	}
	s.mu.Lock()
	inst := s.instance
	s.mu.Unlock()
	provider, ok := inst.(agent.SessionStatusProvider)
	if !ok {
		return genericSessionStatusResult(sessionID, agentType, usage), nil
	}
	result, err := provider.SessionStatus(ctx)
	if err != nil {
		return acp.SessionActionStatusResult{}, err
	}
	result.OK = true
	result.SessionID = sessionID
	result.AgentType = agentType
	if usage != nil {
		result.Context = statusContextFromUsage(usage)
	}
	s.persistSessionBestEffort()
	return result, nil
}

// liveStatusSupported reports whether the provider offers rich live status
// (rate limits / account). The factory status flag no longer gates whether
// status is available; it only marks providers whose status requires a live
// agent connection. Only codex sets it today.
func liveStatusSupported(factory *agent.ACPFactory, agentType string) bool {
	if factory == nil {
		return false
	}
	provider, ok := acp.ParseACPProvider(agentType)
	if !ok {
		return false
	}
	return factory.SessionActions(provider).Status
}

// genericSessionStatusResult builds the universal provider-neutral status from
// persisted session state, with no agent subprocess interaction.
func genericSessionStatusResult(sessionID, agentType string, usage *acp.SessionUsage) acp.SessionActionStatusResult {
	return acp.SessionActionStatusResult{
		OK:        true,
		SessionID: sessionID,
		AgentType: agentType,
		Context:   statusContextFromUsage(usage),
	}
}

// statusContextFromUsage projects persisted token usage onto the status context.
// Returns nil when there is no usage recorded.
func statusContextFromUsage(usage *acp.SessionUsage) *acp.SessionActionStatusContext {
	if usage == nil {
		return nil
	}
	context := &acp.SessionActionStatusContext{
		Used:      usage.Used,
		UpdatedAt: usage.UpdatedAt,
	}
	if usage.Size > 0 {
		size := usage.Size
		context.Size = &size
	}
	return context
}
```

Notes for the implementer:
- The original inline `Context` construction is replaced by `statusContextFromUsage`; behavior for the codex path is preserved because `result.Context` is only reassigned `if usage != nil` (a nil usage leaves any provider-supplied context untouched, as before).
- `agent.ErrSessionActionUnsupported` is no longer returned from this function; it remains used by the other session actions, so no import changes are needed.

- [ ] **Step 4: Run the new test to verify it passes**

Run: `cd server && go test ./internal/hub/client/ -run TestHandleSessionRequestSessionStatusGenericWithoutSpawn -v`
Expected: PASS.

- [ ] **Step 5: Confirm the codex live path still works**

Run: `cd server && go test ./internal/hub/client/ -run TestHandleSessionRequestSessionStatusInitializesWithoutLoading -v`
Expected: PASS — codex still initializes the instance (`initCalls == 1`), returns its limits, and enriches context from usage.

- [ ] **Step 6: Commit**

```bash
git add server/internal/hub/client/session.go server/internal/hub/client/client_test.go
git commit -m "feat(hub): generic session status fallback without agent spawn

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Surface agent type in the status dialog (web)

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts` (`RegistrySessionStatusResult`, line 528)
- Modify: `app/web/src/registry/RegistryRepository.ts` (`statusSession`, line 1535)
- Modify: `app/web/src/shell/AppDialogs.tsx` (`AppSessionStatusDialog` header, around line 750)
- Test: `app/__tests__/web-session-status-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

In `app/__tests__/web-session-status-dialog.test.tsx`, add a non-codex test inside the existing `describe` block, and add `agentType: 'codex'` to the second test's `status` fixture (around line 44) so codex also renders its agent type:

Add to the codex `status` object in the "renders normalized limit windows..." test:
```ts
            agentType: 'codex',
```
and extend that test's assertions (after the existing `expect(text).toContain('Pro')` line) with:
```ts
    expect(text).toContain('codex');
```

Then append this new test at the end of the `describe` block:

```tsx
  test('renders agent type and context for non-codex sessions without limits or account', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AppSessionStatusDialog
          sessionId="stable-session"
          status={{
            ok: true,
            sessionId: 'stable-session',
            agentType: 'claude',
            context: {used: 7000, size: 200000},
            limits: [],
            updatedAt: '2026-07-30T10:00:00Z',
          }}
          loading={false}
          error=""
          onClose={() => undefined}
          onRefresh={() => undefined}
        />,
      );
    });
    const text = renderedText(renderer!.toJSON());
    expect(text).toContain('claude');
    expect(text).toContain('7,000');
    expect(text).not.toContain('Rate limits');
    expect(text).not.toContain('Account');
    expect(renderer!.root.findByProps({'data-testid': 'session-status-agent'})).toBeTruthy();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx jest web-session-status-dialog`
Expected: FAIL — TypeScript error `Property 'agentType' does not exist on type 'RegistrySessionStatusResult'`, and the new test cannot find `session-status-agent`.

- [ ] **Step 3: Add `agentType` to the web result type**

In `app/web/src/registry/registryTypes.ts`, add the field to `RegistrySessionStatusResult` (after `sessionId`):

```ts
export interface RegistrySessionStatusResult {
  ok: boolean;
  sessionId: string;
  agentType?: string;
  context?: RegistrySessionStatusContext;
  limits: RegistrySessionRateLimit[];
  account?: RegistrySessionStatusAccount;
  updatedAt: string;
}
```

- [ ] **Step 4: Parse `agentType` in the repository**

In `app/web/src/registry/RegistryRepository.ts`, add `agentType` to the object returned by `statusSession` (currently line 1545-1556). Insert one line after `sessionId,`:

```ts
    return {
      ok: body.ok === true,
      sessionId,
      agentType: typeof body.agentType === 'string' ? body.agentType : undefined,
      context: this.normalizeSessionStatusContext(body.context),
```

- [ ] **Step 5: Render the agent type row in the dialog**

In `app/web/src/shell/AppDialogs.tsx`, inside `AppSessionStatusDialog`, add the agent row immediately after the `session-status-id` div in the header (currently around line 753-756). Reuse the existing `app-session-status-id` class so it matches the Session ID row's styling:

```tsx
            <div className="app-session-status-id" data-testid="session-status-id">
              <span>Session ID</span>
              <code>{sessionId}</code>
            </div>
            {status?.agentType ? (
              <div className="app-session-status-id" data-testid="session-status-agent">
                <span>Agent</span>
                <code>{status.agentType}</code>
              </div>
            ) : null}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd app && npx jest web-session-status-dialog`
Expected: PASS — all three tests green (the first test passes `status={null}`, so no agent row; the codex test now shows `codex`; the new test shows `claude` and no limits/account).

- [ ] **Step 7: Commit**

```bash
git add app/web/src/registry/registryTypes.ts app/web/src/registry/RegistryRepository.ts app/web/src/shell/AppDialogs.tsx app/__tests__/web-session-status-dialog.test.tsx
git commit -m "feat(app): show agent type in session status dialog

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: Full verification + completion gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full Go test suite**

Run: `cd server && go test ./...`
Expected: PASS — all packages green, including `internal/protocol`, `internal/hub/client`, `internal/hub/agent`.

- [ ] **Step 2: Web type-check and production build**

Run: `cd app && npm run tsc:web && npm run build:web`
Expected: PASS — `tsc:web` reports no type errors; `build:web` completes a clean production build.

- [ ] **Step 3: Run the broader web test suites touched by the change**

Run: `cd app && npx jest web-session-status-dialog web-session-actions-service`
Expected: PASS. `web-session-actions-service` confirms `/status` is enabled for all agents now that the summary reports `status.supported === true` (no code change needed in `chatSessionActions.ts`; it already gates on `status?.supported === true`).

- [ ] **Step 4: Completion gate**

Per the repo `CLAUDE.md` completion gate, from the worktree root:

```bash
git add -A
git commit -m "feat: universal session status for all agents

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" || echo "nothing to commit"
git push origin feat/universal-session-status
```

Then, per the user's git preferences: if local `main` is clean, merge `feat/universal-session-status` into `main`, push `main`, and clean up the worktree/branch. If `main` has unrelated changes (e.g. the in-progress hub-menu work), leave the feature branch pushed and do not merge.

---

## Self-Review Notes

- **Spec coverage:** Universal capability (Task 2), generic no-spawn fallback from `acpSessionID`/`agentType`/`Usage` (Task 3), optional `agentType` protocol field without version bump (Task 1), dialog renders agent type and degrades without limits/account (Task 4), cold/persisted session queryable (Task 3 test asserts `initCalls == 0`), codex unchanged (Task 3 Step 5 regression). All spec acceptance criteria mapped.
- **No placeholders:** every code step contains the actual code; no "TODO"/"similar to"/"add error handling".
- **Type/name consistency:** `AgentType` (Go field) ↔ `agentType` (JSON + TS) used consistently across all tasks; `liveStatusSupported` / `genericSessionStatusResult` / `statusContextFromUsage` defined in Task 3 and not referenced elsewhere; `s.acpSessionID` is the WheelMaker stable id (set once at `newSession`, never reassigned in production) — used in both live and generic paths.
```
