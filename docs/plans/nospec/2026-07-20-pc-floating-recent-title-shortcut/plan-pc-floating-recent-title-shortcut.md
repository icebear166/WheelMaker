# PC Floating Recent Sessions Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the PC floating session card to one `RECENT SESSIONS` heading and add a visible `Ctrl+1` hint immediately before the all-sessions toggle.

**Architecture:** Keep the shared `ChatSessionPanel` and `ChatSessionGlobalBar` components. Give `renderRecentSessionsSection` a presentation option that suppresses only its inner heading for the floating call site, while mobile, slide-out, and pinned call sites retain the existing Recent section hierarchy. Add an opt-in shortcut-hint prop to the shared global bar and enable it only at the floating call site, so expanded, pinned, and mobile presentations remain unchanged.

**Tech Stack:** React 19, TypeScript, Jest/react-test-renderer, CSS.

---

### Task 1: Lock the floating-only hierarchy and shortcut hint with failing tests

**Files:**
- Modify: `app/web/src/chat/ChatRecentSessionsSurface.test.tsx`
- Modify: `app/web/src/chat/ChatSessionGlobalBar.test.tsx`
- Modify: `app/__tests__/web-chat-plan-surface.test.tsx`
- Modify: `app/__tests__/web-chat-recent-sessions-ui.test.ts`
- Modify: `app/__tests__/web-chat-session-panel-layout.test.tsx`

- [x] **Step 1: Update the floating surface assertions**

Change the title and accessibility expectations to the floating-specific name:

```tsx
expect(tree!.root.findByProps({className: 'chat-edge-surface-title'}).children).toEqual(['Recent Sessions']);
const collapse = tree!.root.findByProps({'aria-label': 'Collapse Recent Sessions'});
```

Apply the same `Recent Sessions`, `Expand Recent Sessions`, and `Collapse Recent Sessions` expectations in `web-chat-plan-surface.test.tsx`. Do not change pinned or slide-out assertions that still expect `Sessions`.

- [x] **Step 2: Assert that the shortcut is directly before the all-sessions button**

In `ChatSessionGlobalBar.test.tsx`, pass `showSlideOutShortcut` in the closed-state case, then inspect the layout action children and require the visible hint and button order:

```tsx
const actions = tree!.root.findByProps({className: 'chat-session-global-bar-layout-actions'});
expect(actions.children.slice(0, 2).map(child =>
  typeof child === 'string' ? child : child.props.className,
)).toEqual(['chat-session-global-bar-shortcut', 'chat-session-global-bar-btn']);
expect(actions.findByProps({className: 'chat-session-global-bar-shortcut'}).children).toEqual(['Ctrl+1']);
expect(actions.findByProps({'aria-label': 'Show all sessions'})).toBeDefined();
```

In the existing open-state case, do not pass `showSlideOutShortcut` and assert `findAllByProps({className: 'chat-session-global-bar-shortcut'})` has length `0`. This locks the hint to the floating opt-in rather than every shared bar instance.

- [x] **Step 3: Assert that only the floating call suppresses the inner Recent heading**

Update `web-chat-recent-sessions-ui.test.ts` so the floating panel must use the explicit heading option and shortcut opt-in, while the desktop navigation and mobile calls remain unchanged:

```ts
expect(mainTsx).toContain('{renderRecentSessionsSection(false, {showHeading: false})}');
expect(mainTsx).toContain('renderRecentSessionsSection(false)');
expect(mainTsx).toContain('renderRecentSessionsSection(true)');
const floatingStart = mainTsx.indexOf('{showFloatingSessionPanel ? (');
const floatingSource = mainTsx.slice(floatingStart, floatingStart + 2200);
expect(floatingSource).toContain('showSlideOutShortcut');
expect(mainTsx.match(/showSlideOutShortcut/g)).toHaveLength(1);
expect(surfaceTsx).toContain('title="Recent Sessions"');
```

Keep the existing assertions for `recent-sessions-section-heading`, `<span>Recent</span>`, and the history icon because those elements still belong to pinned, slide-out, and mobile presentations.

In `web-chat-session-panel-layout.test.tsx`, update the floating-source assertion to require `{renderRecentSessionsSection(false, {showHeading: false})}` while retaining the assertion that the floating surface does not render project sections independently.

- [x] **Step 4: Run the focused tests and verify the new expectations fail**

Run:

```powershell
cd app
npm test -- --runInBand web/src/chat/ChatRecentSessionsSurface.test.tsx web/src/chat/ChatSessionGlobalBar.test.tsx __tests__/web-chat-plan-surface.test.tsx __tests__/web-chat-recent-sessions-ui.test.ts
```

Expected: FAIL because the floating title is still `Sessions`, the shortcut element does not exist, and the floating call does not yet pass `showHeading: false`.

### Task 2: Implement the floating title, inner-heading option, and shortcut treatment

**Files:**
- Modify: `app/web/src/chat/ChatRecentSessionsSurface.tsx`
- Modify: `app/web/src/chat/ChatSessionGlobalBar.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`

- [x] **Step 1: Rename only the floating panel title**

In `ChatRecentSessionsSurface.tsx`, keep the shared panel but give it the floating-specific title:

```tsx
<ChatSessionPanel
  ref={surfaceRef}
  mode="floating"
  title="Recent Sessions"
  className={`chat-recent-sessions-surface desktop ${collapsed ? 'collapsed' : 'expanded'}`}
  ariaLabel="Recent sessions"
```

This intentionally lets `ChatSessionPanel` derive `Expand Recent Sessions` and `Collapse Recent Sessions` labels from the visible title.

- [x] **Step 2: Add an explicit heading-visibility option to the shared Recent renderer**

Replace the current renderer with the same structure plus an explicit desktop-heading option:

```tsx
const renderRecentSessionsSection = (
  mobile: boolean,
  options: {showHeading?: boolean} = {},
) => {
  if (archivedMode || sessionSearchActive) {
    return null;
  }
  if (recentSessionSections.length === 0) {
    return null;
  }
  const recentCollapsed = collapsedProjectIds.includes(RECENT_SESSIONS_VIRTUAL_PROJECT_ID);

  return (
    <div
      className={`wide-project-section recent-sessions-section${mobile ? ' mobile-project-section' : ''}${
        recentCollapsed ? ' collapsed' : ''
      }`}
    >
      {!mobile && options.showHeading !== false ? (
        <div className="recent-sessions-section-heading">
          <span className="codicon codicon-history" aria-hidden="true" />
          <span>Recent</span>
        </div>
      ) : null}
      {mobile ? (
        <div className="wide-project-row">
          <button
            type="button"
            className="wide-project-toggle"
            onClick={() => toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}
            title={recentCollapsed ? 'Expand Recent Sessions' : 'Collapse Recent Sessions'}
            aria-expanded={!recentCollapsed}
          >
            <span className="wide-project-folder-wrap">
              <span className="codicon codicon-history recent-sessions-icon" aria-hidden="true" />
            </span>
            <span className="wide-project-title-group">
              <span className="wide-project-name">Recent Sessions</span>
            </span>
          </button>
          <button
            type="button"
            className="wide-project-action-btn recent-sessions-collapse-btn"
            title={recentCollapsed ? 'Expand Recent Sessions' : 'Collapse Recent Sessions'}
            aria-label={recentCollapsed ? 'Expand Recent Sessions' : 'Collapse Recent Sessions'}
            aria-expanded={!recentCollapsed}
            onClick={() => toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}
          >
            <span className={`codicon ${recentCollapsed ? 'codicon-chevron-down' : 'codicon-chevron-up'}`} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {mobile && recentCollapsed ? null : (
        <div className={`wide-project-session-list recent-sessions-list${mobile ? ' mobile-project-session-list' : ''}`}>
          {recentSessionSections.map(section => renderRecentProjectSessionSection(section, mobile))}
        </div>
      )}
    </div>
  );
};
```

At the floating call site only, pass:

```tsx
{renderRecentSessionsSection(false, {showHeading: false})}
```

Leave `renderWideProjectSessionNav` and the mobile session navigation on their default `showHeading: true` path.

- [x] **Step 3: Add an opt-in keyboard hint next to the shared toggle**

In `ChatSessionGlobalBar.tsx`, extend the existing props and destructuring:

```tsx
export type ChatSessionGlobalBarProps = {
  /** Optional title text; omitted in the PC session panel chrome. */
  title?: string;
  /** Floating recent panel only: toggle the all-sessions slide-out. */
  slideOutOpen?: boolean;
  onToggleSlideOut?: () => void;
  /** Floating recent panel only: expose the keyboard toggle next to the button. */
  showSlideOutShortcut?: boolean;
  /** Show the pin toggle (pin = switch to the fixed sidebar mode). */
  pinActive?: boolean;
  onTogglePin?: () => void;
  /** List controls (archive / search), kept next to the title. */
  leading?: ReactNode;
};

export const ChatSessionGlobalBar = React.memo(function ChatSessionGlobalBar({
  title,
  slideOutOpen,
  onToggleSlideOut,
  showSlideOutShortcut,
  pinActive,
  onTogglePin,
  leading,
}: ChatSessionGlobalBarProps) {
```

Inside `chat-session-global-bar-layout-actions`, insert the opt-in hint immediately before the current toggle button:

```tsx
{showSlideOutShortcut && onToggleSlideOut ? (
  <span className="chat-session-global-bar-shortcut" aria-hidden="true">
    Ctrl+1
  </span>
) : null}
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
      className={`codicon ${slideOutOpen ? 'codicon-layout-sidebar-left-off' : 'codicon-layout-sidebar-left'}`}
      aria-hidden="true"
    />
  </button>
) : null}
```

At only the floating `ChatSessionGlobalBar` call site in `WorkspaceApp.tsx`, opt in:

```tsx
<ChatSessionGlobalBar
  showSlideOutShortcut
  slideOutOpen={sessionNavSlideOut.open}
  onToggleSlideOut={() =>
    sessionNavSlideOut.open
      ? sessionNavSlideOutAutoClose.closeNow()
      : dispatchSessionNavSlideOut({ type: 'open' })
  }
  pinActive={false}
  onTogglePin={pinChatSessionPanel}
/>
```

Do not pass `showSlideOutShortcut` to the slide-out or pinned global bars. The hint is decorative for assistive technology because the button retains its complete accessible name and the application already owns the Ctrl+1 behavior.

- [x] **Step 4: Style the hint as compact but clearly visible header metadata**

Add beside the global-bar action rules in `chat.css`:

```css
.chat-session-global-bar-shortcut {
  color: var(--text-secondary);
  font: 500 10px/1 var(--font-mono);
  white-space: nowrap;
}
```

Reuse the existing `4px` action-group gap so the label sits immediately left of the icon without introducing a separate layout token.

- [x] **Step 5: Run the focused tests and verify they pass**

Run:

```powershell
cd app
npm test -- --runInBand web/src/chat/ChatRecentSessionsSurface.test.tsx web/src/chat/ChatSessionGlobalBar.test.tsx __tests__/web-chat-plan-surface.test.tsx __tests__/web-chat-recent-sessions-ui.test.ts
```

Expected: all four focused suites PASS.

### Task 3: Update the durable PC sidebar documentation

**Files:**
- Modify: `docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md`

- [x] **Step 1: Correct the floating-mode information hierarchy**

Replace the statements that all desktop modes show `Sessions → Recent` with these durable rules:

```markdown
- 浮动态主标题直接显示 **RECENT SESSIONS**，并隐藏内容区内重复的 **RECENT** 分区标题；Project 分组和 session 行保持不变。
- 滑出与 pin 模式继续显示 **SESSIONS → RECENT → Project 分组**，移动端保持原有 Recent 标题结构。
- 仅浮动态的完整会话栏切换按钮左侧显示 **Ctrl+1**，提示该按钮与键盘快捷键执行同一个展开/收起动作；滑出、pin 与移动端不增加该提示。
```

Retain the existing Ctrl+1 persistence semantics: the hint must not be documented as changing Pin state or saved preferences.

- [x] **Step 2: Review the wiki diff for contradictions**

Run:

```powershell
git diff -- docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md
```

Expected: no remaining sentence claims that the floating panel displays both a `Sessions` title and an inner `Recent` heading.

### Task 4: Verify, audit, commit, and push the completed change

**Files:**
- Verify all modified files from Tasks 1–3.

- [x] **Step 1: Run TypeScript validation**

Run:

```powershell
cd app
npm run tsc:web
```

Expected: PASS with no TypeScript diagnostics.

- [x] **Step 2: Run the production web build**

Run:

```powershell
cd app
npm run build:web
```

Expected: PASS and emit the production webpack assets without errors.

- [x] **Step 3: Run the full app test suite**

Run:

```powershell
cd app
npm test -- --runInBand
```

Expected: all suites PASS.

- [x] **Step 4: Audit the final diff**

Run:

```powershell
git diff --check
git status --short
git diff -- app/web/src/chat/ChatRecentSessionsSurface.tsx app/web/src/chat/ChatSessionGlobalBar.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/web/src/chat/ChatRecentSessionsSurface.test.tsx app/web/src/chat/ChatSessionGlobalBar.test.tsx app/__tests__/web-chat-plan-surface.test.tsx app/__tests__/web-chat-recent-sessions-ui.test.ts docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md
```

Expected: no whitespace errors; only the scoped PC floating hierarchy, shortcut hint, tests, plan, and wiki are changed. Confirm mobile and Pin persistence paths are untouched.

- [x] **Step 5: Commit and push in the repository-required order**

Run:

```powershell
git add -A
git commit -m "feat(app): clarify floating recent sessions header"
git push origin main
```

Expected: commit succeeds and the local `main` branch is pushed to `origin/main`.
