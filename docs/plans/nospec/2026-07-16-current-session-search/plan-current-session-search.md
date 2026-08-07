# 当前会话搜索（Ctrl+F）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在会话窗口按 Ctrl+F 搜索当前会话正文（用户消息 + 助手回复），turn 级命中、上下翻导航、混合高亮，搜索条带切换器显式跳转到「所有会话 / 文件预览」搜索。

**Architecture:** 纯函数模块 `chatSearchState.ts` 负责 match 计算与高亮分段（TDD 单测覆盖）；`WorkspaceApp.tsx` 局部 useState/useRef 持有搜索状态（与现有 preview search 一致，不引入 store）；导航复用 `chatVirtuosoListRef.scrollToTurnIndex`（虚拟化安全）；整 turn 高亮复用 `chat-turn-search-highlight`；字符级高亮仅在激活 turn 的可见纯文本上 best-effort，markdown 内部降级。文本提取从 `ChatTurnView` 抽到共享模块 `chatMessageText.ts` 以 DRY。

**Tech Stack:** React + TypeScript + webpack + Jest（node 环境，无 DOM 测试设施，故 UI 接线靠 `tsc:web` + `build:web` + 手动验证；纯逻辑靠 Jest 单测）。

**Verification commands (run from `app/`):**
- Tests: `cd app && npm test`
- Typecheck: `cd app && npm run tsc:web`
- Build: `cd app && npm run build:web`

**Key file path note:** `WorkspaceApp.tsx` is at `app/web/src/app/WorkspaceApp.tsx` (nested `app` dir). Line numbers below are anchors at the time of writing; use the surrounding code context to locate them if shifted.

---

## File Structure

- **Create** `app/web/src/chat/chatMessageText.ts` — pure message text-extraction helpers (`msgText`, `extractTextFromSessionTurnParam`, `extractTextFromACPContent`), extracted from `ChatTurnView.tsx` so search indexing need not import React/markdown.
- **Create** `app/web/src/chat/search/chatSearchState.ts` — pure search helpers: `ChatSearchMatch`, `buildChatSearchMatches`, `isChatSearchableMethod`, `splitChatSearchHighlightSegments`.
- **Create** `app/__tests__/web-chat-search-state.test.ts` — Jest unit tests for the above.
- **Modify** `app/web/src/chat/ChatTurnView.tsx` — import text helpers from `chatMessageText.ts`; add `highlightQuery` prop and render character-level highlight in the user-prompt text branch.
- **Modify** `app/web/src/app/WorkspaceApp.tsx` — chat-search state/memos/handlers/effects, Ctrl+F re-routing, title-bar button, search bar + switcher JSX, turn-highlight wiring.
- **Modify** `app/web/src/styles/chat.css` — search bar + switcher + match `<mark>` styles.

---

## Task 1: Extract `chatMessageText.ts` (pure refactor, DRY foundation)

**Files:**
- Create: `app/web/src/chat/chatMessageText.ts`
- Modify: `app/web/src/chat/ChatTurnView.tsx:43-103`

- [ ] **Step 1: Create the shared text module**

Create `app/web/src/chat/chatMessageText.ts`:

```ts
// Pure text-extraction helpers for chat session messages.
// Extracted from ChatTurnView so search indexing can reuse them without
// importing React or the markdown rendering pipeline.

export function extractTextFromACPContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const chunks: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.text === 'string' && entry.text.trim()) {
      chunks.push(entry.text.trim());
    }
  }
  return chunks.join('\n').trim();
}

export function extractTextFromSessionTurnParam(param: unknown): string {
  if (typeof param === 'string') {
    return param.trim();
  }
  if (Array.isArray(param)) {
    const chunks = param
      .map(item => {
        if (!item || typeof item !== 'object') return '';
        const entry = item as Record<string, unknown>;
        return typeof entry.content === 'string' ? entry.content.trim() : '';
      })
      .filter(Boolean);
    return chunks.join('\n').trim();
  }
  if (!param || typeof param !== 'object') {
    return '';
  }
  const input = param as Record<string, unknown>;
  if (typeof input.text === 'string') {
    return input.text.trim();
  }
  if (typeof input.output === 'string') {
    return input.output.trim();
  }
  if (typeof input.cmd === 'string') {
    return input.cmd.trim();
  }
  if (Array.isArray(input.contentBlocks)) {
    return extractTextFromACPContent(input.contentBlocks);
  }
  return '';
}

export function msgText(method: string, param: Record<string, unknown>): string {
  if (method === 'prompt_request') {
    const blocks = Array.isArray(param.contentBlocks) ? param.contentBlocks : [];
    return extractTextFromACPContent(blocks);
  }
  if (method === 'prompt_done') {
    return typeof param.stopReason === 'string' ? param.stopReason : '';
  }
  return extractTextFromSessionTurnParam(param);
}
```

- [ ] **Step 2: Replace the inline helpers in `ChatTurnView.tsx`**

In `app/web/src/chat/ChatTurnView.tsx`, delete the three function definitions `extractTextFromACPContent`, `extractTextFromSessionTurnParam`, `msgText` (currently lines 43-103). Add this import near the other imports at the top of the file:

```ts
import {extractTextFromACPContent, extractTextFromSessionTurnParam, msgText} from './chatMessageText';
```

If `tsc:web` in Step 3 reports `extractTextFromACPContent` or `extractTextFromSessionTurnParam` as unused imports (i.e. `ChatTurnView` only calls `msgText`), trim the import to just `{msgText}`.

- [ ] **Step 3: Verify behavior is unchanged**

Run: `cd app && npm run tsc:web && npm test`
Expected: typecheck passes; all existing tests still pass (this is a pure move refactor).

- [ ] **Step 4: Commit**

```bash
git add app/web/src/chat/chatMessageText.ts app/web/src/chat/ChatTurnView.tsx
git commit -m "refactor: extract chat message text helpers to shared module"
```

---

## Task 2: `chatSearchState.ts` pure helpers (TDD)

**Files:**
- Create: `app/__tests__/web-chat-search-state.test.ts`
- Create: `app/web/src/chat/search/chatSearchState.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/__tests__/web-chat-search-state.test.ts`:

```ts
import {
  buildChatSearchMatches,
  isChatSearchableMethod,
  splitChatSearchHighlightSegments,
} from '../web/src/chat/search/chatSearchState';
import type {RegistryChatMessage} from '../web/src/registry/registryTypes';

function message(method: string, turnIndex: number, param: Record<string, unknown> = {}): RegistryChatMessage {
  return {sessionId: 's1', turnIndex, method, param, finished: true};
}

describe('chat search state helpers', () => {
  test('only user prompts and assistant replies are searchable', () => {
    expect(isChatSearchableMethod('prompt_request')).toBe(true);
    expect(isChatSearchableMethod('user_message_chunk')).toBe(true);
    expect(isChatSearchableMethod('agent_message_chunk')).toBe(true);
    expect(isChatSearchableMethod('agent_thought_chunk')).toBe(false);
    expect(isChatSearchableMethod('tool_call')).toBe(false);
    expect(isChatSearchableMethod('prompt_done')).toBe(false);
    expect(isChatSearchableMethod('agent_plan')).toBe(false);
  });

  test('returns matching turn indices, case-insensitive, deduped', () => {
    const messages: RegistryChatMessage[] = [
      message('prompt_request', 0, {contentBlocks: [{type: 'text', text: 'Deploy the API'}]}),
      message('agent_thought_chunk', 1, {text: 'deploy plan hidden'}), // excluded
      message('agent_message_chunk', 2, {text: 'Running DEPLOY now'}),
      message('tool_call', 3, {cmd: 'deploy --prod'}), // excluded
      message('agent_message_chunk', 4, {text: 'nothing here'}),
    ];

    expect(buildChatSearchMatches(messages, 'deploy')).toEqual([
      {turnIndex: 0},
      {turnIndex: 2},
    ]);
  });

  test('empty or whitespace query returns no matches', () => {
    const messages: RegistryChatMessage[] = [
      message('prompt_request', 0, {contentBlocks: [{type: 'text', text: 'hello'}]}),
    ];
    expect(buildChatSearchMatches(messages, '')).toEqual([]);
    expect(buildChatSearchMatches(messages, '   ')).toEqual([]);
  });

  test('splits highlight segments case-insensitively', () => {
    expect(splitChatSearchHighlightSegments('Deploy deployer', 'dep')).toEqual([
      {text: 'Dep', match: true},
      {text: 'loy ', match: false},
      {text: 'dep', match: true},
      {text: 'loyer', match: false},
    ]);
  });

  test('returns a single non-match segment when query absent or empty', () => {
    expect(splitChatSearchHighlightSegments('Hello', 'zz')).toEqual([{text: 'Hello', match: false}]);
    expect(splitChatSearchHighlightSegments('Hello', '')).toEqual([{text: 'Hello', match: false}]);
    expect(splitChatSearchHighlightSegments('', 'x')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npm test -- web-chat-search-state`
Expected: FAIL — module `../web/src/chat/search/chatSearchState` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `app/web/src/chat/search/chatSearchState.ts`:

```ts
import type {RegistryChatMessage} from '../../registry/registryTypes';
import {msgText} from '../chatMessageText';

export type ChatSearchMatch = {
  turnIndex: number;
};

// Only user prompts and assistant reply text are searchable. Thoughts, tool
// calls, plan, status and done messages are intentionally excluded.
const CHAT_SEARCHABLE_METHODS = new Set<string>([
  'prompt_request',
  'user_message_chunk',
  'agent_message_chunk',
]);

export function isChatSearchableMethod(method: string): boolean {
  return CHAT_SEARCHABLE_METHODS.has(method);
}

export function buildChatSearchMatches(
  messages: RegistryChatMessage[],
  query: string,
): ChatSearchMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [];
  }
  const matches: ChatSearchMatch[] = [];
  const seenTurnIndex = new Set<number>();
  for (const message of messages) {
    if (!isChatSearchableMethod(message.method)) {
      continue;
    }
    const text = msgText(message.method, message.param).toLocaleLowerCase();
    if (!text.includes(normalizedQuery)) {
      continue;
    }
    const turnIndex = message.turnIndex ?? 0;
    if (seenTurnIndex.has(turnIndex)) {
      continue;
    }
    seenTurnIndex.add(turnIndex);
    matches.push({turnIndex});
  }
  return matches;
}

export type ChatSearchHighlightSegment = {
  text: string;
  match: boolean;
};

export function splitChatSearchHighlightSegments(
  text: string,
  query: string,
): ChatSearchHighlightSegment[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!text || !normalizedQuery) {
    return text ? [{text, match: false}] : [];
  }
  const lowerText = text.toLocaleLowerCase();
  const segments: ChatSearchHighlightSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const matchIndex = lowerText.indexOf(normalizedQuery, cursor);
    if (matchIndex < 0) {
      segments.push({text: text.slice(cursor), match: false});
      break;
    }
    if (matchIndex > cursor) {
      segments.push({text: text.slice(cursor, matchIndex), match: false});
    }
    segments.push({
      text: text.slice(matchIndex, matchIndex + normalizedQuery.length),
      match: true,
    });
    cursor = matchIndex + normalizedQuery.length;
  }
  return segments.filter(segment => segment.text.length > 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- web-chat-search-state`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `cd app && npm run tsc:web`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/web/src/chat/search/chatSearchState.ts app/__tests__/web-chat-search-state.test.ts
git commit -m "feat: add chat search match and highlight helpers"
```

---

## Task 3: Wire chat-search state, handlers, Ctrl+F routing, title-bar button

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`

- [ ] **Step 1: Add the import**

In `app/web/src/app/WorkspaceApp.tsx`, alongside the existing import from `'../chat/session/sessionSearchState'` (around line 134), add:

```ts
import {
  buildChatSearchMatches,
  type ChatSearchMatch,
} from '../chat/search/chatSearchState';
```

- [ ] **Step 2: Add state declarations**

Find the preview-search state block (around line 2875):

```tsx
  const [previewSearchOpen, setPreviewSearchOpen] = useState(false);
  const [previewSearchQuery, setPreviewSearchQuery] = useState('');
  const [previewSearchActiveIndex, setPreviewSearchActiveIndex] = useState(0);
  const previewSearchInputRef = useRef<HTMLInputElement | null>(null);
```

Insert immediately after it:

```tsx
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchActiveIndex, setChatSearchActiveIndex] = useState(0);
  const chatSearchInputRef = useRef<HTMLInputElement | null>(null);
```

- [ ] **Step 3: Add matches + derived memos**

Find the preview-search `useMemo` block (around line 2923):

```tsx
  const previewSearchMatches = useMemo(
    () => buildPreviewSearchMatches(activeWorkbenchTab, previewSearchQuery),
    [activeWorkbenchTab, previewSearchQuery],
  );
```

Insert immediately after it:

```tsx
  const chatSearchMatches = useMemo(
    () => buildChatSearchMatches(chatMessages, chatSearchQuery),
    [chatMessages, chatSearchQuery],
  );
  const chatSearchMatchedTurnIndexSet = useMemo(
    () => new Set(chatSearchMatches.map(match => match.turnIndex)),
    [chatSearchMatches],
  );
  const chatSearchActiveTurnIndex =
    chatSearchOpen && chatSearchMatches.length > 0
      ? chatSearchMatches[chatSearchActiveIndex]?.turnIndex ?? null
      : null;
```

- [ ] **Step 4: Add handlers**

Find `closePreviewSearch` / `handlePreviewSearchInputKeyDown` (around line 20887-20925). Immediately after `handlePreviewSearchInputKeyDown`, insert:

```tsx
  const scrollToChatSearchMatch = (match: ChatSearchMatch) => {
    chatVirtuosoListRef.current?.scrollToTurnIndex(match.turnIndex, 'smooth');
  };
  const activateChatSearchMatch = (index: number) => {
    if (chatSearchMatches.length === 0) {
      return;
    }
    const nextIndex = (index + chatSearchMatches.length) % chatSearchMatches.length;
    setChatSearchActiveIndex(nextIndex);
    scrollToChatSearchMatch(chatSearchMatches[nextIndex]);
  };
  const navigateChatSearchMatch = (delta: 1 | -1) => {
    activateChatSearchMatch(chatSearchActiveIndex + delta);
  };
  const openChatSearch = () => {
    setChatSearchOpen(true);
    setChatSearchActiveIndex(0);
    window.requestAnimationFrame(() => {
      chatSearchInputRef.current?.focus();
      chatSearchInputRef.current?.select();
    });
  };
  const closeChatSearch = () => {
    setChatSearchOpen(false);
    setChatSearchQuery('');
    setChatSearchActiveIndex(0);
  };
  const handleChatSearchInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeChatSearch();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      navigateChatSearchMatch(event.shiftKey ? -1 : 1);
    }
  };
  const switchChatSearchTarget = (target: 'current' | 'sessions' | 'preview') => {
    if (target === 'current') {
      openChatSearch();
      return;
    }
    closeChatSearch();
    if (target === 'sessions') {
      setSessionSearchOpen(true);
      window.requestAnimationFrame(() => {
        sessionSearchInputRef.current?.focus();
        sessionSearchInputRef.current?.select();
      });
      return;
    }
    // target === 'preview'
    if (!chatPreviewOpen) {
      toggleChatPreviewFromTitle();
    }
    window.requestAnimationFrame(() => openPreviewSearch());
  };
```

- [ ] **Step 5: Add auto-clamp + auto-jump effects**

Find the preview-search auto-jump effect (around line 20237). Immediately after that effect block, insert:

```tsx
  useEffect(() => {
    setChatSearchActiveIndex(current =>
      Math.min(current, Math.max(0, chatSearchMatches.length - 1)),
    );
  }, [chatSearchMatches.length]);

  useEffect(() => {
    if (!chatSearchOpen || chatSearchMatches.length === 0) {
      return;
    }
    setChatSearchActiveIndex(0);
    const frameId = window.requestAnimationFrame(() => {
      scrollToChatSearchMatch(chatSearchMatches[0]);
    });
    return () => window.cancelAnimationFrame(frameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSearchOpen, chatSearchQuery]);
```

- [ ] **Step 6: Close chat search when switching session**

Find the session-search-target scroll effect (around line 3580-3598). Immediately before it, insert:

```tsx
  const prevChatSearchKeyRef = useRef(selectedChatEncodedKey);
  useEffect(() => {
    if (prevChatSearchKeyRef.current !== selectedChatEncodedKey) {
      prevChatSearchKeyRef.current = selectedChatEncodedKey;
      setChatSearchOpen(false);
      setChatSearchQuery('');
      setChatSearchActiveIndex(0);
    }
  }, [selectedChatEncodedKey]);
```

- [ ] **Step 7: Re-route global Ctrl+F to chat search**

Find the global keydown effect `handleGlobalPreviewKeyDown` (around line 20267). It currently has this structure:

```tsx
      if (event.key.toLowerCase() === 'p' && (event.ctrlKey || event.metaKey)) {
        // ... Ctrl+P quick-file ...
        return;
      }
      if (!chatPreviewOpen) {
        return;
      }
      // ... Ctrl+Tab ...
      if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setPreviewSearchOpen(true);
        setPreviewSearchActiveIndex(0);
        setPreviewSelectionMenu(null);
        window.requestAnimationFrame(() => {
          previewSearchInputRef.current?.focus();
          previewSearchInputRef.current?.select();
        });
        return;
      }
```

Make two edits:

(a) Move the Ctrl+F branch ABOVE `if (!chatPreviewOpen) { return; }` and change it to open chat search. Delete the old Ctrl+F branch that sat below the `chatPreviewOpen` guard. The Ctrl+P block stays where it is. Replace the region from the `if (event.key.toLowerCase() === 'p' ...)` Ctrl+P block's end through the old Ctrl+F branch with:

```tsx
      if (event.key.toLowerCase() === 'p' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (quickFileOpen) {
          quickFileInputRef.current?.focus();
          return;
        }
        openQuickFileSearch();
        return;
      }
      if (quickFileOpen) {
        return;
      }
      if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        openChatSearch();
        return;
      }
      if (!chatPreviewOpen) {
        return;
      }
      if (quickFileOpen) {
        return;
      }
      if (event.key === 'Tab' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        const nextTabId = cyclePreviewTabId(previewWorkbenchTabs, activeWorkbenchTab?.id ?? '', event.shiftKey ? -1 : 1);
        if (nextTabId) {
          setPreviewWorkbench(current => {
            const projectId = current.activeProjectId;
            const tab = (current.tabsByProjectId[projectId] ?? []).find(item => item.id === nextTabId);
            if (!tab) {
              return current;
            }
            return {
              ...current,
              activeTabIdByProjectId: {
                ...current.activeTabIdByProjectId,
                [projectId]: nextTabId,
              },
            };
          });
        }
        return;
      }
```

(b) Update the effect's dependency array to include `openChatSearch`:

```tsx
    window.addEventListener('keydown', handleGlobalPreviewKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalPreviewKeyDown, true);
  }, [
    activeWorkbenchTab?.id,
    chatPreviewOpen,
    openChatSearch,
    openQuickFileSearch,
    previewWorkbenchTabs,
    quickFileOpen,
  ]);
```

- [ ] **Step 8: Re-route local workbench Ctrl+F to chat search**

Find `handlePreviewWorkbenchKeyDown` (around line 20951). It has a Ctrl+F branch that calls `openPreviewSearch()`. Change it to `openChatSearch()`:

```tsx
    if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      openChatSearch();
      return;
    }
```

(The `openPreviewSearch` call is now reached only via the switcher; keep `openPreviewSearch` defined — it is still used by `switchChatSearchTarget`.)

- [ ] **Step 9: Add the title-bar search button**

Find the `chat-title-actions` div (around line 19175-19193) containing the terminal-toggle and preview-toggle buttons. Insert a new button as the FIRST child of `chat-title-actions` (before the terminal toggle):

```tsx
            <div className="chat-title-actions">
              <button
                type="button"
                className={`chat-search-toggle${chatSearchOpen ? ' active' : ''}`}
                onClick={() => (chatSearchOpen ? closeChatSearch() : openChatSearch())}
                title="Search current session (Ctrl+F)"
                aria-label="Search current session"
                aria-pressed={chatSearchOpen}
              >
                <span className="codicon codicon-search" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`chat-terminal-toggle${terminalOpen ? ' active' : ''}`}
```

- [ ] **Step 10: Typecheck**

Run: `cd app && npm run tsc:web`
Expected: no errors. If `openPreviewSearch` is now flagged as unused, it is NOT unused (used by `switchChatSearchTarget`) — re-check that Step 4's `switchChatSearchTarget` is present.

- [ ] **Step 11: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx
git commit -m "feat: wire chat search state, handlers, and Ctrl+F routing"
```

---

## Task 4: Chat search bar UI + target switcher

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: Add the search-bar JSX**

Find `renderPreviewWorkbenchSurface` / the `previewSearchBar` variable (around line 21316). Immediately AFTER the `previewSearchBar` const declaration ends (after its closing `: null;`), insert:

```tsx
  const chatSearchStatus = chatSearchQuery
    ? chatSearchMatches.length > 0
      ? `${chatSearchActiveIndex + 1}/${chatSearchMatches.length}`
      : 'No results'
    : 'Search current session';
  const chatSearchBar = chatSearchOpen ? (
    <div className="chat-search-bar">
      <span className="codicon codicon-search" aria-hidden="true" />
      <input
        ref={chatSearchInputRef}
        className="chat-search-input"
        value={chatSearchQuery}
        onChange={event => setChatSearchQuery(event.target.value)}
        onKeyDown={handleChatSearchInputKeyDown}
        placeholder="Search"
        aria-label="Search current session"
      />
      <span className="chat-search-status">{chatSearchStatus}</span>
      <div className="chat-search-switcher" role="group" aria-label="Search target">
        <button
          type="button"
          className="chat-search-switcher-button active"
          title="Current session"
          aria-label="Search current session"
          aria-pressed="true"
        >
          <span className="codicon codicon-comment-discussion" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="chat-search-switcher-button"
          onClick={() => switchChatSearchTarget('sessions')}
          title="All sessions"
          aria-label="Search all sessions"
          aria-pressed="false"
        >
          <span className="codicon codicon-list-tree" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="chat-search-switcher-button"
          onClick={() => switchChatSearchTarget('preview')}
          disabled={!chatPreviewOpen}
          title={chatPreviewOpen ? 'File preview' : 'Open preview first'}
          aria-label="Search file preview"
          aria-pressed="false"
        >
          <span className="codicon codicon-go-to-file" aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        className="chat-search-icon-button"
        onClick={() => navigateChatSearchMatch(-1)}
        disabled={chatSearchMatches.length === 0}
        title="Previous match"
        aria-label="Previous match"
      >
        <span className="codicon codicon-chevron-up" />
      </button>
      <button
        type="button"
        className="chat-search-icon-button"
        onClick={() => navigateChatSearchMatch(1)}
        disabled={chatSearchMatches.length === 0}
        title="Next match"
        aria-label="Next match"
      >
        <span className="codicon codicon-chevron-down" />
      </button>
      <button
        type="button"
        className="chat-search-icon-button"
        onClick={closeChatSearch}
        title="Close search"
        aria-label="Close search"
      >
        <span className="codicon codicon-close" />
      </button>
    </div>
  ) : null;
```

- [ ] **Step 2: Mount the bar above the chat scroll container**

Find the chat main surface (around line 19194):

```tsx
          <div
            className={chatMainClassName}
            style={chatMainStyle}
          >
            <div
              ref={chatScrollRef}
              className="scroll-panel chat-block"
```

Insert `{chatSearchBar}` between the `chatMainClassName` div and the `chatScrollRef` div:

```tsx
          <div
            className={chatMainClassName}
            style={chatMainStyle}
          >
            {chatSearchBar}
            <div
              ref={chatScrollRef}
              className="scroll-panel chat-block"
```

- [ ] **Step 3: Add CSS**

In `app/web/src/styles/chat.css`, append (these mirror the preview search bar tokens, scoped to the chat surface, plus the switcher and match styles):

```css
.chat-search-bar {
  min-height: 34px;
  display: grid;
  grid-template-columns: 16px minmax(80px, 1fr) auto auto 24px 24px 24px;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-panel);
  padding: 4px 8px;
  color: var(--text-secondary);
}

.chat-search-input {
  min-width: 0;
  height: 24px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 78%, transparent);
  border-radius: 5px;
  background: var(--surface-raised);
  color: var(--text-primary);
  padding: 0 7px;
  font-size: 12px;
  outline: none;
}

.chat-search-input:focus {
  border-color: color-mix(in srgb, var(--accent-primary) 58%, var(--border-subtle));
}

.chat-search-status {
  min-width: 56px;
  max-width: 168px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-search-switcher {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.chat-search-switcher-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.chat-search-switcher-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  color: var(--text-primary);
}

.chat-search-switcher-button.active {
  background: color-mix(in srgb, var(--accent-primary) 22%, transparent);
  color: var(--text-primary);
}

.chat-search-switcher-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.chat-search-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.chat-search-icon-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  color: var(--text-primary);
}

.chat-search-icon-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.chat-search-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.chat-search-toggle:hover {
  color: var(--text-primary);
}

.chat-search-toggle.active {
  color: var(--accent-primary);
}

.chat-search-match {
  background: color-mix(in srgb, #ffd166 45%, transparent);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}
```

- [ ] **Step 4: Build to verify**

Run: `cd app && npm run build:web`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css
git commit -m "feat: render chat search bar with target switcher"
```

---

## Task 5: Turn-level + character-level highlight

**Files:**
- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`

- [ ] **Step 1: Add `highlightQuery` prop to `ChatTurnView`**

In `app/web/src/chat/ChatTurnView.tsx`:

(a) Add to the import from the new search module (alongside the `./chatMessageText` import):

```ts
import {splitChatSearchHighlightSegments} from './search/chatSearchState';
```

(b) Add the field to the props type. In `ChatTurnViewProps` (lines 288-317), after the last field `promptArtifactErrors?: Record<string, string>;` (line 316) and before the closing `};`, add:

```ts
  highlightQuery?: string;
```

(c) Destructure it in the component params. In the `ChatTurnView` signature (lines 377-406), add `highlightQuery,` so the destructuring tail becomes:

```ts
  openingPromptArtifactKey = '',
  promptArtifactErrors = {},
  highlightQuery,
}: ChatTurnViewProps) {
```

(d) Add a helper inside the module (near the top, after the imports):

```ts
function renderChatTextWithHighlight(text: string, query: string | undefined) {
  if (!query) {
    return text;
  }
  return splitChatSearchHighlightSegments(text, query).map((segment, index) =>
    segment.match ? (
      <mark key={index} className="chat-search-match">
        {segment.text}
      </mark>
    ) : (
      <span key={index}>{segment.text}</span>
    ),
  );
}
```

(e) In the `prompt_request` / `user_message_chunk` branch, find the user-text render:

```tsx
              <div className="chat-prompt-user">
                {inlineParts.length > 0 ? renderPromptInlineParts(inlineParts) : text}
              </div>
```

Replace the `: text` fallback with the highlight helper:

```tsx
              <div className="chat-prompt-user">
                {inlineParts.length > 0
                  ? renderPromptInlineParts(inlineParts)
                  : renderChatTextWithHighlight(text, highlightQuery)}
              </div>
```

(The assistant markdown branch is intentionally left untouched — markdown inline highlighting degrades to whole-turn outline per spec.)

- [ ] **Step 2: Wire highlight from `renderChatMessageTurn`**

In `app/web/src/app/WorkspaceApp.tsx`, find `renderChatMessageTurn` (around line 18442). Locate the `searchHighlighted` boolean (around line 18465):

```tsx
    const searchHighlighted =
      sessionSearchTargetTurn?.runtimeKey === selectedChatEncodedKey &&
      sessionSearchTargetTurn.turnIndex === (message.turnIndex ?? 0);
```

Replace it so chat-search matches also outline the turn:

```tsx
    const searchHighlighted =
      (sessionSearchTargetTurn?.runtimeKey === selectedChatEncodedKey &&
        sessionSearchTargetTurn.turnIndex === (message.turnIndex ?? 0)) ||
      (chatSearchOpen && chatSearchMatchedTurnIndexSet.has(message.turnIndex ?? 0));
    const turnIsChatSearchActive =
      chatSearchOpen && chatSearchActiveTurnIndex === (message.turnIndex ?? 0);
```

Then find the `<ChatTurnView ... />` JSX in the same callback and add the `highlightQuery` prop (pass the live query only for the active matched turn; `undefined` otherwise so non-active turns render plain):

```tsx
          highlightQuery={turnIsChatSearchActive ? chatSearchQuery : undefined}
```

Finally, update the `useCallback` dependency array of `renderChatMessageTurn` to include the four new inputs: `chatSearchActiveTurnIndex`, `chatSearchMatchedTurnIndexSet`, `chatSearchOpen`, `chatSearchQuery`.

- [ ] **Step 3: Typecheck and build**

Run: `cd app && npm run tsc:web && npm run build:web`
Expected: no type errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/web/src/chat/ChatTurnView.tsx app/web/src/app/WorkspaceApp.tsx
git commit -m "feat: highlight chat search matches at turn and character level"
```

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `cd app && npm test`
Expected: all tests pass, including the new `web-chat-search-state` tests and the existing `web-session-search-state` tests.

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run tsc:web`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `cd app && npm run build:web`
Expected: build succeeds.

- [ ] **Step 4: Manual verification (run the dev server with `cd app && npm run web`)**

Verify against the spec acceptance criteria:
- With preview closed, Ctrl+F opens the chat search bar and focuses the input (does not fall through to the browser).
- Typing a query shows `1/N`; a query with no matches shows "No results"; empty query shows "Search current session".
- Only user prompts and assistant replies match (thoughts / tool calls do not).
- Prev/next buttons (and Enter / Shift+Enter) scroll to the target turn, including turns far off-screen in a long session.
- Matched turns get the yellow outline; the active turn additionally shows character-level yellow highlight in the user-prompt text.
- Switcher: "All sessions" closes the bar and opens the cross-session search input; "File preview" (enabled only when preview is open) closes the bar and opens preview search.
- Escape closes the bar; switching to another session closes the bar.
- While a session is streaming a reply, newly arrived matching text updates the match count.
- The title-bar search icon toggles the bar; existing preview search still works when opened via the switcher.

- [ ] **Step 5: Final commit (only if manual verification surfaced fixes)**

```bash
git add -A
git commit -m "test: final adjustments from manual verification"
```

---

## Self-Review Notes

- **Spec coverage:** Goal/decision/acceptance all mapped to tasks — match computation & highlight (Task 2), Ctrl+F routing + title button + switcher (Tasks 3-4), turn + character highlight (Task 5), streaming/switch-session/close behavior (Tasks 3 & 6). Range ("only body text") locked in `isChatSearchableMethod`. No-focus-router decision honored: Ctrl+F is unconditional `openChatSearch`; the switcher provides explicit cross-target navigation.
- **Placeholder scan:** no TBD/TODO; every code step has full source.
- **Type consistency:** `ChatSearchMatch`, `buildChatSearchMatches`, `splitChatSearchHighlightSegments`, `chatSearchMatchedTurnIndexSet`, `chatSearchActiveTurnIndex`, `highlightQuery` are used consistently across tasks. `msgText`/`extract*` signatures match between `chatMessageText.ts` and their original site.
