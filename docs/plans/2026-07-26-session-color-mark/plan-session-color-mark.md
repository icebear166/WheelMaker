# Session Color Mark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Hub-persisted, four-color Session Mark that is independent of Pin and appears as a non-layout-consuming trailing marker in Project and Recent session rows.

**Architecture:** Add `session.mark` beside `session.pin` on the existing project-scoped Registry forwarding route. Persist the optional `markColor` in `sessions.session_sync_json`, expose it on active Session summaries, and preserve it across cursor/reload paths while allowing archive/delete to discard it naturally. Normalize and authoritatively merge the field in Web state, then render a menu palette and an absolutely positioned row marker without changing list ordering.

**Tech Stack:** Go 1.26, Registry 2.6, SQLite session sync projection, TypeScript 5.8, React 19, Jest 30, webpack, CSS custom properties.

---

### Task 1: Baseline and Approved Documentation Checkpoint

**Files:**
- Add: `docs/scope/2026-07-26-session-color-mark.md`
- Add: `docs/plans/2026-07-26-session-color-mark/plan-session-color-mark.md`
- Modify: `docs/wiki/frontend-interaction/session-list.md`
- Modify: `docs/wiki/protocols/registry.md`
- Modify: `docs/wiki/architecture/session-management-and-sync.md`

- [x] **Step 1: Verify the focused pre-change test baseline**

Run:

```powershell
Set-Location app
npm test -- --runInBand web-session-actions-service.test.ts web-session-list-schema.test.ts web-chat-session-ordering.test.ts web-chat-project-service.test.ts web/src/chat/sessionlist/SessionMenu.test.tsx web/src/chat/sessionlist/SessionRow.test.tsx web/src/chat/sessionlist/SessionListView.test.tsx
Set-Location ../server
go test ./internal/protocol ./internal/hub ./internal/hub/client
```

Expected: all selected Jest suites and all three Go packages pass before production code changes.

- [x] **Step 2: Check approved docs for wiki and scope invariants**

Run:

```powershell
Set-Location ..
rg -n -i "T[B]D|T[O]DO|implement[ ]later|待[定]|以后[实]现" docs/scope/2026-07-26-session-color-mark.md docs/wiki/frontend-interaction/session-list.md docs/wiki/protocols/registry.md docs/wiki/architecture/session-management-and-sync.md
Get-Content docs/wiki/frontend-interaction/session-list.md -TotalCount 1
Get-Content docs/wiki/protocols/registry.md -TotalCount 1
Get-Content docs/wiki/architecture/session-management-and-sync.md -TotalCount 1
```

Expected: the placeholder search has no matches; each Wiki page begins with `> 摘要：`.

- [x] **Step 3: Commit the approved design checkpoint**

```powershell
git add docs/scope/2026-07-26-session-color-mark.md docs/wiki/frontend-interaction/session-list.md docs/wiki/protocols/registry.md docs/wiki/architecture/session-management-and-sync.md
git commit -m "docs: specify session color marks"
```

Expected: one documentation commit containing the approved spec, implementation plan, and confirmed Wiki updates.

### Task 2: Registry Method and Hub Forwarding

**Files:**
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`

- [x] **Step 1: Write the failing Registry descriptor test**

Add beside `TestSessionPinIsClientProjectForwardWithoutVersionChange`:

```go
func TestSessionMarkIsClientProjectForwardWithoutVersionChange(t *testing.T) {
	if DefaultProtocolVersion != "2.6" {
		t.Fatalf("DefaultProtocolVersion=%q, want 2.6", DefaultProtocolVersion)
	}
	descriptor, ok := RegistryMethod(RegistryMethodSessionMark)
	if !ok {
		t.Fatal("session.mark is not registered")
	}
	if descriptor.Route != RegistryRouteSessionForward || !descriptor.RequiresProjectID {
		t.Fatalf("descriptor=%+v", descriptor)
	}
	if !RegistryMethodAllowed(string(RegistryRoleClient), descriptor.Method) {
		t.Fatal("client role cannot mark a session")
	}
	if RegistryMethodAllowed(string(RegistryRoleHub), descriptor.Method) {
		t.Fatal("hub role can invoke session.mark")
	}
}
```

- [x] **Step 2: Run the descriptor test and verify it fails**

Run:

```powershell
Set-Location server
go test ./internal/protocol -run TestSessionMarkIsClientProjectForwardWithoutVersionChange -count=1
```

Expected: FAIL because `RegistryMethodSessionMark` is undefined.

- [x] **Step 3: Register the method without changing Registry 2.6**

Add the constant next to `RegistryMethodSessionPin` and its descriptor next to the Pin descriptor:

```go
RegistryMethodSessionPin  = "session.pin"
RegistryMethodSessionMark = "session.mark"
```

```go
RegistryMethodSessionPin:  registryProjectMethod(RegistryMethodSessionPin, RegistryRouteSessionForward),
RegistryMethodSessionMark: registryProjectMethod(RegistryMethodSessionMark, RegistryRouteSessionForward),
```

Do not modify `DefaultProtocolVersion`.

- [x] **Step 4: Run the descriptor test and verify it passes**

Run:

```powershell
go test ./internal/protocol -run TestSessionMarkIsClientProjectForwardWithoutVersionChange -count=1
```

Expected: PASS.

- [x] **Step 5: Extend the reporter forwarding test before changing the switch**

In `TestReporterForwardsSessionPinToProjectHandlerAndRequiresProjectID`, rename the test to cover Pin and Mark, increase `respSeen` capacity, and have the fake Registry send this additional request after the successful Pin response:

```go
mustWriteJSON(t, ws, testEnvelope{
	RequestID: 105,
	Type:      "request",
	Method:    rp.RegistryMethodSessionMark,
	ProjectID: "hub-session-pin:proj1",
	Payload: map[string]any{
		"sessionId": "sess-1",
		"markColor": "blue",
	},
})
respSeen <- mustReadEnvelope(t, ws)
```

Move the missing-project request to `RequestID: 106` and make it a `session.mark` request:

```go
mustWriteJSON(t, ws, testEnvelope{
	RequestID: 106,
	Type:      "request",
	Method:    rp.RegistryMethodSessionMark,
	Payload: map[string]any{
		"sessionId": "sess-1",
		"markColor": "",
	},
})
respSeen <- mustReadEnvelope(t, ws)
```

After the existing Pin response assertion, add:

```go
select {
case err := <-errSeen:
	t.Fatalf("fake registry error: %v", err)
case resp := <-respSeen:
	if resp.Type != "response" || resp.Method != rp.RegistryMethodSessionMark || resp.ProjectID != "hub-session-pin:proj1" {
		t.Fatalf("unexpected session.mark response: %#v", resp)
	}
	if target.calls != 2 || target.lastMethod != rp.RegistryMethodSessionMark ||
		target.lastProject != "hub-session-pin:proj1" || !strings.Contains(target.lastBody, `"markColor":"blue"`) {
		t.Fatalf("target handler calls=%d method=%q project=%q body=%q", target.calls, target.lastMethod, target.lastProject, target.lastBody)
	}
	if other.calls != 0 {
		t.Fatalf("other project handler calls=%d, want 0", other.calls)
	}
case <-time.After(2 * time.Second):
	t.Fatal("did not receive session.mark response from reporter")
}
```

Update the final missing-project assertions to expect `target.calls == 2`.

- [x] **Step 6: Run the reporter test and verify it fails**

Run:

```powershell
go test ./internal/hub -run TestReporterForwardsSessionPinAndMarkToProjectHandlerAndRequiresProjectID -count=1
```

Expected: FAIL because `session.mark` is not handled by `Reporter.handleRegistryRequest`.

- [x] **Step 7: Forward `session.mark` through the existing Session handler**

Add `rp.RegistryMethodSessionMark` beside Pin:

```go
rp.RegistryMethodSessionRename, rp.RegistryMethodSessionPin, rp.RegistryMethodSessionMark,
rp.RegistryMethodSessionSend, rp.RegistryMethodSessionCancel,
```

- [x] **Step 8: Run focused protocol and forwarding tests**

Run:

```powershell
go test ./internal/protocol ./internal/hub -run "TestSessionMark|TestReporterForwardsSessionPinAndMark" -count=1
```

Expected: PASS.

- [x] **Step 9: Commit Registry routing**

```powershell
Set-Location ..
git add server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go server/internal/hub/reporter.go server/internal/hub/hub_test.go
git commit -m "feat(server): route session mark requests"
```

### Task 3: Hub Mark Persistence, Validation, and Lifecycle

**Files:**
- Modify: `server/internal/hub/client/session_recorder.go`
- Modify: `server/internal/hub/client/session_recovery.go`
- Modify: `server/internal/hub/client/client.go`
- Modify: `server/internal/hub/client/client_test.go`

- [x] **Step 1: Write failing request and persistence tests**

Add next to the Pin tests:

```go
func TestHandleSessionRequestMarkPersistsSummaryWithoutPublishingUpdate(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-mark", "Marked")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if _, err := c.sessionRecorder.SetSessionPinned(ctx, "sess-mark", true); err != nil {
		t.Fatalf("SetSessionPinned: %v", err)
	}

	var published []string
	c.sessionRecorder.SetEventPublisher(func(method string, _ any) error {
		published = append(published, method)
		return nil
	})
	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMark, "proj1", json.RawMessage(`{"sessionId":"sess-mark","markColor":"red"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.mark): %v", err)
	}
	body := resp.(map[string]any)
	summary := body["session"].(sessionViewSummary)
	if body["ok"] != true || body["sessionId"] != "sess-mark" || summary.MarkColor != "red" || !summary.Pinned {
		t.Fatalf("session.mark response = %#v", body)
	}
	if len(published) != 0 {
		t.Fatalf("published methods = %v, want none", published)
	}

	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMark, "proj1", json.RawMessage(`{"sessionId":"sess-mark","markColor":""}`)); err != nil {
		t.Fatalf("clear session mark: %v", err)
	}
	rec, err := c.store.LoadSession(ctx, "proj1", "sess-mark")
	if err != nil || rec == nil {
		t.Fatalf("LoadSession = %#v, %v", rec, err)
	}
	projection := sessionSyncProjectionFromJSON(rec.SessionSyncJSON)
	if projection.MarkColor != "" || !projection.Pinned {
		t.Fatalf("projection after clear = %#v", projection)
	}
}
```

Add validation and running-session coverage:

```go
func TestHandleSessionRequestMarkValidatesColorScopeAndAllowsRunningSession(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	for _, payload := range []json.RawMessage{
		json.RawMessage(`{"markColor":"red"}`),
		json.RawMessage(`{"sessionId":"missing","markColor":"red"}`),
		json.RawMessage(`{"sessionId":"missing","markColor":"purple"}`),
	} {
	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMark, "proj1", payload); err == nil {
			t.Fatalf("session.mark payload %s unexpectedly succeeded", payload)
		}
	}

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-running-mark", "Running")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMark, "proj1", json.RawMessage(`{"sessionId":"sess-running-mark"}`)); err == nil {
		t.Fatal("session.mark accepted a missing markColor")
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-running-mark", "still running", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMark, "proj1", json.RawMessage(`{"sessionId":"sess-running-mark","markColor":"green"}`))
	if err != nil {
		t.Fatalf("mark running session: %v", err)
	}
	summary := resp.(map[string]any)["session"].(sessionViewSummary)
	if !summary.Running || summary.MarkColor != "green" {
		t.Fatalf("running mark summary = %#v", summary)
	}
}
```

Add exact project-isolation coverage before the running Session setup:

```go
now := time.Now().UTC()
if err := c.store.SaveSession(ctx, &SessionRecord{
	ID:              "same-mark-id",
	ProjectName:     "proj2",
	Status:          SessionPersisted,
	AgentType:       "claude",
	AgentJSON:       `{}`,
	SessionSyncJSON: sessionSyncJSON(0),
	CreatedAt:       now,
	LastActiveAt:    now,
}); err != nil {
	t.Fatalf("SaveSession other project: %v", err)
}
if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMark, "proj2", json.RawMessage(`{"sessionId":"same-mark-id","markColor":"blue"}`)); err == nil {
	t.Fatal("session.mark crossed the client project scope")
}
```

- [x] **Step 2: Run the new Hub tests and verify they fail**

Run:

```powershell
Set-Location server
go test ./internal/hub/client -run "TestHandleSessionRequestMark" -count=1
```

Expected: FAIL because the method, fields, and setter do not exist.

- [x] **Step 3: Add Mark to the sync projection and summary**

Add the fields:

```go
type sessionViewSummary struct {
	// existing fields
	Pinned    bool   `json:"pinned"`
	MarkColor string `json:"markColor,omitempty"`
	// existing fields
}
```

```go
type sessionSyncProjection struct {
	// existing fields
	Pinned    bool   `json:"pinned,omitempty"`
	MarkColor string `json:"markColor,omitempty"`
	// existing fields
}
```

Copy it into summaries:

```go
summary.Pinned = projection.Pinned
summary.MarkColor = projection.MarkColor
```

- [x] **Step 4: Add exact enum validation and persistence**

Add beside `SetSessionPinned`; do not trim `markColor` because only exact wire values are accepted:

```go
func validateSessionMarkColor(markColor string) error {
	switch markColor {
	case "", "red", "yellow", "green", "blue":
		return nil
	default:
		return fmt.Errorf("invalid markColor: %q", markColor)
	}
}

func (r *SessionRecorder) SetSessionMarkColor(ctx context.Context, sessionID, markColor string) (sessionViewSummary, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return sessionViewSummary{}, fmt.Errorf("sessionId is required")
	}
	if err := validateSessionMarkColor(markColor); err != nil {
		return sessionViewSummary{}, err
	}
	rec, err := r.store.LoadSession(ctx, r.projectName, sessionID)
	if err != nil {
		return sessionViewSummary{}, err
	}
	if rec == nil {
		return sessionViewSummary{}, fmt.Errorf("session not found: %s", sessionID)
	}
	projection := sessionSyncProjectionFromJSON(rec.SessionSyncJSON)
	projection.MarkColor = markColor
	rec.SessionSyncJSON = sessionSyncProjectionJSON(projection)
	if err := r.store.SaveSession(ctx, rec); err != nil {
		return sessionViewSummary{}, err
	}
	return r.sessionViewSummaryFromRecord(*rec), nil
}
```

- [x] **Step 5: Handle `session.mark` in the client**

Add next to the Pin case:

```go
case acp.RegistryMethodSessionMark:
	var req struct {
		SessionID string  `json:"sessionId"`
		MarkColor *string `json:"markColor"`
	}
	if err := decodeSessionRequestPayload(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid session.mark payload: %w", err)
	}
	if req.MarkColor == nil {
		return nil, fmt.Errorf("markColor is required")
	}
	summary, err := c.sessionRecorder.SetSessionMarkColor(ctx, req.SessionID, *req.MarkColor)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "sessionId": summary.SessionID, "session": summary}, nil
```

- [x] **Step 6: Run request tests and verify they pass**

Run:

```powershell
go test ./internal/hub/client -run "TestHandleSessionRequestMark" -count=1
```

Expected: PASS.

- [x] **Step 7: Write failing preservation and archive/restore assertions**

Extend `TestSessionPinSurvivesCursorUpdatesAndRecorderRebuild` to set a blue Mark and require both values after cursor updates and recorder rebuild:

```go
if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMark, "proj1", json.RawMessage(`{"sessionId":"sess-rebuild","markColor":"blue"}`)); err != nil {
	t.Fatalf("mark session: %v", err)
}
```

```go
if !projection.Pinned || projection.MarkColor != "blue" ||
	projection.LastReadTurnIndex != 2 || projection.LatestPersistedTurnIndex != 2 {
	t.Fatalf("stored projection = %#v", projection)
}
if !summary.Pinned || summary.MarkColor != "blue" {
	t.Fatalf("rebuilt summary = %#v", summary)
}
```

In the reload-failure test, seed and require Mark preservation:

```go
SessionSyncJSON: sessionSyncProjectionJSON(sessionSyncProjection{
	LatestPersistedTurnIndex: 4,
	Pinned:                   true,
	MarkColor:                "yellow",
}),
```

```go
if !projection.Pinned || projection.MarkColor != "yellow" ||
	projection.LatestPersistedTurnIndex != 0 || projection.LastReadTurnIndex != 0 {
	t.Fatalf("projection after reload failure = %#v, want pin and mark only", projection)
}
```

In `TestHandleSessionRequestSessionArchiveWritesPackAndDeletesActiveSession`, set Mark before the archive request:

```go
if _, err := c.sessionRecorder.SetSessionMarkColor(ctx, "sess-archive", "green"); err != nil {
	t.Fatalf("SetSessionMarkColor: %v", err)
}
```

Seed the existing delete test with both active metadata values:

```go
SessionSyncJSON: sessionSyncProjectionJSON(sessionSyncProjection{
	LatestPersistedTurnIndex: 3,
	Pinned:                   true,
	MarkColor:                "red",
}),
```

The existing assertion that the stored Session row is gone then proves delete cannot retain either metadata value. In the restore test, require:

```go
if summary.Pinned || summary.MarkColor != "" {
	t.Fatalf("restore summary = %#v, want unpinned and unmarked", summary)
}
```

- [x] **Step 8: Run lifecycle tests and verify reload preservation fails**

Run:

```powershell
go test ./internal/hub/client -run "TestSessionPinSurvivesCursorUpdatesAndRecorderRebuild|TestHandleSessionRequestSessionReload|TestHandleSessionRequestSessionArchive" -count=1
```

Expected: the reload preservation assertion fails because reload currently copies only `Pinned`.

- [x] **Step 9: Preserve Mark during reload cursor reset**

Update `sessionRecovery.ReloadSession`:

```go
projection := sessionSyncProjectionFromJSON(rec.SessionSyncJSON)
rec.SessionSyncJSON = sessionSyncProjectionJSON(sessionSyncProjection{
	Pinned:    projection.Pinned,
	MarkColor: projection.MarkColor,
})
```

Do not copy Mark into archive manifests or restored projections.

- [x] **Step 10: Run the complete client package**

Run:

```powershell
go test ./internal/hub/client -count=1
```

Expected: PASS.

- [x] **Step 11: Commit Hub persistence**

```powershell
Set-Location ..
git add server/internal/hub/client/session_recorder.go server/internal/hub/client/session_recovery.go server/internal/hub/client/client.go server/internal/hub/client/client_test.go
git commit -m "feat(server): persist session color marks"
```

### Task 4: Web Protocol Normalization and Authoritative State Merge

**Files:**
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/web/src/chat/session/chatSessionOrdering.ts`
- Modify: `app/__tests__/web-session-actions-service.test.ts`
- Modify: `app/__tests__/web-session-list-schema.test.ts`
- Modify: `app/__tests__/web-chat-project-service.test.ts`
- Modify: `app/__tests__/web-chat-session-ordering.test.ts`

- [x] **Step 1: Write failing repository and service tests**

Add to `web-session-actions-service.test.ts`:

```ts
test('requests session mark and normalizes the four shared colors', async () => {
  const request = jest.fn().mockResolvedValue({
    payload: {
      ok: true,
      sessionId: 's1',
      session: {
        sessionId: 's1',
        title: 'One',
        preview: '',
        updatedAt: '2026-07-26T10:00:00Z',
        messageCount: 1,
        pinned: false,
        markColor: 'blue',
      },
    },
  });
  const repository = new RegistryRepository({request} as never);

  const result = await repository.markSession('project-a', 's1', 'blue');

  expect(request).toHaveBeenCalledWith({
    method: RegistryMethods.SessionMark,
    projectId: 'project-a',
    payload: {sessionId: 's1', markColor: 'blue'},
    timeoutMs: 15000,
  });
  expect(result.session.markColor).toBe('blue');
  expect(result.session.pinned).toBe(false);
  expect(RegistryProtocolVersion).toBe('2.6');
});

test('normalizes cleared and unknown session marks to undefined', async () => {
  const request = jest.fn()
    .mockResolvedValueOnce({
      payload: {
        ok: true,
        session: {sessionId: 's1', title: 'One', preview: '', updatedAt: '', messageCount: 1},
      },
    })
    .mockResolvedValueOnce({
      payload: {
        ok: true,
        session: {sessionId: 's1', title: 'One', preview: '', updatedAt: '', messageCount: 1, markColor: 'purple'},
      },
    });
  const repository = new RegistryRepository({request} as never);

  await expect(repository.markSession('project-a', 's1', '')).resolves.toMatchObject({
    session: {markColor: undefined},
  });
  await expect(repository.markSession('project-a', 's1', 'red')).resolves.toMatchObject({
    session: {markColor: undefined},
  });
});
```

Extend the project-scoped service mock and assertions:

```ts
markSession: jest.fn().mockResolvedValue({
  ok: true,
  sessionId: 's1',
  session: {sessionId: 's1', markColor: 'green', updatedAt: ''},
}),
```

```ts
await (service as any).markProjectSession('chat-project', 's1', 'green');
expect(repository.markSession).toHaveBeenCalledWith('chat-project', 's1', 'green');
```

- [x] **Step 2: Write failing authoritative merge tests**

Add to `web-chat-session-ordering.test.ts`:

```ts
test('updates and authoritatively clears mark without changing order or pin', () => {
  const existing = [
    {...session('a', '2026-07-22T12:00:00Z'), pinned: true, markColor: 'red' as const},
    session('b', '2026-07-21T12:00:00Z'),
  ];

  const changed = mergeChatSession(existing, {sessionId: 'a', markColor: 'blue'});
  expect(changed.map(item => item.sessionId)).toEqual(['a', 'b']);
  expect(changed[0]).toMatchObject({pinned: true, markColor: 'blue'});

  const cleared = mergeChatSession(changed, {sessionId: 'a', markColor: undefined});
  expect(cleared.map(item => item.sessionId)).toEqual(['a', 'b']);
  expect(cleared[0].pinned).toBe(true);
  expect(cleared[0].markColor).toBeUndefined();
});

test('preserves mark when an unrelated partial patch omits it', () => {
  const merged = mergeChatSession(
    [{...session('s1', '2026-07-22T12:00:00Z'), markColor: 'green'}],
    {sessionId: 's1', preview: 'patched'},
  );
  expect(merged[0].markColor).toBe('green');
});
```

- [x] **Step 3: Run focused Web tests and verify they fail**

Run:

```powershell
Set-Location app
npm test -- --runInBand web-session-actions-service.test.ts web-chat-project-service.test.ts web-chat-session-ordering.test.ts
```

Expected: FAIL because the method, type, normalization, and merge behavior do not exist.

- [x] **Step 4: Add the Web Registry method and mark type**

In `registryMethods.ts`:

```ts
SessionPin: 'session.pin',
SessionMark: 'session.mark',
```

In `registryTypes.ts`:

```ts
export type RegistrySessionMarkColor = 'red' | 'yellow' | 'green' | 'blue';
```

```ts
pinned?: boolean;
markColor?: RegistrySessionMarkColor;
```

- [x] **Step 5: Normalize only allowed Mark values and strip active metadata from archives**

Add to `RegistryRepository`:

```ts
private normalizeSessionMarkColor(raw: unknown): RegistrySessionSummary['markColor'] {
  switch (raw) {
    case 'red':
    case 'yellow':
    case 'green':
    case 'blue':
      return raw;
    default:
      return undefined;
  }
}
```

Include this property in `normalizeSessionSummary`:

```ts
markColor: this.normalizeSessionMarkColor(input.markColor),
```

Strip both active-only fields from archived summaries:

```ts
const {
  pinned: _activeSessionPin,
  markColor: _activeSessionMark,
  ...archivedBase
} = base;
```

- [x] **Step 6: Add repository and project-scoped service methods**

```ts
async markSession(
  projectId: string,
  sessionId: string,
  markColor: RegistrySessionMarkColor | '',
): Promise<{ok: boolean; sessionId: string; session: RegistrySessionSummary}> {
  const resp = await this.client.request({
    method: RegistryMethods.SessionMark,
    projectId,
    payload: {sessionId, markColor},
    timeoutMs: 15000,
  });
  const body = (resp.payload ?? {}) as {ok?: boolean; sessionId?: string; session?: unknown};
  const session = this.normalizeSessionSummary(body.session) ?? {
    sessionId,
    title: '',
    preview: '',
    updatedAt: '',
    messageCount: 0,
    markColor: markColor || undefined,
  };
  return {
    ok: body.ok ?? false,
    sessionId: body.sessionId ?? session.sessionId ?? sessionId,
    session,
  };
}
```

```ts
async markProjectSession(
  projectId: string,
  sessionId: string,
  markColor: RegistrySessionMarkColor | '',
): Promise<{ok: boolean; sessionId: string; session: RegistrySessionSummary}> {
  if (!this.repository) {
    throw new Error('session is not ready');
  }
  return this.repository.markSession(projectId, sessionId, markColor);
}
```

Import `RegistrySessionMarkColor` as a type in both files.

- [x] **Step 7: Implement authoritative clear without affecting sorting**

In `mergeSessionSummary`, detect whether the partial object owns the field:

```ts
const hasMarkColor = Object.prototype.hasOwnProperty.call(next, 'markColor');
```

Add to the returned summary:

```ts
markColor: hasMarkColor ? next.markColor : existing?.markColor,
```

Do not add `markColor` to `sortProjectChatSessions` or `orderChanged`; a mark-only patch should follow the existing fast path and replace the item in place.

- [x] **Step 8: Extend the schema contract test**

Add exact expectations:

```ts
expect(repositoryTs).toContain('markColor: this.normalizeSessionMarkColor(input.markColor)');
expect(repositoryTs).toContain('RegistryMethods.SessionMark');
expect(serviceTs).toContain('async markProjectSession(');
expect(registryTypes).toContain("export type RegistrySessionMarkColor = 'red' | 'yellow' | 'green' | 'blue';");
expect(registryTypes).toContain('markColor?: RegistrySessionMarkColor;');
```

- [x] **Step 9: Run Web data tests**

Run:

```powershell
npm test -- --runInBand web-session-actions-service.test.ts web-session-list-schema.test.ts web-chat-project-service.test.ts web-chat-session-ordering.test.ts
npm run tsc:web
```

Expected: PASS.

- [x] **Step 10: Commit Web data flow**

```powershell
Set-Location ..
git add app/web/src/registry app/web/src/chat/session/chatSessionOrdering.ts app/__tests__/web-session-actions-service.test.ts app/__tests__/web-session-list-schema.test.ts app/__tests__/web-chat-project-service.test.ts app/__tests__/web-chat-session-ordering.test.ts
git commit -m "feat(app): sync session color marks"
```

### Task 5: Mark Palette and Non-Compressing Row Marker

**Files:**
- Create: `app/web/src/chat/sessionlist/sessionMark.ts`
- Modify: `app/web/src/chat/sessionlist/SessionMenu.tsx`
- Modify: `app/web/src/chat/sessionlist/SessionMenu.test.tsx`
- Modify: `app/web/src/chat/sessionlist/SessionRow.tsx`
- Modify: `app/web/src/chat/sessionlist/SessionRow.test.tsx`
- Modify: `app/web/src/chat/sessionlist/SessionListView.tsx`
- Modify: `app/web/src/chat/sessionlist/SessionListView.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/sessionlist.css`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-chat-recent-sessions-ui.test.ts`

- [x] **Step 1: Use the existing verified Ban icon**

Read the `better-icons` skill before UI edits. Confirm `app/web/src/common/Icon.tsx` already contains the `lucide:ban` glyph and use `SessionIcon name="ban"`; do not add a duplicate SVG.

- [x] **Step 2: Write failing SessionMenu palette tests**

Extend the test defaults:

```ts
markColor: undefined,
marking: false,
onSetMark: jest.fn(),
```

Add:

```ts
it('renders four circular mark colors and a matching clear control after Pin', async () => {
  const {tree} = await renderMenu({markColor: 'yellow'});
  const picker = tree.root.findByProps({className: 'project-session-mark-picker'});
  const options = picker.findAllByProps({role: 'menuitemradio'});
  expect(options.map(option => option.props['aria-label'])).toEqual([
    'Mark red',
    'Mark yellow',
    'Mark green',
    'Mark blue',
    'Clear mark',
  ]);
  expect(options.map(option => option.props.className)).toEqual(expect.arrayContaining([
    expect.stringContaining('session-mark-red'),
    expect.stringContaining('session-mark-yellow'),
    expect.stringContaining('session-mark-green'),
    expect.stringContaining('session-mark-blue'),
    expect.stringContaining('project-session-mark-clear'),
  ]));
  expect(options[1].props['aria-checked']).toBe(true);
  expect(options[4].findByProps({'data-icon-name': 'ban'})).toBeTruthy();
});

it('routes a mark color and disables the whole palette while marking', async () => {
  const {tree, props} = await renderMenu();
  const blue = tree.root.findByProps({'aria-label': 'Mark blue'});
  await act(async () => {
    blue.props.onClick({stopPropagation: jest.fn()});
  });
  expect(props.onSetMark).toHaveBeenCalledWith('blue');

  const busy = await renderMenu({marking: true});
  expect(busy.tree.root.findAllByProps({role: 'menuitemradio'}).every(item => item.props.disabled)).toBe(true);
});
```

Update the label-order test to assert the normal action labels still remain `Pin`, `Rename`, `Archive`, `Reload`, `Delete`, and separately assert the Mark picker sits after the Pin button in the menu children.

- [x] **Step 3: Write failing SessionRow and SessionListView tests**

Add to `SessionRow.test.tsx`:

```ts
it('renders a non-interactive trailing mark for pinned and unpinned rows', async () => {
  const unpinned = await renderRow({markColor: 'red'});
  const unpinnedMark = unpinned.tree().root.findByProps({
    className: 'wide-session-mark session-mark-red',
  });
  expect(unpinnedMark.props.role).toBe('img');
  expect(unpinnedMark.props['aria-label']).toBe('Red mark');
  expect(unpinned.tree().root.findAllByType('button')).toHaveLength(1);

  const pinned = await renderRow({pinned: true, markColor: 'blue'});
  expect(pinned.tree().root.findByProps({
    className: 'wide-session-mark session-mark-blue',
  })).toBeTruthy();
  expect(pinned.tree().root.findAllByType('button')).toHaveLength(2);
});
```

Add to `SessionListView.test.tsx`:

```ts
it('passes the same mark metadata through project and Recent rows', async () => {
  const marked = {
    sessionId: 's1',
    title: 'Fix bug',
    agentType: 'kimi',
    updatedAt: '2026-07-24T00:00:00Z',
    markColor: 'green' as const,
  };
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(<SessionListView {...makeProps({
      sessionsByProjectId: {p1: [marked], p2: []},
      recentGroups: [{
        projectId: 'p1',
        projectName: 'WheelMaker',
        hubLabel: 'local',
        hubVariantClass: 'wide-project-hub variant-0',
        hubAccentStyle: {'--hub-accent': '#58a6ff'} as React.CSSProperties,
        sessions: [marked],
      }],
    })} />);
  });
  expect(tree!.root.findAllByProps({
    className: 'wide-session-mark session-mark-green',
  })).toHaveLength(2);
});
```

- [x] **Step 4: Run component tests and verify they fail**

Run:

```powershell
Set-Location app
npm test -- --runInBand web/src/chat/sessionlist/SessionMenu.test.tsx web/src/chat/sessionlist/SessionRow.test.tsx web/src/chat/sessionlist/SessionListView.test.tsx
```

Expected: FAIL because Mark props and elements do not exist.

- [x] **Step 5: Add shared palette metadata**

Create `sessionMark.ts`:

```ts
import type {RegistrySessionMarkColor} from '../../registry/registryTypes';

export const SESSION_MARK_OPTIONS: ReadonlyArray<{
  color: RegistrySessionMarkColor;
  label: string;
}> = [
  {color: 'red', label: 'Red'},
  {color: 'yellow', label: 'Yellow'},
  {color: 'green', label: 'Green'},
  {color: 'blue', label: 'Blue'},
];

export function sessionMarkColorClass(markColor: RegistrySessionMarkColor): string {
  return `session-mark-${markColor}`;
}
```

- [x] **Step 6: Render the menu palette after Pin**

Add these props:

```ts
markColor?: RegistrySessionMarkColor;
marking: boolean;
onSetMark: (markColor: RegistrySessionMarkColor | '') => void;
```

Extend the item union and place a sentinel immediately after Pin:

```ts
const items: Array<MenuItem | 'mark' | 'separator'> = [
  {key: 'pin', className: 'pin', icon: 'pin', label: pinned ? 'Unpin' : 'Pin', disabled: pinning, busy: pinning, onSelect: onTogglePin},
  'mark',
  {key: 'rename', className: 'rename', icon: 'pencil', label: 'Rename', disabled: renaming, busy: renaming, onSelect: onRename},
  {key: 'archive', className: 'archive', icon: 'archive', label: 'Archive', disabled: actionDisabled, busy: archiving, onSelect: onArchive},
  'separator',
  {key: 'reload', className: 'reload', icon: 'refreshCw', label: 'Reload', disabled: actionDisabled, busy: reloading, onSelect: onReload},
  {key: 'delete', className: 'delete', icon: 'trash', label: 'Delete', disabled: actionDisabled, busy: deleting, onSelect: onDelete},
];
```

Replace the existing item map with:

```tsx
{items.map(item =>
  item === 'mark' ? (
    <div key="mark" className="project-session-mark-picker" role="group" aria-label="Mark session">
      <span className="project-session-mark-label">Mark</span>
      <span className="project-session-mark-options">
        {SESSION_MARK_OPTIONS.map(option => (
          <button
            key={option.color}
            type="button"
            className={`project-session-mark-option ${sessionMarkColorClass(option.color)}`}
            role="menuitemradio"
            aria-label={`Mark ${option.color}`}
            aria-checked={markColor === option.color}
            disabled={marking}
            onClick={event => {
              event.stopPropagation();
              onSetMark(option.color);
            }}
          >
            <span className="project-session-mark-swatch" aria-hidden="true" />
          </button>
        ))}
        <button
          type="button"
          className="project-session-mark-option project-session-mark-clear"
          role="menuitemradio"
          aria-label="Clear mark"
          aria-checked={!markColor}
          disabled={marking}
          onClick={event => {
            event.stopPropagation();
            onSetMark('');
          }}
        >
          <SessionIcon name="ban" size={12} />
        </button>
      </span>
    </div>
  ) : item === 'separator' ? (
    <div key="separator" className="project-session-menu-separator" aria-hidden="true" />
  ) : (
    <button
      key={item.key}
      type="button"
      className={`project-session-menu-btn ${item.className}`}
      role="menuitem"
      disabled={item.disabled}
      onClick={event => {
        event.stopPropagation();
        item.onSelect();
      }}
    >
      {item.busy ? <SessionIcon name="loader" spin /> : <SessionIcon name={item.icon} />}
      <span className="project-session-menu-label">{item.label}</span>
    </button>
  ),
)}
```

Keep the existing Pin, Rename, Archive, Reload, and Delete item array and keyboard handler.

- [x] **Step 7: Render the non-interactive row marker**

Add `markColor?: RegistrySessionMarkColor` to `SessionRowProps`, and render after the Pin button:

```tsx
{markColor ? (
  <span
    className={`wide-session-mark ${sessionMarkColorClass(markColor)}`}
    role="img"
    aria-label={`${markColor[0].toUpperCase()}${markColor.slice(1)} mark`}
  />
) : null}
```

Add `markColor?: RegistrySessionMarkColor` to `SessionListView`'s `AnySession` and pass:

```tsx
markColor={session.markColor}
```

- [x] **Step 8: Add layout-neutral CSS and theme-aware colors**

Use the existing state tokens:

```css
.session-mark-red { --session-mark-color: var(--state-danger); }
.session-mark-yellow { --session-mark-color: var(--state-warning); }
.session-mark-green { --session-mark-color: var(--state-success); }
.session-mark-blue { --session-mark-color: var(--state-info); }

.wide-session-mark {
  position: absolute;
  top: 50%;
  right: 1px;
  width: 3px;
  height: 14px;
  border-radius: 999px;
  background: var(--session-mark-color);
  transform: translateY(-50%);
  pointer-events: none;
}

.project-session-mark-picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 30px;
  padding: 4px 8px;
  color: var(--text-secondary);
}
.project-session-mark-label {
  font-size: 12px;
}
.project-session-mark-options {
  display: flex;
  align-items: center;
  gap: 4px;
}
.project-session-mark-option {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 50%;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
}
.project-session-mark-option[aria-checked="true"] {
  border-color: var(--session-mark-color, var(--text-secondary));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--session-mark-color, var(--text-secondary)) 24%, transparent);
}
.project-session-mark-option:disabled {
  opacity: 0.45;
  cursor: default;
}
.project-session-mark-swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--session-mark-color);
}
```

Increase `.project-session-action-menu` minimum width only enough to hold `Mark` plus five 20px controls. Do not add row padding, margin, flex children, or reserved width for `.wide-session-mark`.

- [x] **Step 9: Wire the project action handler and request state**

Import `RegistrySessionMarkColor`. Add state beside Pin:

```ts
const [chatMarkingSessionKey, setChatMarkingSessionKey] = useState('');
```

Add a handler parallel to Pin:

```ts
const handleMarkProjectSession = async (
  targetProjectId: string,
  sessionId: string,
  markColor: RegistrySessionMarkColor | '',
) => {
  const normalizedSessionId = sessionId.trim();
  const actionKey = projectSessionActionKey(targetProjectId, normalizedSessionId);
  if (!targetProjectId || !normalizedSessionId || chatMarkingSessionKey === actionKey) {
    return;
  }
  setError('');
  setChatMarkingSessionKey(actionKey);
  try {
    const result = await service.markProjectSession(targetProjectId, normalizedSessionId, markColor);
    if (!result.ok) {
      throw new Error('session.mark returned ok=false');
    }
    rememberChatSessionSummary(targetProjectId, result.session);
    const runtimeKey = buildChatRuntimeKey(targetProjectId, result.session.sessionId);
    workspaceStore.rememberChatSession(
      targetProjectId,
      mergeKnownChatSessionForProject(targetProjectId, result.session),
      {turnIndex: chatFinishedCursorRef.current[runtimeKey] ?? 0},
    );
    setProjectSessionActionMenu(null);
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    setChatMarkingSessionKey(current => current === actionKey ? '' : current);
  }
};
```

Pass into `SessionMenu`:

```tsx
markColor={session.markColor}
marking={chatMarkingSessionKey === projectSessionActionKey(targetProjectId, sessionId)}
onSetMark={markColor => {
  handleMarkProjectSession(targetProjectId, sessionId, markColor).catch(() => undefined);
}}
```

No Mark state or callback is needed on `SessionListView` because its marker is display-only and the existing context menu owns all actions.

- [x] **Step 10: Add UI contract assertions**

Update `web-chat-ui.test.ts` and `web-chat-recent-sessions-ui.test.ts` to require:

```ts
expect(mainTsx).toContain('service.markProjectSession(targetProjectId, normalizedSessionId, markColor)');
expect(mainTsx).toContain('markColor={session.markColor}');
expect(mainTsx).toContain('marking={chatMarkingSessionKey === projectSessionActionKey(targetProjectId, sessionId)}');
expect(listViewTsx).toContain('markColor={session.markColor}');
```

Use CSS rule extraction for the layout assertion instead of searching `SessionRow.tsx` for CSS:

```ts
const markRule = stylesCss.match(/\.wide-session-mark \{[\s\S]*?\n\}/)?.[0] ?? '';
expect(markRule).toContain('position: absolute;');
expect(markRule).toContain('right: 1px;');
expect(markRule).not.toContain('margin');
expect(markRule).not.toContain('padding');
expect(markRule).not.toContain('flex:');
```

- [x] **Step 11: Run component, UI contract, and type tests**

Run:

```powershell
npm test -- --runInBand web/src/chat/sessionlist/SessionMenu.test.tsx web/src/chat/sessionlist/SessionRow.test.tsx web/src/chat/sessionlist/SessionListView.test.tsx web-chat-ui.test.ts web-chat-recent-sessions-ui.test.ts
npm run tsc:web
```

Expected: PASS.

- [x] **Step 12: Commit the UI**

```powershell
Set-Location ..
git add app/web/src/chat/sessionlist app/web/src/app/WorkspaceApp.tsx app/web/src/styles/sessionlist.css app/__tests__/web-chat-ui.test.ts app/__tests__/web-chat-recent-sessions-ui.test.ts
git commit -m "feat(app): add session mark palette"
```

### Task 6: Full Verification and Git Delivery

**Files:**
- Modify: `docs/plans/2026-07-26-session-color-mark/plan-session-color-mark.md`

- [x] **Step 1: Format Go files and check the diff**

Run:

```powershell
gofmt -w server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go server/internal/hub/reporter.go server/internal/hub/hub_test.go server/internal/hub/client/session_recorder.go server/internal/hub/client/session_recovery.go server/internal/hub/client/client.go server/internal/hub/client/client_test.go
git diff --check
git status --short
```

Expected: no formatting or whitespace errors; only intended task files are modified.

- [x] **Step 2: Run the complete Web test suite and checks**

Run:

```powershell
Set-Location app
npm test -- --runInBand
npm run tsc:web
npm run build:web
```

Expected: all Jest suites pass, TypeScript exits 0, and the production Web build completes into `~/.wheelmaker/web`.

- [x] **Step 3: Run the complete Go test suite**

Run:

```powershell
Set-Location ../server
go test ./...
```

Expected: all Go packages pass.

- [x] **Step 4: Recheck spec acceptance and protocol version**

Run:

```powershell
Set-Location ..
rg -n "session.mark|markColor" server/internal app/web/src docs/wiki docs/scope/2026-07-26-session-color-mark.md
rg -n 'DefaultProtocolVersion.*2\.6|RegistryProtocolVersion = .2\.6.' server/internal/protocol app/web/src/registry
git diff --check
```

Expected: all implementation layers contain the new method/field and Registry remains 2.6.

- [x] **Step 5: Sync the feature branch before the final commit**

Run:

```powershell
git fetch origin main
git rebase origin/main
```

Expected: clean rebase or fast-forward. Resolve only mechanical conflicts; stop for user input if a semantic conflict exists.

- [x] **Step 6: Record verification in this plan**

Check every completed `- [ ]` item to `- [x]` and append a short `## Verification` section listing the exact successful Jest, TypeScript, webpack, and Go commands. This is the final tracked change reserved for the completion commit.

- [x] **Step 7: Execute the repository completion gate**

Run this exact tail sequence:

```powershell
git add -A
git commit -m "docs: record session mark verification"
git push origin feature-session-color-mark
```

Expected: the final verification commit is created and `feature-session-color-mark` is pushed successfully. Do not claim completion if any command fails.

- [x] **Step 8: Apply the configured merge and cleanup policy**

Inspect the main worktree. If it is clean, merge the feature branch into `main`, push `main`, then remove the clean feature worktree and local/remote feature branches without deleting `main`. If the main worktree contains user changes, leave the pushed feature branch/worktree intact and report that merge was deferred.

## Verification

- Focused UI and contract tests: `Set-Location app; npm test -- --runInBand web/src/chat/sessionlist/SessionMenu.test.tsx web/src/chat/sessionlist/SessionRow.test.tsx web/src/chat/sessionlist/SessionListView.test.tsx __tests__/web-chat-ui.test.ts __tests__/web-chat-recent-sessions-ui.test.ts` — 5 suites and 89 tests passed.
- Complete Web suite: `Set-Location app; npm test -- --runInBand` — 230 suites and 1315 tests passed after rebasing onto `origin/main`.
- Web type check: `Set-Location app; npm run tsc:web` — passed after the rebase.
- Production Web build: `Set-Location app; npm run build:web` — webpack completed successfully after the rebase; only the existing bundle-size/deoptimized-code-generator notices were emitted.
- Complete Go suite: `Set-Location server; go test ./...` — all packages passed after the rebase.
- Formatting and whitespace: the changed Go files were formatted with `gofmt`; `git diff --check` passed.
- Protocol check: the new `session.mark` method is registered and forwarded while the Go `DefaultProtocolVersion` and Web `RegistryProtocolVersion` both remain `2.6`.
- UI refinement: the palette retains the existing 148px menu width by presenting the five equal circular controls directly below Pin; the trailing row mark remains absolutely positioned and consumes no layout width.
- Branch sync: the five implementation commits rebased cleanly onto `origin/main` at `cac87879`.
- Merge policy: merge and cleanup are deferred because the main worktree contains an existing `WorkspaceApp.tsx` modification and an untracked scope-document directory; the feature worktree and branch are preserved.
