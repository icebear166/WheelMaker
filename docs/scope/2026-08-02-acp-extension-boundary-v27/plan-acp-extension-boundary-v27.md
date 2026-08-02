# ACP Extension Boundary and Registry 2.7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WheelMaker's permissive ACP-shaped transport with strict ACP v1 DTOs plus negotiated `_meta.wm` / `_wm/*` extensions, preserve complete internal session behavior, and hard-cut Registry to 2.7.

**Architecture:** JSON-RPC input is decoded into strict discriminated ACP wire variants and immediately projected into provider-neutral `AgentEvent` / `PromptOutcome` types. Session, Recorder, WMT2, Registry, and Web consume the internal model; built-in Codex/CX emit through the same wire decoder as external agents. Negotiated initialize metadata is the sole authority for lifecycle and provider actions, while old WMT2 remains readable as an internal compatibility boundary.

**Tech Stack:** Go 1.25, JSON-RPC 2.0, ACP v1, WMT2, Registry WebSocket Protocol 2.7, React 19, TypeScript, Jest, esbuild.

---

### Task 1: Registry 2.7 hard cut and documentation baseline

**Files:**
- Modify: `server/internal/protocol/registry.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/registry/server_test.go`
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `docs/wiki/protocols/acp.md`
- Modify: `docs/wiki/protocols/registry.md`
- Modify: `docs/wiki/architecture/session-management-and-sync.md`
- Modify: `docs/wiki/agents/session-capabilities.md`
- Modify: `docs/wiki/frontend-interaction/chat-turn-presentation.md`

- [x] **Step 1: Write the failing version tests**

Change the protocol assertion and add the role compatibility table to `registry_methods_test.go`:

```go
func TestRegistryDefaultProtocolVersionIs27(t *testing.T) {
	if DefaultProtocolVersion != "2.7" {
		t.Fatalf("DefaultProtocolVersion=%q, want 2.7", DefaultProtocolVersion)
	}
}
```

Add server handshake coverage proving a 2.6 App is rejected and a 2.6 Hub receives only `update_only`; keep the existing 2.7 App/Hub success assertions.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `go test ./internal/protocol ./internal/registry -run 'TestRegistryDefaultProtocolVersionIs27|Test.*Protocol.*26|Test.*UpdateOnly' -count=1`

Expected: FAIL because the default and Web constants are still 2.6 or because the 2.6 role policy is not enforced.

- [x] **Step 3: Implement the 2.7 constants and hard-cut policy**

Use this constant in Go:

```go
const DefaultProtocolVersion = "2.7"
```

Use this constant in Web:

```ts
export const RegistryProtocolVersion = '2.7' as const;
```

Keep the Registry mismatch branch narrowly accepting `role=hub && protocolVersion=="2.6"` as `update_only`; reject a 2.6 client before normal method routing.

- [x] **Step 4: Run version tests and validate docs**

Run: `go test ./internal/protocol ./internal/registry -run 'TestRegistryDefaultProtocolVersionIs27|Test.*Protocol.*26|Test.*UpdateOnly' -count=1`

Expected: PASS.

Run: `rg -n 'Registry Protocol 2\.6|RegistryProtocolVersion = .2\.6|DefaultProtocolVersion = "2\.6"' server app docs/wiki`

Expected: no current-contract hit; historical `2.6 相比 2.5` text may remain.

- [x] **Step 5: Commit the boundary declaration**

```bash
git add docs/scope/2026-08-02-acp-extension-boundary-v27 docs/wiki server/internal/protocol/registry.go server/internal/protocol/registry_methods_test.go server/internal/registry/server_test.go app/web/src/registry/registryMethods.ts
git commit -m "docs(protocol): define ACP extension boundary and registry 2.7"
```

### Task 2: Strict ACP v1 wire DTOs and metadata carrier

**Files:**
- Create: `server/internal/protocol/acp_wire_update.go`
- Create: `server/internal/protocol/acp_wire_update_test.go`
- Modify: `server/internal/protocol/acp.go`
- Modify: `server/internal/protocol/acp_const.go`
- Modify: `server/internal/protocol/acp_meta.go`
- Modify: `server/internal/protocol/acp_test.go`

- [x] **Step 1: Write strict encode/decode tests**

Add table tests that decode every implemented `sessionUpdate` discriminator, reject a message chunk with `contentBlocks`, reject a tool update with `toolCallContent`, reject `modeId`, and round-trip unknown metadata:

```go
func TestDecodeSessionUpdateRejectsPrivateRootFields(t *testing.T) {
	for _, raw := range []string{
		`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"x"},"contentBlocks":[]}`,
		`{"sessionUpdate":"tool_call_update","toolCallId":"c","toolCallContent":[]}`,
		`{"sessionUpdate":"current_mode_update","modeId":"plan"}`,
	} {
		if _, err := DecodeSessionUpdate(json.RawMessage(raw)); err == nil {
			t.Fatalf("DecodeSessionUpdate(%s) succeeded", raw)
		}
	}
}
```

Assert valid message JSON contains only `sessionUpdate`, `content`, `messageId`, `_meta`; valid tool JSON uses `content`; and nested ContentBlock/ToolCallContent/MCP Server/Config Option unions reject fields from another variant.

- [x] **Step 2: Run protocol tests and verify RED**

Run: `go test ./internal/protocol -run 'TestDecodeSessionUpdate|TestACP.*Meta|TestACP.*Union|TestACP.*Allowlist' -count=1`

Expected: FAIL because `DecodeSessionUpdate` and strict variants do not exist and current wide structs accept private roots.

- [x] **Step 3: Add discriminated wire variants**

Define an interface and concrete structs in `acp_wire_update.go`:

```go
type SessionUpdateVariant interface {
	SessionUpdateKind() string
	Metadata() json.RawMessage
}

type MessageChunkUpdate struct {
	SessionUpdate string          `json:"sessionUpdate"`
	Content       ContentBlock    `json:"content"`
	MessageID     string          `json:"messageId,omitempty"`
	Meta          json.RawMessage `json:"_meta,omitempty"`
}

type ToolCallUpdate struct {
	SessionUpdate string            `json:"sessionUpdate"`
	ToolCallID    string            `json:"toolCallId"`
	Title         string            `json:"title,omitempty"`
	Kind          string            `json:"kind,omitempty"`
	Status        string            `json:"status,omitempty"`
	Content       []ToolCallContent `json:"content,omitempty"`
	Locations     []ToolCallLocation `json:"locations,omitempty"`
	RawInput      json.RawMessage   `json:"rawInput,omitempty"`
	RawOutput     json.RawMessage   `json:"rawOutput,omitempty"`
	Meta          json.RawMessage   `json:"_meta,omitempty"`
}
```

Implement `DecodeSessionUpdate` by reading the discriminator, decoding with `json.Decoder.DisallowUnknownFields`, and validating required/disallowed fields. Give all implemented request/result/capability/nested variant structs `Meta json.RawMessage \`json:"_meta,omitempty"\``. Replace `mcp` with `mcpCapabilities`, `modeId` with `currentModeId`, config option/value structs with discriminator variants, and set-config response with `{configOptions:[...]}`.

- [x] **Step 4: Delete old wire-only fields and constants**

Remove from wire structs and constants: `contentBlocks`, `clientMessageId`, `steered`, `toolCallContent`, Goal update discriminators/fields, `SessionNewResult.title`, root prompt-result `message`, `StopReasonFailed`, `usage_update.updatedAt`, and response-side `Artifacts`/`ForkPoint`. Keep corresponding fields only in `session_turn.go`, `session_actions.go`, or the internal event types introduced next.

- [x] **Step 5: Run protocol tests**

Run: `go test ./internal/protocol -count=1`

Expected: PASS with strict allowlist and metadata round-trip tests.

- [x] **Step 6: Commit strict ACP types**

```bash
git add server/internal/protocol
git commit -m "refactor(acp): add strict v1 wire variants"
```

### Task 3: Typed internal Agent events, prompt outcomes, and Instance buffering

**Files:**
- Create: `server/internal/protocol/agent_event.go`
- Create: `server/internal/protocol/agent_event_test.go`
- Modify: `server/internal/hub/agent/instance.go`
- Modify: `server/internal/hub/agent/instance_tools.go`
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `server/internal/hub/client/session.go`
- Modify: `server/internal/hub/client/session_recorder.go`

- [x] **Step 1: Write event projection and buffer tests**

Test that standard message/tool/session-info/usage wire variants become typed events with full metadata, illegal wire JSON never reaches callbacks, and notifications arriving between `session/new` and `SetCallbacks` flush in order. Include a close test proving the bounded buffer is cleared.

```go
func TestInstanceBuffersEarlySessionEventsUntilCallbacks(t *testing.T) {
	inst := newTestInstance(t)
	inst.HandleACPResponse(context.Background(), MethodSessionUpdate, mustRaw(SessionUpdateParamsWire{
		SessionID: "s1",
		Update: MessageChunkUpdate{SessionUpdate: SessionUpdateAgentMessageChunk, Content: TextContent("hello"), MessageID: "m1"},
	}))
	cb := &fakeCallbacks{}
	inst.SetCallbacks(cb)
	if got := cb.events[0].Message.MessageID; got != "m1" { t.Fatalf("messageId=%q", got) }
}
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `go test ./internal/protocol ./internal/hub/agent -run 'TestProjectACPUpdate|TestInstanceBuffersEarly|TestInstanceRejectsInvalidWire' -count=1`

Expected: FAIL because the typed event projection and early-event buffer do not exist.

- [x] **Step 3: Define the internal boundary**

Add concrete internal types that are never marshaled as ACP:

```go
type AgentEvent struct {
	SessionID string
	Kind      AgentEventKind
	Message   *AgentMessageEvent
	Tool      *AgentToolEvent
	Plan      *AgentPlanEvent
	SessionInfo *AgentSessionInfoEvent
	Usage     *AgentUsageEvent
}

type AgentMessageEvent struct {
	Role       string
	Content    ContentBlock
	MessageID  string
	Meta       json.RawMessage
	ReceivedAt time.Time
}

type PromptOutcome struct {
	StopReason string
	Message    string
	Artifacts  []PromptArtifact
	ForkPoint  *SessionForkPoint
	Err        error
}
```

Create `ProjectSessionUpdate(SessionUpdateVariant, receivedAt)` and make `Callbacks.AgentEvent(protocol.AgentEvent)` the Session-facing callback. Session prompt request/result recording calls typed recorder methods directly instead of manufacturing ACP-shaped JSON.

- [x] **Step 4: Decode both built-in and external notifications in Instance**

In `HandleACPResponse`, decode `session/update` through `DecodeSessionUpdate`, project to `AgentEvent`, and dispatch only the internal event. Add a per-Instance FIFO capped at 256 events while callbacks are nil; flush under ordering protection after `SetCallbacks`, and clear the slice on `Close` or failed session setup.

- [x] **Step 5: Run focused and package tests**

Run: `go test ./internal/protocol ./internal/hub/agent ./internal/hub/client -run 'TestProjectACPUpdate|TestInstance|TestSessionRecorder|TestPrompt' -count=1`

Expected: PASS.

- [x] **Step 6: Commit the internal event boundary**

```bash
git add server/internal/protocol/agent_event.go server/internal/protocol/agent_event_test.go server/internal/hub/agent server/internal/hub/client/session.go server/internal/hub/client/session_recorder.go
git commit -m "refactor(agent): separate ACP wire from session events"
```

### Task 4: Message lifecycle, Steer aggregation, and WMT2 preservation

**Files:**
- Modify: `server/internal/protocol/acp_meta.go`
- Modify: `server/internal/protocol/session_turn.go`
- Modify: `server/internal/hub/client/session_recorder.go`
- Modify: `server/internal/hub/client/session_search.go`
- Modify: `server/internal/hub/client/session_steer.go`
- Modify: `server/internal/hub/client/client_test.go`
- Modify: `server/internal/hub/client/session_queue_test.go`

- [x] **Step 1: Write lifecycle RED tests**

Add tests for: two text chunks with the same messageId merge; a zero-text completion marker updates the same turn; nested unknown metadata deep-merges; completed phase is authoritative; invalid completed phase preserves the prior valid phase; a late chunk does not reopen completion; and Steer text/image/resource blocks become one WMT2 user turn.

```go
func TestRecorderCompletionMarkerUpdatesMessageWithoutNewTurn(t *testing.T) {
	recorder := newRecorderHarness(t)
	recorder.RecordAgentEvent(messageEvent("m1", "answer", metaWM("commentary", false)))
	recorder.RecordAgentEvent(messageEvent("m1", "", metaWM("final_answer", true)))
	turns := recorder.Turns()
	if len(turns) != 1 || turns[0].MessageID != "m1" || turns[0].Content != "answer" || !turns[0].Finished {
		t.Fatalf("turns=%#v", turns)
	}
}
```

- [x] **Step 2: Run recorder tests and verify RED**

Run: `go test ./internal/hub/client -run 'TestRecorder.*Message|TestRecorder.*Meta|Test.*Steer.*Blocks|TestSessionSearch.*Steered' -count=1`

Expected: FAIL because WMT2 turns do not carry stable message IDs/completion state and metadata merge is shallow/adjacency-based.

- [x] **Step 3: Implement lifecycle metadata helpers**

Add typed helpers for `messagePhase`, `messageComplete`, and `steered`, plus recursive object merge:

```go
func MergeMetadata(base, incoming json.RawMessage) (json.RawMessage, error)
func MessageLifecycle(meta json.RawMessage) (phase SessionMessagePhase, complete, steered bool)
func WithMessageLifecycle(meta json.RawMessage, phase SessionMessagePhase, complete, steered bool) json.RawMessage
```

Objects recurse, arrays/scalars overwrite, and untouched unknown namespaces remain byte-equivalent in JSON value semantics.

- [x] **Step 4: Persist internal message and tool fidelity**

Extend internal WMT2 message params with `messageId`, full `meta`, and `messageComplete`; extend tool params with `content`, `locations`, `rawInput`, `rawOutput`, and `meta`. Index active messages by `method + "\x00" + messageId`; use the existing adjacency rule only when messageId is empty. Preserve the old `contentBlocks`, `clientMessageId`, and `steered` reader path because these are internal historical fields.

- [x] **Step 5: Emit standard Steer chunks**

Map one accepted block to one standard `user_message_chunk`, share `messageId=clientMessageID`, and attach this metadata only to the last real block:

```json
{"wm":{"steered":true,"messageComplete":true}}
```

Recorder aggregates the chunks back into one internal user turn and completes the queue item once.

- [x] **Step 6: Run persistence regressions**

Run: `go test ./internal/hub/client -run 'TestRecorder|Test.*Steer|TestSessionSearch|Test.*Fork|Test.*Attachment' -count=1`

Expected: PASS, including old WMT2 fixtures without messageId.

- [x] **Step 7: Commit lifecycle storage**

```bash
git add server/internal/protocol/acp_meta.go server/internal/protocol/session_turn.go server/internal/hub/client
git commit -m "feat(session): preserve ACP message lifecycle in WMT2"
```

### Task 5: Codex/CX strict emitters and authoritative completion

**Files:**
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Modify: `server/internal/hub/agent/codexapp_convert.go`
- Modify: `server/internal/hub/agent/codexapp_deepseek.go`
- Modify: `server/internal/hub/agent/agent_test.go`

- [x] **Step 1: Write Codex/CX wire-shape tests**

Capture serialized `session/update` notifications and assert no private root fields. Add started/delta/completed tests where completed changes commentary to final_answer, no visible duplicate text appears, replay uses one complete full-text chunk, late delta is ignored, title is a standard `session_info_update`, usage has no `updatedAt`, and tool updates use standard `content`.

```go
func TestCodexItemCompletedEmitsAuthoritativeMessageCompletion(t *testing.T) {
	updates := driveCodexMessage(t, "item-1", "commentary", "answer", "final_answer")
	last := updates[len(updates)-1].Update.(protocol.MessageChunkUpdate)
	if last.MessageID != "item-1" || last.Content.Text != "" { t.Fatalf("last=%#v", last) }
	phase, complete, _ := protocol.MessageLifecycle(last.Meta)
	if phase != protocol.SessionMessagePhaseFinalAnswer || !complete { t.Fatalf("meta=%s", last.Meta) }
}
```

- [x] **Step 2: Run adapter tests and verify RED**

Run: `go test ./internal/hub/agent -run 'TestCodex.*(Completed|Replay|Steer|Tool|Title|Usage)|TestCXDeepSeek.*Message' -count=1`

Expected: FAIL because item/completed currently drops lifecycle state and emitters build the wide private-root structure.

- [x] **Step 3: Convert every built-in update to a strict wire variant**

Make `emitSessionUpdate` accept `SessionUpdateVariant`, serialize it, and feed it through `Instance.HandleACPResponse`. Use item ID as messageId; retain `(turnID,itemID)` state through completed emission; then delete it. Emit standard title, mode, config, plan, tool, usage, message, and thought variants.

- [x] **Step 4: Implement completion and replay rules**

On live item/completed, send an empty Text ContentBlock with `messageComplete=true` and the valid completed phase; if completed phase is absent/unknown, retain the last valid phase. Replay sends its full text once with `messageComplete=true`. Ignore delta for a lifecycle entry already marked complete.

- [x] **Step 5: Run all agent tests**

Run: `go test ./internal/hub/agent -count=1`

Expected: PASS for both codex and cx-deepseek because they share the bridge path.

- [x] **Step 6: Commit strict built-in emitters**

```bash
git add server/internal/hub/agent/codexapp_agent.go server/internal/hub/agent/codexapp_convert.go server/internal/hub/agent/codexapp_deepseek.go server/internal/hub/agent/agent_test.go
git commit -m "fix(codex): emit authoritative ACP message completion"
```

### Task 6: Negotiated `_wm/*` Goal and provider action transport

**Files:**
- Create: `server/internal/protocol/acp_wm_extension.go`
- Create: `server/internal/protocol/acp_wm_extension_test.go`
- Modify: `server/internal/hub/agent/conn.go`
- Modify: `server/internal/hub/agent/instance.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `server/internal/hub/client/session.go`
- Modify: `server/internal/hub/client/session_steer.go`
- Modify: `server/internal/hub/client/session_goal.go`
- Modify: `server/internal/hub/client/session_goal_test.go`
- Modify: `server/internal/hub/client/session_archive.go`

- [x] **Step 1: Write capability/action/Goal RED tests**

Test client initialize metadata, Codex/CX agent metadata, version intersection, every `_wm/session/*` method name/params/result, stable error classification, invalid Goal notification rejection, unknown `_wm/*` notification ignore, and absence of `Conn` action type assertions.

```go
func TestInstanceSteerUsesNegotiatedWMRequest(t *testing.T) {
	conn := newRecordingConn()
	inst := initializedInstance(t, conn, sessionActionsMeta(true, false, false, false, false))
	_, err := inst.SteerSession(context.Background(), "s1", "m1", []protocol.ContentBlock{protocol.TextContent("x")})
	if err != nil { t.Fatal(err) }
	if conn.lastMethod != protocol.MethodWMSessionSteer { t.Fatalf("method=%q", conn.lastMethod) }
}
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `go test ./internal/protocol ./internal/hub/agent ./internal/hub/client -run 'Test.*WM|Test.*Goal.*Notification|Test.*SessionAction.*Capability' -count=1`

Expected: FAIL because formal extension DTOs and request routing do not exist.

- [x] **Step 3: Define formal extension DTOs and capabilities**

Add constants and typed request/notification structs for:

```go
const (
	MethodWMSessionSteer       = "_wm/session/steer"
	MethodWMSessionCompact     = "_wm/session/compact"
	MethodWMSessionGoalSet     = "_wm/session/goal/set"
	MethodWMSessionGoalGet     = "_wm/session/goal/get"
	MethodWMSessionGoalClear   = "_wm/session/goal/clear"
	MethodWMSessionForkResolve = "_wm/session/fork/resolve"
	MethodWMSessionFork        = "_wm/session/fork"
	MethodWMSessionArchive     = "_wm/session/archive"
	MethodWMSessionGoal        = "_wm/session/goal"
)
```

All params/results carry optional `_meta`. Validate `version==1`, booleans, Goal event-specific required fields, and preserve unknown metadata.

- [x] **Step 4: Route actions through `Conn.Send`**

Keep provider-neutral typed methods on `Instance`, but gate them from stored initialize capabilities and call the matching `_wm/*` request through `Conn.Send`. Remove `SessionSteerer`, `SessionCompactor`, `SessionGoalController`, `SessionForker`, and `SessionArchiver` assertions from `instance.go`; `Conn` remains transport-only.

- [x] **Step 5: Implement built-in dispatcher and Goal notification**

Handle all `_wm/*` requests in the Codex/CX dispatcher by invoking existing provider logic. Replace Goal-shaped session updates with `_wm/session/goal`; Instance validates and maps them to internal Goal events. Preserve current Session queue fallback and Goal execution-owner semantics.

- [x] **Step 6: Run action and lifecycle regressions**

Run: `go test ./internal/hub/agent ./internal/hub/client -run 'Test.*(Steer|Compact|Goal|Fork|Archive)|TestSessionQueue' -count=1`

Expected: PASS without Conn-level action transport.

- [x] **Step 7: Commit formal actions**

```bash
git add server/internal/protocol/acp_wm_extension.go server/internal/protocol/acp_wm_extension_test.go server/internal/hub/agent server/internal/hub/client
git commit -m "feat(acp): formalize WheelMaker session extensions"
```

### Task 7: Capability projection, archive persistence, and Web activation

**Files:**
- Modify: `server/internal/protocol/registry.go`
- Modify: `server/internal/hub/client/session_recorder.go`
- Modify: `server/internal/hub/client/session_archive.go`
- Modify: `server/internal/hub/client/client_test.go`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/chat/session/chatSessionState.ts`
- Modify: `app/web/src/chat/ChatSessionPanel.tsx`
- Modify: `app/web/src/chat/turns/chatDisplayIndex.ts`
- Modify: `app/web/src/chat/ChatTurnView.test.tsx`

- [x] **Step 1: Write projection and UI RED tests**

Add Go tests proving normal summary/read and new archive manifest/read retain `sessionFeatures.messageLifecycle.version=1`, while old WMT2/archive data may omit it. Add Web tests proving a third-party agent with the feature folds work, a new codex session without the feature does not use provider fallback, and an explicitly historical codex view still does.

```ts
it('activates completed work from negotiated session feature', () => {
  const session = makeSession({
    agentType: 'third-party',
    sessionFeatures: {messageLifecycle: {version: 1}},
  });
  expect(buildDisplayIndex(turns, session).some(item => item.kind === 'work_group')).toBe(true);
});
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `go test ./internal/hub/client -run 'Test.*SessionFeatures|Test.*Archive.*Feature' -count=1`

Run: `npm test -- --runInBand app/web/src/chat/ChatTurnView.test.tsx`

Expected: FAIL because feature projection/persistence and capability-driven activation do not exist.

- [x] **Step 3: Persist and project `SessionFeatures`**

Add stable Registry/internal shapes:

```go
type SessionFeatures struct {
	MessageLifecycle *SessionFeatureVersion `json:"messageLifecycle,omitempty"`
}
type SessionFeatureVersion struct { Version int `json:"version"` }
```

Derive it only from negotiated ACP capabilities for live sessions. Add it to normal summary/read and new archive manifest/read; old archive entries decode with a nil field. Do not change WMT2 major version.

- [x] **Step 4: Make Web capability-driven**

Add matching TypeScript types. Pass a `messageLifecycleEnabled` flag into display-index construction. Use `version===1` for live/current session data; allow provider-name fallback only when the loaded view is explicitly marked historical and has no feature projection.

- [x] **Step 5: Run Go and Web tests**

Run: `go test ./internal/hub/client -run 'Test.*SessionFeatures|Test.*Archive|Test.*SessionRead' -count=1`

Run: `npm test -- --runInBand app/web/src/chat/ChatTurnView.test.tsx app/web/src/chat/ChatSessionPanel.test.tsx`

Expected: PASS.

- [x] **Step 6: Commit capability projection**

```bash
git add server/internal/protocol/registry.go server/internal/hub/client app/web/src/registry/registryTypes.ts app/web/src/chat
git commit -m "feat(registry): project ACP lifecycle capabilities"
```

### Task 8: Full compatibility audit and release verification

**Files:**
- Modify: `server/internal/protocol/acp_test.go`
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `server/internal/hub/client/client_test.go`
- Modify: `app/web/src/chat/ChatTurnView.test.tsx`
- Modify: `docs/scope/2026-08-02-acp-extension-boundary-v27/plan-acp-extension-boundary-v27.md`

- [x] **Step 1: Add the final cross-boundary regression matrix**

Cover standard third-party ACP message/tool/plan/config/session-info/usage input; unknown `_meta` round-trip; unknown `_wm/*` ignore; prompt success/refusal/cancel/runtime failure; title and early Goal notifications; Codex/CX replay; Steer with attachments; Goal create/get/update/stop/clear; Fork; Archive; search; and exporter-visible text.

Add an emitter allowlist test that marshals every built-in variant and fails for any top-level key outside the exact ACP v1 keys plus `_meta`:

```go
func assertJSONKeys(t *testing.T, raw []byte, allowed ...string) {
	t.Helper()
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil { t.Fatal(err) }
	allow := map[string]bool{}
	for _, key := range allowed { allow[key] = true }
	for key := range object {
		if !allow[key] { t.Fatalf("non-standard root field %q in %s", key, raw) }
	}
	}
}
```

- [x] **Step 2: Run formatting and focused regression suites**

Run: `gofmt -w server/internal/protocol server/internal/hub/agent server/internal/hub/client`

Run: `go test ./internal/protocol ./internal/hub/agent ./internal/hub/client ./internal/registry -count=1`

Expected: PASS.

- [x] **Step 3: Run complete backend verification**

Run: `go test ./...`

Expected: PASS.

- [x] **Step 4: Run complete Web verification**

Run: `npm test -- --runInBand`

Run: `npm run typecheck`

Run: `npm run build`

Expected: all commands PASS.

- [x] **Step 5: Audit forbidden wire fields and diff integrity**

Run: `rg -n 'json:"(contentBlocks|clientMessageId|steered|toolCallContent|goal|turnId|modeId|updatedAt)' server/internal/protocol/acp*.go`

Expected: no old private ACP root tag; `_wm` params may contain Goal fields only in `acp_wm_extension.go`, and WMT2/internal files may retain their internal tags.

Run: `git diff --check && git status -sb`

Expected: no whitespace errors; only scoped files differ.

- [x] **Step 6: Mark every completed checkbox and create the completion commit**

Update this plan's executed checkboxes from `[ ]` to `[x]`, then run:

```bash
git add -A
git commit -m "feat(acp): enforce formal extension boundary"
```

- [x] **Step 7: Push the feature branch**

Run: `git push origin feature/acp-extension-boundary-v27`

Expected: remote branch updated successfully.
