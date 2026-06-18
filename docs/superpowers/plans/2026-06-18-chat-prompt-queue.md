# Chat Prompt Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a client-only multi-prompt queue that lets users submit, cancel, and prioritize queued prompts while the current chat prompt is running.

**Architecture:** Add a focused queue state module under chat session code and keep queued prompts in `WorkspaceApp` memory by runtime key. Extend the chat display index and `ChatTurnView` to render queued prompt rows with Cancel and Send next actions. Change `sendChatMessage` so running sessions enqueue instead of calling `session.send`, then drain the queue after prompt completion or cancellation.

**Tech Stack:** React, TypeScript, Jest, existing Registry `session.send` / `session.cancel`, existing chat display index and pending prompt rendering.

---

## File Structure

- Create `app/web/src/chat/session/chatPromptQueue.ts`
  - Owns queue item types and pure helpers: enqueue, cancel, move to front, shift next, move runtime key, build queued prompt message.
- Create `app/__tests__/web-chat-prompt-queue-state.test.ts`
  - Pure unit tests for queue behavior.
- Modify `app/web/src/chat/turns/chatPromptStatus.ts`
  - Add `queued` to `ChatPromptStatus`.
- Modify `app/web/src/chat/turns/chatDisplayIndex.ts`
  - Add `queued` display items and height estimation.
- Modify `app/web/src/chat/ChatTurnView.tsx`
  - Render queued status and queued prompt actions.
- Modify `app/web/src/app/WorkspaceApp.tsx`
  - Keep per-session queue state, enqueue while running, render queue items, cancel/prioritize queue items, auto-drain after completion/cancel.
- Modify `app/web/src/styles/chat.css`
  - Add queued prompt visual treatment and action styling.
- Modify existing tests:
  - `app/__tests__/web-chat-turn-rendering.test.ts`
  - `app/__tests__/web-chat-ui.test.ts`

---

### Task 1: Queue State Model

**Files:**
- Create: `app/web/src/chat/session/chatPromptQueue.ts`
- Test: `app/__tests__/web-chat-prompt-queue-state.test.ts`

- [ ] **Step 1: Write failing queue state tests**

Add `app/__tests__/web-chat-prompt-queue-state.test.ts`:

```ts
import {
  buildQueuedPromptMessage,
  cancelQueuedChatPrompt,
  enqueueChatPrompt,
  moveQueuedChatPromptToFront,
  shiftNextQueuedChatPrompt,
  type QueuedChatPrompt,
} from '../web/src/chat/session/chatPromptQueue';

const basePrompt = (id: string, text: string): QueuedChatPrompt => ({
  id,
  sessionId: 'sess-1',
  blocks: [{type: 'text', text}],
  createdAt: `2026-06-18T00:00:0${id}.000Z`,
  text,
});

describe('chat prompt queue state', () => {
  test('enqueues multiple prompts in FIFO order', () => {
    const first = basePrompt('1', 'first');
    const second = basePrompt('2', 'second');
    const state = enqueueChatPrompt(enqueueChatPrompt({}, 'project:sess-1', first), 'project:sess-1', second);

    expect(state['project:sess-1'].map(item => item.text)).toEqual(['first', 'second']);
  });

  test('cancels one queued prompt without changing the rest', () => {
    const state = {
      'project:sess-1': [basePrompt('1', 'first'), basePrompt('2', 'second'), basePrompt('3', 'third')],
    };

    expect(cancelQueuedChatPrompt(state, 'project:sess-1', '2')['project:sess-1'].map(item => item.text))
      .toEqual(['first', 'third']);
  });

  test('moves a queued prompt to the front without sending it immediately', () => {
    const state = {
      'project:sess-1': [basePrompt('1', 'first'), basePrompt('2', 'second'), basePrompt('3', 'third')],
    };

    expect(moveQueuedChatPromptToFront(state, 'project:sess-1', '3')['project:sess-1'].map(item => item.text))
      .toEqual(['third', 'first', 'second']);
  });

  test('shifts the next prompt and keeps remaining queued prompts', () => {
    const state = {
      'project:sess-1': [basePrompt('1', 'first'), basePrompt('2', 'second')],
    };

    const result = shiftNextQueuedChatPrompt(state, 'project:sess-1');

    expect(result.prompt?.text).toBe('first');
    expect(result.state['project:sess-1'].map(item => item.text)).toEqual(['second']);
  });

  test('builds a queued prompt message with queued metadata', () => {
    const message = buildQueuedPromptMessage(basePrompt('1', 'first'), 42);

    expect(message.method).toBe('prompt_request');
    expect(message.turnIndex).toBe(42);
    expect(message.param.queuedPromptId).toBe('1');
    expect(message.param.queueStatus).toBe('queued');
  });
});
```

- [ ] **Step 2: Run queue state tests and verify RED**

Run: `cd app; npm test -- --runTestsByPath __tests__/web-chat-prompt-queue-state.test.ts`

Expected: FAIL because `chatPromptQueue.ts` does not exist.

- [ ] **Step 3: Implement queue state helpers**

Create `app/web/src/chat/session/chatPromptQueue.ts`:

```ts
import type {RegistryChatContentBlock, RegistryChatMessage} from '../../registry/registryTypes';

export type QueuedChatPrompt = {
  id: string;
  sessionId: string;
  blocks: RegistryChatContentBlock[];
  createdAt: string;
  text: string;
};

export type QueuedChatPromptsByKey = Record<string, QueuedChatPrompt[]>;

function clonePrompt(prompt: QueuedChatPrompt): QueuedChatPrompt {
  return {
    ...prompt,
    blocks: prompt.blocks.map(block => ({...block})),
  };
}

export function enqueueChatPrompt(
  state: QueuedChatPromptsByKey,
  runtimeKey: string,
  prompt: QueuedChatPrompt,
): QueuedChatPromptsByKey {
  const current = state[runtimeKey] ?? [];
  return {...state, [runtimeKey]: [...current, clonePrompt(prompt)]};
}

export function cancelQueuedChatPrompt(
  state: QueuedChatPromptsByKey,
  runtimeKey: string,
  promptId: string,
): QueuedChatPromptsByKey {
  const next = (state[runtimeKey] ?? []).filter(prompt => prompt.id !== promptId);
  if (next.length === 0) {
    const {[runtimeKey]: _removed, ...rest} = state;
    return rest;
  }
  return {...state, [runtimeKey]: next};
}

export function moveQueuedChatPromptToFront(
  state: QueuedChatPromptsByKey,
  runtimeKey: string,
  promptId: string,
): QueuedChatPromptsByKey {
  const current = state[runtimeKey] ?? [];
  const target = current.find(prompt => prompt.id === promptId);
  if (!target) return state;
  return {
    ...state,
    [runtimeKey]: [target, ...current.filter(prompt => prompt.id !== promptId)],
  };
}

export function shiftNextQueuedChatPrompt(
  state: QueuedChatPromptsByKey,
  runtimeKey: string,
): {state: QueuedChatPromptsByKey; prompt: QueuedChatPrompt | null} {
  const current = state[runtimeKey] ?? [];
  const [prompt, ...rest] = current;
  if (!prompt) return {state, prompt: null};
  if (rest.length === 0) {
    const {[runtimeKey]: _removed, ...nextState} = state;
    return {state: nextState, prompt};
  }
  return {state: {...state, [runtimeKey]: rest}, prompt};
}

export function moveQueuedChatPrompts(
  state: QueuedChatPromptsByKey,
  fromRuntimeKey: string,
  toRuntimeKey: string,
  sessionId: string,
): QueuedChatPromptsByKey {
  if (fromRuntimeKey === toRuntimeKey) return state;
  const prompts = state[fromRuntimeKey] ?? [];
  if (prompts.length === 0) return state;
  const {[fromRuntimeKey]: _removed, ...rest} = state;
  return {
    ...rest,
    [toRuntimeKey]: [
      ...(state[toRuntimeKey] ?? []),
      ...prompts.map(prompt => ({...clonePrompt(prompt), sessionId})),
    ],
  };
}

export function buildQueuedPromptMessage(prompt: QueuedChatPrompt, turnIndex: number): RegistryChatMessage {
  return {
    sessionId: prompt.sessionId,
    turnIndex,
    method: 'prompt_request',
    param: {
      contentBlocks: prompt.blocks.map(block => ({...block})),
      createdAt: prompt.createdAt,
      queuedPromptId: prompt.id,
      queueStatus: 'queued',
    },
    finished: false,
  };
}
```

- [ ] **Step 4: Run queue state tests and verify GREEN**

Run: `cd app; npm test -- --runTestsByPath __tests__/web-chat-prompt-queue-state.test.ts`

Expected: PASS.

---

### Task 2: Display Index and Queued Prompt Rendering

**Files:**
- Modify: `app/web/src/chat/turns/chatPromptStatus.ts`
- Modify: `app/web/src/chat/turns/chatDisplayIndex.ts`
- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Modify: `app/web/src/styles/chat.css`
- Test: `app/__tests__/web-chat-turn-rendering.test.ts`

- [ ] **Step 1: Write failing rendering/source tests**

Add a test to `app/__tests__/web-chat-turn-rendering.test.ts`:

```ts
test('renders queued prompts in the chat stream with queue actions', () => {
  const main = readMain();
  const chatTurn = readChatTurnView();
  const styles = readStyles();

  expect(main).toContain('selectedQueuedPrompts');
  expect(main).toContain('buildQueuedPromptMessage(prompt, queuedPromptTurnIndex(index))');
  expect(main).toContain("displayItem.kind === 'queued'");
  expect(chatTurn).toContain("'queued'");
  expect(chatTurn).toContain('onCancelQueuedPrompt?: () => void;');
  expect(chatTurn).toContain('onPrioritizeQueuedPrompt?: () => void;');
  expect(chatTurn).toContain('chat-prompt-status-queued');
  expect(chatTurn).toContain('Queued');
  expect(chatTurn).toContain('Send next');
  expect(styles).toContain('.chat-prompt-status-queued');
  expect(styles).toContain('.chat-prompt-queue-actions');
});
```

- [ ] **Step 2: Run rendering tests and verify RED**

Run: `cd app; npm test -- --runTestsByPath __tests__/web-chat-turn-rendering.test.ts`

Expected: FAIL because queued rendering is not implemented.

- [ ] **Step 3: Extend prompt status and display index**

Change `app/web/src/chat/turns/chatPromptStatus.ts`:

```ts
export type ChatPromptStatus = 'confirming' | 'responding' | 'undelivered' | 'queued' | null;
```

Change `app/web/src/chat/turns/chatDisplayIndex.ts`:

```ts
export type ChatDisplayIndexItem = {
  kind: 'turn' | 'pending' | 'queued';
  key: string;
  turnIndex: number;
  sourceIndex: number;
  estimatedHeight: number;
};

export type ChatDisplayIndexOptions = {
  shouldRender?: (message: RegistryChatMessage, promptStatus: ChatPromptStatus) => boolean;
  hideToolCalls?: boolean;
  layoutMetrics?: Partial<ChatTurnHeightMetrics>;
  promptStatus?: (message: RegistryChatMessage) => ChatPromptStatus;
  pendingKey?: string;
  pendingEstimatedHeight?: number;
  queuedKeys?: string[];
  queuedEstimatedHeight?: number;
};
```

At the end of `buildChatDisplayIndex`, after pending:

```ts
  for (const queuedKey of options.queuedKeys ?? []) {
    const key = queuedKey.trim();
    if (!key) continue;
    items.push({
      kind: 'queued',
      key,
      turnIndex: 0,
      sourceIndex: -1,
      estimatedHeight: Math.max(72, Math.trunc(options.queuedEstimatedHeight ?? 128)),
    });
  }
```

- [ ] **Step 4: Extend ChatTurnView queued rendering**

Add props:

```ts
  onCancelQueuedPrompt?: () => void;
  onPrioritizeQueuedPrompt?: () => void;
```

Destructure them and render inside the prompt branch:

```tsx
            {promptStatus === 'queued' ? (
              <span className="chat-prompt-status chat-prompt-status-queued" title="Queued">
                Queued
              </span>
            ) : null}
```

After the delivery line:

```tsx
        {promptStatus === 'queued' ? (
          <div className="chat-prompt-queue-actions">
            <button type="button" className="chat-prompt-queue-action" onClick={onPrioritizeQueuedPrompt}>
              Send next
            </button>
            <button type="button" className="chat-prompt-queue-action danger" onClick={onCancelQueuedPrompt}>
              Cancel
            </button>
          </div>
        ) : null}
```

- [ ] **Step 5: Add queued styles**

Add to `app/web/src/styles/chat.css` near existing prompt status styles:

```css
.chat-prompt-status-queued {
  border: 1px solid color-mix(in srgb, var(--accent) 42%, transparent);
  color: color-mix(in srgb, var(--accent) 82%, var(--text));
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  font-size: 11px;
  line-height: 16px;
  padding: 0 7px;
  border-radius: 999px;
}

.chat-prompt-queue-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.chat-prompt-queue-action {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text-muted);
  min-height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
}

.chat-prompt-queue-action:hover {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 44%, var(--border));
}

.chat-prompt-queue-action.danger:hover {
  color: #f85149;
  border-color: color-mix(in srgb, #f85149 50%, var(--border));
}
```

- [ ] **Step 6: Run rendering tests and verify GREEN**

Run: `cd app; npm test -- --runTestsByPath __tests__/web-chat-turn-rendering.test.ts`

Expected: PASS.

---

### Task 3: Workspace Queue Wiring and Auto Drain

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Test: `app/__tests__/web-chat-ui.test.ts`

- [ ] **Step 1: Write failing Workspace source tests**

Update `app/__tests__/web-chat-ui.test.ts` test `keeps running chat editable while blocking another send for that chat` to expect queue behavior:

```ts
expect(mainTsx).toContain('const [chatQueuedPromptsByKey, setChatQueuedPromptsByKey] = useState<QueuedChatPromptsByKey>({});');
expect(mainTsx).toContain('const chatQueuedPromptsByKeyRef = useRef<QueuedChatPromptsByKey>({});');
expect(mainTsx).toContain('enqueueSelectedChatPrompt(');
expect(mainTsx).toContain('drainNextQueuedChatPrompt(runtimeKey)');
expect(mainTsx).toContain('cancelQueuedPrompt(selectedChatEncodedKey, prompt.id)');
expect(mainTsx).toContain('prioritizeQueuedPrompt(selectedChatEncodedKey, prompt.id)');
expect(mainTsx).toContain('const chatSendDisabled = selectedChatSubmitPending || chatAttachmentUploadPending;');
expect(sendBlock).not.toContain('if (selectedChatPromptRunning) {');
expect(mainTsx).toContain('readOnly={selectedChatSubmitPending}');
expect(mainTsx).toContain('disabled={chatSendDisabled}');
```

- [ ] **Step 2: Run Workspace source tests and verify RED**

Run: `cd app; npm test -- --runTestsByPath __tests__/web-chat-ui.test.ts`

Expected: FAIL because queue wiring is not implemented and send is still blocked by `selectedChatPromptRunning`.

- [ ] **Step 3: Import queue helpers and add queue state**

In `WorkspaceApp.tsx`, import:

```ts
import {
  buildQueuedPromptMessage,
  cancelQueuedChatPrompt,
  enqueueChatPrompt,
  moveQueuedChatPromptToFront,
  moveQueuedChatPrompts,
  shiftNextQueuedChatPrompt,
  type QueuedChatPrompt,
  type QueuedChatPromptsByKey,
} from '../chat/session/chatPromptQueue';
```

Add state near pending prompts:

```ts
const [chatQueuedPromptsByKey, setChatQueuedPromptsByKey] = useState<QueuedChatPromptsByKey>({});
const chatQueuedPromptsByKeyRef = useRef<QueuedChatPromptsByKey>({});
```

Add effect:

```ts
useEffect(() => {
  chatQueuedPromptsByKeyRef.current = chatQueuedPromptsByKey;
}, [chatQueuedPromptsByKey]);
```

- [ ] **Step 4: Add queue mutation helpers**

Add helpers near pending prompt helpers:

```ts
const makeQueuedPromptId = () => `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const setQueuedPrompts = (updater: (current: QueuedChatPromptsByKey) => QueuedChatPromptsByKey) => {
  setChatQueuedPromptsByKey(current => {
    const next = updater(current);
    chatQueuedPromptsByKeyRef.current = next;
    return next;
  });
};

const enqueueSelectedChatPrompt = (runtimeKey: string, prompt: QueuedChatPrompt) => {
  setQueuedPrompts(current => enqueueChatPrompt(current, runtimeKey, prompt));
};

const cancelQueuedPrompt = (runtimeKey: string, promptId: string) => {
  setQueuedPrompts(current => cancelQueuedChatPrompt(current, runtimeKey, promptId));
};

const prioritizeQueuedPrompt = (runtimeKey: string, promptId: string) => {
  setQueuedPrompts(current => moveQueuedChatPromptToFront(current, runtimeKey, promptId));
};
```

- [ ] **Step 5: Change sendChatMessage to enqueue while running**

Replace the running early return with:

```ts
if (selectedChatPromptRunning) {
  const queuedPrompt: QueuedChatPrompt = {
    id: makeQueuedPromptId(),
    sessionId,
    blocks: blocks.map(block => ({...block})),
    createdAt: new Date().toISOString(),
    text: trimmedText || msgText('prompt_request', {contentBlocks: blocks}).trim(),
  };
  enqueueSelectedChatPrompt(runtimeKey, queuedPrompt);
  if (!options.preserveComposer) {
    resetChatComposerDraft(draftKey);
  }
  forceChatScrollToBottom();
  return;
}
```

This block must run after `blocks` are built and before `rememberPendingChatPrompt(...)`.

- [ ] **Step 6: Move queues when draft sessions resolve to real sessions**

After existing pending prompt move logic, call:

```ts
setQueuedPrompts(current => moveQueuedChatPrompts(
  current,
  runtimeKey,
  buildChatRuntimeKey(selectedProjectId, nextSessionId),
  nextSessionId,
));
```

- [ ] **Step 7: Add auto drain helper**

Add near queue helpers:

```ts
const drainNextQueuedChatPrompt = (runtimeKey: string) => {
  const selectedKey = selectedChatKeyRef.current;
  if (!selectedKey) return;
  if (buildChatRuntimeKey(selectedKey.projectId, selectedKey.sessionId) !== runtimeKey) return;
  if (chatSubmittingByKeyRef.current[runtimeKey] === true) return;
  const result = shiftNextQueuedChatPrompt(chatQueuedPromptsByKeyRef.current, runtimeKey);
  if (!result.prompt) return;
  setQueuedPrompts(() => result.state);
  sendChatMessage({
    textOverride: result.prompt.text,
    blocksOverride: result.prompt.blocks,
    attachmentsOverride: [],
    preserveComposer: true,
  }).catch(err => setError(err instanceof Error ? err.message : String(err)));
};
```

Add a `useEffect` after `selectedChatPromptRunning` is computed:

```ts
useEffect(() => {
  if (!selectedChatEncodedKey || selectedChatPromptRunning || selectedChatSubmitPending) {
    return;
  }
  if ((chatQueuedPromptsByKeyRef.current[selectedChatEncodedKey] ?? []).length === 0) {
    return;
  }
  drainNextQueuedChatPrompt(selectedChatEncodedKey);
}, [selectedChatEncodedKey, selectedChatPromptRunning, selectedChatSubmitPending, chatMessages.length]);
```

- [ ] **Step 8: Render queued prompts**

Add:

```ts
const selectedQueuedPrompts = selectedChatEncodedKey
  ? chatQueuedPromptsByKey[selectedChatEncodedKey] ?? []
  : [];
const queuedPromptTurnIndex = (index: number) => nextPromptTurnIndex(selectedFullChatMessages) + index + 1;
```

Pass display index options:

```ts
queuedKeys: selectedQueuedPrompts.map(prompt => `${selectedChatEncodedKey}:queued:${prompt.id}`),
```

In `renderChatVirtuosoItem`, handle queued items:

```tsx
const queuedPromptIndex = displayItem.kind === 'queued'
  ? selectedQueuedPrompts.findIndex(prompt => `${selectedChatEncodedKey}:queued:${prompt.id}` === displayItem.key)
  : -1;
const queuedPrompt = queuedPromptIndex >= 0 ? selectedQueuedPrompts[queuedPromptIndex] : null;
const content = displayItem.kind === 'queued' && queuedPrompt && !chatReadOnlyPreview ? (
  <div className="chat-view-content">
    <ChatTurnView
      message={buildQueuedPromptMessage(queuedPrompt, queuedPromptTurnIndex(queuedPromptIndex))}
      promptStatus="queued"
      hideToolCalls={hideToolCalls}
      markdownComponents={chatMarkdownComponents}
      markdownUrlTransform={chatMarkdownUrlTransform}
      onCancelQueuedPrompt={() => cancelQueuedPrompt(selectedChatEncodedKey, queuedPrompt.id)}
      onPrioritizeQueuedPrompt={() => prioritizeQueuedPrompt(selectedChatEncodedKey, queuedPrompt.id)}
      onOpenPromptAttachment={openChatAttachmentPreview}
      resolvePromptAttachmentThumbnail={resolvePromptAttachmentThumbnail}
      onLoadPromptAttachmentThumbnail={loadPromptAttachmentThumbnail}
    />
  </div>
) : displayItem.kind === 'pending' && selectedPendingPrompt && !chatReadOnlyPreview ? (
```

- [ ] **Step 9: Keep send controls enabled while running**

Change:

```ts
const chatSendDisabled = selectedChatSubmitPending || chatAttachmentUploadPending;
```

Keep stop button behavior unchanged.

- [ ] **Step 10: Run Workspace tests and verify GREEN**

Run: `cd app; npm test -- --runTestsByPath __tests__/web-chat-ui.test.ts`

Expected: PASS.

---

### Task 4: Focused TypeScript and Chat Test Sweep

**Files:**
- Modify as needed from Tasks 1-3 only.

- [ ] **Step 1: Run focused chat tests**

Run:

```bash
cd app; npm test -- --runTestsByPath __tests__/web-chat-prompt-queue-state.test.ts __tests__/web-chat-turn-rendering.test.ts __tests__/web-chat-ui.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript check**

Run: `cd app; npm run tsc:web`

Expected: PASS.

- [ ] **Step 3: Fix only scoped failures**

If failures mention the queue files or touched chat files, update those files only. Do not refactor unrelated chat code.

- [ ] **Step 4: Commit**

Run:

```bash
git add -A
git commit -m "feat: add chat prompt queue"
```

Expected: commit succeeds.

---

## Self Review

- Spec coverage: queue supports multiple prompts, client memory only, queued prompts are visible, individual cancel and Send next are included, Stop preserves queue, and auto-drain after completion/cancel is covered.
- Placeholder scan: clean.
- Type consistency: `QueuedChatPrompt`, `QueuedChatPromptsByKey`, `queued` prompt status, and `queued` display item are introduced before use.
