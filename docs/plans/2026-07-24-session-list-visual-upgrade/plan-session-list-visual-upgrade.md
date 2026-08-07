# Session 列表视觉/交互升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 session 列表（移动端抽屉、PC 固定侧栏/浮动面板/Slide-out、工具栏、菜单族）升级为精致深色工具风，组件化迁移出 WorkspaceApp.tsx，图标换 Lucide SVG，动效与视觉统一。

**Architecture:** 先基建（图标注册表、设计 token）→ 再抽取展示组件（SessionRow / ProjectSection / RecentSessionsSection / SessionMenu）并迁移编排逻辑到 `chat/sessionlist/SessionListView.tsx`（行为不变，class 保留）→ 最后重写视觉（新 `sessionlist.css` + 动效 + 工具栏形态）。迁移期旧 CSS 继续生效，视觉期一次性替换。

**Tech Stack:** React 19 + TypeScript、纯 CSS（tokens.css 变量）、jest + react-test-renderer（testEnvironment: node）、webpack。better-icons CLI 用于校验 Lucide glyph。

**通用约定（每个任务都适用，后文不再重复）：**
- 所有命令在 `app/` 目录下执行（`cd D:\Code\WheelMaker\.worktree\session-list-visual-upgrade\app`）。
- 单测命令：`npx jest <相对路径>`；类型检查：`npm run tsc:web`。
- 组件 class 命名：迁移期**保留现有 class**（`wide-session-row` 等），新增能力用 `sl-` 前缀 class 叠加；视觉期 CSS 同时接管两套选择器。
- Commit message 用 conventional commits，scope 用 `app`。

---

### Task 1: SessionIcon 组件 + Lucide glyph 注册表

**Files:**
- Create: `app/web/src/chat/sessionlist/SessionIcon.tsx`
- Test: `app/web/src/chat/sessionlist/SessionIcon.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// app/web/src/chat/sessionlist/SessionIcon.test.tsx
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {SessionIcon, SESSION_ICON_NAMES} from './SessionIcon';

describe('SessionIcon', () => {
  it('renders an svg with glyph content for every registered name', async () => {
    for (const name of SESSION_ICON_NAMES) {
      let tree: ReactTestRenderer | undefined;
      await act(async () => {
        tree = create(<SessionIcon name={name} />);
      });
      const svg = tree!.root.findByType('svg');
      expect(svg.props.className).toContain('sl-icon');
      expect(svg.props['aria-hidden']).toBe(true);
      // glyph must not be empty
      expect(svg.props.children).toBeTruthy();
    }
  });

  it('applies spin class and custom size', async () => {
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(<SessionIcon name="loader" spin size={16} />);
    });
    const svg = tree!.root.findByType('svg');
    expect(svg.props.className).toContain('sl-icon-spin');
    expect(svg.props.width).toBe(16);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest web/src/chat/sessionlist/SessionIcon.test.tsx`
Expected: FAIL — Cannot find module './SessionIcon'

- [ ] **Step 3: 实现 SessionIcon**

```tsx
// app/web/src/chat/sessionlist/SessionIcon.tsx
import React from 'react';

// Glyph bodies are Lucide icon inner SVG nodes (24x24 viewBox, stroke-based,
// 1.5px stroke, round caps). Verify/replace with `better-icons get lucide:<id>`
// output if a shape looks off — ids noted per entry.
const GLYPHS = {
  // lucide:plus
  plus: (<><path d="M5 12h14" /><path d="M12 5v14" /></>),
  // lucide:x
  x: (<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>),
  // lucide:check
  check: (<><path d="M20 6 9 17l-5-5" /></>),
  // lucide:chevron-down
  chevronDown: (<><path d="m6 9 6 6 6-6" /></>),
  // lucide:chevron-up
  chevronUp: (<><path d="m18 15-6-6-6 6" /></>),
  // lucide:chevron-right
  chevronRight: (<><path d="m9 18 6-6-6-6" /></>),
  // lucide:search
  search: (<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>),
  // lucide:folder
  folder: (<><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></>),
  // lucide:folder-open
  folderOpen: (<><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></>),
  // lucide:pin — VERIFY with better-icons (path is easy to get wrong)
  pin: (<><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1Z" /></>),
  // lucide:panel-left
  panelLeft: (<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /></>),
  // lucide:panel-left-close
  panelLeftClose: (<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /><path d="m16 15-3-3 3-3" /></>),
  // lucide:history
  history: (<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>),
  // lucide:archive
  archive: (<><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></>),
  // lucide:pencil
  pencil: (<><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></>),
  // lucide:refresh-cw
  refreshCw: (<><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></>),
  // lucide:trash-2
  trash: (<><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></>),
  // lucide:arrow-left
  arrowLeft: (<><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>),
  // lucide:settings — VERIFY with better-icons
  settings: (<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>),
  // lucide:inbox
  inbox: (<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
  // lucide:loader-circle
  loader: (<><path d="M21 12a9 9 0 1 1-6.219-8.56" /></>),
  // lucide:circle-help
  help: (<><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>),
  // lucide:ban
  ban: (<><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></>),
  // lucide:sliders-horizontal
  sliders: (<><line x1="21" x2="14" y1="4" y2="4" /><line x1="10" x2="3" y1="4" y2="4" /><line x1="21" x2="12" y1="12" y2="12" /><line x1="8" x2="3" y1="12" y2="12" /><line x1="21" x2="16" y1="20" y2="20" /><line x1="12" x2="3" y1="20" y2="20" /><line x1="14" x2="14" y1="2" y2="6" /><line x1="8" x2="8" y1="10" y2="14" /><line x1="16" x2="16" y1="18" y2="22" /></>),
} as const;

export type SessionIconName = keyof typeof GLYPHS;

export const SESSION_ICON_NAMES = Object.keys(GLYPHS) as SessionIconName[];

export type SessionIconProps = {
  name: SessionIconName;
  size?: number;
  /** Fill with currentColor instead of stroke (e.g. active pin state). */
  filled?: boolean;
  spin?: boolean;
  className?: string;
};

export function SessionIcon({name, size = 14, filled = false, spin = false, className}: SessionIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`sl-icon${spin ? ' sl-icon-spin' : ''}${className ? ` ${className}` : ''}`}
    >
      {GLYPHS[name]}
    </svg>
  );
}
```

- [ ] **Step 4: 用 better-icons 校验 glyph**

Run（对每个标注 VERIFY 的图标及肉眼存疑的图标）: `better-icons get lucide:pin`、`better-icons get lucide:settings`、`better-icons get lucide:folder-open`、`better-icons get lucide:panel-left-close`、`better-icons get lucide:history`
Expected: 输出 SVG；若 inner nodes 与 GLYPHS 不一致，以 better-icons 输出为准替换（保持 24 viewBox / 1.5 stroke）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx jest web/src/chat/sessionlist/SessionIcon.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add app/web/src/chat/sessionlist/SessionIcon.tsx app/web/src/chat/sessionlist/SessionIcon.test.tsx
git commit -m "feat(app): add SessionIcon component with vendored Lucide glyphs"
```

---

### Task 2: tokens.css 新增设计 token

**Files:**
- Modify: `app/web/src/styles/tokens.css`

- [ ] **Step 1: 在 `:root`（dark）的 `--ease-out` 行后追加**

```css
  --border-faint: #2b2b2b;
  --surface-active: rgb(255 255 255 / 9%);
  --accent-soft-bg: color-mix(in srgb, var(--accent-primary) 16%, transparent);
  --sl-icon-size: 14px;
```

- [ ] **Step 2: 在 `.theme-light` 的 `--ease-out` 行后追加**

```css
  --border-faint: #e4e4e4;
  --surface-active: rgb(21 31 43 / 10%);
  --accent-soft-bg: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  --sl-icon-size: 14px;
```

- [ ] **Step 3: 验证**

Run: `npm run tsc:web`
Expected: PASS（纯 CSS 改动不破坏类型；确认 webpack 无需配置变更）

- [ ] **Step 4: Commit**

```bash
git add app/web/src/styles/tokens.css
git commit -m "style(app): add faint-border/active-surface/accent-soft tokens for session list"
```

---

### Task 3: SessionRow / DraftSessionRow 组件抽取

**Files:**
- Create: `app/web/src/chat/sessionlist/SessionRow.tsx`
- Test: `app/web/src/chat/sessionlist/SessionRow.test.tsx`

说明：DOM 结构与 class 与现状逐字一致（`project-session-row-wrap` / `wide-session-row` / `wide-session-title` / `wide-session-agent-tag` / `wide-session-time` / `wide-session-pin-btn`），仅把 codicon span 换成 `SessionIcon`。这样旧 CSS 与现有集成测试在迁移期继续成立。

- [ ] **Step 1: 写失败测试**

```tsx
// app/web/src/chat/sessionlist/SessionRow.test.tsx
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {SessionRow} from './SessionRow';

const gesture = {
  onPointerDown: () => undefined,
  onPointerUp: () => undefined,
  onPointerCancel: () => undefined,
  onPointerLeave: () => undefined,
  onContextMenu: () => undefined,
};

async function renderRow(extra?: Partial<React.ComponentProps<typeof SessionRow>>) {
  let tree: ReactTestRenderer | undefined;
  const onClick = jest.fn();
  const onUnpin = jest.fn();
  await act(async () => {
    tree = create(
      <SessionRow
        title="Fix login bug"
        agentLabel="cc · kimi"
        agentClassName="wide-session-agent variant-1"
        timeLabel="3m"
        timeTitle="2026-07-24"
        selected={false}
        pinned={false}
        gestureHandlers={gesture}
        onClick={onClick}
        onUnpin={onUnpin}
        {...extra}
      />,
    );
  });
  return {tree: () => tree!, onClick, onUnpin};
}

describe('SessionRow', () => {
  it('renders title, agent pill and time with the legacy classes', async () => {
    const {tree} = await renderRow();
    expect(tree().root.findByProps({className: 'wide-session-title'}).children).toEqual(['Fix login bug']);
    expect(tree().root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('wide-session-agent-tag'))).toHaveLength(1);
    expect(tree().root.findByProps({className: 'wide-session-time'}).children).toEqual(['3m']);
  });

  it('shows time when unpinned and an svg pin button when pinned', async () => {
    const unpinned = await renderRow();
    expect(unpinned.tree().root.findAllByProps({className: 'wide-session-time'})).toHaveLength(1);

    const pinned = await renderRow({pinned: true});
    expect(pinned.tree().root.findAllByProps({className: 'wide-session-time'})).toHaveLength(0);
    const pinBtn = pinned.tree().root.findByProps({className: 'wide-session-pin-btn'});
    expect(pinBtn.findAllByType('svg')).toHaveLength(1);
  });

  it('fires onUnpin from the pin button without triggering row click', async () => {
    const {tree, onClick, onUnpin} = await renderRow({pinned: true});
    const pinBtn = tree().root.findByProps({className: 'wide-session-pin-btn'});
    const stopEvent = {preventDefault: jest.fn(), stopPropagation: jest.fn()};
    await act(async () => {
      pinBtn.props.onClick(stopEvent);
    });
    expect(onUnpin).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('marks selected rows', async () => {
    const {tree} = await renderRow({selected: true});
    const row = tree().root.findAllByType('button').find(b => b.props.className.includes('wide-session-row'))!;
    expect(row.props.className).toContain('selected');
  });
});
```

（测试栈与仓库现状一致：jest + react-test-renderer + `act`，testEnvironment 为 node。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest web/src/chat/sessionlist/SessionRow.test.tsx`
Expected: FAIL — Cannot find module './SessionRow'

- [ ] **Step 3: 实现 SessionRow + DraftSessionRow**

```tsx
// app/web/src/chat/sessionlist/SessionRow.tsx
import React, {type ReactNode} from 'react';
import {SessionIcon} from './SessionIcon';

export type SessionRowGestureHandlers = {
  onPointerDown: React.PointerEventHandler<HTMLButtonElement>;
  onPointerUp: React.PointerEventHandler<HTMLButtonElement>;
  onPointerCancel: React.PointerEventHandler<HTMLButtonElement>;
  onPointerLeave: React.PointerEventHandler<HTMLButtonElement>;
  onContextMenu: React.MouseEventHandler<HTMLButtonElement>;
};

export type SessionRowProps = {
  title: string;
  agentLabel?: string;
  /** Full class string for the agent pill (base + variant), e.g. from tagVariantClass. */
  agentClassName?: string;
  timeLabel?: string;
  timeTitle?: string;
  selected: boolean;
  pinned?: boolean;
  pinning?: boolean;
  mobile?: boolean;
  recent?: boolean;
  leadingState?: ReactNode;
  rowTitleAttr?: string;
  gestureHandlers: SessionRowGestureHandlers;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onUnpin?: () => void;
  unpinLabel?: string;
};

/** Presentational session row; keeps the legacy class hooks so the pre-upgrade CSS still applies. */
export function SessionRow({
  title,
  agentLabel,
  agentClassName,
  timeLabel,
  timeTitle,
  selected,
  pinned = false,
  pinning = false,
  mobile = false,
  recent = false,
  leadingState,
  rowTitleAttr,
  gestureHandlers,
  onClick,
  onUnpin,
  unpinLabel,
}: SessionRowProps) {
  return (
    <div className={`project-session-row-wrap${recent ? ' recent-session-row-wrap' : ''}${pinned ? ' has-pin-action' : ''}`}>
      {leadingState}
      <button
        type="button"
        className={`wide-session-row${recent ? ' recent-session-row' : ''}${mobile ? ' mobile-session-row' : ''}${selected ? ' selected' : ''}`}
        title={rowTitleAttr}
        {...gestureHandlers}
        onClick={onClick}
      >
        <span className="wide-session-title">{title}</span>
        {agentLabel ? (
          <span className={`wide-session-agent-tag ${agentClassName ?? ''}`}>{agentLabel}</span>
        ) : null}
        {!pinned ? (
          <span className="wide-session-time" title={timeTitle ?? ''}>{timeLabel}</span>
        ) : null}
      </button>
      {pinned && onUnpin ? (
        <button
          type="button"
          className="wide-session-pin-btn"
          title="Unpin session"
          aria-label={unpinLabel ?? `Unpin session ${title}`}
          aria-pressed={true}
          disabled={pinning}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            onUnpin();
          }}
        >
          {pinning ? <SessionIcon name="loader" spin /> : <SessionIcon name="pin" filled />}
        </button>
      ) : null}
    </div>
  );
}

export type DraftSessionRowProps = {
  title: string;
  statusLabel: string;
  failed: boolean;
  errorMessage?: string;
  createdAtTitle?: string;
  agentLabel?: string;
  agentClassName?: string;
  selected: boolean;
  mobile?: boolean;
  onClick: () => void;
  onDismiss?: () => void;
};

export function DraftSessionRow({
  title,
  statusLabel,
  failed,
  errorMessage,
  createdAtTitle,
  agentLabel,
  agentClassName,
  selected,
  mobile = false,
  onClick,
  onDismiss,
}: DraftSessionRowProps) {
  return (
    <div className={`project-session-row-wrap draft-session-row-wrap${failed ? ' failed has-dismiss' : ''}`}>
      <button
        type="button"
        className={`wide-session-row draft-session-row${mobile ? ' mobile-session-row' : ''}${selected ? ' selected' : ''}`}
        title={failed ? errorMessage : title}
        onClick={onClick}
      >
        <span className="wide-session-title">{title}</span>
        {agentLabel ? (
          <span className={`wide-session-agent-tag ${agentClassName ?? ''}`}>{agentLabel}</span>
        ) : null}
        <span className="wide-session-time" title={failed ? errorMessage : createdAtTitle ?? ''}>
          {statusLabel}
        </span>
      </button>
      {failed && onDismiss ? (
        <button
          type="button"
          className="draft-session-dismiss"
          title="Dismiss"
          aria-label="Dismiss draft session"
          onClick={onDismiss}
        >
          <SessionIcon name="x" />
        </button>
      ) : null}
    </div>
  );
}
```

注意：原 draft row 的 class 是 `draft-session-row ${draft.status}`（status 插值进 class）。保留该行为：调用方把 `draft.status` 拼进传入的 className —— 在 SessionListView（Task 6）装配时处理，组件内不拼 status。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest web/src/chat/sessionlist/SessionRow.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/web/src/chat/sessionlist/SessionRow.tsx app/web/src/chat/sessionlist/SessionRow.test.tsx
git commit -m "feat(app): extract SessionRow and DraftSessionRow presentational components"
```

---

### Task 4: ProjectSection / RecentSessionsSection 组件抽取

**Files:**
- Create: `app/web/src/chat/sessionlist/ProjectSection.tsx`
- Create: `app/web/src/chat/sessionlist/RecentSessionsSection.tsx`
- Test: `app/web/src/chat/sessionlist/ProjectSection.test.tsx`
- Test: `app/web/src/chat/sessionlist/RecentSessionsSection.test.tsx`

说明：同样保留现有 class；动作按钮叠加新 class：`+` 加 `sl-action-primary`，resume/pin 加 `sl-action-secondary`（Task 8 的可见性 CSS 依赖这两个钩子，当前无样式，行为不变）。

- [ ] **Step 1: 写失败测试**

```tsx
// app/web/src/chat/sessionlist/ProjectSection.test.tsx
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ProjectSection} from './ProjectSection';

const gesture = {
  onPointerDown: () => undefined,
  onPointerUp: () => undefined,
  onPointerCancel: () => undefined,
  onPointerLeave: () => undefined,
  onContextMenu: () => undefined,
};

async function renderSection(extra?: Partial<React.ComponentProps<typeof ProjectSection>>) {
  let tree: ReactTestRenderer | undefined;
  const props = {
    name: 'WheelMaker',
    hubLabel: 'LOCAL-HUB',
    hubVariantClass: 'wide-project-hub variant-0',
    hubAccentStyle: {'--hub-accent': '#58a6ff'} as React.CSSProperties,
    collapsed: false,
    pinned: false,
    active: false,
    mobile: false,
    projectGestureHandlers: gesture,
    onToggleCollapsed: jest.fn(),
    onNew: jest.fn(),
    onResume: jest.fn(),
    onTogglePin: jest.fn(),
    children: <div className="child-row" />,
    ...extra,
  };
  await act(async () => {
    tree = create(<ProjectSection {...props} />);
  });
  return {tree: tree!, props};
}

describe('ProjectSection', () => {
  it('renders project name, hub tag and three action buttons with visibility hooks', async () => {
    const {tree} = await renderSection();
    expect(tree.root.findByProps({className: 'wide-project-name'}).children).toEqual(['WheelMaker']);
    expect(tree.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('wide-project-hub-tag'))).toHaveLength(1);
    const addBtn = tree.root.findByProps({title: 'New session'});
    expect(addBtn.props.className).toContain('sl-action-primary');
    expect(tree.root.findByProps({title: 'Resume session'}).props.className).toContain('sl-action-secondary');
    expect(tree.root.findByProps({title: 'Pin project to top'}).props.className).toContain('sl-action-secondary');
  });

  it('hides children when collapsed and shows pin badge when pinned', async () => {
    const collapsed = await renderSection({collapsed: true});
    expect(collapsed.tree.root.findAllByProps({className: 'child-row'})).toHaveLength(0);

    const pinned = await renderSection({pinned: true});
    expect(pinned.tree.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('wide-project-pin-badge'))).toHaveLength(1);
    expect(pinned.tree.root.findByProps({title: 'Unpin project'}).props.className).toContain('active');
  });
});
```

```tsx
// app/web/src/chat/sessionlist/RecentSessionsSection.test.tsx
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {RecentSessionsSection, type RecentGroup} from './RecentSessionsSection';

const groups: RecentGroup[] = [
  {
    projectId: 'p1',
    projectName: 'WheelMaker',
    hubLabel: 'LOCAL-HUB',
    hubVariantClass: 'wide-project-hub variant-0',
    hubAccentStyle: {'--hub-accent': '#58a6ff'} as React.CSSProperties,
    sessions: [{sessionId: 's1'}, {sessionId: 's2'}],
  },
];

const renderRow = (projectId: string, session: {sessionId: string}) => (
  <div key={session.sessionId} className={`recent-row-${session.sessionId}`} data-project={projectId} />
);

describe('RecentSessionsSection', () => {
  it('renders heading, project group divider and rows', async () => {
    let tree: ReactTestRenderer | undefined;
    const onNewInProject = jest.fn();
    await act(async () => {
      tree = create(
        <RecentSessionsSection
          groups={groups}
          collapsed={false}
          mobile={false}
          onToggleCollapsed={() => undefined}
          onNewInProject={onNewInProject}
          renderRow={renderRow}
        />,
      );
    });
    expect(tree!.root.findByProps({className: 'wide-project-name'}).children).toEqual(['Recent Sessions']);
    expect(tree!.root.findByProps({className: 'recent-project-divider-name'}).children).toEqual(['WheelMaker']);
    expect(tree!.root.findAllByProps({className: 'recent-row-s1'})).toHaveLength(1);
  });

  it('hides body when collapsed and supports hiding the heading', async () => {
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(
        <RecentSessionsSection
          groups={groups}
          collapsed
          mobile={false}
          showHeading={false}
          onToggleCollapsed={() => undefined}
          onNewInProject={() => undefined}
          renderRow={renderRow}
        />,
      );
    });
    expect(tree!.root.findAllByProps({className: 'wide-project-name'})).toHaveLength(0);
    // collapsed + no heading => body still renders (matches current showHeading===false behavior)
    expect(tree!.root.findAllByProps({className: 'recent-row-s1'})).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest web/src/chat/sessionlist/ProjectSection.test.tsx web/src/chat/sessionlist/RecentSessionsSection.test.tsx`
Expected: FAIL — Cannot find module

- [ ] **Step 3: 实现两个组件**

```tsx
// app/web/src/chat/sessionlist/ProjectSection.tsx
import React, {type ReactNode} from 'react';
import {SessionIcon} from './SessionIcon';
import type {SessionRowGestureHandlers} from './SessionRow';

export type ProjectSectionProps = {
  name: string;
  hubLabel: string;
  hubVariantClass: string;
  hubAccentStyle: React.CSSProperties;
  collapsed: boolean;
  pinned: boolean;
  active: boolean;
  mobile: boolean;
  projectGestureHandlers: SessionRowGestureHandlers;
  onToggleCollapsed: () => void;
  onNew: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onResume: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onTogglePin: () => void;
  error?: string;
  onRetryError?: () => void;
  children?: ReactNode;
};

export function ProjectSection({
  name,
  hubLabel,
  hubVariantClass,
  hubAccentStyle,
  collapsed,
  pinned,
  active,
  mobile,
  projectGestureHandlers,
  onToggleCollapsed,
  onNew,
  onResume,
  onTogglePin,
  error,
  onRetryError,
  children,
}: ProjectSectionProps) {
  const sfx = (cls: string) => (mobile ? ` ${cls}` : '');
  return (
    <div
      className={`wide-project-section${sfx('mobile-project-section')}${active ? ' active' : ''}${pinned ? ' pinned' : ''}${collapsed ? ' collapsed' : ''}`}
    >
      <div className={`wide-project-row${sfx('mobile-project-row')}`}>
        <button
          type="button"
          className={`wide-project-toggle${sfx('mobile-project-toggle')}`}
          {...projectGestureHandlers}
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand project' : 'Collapse project'}
          aria-expanded={!collapsed}
        >
          <span className="wide-project-folder-wrap">
            <SessionIcon
              name={collapsed ? 'folder' : 'folderOpen'}
              size={15}
              className={`wide-project-folder-icon ${hubVariantClass}`}
            />
            {pinned ? (
              <SessionIcon name="pin" size={10} filled className="wide-project-pin-badge" />
            ) : null}
          </span>
          <span className="wide-project-title-group">
            <span className="wide-project-name" title={name}>{name}</span>
            <span className={`wide-project-hub-tag ${hubVariantClass}`} style={hubAccentStyle}>
              <span className="wide-project-hub-dot" aria-hidden="true" />
              <span className="wide-project-hub-label">{hubLabel}</span>
            </span>
          </span>
        </button>
        <div className={`wide-project-actions${sfx('mobile-project-actions')}`}>
          <button
            type="button"
            className="wide-project-action-btn sl-action-primary"
            title="New session"
            aria-label={`New session in ${name}`}
            onPointerDown={event => event.stopPropagation()}
            onClick={onNew}
          >
            <SessionIcon name="plus" />
          </button>
          <button
            type="button"
            className="wide-project-action-btn sl-action-secondary"
            title="Resume session"
            aria-label={`Resume session in ${name}`}
            onPointerDown={event => event.stopPropagation()}
            onClick={onResume}
          >
            <SessionIcon name="history" />
          </button>
          <button
            type="button"
            className={`wide-project-action-btn wide-project-pin-btn sl-action-secondary${pinned ? ' active' : ''}`}
            title={pinned ? 'Unpin project' : 'Pin project to top'}
            aria-label={pinned ? `Unpin project ${name}` : `Pin project ${name}`}
            aria-pressed={pinned}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              onTogglePin();
            }}
          >
            <SessionIcon name="pin" filled={pinned} />
          </button>
        </div>
      </div>
      {error ? (
        <div className="mobile-project-session-error">
          <span>Session refresh failed.</span>
          <button type="button" onClick={onRetryError}>Retry</button>
        </div>
      ) : null}
      {!collapsed ? (
        <div className={`wide-project-session-list${sfx('mobile-project-session-list')}`}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
```

```tsx
// app/web/src/chat/sessionlist/RecentSessionsSection.tsx
import React, {type ReactNode} from 'react';
import {SessionIcon} from './SessionIcon';

export type RecentGroup = {
  projectId: string;
  projectName: string;
  hubLabel: string;
  hubVariantClass: string;
  hubAccentStyle: React.CSSProperties;
  /** Live sessions for this project; rows are rendered via the renderRow prop. */
  sessions: Array<{sessionId: string}>;
};

export type RecentSessionsSectionProps = {
  groups: RecentGroup[];
  collapsed: boolean;
  mobile: boolean;
  /** Defaults to true; floating Recent panel passes false (card title already says Recent). */
  showHeading?: boolean;
  onToggleCollapsed: () => void;
  onNewInProject: (projectId: string, event: React.MouseEvent<HTMLButtonElement>) => void;
  renderRow: (projectId: string, session: {sessionId: string}) => ReactNode;
};

export function RecentSessionsSection({
  groups,
  collapsed,
  mobile,
  showHeading = true,
  onToggleCollapsed,
  onNewInProject,
  renderRow,
}: RecentSessionsSectionProps) {
  return (
    <div
      className={`wide-project-section recent-sessions-section${mobile ? ' mobile-project-section' : ''}${collapsed ? ' collapsed' : ''}`}
    >
      {showHeading ? (
        <div className="wide-project-row">
          <button
            type="button"
            className="wide-project-toggle"
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand Recent Sessions' : 'Collapse Recent Sessions'}
            aria-expanded={!collapsed}
          >
            <span className="wide-project-folder-wrap">
              <SessionIcon name="history" size={15} className="recent-sessions-icon" />
            </span>
            <span className="wide-project-title-group">
              <span className="wide-project-name">Recent Sessions</span>
            </span>
          </button>
          <button
            type="button"
            className="wide-project-action-btn recent-sessions-collapse-btn"
            title={collapsed ? 'Expand Recent Sessions' : 'Collapse Recent Sessions'}
            aria-label={collapsed ? 'Expand Recent Sessions' : 'Collapse Recent Sessions'}
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
          >
            <SessionIcon name={collapsed ? 'chevronDown' : 'chevronUp'} />
          </button>
        </div>
      ) : null}
      {collapsed && showHeading ? null : (
        <div className={`wide-project-session-list recent-sessions-list${mobile ? ' mobile-project-session-list' : ''}`}>
          {groups.map(group => (
            <div
              key={`recent-project:${group.projectId}`}
              className="recent-project-session-group"
              role="group"
              aria-label={`${group.projectName} recent sessions`}
            >
              <div className="recent-project-divider">
                <SessionIcon name="folder" size={13} className="recent-project-divider-icon" />
                <span className="recent-project-divider-name" title={group.projectName}>
                  {group.projectName}
                </span>
                <span className={`wide-project-hub-tag recent-project-divider-hub ${group.hubVariantClass}`} style={group.hubAccentStyle}>
                  <span className="wide-project-hub-dot" aria-hidden="true" />
                  <span className="wide-project-hub-label">{group.hubLabel}</span>
                </span>
                <button
                  type="button"
                  className="recent-project-divider-create"
                  title={`New session in ${group.projectName}`}
                  aria-label={`New session in ${group.projectName}`}
                  onClick={event => onNewInProject(group.projectId, event)}
                >
                  <SessionIcon name="plus" size={13} />
                </button>
              </div>
              <div className="recent-project-session-list">{group.sessions.map(session => renderRow(group.projectId, session))}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest web/src/chat/sessionlist/ProjectSection.test.tsx web/src/chat/sessionlist/RecentSessionsSection.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/web/src/chat/sessionlist/ProjectSection.tsx app/web/src/chat/sessionlist/ProjectSection.test.tsx app/web/src/chat/sessionlist/RecentSessionsSection.tsx app/web/src/chat/sessionlist/RecentSessionsSection.test.tsx
git commit -m "feat(app): extract ProjectSection and RecentSessionsSection components"
```

---

### Task 5: SessionMenu（会话上下文菜单）组件抽取

**Files:**
- Create: `app/web/src/chat/sessionlist/SessionMenu.tsx`
- Test: `app/web/src/chat/sessionlist/SessionMenu.test.tsx`

说明：保留 `project-session-action-menu` / `project-session-menu-btn` / `project-session-menu-label` / `project-session-menu-separator` class 与菜单项顺序（Pin、Rename、Archive、分隔线、Reload、Delete），codicon 换 SessionIcon；popover 定位 style 由调用方传入。菜单项功能与现状一一对应，不增删。

- [ ] **Step 1: 写失败测试**

```tsx
// app/web/src/chat/sessionlist/SessionMenu.test.tsx
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {SessionMenu} from './SessionMenu';

async function renderMenu(extra?: Partial<React.ComponentProps<typeof SessionMenu>>) {
  let tree: ReactTestRenderer | undefined;
  const props = {
    pinned: false,
    pinning: false,
    renaming: false,
    actionDisabled: false,
    archiving: false,
    reloading: false,
    deleting: false,
    onTogglePin: jest.fn(),
    onRename: jest.fn(),
    onArchive: jest.fn(),
    onReload: jest.fn(),
    onDelete: jest.fn(),
    ...extra,
  };
  await act(async () => {
    tree = create(<SessionMenu {...props} />);
  });
  return {tree: tree!, props};
}

describe('SessionMenu', () => {
  it('renders five menu items in order with a separator before Reload', async () => {
    const {tree} = await renderMenu();
    const labels = tree.root
      .findAll(node => typeof node.props.className === 'string' && node.props.className.includes('project-session-menu-label'))
      .map(node => node.children.join(''));
    expect(labels).toEqual(['Pin', 'Rename', 'Archive', 'Reload', 'Delete']);
    expect(tree.root.findAllByProps({className: 'project-session-menu-separator'})).toHaveLength(1);
    // every item has an svg icon
    expect(tree.root.findAllByType('svg').length).toBeGreaterThanOrEqual(5);
  });

  it('shows Unpin when pinned and routes callbacks', async () => {
    const {tree, props} = await renderMenu({pinned: true});
    const labels = tree.root
      .findAll(node => typeof node.props.className === 'string' && node.props.className.includes('project-session-menu-label'))
      .map(node => node.children.join(''));
    expect(labels[0]).toBe('Unpin');
    const archiveBtn = tree.root.findByProps({className: 'project-session-menu-btn archive'});
    await act(async () => {
      archiveBtn.props.onClick({stopPropagation: jest.fn()});
    });
    expect(props.onArchive).toHaveBeenCalledTimes(1);
  });

  it('disables destructive/busy actions and shows spinner', async () => {
    const {tree} = await renderMenu({actionDisabled: true, archiving: true});
    const archiveBtn = tree.root.findByProps({className: 'project-session-menu-btn archive'});
    expect(archiveBtn.props.disabled).toBe(true);
    expect(archiveBtn.findByType('svg').props.className).toContain('sl-icon-spin');
    expect(tree.root.findByProps({className: 'project-session-menu-btn delete'}).props.disabled).toBe(true);
    expect(tree.root.findByProps({className: 'project-session-menu-btn rename'}).props.disabled).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest web/src/chat/sessionlist/SessionMenu.test.tsx`
Expected: FAIL — Cannot find module './SessionMenu'

- [ ] **Step 3: 实现 SessionMenu**

```tsx
// app/web/src/chat/sessionlist/SessionMenu.tsx
import React from 'react';
import {SessionIcon, type SessionIconName} from './SessionIcon';

export type SessionMenuProps = {
  pinned: boolean;
  pinning: boolean;
  renaming: boolean;
  /** Disables archive/reload/delete (session running or another destructive op in flight). */
  actionDisabled: boolean;
  archiving: boolean;
  reloading: boolean;
  deleting: boolean;
  onTogglePin: () => void;
  onRename: () => void;
  onArchive: () => void;
  onReload: () => void;
  onDelete: () => void;
  /** Popover positioning style computed by the caller. */
  popoverStyle?: React.CSSProperties;
  /** When true, plays the exit animation (Task 9 wires this). */
  exiting?: boolean;
};

type MenuItem = {
  key: string;
  className: string;
  icon: SessionIconName;
  label: string;
  disabled: boolean;
  busy: boolean;
  onSelect: () => void;
};

export function SessionMenu({
  pinned,
  pinning,
  renaming,
  actionDisabled,
  archiving,
  reloading,
  deleting,
  onTogglePin,
  onRename,
  onArchive,
  onReload,
  onDelete,
  popoverStyle,
  exiting = false,
}: SessionMenuProps) {
  const items: Array<MenuItem | 'separator'> = [
    {key: 'pin', className: 'pin', icon: 'pin', label: pinned ? 'Unpin' : 'Pin', disabled: pinning, busy: pinning, onSelect: onTogglePin},
    {key: 'rename', className: 'rename', icon: 'pencil', label: 'Rename', disabled: renaming, busy: renaming, onSelect: onRename},
    {key: 'archive', className: 'archive', icon: 'archive', label: 'Archive', disabled: actionDisabled, busy: archiving, onSelect: onArchive},
    'separator',
    {key: 'reload', className: 'reload', icon: 'refreshCw', label: 'Reload', disabled: actionDisabled, busy: reloading, onSelect: onReload},
    {key: 'delete', className: 'delete', icon: 'trash', label: 'Delete', disabled: actionDisabled, busy: deleting, onSelect: onDelete},
  ];
  return (
    <div
      className={`project-session-action-menu${exiting ? ' sl-menu-exit' : ''}`}
      role="menu"
      style={popoverStyle}
    >
      {items.map(item =>
        item === 'separator' ? (
          <div key="separator" className="project-session-menu-separator" aria-hidden="true" />
        ) : (
          <button
            key={item.key}
            type="button"
            className={`project-session-menu-btn ${item.className}`}
            role="menuitem"
            disabled={item.disabled}
            onClick={event => {
              event.stopPropagation();
              item.onSelect();
            }}
          >
            {item.busy ? <SessionIcon name="loader" spin /> : <SessionIcon name={item.icon} />}
            <span className="project-session-menu-label">{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest web/src/chat/sessionlist/SessionMenu.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/web/src/chat/sessionlist/SessionMenu.tsx app/web/src/chat/sessionlist/SessionMenu.test.tsx
git commit -m "feat(app): extract SessionMenu context menu component"
```

---

### Task 6: SessionListView 编排组件 + WorkspaceApp 迁移

**Files:**
- Create: `app/web/src/chat/sessionlist/SessionListView.tsx`
- Test: `app/web/src/chat/sessionlist/SessionListView.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`（删除已迁移的 render 闭包，装配 controller）

这是最大的一步。迁移后**行为与 DOM class 完全不变**；旧 CSS 继续生效。

- [ ] **Step 1: 写失败测试（轻量集成：编排 + 回调接线）**

```tsx
// app/web/src/chat/sessionlist/SessionListView.test.tsx
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {SessionListView, type SessionListViewProps} from './SessionListView';

function makeProps(overrides?: Partial<SessionListViewProps>): SessionListViewProps {
  return {
    mobile: false,
    mode: 'normal',
    hasProjects: true,
    recentGroups: [],
    recentCollapsed: false,
    showRecentHeading: true,
    onToggleRecent: jest.fn(),
    projectItems: [
      {projectId: 'p1', name: 'WheelMaker', hubId: 'local'},
      {projectId: 'p2', name: 'MiscTools', hubId: 'ks'},
    ],
    activeProjectId: 'p1',
    collapsedProjectIds: [],
    pinnedProjectIds: [],
    sessionsByProjectId: {
      p1: [{sessionId: 's1', title: 'Fix bug', agentType: 'kimi', updatedAt: '2026-07-24T00:00:00Z'} as never],
      p2: [],
    },
    draftSessionsByProjectId: {},
    olderExpandedByProjectId: {},
    selectedChatEncodedKey: '',
    pinningSessionKey: '',
    resolveTitle: s => (s as {title?: string}).title ?? (s as {sessionId: string}).sessionId,
    agentLabel: () => 'cc · kimi',
    sessionAgentClass: () => 'wide-session-agent variant-1',
    projectHubClass: () => 'wide-project-hub variant-0',
    hubAccentStyle: () => ({'--hub-accent': '#58a6ff'} as React.CSSProperties),
    formatAge: () => '3m',
    runtimeKey: (p, s) => `${p}:${s}`,
    sessionActionKey: (p, s) => `${p}:${s}`,
    renderLeadingState: () => null,
    splitOlder: (_p, sessions) => ({visibleSessions: sessions, showToggle: false, hiddenOlderCount: 0}),
    onSelectSession: jest.fn(),
    onSelectDraft: jest.fn(),
    onDismissDraft: jest.fn(),
    onUnpinSession: jest.fn(),
    onToggleProjectCollapsed: jest.fn(),
    onTogglePinnedProject: jest.fn(),
    onToggleOlder: jest.fn(),
    onOpenProjectMenu: jest.fn(),
    sessionGestureHandlers: () => ({}),
    consumeSessionLongPressClick: () => false,
    projectGestureHandlers: () => ({}),
    consumeProjectLongPressClick: () => false,
    onOpenSessionContextMenu: jest.fn(),
    onRetryMobileSessions: jest.fn(),
    mobileSessionErrors: {},
    emptyProjectsHint: null,
    hiddenProjectRows: null,
    archivedRows: null,
    searchResults: null,
    ...overrides,
  };
}

describe('SessionListView', () => {
  it('renders project sections and empty hint for a project without sessions', async () => {
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(<SessionListView {...makeProps()} />);
    });
    const names = tree!.root.findAllByProps({className: 'wide-project-name'}).map(n => n.children.join(''));
    expect(names).toEqual(['WheelMaker', 'MiscTools']);
    expect(tree!.root.findAllByProps({className: 'wide-project-empty'})).toHaveLength(1);
  });

  it('routes session click through onSelectSession with project and session id', async () => {
    const props = makeProps();
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(<SessionListView {...props} />);
    });
    const row = tree!.root.findAllByType('button').find(b => b.props.className?.includes?.('wide-session-row'))!;
    await act(async () => {
      row.props.onClick({stopPropagation: jest.fn()});
    });
    expect(props.onSelectSession).toHaveBeenCalledWith('p1', 's1', expect.anything());
  });

  it('renders archivedRows in archived mode and searchResults in search mode', async () => {
    let archived: ReactTestRenderer | undefined;
    await act(async () => {
      archived = create(<SessionListView {...makeProps({mode: 'archived', archivedRows: <div className="archived-marker" />})} />);
    });
    expect(archived!.root.findAllByProps({className: 'archived-marker'})).toHaveLength(1);
    expect(archived!.root.findAllByProps({className: 'wide-project-name'})).toHaveLength(0);

    let search: ReactTestRenderer | undefined;
    await act(async () => {
      search = create(<SessionListView {...makeProps({mode: 'search', searchResults: <div className="search-marker" />})} />);
    });
    expect(search!.root.findAllByProps({className: 'search-marker'})).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest web/src/chat/sessionlist/SessionListView.test.tsx`
Expected: FAIL — Cannot find module

- [ ] **Step 3: 实现 SessionListView**

```tsx
// app/web/src/chat/sessionlist/SessionListView.tsx
import React, {type ReactNode} from 'react';
import {SessionRow, DraftSessionRow, type SessionRowGestureHandlers} from './SessionRow';
import {ProjectSection} from './ProjectSection';
import {RecentSessionsSection, type RecentGroup} from './RecentSessionsSection';

export type SessionListMode = 'normal' | 'archived' | 'search';

export type SessionListProjectItem = {
  projectId: string;
  name: string;
  hubId?: string | null;
};

type AnySession = {sessionId: string; agentType?: string; pinned?: boolean; updatedAt?: string};
type AnyDraft = {draftId: string; title: string; status: string; errorMessage?: string; createdAt?: string; agentType?: string};

export type SessionListViewProps = {
  mobile: boolean;
  mode: SessionListMode;
  hasProjects: boolean;
  // Recent block
  recentGroups: RecentGroup[];
  recentCollapsed: boolean;
  showRecentHeading: boolean;
  onToggleRecent: () => void;
  // Project sections
  projectItems: SessionListProjectItem[];
  activeProjectId: string;
  collapsedProjectIds: string[];
  pinnedProjectIds: string[];
  sessionsByProjectId: Record<string, AnySession[]>;
  draftSessionsByProjectId: Record<string, AnyDraft[]>;
  olderExpandedByProjectId: Record<string, boolean>;
  selectedChatEncodedKey: string;
  pinningSessionKey: string;
  mobileSessionErrors: Record<string, string>;
  onRetryMobileSessions: () => void;
  // helpers (WorkspaceApp closures, injected)
  resolveTitle: (session: AnySession) => string;
  agentLabel: (agentType: string) => string;
  sessionAgentClass: (agentType: string) => string;
  projectHubClass: (hubId: string) => string;
  hubAccentStyle: (hubId: string) => React.CSSProperties;
  formatAge: (iso: string) => string;
  runtimeKey: (projectId: string, sessionId: string) => string;
  sessionActionKey: (projectId: string, sessionId: string) => string;
  renderLeadingState: (session: AnySession, projectId: string) => ReactNode;
  splitOlder: (projectId: string, sessions: AnySession[]) => {
    visibleSessions: AnySession[];
    showToggle: boolean;
    hiddenOlderCount: number;
  };
  // callbacks
  onSelectSession: (projectId: string, sessionId: string, event: React.MouseEvent<HTMLButtonElement>) => void;
  onSelectDraft: (projectId: string, draftId: string) => void;
  onDismissDraft: (projectId: string, draftId: string) => void;
  onUnpinSession: (projectId: string, sessionId: string) => void;
  onToggleProjectCollapsed: (projectId: string) => void;
  onTogglePinnedProject: (projectId: string) => void;
  onToggleOlder: (projectId: string) => void;
  onOpenProjectMenu: (projectId: string, kind: 'new' | 'resume', anchor: HTMLElement | null) => void;
  onOpenSessionContextMenu: (projectId: string, sessionId: string, event: React.MouseEvent<HTMLButtonElement>) => void;
  sessionGestureHandlers: (projectId: string, sessionId: string) => Omit<SessionRowGestureHandlers, 'onContextMenu'>;
  consumeSessionLongPressClick: (projectId: string, sessionId: string, event: React.MouseEvent<HTMLButtonElement>) => boolean;
  projectGestureHandlers: (projectId: string) => SessionRowGestureHandlers;
  consumeProjectLongPressClick: (projectId: string, event: React.MouseEvent<HTMLButtonElement>) => boolean;
  // slots rendered outside the normal project list
  emptyProjectsHint: ReactNode;
  hiddenProjectRows: ReactNode;
  archivedRows: ReactNode;
  searchResults: ReactNode;
};

export function SessionListView(props: SessionListViewProps) {
  const {
    mobile,
    mode,
    hasProjects,
    recentGroups,
    recentCollapsed,
    showRecentHeading,
    onToggleRecent,
    projectItems,
    emptyProjectsHint,
    hiddenProjectRows,
    archivedRows,
    searchResults,
  } = props;

  if (mode === 'archived') {
    return <>{archivedRows}</>;
  }
  if (mode === 'search') {
    return <>{searchResults}</>;
  }

  const renderRow = (projectId: string, session: AnySession, recent: boolean) => {
    const title = props.resolveTitle(session) || session.sessionId;
    const agent = (session.agentType || '').trim();
    return (
      <SessionRow
        key={`${projectId}:${recent ? 'recent' : mobile ? 'mobile-session' : 'wide-session'}:${session.sessionId}`}
        title={title}
        rowTitleAttr={recent ? title : undefined}
        agentLabel={agent ? props.agentLabel(agent) : undefined}
        agentClassName={agent ? props.sessionAgentClass(agent) : undefined}
        timeLabel={props.formatAge(session.updatedAt ?? '')}
        timeTitle={session.updatedAt ?? ''}
        selected={props.selectedChatEncodedKey === props.runtimeKey(projectId, session.sessionId)}
        pinned={session.pinned === true}
        pinning={props.pinningSessionKey === props.sessionActionKey(projectId, session.sessionId)}
        mobile={mobile}
        recent={recent}
        leadingState={props.renderLeadingState(session, projectId)}
        gestureHandlers={{
          ...props.sessionGestureHandlers(projectId, session.sessionId),
          onContextMenu: event => props.onOpenSessionContextMenu(projectId, session.sessionId, event),
        }}
        onClick={event => {
          if (props.consumeSessionLongPressClick(projectId, session.sessionId, event)) {
            return;
          }
          props.onSelectSession(projectId, session.sessionId, event);
        }}
        onUnpin={() => props.onUnpinSession(projectId, session.sessionId)}
        unpinLabel={`Unpin session ${title}`}
      />
    );
  };

  return (
    <>
      {!hasProjects ? emptyProjectsHint : null}
      {recentGroups.length > 0 ? (
        <RecentSessionsSection
          groups={recentGroups}
          collapsed={recentCollapsed}
          mobile={mobile}
          showHeading={showRecentHeading}
          onToggleCollapsed={onToggleRecent}
          onNewInProject={(projectId, event) => props.onOpenProjectMenu(projectId, 'new', event.currentTarget)}
          renderRow={(projectId, session) => renderRow(projectId, session as AnySession, true)}
        />
      ) : null}
      {projectItems.map(item => {
        const projectId = item.projectId;
        const collapsed = props.collapsedProjectIds.includes(projectId);
        const sessions = props.sessionsByProjectId[projectId] ?? [];
        const drafts = props.draftSessionsByProjectId[projectId] ?? [];
        const split = props.splitOlder(projectId, sessions);
        const hubId = item.hubId || 'local';
        return (
          <ProjectSection
            key={`${mobile ? 'mobile-project' : 'wide-project'}:${projectId}`}
            name={item.name}
            hubLabel={hubId}
            hubVariantClass={props.projectHubClass(hubId)}
            hubAccentStyle={props.hubAccentStyle(hubId)}
            collapsed={collapsed}
            pinned={props.pinnedProjectIds.includes(projectId)}
            active={projectId === props.activeProjectId}
            mobile={mobile}
            projectGestureHandlers={{
              ...props.projectGestureHandlers(projectId),
              onContextMenu: event => event.preventDefault(),
            }}
            onToggleCollapsed={() => {
              if (props.consumeProjectLongPressClick(projectId, {preventDefault: () => undefined} as never)) {
                return;
              }
              props.onToggleProjectCollapsed(projectId);
            }}
            onNew={event => {
              event.stopPropagation();
              props.onOpenProjectMenu(projectId, 'new', event.currentTarget);
            }}
            onResume={event => {
              event.stopPropagation();
              props.onOpenProjectMenu(projectId, 'resume', event.currentTarget);
            }}
            onTogglePin={() => props.onTogglePinnedProject(projectId)}
            error={mobile ? props.mobileSessionErrors[projectId] ?? '' : ''}
            onRetryError={props.onRetryMobileSessions}
          >
            {drafts.map(draft => (
              <DraftSessionRow
                key={`${projectId}:${mobile ? 'mobile-draft' : 'wide-draft'}:${draft.draftId}`}
                title={draft.title}
                statusLabel={draft.status === 'sendingFirstPrompt' ? 'Sending...' : draft.status === 'failed' ? 'Failed' : 'Creating...'}
                failed={draft.status === 'failed'}
                errorMessage={draft.errorMessage}
                createdAtTitle={draft.createdAt}
                agentLabel={draft.agentType ? props.agentLabel(draft.agentType) : undefined}
                agentClassName={draft.agentType ? props.sessionAgentClass(draft.agentType) : undefined}
                selected={props.selectedChatEncodedKey === props.runtimeKey(projectId, draft.draftId)}
                mobile={mobile}
                onClick={() => props.onSelectDraft(projectId, draft.draftId)}
                onDismiss={draft.status === 'failed' ? () => props.onDismissDraft(projectId, draft.draftId) : undefined}
              />
            ))}
            {split.visibleSessions.map(session => renderRow(projectId, session, false))}
            {split.showToggle ? (
              <button
                type="button"
                className={`wide-session-row session-older-toggle${mobile ? ' mobile-session-row' : ''}`}
                onClick={() => props.onToggleOlder(projectId)}
              >
                <span className="wide-session-title">
                  {props.olderExpandedByProjectId[projectId]
                    ? 'Hide old sessions'
                    : `Show ${split.hiddenOlderCount} old sessions...`}
                </span>
              </button>
            ) : null}
            {sessions.length === 0 ? <div className="wide-project-empty">No sessions yet.</div> : null}
          </ProjectSection>
        );
      })}
      {hiddenProjectRows}
    </>
  );
}
```

- [ ] **Step 4: 跑组件测试确认通过**

Run: `npx jest web/src/chat/sessionlist/`
Expected: PASS（含 Task 4 修正后的 RecentSessionsSection 测试）

- [ ] **Step 5: WorkspaceApp.tsx 迁移**

在 `app/web/src/app/WorkspaceApp.tsx` 中：

1. 顶部 import 新组件：
   ```ts
   import {SessionListView} from '../chat/sessionlist/SessionListView';
   import {SessionMenu} from '../chat/sessionlist/SessionMenu';
   ```
2. **删除**以下 render 闭包（行号为迁移前参考，以函数名为准）：`renderDraftSessionRow`（≈14171）、`renderProjectSessionRow`（≈14227）、`renderRecentSessionRow`（≈14310）、`renderRecentProjectSessionSection`（≈14592）、`renderRecentSessionsSection`（≈14646）、`renderProjectSessionRowsWithOlderFolding`（≈14700）、`renderProjectSection`（≈16210）。
3. 在这批函数原位置定义一次 props 装配（直接引用现有闭包/状态，名字逐一对应；tsc 会校验缺漏）：
   ```tsx
   const sessionListMode = archivedMode ? 'archived' : sessionSearchActive ? 'search' : 'normal';
   const buildSessionListViewProps = (mobile: boolean, showRecentHeading: boolean) => ({
     mobile,
     mode: sessionListMode,
     hasProjects: projects.length > 0,
     recentGroups: recentSessionSections.map(section => ({
       projectId: section.projectId,
       projectName: section.projectName || section.projectId,
       hubLabel: section.projectHubId || 'local',
       hubVariantClass: tagVariantClass('wide-project-hub', section.projectHubId || 'local'),
       hubAccentStyle: hubAccentStyle(section.projectHubId || 'local'),
       sessions: section.sessions.map(snapshot =>
         projectSessionsByProjectId[section.projectId]?.find(item => item.sessionId === snapshot.sessionId) ?? snapshot,
       ),
     })),
     recentCollapsed: collapsedProjectIds.includes(RECENT_SESSIONS_VIRTUAL_PROJECT_ID),
     showRecentHeading,
     onToggleRecent: () => toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID),
     projectItems: visibleProjectItems,
     activeProjectId: projectId,
     collapsedProjectIds,
     pinnedProjectIds,
     sessionsByProjectId: projectSessionsByProjectId,
     draftSessionsByProjectId,
     olderExpandedByProjectId: olderSessionsExpandedByProjectId,
     selectedChatEncodedKey,
     pinningSessionKey: chatPinningSessionKey,
     mobileSessionErrors: mobileProjectSessionErrors,
     onRetryMobileSessions: () => refreshMobileChatProjectSessions().catch(() => undefined),
     resolveTitle: resolveSessionDisplayTitle,
     agentLabel: agentDisplayLabel,
     sessionAgentClass: (agentType: string) => tagVariantClass('wide-session-agent', agentType),
     projectHubClass: (hubId: string) => tagVariantClass('wide-project-hub', hubId),
     hubAccentStyle,
     formatAge: formatCompactRelativeAge,
     runtimeKey: buildChatRuntimeKey,
     sessionActionKey: projectSessionActionKey,
     renderLeadingState: renderSessionLeadingState,
     splitOlder: (targetProjectId: string, sessions: typeof projectSessionsByProjectId[string]) => {
       const expanded = olderSessionsExpandedByProjectId[targetProjectId] === true;
       const split = splitOlderProjectSessions({sessions, nowMs: Date.now(), olderThanDays: OLDER_SESSION_DAYS, expanded});
       return {visibleSessions: split.visibleSessions, showToggle: split.showToggle, hiddenOlderCount: split.hiddenOlderCount};
     },
     onSelectSession: (targetProjectId: string, sessionId: string) => {
       if (mobile) {
         selectProjectChatSession(targetProjectId, sessionId, {closeMobileDrawer: true}).catch(() => undefined);
       } else {
         selectWideProjectSession(targetProjectId, sessionId).catch(() => undefined);
       }
     },
     onSelectDraft: (targetProjectId: string, draftId: string) =>
       selectDraftChatSession(targetProjectId, draftId, {closeMobileDrawer: mobile}),
     onDismissDraft: (targetProjectId: string, draftId: string) => dismissDraftChatSession(targetProjectId, draftId),
     onUnpinSession: (targetProjectId: string, sessionId: string) =>
       handlePinProjectSession(targetProjectId, sessionId, false).catch(() => undefined),
     onToggleProjectCollapsed: toggleWideProjectCollapsed,
     onTogglePinnedProject: togglePinnedProject,
     onToggleOlder: toggleOlderSessionsExpanded,
     onOpenProjectMenu: (targetProjectId: string, kind: 'new' | 'resume', anchor: HTMLElement | null) => {
       if (mobile) {
         openMobileProjectActionMenu(targetProjectId, kind);
       } else if (anchor) {
         openWideProjectActionMenu(targetProjectId, kind, anchor);
       }
     },
     onOpenSessionContextMenu: openProjectSessionContextMenu,
     sessionGestureHandlers: (targetProjectId: string, sessionId: string) => ({
       onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => startProjectSessionLongPress(targetProjectId, sessionId, event),
       onPointerUp: finishProjectSessionLongPress,
       onPointerCancel: finishProjectSessionLongPress,
       onPointerLeave: finishProjectSessionLongPress,
     }),
     consumeSessionLongPressClick: consumeProjectSessionLongPressClick,
     projectGestureHandlers: (targetProjectId: string) => ({
       onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => startProjectPinLongPress(targetProjectId, event),
       onPointerUp: finishProjectPinLongPress,
       onPointerCancel: finishProjectPinLongPress,
       onPointerLeave: finishProjectPinLongPress,
       onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault(),
     }),
     consumeProjectLongPressClick: consumeProjectPinLongPressClick,
     emptyProjectsHint: mobile ? (
       <div className="chat-empty-hint chat-empty-state">
         <SessionIcon name="inbox" size={28} />
         <span>No projects available.</span>
       </div>
     ) : (
       <div className="chat-empty-hint">No projects available.</div>
     ),
     hiddenProjectRows: renderHiddenProjectRows(mobile),
     archivedRows: renderArchivedSessionRows(mobile),
     searchResults: renderSessionSearchResults(mobile),
   });
   ```
   （`SessionIcon` 一并 import；原 mobile 空态的 `codicon-inbox` 随之替换。）

   注意：原 Recent 行 live-session 解析（`renderRecentSessionRow` 里的 liveSession 逻辑）已在上面的 `recentGroups.sessions` 映射里完成，SessionRow 拿到的就是 live session。

4. `renderWideProjectSessionNav` 改为：
   ```tsx
   const renderWideProjectSessionNav = (options?: { includeRecent?: boolean }) => {
     return (
       <ChatSessionNav className="wide-project-session-nav" dataSessionListDensity={sessionListDensity}>
         {renderArchiveBatchStatus()}
         <SessionListView
           {...buildSessionListViewProps(false, !archivedMode && options?.includeRecent !== false)}
           recentGroups={archivedMode || options?.includeRecent === false ? [] : buildSessionListViewProps(false, true).recentGroups}
         />
       </ChatSessionNav>
     );
   };
   ```
   实现时把 `buildSessionListViewProps(false, ...)` 提取为单次调用常量避免重复构造（上面写法仅为示意两遍调用的差异：heading 显隐与 recentGroups 置空）。

5. `renderMobileChatSessionSheet` 中 `ChatSessionNav` 改为：
   ```tsx
   <ChatSessionNav className="mobile-project-session-nav" dataSessionListDensity="compact">
     <SessionListView {...buildSessionListViewProps(true, true)} />
   </ChatSessionNav>
   ```
   并删除该函数里 archived/search/空态分支（已进 SessionListView），保留 `renderChatSessionHeader(true)` 与 `renderArchiveBatchStatus()` 在 nav 之外的位置（与现状一致：archive batch status 在 nav 外、header 之后——以现状 DOM 顺序为准，不要移位）。

6. `renderProjectSessionActionMenu`（≈15205）的 JSX 整体替换为：
   ```tsx
   <SessionMenu
     pinned={session.pinned === true}
     pinning={pinActionDisabled}
     renaming={renameActionDisabled}
     actionDisabled={sessionActionDisabled}
     archiving={chatArchivingSessionId === sessionId}
     reloading={chatReloadingSessionId === sessionId}
     deleting={chatDeletingSessionId === sessionId}
     onTogglePin={() => handlePinProjectSession(targetProjectId, sessionId, session.pinned !== true).catch(() => undefined)}
     onRename={() => requestRenameProjectSession(targetProjectId, session)}
     onArchive={() => requestArchiveProjectSession(targetProjectId, session)}
     onReload={() => handleReloadProjectSession(targetProjectId, sessionId).catch(() => undefined)}
     onDelete={() => requestDeleteProjectSession(targetProjectId, session)}
     popoverStyle={projectSessionActionMenu.popover ? {top: ..., left: ..., width: ..., maxHeight: ..., transform: ...} : undefined}
   />
   ```
   popoverStyle 的字段映射保持现状逐字搬迁（top/left/width/maxHeight/transform 的 placement 逻辑不变）。Delete 项的现状 disabled/busy 逻辑以原代码为准（原实现末尾，≈15313-15340），搬迁时逐字核对。

7. `renderWideProjectActionMenu`（≈16522）、`renderMobileProjectActionSheet`（≈16368）、搜索/归档控件（≈14010-14142）、`renderSessionSearchRow`/`renderArchivedSessionRows` 里的 **codicon span 全部替换为 SessionIcon**（对应表：`codicon-add`→plus、`codicon-history`→history、`codicon-arrow-left`→arrowLeft、`codicon-loading codicon-modifier-spin`→loader spin、`codicon-circle-slash`→ban、`codicon-search`→search、`codicon-check`→check、`codicon-close`→x、`codicon-archive`→archive、`codicon-question`→help、`codicon-inbox`→inbox、`codicon-folder(-opened)`→folder/folderOpen、`codicon-chevron-*`→chevronUp/Down/Right、`codicon-pinned`→pin、`codicon-refresh`→refreshCw、`codicon-edit`→pencil、`codicon-trash`→trash、`codicon-settings-gear`→settings、`codicon-layout-sidebar-left(-off)`→panelLeft/panelLeftClose）。仅限 session 列表范围（含工具栏、菜单、Archived/搜索行），聊天区/设置页等其他区域**不动**。

8. 修复死分支：`renderChatSessionHeader`（≈16204-16207）两个相同 return 合并为一个。

- [ ] **Step 6: 类型检查 + 全量测试**

Run: `npm run tsc:web`
Expected: PASS（缺漏的 controller 字段会在此暴露，按报错补齐）
Run: `npx jest`
Expected: PASS（现有 WorkspaceApp/Chat 相关测试全部保持绿；如有个别测试依赖被删闭包的 DOM 细节，按"行为不变"原则修正测试选择器而非改回实现）

- [ ] **Step 7: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/chat/sessionlist/
git commit -m "refactor(app): migrate session list rendering into sessionlist components"
```

---

### Task 7: 工具栏改造（图标 + PC 常态隐藏可展开 + 移动端 density）

**Files:**
- Modify: `app/web/src/chat/ChatSessionGlobalBar.tsx`
- Modify: `app/web/src/chat/ChatSessionGlobalBar.test.tsx`
- Modify: `app/web/src/chat/ChatEdgeSurfaceHeader.tsx`
- Modify: `app/web/src/chat/ChatEdgeSurfaceHeader.test.tsx`
- Modify: `app/web/src/chat/ChatRecentSessionsSurface.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`（toolbar expanded 状态 + 三处 GlobalBar 调用点）

- [ ] **Step 1: 更新 ChatSessionGlobalBar 测试（先失败）**

新增用例（追加到现有 describe，现有 codicon 断言同步改为 svg 断言）：

```tsx
it('renders only the expand button when collapsible and collapsed', async () => {
  let tree: ReactTestRenderer | undefined;
  const onToggleExpanded = jest.fn();
  await act(async () => {
    tree = create(
      <ChatSessionGlobalBar
        collapsible
        expanded={false}
        onToggleExpanded={onToggleExpanded}
        pinActive
        onTogglePin={() => undefined}
        leading={<button type="button">archive</button>}
      />,
    );
  });
  expect(tree!.root.findAllByProps({'aria-label': 'Show session toolbar'})).toHaveLength(1);
  expect(tree!.root.findAll(node => node.children?.includes?.('archive'))).toHaveLength(0);
  expect(tree!.root.findAllByProps({'aria-label': 'Unpin session sidebar'})).toHaveLength(0);
});

it('renders full bar with svgs when expanded', async () => {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(
      <ChatSessionGlobalBar
        collapsible
        expanded
        onToggleExpanded={() => undefined}
        pinActive
        onTogglePin={() => undefined}
        leading={<button type="button">archive</button>}
      />,
    );
  });
  expect(tree!.root.findAllByProps({'aria-label': 'Hide session toolbar'})).toHaveLength(1);
  expect(tree!.root.findAllByProps({'aria-label': 'Unpin session sidebar'})).toHaveLength(1);
  expect(tree!.root.findAllByType('svg').length).toBeGreaterThanOrEqual(2);
});
```

现有用例中断言 `codicon-*` class 的地方（如 slide-out 按钮）改为断言 `svg.sl-icon` 存在。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest web/src/chat/ChatSessionGlobalBar.test.tsx`
Expected: FAIL（新 props 未实现）

- [ ] **Step 3: 实现 ChatSessionGlobalBar 改造**

完整替换 `app/web/src/chat/ChatSessionGlobalBar.tsx`：

```tsx
import React, {type ReactNode} from 'react';
import {SessionIcon} from './sessionlist/SessionIcon';

export type ChatSessionGlobalBarProps = {
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
  /** PC toolbar is hidden by default; the user expands it via the sliders button. */
  collapsible?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
};

export const ChatSessionGlobalBar = React.memo(function ChatSessionGlobalBar({
  slideOutOpen,
  onToggleSlideOut,
  showSlideOutShortcut,
  pinActive,
  onTogglePin,
  leading,
  collapsible = false,
  expanded = true,
  onToggleExpanded,
}: ChatSessionGlobalBarProps) {
  const hidden = collapsible && !expanded;
  return (
    <div className={`chat-session-global-bar${slideOutOpen ? ' slide-out-open' : ''}${hidden ? ' collapsed' : ''}`}>
      {!hidden ? (
        <>
          <div className="chat-session-global-bar-leading-actions">{leading}</div>
          <div className="chat-session-global-bar-layout-actions">
            {showSlideOutShortcut && onToggleSlideOut ? (
              <span className="chat-session-global-bar-shortcut" aria-hidden="true">Ctrl+1</span>
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
                <SessionIcon name={slideOutOpen ? 'panelLeftClose' : 'panelLeft'} />
              </button>
            ) : null}
            {onTogglePin ? (
              <button
                type="button"
                className={`chat-session-global-bar-btn${pinActive ? ' active' : ''}`}
                onClick={onTogglePin}
                aria-pressed={!!pinActive}
                aria-label={pinActive ? 'Unpin session sidebar' : 'Pin session sidebar'}
                title={pinActive ? 'Unpin session sidebar' : 'Pin session sidebar'}
              >
                <SessionIcon name="pin" filled={pinActive} />
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {collapsible && onToggleExpanded ? (
        <button
          type="button"
          className={`chat-session-global-bar-btn chat-session-global-bar-expand${hidden ? '' : ' active'}`}
          onClick={onToggleExpanded}
          aria-expanded={!hidden}
          aria-label={hidden ? 'Show session toolbar' : 'Hide session toolbar'}
          title={hidden ? 'Show session toolbar' : 'Hide session toolbar'}
        >
          <SessionIcon name="sliders" />
        </button>
      ) : null}
    </div>
  );
});
```

（死 prop `title` 一并删除；调用点本就不传。）

- [ ] **Step 4: ChatEdgeSurfaceHeader 换图标**

`app/web/src/chat/ChatEdgeSurfaceHeader.tsx`：codicon span 替换为 `<SessionIcon name={collapsed ? 'chevronRight' : 'chevronDown'} />`（import SessionIcon）。`ChatEdgeSurfaceHeader.test.tsx` 里 `codicon-chevron-down/right` 断言改为 `findAllByType('svg')` 长度与存在性断言。`ChatRecentSessionsSurface.test.tsx` 同理（collapse 按钮内 svg 断言替换 codicon 断言）。

- [ ] **Step 5: 跑这三个测试文件**

Run: `npx jest web/src/chat/ChatSessionGlobalBar.test.tsx web/src/chat/ChatEdgeSurfaceHeader.test.tsx web/src/chat/ChatRecentSessionsSurface.test.tsx`
Expected: PASS

- [ ] **Step 6: WorkspaceApp 接线 expanded 状态**

- 新增 state：`const [sessionToolbarExpanded, setSessionToolbarExpanded] = useState(false);`（不持久化，会话级）。
- 三处 `ChatSessionGlobalBar` 调用点（浮动面板 ≈18150、slide-out ≈18198、pinned ≈16664）都加：`collapsible expanded={sessionToolbarExpanded} onToggleExpanded={() => setSessionToolbarExpanded(v => !v)}`。
- 移动端 header（`renderChatSessionHeader(true)`，≈16182-16208 的工具区）保持常驻，不加 collapsible。

- [ ] **Step 7: 类型检查 + 全量测试 + Commit**

Run: `npm run tsc:web && npx jest`
Expected: PASS

```bash
git add app/web/src/chat/ChatSessionGlobalBar.tsx app/web/src/chat/ChatSessionGlobalBar.test.tsx app/web/src/chat/ChatEdgeSurfaceHeader.tsx app/web/src/chat/ChatEdgeSurfaceHeader.test.tsx app/web/src/chat/ChatRecentSessionsSurface.test.tsx app/web/src/app/WorkspaceApp.tsx
git commit -m "feat(app): collapsible PC session toolbar with Lucide icons"
```

---

### Task 8: sessionlist.css 新视觉系统

**Files:**
- Create: `app/web/src/styles/sessionlist.css`
- Modify: `app/web/src/styles/index.css`（注册新样式文件）
- Modify: `app/web/src/styles/chat.css`（删除被接管的旧块）

视觉目标：一级分组强（600 字重 + hub 色图标 + 分区间距）、二级行弱（缩进 + 次级色）、行高不涨（relaxed 行 27-28px / compact 24-25px）、动作 hover 显现（触屏只留 `+`）、agent pill 精致化、选中态有背景。

- [ ] **Step 1: 创建 sessionlist.css**

```css
/* Session list visual system — refined dark tool style.
   Applies to both desktop and mobile navs; density is driven by
   [data-session-list-density] (compact on mobile, user setting on PC). */

/* ---------- density tokens ---------- */
.wide-project-session-nav,
.mobile-project-session-nav,
.chat-recent-sessions-surface,
.chat-pinned-session-panel {
  --sl-row-py: 5px;
  --sl-row-font: 12.5px;
  --sl-section-gap: 12px;
  --sl-indent: 22px;
}
[data-session-list-density="compact"] {
  --sl-row-py: 3px;
  --sl-row-font: 12px;
  --sl-section-gap: 9px;
}

/* ---------- project section (level 1: strong) ---------- */
.wide-project-section {
  margin-top: var(--sl-section-gap);
}
.wide-project-section:first-child {
  margin-top: 0;
}
.wide-project-row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
}
.wide-project-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 6px;
  border: 0;
  background: none;
  border-radius: var(--radius-control);
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard);
}
.wide-project-toggle:hover {
  background: var(--hover);
}
.wide-project-folder-icon {
  color: var(--hub-accent, var(--text-tertiary));
  flex: none;
}
.wide-project-folder-wrap {
  position: relative;
  display: inline-flex;
  flex: none;
}
.wide-project-pin-badge {
  position: absolute;
  right: -4px;
  bottom: -3px;
  color: var(--accent-primary);
}
.wide-project-title-group {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.wide-project-name {
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wide-project-hub-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--hub-accent, var(--text-tertiary));
  opacity: 0.85;
  flex: none;
}
.wide-project-hub-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--hub-accent, var(--text-tertiary));
}
.wide-project-hub-label {
  text-transform: uppercase;
}

/* ---------- project row actions: "+" always visible, rest hover-reveal ---------- */
.wide-project-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.wide-project-action-btn {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  background: none;
  border-radius: var(--radius-control);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color var(--motion-fast) var(--ease-standard), background-color var(--motion-fast) var(--ease-standard), opacity var(--motion-fast) var(--ease-standard);
}
.wide-project-action-btn:hover {
  color: var(--text-primary);
  background: var(--hover);
}
.wide-project-action-btn.wide-project-pin-btn.active {
  color: var(--accent-primary);
}
.sl-action-secondary {
  opacity: 0;
}
.wide-project-row:hover .sl-action-secondary,
.wide-project-row:focus-within .sl-action-secondary {
  opacity: 1;
}
@media (hover: none) {
  .wide-project-row .sl-action-secondary {
    display: none;
  }
}

/* ---------- session rows (level 2: quiet, indented) ---------- */
.wide-project-session-list {
  margin-top: 2px;
}
.project-session-row-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.wide-session-row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--sl-row-py) 8px var(--sl-row-py) var(--sl-indent);
  border: 0;
  background: none;
  border-radius: var(--radius-control);
  font-size: var(--sl-row-font);
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard), transform var(--motion-fast) var(--ease-standard);
}
.wide-session-row:hover {
  background: var(--hover);
  color: var(--text-primary);
}
.wide-session-row:active {
  transform: scale(0.992);
}
.wide-session-row.selected {
  background: var(--accent-soft-bg);
  color: var(--text-primary);
}
.wide-session-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wide-session-row.selected .wide-session-title {
  font-weight: 500;
}
.wide-session-time {
  flex: none;
  font-size: 11px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.wide-session-pin-btn {
  flex: none;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  background: none;
  border-radius: var(--radius-control);
  color: var(--accent-primary);
  cursor: pointer;
  margin-right: 4px;
}
.wide-session-pin-btn:hover {
  background: var(--hover);
}

/* ---------- agent pill (refined) ---------- */
.wide-session-agent-tag {
  flex: none;
  font-size: 10.5px;
  line-height: 16px;
  padding: 0 7px;
  border-radius: 999px;
  color: color-mix(in srgb, var(--agent-accent, var(--text-tertiary)) 88%, white);
  background: color-mix(in srgb, var(--agent-accent, #666) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--agent-accent, #666) 26%, transparent);
}
.theme-light .wide-session-agent-tag {
  color: color-mix(in srgb, var(--agent-accent, #666) 82%, black);
}

/* ---------- recent block ---------- */
.recent-project-divider {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 10px;
  color: var(--text-tertiary);
}
.recent-project-divider-icon {
  flex: none;
}
.recent-project-divider-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-project-divider-create {
  margin-left: auto;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 0;
  background: none;
  border-radius: var(--radius-control);
  color: var(--text-tertiary);
  cursor: pointer;
}
.recent-project-divider-create:hover {
  color: var(--text-primary);
  background: var(--hover);
}
.recent-sessions-list .wide-session-row {
  padding-left: calc(var(--sl-indent) - 4px);
}

/* ---------- misc ---------- */
.wide-project-empty {
  padding: 4px 8px 4px var(--sl-indent);
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.session-older-toggle {
  font-style: normal;
  color: var(--text-tertiary);
}
.sl-icon {
  display: block;
  flex: none;
}
.sl-icon-spin {
  animation: sl-icon-rotate 0.9s linear infinite;
}
@keyframes sl-icon-rotate {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .wide-session-row,
  .wide-project-toggle,
  .wide-project-action-btn,
  .sl-action-secondary {
    transition: none;
  }
  .sl-icon-spin {
    animation-duration: 1.8s;
  }
}
```

- [ ] **Step 2: 注册样式文件**

`app/web/src/styles/index.css`：在 chat.css 的 import 之后加 `@import './sessionlist.css';`（保持顺序在最后，确保接管同优先级旧规则时靠后胜出；先确认 index.css 里现有 import 写法再照抄格式）。

- [ ] **Step 3: 从 chat.css 删除被接管的旧块**

删除以下选择器的规则块（用 Grep 定位，逐块删除；保留不在列表内的规则，如 `.session-state-dot`、`.chat-hub-popover`、密度无关规则）：

- `.wide-project-session-list` 的 `session-list-fade-in` 动画块及 keyframes（≈1205-1220）——Task 9 会以新形式加回
- `.wide-project-row`（≈835）、`.wide-project-toggle`（含 `:active` scale，≈862-864）
- `.wide-project-action-btn`（≈1129-1136 的 opacity 0.45 规则整体废弃）
- `.wide-session-row`（≈1276-1301 含 hover/active/selected）
- `.wide-session-agent-tag` 基础样式及 `.wide-session-agent` 变体块（≈1576-1605）中**除 `--agent-accent` 变量定义外**的表现规则——变体 class 只保留 `--agent-accent: <color>;` 一行
- `.wide-project-folder-icon`、`.wide-project-name`、`.wide-project-hub-tag`、`.wide-project-pin-badge` 旧表现规则
- `.recent-project-divider*`、`.recent-sessions-icon`、`.recent-sessions-collapse-btn` 旧表现规则
- `.wide-project-empty`、`.session-older-toggle` 旧表现规则
- 密度块（≈1558-1574）中与新 token 重复的行高/padding 规则

同时删除 chat.css 中针对 `.codicon` 的 session 列表专用补偿规则（如 `.wide-project-folder-icon.codicon-folder` 的 ≈892-896 字体大小规则）——SessionIcon 用 width/height 属性控制尺寸。

- [ ] **Step 4: 验证**

Run: `npm run tsc:web && npx jest`
Expected: PASS（class 未变，仅样式层替换）
再跑 `npm run build:web` 确认 CSS 无语法错误：Expected: 构建成功。

- [ ] **Step 5: 视觉检查点（人工/截图 review）**

`npm run web` 起 dev server，对照设计呈现 v3 检查：层级对比、hub 色锚点、行高（一屏数量≥现状）、hover 显现动作、移动端紧凑。不达标就地调 sessionlist.css 数值后复验。

- [ ] **Step 6: Commit**

```bash
git add app/web/src/styles/sessionlist.css app/web/src/styles/index.css app/web/src/styles/chat.css
git commit -m "style(app): rebuild session list visual system on shared density tokens"
```

---

### Task 9: 动效（面板折叠、菜单进退场、行 micro-interactions）

**Files:**
- Create: `app/web/src/chat/sessionlist/menuExit.ts`
- Modify: `app/web/src/styles/sessionlist.css`
- Modify: `app/web/src/styles/chat.css`（Recent 面板 collapsed、slide-out、弹层动画）
- Modify: `app/web/src/app/WorkspaceApp.tsx`（菜单 close 走 exit 过渡）

- [ ] **Step 1: useMenuExit helper**

```ts
// app/web/src/chat/sessionlist/menuExit.ts
import {useCallback, useEffect, useRef, useState} from 'react';

export const MENU_EXIT_MS = 100;

/**
 * Wraps a "close menu" setter so the menu first renders with an `exiting`
 * flag (CSS exit animation) and only unmounts after MENU_EXIT_MS.
 * `setMenu` receives null to close; the current menu value must be an object.
 */
export function useMenuExit<T extends object>(setMenu: (value: T | null) => void) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
  }, []);
  const closeWithExit = useCallback(
    (current: T | null) => {
      if (!current) {
        return;
      }
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setMenu(null);
        return;
      }
      setExiting(true);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setExiting(false);
        setMenu(null);
      }, MENU_EXIT_MS);
    },
    [setMenu],
  );
  return {exiting, closeWithExit};
}
```

- [ ] **Step 2: 菜单进/退场 CSS（追加到 sessionlist.css）**

```css
/* ---------- menu enter/exit ---------- */
@keyframes sl-menu-in {
  from { opacity: 0; transform: translateY(-2px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
@keyframes sl-menu-out {
  to { opacity: 0; transform: translateY(-2px) scale(0.98); }
}
.project-session-action-menu,
.wide-project-action-popover {
  animation: sl-menu-in 140ms var(--ease-out);
}
.sl-menu-exit {
  animation: sl-menu-out 100ms ease-in forwards;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .project-session-action-menu,
  .wide-project-action-popover,
  .sl-menu-exit {
    animation: none;
  }
}
```

`SessionMenu` 已支持 `exiting` prop（Task 5）。`wide-project-action-popover` 的退场：`renderWideProjectActionMenu` 根 div 在 exiting 时追加 `sl-menu-exit` class（Task 9 Step 4 接线）。

- [ ] **Step 3: 面板折叠 + 列表进入动画（chat.css 修改 + sessionlist.css 追加）**

chat.css：
- `.chat-recent-sessions-surface` 的 collapsed 切换从瞬切改为过渡：`max-height` 加 `transition: max-height var(--motion-standard) var(--ease-standard)`，expanded 态给一个上限值（`max-height: 70vh`）使过渡可插值；overflow 保持 hidden。
- slide-out 面板已有 180ms transform 过渡（≈3161-3182），把 ease 换成 `var(--ease-standard)` 对齐 token。

sessionlist.css 追加：

```css
/* ---------- list enter ---------- */
@keyframes sl-list-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: none; }
}
.wide-project-session-list {
  animation: sl-list-in var(--motion-standard) var(--ease-out);
}
@media (prefers-reduced-motion: reduce) {
  .wide-project-session-list { animation: none; }
}
```

（现状 `.session-search-result-list` 和 `.chat-recent-sessions-surface-list` 显式关闭进入动画的旧规则在 Task 8 已删，此处不再豁免——统一有进入动画。）

- [ ] **Step 4: WorkspaceApp 菜单 close 接线**

- `renderProjectSessionActionMenu` 的调用组件内（WorkspaceApp）：`const sessionMenuExit = useMenuExit(setProjectSessionActionMenu);`，把**所有** `setProjectSessionActionMenu(null)` 调用点（outside-click ≈5225/5550 区域、Esc、动作完成后等，用 Grep 找全）替换为 `sessionMenuExit.closeWithExit(projectSessionActionMenu)`；`SessionMenu` 传 `exiting={sessionMenuExit.exiting}`。
- `setWideProjectActionMenu(null)`、`setMobileProjectActionMenu(null)` 同样各接一个 `useMenuExit`，popover/根 sheet div 加 `sl-menu-exit` class（mobile sheet 用现有 `mobile-sheet-*` 动画体系，退场 class 追加到 sheet 根节点并在 CSS 里补 `mobile-sheet-slide-down` 反向关键帧）。
- 注意：打开新菜单前若 exit 计时器在跑，`closeWithExit` 重复调用要幂等（直接 return 也行——菜单内容已被 state 替换；实现时以"新菜单打开即取消旧 exit"为准：在 set 新值时同时清 timer，可在 useMenuExit 里补一个 `cancelExit`，接线到打开路径）。

- [ ] **Step 5: 呼吸点收敛（chat.css）**

`session-state-breathe`（≈1318-1352）：把 keyframes 的 opacity 振幅从现状（如 1→0.35）收敛到 1→0.55，duration 1.6s→2s；reduced-motion 下保持静止。

- [ ] **Step 6: 验证**

Run: `npm run tsc:web && npx jest && npm run build:web`
Expected: 全部 PASS。

- [ ] **Step 7: 视觉检查点**

dev server 验证：Recent 面板折叠/展开平滑；菜单打开/关闭都有动画；行 hover/按压反馈跟手；reduced-motion（DevTools 模拟）下全部降级。

- [ ] **Step 8: Commit**

```bash
git add app/web/src/chat/sessionlist/menuExit.ts app/web/src/styles/sessionlist.css app/web/src/styles/chat.css app/web/src/app/WorkspaceApp.tsx
git commit -m "feat(app): unify session list micro-interactions and menu exit motion"
```

---

### Task 10: 菜单族 CSS（popover 质感 + agent pill 菜单 + mobile sheet）

**Files:**
- Modify: `app/web/src/styles/sessionlist.css`
- Modify: `app/web/src/styles/chat.css`（删除被接管的 popover/agent-choice/mobile-sheet 表现块）

- [ ] **Step 1: 菜单容器与项的精致样式（追加到 sessionlist.css）**

```css
/* ---------- menus (context / action popover) ---------- */
.project-session-action-menu,
.wide-project-action-popover {
  background: color-mix(in srgb, var(--surface-overlay) 88%, transparent);
  backdrop-filter: blur(12px) saturate(1.1);
  -webkit-backdrop-filter: blur(12px) saturate(1.1);
  border: 1px solid var(--border-faint);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-overlay);
  padding: 4px;
  z-index: 60;
}
.project-session-menu-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  background: none;
  border-radius: var(--radius-control);
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}
.project-session-menu-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text-primary);
}
.project-session-menu-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.project-session-menu-btn .sl-icon {
  color: var(--text-tertiary);
}
.project-session-menu-btn:hover:not(:disabled) .sl-icon {
  color: var(--text-primary);
}
.project-session-menu-btn.delete:hover:not(:disabled) {
  color: var(--state-danger);
}
.project-session-menu-btn.delete:hover:not(:disabled) .sl-icon {
  color: var(--state-danger);
}
.project-session-menu-separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--border-faint);
}
@media (prefers-reduced-transparency: reduce) {
  .project-session-action-menu,
  .wide-project-action-popover {
    background: var(--surface-overlay);
    backdrop-filter: none;
  }
}

/* ---------- action popover header / items ---------- */
.wide-project-action-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 8px;
  color: var(--text-tertiary);
}
.wide-project-action-title-main {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.wide-project-action-title-sub {
  font-size: 11px;
  color: var(--text-tertiary);
}
.wide-project-action-menu-item,
.wide-project-action-back {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  background: none;
  border-radius: var(--radius-control);
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
}
.wide-project-action-menu-item:hover,
.wide-project-action-back:hover {
  background: var(--hover);
  color: var(--text-primary);
}

/* ---------- agent choice pills ---------- */
.agent-choice-menu {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 8px 8px;
  outline: none;
}
.agent-choice-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--agent-accent, var(--border-strong)) 30%, transparent);
  background: color-mix(in srgb, var(--agent-accent, #666) 10%, transparent);
  color: color-mix(in srgb, var(--agent-accent, var(--text-secondary)) 85%, white);
  font-size: 11.5px;
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard), border-color var(--motion-fast) var(--ease-standard), transform var(--motion-fast) var(--ease-standard);
}
.agent-choice-pill:hover {
  background: color-mix(in srgb, var(--agent-accent, #666) 20%, transparent);
}
.agent-choice-pill.active {
  border-color: color-mix(in srgb, var(--agent-accent, var(--accent-primary)) 65%, transparent);
  background: color-mix(in srgb, var(--agent-accent, #666) 24%, transparent);
}
.agent-choice-pill:active {
  transform: scale(0.97);
}
.agent-choice-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--agent-accent, currentColor);
}
```

- [ ] **Step 2: chat.css 清理**

删除被接管的旧块：`.wide-project-action-popover` 表现块（≈1636-1666 含 popover-in 动画，动画已由 sl-menu-in 接管）、`.project-session-action-menu` / `.project-session-menu-btn` 旧表现、`.agent-choice-menu`/`.agent-choice-pill` 旧表现、`.wide-project-action-title*` / `.wide-project-action-menu-item` / `.wide-project-action-back` 旧表现。玻璃拟态公共块（≈5880-6028）中把 `.wide-project-action-popover`、`.project-session-action-menu` 从旧玻璃组里移除（新规则自带玻璃），保留其余成员不变。

`AgentChoiceMenu.tsx` 不需要改 TSX（class 已匹配）；确认 `agentTagVariantClass` 提供 `--agent-accent` 变体 class 只含变量定义（Task 8 Step 3 已处理同类块——agent-choice 的变体若另有表现规则一并精简为仅变量）。

- [ ] **Step 3: 验证 + 视觉检查点**

Run: `npm run tsc:web && npx jest && npm run build:web`
Expected: PASS。
dev server 检查三个菜单（右键/长按、`+` agent 选择、Resume）视觉一致：玻璃、圆角、图标+文字、hover、进退场；mobile sheet 同语言。

- [ ] **Step 4: Commit**

```bash
git add app/web/src/styles/sessionlist.css app/web/src/styles/chat.css
git commit -m "style(app): restyle session menus and agent choice pills"
```

---

### Task 11: 收尾（codicon 残留检查、死代码清理、全量验证、合并）

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（残留清理，如有）
- Modify: `app/web/src/chat/ChatSessionPanel.tsx`（死 props，如有）
- Modify: `app/web/src/chat/ChatEdgeSurfaceHeader.tsx`（死槽位，如有）

- [ ] **Step 1: session 列表范围 codicon 残留扫描**

Run: `npx rg "codicon" app/web/src/app/WorkspaceApp.tsx app/web/src/chat/ChatSessionGlobalBar.tsx app/web/src/chat/ChatEdgeSurfaceHeader.tsx app/web/src/chat/ChatRecentSessionsSurface.tsx app/web/src/chat/ChatSessionPanel.tsx app/web/src/chat/ChatSessionNav.tsx app/web/src/chat/AgentChoiceMenu.tsx app/web/src/chat/sessionlist/ --glob '!**/*.test.tsx' -n`
Expected: 0 命中（命中则按 Task 6 Step 5.7 的对照表替换；`renderChatHubSummary` 弹层、Archived 行、搜索行也算范围内）。测试文件里的 codicon 断言同步清零。

- [ ] **Step 2: 死 props 清理**

- `ChatSessionPanel` 的 `summary` prop（无人传入）删除。
- `ChatEdgeSurfaceHeader` 的 `leadingActions`/`actions`/`summary` 槽若在所有调用点都未使用（Grep 确认），删除槽位与对应分支，只留 `toolbar` 路径。
- 跑受影响测试确认。

- [ ] **Step 3: 全量验证**

Run: `npm run tsc:web && npx jest && npm run build:web`
Expected: 全部 PASS。

- [ ] **Step 4: 人工验收 checklist（对照 spec 验收标准逐条过）**

1. 移动端抽屉与 PC 三面板行/卡/菜单视觉一致，仅密度与动作可见性不同。
2. 项目行一眼可辨（字重 + hub 色），行高未显著增加（一屏 session 数 ≥ 升级前同视口）。
3. `+` 两端常驻；其余动作 PC hover 显现、移动端长按可达；pin 角标可点 unpin。
4. PC 工具栏默认隐藏、sliders 按钮展开；移动端常驻。
5. 范围内无 codicon。
6. 面板折叠、菜单进退场有动画；reduced-motion 降级。
7. 移动端 compact 生效。
8. 菜单项与升级前一一对应。

- [ ] **Step 5: 最终提交与推送（Completion Gate + git 偏好）**

```bash
cd D:\Code\WheelMaker\.worktree\session-list-visual-upgrade
git add -A
git commit -m "chore(app): finalize session list visual upgrade cleanup"
git push origin session-list-visual-upgrade
```

随后按 git 偏好合并：本地 main 工作树干净则 `git checkout main && git merge session-list-visual-upgrade && git push origin main`，成功后删除任务 worktree 与本地/远端分支；main 有修改则只保留分支不合并。合并后同步确认 wiki 三页与实现一致（`session-list.md`、`pc-chat-sidebar-modes.md`、`visual-language.md`），如有出入以实现为准就地修正 wiki 并追加到合并提交。

---

## 自我审查记录

- **Spec 覆盖**：12 条决策均有任务承接（图标→T1/T6.7/T11.1；token/配色→T2/T8；层级→T4/T8；动作可见性→T4 `sl-action-*`/T8 CSS；菜单族→T5/T9/T10；工具栏→T7；密度→T6.5 mobile compact + T8 token；动效→T9；代码组织→T3-T6；验收 9 条→T11.4 checklist）。
- **占位符**：Task 6 Step 5.6 popoverStyle 标注"逐字搬迁"、Step 5.7 codicon 替换给了对照表与边界，均为机械动作 + 验证命令兜底（tsc + rg + jest），非语义占位。
- **类型一致性**：`SessionIconName`（T1）被 T3/T4/T5/T7 引用一致；`SessionRowGestureHandlers`（T3）被 T4/T6 复用；`RecentGroup` 统一为 `sessions + renderRow` 形态（T4 与 T6 已对齐，草稿不一致已就地修复）。
