# Chat 布局与搜索 UX 迭代（9 点）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 固定 800px 对话列并删除视图宽度配置；会话搜索条限宽 800px、删除切换器、改为「各区域搜索按钮 + Windows 全局 Ctrl+F 模态三目标选择器」；修复 pin 悬浮列顶部 padding、session 搜索展开方向、Sessions 标题对齐、归档视图遮挡与行布局。

**Architecture:** 纯前端 `app/web`。纯逻辑抽到独立模块做 Jest 单测（新增 `chat/search/searchTargetPicker.ts`；`sessionNavSlideOutState.ts` 加 `archivedOpen`）；`WorkspaceApp.tsx` 持有模态选择器局部 state 与全局（仅 Windows）Ctrl+F 监听；布局类修复全部落在 `chat.css` / `base.css`。行号以当前 main（364f8efa）为锚点，漂移时按给出的上下文代码定位。

**Tech Stack:** React + TypeScript + webpack + Jest（node 环境，无 DOM 测试设施；UI 接线靠 `tsc:web` + `build:web` + 手动验证）。

**Verification commands (run from `app/`):**
- Tests: `cd app && npm test`
- Typecheck: `cd app && npm run tsc:web`
- Build: `cd app && npm run build:web`

---

## File Structure

- **Delete** `app/web/src/chat/chatViewWidth.ts` — 视图宽度设置整体移除。
- **Modify** `app/web/src/workspace/WorkspacePersistence.ts` — 移除 `chatViewWidth` 持久化 key 的全部 6 处引用。
- **Modify** `app/web/src/settings/SettingsRootContent.tsx` — 移除设置页 Chat View Width 选项。
- **Create** `app/web/src/chat/search/searchTargetPicker.ts` — 模态选择器纯函数：目标列表、可用性、循环。
- **Create** `app/__tests__/web-chat-search-target-picker.test.ts` — 上述纯函数单测。
- **Modify** `app/web/src/chat/session/sessionNavSlideOutState.ts` — suppression 输入加 `archivedOpen`。
- **Modify** `app/web/src/chat/session/sessionNavSlideOutState.test.ts` — 对应单测（colocated）。
- **Modify** `app/web/src/app/WorkspaceApp.tsx` — 删宽度 state、删两处 Ctrl+F 分支、模态选择器 state/effects/JSX、删切换器、preview chrome props、归档门控。
- **Modify** `app/web/src/preview/PreviewWorkbenchChrome.tsx` — toolbar 增加搜索按钮（新 props）。
- **Modify** `app/web/src/styles/chat.css` — 搜索条限宽、删切换器样式、模态样式、session 搜索展开覆盖层、Sessions 标题左对齐、pin 悬浮列 top、icon-button active。
- **Modify** `app/web/src/styles/base.css` — 归档行四列网格修复。
- **Modify** `app/__tests__/web-chat-view-width-settings.test.ts` — 删除宽度设置测试，新增「设置已移除」守卫测试。
- **Modify** `app/__tests__/web-chat-recent-sessions-ui.test.ts` — 更新 chatMainClassName 断言。
- **Modify** `app/__tests__/web-chat-file-peek-viewer.test.ts` — Ctrl+F 路由断言更新为模态选择器逻辑。

---

## Task 1: 删除视图宽度设置（固定 800px）

**Files:**
- Delete: `app/web/src/chat/chatViewWidth.ts`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts`
- Modify: `app/web/src/settings/SettingsRootContent.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-view-width-settings.test.ts`
- Modify: `app/__tests__/web-chat-recent-sessions-ui.test.ts`

注意：`chat.css` 的 `.chat-view-width-fixed-800*` 规则**全部保留**（类名继续无条件使用）。IndexedDB 中旧的 `chatViewWidth` 持久化行不做清理（不再被读取，自然失效）。

- [ ] **Step 1: 删除 chatViewWidth.ts 与 WorkspacePersistence 引用**

```bash
git rm app/web/src/chat/chatViewWidth.ts
```

`WorkspacePersistence.ts` 做 6 处删除（每处 old_string 唯一）：

(a) 删除 import（第 14-18 行）：

```ts
import {
  DEFAULT_CHAT_VIEW_WIDTH,
  normalizeChatViewWidth,
  type ChatViewWidth,
} from '../chat/chatViewWidth';
```

(b) 删除类型字段（第 67 行）：

```ts
  chatViewWidth: ChatViewWidth;
```

(c) 删除 GLOBAL_KEYS 条目（第 286 行）：

```ts
  chatViewWidth: 'chatViewWidth',
```

(d) 删除默认值（第 324 行）：

```ts
    chatViewWidth: DEFAULT_CHAT_VIEW_WIDTH,
```

(e) 删除 normalize 调用（第 540 行）：

```ts
    chatViewWidth: normalizeChatViewWidth(input.chatViewWidth, base.chatViewWidth),
```

(f) 删除持久化行（第 1112 行）：

```ts
      {k: GLOBAL_KEYS.chatViewWidth, v: serialize(this.state.global.chatViewWidth), updatedAt},
```

- [ ] **Step 2: SettingsRootContent.tsx 移除设置项**

(a) 删除 import（第 3 行）：

```ts
import {CHAT_VIEW_WIDTH_OPTIONS, isChatViewWidth, type ChatViewWidth} from '../chat/chatViewWidth';
```

(b) 删除 props 字段（第 46-47 行）：

```ts
  chatViewWidth: ChatViewWidth;
  setChatViewWidth: (value: ChatViewWidth) => void;
```

(c) 删除解构（第 176-177 行）：

```ts
  chatViewWidth,
  setChatViewWidth,
```

(d) 删除 JSX 控件块（第 234-255 行，Appearance 段内 Dark Mode 行之后）：

```tsx
          {isWide ? (
            <label className="settings-row sidebar-setting-row">
              <span>
                <span className="codicon codicon-layout settings-row-icon" aria-hidden="true" />
                Chat View Width
              </span>
              <select
                className="sidebar-setting-select"
                value={chatViewWidth}
                onChange={event => {
                  const next = event.target.value;
                  if (isChatViewWidth(next)) setChatViewWidth(next);
                }}
              >
                {CHAT_VIEW_WIDTH_OPTIONS.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
```

- [ ] **Step 3: WorkspaceApp.tsx 移除引用**

(a) 删除 import（第 181-184 行）：

```ts
import {
  normalizeChatViewWidth,
  type ChatViewWidth,
} from '../chat/chatViewWidth';
```

(b) 删除 state（第 2502-2504 行）：

```ts
  const [chatViewWidth, setChatViewWidth] = useState<ChatViewWidth>(
    normalizeChatViewWidth(persistedGlobal.chatViewWidth),
  );
```

(c) `chatMainClassName`（第 5105-5107 行）替换为：

```ts
  const chatMainClassName = isWide
    ? `chat-main chat-view-width-fixed-800${showChatEdgeSurfaces ? ' chat-view-width-fixed-800-edge-surfaces' : ''}`
    : 'chat-main';
```

(d) `desktopChatFixedPreview`（第 5108 行）替换为：

```ts
  const desktopChatFixedPreview = isWide && chatPreviewOpen;
```

(e) `rememberGlobalState` 参数（第 6041 行）与依赖数组（第 6068 行）各删一行。参数处（6 空格缩进）：

```ts
      codeTabSize,
      chatViewWidth,
      sessionListDensity,
```

改为：

```ts
      codeTabSize,
      sessionListDensity,
```

依赖数组处（4 空格缩进）：

```ts
    codeTabSize,
    chatViewWidth,
    sessionListDensity,
```

改为：

```ts
    codeTabSize,
    sessionListDensity,
```

(f) 删除传给 SettingsRootContent 的两个 props（第 15903-15904 行）：

```tsx
        chatViewWidth={chatViewWidth}
        setChatViewWidth={setChatViewWidth}
        sessionListDensity={sessionListDensity}
```

改为：

```tsx
        sessionListDensity={sessionListDensity}
```

- [ ] **Step 4: 改写 web-chat-view-width-settings.test.ts**

(a) 删除 import（第 4-9 行）：

```ts
import {
  CHAT_VIEW_WIDTH_OPTIONS,
  DEFAULT_CHAT_VIEW_WIDTH,
  isChatViewWidth,
  normalizeChatViewWidth,
} from '../web/src/chat/chatViewWidth';
```

(b) 将 describe 标题 `'web chat view width settings'` 改为 `'web chat fixed 800px layout'`。

(c) 删除第一个测试（第 23-33 行，整块）：

```ts
  test('defines full and fixed-width chat view choices', () => {
    expect(DEFAULT_CHAT_VIEW_WIDTH).toBe('fixed-800');
    expect(CHAT_VIEW_WIDTH_OPTIONS.map(option => option.id)).toEqual(['full', 'fixed-800']);
    expect(CHAT_VIEW_WIDTH_OPTIONS.map(option => option.label)).toEqual(['Full', '800px']);
    expect(isChatViewWidth('full')).toBe(true);
    expect(isChatViewWidth('fixed-800')).toBe(true);
    expect(isChatViewWidth('760')).toBe(false);
    expect(normalizeChatViewWidth('fixed-560')).toBe('fixed-800');
    expect(normalizeChatViewWidth('bad-width')).toBe(DEFAULT_CHAT_VIEW_WIDTH);
    expect(normalizeChatViewWidth(undefined)).toBe('fixed-800');
  });
```

(d) 将测试 `'persists chat view width and exposes it in PC Appearance settings'`（第 109-146 行，整块含 `settingsRootTsx`/`persistence` 断言）替换为：

```ts
  test('removes the chat view width setting and always uses the fixed 800px layout', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const settingsRootTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'));
    const persistence = readSourceText(path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'));

    expect(persistence).not.toContain('chatViewWidth');
    expect(settingsRootTsx).not.toContain('chatViewWidth');
    expect(settingsRootTsx).not.toContain('Chat View Width');
    expect(mainTsx).not.toContain('chatViewWidth');
    expect(mainTsx).toContain('const chatMainClassName = isWide');
    expect(mainTsx).toContain("`chat-main chat-view-width-fixed-800${showChatEdgeSurfaces ? ' chat-view-width-fixed-800-edge-surfaces' : ''}`");
  });
```

(e) 测试 `'keeps fixed-width chat centered while preserving preview resize'` 中（第 179 行）：

```ts
    expect(mainTsx).toContain("const desktopChatFixedPreview = isWide && chatPreviewOpen && chatViewWidth === 'fixed-800';");
```

替换为：

```ts
    expect(mainTsx).toContain('const desktopChatFixedPreview = isWide && chatPreviewOpen;');
```

其余测试（sessionListDensity、fixed-width messages/composer CSS）不动。

- [ ] **Step 5: 更新 web-chat-recent-sessions-ui.test.ts**

第 185 行：

```ts
    expect(mainTsx).toContain("chatViewWidth === 'fixed-800' ? `chat-main chat-view-width-fixed-800${showChatEdgeSurfaces ? ' chat-view-width-fixed-800-edge-surfaces' : ''}` : 'chat-main'");
```

替换为：

```ts
    expect(mainTsx).toContain('const chatMainClassName = isWide');
    expect(mainTsx).toContain("`chat-main chat-view-width-fixed-800${showChatEdgeSurfaces ? ' chat-view-width-fixed-800-edge-surfaces' : ''}`");
```

- [ ] **Step 6: 验证**

Run: `cd app && npm run tsc:web && npm test`
Expected: typecheck 通过；全部测试通过（含改写后的两个测试文件）。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove chat view width setting, fix chat column at 800px"
```

---

## Task 2: `searchTargetPicker.ts` 纯函数（TDD）

**Files:**
- Create: `app/__tests__/web-chat-search-target-picker.test.ts`
- Create: `app/web/src/chat/search/searchTargetPicker.ts`

- [ ] **Step 1: 写失败测试**

Create `app/__tests__/web-chat-search-target-picker.test.ts`:

```ts
import {
  CHAT_SEARCH_TARGET_ORDER,
  cycleChatSearchTarget,
  firstEnabledChatSearchTarget,
  resolveChatSearchTargetAvailability,
} from '../web/src/chat/search/searchTargetPicker';

describe('chat search target picker', () => {
  test('lists current, sessions, preview in order', () => {
    expect(CHAT_SEARCH_TARGET_ORDER).toEqual(['current', 'sessions', 'preview']);
  });

  test('preview availability follows preview content', () => {
    expect(resolveChatSearchTargetAvailability({previewAvailable: true})).toEqual({
      current: true,
      sessions: true,
      preview: true,
    });
    expect(resolveChatSearchTargetAvailability({previewAvailable: false})).toEqual({
      current: true,
      sessions: true,
      preview: false,
    });
  });

  test('first enabled target skips disabled entries', () => {
    expect(firstEnabledChatSearchTarget(resolveChatSearchTargetAvailability({previewAvailable: true}))).toBe('current');
    expect(firstEnabledChatSearchTarget({current: false, sessions: true, preview: false})).toBe('sessions');
    expect(firstEnabledChatSearchTarget({current: false, sessions: false, preview: false})).toBe('current');
  });

  test('cycling wraps around and skips disabled targets', () => {
    const all = resolveChatSearchTargetAvailability({previewAvailable: true});
    expect(cycleChatSearchTarget('current', 1, all)).toBe('sessions');
    expect(cycleChatSearchTarget('sessions', 1, all)).toBe('preview');
    expect(cycleChatSearchTarget('preview', 1, all)).toBe('current');
    expect(cycleChatSearchTarget('current', -1, all)).toBe('preview');
    const noPreview = resolveChatSearchTargetAvailability({previewAvailable: false});
    expect(cycleChatSearchTarget('current', 1, noPreview)).toBe('sessions');
    expect(cycleChatSearchTarget('sessions', 1, noPreview)).toBe('current');
    expect(cycleChatSearchTarget('sessions', -1, noPreview)).toBe('current');
  });

  test('cycling away from a disabled current target lands on an enabled one', () => {
    const availability = {current: false, sessions: true, preview: true};
    expect(cycleChatSearchTarget('current', 1, availability)).toBe('sessions');
    expect(cycleChatSearchTarget('current', -1, availability)).toBe('preview');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npm test -- web-chat-search-target-picker`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `app/web/src/chat/search/searchTargetPicker.ts`:

```ts
// Pure state helpers for the Windows Ctrl+F search-target picker modal.

export type ChatSearchTarget = 'current' | 'sessions' | 'preview';

export const CHAT_SEARCH_TARGET_ORDER: ChatSearchTarget[] = ['current', 'sessions', 'preview'];

export type ChatSearchTargetAvailability = Record<ChatSearchTarget, boolean>;

export const CHAT_SEARCH_TARGET_META: Record<
  ChatSearchTarget,
  {label: string; icon: string; hint: string}
> = {
  current: {
    label: 'Current session',
    icon: 'codicon-comment-discussion',
    hint: 'Search messages in this chat',
  },
  sessions: {
    label: 'All sessions',
    icon: 'codicon-list-tree',
    hint: 'Search session titles',
  },
  preview: {
    label: 'File preview',
    icon: 'codicon-go-to-file',
    hint: 'Search in the open file',
  },
};

export function resolveChatSearchTargetAvailability(input: {
  previewAvailable: boolean;
}): ChatSearchTargetAvailability {
  return {
    current: true,
    sessions: true,
    preview: input.previewAvailable,
  };
}

export function firstEnabledChatSearchTarget(
  availability: ChatSearchTargetAvailability,
): ChatSearchTarget {
  return CHAT_SEARCH_TARGET_ORDER.find(target => availability[target]) ?? 'current';
}

export function cycleChatSearchTarget(
  current: ChatSearchTarget,
  delta: 1 | -1,
  availability: ChatSearchTargetAvailability,
): ChatSearchTarget {
  const order = CHAT_SEARCH_TARGET_ORDER;
  const startIndex = Math.max(0, order.indexOf(current));
  for (let step = 1; step <= order.length; step += 1) {
    const next = order[(startIndex + step * delta + order.length * order.length) % order.length];
    if (availability[next]) {
      return next;
    }
  }
  return current;
}
```

- [ ] **Step 4: 跑测试确认通过 + typecheck**

Run: `cd app && npm test -- web-chat-search-target-picker && npm run tsc:web`
Expected: 5 tests PASS；无类型错误。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/chat/search/searchTargetPicker.ts app/__tests__/web-chat-search-target-picker.test.ts
git commit -m "feat: add search target picker state helpers"
```

---

## Task 3: 移除窗口级 Ctrl+F + Windows 全局模态选择器

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: 加 import**

在 `} from '../chat/search/chatSearchState';`（约第 165 行）之后插入：

```ts
import {
  CHAT_SEARCH_TARGET_META,
  CHAT_SEARCH_TARGET_ORDER,
  cycleChatSearchTarget,
  firstEnabledChatSearchTarget,
  resolveChatSearchTargetAvailability,
  type ChatSearchTarget,
} from '../chat/search/searchTargetPicker';
```

- [ ] **Step 2: 加 state 与 availability memo**

锚点是 `useChatSearchController({...})` 调用的结尾：

```tsx
    scrollToMatch: scrollToChatSearchMatch,
  });
```

在其后插入：

```tsx
  const [searchTargetPickerOpen, setSearchTargetPickerOpen] = useState(false);
  const [searchTargetPickerTarget, setSearchTargetPickerTarget] = useState<ChatSearchTarget>('current');
  const searchTargetAvailability = useMemo(
    () => resolveChatSearchTargetAvailability({previewAvailable: chatPreviewHasContent}),
    [chatPreviewHasContent],
  );
```

- [ ] **Step 3: 用 confirmSearchTarget 替换 switchChatSearchTarget**

将 `switchChatSearchTarget`（约第 3576-3595 行，整块）：

```tsx
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

替换为：

```tsx
  const confirmSearchTarget = (target: ChatSearchTarget) => {
    setSearchTargetPickerOpen(false);
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
  // Still used by the chat search bar switcher; removed together with the switcher.
  const switchChatSearchTarget = (target: 'current' | 'sessions' | 'preview') => {
    confirmSearchTarget(target);
  };
```

- [ ] **Step 4: 删除全局 keydown 的 Ctrl+F 分支**

在 `handleGlobalPreviewKeyDown`（约第 18737 行起）中删除 F 分支。old_string：

```tsx
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
```

new_string：

```tsx
      if (quickFileOpen) {
        return;
      }
      if (!chatPreviewOpen) {
        return;
      }
```

同时从该 effect 的依赖数组中删除 `    openChatSearch,` 一行（deps 为 `activeWorkbenchTab?.id, chatPreviewOpen, openChatSearch, openQuickFileSearch, previewWorkbenchTabs, quickFileOpen`）。

- [ ] **Step 5: 删除 workbench 局部 Ctrl+F 分支**

在 `handlePreviewWorkbenchKeyDown`（约第 19432 行起）中。old_string：

```tsx
    if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      openChatSearch();
      return;
    }
    if (event.key.toLowerCase() === 'p' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      openQuickFileSearch();
      return;
    }
```

new_string：

```tsx
    if (event.key.toLowerCase() === 'p' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      openQuickFileSearch();
      return;
    }
```

- [ ] **Step 6: 新增 Windows 全局 Ctrl+F 监听与模态键盘导航 effect**

在全局 preview keydown effect 的结尾 `]);`（约第 18795 行）之后插入两个 effect：

```tsx
  useEffect(() => {
    if (!isWindowsPlatform) {
      return;
    }
    const handleGlobalSearchTargetKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (quickFileOpen) {
        return;
      }
      if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setSearchTargetPickerTarget(firstEnabledChatSearchTarget(searchTargetAvailability));
        setSearchTargetPickerOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalSearchTargetKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalSearchTargetKeyDown, true);
  }, [isWindowsPlatform, quickFileOpen, searchTargetAvailability]);

  useEffect(() => {
    if (!searchTargetPickerOpen) {
      return;
    }
    const handleSearchTargetPickerKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSearchTargetPickerOpen(false);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        confirmSearchTarget(searchTargetPickerTarget);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab') {
        event.preventDefault();
        const delta = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1;
        setSearchTargetPickerTarget(current => cycleChatSearchTarget(current, delta, searchTargetAvailability));
      }
    };
    window.addEventListener('keydown', handleSearchTargetPickerKeyDown, true);
    return () => window.removeEventListener('keydown', handleSearchTargetPickerKeyDown, true);
  }, [confirmSearchTarget, searchTargetAvailability, searchTargetPickerOpen, searchTargetPickerTarget]);
```

注意：第二个 effect 的 deps 含每次渲染新建的 `confirmSearchTarget`，会每次重挂监听，行为正确，与本文件既有模式一致。

- [ ] **Step 7: 模态 JSX + 挂载**

在 `const chatSearchStatus = ...`（约第 19835 行）之前插入：

```tsx
  const chatSearchTargetPickerOverlay = searchTargetPickerOpen ? (
    <div className="chat-search-target-backdrop" role="presentation" onClick={() => setSearchTargetPickerOpen(false)}>
      <div
        className="chat-search-target-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Choose search target"
        onClick={event => event.stopPropagation()}
      >
        <div className="chat-search-target-title">Search</div>
        {CHAT_SEARCH_TARGET_ORDER.map(target => {
          const meta = CHAT_SEARCH_TARGET_META[target];
          const enabled = searchTargetAvailability[target];
          const selected = searchTargetPickerTarget === target;
          return (
            <button
              key={target}
              type="button"
              className={`chat-search-target-option${selected ? ' selected' : ''}`}
              disabled={!enabled}
              onClick={() => confirmSearchTarget(target)}
            >
              <span className={`codicon ${meta.icon}`} aria-hidden="true" />
              <span className="chat-search-target-label">{meta.label}</span>
              <span className="chat-search-target-hint">{meta.hint}</span>
            </button>
          );
        })}
        <div className="chat-search-target-footer">Arrows / Tab to switch · Enter to open · Esc to close</div>
      </div>
    </div>
  ) : null;
```

挂载点：`{chatSearchBar}`（约第 17873 行）之后插入一行 `{chatSearchTargetPickerOverlay}`：

```tsx
            {chatSearchBar}
            {chatSearchTargetPickerOverlay}
```

- [ ] **Step 8: 模态 CSS**

在 `app/web/src/styles/chat.css` 末尾（`.chat-search-match` 规则之后）追加：

```css
.chat-search-target-backdrop {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, #000 34%, transparent);
}

.chat-search-target-dialog {
  width: 300px;
  padding: 12px;
  display: grid;
  gap: 4px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, transparent);
  border-radius: 10px;
  background: var(--surface-panel);
  box-shadow: 0 18px 44px color-mix(in srgb, #000 36%, transparent);
}

.chat-search-target-title {
  padding: 0 4px 6px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}

.chat-search-target-option {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  font-size: 12px;
}

.chat-search-target-option:hover:not(:disabled) {
  background: var(--hover);
}

.chat-search-target-option.selected {
  border-color: color-mix(in srgb, var(--accent-primary) 45%, var(--border-subtle));
  background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
}

.chat-search-target-option:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-search-target-option .codicon {
  color: var(--text-secondary);
}

.chat-search-target-option.selected .codicon {
  color: var(--accent-primary);
}

.chat-search-target-hint {
  color: var(--text-secondary);
  font-size: 11px;
}

.chat-search-target-footer {
  padding: 6px 4px 0;
  color: var(--text-secondary);
  font-size: 11px;
  text-align: center;
}
```

- [ ] **Step 9: 更新 web-chat-file-peek-viewer.test.ts**

将测试 `'global shortcuts route Ctrl+F to chat search and gate preview shortcuts on preview open'`（整块）替换为以下两个测试：

```ts
  test('global shortcuts keep preview keys gated and leave Ctrl+F to the Windows search picker', () => {
    const mainTsx = readSourceText(mainPath);
    const handlerStart = mainTsx.indexOf('const handleGlobalPreviewKeyDown = (event: KeyboardEvent) => {');
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    const handlerEnd = mainTsx.indexOf("window.addEventListener('keydown', handleGlobalPreviewKeyDown, true);", handlerStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handlerBody = mainTsx.slice(handlerStart, handlerEnd);
    const pShortcutIndex = handlerBody.indexOf("if (event.key.toLowerCase() === 'p' && (event.ctrlKey || event.metaKey)) {");
    const previewOpenGateIndex = handlerBody.indexOf('if (!chatPreviewOpen) {');

    expect(handlerBody).toContain('if (!chatPreviewOpen) {');
    expect(pShortcutIndex).toBeGreaterThanOrEqual(0);
    expect(previewOpenGateIndex).toBeGreaterThan(pShortcutIndex);
    expect(handlerBody).toContain("if (event.key === 'Tab' && (event.ctrlKey || event.metaKey)) {");
    expect(handlerBody).toContain("cyclePreviewTabId(previewWorkbenchTabs, activeWorkbenchTab?.id ?? '', event.shiftKey ? -1 : 1)");
    expect(handlerBody).toContain('activeTabIdByProjectId: {');
    expect(handlerBody).not.toContain("event.key.toLowerCase() === 'f'");
    expect(handlerBody).not.toContain('openChatSearch();');
    expect(handlerBody).not.toContain('setPreviewSearchOpen(true);');
    expect(mainTsx).toContain("window.addEventListener('keydown', handleGlobalPreviewKeyDown, true);");
    expect(mainTsx).toContain("window.removeEventListener('keydown', handleGlobalPreviewKeyDown, true);");
    expect(
      (mainTsx.match(/event\.key\.toLowerCase\(\) === 'f' && \(event\.ctrlKey \|\| event\.metaKey\)/g) ?? []).length,
    ).toBe(1);
  });

  test('windows Ctrl+F opens a modal search target picker', () => {
    const mainTsx = readSourceText(mainPath);
    expect(mainTsx).toContain('if (!isWindowsPlatform) {');
    expect(mainTsx).toContain('const handleGlobalSearchTargetKeyDown = (event: KeyboardEvent) => {');
    expect(mainTsx).toContain("event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey)");
    expect(mainTsx).toContain('firstEnabledChatSearchTarget(searchTargetAvailability)');
    expect(mainTsx).toContain('setSearchTargetPickerOpen(true);');
    expect(mainTsx).toContain("if (event.key === 'Escape') {");
    expect(mainTsx).toContain('confirmSearchTarget(searchTargetPickerTarget);');
    expect(mainTsx).toContain('cycleChatSearchTarget(current, delta, searchTargetAvailability)');
    expect(mainTsx).toContain('CHAT_SEARCH_TARGET_ORDER.map(target => {');
    expect(mainTsx).toContain('className="chat-search-target-backdrop"');
    expect(mainTsx).toContain('className="chat-search-target-dialog"');
  });
```

- [ ] **Step 10: 验证**

Run: `cd app && npm run tsc:web && npm test && npm run build:web`
Expected: typecheck 无错误；全部测试通过；构建成功。

- [ ] **Step 11: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-file-peek-viewer.test.ts
git commit -m "feat: replace window Ctrl+F listeners with Windows global search target picker"
```

---

## Task 4: 搜索条限宽 800px + 删切换器 + preview chrome 搜索按钮

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/preview/PreviewWorkbenchChrome.tsx`
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: 删除搜索条内的切换器 JSX**

在 `const chatSearchBar = ...` 中删除整个 `chat-search-switcher` 块。old_string：

```tsx
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
```

new_string：空（删除）。

- [ ] **Step 2: 删除 switchChatSearchTarget**

删除（Task 3 留下的委托函数）：

```tsx
  // Still used by the chat search bar switcher; removed together with the switcher.
  const switchChatSearchTarget = (target: 'current' | 'sessions' | 'preview') => {
    confirmSearchTarget(target);
  };
```

- [ ] **Step 3: PreviewWorkbenchChrome 加搜索按钮**

(a) props 类型（`PreviewWorkbenchChromeProps`，`onWorkbenchKeyDown` 之后）加三行：

```ts
  onWorkbenchKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  onSearch?: () => void;
  searchActive?: boolean;
  searchDisabled?: boolean;
```

(b) 解构（`onWorkbenchKeyDown,` 之后）加三行：

```ts
  onWorkbenchKeyDown,
  onSearch,
  searchActive = false,
  searchDisabled = false,
```

(c) toolbar 中，在 `<div className="preview-workbench-title" title={activeTitle}>{activeTitle}</div>` 之后、`{actions ? (` 之前插入：

```tsx
      {onSearch ? (
        <button
          type="button"
          className={`chat-preview-icon-button${searchActive ? ' active' : ''}`}
          onClick={onSearch}
          disabled={searchDisabled}
          title="Search in preview"
          aria-label="Search in preview"
          aria-pressed={searchActive}
        >
          <span className="codicon codicon-search" aria-hidden="true" />
        </button>
      ) : null}
```

- [ ] **Step 4: WorkspaceApp 传入新 props**

在 `renderPreviewWorkbenchSurface` 的 `<PreviewWorkbenchChrome ...>` 中，锚点 `      onWorkbenchKeyDown={handlePreviewWorkbenchKeyDown}`（第 19958 行）之前插入三行：

```tsx
      searchActive={previewSearchOpen}
      searchDisabled={!activeWorkbenchTab || !!previewSearchUnavailableMessage}
      onSearch={() => openPreviewSearch()}
```

- [ ] **Step 5: CSS 调整**

(a) `.chat-search-bar` 的 `grid-template-columns: 16px minmax(80px, 1fr) auto auto 24px 24px 24px;` 改为：

```css
  grid-template-columns: 16px minmax(80px, 1fr) auto 24px 24px 24px;
```

(b) 删除切换器样式（chat.css 约 6230-6263，四块）：

```css
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
```

(c) 在 chat.css 末尾（模态样式之后）追加限宽规则（顺序固定：edge-surfaces 规则必须在基础规则之后）：

```css
.chat-view-width-fixed-800 .chat-search-bar {
  width: min(800px, 100%);
  margin-left: auto;
  margin-right: auto;
}

.chat-view-width-fixed-800-edge-surfaces .chat-search-bar {
  width: var(--chat-fixed-column);
  margin-left: max(
    0px,
    min(
      max(var(--chat-fixed-centered), min(var(--chat-edge-reserved-left), var(--chat-fixed-right-min))),
      var(--chat-fixed-right-min)
    )
  );
  margin-right: auto;
}
```

(d) 在 `.chat-preview-icon-button:hover { ... }`（chat.css 约 366-384）之后追加：

```css
.chat-preview-icon-button.active {
  color: var(--accent-primary);
}

.chat-preview-icon-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 6: 验证**

Run: `cd app && npm run tsc:web && npm test && npm run build:web`
Expected: 无类型错误；测试通过；构建成功。

- [ ] **Step 7: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/preview/PreviewWorkbenchChrome.tsx app/web/src/styles/chat.css
git commit -m "feat: scope chat search bar to the 800px column and add per-surface search buttons"
```

---

## Task 5: session 搜索向左展开 + Sessions 标题左对齐（纯 CSS）

**Files:**
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: 追加规则**

在 chat.css 末尾追加：

```css
.chat-session-panel .chat-edge-surface-header {
  position: relative;
  grid-template-columns: 0 auto minmax(0, 1fr) auto auto;
}

.chat-session-panel .chat-edge-surface-toggle-spacer {
  display: none;
}

.chat-session-panel .chat-header-search-wrap {
  position: absolute;
  top: 50%;
  left: 8px;
  right: 8px;
  z-index: 2;
  transform: translateY(-50%);
  background: var(--surface-panel);
}

.chat-session-panel .chat-header-search-status {
  display: none;
}
```

原理：`.chat-header-search-wrap` 只在搜索展开时渲染（收起态是 `.chat-header-search-control.compact`），因此该规则天然只作用于展开态；绝对定位使展开表单从 panel 左 padding 边缘（8px）横跨整个 header，盖住标题与操作按钮，实现"向左展开、与左侧边框对齐"。grid 首列归零 + 隐藏 spacer 使 pinned/slideout 面板的 "Sessions" 标题与左侧对齐。

- [ ] **Step 2: 构建验证**

Run: `cd app && npm run tsc:web && npm run build:web`
Expected: 构建成功（纯 CSS，无类型变化）。

- [ ] **Step 3: Commit**

```bash
git add app/web/src/styles/chat.css
git commit -m "fix: expand session search leftward and left-align the Sessions title"
```

---

## Task 6: pin 态悬浮列顶部 padding（CSS 一行）

**Files:**
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: 修改既有规则**

把（约第 2837-2840 行）：

```css
.chat-edge-surface-stack.beside-pinned-session-panel {
  top: 0;
  left: 0;
}
```

改为：

```css
.chat-edge-surface-stack.beside-pinned-session-panel {
  top: 8px;
  left: 0;
}
```

（与浮动态基础 `top: 8px` 一致，即 wiki 约定的"与固定顶栏下缘保持 8px 顶部间距"。）

- [ ] **Step 2: Commit**

```bash
git add app/web/src/styles/chat.css
git commit -m "fix: keep top padding on the floating surface stack beside the pinned session panel"
```

---

## Task 7: 归档视图修复（遮挡 + 一条一行）

**Files:**
- Modify: `app/web/src/chat/session/sessionNavSlideOutState.test.ts`
- Modify: `app/web/src/chat/session/sessionNavSlideOutState.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/base.css`

- [ ] **Step 1: 写失败测试**

在 `app/web/src/chat/session/sessionNavSlideOutState.test.ts` 的 `describe('isSessionNavSlideOutCloseSuppressed', ...)` 内（既有 `it('is suppressed while searching, a menu is open, or the pointer is down in the list', ...)` 之后）追加：

```ts
  it('is suppressed while the archived view is open', () => {
    expect(isSessionNavSlideOutCloseSuppressed({ searchActive: false, menuOpen: false, pointerDownInList: false, archivedOpen: true })).toBe(true);
    expect(isSessionNavSlideOutCloseSuppressed({ searchActive: false, menuOpen: false, pointerDownInList: false, archivedOpen: false })).toBe(false);
    expect(isSessionNavSlideOutCloseSuppressed({ searchActive: false, menuOpen: false, pointerDownInList: false })).toBe(false);
  });
```

Run: `cd app && npm test -- sessionNavSlideOutState`
Expected: FAIL（`archivedOpen` 不在类型中 / 断言为 false）。

- [ ] **Step 2: 实现 suppression 扩展**

`sessionNavSlideOutState.ts` 中：

```ts
export type SessionNavSlideOutSuppressionInput = {
  searchActive: boolean;
  menuOpen: boolean;
  pointerDownInList: boolean;
  archivedOpen?: boolean;
};

export function isSessionNavSlideOutCloseSuppressed(
  input: SessionNavSlideOutSuppressionInput,
): boolean {
  return input.searchActive || input.menuOpen || input.pointerDownInList || input.archivedOpen === true;
}
```

Run: `cd app && npm test -- sessionNavSlideOutState`
Expected: PASS。

- [ ] **Step 3: WorkspaceApp 接线与门控**

(a) suppression 调用处（slideout `onPointerLeave`，约第 17982 行）。old_string：

```tsx
                sessionNavSlideOutAutoClose.schedule(
                  isSessionNavSlideOutCloseSuppressed({
                    searchActive: sessionSearchActive || sessionSearchHeaderExpanded,
                    menuOpen: sessionArchiveMenuOpen || !!wideProjectActionMenu || !!projectSessionActionMenu,
                    pointerDownInList: sessionNavSlideOutPointerDownRef.current,
                  }),
                );
```

new_string：

```tsx
                sessionNavSlideOutAutoClose.schedule(
                  isSessionNavSlideOutCloseSuppressed({
                    searchActive: sessionSearchActive || sessionSearchHeaderExpanded,
                    menuOpen: sessionArchiveMenuOpen || !!wideProjectActionMenu || !!projectSessionActionMenu,
                    pointerDownInList: sessionNavSlideOutPointerDownRef.current,
                    archivedOpen: archivedMode,
                  }),
                );
```

(b) archivedMode 下隐藏 Recent 分区（`renderWideProjectSessionNav`，约第 16397 行）。old_string：

```tsx
        {options?.includeRecent === false ? null : renderRecentSessionsSection(false)}
```

new_string：

```tsx
        {archivedMode || options?.includeRecent === false ? null : renderRecentSessionsSection(false)}
```

(c) archivedMode 下整体隐藏右侧悬浮列（约第 17936 行）。old_string：

```tsx
          {isWide ? (
            <div className={`chat-edge-surface-stack${!chatSidebarCollapsed ? ' beside-pinned-session-panel' : ''}${sessionNavSlideOut.open ? ' covered-by-session-panel' : ''}`}>
```

new_string：

```tsx
          {isWide && !archivedMode ? (
            <div className={`chat-edge-surface-stack${!chatSidebarCollapsed ? ' beside-pinned-session-panel' : ''}${sessionNavSlideOut.open ? ' covered-by-session-panel' : ''}`}>
```

(d) 同步释放布局预留（约第 5104 行）。old_string：

```ts
  const showChatEdgeSurfaces = isWide && (showFloatingSessionPanel || !!selectedChatPlan || showLimitsMonitor);
```

new_string：

```ts
  const showChatEdgeSurfaces = isWide && !archivedMode && (showFloatingSessionPanel || !!selectedChatPlan || showLimitsMonitor);
```

- [ ] **Step 4: 归档行四列网格修复（base.css）**

在 `app/web/src/styles/base.css` 的 `.archived-session-restore-popover { ... }` 规则（约第 300-311 行）之后追加：

```css
.wide-session-row.archived-session-row {
  grid-template-columns: 9px minmax(0, 1fr) auto auto;
}
```

（`.wide-session-row` 基础网格只有 3 列，而归档行渲染 4 个子元素（marker/title/agent-tag/time），第 4 个被挤到第二行——这正是"不是一条一行"的根因。复合选择器保证优先级。）

- [ ] **Step 5: 验证**

Run: `cd app && npm test && npm run tsc:web && npm run build:web`
Expected: 全部通过。

- [ ] **Step 6: Commit**

```bash
git add app/web/src/chat/session/sessionNavSlideOutState.ts app/web/src/chat/session/sessionNavSlideOutState.test.ts app/web/src/app/WorkspaceApp.tsx app/web/src/styles/base.css
git commit -m "fix: keep archived view unobstructed and restore one-row-per-item layout"
```

---

## Task 8: 最终验证

**Files:** none（仅验证）

- [ ] **Step 1: 全量测试**

Run: `cd app && npm test`
Expected: 全部通过，含新的 `web-chat-search-target-picker`、改写的 `web-chat-view-width-settings` 与 `web-chat-file-peek-viewer`。

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run tsc:web`
Expected: 无错误。

- [ ] **Step 3: 生产构建**

Run: `cd app && npm run build:web`
Expected: 构建成功。

- [ ] **Step 4: 手动验证（`cd app && npm run web`）**

对照 spec 验收标准：
- 桌面宽屏对话列恒为 800px 居中；设置页无 Chat View Width 选项。
- pin 会话面板时右侧悬浮列（Plan/Limits）与顶部保持 8px 间距。
- Ctrl+F（Windows）弹模态选择器；↑↓/Tab/Shift+Tab 循环；Enter 打开对应搜索栏（preview 未展开会自动展开；无 preview 内容时该目标禁用）；Esc 或点背板关闭。
- 搜索条只覆盖 800px 对话列上方；条内无切换器；chat 标题栏 / Sessions 标题栏 / Preview 工具栏各有搜索按钮。
- Sessions 面板（pinned 与 slideout）的 Sessions 标题文字左对齐；点搜索图标后表单向左展开至面板左边缘，盖住标题，关闭后恢复。
- Archived 视图（Recover...）：不被遮挡（浮动态滑出面板不自动关闭）、无 Recent 分区混入、归档行一条一行、Restore 弹层正常。
- 非 Windows（或浏览器 UA 非 Windows）下 Ctrl/Cmd+F 不被拦截。
- 既有搜索行为不回退：`1/N`、"No results"、Enter/Shift+Enter 翻页、切会话自动关闭。

- [ ] **Step 5: 如手动验证有修正，补一个收尾 commit**

```bash
git add -A
git commit -m "fix: final adjustments from manual verification"
```

---

## Self-Review Notes

- **Spec coverage:** 点1→Task 1；点2→Task 6；点3/9→Task 7；点4/5→Task 5；点6/7→Task 4；点8→Task 2+3。测试策略（纯函数 Jest + 断言类测试更新 + UI 手动兜底）与 spec 的「测试」节一致；范围之外各项未引入。
- **Placeholder scan:** 无 TBD/TODO；所有代码步骤带完整源码。
- **Type consistency:** `ChatSearchTarget`、`CHAT_SEARCH_TARGET_ORDER`、`CHAT_SEARCH_TARGET_META`、`resolveChatSearchTargetAvailability`、`firstEnabledChatSearchTarget`、`cycleChatSearchTarget` 在 Task 2 定义，Task 3 一致使用；`confirmSearchTarget`、`searchTargetAvailability`、`searchTargetPickerOpen/Target`、`chatSearchTargetPickerOverlay` 命名跨 Task 3/4 一致；`archivedOpen` 在 Task 7 的类型、调用、测试中一致。
