# PC 侧边栏模式迭代 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PC 端 Chat 默认进入浮动态（recent/plan 浮动面板 + 可滑出完整会话导航 + 两条常驻标题栏），并修复 800px 对话列横向对齐为连续无跳变公式。

**Architecture:** 纯逻辑（默认状态、对齐分段函数、滑出状态机）抽成独立模块用 jest 单测；UI 集成在 `WorkspaceApp.tsx` 内以锚点编辑完成；移动端代码路径完全不动。spec 见同目录 `spec-pc-sidebar-modes.md`。

**Tech Stack:** React 19 + TypeScript + webpack；测试 jest 30（babel-jest，`app/jest.config.js`，testEnvironment node）；校验命令 `npm test` 与 `npm run tsc:web`（工作目录 `app/`）。

**通用约定：**
- 所有 jest 运行命令的工作目录是 `D:\Code\WheelMaker\app`。
- typecheck 命令：`npm run tsc:web`（工作目录 `D:\Code\WheelMaker\app`），预期 0 error。
- 代码注释和标识符用英文。
- 每个 Task 的 Commit 步骤使用给出的 commit message。

---

### Task 1: `sidebarCollapsed` 默认值改为 true（浮动态成为默认）

**Files:**
- Modify: `app/web/src/shell/state/workspaceUiState.ts:169-172`
- Test: `app/web/src/shell/state/workspaceUiState.test.ts`（新建）

- [ ] **Step 1: Write the failing test**

新建 `app/web/src/shell/state/workspaceUiState.test.ts`：

```ts
import { createWorkspaceUiState } from './workspaceUiState';

describe('createWorkspaceUiState desktop defaults', () => {
  it('defaults sidebarCollapsed to true when no persisted value exists', () => {
    expect(createWorkspaceUiState().desktop.sidebarCollapsed).toBe(true);
  });

  it('defaults sidebarCollapsed to true when persisted value is not a boolean', () => {
    expect(createWorkspaceUiState({ sidebarCollapsed: 'yes' }).desktop.sidebarCollapsed).toBe(true);
  });

  it('keeps an explicitly persisted sidebarCollapsed value', () => {
    expect(createWorkspaceUiState({ sidebarCollapsed: false }).desktop.sidebarCollapsed).toBe(false);
    expect(createWorkspaceUiState({ sidebarCollapsed: true }).desktop.sidebarCollapsed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest web/src/shell/state/workspaceUiState.test.ts`
Expected: FAIL — 第一条断言得到 `false`，期望 `true`。

- [ ] **Step 3: Implement**

`app/web/src/shell/state/workspaceUiState.ts` 第 170-171 行：

```ts
      sidebarCollapsed:
        typeof input.sidebarCollapsed === 'boolean' ? input.sidebarCollapsed : true,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest web/src/shell/state/workspaceUiState.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/shell/state/workspaceUiState.ts app/web/src/shell/state/workspaceUiState.test.ts
git commit -m "feat(app): default desktop sidebar to floating mode"
```

---

### Task 2: 800px 对齐三段连续纯函数

**Files:**
- Create: `app/web/src/chat/layout/fixedChatAlignment.ts`
- Test: `app/web/src/chat/layout/fixedChatAlignment.test.ts`

公式（spec「流程」节）：C = min(columnWidth, W)；centered = (W−C)/2；rightMin = W−C−edgeGap；margin = max(0, min(max(centered, min(R, rightMin)), rightMin))。R=0 时退化为纯居中。

- [ ] **Step 1: Write the failing test**

新建 `app/web/src/chat/layout/fixedChatAlignment.test.ts`：

```ts
import { resolveFixedChatMarginLeft } from './fixedChatAlignment';

const EDGE_GAP = 18;
const R = 360 + EDGE_GAP + 12; // surface width + edge gap + column gap

describe('resolveFixedChatMarginLeft', () => {
  it('centers the column when the main area is wide', () => {
    // W=1600, C=800 -> centered = 400; rightMin = 782; min(R,782)=390; max(400,390)=400
    expect(resolveFixedChatMarginLeft({ mainWidth: 1600, surfaceReservedWidth: R, edgeGap: EDGE_GAP })).toBe(400);
  });

  it('docks to the reserved surface width when centering would overlap it', () => {
    // centered < R <= rightMin -> margin = R
    // W=1300: centered=250 < 390; rightMin=482 >= 390
    expect(resolveFixedChatMarginLeft({ mainWidth: 1300, surfaceReservedWidth: R, edgeGap: EDGE_GAP })).toBe(R);
  });

  it('shrinks below the reservation (overlap phase) once the right gutter hits its minimum', () => {
    // W=1200: rightMin=382 < R=390 -> min(R,382)=382; max(centered=200,382)=382
    expect(resolveFixedChatMarginLeft({ mainWidth: 1200, surfaceReservedWidth: R, edgeGap: EDGE_GAP })).toBe(382);
  });

  it('is continuous across the center/dock boundary', () => {
    // boundary: centered == R -> W = 800 + 2R = 1580
    const at = resolveFixedChatMarginLeft({ mainWidth: 1580, surfaceReservedWidth: R, edgeGap: EDGE_GAP });
    const before = resolveFixedChatMarginLeft({ mainWidth: 1579, surfaceReservedWidth: R, edgeGap: EDGE_GAP });
    const after = resolveFixedChatMarginLeft({ mainWidth: 1581, surfaceReservedWidth: R, edgeGap: EDGE_GAP });
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
    expect(at).toBe(R);
  });

  it('is continuous across the dock/overlap boundary', () => {
    // boundary: rightMin == R -> W = 800 + R + edgeGap = 1208
    const before = resolveFixedChatMarginLeft({ mainWidth: 1207, surfaceReservedWidth: R, edgeGap: EDGE_GAP });
    const after = resolveFixedChatMarginLeft({ mainWidth: 1209, surfaceReservedWidth: R, edgeGap: EDGE_GAP });
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });

  it('never moves the column more than the width change (continuity under resize)', () => {
    for (let w = 900; w < 2000; w += 1) {
      const a = resolveFixedChatMarginLeft({ mainWidth: w, surfaceReservedWidth: R, edgeGap: EDGE_GAP });
      const b = resolveFixedChatMarginLeft({ mainWidth: w + 1, surfaceReservedWidth: R, edgeGap: EDGE_GAP });
      expect(Math.abs(b - a)).toBeLessThanOrEqual(1);
    }
  });

  it('returns 0 when the main area is narrower than the column', () => {
    expect(resolveFixedChatMarginLeft({ mainWidth: 700, surfaceReservedWidth: R, edgeGap: EDGE_GAP })).toBe(0);
  });

  it('ignores the reservation when no surface is visible (pure centering)', () => {
    expect(resolveFixedChatMarginLeft({ mainWidth: 1200, surfaceReservedWidth: 0, edgeGap: EDGE_GAP })).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest web/src/chat/layout/fixedChatAlignment.test.ts`
Expected: FAIL — 模块不存在（Cannot find module './fixedChatAlignment'）。

- [ ] **Step 3: Implement**

新建 `app/web/src/chat/layout/fixedChatAlignment.ts`：

```ts
export const FIXED_CHAT_COLUMN_WIDTH = 800;

export type FixedChatAlignmentInput = {
  /** Width of the chat-main area in px (window minus preview minus pinned sidebar). */
  mainWidth: number;
  /** Reserved width for the floating surface column on the left; 0 when no surface is visible. */
  surfaceReservedWidth: number;
  /** Minimum gutter kept on the right side of the column. */
  edgeGap: number;
  /** Conversation column width; defaults to the fixed 800px view. */
  columnWidth?: number;
};

/**
 * Continuous three-phase margin for the fixed-width chat column:
 * 1. centered while there is slack;
 * 2. docked to the surface reservation (right gutter shrinks first);
 * 3. overlapping the surface (fade mask) once the right gutter bottoms out.
 */
export function resolveFixedChatMarginLeft(input: FixedChatAlignmentInput): number {
  const columnWidth = input.columnWidth ?? FIXED_CHAT_COLUMN_WIDTH;
  const column = Math.min(columnWidth, input.mainWidth);
  const centered = (input.mainWidth - column) / 2;
  const rightMin = input.mainWidth - column - input.edgeGap;
  const docked = Math.min(input.surfaceReservedWidth, rightMin);
  const margin = Math.min(Math.max(centered, docked), rightMin);
  return Math.max(0, margin);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest web/src/chat/layout/fixedChatAlignment.test.ts`
Expected: PASS（8 passed）。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/chat/layout/fixedChatAlignment.ts app/web/src/chat/layout/fixedChatAlignment.test.ts
git commit -m "feat(app): add continuous fixed-chat alignment resolver"
```

---

### Task 3: CSS 800px 对齐替换为连续公式 + modifier 条件扩展

**Files:**
- Modify: `app/web/src/styles/chat.css:4135-4162`
- Modify: `app/web/src/app/WorkspaceApp.tsx:5149-5152`

当前 `chat-view-width-fixed-800-pinned-recent` 只在 recent surface 可见时加，且 margin 公式有跳变。替换为与 Task 2 纯函数等价的 CSS clamp 公式，并把 modifier 条件扩展为「任一桌面浮动面板可见」（recent 浮层、plan、limits 三者之一）。

- [ ] **Step 1: Replace the CSS block**

删除 `app/web/src/styles/chat.css` 第 4135-4162 行整段（`.chat-view-width-fixed-800-pinned-recent { ... }` 及其 `.chat-view-content/.chat-composer-content` 规则），替换为：

```css
.chat-view-width-fixed-800-edge-surfaces {
  --chat-edge-reserve-edge-gap: max(10px, calc(18px + var(--chat-scrollbar-gutter-width, 8px) - 8px));
  /* R: reserved left width for the floating surface column (surface width + edge gap + 12px column gap). */
  --chat-edge-reserved-left: calc(
    min(360px, 100% - var(--chat-edge-reserve-edge-gap) - var(--chat-edge-reserve-edge-gap)) +
    var(--chat-edge-reserve-edge-gap) + 12px
  );
  /* Continuous three-phase margin (mirrors resolveFixedChatMarginLeft in chat/layout/fixedChatAlignment.ts):
     centered -> docked to --chat-edge-reserved-left -> overlap with fade. */
  --chat-fixed-column: min(800px, 100%);
  --chat-fixed-centered: calc((100% - var(--chat-fixed-column)) / 2);
  --chat-fixed-right-min: calc(100% - var(--chat-fixed-column) - var(--chat-edge-reserve-edge-gap));
}

.chat-view-width-fixed-800-edge-surfaces .chat-view-content,
.chat-view-width-fixed-800-edge-surfaces .chat-composer-content {
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

同时删除旧类名 `.chat-view-width-fixed-800-pinned-recent` 的其他引用（用 `rg -n "pinned-recent" app/web/src/styles/chat.css` 确认无残留）。

- [ ] **Step 2: Update the modifier condition in WorkspaceApp.tsx**

`app/web/src/app/WorkspaceApp.tsx` 第 5149-5152 行：

```ts
  const showPinnedRecentSessionsSurface = isWide && sidebarCollapsed && !archivedMode && !sessionSearchActive && recentSessionSections.length > 0;
  const showChatEdgeSurfaces = isWide && tab === 'chat' && (showPinnedRecentSessionsSurface || !!selectedChatPlan || showLimitsMonitor);
  const chatMainClassName = isWide
    ? (chatViewWidth === 'fixed-800' ? `chat-main chat-view-width-fixed-800${showChatEdgeSurfaces ? ' chat-view-width-fixed-800-edge-surfaces' : ''}` : 'chat-main')
    : 'chat-main';
```

注意 `selectedChatPlan` 与 `showLimitsMonitor` 在该文件第 5149 行之前均已定义（selectedChatPlan 来自 `extractLatestChatPlan`，约 3469 行；showLimitsMonitor 为现有布尔）。若 `showLimitsMonitor` 名称有出入，以 `rg -n "showLimitsMonitor" app/web/src/app/WorkspaceApp.tsx` 找到的实际标识符为准。

- [ ] **Step 3: Verify types and build**

Run: `npm run tsc:web`
Expected: 0 error。

- [ ] **Step 4: Commit**

```bash
git add app/web/src/styles/chat.css app/web/src/app/WorkspaceApp.tsx
git commit -m "fix(app): make fixed-800 chat alignment continuous across edge surfaces"
```

---

### Task 4: 滑出层状态机（纯逻辑）

**Files:**
- Create: `app/web/src/chat/session/sessionNavSlideOutState.ts`
- Test: `app/web/src/chat/session/sessionNavSlideOutState.test.ts`

- [ ] **Step 1: Write the failing test**

新建 `app/web/src/chat/session/sessionNavSlideOutState.test.ts`：

```ts
import {
  createSessionNavSlideOutState,
  isSessionNavSlideOutCloseSuppressed,
  sessionNavSlideOutReducer,
} from './sessionNavSlideOutState';

describe('sessionNavSlideOutReducer', () => {
  it('opens from the closed state', () => {
    const next = sessionNavSlideOutReducer(createSessionNavSlideOutState(), { type: 'open' });
    expect(next.open).toBe(true);
  });

  it('closes on requestClose when nothing suppresses it', () => {
    const open = sessionNavSlideOutReducer(createSessionNavSlideOutState(), { type: 'open' });
    const next = sessionNavSlideOutReducer(open, { type: 'requestClose', suppressed: false });
    expect(next.open).toBe(false);
  });

  it('stays open on requestClose while suppressed', () => {
    const open = sessionNavSlideOutReducer(createSessionNavSlideOutState(), { type: 'open' });
    const next = sessionNavSlideOutReducer(open, { type: 'requestClose', suppressed: true });
    expect(next.open).toBe(true);
  });

  it('remembers scrollTop across open/close cycles', () => {
    let state = sessionNavSlideOutReducer(createSessionNavSlideOutState(), { type: 'open' });
    state = sessionNavSlideOutReducer(state, { type: 'scroll', scrollTop: 240 });
    state = sessionNavSlideOutReducer(state, { type: 'requestClose', suppressed: false });
    expect(state.open).toBe(false);
    expect(state.scrollTop).toBe(240);
    state = sessionNavSlideOutReducer(state, { type: 'open' });
    expect(state.scrollTop).toBe(240);
  });

  it('resets state on forceReset (mode switch)', () => {
    let state = sessionNavSlideOutReducer(createSessionNavSlideOutState(), { type: 'open' });
    state = sessionNavSlideOutReducer(state, { type: 'scroll', scrollTop: 240 });
    state = sessionNavSlideOutReducer(state, { type: 'forceReset' });
    expect(state).toEqual({ open: false, scrollTop: 0 });
  });
});

describe('isSessionNavSlideOutCloseSuppressed', () => {
  it('is suppressed while searching, a menu is open, or the pointer is down in the list', () => {
    expect(isSessionNavSlideOutCloseSuppressed({ searchActive: true, menuOpen: false, pointerDownInList: false })).toBe(true);
    expect(isSessionNavSlideOutCloseSuppressed({ searchActive: false, menuOpen: true, pointerDownInList: false })).toBe(true);
    expect(isSessionNavSlideOutCloseSuppressed({ searchActive: false, menuOpen: false, pointerDownInList: true })).toBe(true);
    expect(isSessionNavSlideOutCloseSuppressed({ searchActive: false, menuOpen: false, pointerDownInList: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest web/src/chat/session/sessionNavSlideOutState.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: Implement**

新建 `app/web/src/chat/session/sessionNavSlideOutState.ts`：

```ts
export type SessionNavSlideOutState = {
  open: boolean;
  scrollTop: number;
};

export type SessionNavSlideOutAction =
  | { type: 'open' }
  | { type: 'requestClose'; suppressed: boolean }
  | { type: 'scroll'; scrollTop: number }
  | { type: 'forceReset' };

export function createSessionNavSlideOutState(): SessionNavSlideOutState {
  return { open: false, scrollTop: 0 };
}

export function sessionNavSlideOutReducer(
  state: SessionNavSlideOutState,
  action: SessionNavSlideOutAction,
): SessionNavSlideOutState {
  switch (action.type) {
    case 'open':
      return { ...state, open: true };
    case 'requestClose':
      return action.suppressed ? state : { ...state, open: false };
    case 'scroll':
      return { ...state, scrollTop: Math.max(0, action.scrollTop) };
    case 'forceReset':
      return createSessionNavSlideOutState();
    default:
      return state;
  }
}

export type SessionNavSlideOutSuppressionInput = {
  searchActive: boolean;
  menuOpen: boolean;
  pointerDownInList: boolean;
};

export function isSessionNavSlideOutCloseSuppressed(
  input: SessionNavSlideOutSuppressionInput,
): boolean {
  return input.searchActive || input.menuOpen || input.pointerDownInList;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest web/src/chat/session/sessionNavSlideOutState.test.ts`
Expected: PASS（6 passed）。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/chat/session/sessionNavSlideOutState.ts app/web/src/chat/session/sessionNavSlideOutState.test.ts
git commit -m "feat(app): add session nav slide-out state machine"
```

---

### Task 5: 全局会话标题栏组件 `ChatSessionGlobalBar`

**Files:**
- Create: `app/web/src/chat/ChatSessionGlobalBar.tsx`

presentational 组件，按钮矩阵通过 props 控制；搜索/archive 控件以 `trailing` slot 传入（由 WorkspaceApp 复用现有 `renderChatArchiveControls` / `renderChatHeaderSearchControls` 闭包）。样式类名 `chat-session-global-bar*`，CSS 在 Task 9 统一添加。

- [ ] **Step 1: Create the component**

新建 `app/web/src/chat/ChatSessionGlobalBar.tsx`：

```tsx
import React, { type ReactNode } from 'react';

export type ChatSessionGlobalBarProps = {
  title: string;
  /** Floating recent panel only: toggle the all-sessions slide-out. */
  slideOutOpen?: boolean;
  onToggleSlideOut?: () => void;
  /** Show the pin toggle (pin = switch to the fixed sidebar mode). */
  pinActive?: boolean;
  onTogglePin?: () => void;
  /** Right-side controls (search / archive), shown when expanded or in pinned mode. */
  trailing?: ReactNode;
};

export const ChatSessionGlobalBar = React.memo(function ChatSessionGlobalBar({
  title,
  slideOutOpen,
  onToggleSlideOut,
  pinActive,
  onTogglePin,
  trailing,
}: ChatSessionGlobalBarProps) {
  return (
    <div className={`chat-session-global-bar${slideOutOpen ? ' slide-out-open' : ''}`}>
      <div className="chat-session-global-bar-leading">
        {onToggleSlideOut ? (
          <button
            type="button"
            className="chat-session-global-bar-btn"
            onClick={onToggleSlideOut}
            aria-expanded={!!slideOutOpen}
            aria-label={slideOutOpen ? 'Close all sessions' : 'Show all sessions'}
            title={slideOutOpen ? 'Close all sessions' : 'Show all sessions'}
          >
            <span
              className={`codicon ${slideOutOpen ? 'codicon-chevron-left' : 'codicon-list-flat'}`}
              aria-hidden="true"
            />
          </button>
        ) : null}
        <span className="chat-session-global-bar-title">{title}</span>
        {onTogglePin ? (
          <button
            type="button"
            className={`chat-session-global-bar-btn${pinActive ? ' active' : ''}`}
            onClick={onTogglePin}
            aria-pressed={!!pinActive}
            aria-label={pinActive ? 'Unpin session sidebar' : 'Pin session sidebar'}
            title={pinActive ? 'Unpin session sidebar' : 'Pin session sidebar'}
          >
            <span className="codicon codicon-pinned" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {trailing ? <div className="chat-session-global-bar-trailing">{trailing}</div> : null}
    </div>
  );
});
```

- [ ] **Step 2: Verify types**

Run: `npm run tsc:web`
Expected: 0 error。

- [ ] **Step 3: Commit**

```bash
git add app/web/src/chat/ChatSessionGlobalBar.tsx
git commit -m "feat(app): add chat session global bar component"
```

---

### Task 6: 顶部标题栏瘦身（搜索/archive 移出）+ pin 态 recent 区接入全局标题栏

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx:17066-17090`（`renderChatSessionHeader`）
- Modify: `app/web/src/app/WorkspaceApp.tsx:15401`（`renderRecentSessionsSection` 的桌面分支）

移动端保持现状：`renderChatSessionHeader(true)` 行为不变。

- [ ] **Step 1: Slim the desktop top title bar**

`renderChatSessionHeader`（17066-17090）改为按端区分控件集：

```tsx
  const renderChatSessionHeader = (mobile: boolean) => {
    const chatSessionHeaderClassName = `sidebar-title-row chat-session-header${sessionSearchHeaderExpanded ? ' search-open' : ''}${mobile ? ' mobile' : ''}`;
    const chatSessionHeaderContent = (
      <>
        {!sessionSearchHeaderExpanded ? (
          <>
            {renderChatMenuSettingsButton()}
          </>
        ) : null}
        <div className="chat-sidebar-title-actions">
          {renderChatHubSummary()}
          {mobile ? (
            <>
              {renderChatArchiveControls()}
              {renderChatHeaderSearchControls()}
            </>
          ) : null}
        </div>
      </>
    );
    if (mobile) {
      return <div className={chatSessionHeaderClassName}>{chatSessionHeaderContent}</div>;
    }
    return (
      <DesktopDragRegion className={chatSessionHeaderClassName}>
        {chatSessionHeaderContent}
      </DesktopDragRegion>
    );
  };
```

桌面端此时 `sessionSearchHeaderExpanded` 恒为 false（搜索控件已移走），保留条件渲染无害。

- [ ] **Step 2: Pinned sidebar recent section uses the global bar**

在 `renderRecentSessionsSection`（15401）中找到桌面（`mobile === false`）分支的 recent 分区标题行（包含 "Recent Sessions" 标题与折叠 toggle 的元素，类名含 `wide-project-row` / recent section header）。将该标题行替换为：

```tsx
        <ChatSessionGlobalBar
          title="Recent Sessions"
          pinActive={!sidebarCollapsed}
          onTogglePin={() => setSidebarCollapsed(value => !value)}
          trailing={
            <>
              {renderChatArchiveControls()}
              {renderChatHeaderSearchControls()}
            </>
          }
        />
```

并在文件顶部 import：

```ts
import { ChatSessionGlobalBar } from '../chat/ChatSessionGlobalBar';
```

保留原有折叠 toggle 行为：若原标题行承载 `toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)`，则把 global bar 包一层 div，`onClick` 不变；或把折叠 chevron 作为 `trailing` 的第一个元素。以不打断现有折叠交互为准，移动端分支（`renderRecentSessionsSection(true)`）一字不动。

注意：pin 态下搜索/archive 原本作用于整个侧边栏导航（结果替换 nav），该行为由 `sessionSearchActive` / `archivedMode` 全局状态驱动，与入口位置无关，无需额外改动。

- [ ] **Step 3: Verify types**

Run: `npm run tsc:web`
Expected: 0 error。

- [ ] **Step 4: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx
git commit -m "feat(app): slim desktop chat header and add global bar to pinned recent section"
```

---

### Task 7: 浮动态顶部标题栏（浮动、常驻）

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx:19286-19311`（surface stack 渲染）
- Modify: `app/web/src/styles/chat.css`（stack 样式，第 2757-2778 行附近追加）

- [ ] **Step 1: Always render the stack on desktop chat, with the floating top bar first**

`app/web/src/app/WorkspaceApp.tsx` 第 19286-19311 行替换为：

```tsx
          {isWide && tab === 'chat' ? (
            <div className="chat-edge-surface-stack">
              {sidebarCollapsed && !sidebarSettingsOpen ? (
                <div className="chat-top-title-surface">
                  <div className="chat-edge-surface-glass" aria-hidden="true" />
                  <div className="chat-edge-surface-content">
                    {renderChatSessionHeader(false)}
                  </div>
                </div>
              ) : null}
              {showPinnedRecentSessionsSurface ? (
                <ChatRecentSessionsSurface
                  collapsed={collapsedProjectIds.includes(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}
                  onToggleCollapsed={() => toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}
                  sessionListDensity={sessionListDensity}
                  header={
                    <ChatSessionGlobalBar
                      title="Recent Sessions"
                      slideOutOpen={sessionNavSlideOut.open}
                      onToggleSlideOut={() =>
                        dispatchSessionNavSlideOut(
                          sessionNavSlideOut.open ? { type: 'requestClose', suppressed: false } : { type: 'open' },
                        )
                      }
                      pinActive={false}
                      onTogglePin={() => setSidebarCollapsed(false)}
                    />
                  }
                >
                  <div className="wide-project-session-list recent-sessions-list chat-recent-sessions-rows">
                    {recentSessionSections.map(section => renderRecentProjectSessionSection(section, false))}
                  </div>
                </ChatRecentSessionsSurface>
              ) : null}
              <ChatPlanSurface
                mode="desktop"
                plan={selectedChatPlan}
              />
              {showLimitsMonitor ? (
                <UsageFeatureSurface
                  snapshot={usageSnapshot}
                  onRefresh={() => { void refreshUsageAcrossHubs(); }}
                  onRequestHide={() => setConfirmTarget({kind: 'hideLimitsMonitor'})}
                />
              ) : null}
            </div>
          ) : null}
```

说明：
- `sessionNavSlideOut` / `dispatchSessionNavSlideOut` 在 Task 8 定义；本 Task 先只接入顶部标题栏部分时，可暂时保留 `ChatRecentSessionsSurface` 原调用（不带 `header` prop），Task 8 再加。为减少任务间耦合，建议本 Task 只加 `chat-top-title-surface` 子树与 stack 常渲染，`ChatRecentSessionsSurface` 的 `header` 接线留到 Task 8。
- 原条件 `tab === 'chat' && showLimitsMonitor` 中的 `tab === 'chat' &&` 可去掉（外层已保证）。

- [ ] **Step 2: Add CSS for the floating top title surface**

`app/web/src/styles/chat.css` 在 `.chat-edge-surface-stack` 规则块（2757-2778）之后追加：

```css
.chat-top-title-surface {
  position: relative;
  width: 100%;
  pointer-events: auto;
}

.chat-top-title-surface .chat-session-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
}
```

（`.chat-edge-surface-stack` 的子元素已有 `pointer-events`/`width` 处理，见 chat.css:2929-2940；若现有规则已覆盖子元素，`pointer-events: auto` 可省略，以实际表现为准。）

- [ ] **Step 3: Verify types**

Run: `npm run tsc:web`
Expected: 0 error。

- [ ] **Step 4: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css
git commit -m "feat(app): float the desktop top title bar above the surface stack"
```

---

### Task 8: recent 浮动面板接入全局标题栏（`header` prop）

**Files:**
- Modify: `app/web/src/chat/ChatRecentSessionsSurface.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`（Task 7 的 stack 渲染处）
- Create: `app/web/src/chat/ChatRecentSessionsSurface.test.tsx`（可选；若 jsdom 不可用则跳过，见 Step 3 说明）

- [ ] **Step 1: Add the `header` prop**

`app/web/src/chat/ChatRecentSessionsSurface.tsx`：

```tsx
export type ChatRecentSessionsSurfaceProps = {
  children: ReactNode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sessionListDensity: SessionListDensity;
  /** Replaces the default expanded-state header (title + collapse toggle). */
  header?: ReactNode;
};
```

expanded 分支的 header 渲染改为：

```tsx
      <div className="chat-edge-surface-content">
        {header ?? (
          <div className="chat-recent-sessions-surface-header">
            <button
              type="button"
              className="chat-recent-sessions-surface-toggle"
              onClick={onToggleCollapsed}
              aria-expanded={true}
              aria-label="Collapse recent sessions"
              title="Collapse recent sessions"
            >
              <span className="codicon codicon-chevron-up" aria-hidden="true" />
            </button>
            <span className="chat-recent-sessions-surface-title">Recent Sessions</span>
          </div>
        )}
        <div className="chat-recent-sessions-surface-list">{children}</div>
      </div>
```

- [ ] **Step 2: Wire the global bar in WorkspaceApp**

在 Task 7 的 stack JSX 中给 `ChatRecentSessionsSurface` 传入 `header`（即 Task 7 Step 1 代码块中的 `header={...}` 片段）。同时在本文件添加滑出状态（放在其他 `useReducer` 附近，约 2636 行）：

```ts
  const [sessionNavSlideOut, dispatchSessionNavSlideOut] = useReducer(
    sessionNavSlideOutReducer,
    undefined,
    createSessionNavSlideOutState,
  );
```

并 import：

```ts
import {
  createSessionNavSlideOutState,
  isSessionNavSlideOutCloseSuppressed,
  sessionNavSlideOutReducer,
} from '../chat/session/sessionNavSlideOutState';
```

- [ ] **Step 3: Verify**

Run: `npm run tsc:web` 然后 `npx jest`
Expected: tsc 0 error；jest 全部 PASS（既有测试不受影响）。

- [ ] **Step 4: Commit**

```bash
git add app/web/src/chat/ChatRecentSessionsSurface.tsx app/web/src/app/WorkspaceApp.tsx
git commit -m "feat(app): use the global session bar on the floating recent surface"
```

---

### Task 9: 滑出会话导航层（overlay + 抑制 + 滚动记忆 + CSS）

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（stack 渲染之后追加 overlay；模式切换时 forceReset）
- Modify: `app/web/src/styles/chat.css`（追加 slide-out 与 global bar 样式）

- [ ] **Step 1: Render the slide-out overlay**

在 Task 7 的 stack `</div>` 之后、`{sidebarCollapsed ? renderWideProjectActionMenu() : null}` 之前插入：

```tsx
          {isWide && sidebarCollapsed && sessionNavSlideOut.open && tab === 'chat' ? (
            <div
              className="chat-session-nav-slideout"
              onPointerLeave={() => {
                dispatchSessionNavSlideOut({
                  type: 'requestClose',
                  suppressed: isSessionNavSlideOutCloseSuppressed({
                    searchActive: sessionSearchActive || sessionSearchHeaderExpanded,
                    menuOpen: sessionArchiveMenuOpen || !!wideProjectActionMenu || !!projectSessionActionMenu,
                    pointerDownInList: sessionNavSlideOutPointerDownRef.current,
                  }),
                });
              }}
            >
              <div className="chat-edge-surface-glass" aria-hidden="true" />
              <div className="chat-session-nav-slideout-content">
                <ChatSessionGlobalBar
                  title="Sessions"
                  slideOutOpen
                  onToggleSlideOut={() => dispatchSessionNavSlideOut({ type: 'requestClose', suppressed: false })}
                  pinActive={false}
                  onTogglePin={() => setSidebarCollapsed(false)}
                  trailing={
                    <>
                      {renderChatArchiveControls()}
                      {renderChatHeaderSearchControls()}
                    </>
                  }
                />
                <div
                  ref={sessionNavSlideOutScrollRef}
                  className="chat-session-nav-slideout-scroll"
                  onPointerDown={() => { sessionNavSlideOutPointerDownRef.current = true; }}
                  onPointerUp={() => { sessionNavSlideOutPointerDownRef.current = false; }}
                  onPointerCancel={() => { sessionNavSlideOutPointerDownRef.current = false; }}
                  onScroll={event => {
                    dispatchSessionNavSlideOut({ type: 'scroll', scrollTop: event.currentTarget.scrollTop });
                  }}
                >
                  {archivedMode ? renderArchivedSessionRows(false) : sessionSearchActive ? renderSessionSearchResults(false) : renderWideProjectSessionNav()}
                </div>
              </div>
            </div>
          ) : null}
```

配套 ref 与滚动恢复（放在 `sessionNavSlideOut` reducer 附近）：

```ts
  const sessionNavSlideOutScrollRef = useRef<HTMLDivElement | null>(null);
  const sessionNavSlideOutPointerDownRef = useRef(false);
  useEffect(() => {
    if (sessionNavSlideOut.open && sessionNavSlideOutScrollRef.current) {
      sessionNavSlideOutScrollRef.current.scrollTop = sessionNavSlideOut.scrollTop;
    }
    // Restore once per open transition only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionNavSlideOut.open]);
```

模式切换时重置：在 `sidebarCollapsed` 变为 false 的 effect（若无现成 effect，新增）：

```ts
  useEffect(() => {
    if (!sidebarCollapsed) {
      dispatchSessionNavSlideOut({ type: 'forceReset' });
    }
  }, [sidebarCollapsed]);
```

- [ ] **Step 2: Add CSS**

`app/web/src/styles/chat.css` 在 `.chat-top-title-surface` 规则（Task 7 添加）之后追加：

```css
.chat-session-global-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 6px;
}

.chat-session-global-bar-leading,
.chat-session-global-bar-trailing {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.chat-session-global-bar-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-session-global-bar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.chat-session-global-bar-btn:hover,
.chat-session-global-bar-btn.active {
  background: var(--button-secondary-hover-background, rgba(128, 128, 128, 0.18));
  color: var(--text-primary);
}

.chat-session-nav-slideout {
  position: absolute;
  top: 12px;
  left: var(--chat-edge-surface-stack-edge-gap, max(10px, calc(18px + var(--chat-scrollbar-gutter-width, 8px) - 8px)));
  z-index: 7;
  width: min(var(--chat-edge-surface-width, 360px), calc(100% - 2 * var(--chat-edge-surface-stack-edge-gap, 18px)));
  max-height: calc(100% - 24px);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  border-radius: 10px;
  overflow: hidden;
}

.chat-session-nav-slideout-content {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: inherit;
}

.chat-session-nav-slideout-content .chat-session-global-bar {
  flex: none;
  position: sticky;
  top: 0;
  z-index: 1;
}

.chat-session-nav-slideout-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
```

（毛玻璃底色复用 `.chat-edge-surface-glass`，与 stack 内面板一致；若该 class 依赖 `.chat-edge-surface-content` 兄弟结构，按 recent surface 的 DOM 结构对齐。）

- [ ] **Step 3: Verify**

Run: `npm run tsc:web` 然后 `npx jest`
Expected: tsc 0 error；jest 全部 PASS。

- [ ] **Step 4: Manual smoke check（人工/半自动）**

Run: `npm start`（webpack dev server），在 ≥900px 窗口验证：
1. 默认进入浮动态：顶部标题栏（设置+hubs）浮在左上，recent 面板显示全局标题栏 `[全部][Recent Sessions][pin]`；
2. 点「全部」→ 滑出完整会话导航（项目分组）；鼠标移出自动滑回；搜索框输入期间移出不滑回；
3. 再次打开滑出，滚动位置保持上次值；
4. 点 pin → 固定侧边栏，recent 区标题栏为 `[Recent Sessions][pin][archive][search]`；
5. 800px 模式下缓慢拖动窗口宽度，对话列连续移动：居中 → 左贴悬浮列 → fade 遮挡，无跳变。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css
git commit -m "feat(app): add slide-out session navigation overlay for floating mode"
```

---

### Task 10: 全量校验 + 收尾

- [ ] **Step 1: Run all tests**

Run: `npx jest`（工作目录 `app/`）
Expected: 全部 PASS。

- [ ] **Step 2: Typecheck**

Run: `npm run tsc:web`
Expected: 0 error。

- [ ] **Step 3: Production build**

Run: `npm run build:web`
Expected: 构建成功，无新增 warning。

- [ ] **Step 4: Completion gate（CLAUDE.md 要求）**

```bash
git add -A
git commit -m "feat(app): pc sidebar floating mode, global session bar, continuous 800px alignment"
git push origin <current-branch>
```

若任一步失败，报告并修复直至通过。
