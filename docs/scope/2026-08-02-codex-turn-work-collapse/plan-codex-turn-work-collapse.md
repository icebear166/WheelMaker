# Codex Turn Work Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Codex/CX DeepSeek's current streaming UI, then auto-collapse completed prompt work behind a duration/status row while keeping the final answer and prompt completion controls visible.

**Architecture:** Codex App Server message phases are bridged through ACP's official `_meta.wm.messagePhase` extension and persisted with the complete `_meta` object by Session Recorder. Web keeps raw turns unchanged, derives streaming assistant groups and completed work groups in `chatDisplayIndex`, and renders the outer group with a local-only expansion state.

**Tech Stack:** Go, ACP JSON-RPC projections, React 19, TypeScript, react-virtuoso, Jest, Go tests.

**Reference:** `spec-codex-turn-work-collapse.md`

**Worktree:** `.worktree/feat-codex-turn-work-collapse`

---

### Task 1: Commit scope documents

**Files:**
- Create: `docs/scope/2026-08-02-codex-turn-work-collapse/spec-codex-turn-work-collapse.md`
- Create: `docs/scope/2026-08-02-codex-turn-work-collapse/plan-codex-turn-work-collapse.md`

- [x] **Step 1: Validate document structure**

Run:

```powershell
rg -n "^#|^##|^###" docs/scope/2026-08-02-codex-turn-work-collapse
rg -n "TBD|TODO|implement later|fill in details" docs/scope/2026-08-02-codex-turn-work-collapse
```

Expected: headings list both files; placeholder scan has no output.

- [x] **Step 2: Commit documents**

```powershell
git add docs/scope/2026-08-02-codex-turn-work-collapse
git commit -m "docs: specify codex completed work collapse"
```

---

### Task 2: Add ACP `_meta` and typed WheelMaker phase helpers

**Files:**
- Create: `server/internal/protocol/acp_meta.go`
- Modify: `server/internal/protocol/acp.go`
- Modify: `server/internal/protocol/session_turn.go`
- Modify: `server/internal/protocol/acp_test.go`

- [ ] **Step 1: Write failing ACP metadata tests**

Append tests covering exact phase values, unknown values, the `wm` namespace, and unknown-root round-trip:

```go
func TestSessionUpdateMetaMessagePhase(t *testing.T) {
	for _, phase := range []string{SessionMessagePhaseCommentary, SessionMessagePhaseFinalAnswer} {
		meta := BuildSessionUpdateMetaMessagePhase(phase)
		if got := SessionUpdateMetaMessagePhase(meta); got != phase {
			t.Fatalf("phase = %q, want %q; meta=%s", got, phase, meta)
		}
	}
	if meta := BuildSessionUpdateMetaMessagePhase("future_phase"); len(meta) != 0 {
		t.Fatalf("unknown phase meta = %s, want empty", meta)
	}
	if got := SessionUpdateMetaMessagePhase(json.RawMessage(`{"wm":{"messagePhase":"future_phase"}}`)); got != "" {
		t.Fatalf("unknown phase = %q, want empty", got)
	}
}

func TestSessionUpdateMetaRoundTripPreservesUnknownFields(t *testing.T) {
	original := json.RawMessage(`{"wm":{"messagePhase":"commentary"},"thirdParty":{"trace":"opaque"}}`)
	raw, err := json.Marshal(SessionUpdate{
		SessionUpdate: SessionUpdateAgentMessageChunk,
		Meta:          original,
	})
	if err != nil {
		t.Fatal(err)
	}
	var decoded SessionUpdate
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	var want, got any
	_ = json.Unmarshal(original, &want)
	_ = json.Unmarshal(decoded.Meta, &got)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("meta = %#v, want %#v", got, want)
	}
}
```

Add `reflect` to the test imports.

- [ ] **Step 2: Run tests and verify failure**

```powershell
Set-Location server
go test ./internal/protocol -run 'TestSessionUpdateMeta' -count=1
```

Expected: compile failure because the metadata fields/helpers do not exist.

- [ ] **Step 3: Add protocol representation and helpers**

Add to `SessionUpdate` in `acp.go`:

```go
Meta json.RawMessage `json:"_meta,omitempty"`
```

Add raw `_meta` to every existing Session Update turn projection in `session_turn.go`:

```go
type SessionTurnTextResult struct {
	Text string          `json:"text"`
	Meta json.RawMessage `json:"_meta,omitempty"`
}

type SessionTurnUserMessage struct {
	Text            string          `json:"text,omitempty"`
	ContentBlocks   []ContentBlock  `json:"contentBlocks,omitempty"`
	ClientMessageID string          `json:"clientMessageId,omitempty"`
	Steered         bool            `json:"steered,omitempty"`
	Meta            json.RawMessage `json:"_meta,omitempty"`
}

type SessionTurnToolResult struct {
	Cmd    string          `json:"cmd,omitempty"`
	Kind   string          `json:"kind,omitempty"`
	Status string          `json:"status,omitempty"`
	Meta   json.RawMessage `json:"_meta,omitempty"`
}

type SessionTurnPlanPayload struct {
	Entries []SessionTurnPlanResult `json:"entries"`
	Meta    json.RawMessage         `json:"_meta,omitempty"`
}
```

Create `acp_meta.go`:

```go
package protocol

import (
	"bytes"
	"encoding/json"
	"strings"
)

const (
	SessionMessagePhaseCommentary  = "commentary"
	SessionMessagePhaseFinalAnswer = "final_answer"
)

type sessionUpdateWheelMakerMeta struct {
	MessagePhase string `json:"messagePhase,omitempty"`
}

type sessionUpdateMetaEnvelope struct {
	WheelMaker sessionUpdateWheelMakerMeta `json:"wm"`
}

func NormalizeSessionMessagePhase(phase string) string {
	switch strings.TrimSpace(phase) {
	case SessionMessagePhaseCommentary:
		return SessionMessagePhaseCommentary
	case SessionMessagePhaseFinalAnswer:
		return SessionMessagePhaseFinalAnswer
	default:
		return ""
	}
}

func BuildSessionUpdateMetaMessagePhase(phase string) json.RawMessage {
	phase = NormalizeSessionMessagePhase(phase)
	if phase == "" {
		return nil
	}
	raw, err := json.Marshal(sessionUpdateMetaEnvelope{
		WheelMaker: sessionUpdateWheelMakerMeta{MessagePhase: phase},
	})
	if err != nil {
		return nil
	}
	return raw
}

func SessionUpdateMetaMessagePhase(meta json.RawMessage) string {
	if len(meta) == 0 {
		return ""
	}
	var envelope sessionUpdateMetaEnvelope
	if json.Unmarshal(meta, &envelope) != nil {
		return ""
	}
	return NormalizeSessionMessagePhase(envelope.WheelMaker.MessagePhase)
}

func CloneSessionUpdateMeta(meta json.RawMessage) json.RawMessage {
	return append(json.RawMessage(nil), meta...)
}

func EqualSessionUpdateMeta(left, right json.RawMessage) bool {
	return bytes.Equal(bytes.TrimSpace(left), bytes.TrimSpace(right))
}
```

- [ ] **Step 4: Format and pass protocol tests**

```powershell
gofmt -w internal/protocol/acp.go internal/protocol/acp_meta.go internal/protocol/session_turn.go internal/protocol/acp_test.go
go test ./internal/protocol -count=1
Set-Location ..
```

Expected: PASS.

- [ ] **Step 5: Commit protocol change**

```powershell
git add server/internal/protocol
git commit -m "feat(acp): carry official session update metadata"
```

---

### Task 3: Bridge Codex App Server phases into ACP `_meta`

**Files:**
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Modify: `server/internal/hub/agent/agent_test.go`

- [ ] **Step 1: Write failing live-delta and replay tests**

Add a live test that sends `item/started` before the delta and asserts `_meta.wm.messagePhase`:

```go
func TestCodexAppAgentMessageDeltaCarriesMessagePhaseMeta(t *testing.T) {
	conn := newCodexappConnWithRuntime(nil, t.TempDir())
	conn.bindSessionIDs("session-stable", "thread-runtime")
	updates := make(chan protocol.SessionUpdateParams, 2)
	conn.OnACPResponse(captureSessionUpdate(t, updates))

	conn.handleAppServerNotification("item/started", mustRaw(map[string]any{
		"threadId": "thread-runtime",
		"turnId":   "turn-1",
		"item": map[string]any{
			"id": "message-1", "type": "agentMessage", "phase": "commentary",
		},
	}))
	conn.handleAppServerNotification("item/agentMessage/delta", mustRaw(map[string]any{
		"threadId": "thread-runtime", "turnId": "turn-1", "itemId": "message-1", "delta": "working",
	}))
	update := waitForCodexappUpdate(t, updates)
	if got := protocol.SessionUpdateMetaMessagePhase(update.Update.Meta); got != protocol.SessionMessagePhaseCommentary {
		t.Fatalf("phase = %q, meta=%s", got, update.Update.Meta)
	}
}
```

Extend `TestCodexAppSessionLoadReplaysThreadTurnsBeforeReturning` with `"phase": "final_answer"` on the replayed agent item and assert the second update returns `final_answer`.

Add a cleanup assertion: after `item/completed`, a synthetic late delta with the same item ID has empty metadata. This proves the item map does not leak.

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
Set-Location server
go test ./internal/hub/agent -run 'TestCodexAppAgentMessageDeltaCarriesMessagePhaseMeta|TestCodexAppSessionLoadReplaysThreadTurnsBeforeReturning' -count=1
```

Expected: phase assertions fail because Adapter drops `item.phase`.

- [ ] **Step 3: Track phase by turn/item and emit metadata**

Add connection state:

```go
messagePhases map[string]string
```

Add helpers:

```go
func codexappMessagePhaseKey(turnID, itemID string) string {
	turnID = strings.TrimSpace(turnID)
	itemID = strings.TrimSpace(itemID)
	if turnID == "" || itemID == "" {
		return ""
	}
	return turnID + "\x00" + itemID
}

func (c *codexappConn) rememberMessagePhase(turnID, itemID, phase string) {
	key := codexappMessagePhaseKey(turnID, itemID)
	phase = protocol.NormalizeSessionMessagePhase(phase)
	if key == "" || phase == "" {
		return
	}
	c.mu.Lock()
	if c.messagePhases == nil {
		c.messagePhases = map[string]string{}
	}
	c.messagePhases[key] = phase
	c.mu.Unlock()
}

func (c *codexappConn) messagePhase(turnID, itemID string) string {
	key := codexappMessagePhaseKey(turnID, itemID)
	if key == "" {
		return ""
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.messagePhases[key]
}

func (c *codexappConn) forgetMessagePhase(turnID, itemID string) {
	key := codexappMessagePhaseKey(turnID, itemID)
	if key == "" {
		return
	}
	c.mu.Lock()
	delete(c.messagePhases, key)
	c.mu.Unlock()
}
```

On `item/started`, remember phase for `agentMessage`. On `item/completed`, forget it after existing item handling. Change agent delta emission to:

```go
c.emitTurnTextUpdateWithMeta(
	p.ThreadID,
	p.TurnID,
	protocol.SessionUpdateAgentMessageChunk,
	p.Delta,
	protocol.BuildSessionUpdateMetaMessagePhase(c.messagePhase(p.TurnID, p.ItemID)),
)
```

Keep existing callers via a wrapper:

```go
func (c *codexappConn) emitTurnTextUpdate(sessionID, turnID, updateType, text string) {
	c.emitTurnTextUpdateWithMeta(sessionID, turnID, updateType, text, nil)
}

func (c *codexappConn) emitTurnTextUpdateWithMeta(
	sessionID, turnID, updateType, text string,
	meta json.RawMessage,
) {
	update := protocol.SessionUpdateParams{
		SessionID: c.outboundSessionID(sessionID),
		Update: protocol.SessionUpdate{
			SessionUpdate: updateType,
			Content:       mustRaw(protocol.ContentBlock{Type: protocol.ContentBlockTypeText, Text: text}),
			Meta:          protocol.CloneSessionUpdateMeta(meta),
		},
	}
	if c.deferOrDropTurnUpdate(turnID, update) {
		return
	}
	c.emitSessionUpdate(update)
}
```

Change replay text emission to accept metadata and pass `item.Phase` for `agentMessage`; reasoning passes nil. Clear `messagePhases` whenever prompt/goal completion, cancellation synthesis, active-prompt failure, or prompt cleanup clears turn-local state.

- [ ] **Step 4: Format and pass Adapter tests**

```powershell
gofmt -w internal/hub/agent/codexapp_agent.go internal/hub/agent/agent_test.go
go test ./internal/hub/agent -run 'TestCodexApp' -count=1
Set-Location ..
```

Expected: PASS.

- [ ] **Step 5: Commit Adapter change**

```powershell
git add server/internal/hub/agent/codexapp_agent.go server/internal/hub/agent/agent_test.go
git commit -m "feat(codex): bridge message phases through acp metadata"
```

---

### Task 4: Persist complete `_meta` and split text metadata boundaries

**Files:**
- Modify: `server/internal/hub/client/session_recorder.go`
- Modify: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write failing Recorder tests**

Add a persistence test with two full metadata objects:

```go
func TestSessionViewPersistsCompleteTextMetaAndSplitsMetadataBoundaries(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-meta", "Meta")); err != nil {
		t.Fatal(err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-meta", "run", nil)); err != nil {
		t.Fatal(err)
	}
	commentaryMeta := json.RawMessage(`{"wm":{"messagePhase":"commentary"},"thirdParty":{"trace":"opaque"}}`)
	finalMeta := json.RawMessage(`{"wm":{"messagePhase":"final_answer"},"other":true}`)
	for _, update := range []acp.SessionUpdate{
		{SessionUpdate: acp.SessionUpdateAgentMessageChunk, Content: mustJSON(acp.ContentBlock{Type: "text", Text: "work"}), Meta: commentaryMeta},
		{SessionUpdate: acp.SessionUpdateAgentMessageChunk, Content: mustJSON(acp.ContentBlock{Type: "text", Text: "ing"}), Meta: commentaryMeta},
		{SessionUpdate: acp.SessionUpdateAgentMessageChunk, Content: mustJSON(acp.ContentBlock{Type: "text", Text: "done"}), Meta: finalMeta},
	} {
		if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-meta", update)); err != nil {
			t.Fatal(err)
		}
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-meta", "")); err != nil {
		t.Fatal(err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-meta", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns) != 4 {
		t.Fatalf("turns = %d, want prompt + commentary + final + done", len(turns))
	}
	commentary := decodeSessionTurnTextResult(t, turns[1].Content)
	final := decodeSessionTurnTextResult(t, turns[2].Content)
	if commentary.Text != "working" || !acp.EqualSessionUpdateMeta(commentary.Meta, commentaryMeta) {
		t.Fatalf("commentary = %#v", commentary)
	}
	if final.Text != "done" || !acp.EqualSessionUpdateMeta(final.Meta, finalMeta) {
		t.Fatalf("final = %#v", final)
	}
}
```

Add a table test proving User Message, Tool Result, and Plan payloads retain their complete `_meta`; a later Tool Call Update without metadata must preserve metadata from the start event.

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
Set-Location server
go test ./internal/hub/client -run 'TestSessionViewPersistsCompleteTextMetaAndSplitsMetadataBoundaries|TestParseSessionViewEvent.*Meta' -count=1
```

Expected: metadata is absent and commentary/final are merged.

- [ ] **Step 3: Copy metadata into turn projections**

In `parseSessionViewEvent`, clone `params.Update.Meta` into every persisted Session Update payload:

```go
meta := acp.CloneSessionUpdateMeta(params.Update.Meta)
```

Use `Meta: meta` for `SessionTurnUserMessage`, `SessionTurnTextResult`, `SessionTurnToolResult`, and `SessionTurnPlanPayload`.

Require equal metadata before merging adjacent text turns:

```go
case acp.SessionTurnMethodAgentMessage, acp.SessionTurnMethodAgentThought:
	if len(state.turns) > 0 {
		existing := state.turns[len(state.turns)-1]
		if existing.method == event.method && sessionTextTurnMetaEqual(existing.payload, event.payload) {
			mergedTurnIndex = existing.turnIndex
		}
	}
```

Add:

```go
func sessionTextTurnMetaEqual(left, right any) bool {
	leftText, leftOK := left.(acp.SessionTurnTextResult)
	rightText, rightOK := right.(acp.SessionTurnTextResult)
	return leftOK && rightOK && acp.EqualSessionUpdateMeta(leftText.Meta, rightText.Meta)
}
```

In `mergeTurnMessage`, preserve earlier metadata when a later state update omits it:

```go
if len(inc.Meta) == 0 {
	inc.Meta = acp.CloneSessionUpdateMeta(base.Meta)
}
```

Apply this rule to Text, User Message, Tool Result, and Plan payload cases without changing their existing content/status merge behavior.

- [ ] **Step 4: Format and pass Recorder tests**

```powershell
gofmt -w internal/hub/client/session_recorder.go internal/hub/client/client_test.go
go test ./internal/hub/client -count=1
Set-Location ..
```

Expected: PASS.

- [ ] **Step 5: Commit Recorder change**

```powershell
git add server/internal/hub/client/session_recorder.go server/internal/hub/client/client_test.go
git commit -m "feat(session): persist complete acp update metadata"
```

---

### Task 5: Derive streaming assistant groups and completed work groups

**Files:**
- Modify: `app/web/src/chat/projectAgents.ts`
- Modify: `app/web/src/chat/projectAgents.test.ts`
- Modify: `app/web/src/chat/turns/chatDisplayIndex.ts`
- Modify: `app/__tests__/web-chat-display-index.test.ts`

- [ ] **Step 1: Write failing Agent capability and Display Index tests**

Add Agent test:

```ts
expect(isCodexAppAgentType('codex')).toBe(true);
expect(isCodexAppAgentType('cx-deepseek')).toBe(true);
expect(isCodexAppAgentType('cx-other')).toBe(false);
expect(isCodexAppAgentType('claude')).toBe(false);
```

Add Display Index fixtures with:

```ts
const phased = (turnIndex: number, text: string, phase: 'commentary' | 'final_answer') => ({
  sessionId: 'sess-1',
  turnIndex,
  method: 'agent_message_chunk',
  param: {_meta: {wm: {messagePhase: phase}}, text},
  finished: true,
});
```

Cover:

1. Open prompt: adjacent commentary/final becomes one `assistant-group`; prompt and tools remain unchanged.
2. Completed success: prompt, `work-group`, final, prompt_done.
3. Work-group children retain thought and existing tool-group items in order.
4. Failed/cancelled/no-final: all work before prompt_done is grouped and status is `failed`/`stopped`.
5. Old history: last phase-less assistant message remains final.
6. Non-Codex option disabled: no work-group.
7. Work-group sourceIndexes and turn range include every child for search/jump.
8. Invalid/missing timestamps return `durationMs: 0`.

- [ ] **Step 2: Run focused Jest and verify failure**

```powershell
Set-Location app
npx jest web/src/chat/projectAgents.test.ts __tests__/web-chat-display-index.test.ts --runInBand
```

Expected: missing exports/options/kinds.

- [ ] **Step 3: Add exact Codex App Agent detection**

Export from `projectAgents.ts`:

```ts
export function isCodexAppAgentType(agentType?: string | null): boolean {
  const normalized = normalizeAgentTypeName(agentType).toLowerCase();
  return normalized === 'codex' || normalized === 'cx-deepseek';
}
```

- [ ] **Step 4: Extend Display Index types and grouping**

Extend item/options:

```ts
export type ChatWorkGroupStatus = 'worked' | 'failed' | 'stopped';

export type ChatDisplayIndexItem = {
  kind: 'turn' | 'assistant-group' | 'tool-group' | 'work-group' | 'pending' | 'queued';
  childItems?: ChatDisplayIndexItem[];
  workStatus?: ChatWorkGroupStatus;
  durationMs?: number;
  // existing fields unchanged
};

export type ChatDisplayIndexOptions = {
  collapseCompletedWork?: boolean;
  // existing options unchanged
};
```

Add strict metadata parser:

```ts
function assistantMessagePhase(message: RegistryChatMessage): 'commentary' | 'final_answer' | '' {
  if (message.method !== 'agent_message_chunk') return '';
  const meta = message.param?._meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return '';
  const wm = (meta as Record<string, unknown>).wm;
  if (!wm || typeof wm !== 'object' || Array.isArray(wm)) return '';
  const phase = (wm as Record<string, unknown>).messagePhase;
  return phase === 'commentary' || phase === 'final_answer' ? phase : '';
}
```

After building existing basic items, run a pure transformation when `collapseCompletedWork` is true:

```ts
const transformedItems = options.collapseCompletedWork
  ? buildCodexWorkDisplayItems(items, sorted.map(item => item.message), messages)
  : items;
```

`buildCodexWorkDisplayItems` must:

- pair each prompt start with its `prompt_done` per Session;
- choose first explicit `final_answer`, otherwise last phase-less assistant, otherwise no final;
- replace all basic items after prompt start and before final/done with one `work-group` containing those exact items;
- compute status from `resolvePromptDoneStatus` and duration from prompt `createdAt` / done `completedAt`;
- coalesce adjacent open-prompt assistant turns into `assistant-group` so Recorder's phase boundary does not alter the running UI;
- keep pending/queued items outside transformations.

Export a renderer helper:

```ts
export function combineAssistantGroupMessages(
  messages: RegistryChatMessage[],
): RegistryChatMessage | undefined {
  const group = messages.filter(message => message.method === 'agent_message_chunk');
  if (group.length === 0) return undefined;
  const first = group[0];
  const last = group[group.length - 1];
  return {
    ...last,
    turnIndex: first.turnIndex,
    param: {
      ...last.param,
      text: group.map(message => typeof message.param.text === 'string' ? message.param.text : '').join(''),
    },
  };
}
```

The work-group key is `${sessionId}:${promptTurnIndex}:${doneTurnIndex}:work-group`; assistant-group reuses the first item's key. A work group has `compact: true`, `estimatedHeight: 28`, flattened sourceIndexes, and first/last child turn indexes.

- [ ] **Step 5: Pass Display Index tests and typecheck**

```powershell
npx jest web/src/chat/projectAgents.test.ts __tests__/web-chat-display-index.test.ts --runInBand
npm run tsc:web
Set-Location ..
```

Expected: PASS.

- [ ] **Step 6: Commit pure Web grouping**

```powershell
git add app/web/src/chat/projectAgents.ts app/web/src/chat/projectAgents.test.ts app/web/src/chat/turns/chatDisplayIndex.ts app/__tests__/web-chat-display-index.test.ts
git commit -m "feat(web): derive codex completed work groups"
```

---

### Task 6: Render the neutral expandable work row

**Files:**
- Create: `app/web/src/chat/ChatWorkGroup.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/__tests__/web-chat-turn-groups.test.tsx`
- Modify: `app/__tests__/web-chat-turn-rendering.test.ts`

- [ ] **Step 1: Write failing component/rendering tests**

Test component behavior with `react-test-renderer`:

```tsx
let view!: ReactTestRenderer.ReactTestRenderer;
await ReactTestRenderer.act(() => {
  view = ReactTestRenderer.create(
    <ChatWorkGroup status="worked" durationMs={20_000}>
      <div className="work-child">Work</div>
    </ChatWorkGroup>,
  );
});
expect(view.root.findByProps({'aria-label': 'Expand completed work'}).props['aria-expanded']).toBe(false);
expect(view.root.findByProps({className: 'chat-work-group-label'}).children).toEqual(['Worked for 20.0s']);
expect(view.root.findAllByProps({className: 'chat-work-group-content'})).toHaveLength(0);
await ReactTestRenderer.act(() => {
  view.root.findByProps({'aria-label': 'Expand completed work'}).props.onClick();
});
expect(view.root.findByProps({className: 'chat-work-group-content'})).toBeTruthy();
```

Also assert `Failed after 20.0s`, `Stopped after 20.0s`, and missing-duration labels. Static integration assertions require `WorkspaceApp` to pass Codex flags for live/archive indexes and render `assistant-group` plus `work-group` child items.

- [ ] **Step 2: Run focused Jest and verify failure**

```powershell
Set-Location app
npx jest __tests__/web-chat-turn-groups.test.tsx __tests__/web-chat-turn-rendering.test.ts --runInBand
```

Expected: missing component and rendering branches.

- [ ] **Step 3: Implement `ChatWorkGroup`**

Create:

```tsx
import React from 'react';

import {formatPromptDurationMs} from '../workspace/sessionTime';
import {ChatIcon} from './ChatIcon';
import type {ChatWorkGroupStatus} from './turns/chatDisplayIndex';

function workLabel(status: ChatWorkGroupStatus, durationMs: number): string {
  const duration = durationMs > 0 ? formatPromptDurationMs(durationMs) : '';
  switch (status) {
    case 'failed':
      return duration ? `Failed after ${duration}` : 'Failed';
    case 'stopped':
      return duration ? `Stopped after ${duration}` : 'Stopped';
    default:
      return duration ? `Worked for ${duration}` : 'Worked';
  }
}

export const ChatWorkGroup = React.memo(function ChatWorkGroup({
  status,
  durationMs,
  children,
}: {
  status: ChatWorkGroupStatus;
  durationMs: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={`chat-view-content chat-work-group${open ? ' chat-work-group-open' : ''}`}>
      <button
        type="button"
        className="chat-work-group-header"
        aria-expanded={open}
        aria-label={open ? 'Collapse completed work' : 'Expand completed work'}
        onClick={() => setOpen(current => !current)}
      >
        <ChatIcon name="chevronRight" size={11} className="chat-work-group-chevron" />
        <span className="chat-work-group-label">{workLabel(status, durationMs)}</span>
      </button>
      {open ? <div className="chat-work-group-content">{children}</div> : null}
    </div>
  );
});
```

- [ ] **Step 4: Wire live/archive indexes and recursive child rendering**

Import `isCodexAppAgentType`, `ChatWorkGroup`, and `combineAssistantGroupMessages`.

Pass:

```ts
collapseCompletedWork: isCodexAppAgentType(selectedChatSession?.agentType)
```

to the live index, and use `archivedPreview?.session.agentType` for archive.

Refactor `renderChatVirtuosoItem` around a local `renderDisplayItem(item)` function. It must:

- combine `assistant-group` source messages with `combineAssistantGroupMessages` and render through the existing live/archive ChatTurn renderer;
- render existing `turn`, `tool-group`, pending, and queued branches unchanged;
- render `work-group` through `ChatWorkGroup` and recursively render its `childItems` inside wrappers whose `compact` class preserves the existing 4px/10px row spacing;
- apply search highlight to the outer work group when any internal turn matches.

- [ ] **Step 5: Add neutral styles**

Add near Thought/Tool Group styles:

```css
.chat-work-group {
  color: var(--text-secondary);
}

.chat-work-group-header {
  width: 100%;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.chat-work-group-chevron {
  color: var(--text-tertiary);
  opacity: 0.72;
  transition: transform 140ms ease;
}

.chat-work-group-open .chat-work-group-chevron {
  transform: rotate(90deg);
}

.chat-work-group-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.chat-work-group-content {
  margin-top: 10px;
}

.chat-work-group-child {
  padding-bottom: 10px;
}

.chat-work-group-child.compact {
  padding-bottom: 4px;
}

.chat-work-group-child:last-child {
  padding-bottom: 0;
}
```

Reduced-motion uses the existing Chat CSS rule pattern to disable Chevron transition.

- [ ] **Step 6: Pass UI tests, typecheck, and build**

```powershell
npx jest __tests__/web-chat-turn-groups.test.tsx __tests__/web-chat-turn-rendering.test.ts __tests__/web-chat-display-index.test.ts --runInBand
npm run tsc:web
npm run build:web
Set-Location ..
```

Expected: PASS; production Web build completes.

- [ ] **Step 7: Commit UI**

```powershell
git add app/web/src/chat/ChatWorkGroup.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-turn-groups.test.tsx app/__tests__/web-chat-turn-rendering.test.ts
git commit -m "feat(web): collapse completed codex work"
```

---

### Task 7: Update Wiki and run regression verification

**Files:**
- Modify: `docs/wiki/frontend-interaction/chat-turn-presentation.md`

- [ ] **Step 1: Update long-term Chat Turn documentation**

Update summary/source links and add a `Completed Work` section recording:

- Codex/CX DeepSeek only;
- streaming view unchanged;
- `_meta.wm.messagePhase` authority and old-history fallback;
- automatic success/failed/stopped collapse;
- final answer and prompt_done outside;
- local-only expansion state;
- 28px neutral row and duplicate top/bottom duration.

- [ ] **Step 2: Run Server regression**

```powershell
Set-Location server
go test ./internal/protocol ./internal/hub/agent ./internal/hub/client -count=1
go test ./... -count=1
Set-Location ..
```

Expected: PASS.

- [ ] **Step 3: Run Web regression**

```powershell
Set-Location app
npm test -- --runInBand
npm run tsc:web
npm run build:web
Set-Location ..
```

Expected: all Jest suites PASS; typecheck and build PASS.

- [ ] **Step 4: Review diff and forbidden changes**

```powershell
git diff --check
git status --short
git diff -- server/internal/protocol/registry.go app/web/src/registry/registryTypes.ts
```

Expected: no whitespace errors; only intended files; no Registry version/type change.

- [ ] **Step 5: Commit Wiki and verification record**

Mark completed plan checkboxes, record exact passing suite counts beneath this step, then:

```powershell
git add docs/wiki/frontend-interaction/chat-turn-presentation.md docs/scope/2026-08-02-codex-turn-work-collapse/plan-codex-turn-work-collapse.md
git commit -m "docs: record codex work collapse behavior"
```

---

### Task 8: Rebase and execute repository completion gate

**Files:**
- All task files from Tasks 1-7

- [ ] **Step 1: Synchronize branch**

```powershell
git fetch origin main
git rebase origin/main
```

Expected: clean rebase. Resolve only mechanical conflicts automatically; stop for semantic conflicts.

- [ ] **Step 2: Re-run focused post-rebase verification**

```powershell
Set-Location server
go test ./internal/protocol ./internal/hub/agent ./internal/hub/client -count=1
Set-Location ../app
npx jest __tests__/web-chat-display-index.test.ts __tests__/web-chat-turn-groups.test.tsx __tests__/web-chat-turn-rendering.test.ts --runInBand
npm run tsc:web
Set-Location ..
```

Expected: PASS.

- [ ] **Step 3: Execute required completion tail exactly**

Update this plan's final checkboxes and verification evidence, then run:

```powershell
git add -A
git commit -m "chore: finalize codex work collapse"
git push origin feat/codex-turn-work-collapse
```

Expected: commit succeeds; remote branch updated. Subsequent merge/cleanup follows `docs/user/git-preferences.md` only after `main` cleanliness is rechecked.
