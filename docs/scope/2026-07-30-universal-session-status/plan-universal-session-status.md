# Universal Session Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/status` a universal, provider-independent view of the current WheelMaker session—stable session id, agent type, and session token usage—with one-click session-id copy and no agent subprocess or provider limits request.

**Architecture:** Both session-action capability gates always allow status. `Session.SessionStatus` takes one locked snapshot of `s.acpSessionID`, `s.agentType`, and `s.agentState.Usage` and returns it with `limits: []`; it never touches the agent factory, instance, `SessionStatusProvider`, Monitor, or HubState. The Web dialog renders the same Session ID/Agent/Context layout for every provider, ignores legacy limits/account fields, and copies the exact session id through the existing clipboard abstraction.

**Tech Stack:** Go (`server/internal/protocol`, `server/internal/hub/client`, `server/internal/hub/agent`), TypeScript/React (`app/web`), SQLite-backed session tests, Jest + react-test-renderer, `go test`.

---

## Execution Preconditions

- Work only in `D:\Code\WheelMaker\.worktree\feat\universal-session-status` on branch `feat/universal-session-status`.
- Read the root, `server/`, and `app/` `CLAUDE.md` files before implementation.
- The plan was rewritten against current `main` at `560ed9ed`. Do not implement against the worktree's old base `84609d23`. Before Task 1, commit the reviewed spec/plan documentation, fetch `origin`, and rebase the feature branch onto current `origin/main` according to `docs/user/git-preferences.md`. If updating the already-published feature branch would require a force push, stop and obtain explicit approval before `--force-with-lease`.
- Run Go commands from `server/` and Web commands from `app/`.
- Do not change the registry protocol version.
- Keep Monitor/HubState `tokenStats` code out of scope.

## File Structure

**Protocol contract**

- Modify `server/internal/protocol/session_actions.go` — add optional `AgentType` while retaining legacy `Limits`/`Account` response fields for wire compatibility.
- Modify `server/internal/protocol/registry_methods_test.go` — test `agentType` JSON behavior and the required empty-array shape of `limits`.

**Universal capability and local session snapshot**

- Modify `server/internal/hub/client/client.go` — make the summary and dispatch status gates universal.
- Modify `server/internal/hub/client/session.go` — replace live provider status with one session-local snapshot.
- Modify `server/internal/hub/client/client_test.go` — cover known/unknown agents, nil registry, persisted usage, exact empty limits, and zero creator/initialize/provider-status calls.

**Remove the retired provider-status path**

- Modify `server/internal/hub/agent/factory.go` — remove provider-level `SessionActionSupport.Status` and status registrations.
- Modify `server/internal/hub/agent/instance.go` — remove `SessionStatusProvider` and `instance.SessionStatus`.
- Modify `server/internal/hub/agent/codexapp_agent.go` — remove the session-status `account/rateLimits/read` adapter.
- Modify `server/internal/hub/agent/codexapp_convert.go` — remove its now-dead response types and normalization helpers.
- Modify `server/internal/hub/agent/agent_test.go` — remove the retired rate-limit adapter test and update factory action assertions.

**Web normalization and uniform dialog**

- Modify `app/web/src/registry/registryTypes.ts` — add optional `agentType` to `RegistrySessionStatusResult`.
- Modify `app/web/src/registry/RegistryRepository.ts` — normalize `agentType` while retaining tolerant legacy field parsing.
- Modify `app/web/src/shell/AppDialogs.tsx` — render Session ID/Agent/Context only, add copy button, and use generic loading text.
- Modify `app/web/src/styles/shell.css` — style the copy affordance and remove dead rate-limit/account dialog styles.
- Modify `app/web/src/chat/session/chatSessionActions.ts` — remove rate-limit wording from `/status`.
- Modify `app/__tests__/web-session-actions-service.test.ts` — verify repository normalization of `agentType` and empty limits.
- Modify `app/__tests__/web-session-status-dialog.test.tsx` — verify uniform rendering, ignored legacy limits/account, generic loading text, accessibility, and clipboard behavior.
- Modify `app/__tests__/web-chat-session-actions.test.ts` — verify the provider-neutral slash description.

## Task 1: Extend the session status response contract

**Files:**

- Modify: `server/internal/protocol/session_actions.go` (`SessionActionStatusResult`)
- Test: `server/internal/protocol/registry_methods_test.go`

- [x] **Step 1: Write the failing protocol test**

Append this test to `server/internal/protocol/registry_methods_test.go`. The file already imports `bytes` and `encoding/json`.

```go
func TestSessionActionStatusResultSessionLocalJSON(t *testing.T) {
	encoded, err := json.Marshal(SessionActionStatusResult{
		OK:        true,
		SessionID: "sess-1",
		AgentType: "codex",
		Limits:    []SessionActionRateLimit{},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !bytes.Contains(encoded, []byte(`"agentType":"codex"`)) {
		t.Fatalf("expected agentType in json, got %s", encoded)
	}
	if !bytes.Contains(encoded, []byte(`"limits":[]`)) {
		t.Fatalf("expected empty limits array, got %s", encoded)
	}
	if bytes.Contains(encoded, []byte(`"account"`)) {
		t.Fatalf("expected account to be omitted, got %s", encoded)
	}

	var decoded SessionActionStatusResult
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.AgentType != "codex" {
		t.Fatalf("decoded agentType = %q", decoded.AgentType)
	}

	withoutAgent, err := json.Marshal(SessionActionStatusResult{
		OK:        true,
		SessionID: "sess-1",
		Limits:    []SessionActionRateLimit{},
	})
	if err != nil {
		t.Fatalf("marshal without agent: %v", err)
	}
	if bytes.Contains(withoutAgent, []byte(`"agentType"`)) {
		t.Fatalf("expected agentType omitempty, got %s", withoutAgent)
	}
}
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```powershell
cd server
go test ./internal/protocol/ -run TestSessionActionStatusResultSessionLocalJSON -v
```

Expected: compile failure containing `unknown field AgentType in struct literal of type SessionActionStatusResult`.

- [x] **Step 3: Add the optional protocol field**

Replace `SessionActionStatusResult` in `server/internal/protocol/session_actions.go` with:

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

Do not remove or rename `Limits`, `Account`, or `UpdatedAt`; older clients and payloads still know those fields even though the new `session.status` producer will not populate provider data.

- [x] **Step 4: Format and rerun the protocol test**

Run:

```powershell
cd server
gofmt -w internal/protocol/session_actions.go internal/protocol/registry_methods_test.go
go test ./internal/protocol/ -run TestSessionActionStatusResultSessionLocalJSON -v
```

Expected: PASS.

- [x] **Step 5: Commit the protocol change**

```powershell
git add server/internal/protocol/session_actions.go server/internal/protocol/registry_methods_test.go
git commit -m "feat(protocol): add agent type to session status"
```

## Task 2: Make status universal and remove the provider status bit

**Files:**

- Modify: `server/internal/hub/client/client.go` (`actionLookup`, `sessionSupportsAction`)
- Modify: `server/internal/hub/client/client_test.go`
- Modify: `server/internal/hub/agent/factory.go` (`SessionActionSupport` and registrations)
- Modify: `server/internal/hub/agent/agent_test.go`

- [x] **Step 1: Write the failing universal-capability test**

Append to `server/internal/hub/client/client_test.go`:

```go
func TestSessionStatusActionAlwaysSupported(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	c := New(store, "proj1", t.TempDir())
	c.registry = agent.NewACPFactory()
	c.registry.RegisterSessionActions(acp.ACPProviderClaude, agent.SessionActionSupport{Compact: true})
	t.Cleanup(func() { _ = c.Close() })

	known := c.sessionRecorder.actionLookup(string(acp.ACPProviderClaude))
	if !known.Status.Supported {
		t.Fatal("known provider status should be supported")
	}
	if !known.Compact.Supported {
		t.Fatal("known provider compact support was lost")
	}

	unknown := c.sessionRecorder.actionLookup("unknown-agent")
	if !unknown.Status.Supported {
		t.Fatal("unknown provider status should be supported")
	}
	if unknown.Compact.Supported {
		t.Fatal("unknown provider compact should stay unsupported")
	}

	sess := &Session{agentType: "unknown-agent"}
	if !c.sessionSupportsAction(sess, acp.SessionActionStatus) {
		t.Fatal("unknown provider dispatch should allow status")
	}
	if c.sessionSupportsAction(sess, acp.SessionActionCompact) {
		t.Fatal("unknown provider dispatch should reject compact")
	}

	c.registry = nil
	if !c.sessionRecorder.actionLookup("unknown-agent").Status.Supported {
		t.Fatal("nil registry summary should still allow status")
	}
	if !c.sessionSupportsAction(sess, acp.SessionActionStatus) {
		t.Fatal("nil registry dispatch should still allow status")
	}
	if c.sessionSupportsAction(sess, acp.SessionActionCompact) {
		t.Fatal("nil registry dispatch should reject compact")
	}
}
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```powershell
cd server
go test ./internal/hub/client/ -run TestSessionStatusActionAlwaysSupported -v
```

Expected: FAIL at the unknown-provider status assertion because current `actionLookup` returns every action unsupported.

- [x] **Step 3: Make summary status universal**

Replace the `c.sessionRecorder.actionLookup` closure in `server/internal/hub/client/client.go` with:

```go
c.sessionRecorder.actionLookup = func(agentType string) acp.SessionActionCapabilities {
	var caps acp.SessionActionCapabilities
	provider, ok := acp.ParseACPProvider(agentType)
	if !ok || c.registry == nil {
		caps = unsupportedSessionActions("Current Agent does not support this action.")
	} else {
		support := c.registry.SessionActions(provider)
		caps = acp.SessionActionCapabilities{
			Compact: acp.SessionActionCapability{
				Supported: support.Compact,
				Reason:    unsupportedSessionActionReason(support.Compact),
			},
			Steer: acp.SessionActionCapability{
				Supported: support.Steer,
				Reason:    unsupportedSessionActionReason(support.Steer),
			},
			Fork: acp.SessionActionCapability{
				Supported: support.Fork,
				Reason:    unsupportedSessionActionReason(support.Fork),
			},
			Goal: acp.SessionActionCapability{
				Supported: support.Goal,
				Reason:    unsupportedSessionActionReason(support.Goal),
			},
		}
	}
	caps.Status = acp.SessionActionCapability{Supported: true}
	return caps
}
```

- [x] **Step 4: Make dispatch status universal with one normalization boundary**

Replace `sessionSupportsAction` in `server/internal/hub/client/client.go` with:

```go
func (c *Client) sessionSupportsAction(sess *Session, action string) bool {
	if c == nil || sess == nil {
		return false
	}
	action = strings.TrimSpace(action)
	if action == acp.SessionActionStatus {
		return true
	}
	if c.registry == nil {
		return false
	}
	sess.mu.Lock()
	agentType := sess.agentType
	sess.mu.Unlock()
	provider, ok := acp.ParseACPProvider(agentType)
	if !ok {
		return false
	}
	support := c.registry.SessionActions(provider)
	switch action {
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

- [x] **Step 5: Remove provider-level `Status` support**

Change `SessionActionSupport` in `server/internal/hub/agent/factory.go` to:

```go
type SessionActionSupport struct {
	Compact bool
	Steer   bool
	Fork    bool
	Goal    bool
}
```

Update the Codex registration to:

```go
f.RegisterSessionActions(protocol.ACPProviderCodex, SessionActionSupport{
	Compact: true,
	Steer:   true,
	Fork:    true,
	Goal:    true,
})
```

Update the CX DeepSeek registration to:

```go
f.RegisterSessionActions(protocol.ACPProviderCXDeepSeek, SessionActionSupport{
	Compact: true,
	Steer:   true,
	Fork:    true,
	Goal:    true,
})
```

Remove `Status: true` from the existing Codex fixture in `server/internal/hub/client/client_test.go`.

In `server/internal/hub/agent/agent_test.go`:

- make `TestFactorySessionActionsAreProviderSpecific` assert only `Compact`;
- make `TestFactoryCodexSupportsSessionActions` assert `Compact`, `Steer`, `Fork`, and `Goal`;
- make `TestConfiguredACPFactoryRegistersCXDeepSeekFromExistingKey` assert those same four fields;
- make `TestACPFactoryReplaceFromUpdatesSharedRegistryInPlace` register/assert `Compact` instead of `Status`.

The updated core assertions are:

```go
if got := factory.SessionActions(protocol.ACPProviderCodex); !got.Compact {
	t.Fatalf("codex session actions = %+v", got)
}
if got := factory.SessionActions(protocol.ACPProviderClaude); got.Compact {
	t.Fatalf("claude session actions = %+v", got)
}
if got := cloned.SessionActions(protocol.ACPProviderCodex); !got.Compact {
	t.Fatalf("cloned codex session actions = %+v", got)
}
```

```go
if !got.Compact || !got.Steer || !got.Fork || !got.Goal {
	t.Fatalf("Codex session actions = %+v", got)
}
```

```go
if !actions.Compact || !actions.Steer || !actions.Fork || !actions.Goal {
	t.Fatalf("cx-deepseek session actions = %+v", actions)
}
```

- [x] **Step 6: Format and run capability/factory tests**

Run:

```powershell
cd server
gofmt -w internal/hub/client/client.go internal/hub/client/client_test.go internal/hub/agent/factory.go internal/hub/agent/agent_test.go
go test ./internal/hub/client/ -run "TestSessionStatusActionAlwaysSupported|TestHandleSessionRequest_SessionListIncludesUsage" -v
go test ./internal/hub/agent/ -run "TestFactorySessionActionsAreProviderSpecific|TestFactoryCodexSupportsSessionActions|TestConfiguredACPFactoryRegistersCXDeepSeekFromExistingKey|TestACPFactoryReplaceFromUpdatesSharedRegistryInPlace" -v
```

Expected: all selected tests PASS. The existing session-list test continues to report status supported even though factory support no longer contains a `Status` field.

- [x] **Step 7: Commit the universal capability**

```powershell
git add server/internal/hub/client/client.go server/internal/hub/client/client_test.go server/internal/hub/agent/factory.go server/internal/hub/agent/agent_test.go
git commit -m "feat(hub): make session status universally available"
```

## Task 3: Return only the persisted session snapshot without spawning

**Files:**

- Modify: `server/internal/hub/client/session.go` (`SessionStatus`)
- Modify: `server/internal/hub/client/client_test.go` (test spy and persisted-session test)

- [x] **Step 1: Turn the test instance into a provider-status trap**

In `testInjectedInstance` in `server/internal/hub/client/client_test.go`, add:

```go
statusCalls int
```

Replace its `SessionStatus` method with:

```go
func (i *testInjectedInstance) SessionStatus(context.Context) (acp.SessionActionStatusResult, error) {
	i.statusCalls++
	return i.statusResult, i.statusErr
}
```

- [x] **Step 2: Replace the old Codex live-status test with a failing provider matrix**

Delete `TestHandleSessionRequestSessionStatusInitializesWithoutLoading` and add:

```go
func TestHandleSessionRequestSessionStatusUsesPersistedStateWithoutAgent(t *testing.T) {
	for _, agentType := range []string{
		string(acp.ACPProviderCodex),
		string(acp.ACPProviderCXDeepSeek),
		string(acp.ACPProviderClaude),
		"unknown-agent",
	} {
		t.Run(agentType, func(t *testing.T) {
			store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
			if err != nil {
				t.Fatalf("NewStore: %v", err)
			}
			ctx := context.Background()
			if err := store.SaveSession(ctx, &SessionRecord{
				ID:           "sess-status",
				ProjectName:  "proj1",
				Status:       SessionPersisted,
				AgentType:    agentType,
				AgentJSON:    `{"usage":{"used":9000,"size":128000,"updatedAt":"2026-07-30T10:00:00Z"}}`,
				CreatedAt:    time.Now().Add(-time.Hour),
				LastActiveAt: time.Now().Add(-time.Minute),
			}); err != nil {
				t.Fatalf("SaveSession: %v", err)
			}

			inst := &testInjectedInstance{
				name:      agentType,
				sessionID: "sess-status",
				alive:     true,
				statusResult: acp.SessionActionStatusResult{
					OK: true,
					Limits: []acp.SessionActionRateLimit{{
						ID:               "provider-limit",
						Name:             "Must not appear",
						UsedPercent:      1,
						RemainingPercent: 99,
					}},
					Account: &acp.SessionActionStatusAccount{PlanType: "provider-plan"},
				},
			}
			creatorCalls := 0
			c := New(store, "proj1", t.TempDir())
			c.registry = agent.NewACPFactory()
			if provider, ok := acp.ParseACPProvider(agentType); ok {
				c.registry.Register(provider, func(context.Context, string) (agent.Instance, error) {
					creatorCalls++
					return inst, nil
				})
			}
			t.Cleanup(func() { _ = c.Close() })

			response, err := c.HandleSessionRequest(
				ctx,
				acp.RegistryMethodSessionStatus,
				"proj1",
				json.RawMessage(`{"sessionId":"sess-status"}`),
			)
			if err != nil {
				t.Fatalf("HandleSessionRequest(session.status): %v", err)
			}
			status, ok := response.(acp.SessionActionStatusResult)
			if !ok {
				t.Fatalf("status response type = %T", response)
			}
			if !status.OK || status.SessionID != "sess-status" || status.AgentType != agentType {
				t.Fatalf("status identity = %+v", status)
			}
			if status.Context == nil ||
				status.Context.Used != 9000 ||
				status.Context.Size == nil ||
				*status.Context.Size != 128000 ||
				status.Context.UpdatedAt != "2026-07-30T10:00:00Z" {
				t.Fatalf("status context = %+v", status.Context)
			}
			if status.Limits == nil || len(status.Limits) != 0 {
				t.Fatalf("status limits = %#v, want non-nil empty slice", status.Limits)
			}
			if status.Account != nil {
				t.Fatalf("status account = %+v, want nil", status.Account)
			}
			if creatorCalls != 0 || inst.initCalls != 0 || inst.loadCalls != 0 || inst.statusCalls != 0 {
				t.Fatalf(
					"calls creator=%d initialize=%d load=%d providerStatus=%d",
					creatorCalls,
					inst.initCalls,
					inst.loadCalls,
					inst.statusCalls,
				)
			}
			encoded, err := json.Marshal(status)
			if err != nil {
				t.Fatalf("marshal status: %v", err)
			}
			if !bytes.Contains(encoded, []byte(`"limits":[]`)) {
				t.Fatalf("status json = %s, want limits:[]", encoded)
			}
			if bytes.Contains(encoded, []byte(`"account"`)) {
				t.Fatalf("status json = %s, want account omitted", encoded)
			}
		})
	}
}
```

- [x] **Step 3: Run the matrix to verify it fails**

Run:

```powershell
cd server
go test ./internal/hub/client/ -run TestHandleSessionRequestSessionStatusUsesPersistedStateWithoutAgent -v
```

Expected: FAIL because the current implementation creates/initializes a known provider instance, calls provider status, or cannot serve the unknown provider.

- [x] **Step 4: Replace `Session.SessionStatus` with one locked local snapshot**

Replace the entire method in `server/internal/hub/client/session.go`:

```go
func (s *Session) SessionStatus(_ context.Context) (acp.SessionActionStatusResult, error) {
	s.mu.Lock()
	sessionID := s.acpSessionID
	agentType := s.agentType
	var usage *acp.SessionUsage
	if s.agentState.Usage != nil {
		value := *s.agentState.Usage
		usage = &value
	}
	s.mu.Unlock()

	result := acp.SessionActionStatusResult{
		OK:        true,
		SessionID: sessionID,
		AgentType: agentType,
		Limits:    []acp.SessionActionRateLimit{},
	}
	if usage == nil {
		return result, nil
	}
	result.Context = &acp.SessionActionStatusContext{
		Used:      usage.Used,
		UpdatedAt: usage.UpdatedAt,
	}
	if usage.Size > 0 {
		size := usage.Size
		result.Context.Size = &size
	}
	return result, nil
}
```

Do not call `persistSessionBestEffort`: status is read-only and the snapshot already came from session state.

- [x] **Step 5: Format and run the session-local tests**

Run:

```powershell
cd server
gofmt -w internal/hub/client/session.go internal/hub/client/client_test.go
go test ./internal/hub/client/ -run "TestHandleSessionRequestSessionStatusUsesPersistedStateWithoutAgent|TestSessionStatusActionAlwaysSupported|TestHandleSessionRequest_SessionListIncludesUsage" -v
```

Expected: PASS for Codex, CX DeepSeek, Claude, and unknown-agent subtests; every call counter remains zero.

- [x] **Step 6: Commit the session-local implementation**

```powershell
git add server/internal/hub/client/session.go server/internal/hub/client/client_test.go
git commit -m "feat(hub): return session-local status without spawning"
```

## Task 4: Remove the dead provider live-status adapter

**Files:**

- Modify: `server/internal/hub/agent/instance.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Modify: `server/internal/hub/agent/codexapp_convert.go`
- Modify: `server/internal/hub/agent/agent_test.go`

- [x] **Step 1: Confirm the production call chain is now dead**

Run:

```powershell
cd server
rg -n "SessionStatusProvider|func .*SessionStatus|account/rateLimits/read|normalizeCodexappRateLimits" internal/hub/agent --glob "!**/*_test.go"
```

Expected before cleanup: matches only the interface/wrapper in `instance.go`, the Codex app-server adapter in `codexapp_agent.go`, and rate-limit conversion code in `codexapp_convert.go`. There must be no Monitor or `tokenStats` call site in this package.

- [x] **Step 2: Remove the agent status interface and wrapper**

Delete this interface from `server/internal/hub/agent/instance.go`:

```go
type SessionStatusProvider interface {
	SessionStatus(ctx context.Context) (protocol.SessionActionStatusResult, error)
}
```

Delete the entire `func (i *instance) SessionStatus(...)` method from the same file.

- [x] **Step 3: Remove the Codex app-server session-status RPC**

Delete this method from `server/internal/hub/agent/codexapp_agent.go`:

```go
func (c *codexappConn) SessionStatus(ctx context.Context) (protocol.SessionActionStatusResult, error) {
	var response appServerGetAccountRateLimitsResponse
	if err := c.runtime.request(ctx, "account/rateLimits/read", nil, &response); err != nil {
		return protocol.SessionActionStatusResult{}, err
	}
	return normalizeCodexappRateLimits(response, time.Now()), nil
}
```

Keep Monitor collectors unchanged; this deletes only the obsolete `session.status` adapter.

- [x] **Step 4: Remove the now-unused conversion model and helpers**

From `server/internal/hub/agent/codexapp_convert.go`, delete these exact declarations and functions:

```text
appServerGetAccountRateLimitsResponse
appServerRateLimitSnapshot
appServerRateLimitWindow
appServerCreditsSnapshot
appServerSpendControlSnapshot
appServerRateLimitResetCredits
codexappNamedRateLimitSnapshot
normalizeCodexappRateLimits
clampCodexappPercent
codexappUnixTime
```

Remove the `sort` import when it becomes unused. Keep `time` because timestamp conversion elsewhere in the file still uses it.

- [x] **Step 5: Remove the obsolete adapter test**

Delete `TestCodexappSessionStatusNormalizesRateLimits` from `server/internal/hub/agent/agent_test.go`. Do not delete Monitor limits tests; this test specifically exercises the retired `codexappConn.SessionStatus` method.

- [x] **Step 6: Format, prove the symbols are gone, and run agent/client tests**

Run:

```powershell
cd server
gofmt -w internal/hub/agent/instance.go internal/hub/agent/codexapp_agent.go internal/hub/agent/codexapp_convert.go internal/hub/agent/agent_test.go
rg -n "SessionStatusProvider|account/rateLimits/read|normalizeCodexappRateLimits" internal/hub/agent --glob "!**/*_test.go"
go test ./internal/hub/agent/ ./internal/hub/client/
```

Expected: `rg` exits with no matches; both Go packages PASS.

- [x] **Step 7: Commit the dead-path cleanup**

```powershell
git add server/internal/hub/agent/instance.go server/internal/hub/agent/codexapp_agent.go server/internal/hub/agent/codexapp_convert.go server/internal/hub/agent/agent_test.go
git commit -m "refactor(agent): remove provider session status adapter"
```

## Task 5: Render one uniform status dialog with session-id copy

**Files:**

- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/shell/AppDialogs.tsx`
- Modify: `app/web/src/styles/shell.css`
- Modify: `app/web/src/chat/session/chatSessionActions.ts`
- Test: `app/__tests__/web-session-actions-service.test.ts`
- Test: `app/__tests__/web-session-status-dialog.test.tsx`
- Test: `app/__tests__/web-chat-session-actions.test.ts`

- [x] **Step 1: Add the failing repository expectation**

In the first test in `app/__tests__/web-session-actions-service.test.ts`:

- add `agentType: ' codex '` to the mocked payload;
- add `agentType: 'codex'` after `sessionId` in the expected normalized result;
- change the mocked `limits` to `[]` and remove the mocked `account`;
- expect `limits: []` and omit `account` in the normalized result.

The status portion should be:

```ts
payload: {
  ok: true,
  sessionId: 'runtime-thread-must-not-win',
  agentType: ' codex ',
  context: {used: 42000.8, size: 258400.2, updatedAt: '2026-07-14T10:00:00Z', private: true},
  limits: [],
  updatedAt: '',
  runtimeThreadId: 'hidden',
},
```

```ts
await expect(repository.statusSession('project-a', 'stable-session')).resolves.toEqual({
  ok: true,
  sessionId: 'stable-session',
  agentType: 'codex',
  context: {used: 42000, size: 258400, updatedAt: '2026-07-14T10:00:00Z'},
  limits: [],
  account: undefined,
  updatedAt: '',
});
```

- [x] **Step 2: Replace the dialog tests with uniform-layout and copy tests**

At the top of `app/__tests__/web-session-status-dialog.test.tsx`, add:

```tsx
import {writeTextToClipboard} from '../web/src/platform/clipboard';

jest.mock('../web/src/platform/clipboard', () => ({
  writeTextToClipboard: jest.fn(() => Promise.resolve()),
}));

const mockedWriteTextToClipboard = writeTextToClipboard as jest.MockedFunction<
  typeof writeTextToClipboard
>;
```

Inside the describe block, add:

```tsx
beforeEach(() => {
  mockedWriteTextToClipboard.mockClear();
});
```

Rename the first test to `shows cached context immediately while status is loading` and add:

```tsx
expect(renderedText(renderer!.toJSON())).toContain('Refreshing status…');
```

Replace the existing limits/account rendering test with:

```tsx
test('renders the same session-local fields and ignores legacy provider data', () => {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <AppSessionStatusDialog
        sessionId="stable-session"
        cachedUsage={{used: 1, size: 2}}
        status={{
          ok: true,
          sessionId: 'stable-session',
          agentType: 'codex',
          context: {used: 50000, size: 258400},
          limits: [
            {id: 'legacy', name: 'Legacy limit', usedPercent: 37, remainingPercent: 63},
          ],
          account: {
            planType: 'legacy-plan',
            credits: {hasCredits: true, unlimited: false, balance: '12.50'},
          },
          updatedAt: '',
        }}
        loading={false}
        error="Refresh failed; showing the last result."
        onClose={() => undefined}
        onRefresh={() => undefined}
      />,
    );
  });
  const text = renderedText(renderer!.toJSON());
  expect(text).toContain('stable-session');
  expect(text).toContain('codex');
  expect(text).toContain('50,000');
  expect(text).toContain('Refresh failed; showing the last result.');
  expect(text).not.toContain('Legacy limit');
  expect(text).not.toContain('legacy-plan');
  expect(text).not.toContain('12.50');
  expect(text).not.toContain('Rate limits');
  expect(text).not.toContain('Account');
  expect(renderer!.root.findByProps({'data-testid': 'session-status-agent'})).toBeTruthy();
});
```

Append:

```tsx
test('copies the exact session id from an accessible icon button', () => {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <AppSessionStatusDialog
        sessionId="stable-session"
        status={null}
        loading={false}
        error=""
        onClose={() => undefined}
        onRefresh={() => undefined}
      />,
    );
  });

  const copyButton = renderer!.root.findByProps({'aria-label': 'Copy session ID'});
  act(() => {
    copyButton.props.onClick();
  });
  expect(mockedWriteTextToClipboard).toHaveBeenCalledTimes(1);
  expect(mockedWriteTextToClipboard).toHaveBeenCalledWith('stable-session');
});
```

- [x] **Step 3: Add the failing provider-neutral slash-description assertion**

In the first test in `app/__tests__/web-chat-session-actions.test.ts`, extend the status option assertion to:

```ts
expect(options[1]).toMatchObject({
  enabled: true,
  icon: 'layoutDashboard',
  description: 'Show session ID, agent type, and context usage',
});
```

- [x] **Step 4: Run the three Web suites to verify they fail**

Run:

```powershell
cd app
npx jest web-session-actions-service web-session-status-dialog web-chat-session-actions
```

Expected: FAIL because `agentType` is not typed/normalized, the dialog still renders legacy limits/account and has no copy button, loading still says limits, and the slash description mentions rate limits.

- [x] **Step 5: Add and normalize `agentType`**

Add `agentType` after `sessionId` in `RegistrySessionStatusResult` in `app/web/src/registry/registryTypes.ts`:

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

In `RegistryRepository.statusSession`, add this property after `sessionId`:

```ts
agentType: typeof body.agentType === 'string' && body.agentType.trim()
  ? body.agentType.trim()
  : undefined,
```

Keep the existing tolerant `limits` and `account` normalization so the Web client remains compatible with older Hub responses; the dialog will intentionally ignore those fields.

- [x] **Step 6: Replace the dialog's provider-specific rendering**

In `app/web/src/shell/AppDialogs.tsx`:

1. import the clipboard abstraction:

```ts
import {writeTextToClipboard} from '../platform/clipboard';
```

2. delete `formatStatusPlan` and `formatStatusReset`;
3. remove the local `account` and `plan` constants from `AppSessionStatusDialog`;
4. replace the identity portion of the header with:

```tsx
<div className="app-session-status-id" data-testid="session-status-id">
  <span>Session ID</span>
  <span className="app-session-status-id-value">
    <code>{sessionId}</code>
    <button
      type="button"
      className="app-session-status-copy"
      aria-label="Copy session ID"
      title="Copy session ID"
      onClick={() => {
        void writeTextToClipboard(sessionId).catch(() => undefined);
      }}
    >
      <Icon name="copy" />
    </button>
  </span>
</div>
{status?.agentType ? (
  <div className="app-session-status-id" data-testid="session-status-agent">
    <span>Agent</span>
    <code>{status.agentType}</code>
  </div>
) : null}
```

5. delete the entire Rate limits and Account sections;
6. replace `Refreshing limits…` with:

```tsx
Refreshing status…
```

The Context section, cached-usage fallback, refresh error, Refresh button, and Close button stay unchanged.

- [x] **Step 7: Add copy styles and remove dead provider-status styles**

Add after `.app-session-status-id code` in `app/web/src/styles/shell.css`:

```css
.app-session-status-id-value {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
}

.app-session-status-copy {
  appearance: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary);
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
}

.app-session-status-copy:hover {
  background: var(--surface-raised);
  color: var(--text-secondary);
}

.app-session-status-copy:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 1px;
}
```

Delete the unused `.app-session-status-limits`, `.app-session-status-limit-*`, and `.app-session-status-account` rule blocks, including the account-only mobile media rules. Keep the general status dialog, context, muted/loading, actions, and mobile max-height styles.

- [x] **Step 8: Make the slash description provider-neutral**

In `app/web/src/chat/session/chatSessionActions.ts`, replace the `/status` description with:

```ts
description: 'Show session ID, agent type, and context usage',
```

- [x] **Step 9: Run targeted Web tests and type-check**

Run:

```powershell
cd app
npx jest web-session-actions-service web-session-status-dialog web-chat-session-actions
npm run tsc:web
```

Expected: all three Jest suites PASS and TypeScript reports no errors.

- [x] **Step 10: Commit the uniform Web status**

```powershell
git add app/web/src/registry/registryTypes.ts app/web/src/registry/RegistryRepository.ts app/web/src/shell/AppDialogs.tsx app/web/src/styles/shell.css app/web/src/chat/session/chatSessionActions.ts app/__tests__/web-session-actions-service.test.ts app/__tests__/web-session-status-dialog.test.tsx app/__tests__/web-chat-session-actions.test.ts
git commit -m "feat(app): show uniform session status with copy"
```

## Task 6: Full verification and completion gate

**Files:**

- Modify: `docs/scope/2026-07-30-universal-session-status/plan-universal-session-status.md` (final verification record only)

- [x] **Step 1: Run the complete Go suite**

Run:

```powershell
cd server
go test ./...
```

Expected: PASS for every Go package, including `internal/protocol`, `internal/hub/client`, and `internal/hub/agent`.

- [x] **Step 2: Run Web tests, type-check, and production build**

Run:

```powershell
cd app
npx jest web-session-actions-service web-session-status-dialog web-chat-session-actions
npm run tsc:web
npm run build:web
```

Expected: all selected Jest suites PASS, TypeScript reports no errors, and webpack completes the production build to the configured `~/.wheelmaker/web` destination.

- [x] **Step 3: Check formatting, scope, and retired-symbol absence**

From the worktree root, run:

```powershell
git diff --check
rg -n "SessionStatusProvider|account/rateLimits/read|normalizeCodexappRateLimits" server/internal/hub/agent --glob "!**/*_test.go"
git status --short
```

Expected:

- `git diff --check` exits successfully;
- `rg` returns no production matches;
- `git status --short` contains no unexpected files or generated `dist` output.

- [x] **Step 4: Record verification so the final completion-gate commit is real**

Append this record after every command in Steps 1–3 has passed. Do not pre-mark the completion-gate step as finished:

```markdown
## Verification Record

- `cd server && go test ./...` — PASS
- `cd app && npx jest web-session-actions-service web-session-status-dialog web-chat-session-actions` — PASS
- `cd app && npm run tsc:web` — PASS
- `cd app && npm run build:web` — PASS
- `git diff --check` — PASS
- Retired provider session-status symbols — absent
```

## Verification Record

- `cd server && go test ./...` — PASS
- `cd app && npx jest web-session-actions-service web-session-status-dialog web-chat-session-actions` — PASS (3 suites, 23 tests)
- `cd app && npm run tsc:web` — PASS
- `cd app && npm run build:web` — PASS
- `git diff --check` — PASS
- Retired provider session-status symbols — absent
- `internal/hub/tools` produced transient cleanup/async timing failures under parallel verification load; each affected test passed 5 consecutive isolated runs, and the standalone complete Go suite passed after the final rebase. No feature diff touches that package.

- [x] **Step 5: Execute the exact repository completion gate**

Delivery override confirmed by the user on 2026-08-01: land the rebased implementation directly on `main`, discard the old feature-branch line, and do not force-push it. Commit this verification record locally, fast-forward and push `main`, remove the task worktree and feature branches, then run this exact tail sequence from the clean `main` worktree with no `|| echo` fallback:

```powershell
git add -A
git commit -m "docs(scope): complete universal session status plan"
git push origin main
```

Expected: all three commands succeed. The remote feature branch is deleted rather than rewritten.

## Self-Review Notes

- **Spec coverage:** Universal capability is Task 2; session-local id/agent/usage and zero-spawn behavior are Task 3; removal of provider limits/account RPC is Task 4; consistent UI, copy accessibility, generic text, and ignored legacy provider data are Task 5; protocol compatibility and `limits: []` are Tasks 1 and 3; full validation is Task 6.
- **Monitor boundary:** No task changes Monitor, HubState, `tokenStats`, usage history, provider credentials, or scan cadence. Task 4 removes only the obsolete session-specific Codex adapter.
- **No protocol bump:** Task 1 adds one optional response field and retains legacy response fields.
- **No placeholders:** Every production/test edit names exact symbols and provides the intended code or exact deletion list.
- **Type consistency:** Go `AgentType` serializes as `agentType`; TypeScript uses `RegistrySessionStatusResult.agentType`; the dialog consumes that same field. The copy action always receives the `sessionId` prop used by the visible code element.
- **No-spawn proof:** The server matrix separately counts creator, initialize, load, and provider-status calls for Codex, CX DeepSeek, Claude, and an unknown provider.
