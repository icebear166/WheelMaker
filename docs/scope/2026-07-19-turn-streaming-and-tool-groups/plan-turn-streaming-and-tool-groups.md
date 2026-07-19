# Turn Streaming and Tool Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Throttle full thinking-turn snapshots to one update per 60 seconds while preserving immediate boundaries, then present thinking and consecutive tool calls as stable, fixed-height collapsed rows in the virtual chat list.

**Architecture:** `SessionRecorder` remains the owner of complete in-memory turns and gains a per-session publish gate that affects only unfinished thinking snapshots. The Web keeps raw turns unchanged, projects consecutive tool turns into range-aware display-index items, and renders thinking/tool groups with stable local expansion state and virtualizer-compatible collapsed heights.

**Tech Stack:** Go 1.x, ACP/Registry session events, React 19, TypeScript 5.8, react-virtuoso, react-test-renderer, Jest 30, CSS.

---

### Task 1: Commit the approved design baseline

**Files:**
- Create: `docs/scope/2026-07-19-turn-streaming-and-tool-groups/spec-turn-streaming-and-tool-groups.md`
- Create: `docs/scope/2026-07-19-turn-streaming-and-tool-groups/plan-turn-streaming-and-tool-groups.md`
- Create: `docs/wiki/frontend-interaction/chat-turn-presentation.md`
- Modify: `docs/wiki/frontend-interaction/frontend-interaction.md`
- Modify: `docs/wiki/architecture/session-management-and-sync.md`

- [x] **Step 1: Validate the approved docs**

Run:

```powershell
git diff --check -- docs/scope/2026-07-19-turn-streaming-and-tool-groups docs/wiki/frontend-interaction docs/wiki/architecture/session-management-and-sync.md
```

Expected: `git diff --check` reports no whitespace errors; the scope self-review has already removed placeholders and ambiguous requirements.

- [x] **Step 2: Commit the approved docs**

```powershell
git add docs/scope/2026-07-19-turn-streaming-and-tool-groups docs/wiki/frontend-interaction docs/wiki/architecture/session-management-and-sync.md
git commit -m "docs: specify thinking throttle and tool groups"
```

Expected: one docs commit on `feat/turn-streaming-ui`.

### Task 2: Throttle unfinished thinking snapshots at the SessionRecorder publish boundary

**Files:**
- Modify: `server/internal/hub/client/session_recorder.go:68-174`
- Modify: `server/internal/hub/client/session_recorder.go:679-745`
- Test: `server/internal/hub/client/client_test.go:5124-5460`

- [x] **Step 1: Write failing recorder tests with a controlled clock**

Add tests next to the existing merged-turn/prompt-finish publish tests. The helper records only thought `session.message` events so prompt and summary events do not affect counts:

```go
func capturePublishedThoughtTurns(t *testing.T, c *Client) *[]sessionViewTurn {
	t.Helper()
	published := []sessionViewTurn{}
	c.sessionRecorder.SetEventPublisher(func(method string, payload any) error {
		if method != acp.RegistryMethodSessionMessage {
			return nil
		}
		body, ok := payload.(map[string]any)
		if !ok {
			t.Fatalf("payload type = %T, want map[string]any", payload)
		}
		turn := decodePublishedTurnMessage(t, body)
		if decodeSessionTurnMessage(t, turn.Content).Method == acp.SessionTurnMethodAgentThought {
			published = append(published, turn)
		}
		return nil
	})
	return &published
}

func TestSessionViewThoughtSnapshotsAreThrottledAndBoundaryFlushed(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 19, 10, 0, 0, 0, time.UTC)
	c.sessionRecorder.now = func() time.Time { return now }
	published := capturePublishedThoughtTurns(t, c)

	requireRecord := func(event SessionViewEvent) {
		t.Helper()
		if err := c.RecordEvent(ctx, event); err != nil {
			t.Fatalf("RecordEvent: %v", err)
		}
	}
	requireRecord(sessionViewCreatedEvent("sess-1", "Thought throttle"))
	requireRecord(sessionViewPromptEvent("sess-1", "run", nil))
	requireRecord(sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentThoughtChunk,
		Content: mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "one"}),
	}))
	now = now.Add(59 * time.Second)
	requireRecord(sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentThoughtChunk,
		Content: mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: " two"}),
	}))
	if len(*published) != 1 {
		t.Fatalf("thought publishes before interval = %d, want 1", len(*published))
	}
	now = now.Add(time.Second)
	requireRecord(sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentThoughtChunk,
		Content: mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: " three"}),
	}))
	if len(*published) != 2 {
		t.Fatalf("thought publishes at interval = %d, want 2", len(*published))
	}
	requireRecord(sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentThoughtChunk,
		Content: mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: " four"}),
	}))
	requireRecord(sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateToolCall,
		ToolCallID: "tool-1", Title: "Read files", Status: "in_progress",
	}))
	if len(*published) != 3 || !(*published)[2].Finished {
		t.Fatalf("boundary thought publishes = %+v, want final finished snapshot", *published)
	}
	final := decodeSessionTurnMessage(t, (*published)[2].Content)
	var text acp.SessionTurnTextResult
	if err := json.Unmarshal(final.Param, &text); err != nil {
		t.Fatalf("unmarshal thought text: %v", err)
	}
	if text.Text != "one two three four" {
		t.Fatalf("final thought = %q, want complete text", text.Text)
	}
}
```

Also add focused tests that (a) prompt completion immediately seals a suppressed thought before `prompt_done`, (b) two sessions each publish their first thought immediately, and (c) `session.read` after completion returns the concatenation of every suppressed chunk.

- [x] **Step 2: Run the new tests and verify the missing clock/gate fails**

Run:

```powershell
go test ./internal/hub/client -run "TestSessionViewThoughtSnapshots|TestSessionViewThoughtThrottle" -count=1
```

Expected: FAIL because `SessionRecorder.now` and the throttle behavior do not exist.

- [x] **Step 3: Add per-session thinking publish state**

Add the gate beside the existing recorder state:

```go
const sessionThoughtPublishInterval = 60 * time.Second

type sessionThoughtPublishState struct {
	turnIndex       int64
	lastPublishedAt time.Time
}

type SessionRecorder struct {
	// existing fields...
	now                    func() time.Time
	thoughtPublishBySession map[string]sessionThoughtPublishState
}
```

Initialize it in `newSessionRecorder`:

```go
now:                     time.Now,
thoughtPublishBySession: map[string]sessionThoughtPublishState{},
```

Reset the map in `Close` and `ResetPromptState`, and delete its session entry in `RemovePromptState`.

- [x] **Step 4: Route live turns through the thinking-only gate**

Keep `publishSessionTurn` as the unconditional wire publisher and add:

```go
func (r *SessionRecorder) publishLiveSessionTurn(turn sessionTurnMessage, content string) {
	if turn.method != acp.SessionTurnMethodAgentThought || turn.finished {
		r.publishSessionTurn(turn, content)
		return
	}
	now := r.now().UTC()
	last, ok := r.thoughtPublishBySession[turn.sessionID]
	if ok && last.turnIndex == turn.turnIndex && now.Sub(last.lastPublishedAt) < sessionThoughtPublishInterval {
		return
	}
	r.publishSessionTurn(turn, content)
	r.thoughtPublishBySession[turn.sessionID] = sessionThoughtPublishState{
		turnIndex: turn.turnIndex,
		lastPublishedAt: now,
	}
}

func (r *SessionRecorder) clearThoughtPublishState(turn sessionTurnMessage) {
	if turn.method == acp.SessionTurnMethodAgentThought {
		delete(r.thoughtPublishBySession, turn.sessionID)
	}
}
```

Change `addMessageTurn` to call `publishLiveSessionTurn`. Keep `publishOpenTextTurnDone` unconditional, then call `clearThoughtPublishState(turn)` after publishing the final snapshot. This guarantees the seal event precedes a tool/message/prompt-done event and makes a later thinking block publish immediately.

- [x] **Step 5: Run recorder tests and the complete client package**

Run:

```powershell
go test ./internal/hub/client -run "TestSessionViewThoughtSnapshots|TestSessionViewThoughtThrottle" -count=1
go test ./internal/hub/client -count=1
```

Expected: both commands PASS.

- [x] **Step 6: Commit the server change**

```powershell
git add server/internal/hub/client/session_recorder.go server/internal/hub/client/client_test.go
git commit -m "feat(hub): throttle live thinking snapshots"
```

### Task 3: Project consecutive tool calls as one range-aware display item

**Files:**
- Modify: `app/web/src/chat/turns/chatDisplayIndex.ts:9-57`
- Modify: `app/web/src/chat/turns/chatDisplayIndex.ts:393-480`
- Test: `app/__tests__/web-chat-display-index.test.ts:1-125`

- [x] **Step 1: Replace hide-tool tests with grouping and range tests**

Add a tool-message helper and expectations for adjacent grouping, non-tool boundaries, stable keys, fixed estimates, and contained-turn navigation:

```ts
function toolMessage(turnIndex: number, cmd: string, status = 'completed'): RegistryChatMessage {
  return {
    sessionId: 'sess-1',
    turnIndex,
    method: 'tool_call',
    param: {cmd, kind: 'read', status},
    finished: true,
  };
}

test('groups consecutive tool calls with a stable first-turn key and fixed estimate', () => {
  const index = buildChatDisplayIndex([
    message(1, 'prompt_request', 'hello'),
    toolMessage(2, 'Read a'),
    toolMessage(3, 'Read b', 'in_progress'),
    message(4, 'agent_thought_chunk', 'thinking'),
    toolMessage(5, 'Run tests'),
  ]);

  expect(index.items.map(item => item.kind)).toEqual([
    'turn', 'tool-group', 'turn', 'tool-group',
  ]);
  expect(index.items[1]).toMatchObject({
    key: 'sess-1:2:tool-group',
    turnIndex: 2,
    endTurnIndex: 3,
    sourceIndexes: [1, 2],
  });
  expect(index.items[1].estimatedHeight).toBe(index.items[3].estimatedHeight);
});

test('resolves every grouped tool turn to the same display item', () => {
  const index = buildChatDisplayIndex([
    message(1, 'prompt_request', 'hello'),
    toolMessage(2, 'Read a'),
    toolMessage(3, 'Read b'),
    message(4, 'agent_message_chunk', 'done'),
  ]);

  expect(resolveChatDisplayScrollIndex(index, 2)).toBe(1);
  expect(resolveChatDisplayScrollIndex(index, 3)).toBe(1);
  expect(chatDisplayItemContainsTurn(index.items[1], 3)).toBe(true);
});
```

- [x] **Step 2: Run the display-index test and verify it fails**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-display-index.test.ts
```

Expected: FAIL because `tool-group`, range metadata, and `chatDisplayItemContainsTurn` do not exist.

- [x] **Step 3: Extend display metadata with turn ranges and source indexes**

Use one consistent lightweight shape for every item:

```ts
export type ChatDisplayIndexItem = {
  kind: 'turn' | 'tool-group' | 'pending' | 'queued';
  key: string;
  turnIndex: number;
  endTurnIndex: number;
  sourceIndex: number;
  sourceIndexes: number[];
  estimatedHeight: number;
};

export function chatDisplayItemContainsTurn(
  item: ChatDisplayIndexItem,
  turnIndex: number,
): boolean {
  const target = Math.max(0, Math.trunc(turnIndex));
  return target > 0 && target >= item.turnIndex && target <= item.endTurnIndex;
}
```

Keep `hideToolCalls` temporarily in `ChatDisplayIndexOptions` so the intermediate commit remains type-compatible with `WorkspaceApp`, but stop consulting it during projection; Task 6 removes the obsolete option and callers together. During the sorted scan, clear the current tool-group reference before processing every non-tool item, including hidden plans. For a tool item, append its source index and extend `endTurnIndex` when a group is open; otherwise push a new item keyed from the first tool turn. Use `metrics.thoughtCollapsedHeight` for thoughts and `metrics.toolLineHeight` for every collapsed tool group, independent of content and group size.

Populate `endTurnIndex` and `sourceIndexes` for ordinary, pending, and queued items as well (`turnIndex`/`[sourceIndex]` for turns, `0`/`[]` for synthetic items) so consumers do not branch on missing metadata.

Update the first metadata-shape test to expect the two new keys:

```ts
expect(Object.keys(index.items[0]).sort()).toEqual([
  'endTurnIndex',
  'estimatedHeight',
  'key',
  'kind',
  'sourceIndex',
  'sourceIndexes',
  'turnIndex',
]);
```

- [x] **Step 4: Make scroll resolution range-aware**

Replace the exact-turn lookup with:

```ts
const exactIndex = displayIndex.items.findIndex(item =>
  chatDisplayItemContainsTurn(item, targetTurnIndex),
);
```

Keep the existing nearest-following and last-item fallback behavior.

- [x] **Step 5: Run display-index tests and TypeScript**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-display-index.test.ts
npm --prefix app run tsc:web
```

Expected: display-index tests and TypeScript PASS. `WorkspaceApp` will not render the new group kind until Task 5, but its existing non-exhaustive branch remains type-safe.

- [x] **Step 6: Commit the display projection**

```powershell
git add app/web/src/chat/turns/chatDisplayIndex.ts app/__tests__/web-chat-display-index.test.ts
git commit -m "feat(app): group tool calls in chat display index"
```

### Task 4: Make thinking status-aware without changing collapsed height

**Files:**
- Modify: `app/web/src/chat/ChatTurnView.tsx:194-242`
- Modify: `app/web/src/chat/ChatTurnView.tsx:288-655`
- Modify: `app/web/src/styles/chat.css:2675-2761`
- Test: `app/__tests__/web-chat-turn-groups.test.tsx`
- Test: `app/__tests__/web-chat-ui.test.ts:670-700`

- [x] **Step 1: Add a failing interaction test for streaming and completed thinking**

Create `web-chat-turn-groups.test.tsx` with shared message/render helpers and this test:

```tsx
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {ChatTurnView} from '../web/src/chat/ChatTurnView';
import type {RegistryChatMessage} from '../web/src/registry/registryTypes';

const markdownComponents = {};
const markdownUrlTransform = (value: string) => value;

function thought(text: string, finished: boolean): RegistryChatMessage {
  return {
    sessionId: 'sess-1', turnIndex: 2, method: 'agent_thought_chunk',
    param: {text}, finished,
  };
}

test('keeps thinking collapsed by default and preserves an active expansion', async () => {
  let view!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    view = ReactTestRenderer.create(
      <ChatTurnView
        message={thought('Inspecting files', false)}
        hideToolCalls={false}
        markdownComponents={markdownComponents}
        markdownUrlTransform={markdownUrlTransform}
      />,
    );
  });
  expect(view.root.findByProps({className: 'chat-thought-title'}).children).toEqual(['Thinking']);
  expect(view.root.findAllByProps({className: 'chat-thought-content'})).toHaveLength(0);

  await ReactTestRenderer.act(() => {
    view.root.findByProps({'aria-label': 'Expand thinking'}).props.onClick();
  });
  expect(view.root.findAllByProps({className: 'chat-thought-content'})).toHaveLength(1);

  await ReactTestRenderer.act(() => {
    view.update(
      <ChatTurnView
        message={thought('Inspecting files\nFound the renderer', true)}
        hideToolCalls={false}
        markdownComponents={markdownComponents}
        markdownUrlTransform={markdownUrlTransform}
      />,
    );
  });
  expect(view.root.findAllByProps({className: 'chat-thought-content'})).toHaveLength(1);
  await ReactTestRenderer.act(() => {
    view.root.findByProps({'aria-label': 'Collapse thinking'}).props.onClick();
  });
  expect(view.root.findByProps({className: 'chat-thought-title'}).children).toEqual(['Inspecting files']);
});
```

- [x] **Step 2: Run the test and verify it fails**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-turn-groups.test.tsx
```

Expected: FAIL because thinking does not receive `message.finished`, uses different title classes, and lacks the required aria labels.

- [x] **Step 3: Pass `finished` into the collapsible thought and render explicit states**

Change the thought component contract to include `finished`. Keep `open` local and derive the closed label without changing component identity:

```tsx
const title = finished ? firstLine || 'Thinking' : 'Thinking';
const toggleLabel = open ? 'Collapse thinking' : 'Expand thinking';

return (
  <div className={`chat-thought-block${open ? ' chat-thought-open' : ''}${finished ? ' done' : ' streaming'}`}>
    <button
      type="button"
      className="chat-thought-header"
      aria-expanded={open}
      aria-label={toggleLabel}
      onClick={() => setOpen(current => !current)}
    >
      <span className="codicon codicon-chevron-right chat-thought-chevron" aria-hidden="true" />
      <span className="codicon codicon-lightbulb chat-thought-icon" aria-hidden="true" />
      <span className="chat-thought-title" title={finished ? firstLine : undefined}>{title}</span>
    </button>
    {open ? <div className="chat-thought-content">...</div> : null}
  </div>
);
```

Pass `finished={message.finished}` from the thought branch. Leave the legacy `hideToolCalls` prop and single-tool branch in place until Task 6 removes the preference end to end; Task 5 will route display-index tool groups around that branch.

- [x] **Step 4: Replace blue thought styling with fixed-height neutral styling**

Update the active `.chat-thought-*` rules to enforce a 28px collapsed header:

```css
.chat-thought-block {
  margin: 2px 0;
  color: var(--text-secondary);
}

.chat-thought-header {
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
  cursor: pointer;
}

.chat-thought-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-thought-block.streaming .chat-thought-icon {
  animation: chatThinkingPulse 1.4s ease-in-out infinite;
}

.chat-thought-content {
  margin: 4px 0 0 28px;
  padding: 0;
  background: transparent;
  color: var(--text-secondary);
}
```

Retain the rotating chevron for open state. Remove the accent-mixed left border and accent-mixed content background. Add `@keyframes chatThinkingPulse` near the component styles.

- [x] **Step 5: Run thinking interaction and UI style tests**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-turn-groups.test.tsx __tests__/web-chat-ui.test.ts
```

Expected: PASS, including source assertions that the thought header has a fixed height, single-line ellipsis, and no accent-mixed background/border.

- [x] **Step 6: Commit the thinking UI**

```powershell
git add app/web/src/chat/ChatTurnView.tsx app/web/src/styles/chat.css app/__tests__/web-chat-turn-groups.test.tsx app/__tests__/web-chat-ui.test.ts
git commit -m "feat(app): refine streaming thinking presentation"
```

### Task 5: Render stable expandable tool-call groups in live and archived chat

**Files:**
- Create: `app/web/src/chat/ChatToolCallGroup.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx:135-150`
- Modify: `app/web/src/app/WorkspaceApp.tsx:3575-3620`
- Modify: `app/web/src/app/WorkspaceApp.tsx:18478-18720`
- Modify: `app/web/src/styles/chat.css:2675-2761`
- Test: `app/__tests__/web-chat-turn-groups.test.tsx`
- Test: `app/__tests__/web-chat-display-index.test.ts`

- [x] **Step 1: Add failing tool-group interaction tests**

Extend `web-chat-turn-groups.test.tsx`:

```tsx
import {ChatToolCallGroup} from '../web/src/chat/ChatToolCallGroup';

function tool(turnIndex: number, cmd: string, status: string): RegistryChatMessage {
  return {
    sessionId: 'sess-1', turnIndex, method: 'tool_call',
    param: {cmd, kind: 'read', status}, finished: true,
  };
}

test('summarizes the latest tool and stays expanded when the group grows', async () => {
  let view!: ReactTestRenderer.ReactTestRenderer;
  const first = [tool(2, 'Read CLAUDE.md', 'completed'), tool(3, 'Search turns', 'in_progress')];
  await ReactTestRenderer.act(() => {
    view = ReactTestRenderer.create(<ChatToolCallGroup messages={first} />);
  });
  expect(view.root.findByProps({className: 'chat-tool-group-count'}).children).toEqual(['Call 2 tools']);
  expect(view.root.findByProps({className: 'chat-tool-group-latest'}).children).toEqual(['Search turns']);
  expect(view.root.findAllByProps({className: 'chat-tool-group-list'})).toHaveLength(0);

  await ReactTestRenderer.act(() => {
    view.root.findByProps({'aria-label': 'Expand 2 tool calls'}).props.onClick();
  });
  await ReactTestRenderer.act(() => {
    view.update(<ChatToolCallGroup messages={[...first, tool(4, 'Run tests', 'completed')]} />);
  });
  expect(view.root.findAllByProps({className: 'chat-tool-group-row'})).toHaveLength(3);
  expect(view.root.findByProps({className: 'chat-tool-group-count'}).children).toEqual(['Call 3 tools']);
  expect(view.root.findByProps({className: 'chat-tool-group-latest'}).children).toEqual(['Run tests']);
});
```

- [x] **Step 2: Run the interaction test and verify it fails**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-turn-groups.test.tsx
```

Expected: FAIL because `ChatToolCallGroup` does not exist.

- [x] **Step 3: Implement the focused tool-group component**

Create `ChatToolCallGroup.tsx` with a normalized view model:

```tsx
type ToolCallView = {
  title: string;
  kind: string;
  status: string;
};

function toolCallView(message: RegistryChatMessage): ToolCallView {
  const title = typeof message.param.cmd === 'string' && message.param.cmd.trim()
    ? message.param.cmd.trim()
    : 'Tool call';
  return {
    title,
    kind: typeof message.param.kind === 'string' ? message.param.kind.trim() : '',
    status: typeof message.param.status === 'string' ? message.param.status.trim().toLowerCase() : '',
  };
}

function toolStatusIcon(status: string): string {
  if (status === 'in_progress' || status === 'pending' || status === 'running') {
    return 'codicon-loading codicon-modifier-spin';
  }
  if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
    return 'codicon-error';
  }
  if (status === 'completed' || status === 'done') {
    return 'codicon-pass-filled';
  }
  return 'codicon-tools';
}
```

The component owns `open`, renders a fixed-height button with chevron, latest-status icon, `Call X tool(s)`, separator, and latest title. When open, render every normalized call in turn order with status icon, title, and optional kind. Use `aria-expanded`, `Expand X tool calls`/`Collapse X tool calls`, and `title={latest.title}`.

- [x] **Step 4: Route `tool-group` display items through the new component**

Import `ChatToolCallGroup` and `chatDisplayItemContainsTurn` in `WorkspaceApp.tsx`. Remove `hideToolCalls` from both display-index option objects and from `shouldRenderChatTurn`; tool turns return `true` when considered individually.

In `renderChatVirtuosoItem`, resolve group messages from stable source indexes:

```tsx
const sourceToolMessages = displayItem.kind === 'tool-group'
  ? displayItem.sourceIndexes
      .map(sourceIndex => sourceMessages[sourceIndex])
      .filter((message): message is RegistryChatMessage => !!message && message.method === 'tool_call')
  : [];
```

Before ordinary `sourceMessage` branches, render:

```tsx
displayItem.kind === 'tool-group' && sourceToolMessages.length > 0 ? (
  <div
    className={[
      'chat-view-content',
      sessionSearchTargetTurn &&
      chatDisplayItemContainsTurn(displayItem, sessionSearchTargetTurn.turnIndex)
        ? 'chat-turn-search-highlight'
        : '',
    ].filter(Boolean).join(' ')}
  >
    <ChatToolCallGroup messages={sourceToolMessages} />
  </div>
) :
```

Use `chatDisplayItemContainsTurn` in the search-target visibility check so any grouped turn can trigger virtualizer scrolling. This same branch consumes `archivedPreview.messages`, giving live and archive views identical behavior.

- [x] **Step 5: Add neutral fixed-height tool-group styles**

Replace the old `.chat-tool-line` rules with:

```css
.chat-tool-group-header {
  width: 100%;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.chat-tool-group-latest {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-tool-group-list {
  margin: 4px 0 0 28px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-tool-group-row {
  min-height: 22px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}
```

Add rotated-chevron, status color, kind text, and title truncation rules without a card background or accent border.

- [x] **Step 6: Run group, display-index, UI, and type tests**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-turn-groups.test.tsx __tests__/web-chat-display-index.test.ts __tests__/web-chat-ui.test.ts
npm --prefix app run tsc:web
```

Expected: all commands PASS.

- [x] **Step 7: Commit the grouped tool UI**

```powershell
git add app/web/src/chat/ChatToolCallGroup.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-turn-groups.test.tsx app/__tests__/web-chat-display-index.test.ts
git commit -m "feat(app): render expandable tool call groups"
```

### Task 6: Remove the obsolete Hide Tool Calls setting and persistence field

**Files:**
- Modify: `app/web/src/workspace/WorkspacePersistence.ts:79-96`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts:309-366`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts:567-612`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts:1278-1295`
- Modify: `app/web/src/settings/SettingsRootContent.tsx:40-60`
- Modify: `app/web/src/settings/SettingsRootContent.tsx:175-300`
- Modify: `app/web/src/app/WorkspaceApp.tsx:2550-2565`
- Modify: `app/web/src/app/WorkspaceApp.tsx:6178-6225`
- Modify: `app/web/src/app/WorkspaceApp.tsx:17028-17048`
- Modify: `app/__tests__/web-hide-tool-calls-settings.test.ts`
- Modify: `app/__tests__/web-chat-turn-groups.test.tsx`
- Modify: `app/__tests__/web-chat-ui.test.ts:548-553`
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts:166-174`

- [x] **Step 1: Invert the legacy-setting test to require full removal**

Replace the assertions in `web-hide-tool-calls-settings.test.ts` with:

```ts
test('removes the obsolete tool-call hiding preference', () => {
  expect(workspacePersistence).not.toContain('hideToolCalls');
  expect(settingsRootTsx).not.toContain('Hide Tool Calls');
  expect(settingsRootTsx).not.toContain('setHideToolCalls');
  expect(mainTsx).not.toContain('hideToolCalls');
  expect(chatTurnTsx).not.toContain('hideToolCalls');
});
```

Update the two broader settings tests to assert that the Chat section does **not** contain `Hide Tool Calls`.

- [x] **Step 2: Run the settings tests and verify they fail**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-hide-tool-calls-settings.test.ts __tests__/web-chat-ui.test.ts __tests__/web-agent-package-update-settings.test.ts
```

Expected: FAIL while the persisted field, React state, and settings control remain.

- [x] **Step 3: Remove the preference end to end**

Delete `hideToolCalls` from `PersistedGlobalState`, `GLOBAL_KEYS`, `defaultGlobalState`, `sanitizeGlobalState`, and `replaceAllState` rows. Do not delete old IndexedDB rows; because the key is no longer in `GLOBAL_KEYS`, hydration naturally ignores the orphaned value.

Delete the setting props and checkbox from `SettingsRootContent`. Delete the React state, global-state patch/dependency, display/render props, and `SettingsRootContent` props from `WorkspaceApp`. Delete the prop and conditional hide branch from `ChatTurnView`, then remove the transitional `hideToolCalls={false}` props from `web-chat-turn-groups.test.tsx`. Verify no production source contains the identifier:

```powershell
rg -n "hideToolCalls|Hide Tool Calls" app/web/src
```

Expected: no matches.

- [x] **Step 4: Run settings tests and the complete Web test/type suite**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-hide-tool-calls-settings.test.ts __tests__/web-chat-ui.test.ts __tests__/web-agent-package-update-settings.test.ts
npm --prefix app test -- --runInBand
npm --prefix app run tsc:web
```

Result: the scoped tests and TypeScript pass. The full suite passes 1,074/1,075 tests; the sole failure is the pre-existing `web-settings-navigation.test.ts` expectation that omits `releasePublish`, reproduced unchanged on the main worktree.

- [x] **Step 5: Commit preference removal**

```powershell
git add app/web/src/workspace/WorkspacePersistence.ts app/web/src/settings/SettingsRootContent.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/chat/ChatTurnView.tsx app/__tests__/web-hide-tool-calls-settings.test.ts app/__tests__/web-chat-turn-groups.test.tsx app/__tests__/web-chat-ui.test.ts app/__tests__/web-agent-package-update-settings.test.ts
git commit -m "refactor(app): remove hidden tool call preference"
```

### Task 7: Run repository-level verification and prepare the completion commit

**Files:**
- Modify: `docs/scope/2026-07-19-turn-streaming-and-tool-groups/plan-turn-streaming-and-tool-groups.md` (mark completed checkboxes)

- [x] **Step 1: Format modified production and test files**

Run:

```powershell
gofmt -w server/internal/hub/client/session_recorder.go server/internal/hub/client/client_test.go
npx prettier --write web/src/chat/ChatTurnView.tsx web/src/chat/ChatToolCallGroup.tsx web/src/chat/turns/chatDisplayIndex.ts web/src/app/WorkspaceApp.tsx web/src/settings/SettingsRootContent.tsx web/src/workspace/WorkspacePersistence.ts web/src/styles/chat.css __tests__/web-chat-turn-groups.test.tsx __tests__/web-chat-display-index.test.ts __tests__/web-hide-tool-calls-settings.test.ts __tests__/web-chat-ui.test.ts __tests__/web-agent-package-update-settings.test.ts
```

Run the Prettier command from `app/`. Expected: files are formatted without errors.

Result: `gofmt` completed without residual Go diffs. Prettier was evaluated but would rewrite roughly 17,000 lines across legacy files because the existing source is not normalized to the checked-in Prettier configuration, so that purely mechanical out-of-scope rewrite was reverted.

- [x] **Step 2: Run server verification**

Run from `server/`:

```powershell
go test ./...
go build ./cmd/wheelmaker/
```

Expected: both commands PASS.

- [x] **Step 3: Run Web verification**

Run from `app/`:

```powershell
npm test -- --runInBand
npm run tsc:web
npm run build:web
```

Expected: Jest, TypeScript, and production webpack build all PASS; the build writes only to the configured WheelMaker Web output and does not require scanning `app/dist`.

Result: TypeScript and the production webpack build pass. Full Jest reports 1,074/1,075 tests passing; its sole failure is the inherited `web-settings-navigation.test.ts` expectation already reproduced on the main worktree. Excluding only that known baseline file, all 200 suites and 1,067 tests pass.

- [x] **Step 4: Audit the final diff against the spec**

Run:

```powershell
git diff --check
git status --short
git diff --stat main...HEAD
rg -n "hideToolCalls|Hide Tool Calls" app/web/src
```

Expected: no whitespace errors, only scoped files are changed, the production-source search has no matches, and the diff contains no protocol-version change or tool-output expansion.

- [x] **Step 5: Mark the plan complete and execute the repository completion gate**

After every preceding checkbox is verified, mark them complete in this file, then run the required final tail sequence from the worktree root:

```powershell
git add -A
git commit -m "feat: optimize thinking and tool turn streaming"
git push origin feat/turn-streaming-ui
```

Expected: the final tracking/docs commit succeeds and the branch is pushed to `origin`.
