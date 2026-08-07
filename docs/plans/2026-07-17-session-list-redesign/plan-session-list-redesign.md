# Session List Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构右侧会话列表：Recent 恒置顶虚拟文件夹 + 微分隔行项目组、中性安静卡片分组语言、显式项目 pin、session 行单行精修（未读计数 badge / 呼吸动画 / hover 快捷操作 / inset 选中）。

**Architecture:** 纯 Web UI 渲染层迭代，无协议/数据流变更。改动集中在 `WorkspaceApp.tsx`（渲染与两个状态）、`ChatRecentSessionsSurface.tsx`（受控折叠）、`chat.css`（视觉语言）。测试为源码文本断言（jest + fs.readFileSync），随各任务同步重构。

**Tech Stack:** React 18, jest, CSS (color-mix / CSS vars)。

**关键约束：**
- worktree 有无关用户改动（`TerminalView.tsx`、两个 terminal 测试、`WorkspaceApp.tsx` 的 terminal copy feedback diff），**一律不得触碰/丢弃**。
- 测试命令都在 `app/` 目录下运行：`npx jest __tests__/<file>` 与 `npm run tsc:web`。
- 变量/类名 `showPinnedRecentSessionsSurface`、`chat-view-width-fixed-800-pinned-recent` 保留不改名（减小爆炸半径，`web-chat-view-width-settings.test.ts` 与 plan-surface 测试依赖该字面量）。

---

### Task 1: 中性安静卡片分组语言 + inset 选中态

**Files:**
- Modify: `app/web/src/styles/chat.css`（.wide-project-section @987、.wide-session-row.selected @1497、.selected::before @5582、.wide-project-section @5547）
- Test: `app/__tests__/web-chat-ui.test.ts`（@2000-2035 附近断言）

- [ ] **Step 1: 改测试断言（先红）**

`app/__tests__/web-chat-ui.test.ts` 中：
- `expect(wideProjectSectionBlock).toContain('margin-bottom: 4px;')` 改为 `expect(wideProjectSectionBlock).toContain('margin-bottom: 8px;')`，并在其后加：
```ts
expect(wideProjectSectionBlock).toContain('border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);');
expect(wideProjectSectionBlock).toContain('background: color-mix(in srgb, var(--surface-panel) 88%, var(--surface-raised));');
expect(wideProjectSectionBlock).toContain('padding: 3px;');
```
- 将 2027-2035 的 `selectedSessionRowBlock` 断言整段替换为：
```ts
const selectedSessionRowBlock = stylesCss.match(/\.wide-session-row\.selected \{[\s\S]*?\n\}/)?.[0] ?? '';
expect(selectedSessionRowBlock).not.toContain('margin-left:');
expect(selectedSessionRowBlock).not.toContain('width: calc(');
expect(selectedSessionRowBlock).not.toContain('padding-left: 23px;');
const selectedBarBlock = stylesCss.match(/\.wide-session-row\.selected::before \{[\s\S]*?\n\}/)?.[0] ?? '';
expect(selectedBarBlock).toContain('left: 2px;');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/web-chat-ui.test.ts`
Expected: FAIL（新断言不满足）

- [ ] **Step 3: 实现安静卡片 + inset 选中**

`chat.css` @987 的 `.wide-project-section` 改为：
```css
.wide-project-section {
  position: relative;
  margin-bottom: 8px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-panel) 88%, var(--surface-raised));
  padding: 3px;
}
```
删除 @5547 的 `.wide-project-section { border-radius: var(--radius-panel); }` 整块（radius 已并入基础块）。

@1497 的 `.wide-session-row.selected` 改为（去掉负 margin 突破方案，保留渐变，由 5576 主题层覆盖为最终态）：
```css
.wide-session-row.selected {
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--accent-primary) 5%, transparent) 0,
    color-mix(in srgb, var(--accent-primary) 16%, var(--surface-raised)) 28px,
    color-mix(in srgb, var(--accent-primary) 10%, var(--surface-raised)) 100%
  );
  color: var(--text-primary);
}
```
@5582 `.wide-session-row.selected::before` 中 `left: 5px;` 改为 `left: 2px;`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest __tests__/web-chat-ui.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/styles/chat.css app/__tests__/web-chat-ui.test.ts
git commit -m "feat(app): quiet card grouping and inset selected style for session list"
```

---

### Task 2: 删除 Recent pin 状态，sticky 与折叠侧栏 surface 恒生效

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（@3217 state、@5117 gate、@15406-15452 render、@19259-19276 surface 用法）
- Modify: `app/web/src/chat/ChatRecentSessionsSurface.tsx`（去 onUnpin）
- Modify: `app/web/src/styles/chat.css`（@1189-1228 pin/sticky 块）
- Test: `app/__tests__/web-chat-recent-sessions-ui.test.ts`（@118-172 pin 相关测试）、`app/__tests__/web-chat-plan-surface.test.tsx`（@140-176）

- [ ] **Step 1: 改测试断言（先红）**

`web-chat-recent-sessions-ui.test.ts`：删除 `recent sessions has a pin toggle...`、`keeps the same frameless geometry before and after pinning`、`uses a vertical pin and gives pinned recent sessions one contained graphite surface` 三个 test，替换为：
```ts
test('recent sessions is always sticky at the top without any pin state', () => {
  expect(mainTsx).not.toContain('recentSessionsPinned');
  expect(mainTsx).not.toContain('recent-sessions-pin-btn');
  const sectionBlock = chatCss.match(/\.recent-sessions-section \{[\s\S]*?\n\}/)?.[0] ?? '';
  expect(sectionBlock).toContain('position: sticky;');
  expect(sectionBlock).toContain('top: 4px;');
  expect(sectionBlock).toContain('z-index: 5;');
  expect(chatCss).not.toContain('.recent-sessions-section.pinned');
  expect(chatCss).not.toContain('.recent-sessions-pin-btn');
});
```
`renders the pinned recent surface only above desktop chat...` test 中：
- 旧条件串改为：
```ts
expect(mainTsx).toContain(
  'const showPinnedRecentSessionsSurface = isWide && sidebarCollapsed && !archivedMode && !sessionSearchActive && recentSessionSections.length > 0;',
);
```
- 删除 `expect(mainTsx).toContain('onUnpin={() => setRecentSessionsPinned(false)}');`，替换为 `expect(mainTsx).not.toContain('onUnpin');`

`web-chat-plan-surface.test.tsx`：把渲染 props 从 `onUnpin={onUnpin}` 改为 `collapsed={false} onToggleCollapsed={() => undefined}`，删除 `onUnpin` 相关断言（@140、@144、@176 附近），相应 mock 删除。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/web-chat-recent-sessions-ui.test.ts __tests__/web-chat-plan-surface.test.tsx`
Expected: FAIL

- [ ] **Step 3: 删除 pin 状态与门控**

`WorkspaceApp.tsx`：
- 删除 @3217 `const [recentSessionsPinned, setRecentSessionsPinned] = useState(false);`
- @5117 改为：
```ts
const showPinnedRecentSessionsSurface = isWide && sidebarCollapsed && !archivedMode && !sessionSearchActive && recentSessionSections.length > 0;
```
- @15416-15418 className 去掉 ``${recentSessionsPinned ? ' pinned' : ''}``
- 删除 @15435-15443 整个 `recent-sessions-pin-btn` button JSX
- @19262-19265 删除 `onUnpin={() => setRecentSessionsPinned(false)}` prop

`ChatRecentSessionsSurface.tsx`：Props 删除 `onUnpin: () => void;`，删除 header 中 `chat-recent-sessions-surface-unpin` button，header grid 保持（Task 3 再调整）。

`chat.css`：
- `.recent-sessions-section`（@1146）改为：
```css
.recent-sessions-section {
  position: sticky;
  top: 4px;
  z-index: 5;
  margin: 0 0 8px;
  box-shadow: 0 8px 18px rgb(0 0 0 / 16%);
}
```
- 删除 `.recent-sessions-section.pinned`、`.recent-sessions-pin-btn`、`.recent-sessions-pin-btn:hover`、`.recent-sessions-pin-btn.active` 四个块（@1196-1228）。

- [ ] **Step 4: 跑测试确认通过 + tsc**

Run: `npx jest __tests__/web-chat-recent-sessions-ui.test.ts __tests__/web-chat-plan-surface.test.tsx && npm run tsc:web`
Expected: PASS，无类型错误

- [ ] **Step 5: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/chat/ChatRecentSessionsSurface.tsx app/web/src/styles/chat.css app/__tests__/web-chat-recent-sessions-ui.test.ts app/__tests__/web-chat-plan-surface.test.tsx
git commit -m "feat(app): remove recent-sessions pin state; sticky and edge surface are unconditional"
```

---

### Task 3: Recent 折叠状态提升为共享受控

**Files:**
- Modify: `app/web/src/chat/ChatRecentSessionsSurface.tsx`（全文件重写为受控）
- Modify: `app/web/src/app/WorkspaceApp.tsx`（@19261-19270 surface 用法）
- Test: `app/__tests__/web-chat-plan-surface.test.tsx`

- [ ] **Step 1: 改测试（先红）**

`web-chat-plan-surface.test.tsx` 中 surface 渲染测试改为验证受控折叠：
```ts
it('renders the compact pill when collapsed and reports toggle clicks', () => {
  const onToggleCollapsed = jest.fn();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <ChatRecentSessionsSurface collapsed={true} onToggleCollapsed={onToggleCollapsed} sessionListDensity="compact">
        <div />
      </ChatRecentSessionsSurface>,
    );
  });
  expect(renderer.root.findAllByProps({className: 'chat-recent-sessions-surface-list'})).toHaveLength(0);
  const trigger = renderer.root.findByProps({className: 'chat-recent-sessions-compact-trigger'});
  act(() => { trigger.props.onClick(); });
  expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
});

it('renders the expanded list when not collapsed', () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <ChatRecentSessionsSurface collapsed={false} onToggleCollapsed={() => undefined} sessionListDensity="compact">
        <div />
      </ChatRecentSessionsSurface>,
    );
  });
  expect(renderer.root.findAllByProps({className: 'chat-recent-sessions-surface-list'})).toHaveLength(1);
  expect(renderer.root.findByProps({className: 'chat-recent-sessions-surface-title'}).children).toEqual(['Recent Sessions']);
});
```
（沿用该文件已有的 `create`/`act`/`ReactTestRenderer` import；若缺 `ReactTestRenderer` 类型 import 则补上 `import type {ReactTestRenderer} from 'react-test-renderer';`）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/web-chat-plan-surface.test.tsx`
Expected: FAIL（props 不存在 / 组件仍用内部 state）

- [ ] **Step 3: 重写 surface 为受控组件**

`ChatRecentSessionsSurface.tsx` 完整内容改为：
```tsx
import React, { type ReactNode } from 'react';
import type {SessionListDensity} from './sessionListDensity';
import {useChatEdgeSurfaceGeometry} from './layout/chatEdgeSurfaceGeometry';

export type ChatRecentSessionsSurfaceProps = {
  children: ReactNode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sessionListDensity: SessionListDensity;
};

export const ChatRecentSessionsSurface = React.memo(function ChatRecentSessionsSurface({
  children,
  collapsed,
  onToggleCollapsed,
  sessionListDensity,
}: ChatRecentSessionsSurfaceProps) {
  const surfaceRef = useChatEdgeSurfaceGeometry('left');

  if (collapsed) {
    return (
      <aside
        ref={surfaceRef}
        className="chat-recent-sessions-surface desktop collapsed"
        data-session-list-density={sessionListDensity}
        aria-label="Recent sessions"
      >
        <div className="chat-edge-surface-glass" aria-hidden="true" />
        <div className="chat-edge-surface-content">
          <button
            type="button"
            className="chat-recent-sessions-compact-trigger"
            onClick={onToggleCollapsed}
            aria-expanded={false}
            aria-label="Expand recent sessions"
            title="Expand recent sessions"
          >
            <span className="codicon codicon-history chat-recent-sessions-compact-icon" aria-hidden="true" />
            <span className="chat-recent-sessions-surface-title">Recent Sessions</span>
            <span className="codicon codicon-chevron-down chat-recent-sessions-compact-chevron" aria-hidden="true" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={surfaceRef}
      className="chat-recent-sessions-surface desktop expanded"
      data-session-list-density={sessionListDensity}
      aria-label="Recent sessions"
    >
      <div className="chat-edge-surface-glass" aria-hidden="true" />
      <div className="chat-edge-surface-content">
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
        <div className="chat-recent-sessions-surface-list">{children}</div>
      </div>
    </aside>
  );
});
```

`WorkspaceApp.tsx` @19261-19270：
```tsx
{showPinnedRecentSessionsSurface ? (
  <ChatRecentSessionsSurface
    collapsed={collapsedProjectIds.includes(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}
    onToggleCollapsed={() => toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}
    sessionListDensity={sessionListDensity}
  >
    <div className="wide-project-session-list recent-sessions-list chat-recent-sessions-rows">
      {recentSessionSections.map(section => renderRecentProjectSessionSection(section, false))}
    </div>
  </ChatRecentSessionsSurface>
) : null}
```

`chat.css`：`.chat-recent-sessions-surface-header` 的 `grid-template-columns: 20px minmax(0, 1fr) 20px;` 改为 `20px minmax(0, 1fr)`；删除 `.chat-recent-sessions-surface-unpin` 相关两条规则（@2837-2838 联合选择器中移除该名、@2856-2858 块、@2860-2864 hover 联合选择器中移除该名）。

`web-chat-recent-sessions-ui.test.ts` 补断言：
```ts
test('recent surface shares the rail collapse state', () => {
  expect(mainTsx).toContain('collapsed={collapsedProjectIds.includes(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}');
  expect(mainTsx).toContain('onToggleCollapsed={() => toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}');
  expect(surfaceTsx).toContain('collapsed: boolean;');
  expect(surfaceTsx).toContain('onToggleCollapsed: () => void;');
  expect(surfaceTsx).not.toContain('useState');
});
```

- [ ] **Step 4: 跑测试 + tsc**

Run: `npx jest __tests__/web-chat-plan-surface.test.tsx __tests__/web-chat-recent-sessions-ui.test.ts && npm run tsc:web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/chat/ChatRecentSessionsSurface.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-plan-surface.test.tsx app/__tests__/web-chat-recent-sessions-ui.test.ts
git commit -m "feat(app): share recent-sessions collapse state between rail and edge surface"
```

---

### Task 4: Recent 微分隔行替换彩色卡片/水印/悬浮 +

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（`renderRecentProjectSessionSection` @15376-15404、`renderRecentSessionRow` @15095-15173 签名与 create 按钮）
- Modify: `app/web/src/styles/chat.css`（@1245-1351 旧组样式删除，新增 `.recent-project-divider*`）
- Test: `app/__tests__/web-chat-recent-sessions-ui.test.ts`（@35-99 三个 test 重写）、`app/__tests__/web-chat-ui.test.ts`（@2464 watermark test）

- [ ] **Step 1: 重写测试（先红）**

`web-chat-recent-sessions-ui.test.ts`：删除 `renders recent sessions in colored project groups...`、`keeps project identity behind full-width aligned session rows`、`places one create action in the first-row leading rail and removes only the recent selection bar` 三个 test，替换为：
```ts
test('renders recent project context as a quiet micro divider between groups', () => {
  expect(mainTsx).toContain('recent-project-session-group');
  expect(mainTsx).toContain('role="group"');
  expect(mainTsx).toContain('recent-project-divider');
  expect(mainTsx).toContain('recent-project-divider-name');
  expect(mainTsx).toContain('recent-project-divider-hub');
  expect(mainTsx).toContain('recent-project-divider-create');
  expect(mainTsx).toContain("openWideProjectActionMenu(targetProjectId, 'new', event.currentTarget);");
  expect(mainTsx).toContain("openMobileProjectActionMenu(targetProjectId, 'new');");
  expect(chatCss).toContain('.recent-project-divider');
  expect(chatCss).toContain('.recent-project-divider-create');
});

test('removes colored cards, watermarks and floating create rail from recent groups', () => {
  expect(mainTsx).not.toContain('recent-project-session-watermark');
  expect(mainTsx).not.toContain('recent-project-session-create');
  expect(mainTsx).not.toContain("tagVariantClass('recent-project-accent', targetProjectId)");
  expect(mainTsx).not.toContain('showProjectCreateAction');
  expect(chatCss).not.toContain('.recent-project-session-watermark');
  expect(chatCss).not.toContain('.recent-project-accent-0');
  expect(chatCss).not.toContain('.recent-project-session-create');
  expect(chatCss).not.toContain('.recent-project-session-group .recent-session-row.selected::before');
});

test('recent session rows keep the shared selection indicator', () => {
  expect(chatCss).toContain('.wide-session-row.selected::before');
  expect(chatCss).not.toContain('content: none;');
});
```

`web-chat-ui.test.ts` @2464 的 `tightens relaxed session rows and keeps the recent project watermark typographic` test：删除其中 `recentWatermark` 相关断言（@2475 及附近），保留 relaxed 行断言；test 名改为 `'tightens relaxed session rows'`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/web-chat-recent-sessions-ui.test.ts __tests__/web-chat-ui.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现微分隔行**

`WorkspaceApp.tsx` `renderRecentProjectSessionSection` 整体替换为：
```tsx
const renderRecentProjectSessionSection = (
  section: RecentChatSessionProjectSection,
  mobile: boolean,
) => {
  const targetProjectId = section.projectId;
  const projectName = section.projectName || targetProjectId;
  const projectHub = section.projectHubId || 'local';
  const projectHubVariant = tagVariantClass('wide-project-hub', section.projectHubId || 'local');
  return (
    <div
      key={`recent-project:${targetProjectId}`}
      className="recent-project-session-group"
      role="group"
      aria-label={`${projectName} recent sessions`}
    >
      <div className="recent-project-divider">
        <span className="codicon codicon-folder recent-project-divider-icon" aria-hidden="true" />
        <span className="recent-project-divider-name" title={projectName}>
          {projectName}
        </span>
        <span
          className={`wide-project-hub-tag recent-project-divider-hub ${projectHubVariant}`}
          style={hubAccentStyle(projectHub)}
        >
          <span className="wide-project-hub-dot" aria-hidden="true" />
          <span className="wide-project-hub-label">{projectHub}</span>
        </span>
        <button
          type="button"
          className="recent-project-divider-create"
          title={`New session in ${projectName}`}
          aria-label={`New session in ${projectName}`}
          onClick={event => {
            if (mobile) {
              openMobileProjectActionMenu(targetProjectId, 'new');
              return;
            }
            openWideProjectActionMenu(targetProjectId, 'new', event.currentTarget);
          }}
        >
          <span className="codicon codicon-add" aria-hidden="true" />
        </button>
      </div>
      <div className="recent-project-session-list">
        {section.sessions.map(session => renderRecentSessionRow(targetProjectId, session, mobile))}
      </div>
    </div>
  );
};
```

`renderRecentSessionRow`：签名从 `(targetProjectId, session, mobile, showProjectCreateAction, projectName)` 改为 `(targetProjectId, session, mobile)`；删除 @15153-15169 的 `showProjectCreateAction ? ...` create 按钮块。

`chat.css`：
- 删除 @1245-1263（`.recent-project-session-group` accent 块 + `.recent-project-accent-0..7`）、@1265-1285（watermark 两块）、@1287-1327（create 三块）、@1335-1351（group 内 row grid / selected / time / `content: none` 全部覆盖块）。
- `.recent-project-session-group` 新定义为：
```css
.recent-project-session-group {
  margin: 2px 0;
}
```
- 新增微分隔行样式：
```css
.recent-project-divider {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 16px;
  margin: 4px 2px 1px 21px;
  padding-top: 5px;
  border-top: 1px solid color-mix(in srgb, var(--border-subtle) 55%, transparent);
}

.recent-project-session-group:first-child .recent-project-divider {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.recent-project-divider-icon {
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 1;
  color: var(--text-tertiary);
}

.recent-project-divider-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1.2;
}

.recent-project-divider-hub {
  flex: 0 1 auto;
}

.recent-project-divider-create {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin: 0 0 0 auto;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.recent-project-divider-create:hover {
  background: var(--hover);
  color: var(--text-primary);
}
```

- [ ] **Step 4: 跑测试 + tsc**

Run: `npx jest __tests__/web-chat-recent-sessions-ui.test.ts __tests__/web-chat-ui.test.ts && npm run tsc:web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-recent-sessions-ui.test.ts app/__tests__/web-chat-ui.test.ts
git commit -m "feat(app): replace recent colored groups with quiet project micro dividers"
```

---

### Task 5: 项目头显式 pin 按钮

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（@17543 `wide-project-actions` 内插按钮）
- Modify: `app/web/src/styles/chat.css`（新增 `.wide-project-pin-btn`）
- Test: `app/__tests__/web-chat-ui.test.ts`

- [ ] **Step 1: 写测试（先红）**

`web-chat-ui.test.ts` 新增 test：
```ts
test('project headers expose an explicit pin action alongside new/resume', () => {
  expect(mainTsx).toContain('wide-project-action-btn wide-project-pin-btn');
  expect(mainTsx).toContain('aria-pressed={pinnedProject}');
  expect(mainTsx).toContain('togglePinnedProject(targetProjectId)');
  expect(stylesCss).toContain('.wide-project-pin-btn.active');
});
```
（确认该文件顶部变量名：`mainTsx`/`stylesCss` 若不同则沿用文件内现有变量。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/web-chat-ui.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`WorkspaceApp.tsx` @17557 起的 resume 按钮之后、`.wide-project-actions` 闭合之前插入（保持顺序：`+`、Resume、Pin）：
```tsx
<button
  type="button"
  className={`wide-project-action-btn wide-project-pin-btn${pinnedProject ? ' active' : ''}`}
  title={pinnedProject ? 'Unpin project' : 'Pin project to top'}
  aria-label={pinnedProject ? `Unpin project ${projectItem.name}` : `Pin project ${projectItem.name}`}
  aria-pressed={pinnedProject}
  onPointerDown={event => event.stopPropagation()}
  onClick={event => {
    event.stopPropagation();
    togglePinnedProject(targetProjectId);
  }}
>
  <span className="codicon codicon-pinned" />
</button>
```
（mobile 的对应渲染段 @17118 附近同样插入相同按钮——两处渲染分支都改；mobile 长按逻辑保留不动。）

`chat.css` 新增：
```css
.wide-project-pin-btn.active {
  color: var(--accent-primary);
  opacity: 1;
}
```

- [ ] **Step 4: 跑测试 + tsc**

Run: `npx jest __tests__/web-chat-ui.test.ts && npm run tsc:web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-ui.test.ts
git commit -m "feat(app): explicit project pin action in project headers"
```

---

### Task 6: 行精修——未读计数 badge + 运行中呼吸动画 + tabular 时间 + marker 列宽自适应

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（`renderSessionStateMarker` @9804-9823）
- Modify: `app/web/src/styles/chat.css`（`.session-state-marker` @1519、`.wide-session-row` grid @1479、`.session-older-toggle` @961、`.wide-session-time` @1766，新增 `.session-state-unread` 与 breathe keyframes）
- Test: `app/__tests__/web-chat-ui.test.ts`（@2008-2018 断言更新）、`app/__tests__/web-session-list-schema.test.ts`

- [ ] **Step 1: 改测试（先红）**

`web-chat-ui.test.ts`：
- @2010 grid 断言改为 `expect(wideSessionRowBlock).toContain('grid-template-columns: auto minmax(0, 1fr) auto auto;');`
- @2013-2015 marker 断言改为：
```ts
const sessionStateMarkerBlock = stylesCss.match(/\.session-state-marker \{[\s\S]*?\n\}/)?.[0] ?? '';
expect(sessionStateMarkerBlock).toContain('min-width: 9px;');
expect(sessionStateMarkerBlock).toContain('flex: 0 0 auto;');
```
- 新增：
```ts
test('session markers render unread counts and a breathing running indicator', () => {
  expect(mainTsx).toContain('session-state-unread');
  expect(mainTsx).toContain('Math.min(99, Math.max(0, Math.trunc(session.unreadCount ?? 0)))');
  expect(stylesCss).toContain('.session-state-marker.running .session-state-dot');
  expect(stylesCss).toContain('@keyframes session-state-breathe');
  expect(stylesCss).toContain('.session-state-marker.completed-unviewed .session-state-unread');
  expect(stylesCss).toContain('.session-state-marker.failed-unviewed .session-state-unread');
  const timeBlock = stylesCss.match(/\.wide-session-time \{[\s\S]*?\n\}/)?.[0] ?? '';
  expect(timeBlock).toContain('font-variant-numeric: tabular-nums;');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/web-chat-ui.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`WorkspaceApp.tsx` `renderSessionStateMarker` 改为：
```tsx
const renderSessionStateMarker = (session: RegistryChatSession, activeProjectId = projectIdRef.current) => {
  const state = resolveSessionVisualState(session, activeProjectId);
  const unreadCount = Math.min(99, Math.max(0, Math.trunc(session.unreadCount ?? 0)));
  const title =
    state === 'running'
      ? 'In progress'
      : state === 'failed-unviewed'
        ? 'Failed, click to view'
        : state === 'completed-unviewed'
          ? 'Completed, click to view'
          : undefined;
  return (
    <span className={`session-state-marker ${state}`} title={title}>
      {state === 'running' ? (
        <span className="session-state-dot" />
      ) : state === 'completed-unviewed' || state === 'failed-unviewed' ? (
        unreadCount > 0 ? (
          <span className="session-state-unread">{unreadCount}</span>
        ) : (
          <span className="session-state-dot" />
        )
      ) : null}
    </span>
  );
};
```

`chat.css`：
- @1479 `grid-template-columns: 9px minmax(0, 1fr) auto auto;` 改为 `auto minmax(0, 1fr) auto auto;`
- @961 `.session-older-toggle` 的 `grid-template-columns` 同步改为 `auto minmax(0, 1fr) auto auto;`
- @1519 `.session-state-marker`：`width: 9px;` 改 `min-width: 9px;`，`flex: 0 0 9px;` 改 `flex: 0 0 auto;`
- 新增：
```css
.session-state-marker.running .session-state-dot {
  background: #68a8e8;
  animation: session-state-breathe 1.6s ease-in-out infinite;
}

@keyframes session-state-breathe {
  0%, 100% { opacity: 0.45; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.15); }
}

@media (prefers-reduced-motion: reduce) {
  .session-state-marker.running .session-state-dot {
    animation: none;
  }
}

.session-state-unread {
  min-width: 15px;
  height: 14px;
  padding: 0 4px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
}

.session-state-marker.completed-unviewed .session-state-unread {
  background: color-mix(in srgb, var(--state-success) 22%, transparent);
  color: var(--state-success);
}

.session-state-marker.failed-unviewed .session-state-unread {
  background: color-mix(in srgb, var(--state-danger) 22%, transparent);
  color: var(--state-danger);
}
```
- @1766 `.wide-session-time` 增加一行 `font-variant-numeric: tabular-nums;`

- [ ] **Step 4: 跑相关全部测试 + tsc**

Run: `npx jest __tests__/web-chat-ui.test.ts __tests__/web-session-list-schema.test.ts __tests__/web-chat-recent-sessions-ui.test.ts && npm run tsc:web`
Expected: PASS（schema 测试的 `.session-state-marker.running` / `.failed-unviewed .session-state-dot` 选择器保留，不应破）

- [ ] **Step 5: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-ui.test.ts
git commit -m "feat(app): unread count badges, breathing running marker, tabular session times"
```

---

### Task 7: 桌面端行 hover 浮现快捷操作（⋯）

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（`renderProjectSessionRow` @15032、`renderRecentSessionRow`）
- Modify: `app/web/src/styles/chat.css`（新增 `.wide-session-more-btn`）
- Test: `app/__tests__/web-chat-ui.test.ts`

- [ ] **Step 1: 写测试（先红）**

`web-chat-ui.test.ts` 新增：
```ts
test('desktop session rows reveal a hover more-action that opens the same context menu', () => {
  expect(mainTsx).toContain('wide-session-more-btn');
  expect(mainTsx).toContain('codicon codicon-ellipsis');
  expect(stylesCss).toContain('.project-session-row-wrap:hover .wide-session-more-btn');
  const btnBlock = stylesCss.match(/\.wide-session-more-btn \{[\s\S]*?\n\}/)?.[0] ?? '';
  expect(btnBlock).toContain('position: absolute;');
  expect(btnBlock).toContain('opacity: 0;');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/web-chat-ui.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`renderProjectSessionRow` 与 `renderRecentSessionRow` 中，主 `</button>` 之后、`renderProjectSessionActionMenu(...)` 之前插入（两处相同）：
```tsx
{!mobile ? (
  <button
    type="button"
    className="wide-session-more-btn"
    title="Session actions"
    aria-label="Session actions"
    onClick={event => openProjectSessionContextMenu(targetProjectId, session.sessionId, event)}
  >
    <span className="codicon codicon-ellipsis" aria-hidden="true" />
  </button>
) : null}
```
（`renderRecentSessionRow` 中用 `liveSession.sessionId` 替换 `session.sessionId` 以保持与该行 onContextMenu 一致；`openProjectSessionContextMenu` 已做 preventDefault/stopPropagation 并按 clientX/Y 定位，点击事件可直接复用。）

`chat.css` 新增（覆盖式浮层，不改 grid、零布局抖动）：
```css
.wide-session-more-btn {
  position: absolute;
  right: 3px;
  top: 50%;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: color-mix(in srgb, var(--surface-panel) 92%, var(--hover));
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transform: translateY(-50%);
  transition: opacity 120ms ease;
  z-index: 2;
}

.project-session-row-wrap:hover .wide-session-more-btn,
.project-session-row-wrap.actions-open .wide-session-more-btn,
.wide-session-more-btn:focus-visible {
  opacity: 1;
}

.wide-session-more-btn:hover {
  background: var(--hover);
  color: var(--text-primary);
}
```

- [ ] **Step 4: 跑测试 + tsc**

Run: `npx jest __tests__/web-chat-ui.test.ts && npm run tsc:web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-ui.test.ts
git commit -m "feat(app): hover more-action on desktop session rows"
```

---

### Task 8: 密度死代码清理（base = compact）

**Files:**
- Modify: `app/web/src/styles/chat.css`（@1470-1490 base row、@1689-1697 base title、@1699-1715 与 @1726-1733 compact 覆盖块）
- Test: `app/__tests__/web-chat-ui.test.ts`、`app/__tests__/web-chat-recent-sessions-ui.test.ts`

- [ ] **Step 1: 改测试（先红）**

`web-chat-ui.test.ts` @2008：`min-height: 24px` 改 `min-height: 28px`。
`web-chat-recent-sessions-ui.test.ts` 的 `shares compact and relaxed row density with the pinned surface` test 改名为 `shares row density tokens with the pinned surface`，内容改为：
```ts
expect(mainTsx).toContain('sessionListDensity={sessionListDensity}');
expect(surfaceTsx).toContain('sessionListDensity: SessionListDensity;');
expect(surfaceTsx).toContain('data-session-list-density={sessionListDensity}');
expect(chatCss).toContain("[data-session-list-density='relaxed'] .wide-session-row");
expect(chatCss).toContain('min-height: 30px;');
expect(chatCss).not.toContain("[data-session-list-density='compact'] .wide-session-row");
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/web-chat-ui.test.ts __tests__/web-chat-recent-sessions-ui.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`chat.css`：
- @1473 base `.wide-session-row` 的 `min-height: 24px;` 改为 `min-height: 28px;`
- @1694-1696 base `.wide-session-title` 的 `font-size: 12.5px; line-height: 1.2;` 改为 `font-size: 13px; line-height: 1.35;`
- 删除四个 compact 覆盖块：`[data-session-list-density='compact'] .wide-session-row`（nav @1708、surface @1726）与对应两个 `.wide-session-title` 块（@1712、@1730）。relaxed 两个块保留。

- [ ] **Step 4: 跑测试**

Run: `npx jest __tests__/web-chat-ui.test.ts __tests__/web-chat-recent-sessions-ui.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/styles/chat.css app/__tests__/web-chat-ui.test.ts app/__tests__/web-chat-recent-sessions-ui.test.ts
git commit -m "chore(app): fold compact density into base session-row rules"
```

---

### Task 9: 全量验证与推送

- [ ] **Step 1: 全量 jest**

Run（`app/` 下）: `npx jest`
Expected: 全绿。重点确认 `web-chat-session-nav-expansion.test.ts`、`web-chat-composer-status.test.ts`、`web-chat-turn-rendering.test.ts`、`web-chat-view-width-settings.test.ts` 无残留旧断言；若有，按新结构就地修正。

- [ ] **Step 2: tsc**

Run: `npm run tsc:web`
Expected: 无错误

- [ ] **Step 3: 人工核对清单**

- `git status` 确认 terminal 相关无关改动（`TerminalView.tsx`、两个 terminal 测试）保持未提交、未被修改。
- `git diff` 确认 `WorkspaceApp.tsx` 的 terminal copy feedback 段落不在本次任何 commit 中。

- [ ] **Step 4: Push**

```bash
git push origin <current-branch>
```

---

## 自我审查记录

- **Spec 覆盖：** 决策 1（排序保留，无任务=无改动）✓；2（右键/长按不动）✓；3-4（pin 删除/sticky/恒 surface/共享折叠）→ Task 2、3 ✓；5-6（去卡片水印、微分隔行）→ Task 4 ✓；7（选中一致、inset）→ Task 1、4 ✓；8（安静卡片）→ Task 1 ✓；9（显式 pin）→ Task 5 ✓；10（行精修）→ Task 6、7 ✓（agent tag 已是 chip 样式 @1735，无需改动）；11（tabular 时间）→ Task 6 ✓；12（draft/older 对齐：grid 随 Task 6 同步，样式继承 `.wide-session-row`）✓；13（密度死代码）→ Task 8 ✓。
- **占位符：** 无。
- **类型一致性：** `renderRecentSessionRow(targetProjectId, session, mobile)`、`ChatRecentSessionsSurfaceProps{collapsed,onToggleCollapsed,sessionListDensity}`、`.session-state-unread` / `.recent-project-divider-*` / `.wide-session-more-btn` 命名全文一致。
