# Chat Composer 输入区升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/scope/2026-07-25-chat-composer-upgrade/spec-chat-composer-upgrade.md` 从交互、表现、动效三个维度升级 composer 输入区，并清除 chat 模块全部 codicon 残留。

**Architecture:** 渲染集中在 `WorkspaceApp.tsx` composer 段 + `ChatRichComposer`；菜单互斥收进新的 `useChatComposerMenu`（单一 union state + menuExit 语义），原 7 个 boolean setter 保留名字、委托到新 state，127 个调用点不动；图标走新建的 `ChatIcon`（内联 Lucide 笔画 glyph，复用全局 `sl-icon` 类），与 `SessionIcon` 同模式。

**Tech Stack:** React 18 + Lexical、jest（react-test-renderer + 源码文本断言）、webpack、CSS custom properties（tokens.css）。

**测试约定（本仓库现状）：** `app/__tests__/web-*.test.ts(x)` 用 `fs.readFileSync` + `toContain` 做源码断言；纯函数/hook 用单测（参照 `app/web/src/chat/sessionlist/menuExit.test.tsx` 的 react-test-renderer + fake timers 模式）。新模块的测试文件与模块同目录新建；既有行为的断言更新合并进 `app/__tests__/` 现有文件。所有 jest / tsc 命令在 `app/` 目录下运行。

**codicon → ChatIcon 映射表（全计划共用）：**

| codicon | ChatIcon name | 备注 |
|---|---|---|
| close / x | `x` | |
| check | `check` | |
| chevron-up / chevron-down / chevron-right | `chevronUp` / `chevronDown` / `chevronRight` | |
| arrow-down / arrow-left | `arrowDown` / `arrowLeft` | |
| loading (+modifier-spin) | `loader` + `spin` | |
| error | `circleX` | |
| pass-filled | `circleCheck` | |
| circle-large-outline | `circle` | |
| tools | `wrench` | |
| question | `help` | |
| lightbulb | `lightbulb` | |
| file / files | `file` / `files` | |
| file-media | `image` | |
| file-code | `fileCode` | |
| diff | `fileDiff` | |
| sync / refresh | `refreshCw` | |
| debug-stop / stop-circle | `square` | stop 语义，pill 内用 `filled` |
| unmute | `volume2` | |
| copy / clippy | `copy` / `clipboard` | |
| device-camera | `camera` | |
| code | `code` | |
| folder-opened | `folderOpen` | |
| export | `share` | |
| comment-discussion | `messageSquare` | |
| list-tree | `listTree` | |
| go-to-file | `fileSymlink` | |
| dashboard | `layoutDashboard` | |
| zap | `zap` | |
| wand | `wand` | |
| mic / send | `mic` / `send` | VoiceInputButton |
| attach | `paperclip` | |
| open-preview | `eye` | |
| sparkle | `sparkles` | thinking |
| layout-sidebar-right | `panelRight` | peek viewer chrome |

---

### Task 1: ChatIcon 组件

**Files:**
- Create: `app/web/src/chat/ChatIcon.tsx`
- Test: `app/web/src/chat/ChatIcon.test.tsx`（新模块，无既有承载文件，同目录模式参照 `menuExit.test.tsx`）

Glyph 体是 Lucide 内联 SVG 节点（24x24 viewBox、stroke 1.5、round caps），数据已通过 `better-icons get lucide:<id>` 核实；每个条目注释标注 lucide id。复用全局 `sl-icon` / `sl-icon-spin` 类（`sessionlist.css:532-549`，自带旋转 keyframes 与 reduced-motion 降级），本任务不新增 CSS。

- [ ] **Step 1: 写失败测试** `app/web/src/chat/ChatIcon.test.tsx`

```tsx
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {CHAT_ICON_NAMES, ChatIcon} from './ChatIcon';

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(element);
  });
  return tree!;
}

describe('ChatIcon', () => {
  it('renders every registered glyph as an svg', async () => {
    const tree = await render(
      <>
        {CHAT_ICON_NAMES.map(name => (
          <ChatIcon key={name} name={name} />
        ))}
      </>,
    );
    expect(tree.root.findAllByType('svg')).toHaveLength(CHAT_ICON_NAMES.length);
  });

  it('renders stroke style with spin class', async () => {
    const tree = await render(<ChatIcon name="loader" spin size={16} />);
    const svg = tree.root.findByType('svg');
    expect(svg.props.className).toContain('sl-icon-spin');
    expect(svg.props.stroke).toBe('currentColor');
    expect(svg.props.strokeWidth).toBe(1.5);
    expect(svg.props.width).toBe(16);
  });

  it('supports filled rendering for stop-style glyphs', async () => {
    const tree = await render(<ChatIcon name="square" filled />);
    const svg = tree.root.findByType('svg');
    expect(svg.props.fill).toBe('currentColor');
    expect(svg.props.stroke).toBe('none');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx jest web/src/chat/ChatIcon.test.tsx`
Expected: FAIL（`Cannot find module './ChatIcon'`）

- [ ] **Step 3: 实现** `app/web/src/chat/ChatIcon.tsx`

```tsx
import React from 'react';

// Glyph bodies are Lucide icon inner SVG nodes (24x24 viewBox, stroke-based,
// 1.5px stroke, round caps), same convention as sessionlist/SessionIcon.tsx.
// Verify/replace with `better-icons get lucide:<id>` output (strip fill attrs)
// if a shape looks off — ids noted per entry.
const GLYPHS = {
  // lucide:x
  x: (<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>),
  // lucide:check
  check: (<><path d="M20 6 9 17l-5-5" /></>),
  // lucide:chevron-up
  chevronUp: (<><path d="m18 15-6-6-6 6" /></>),
  // lucide:chevron-down
  chevronDown: (<><path d="m6 9 6 6 6-6" /></>),
  // lucide:chevron-right
  chevronRight: (<><path d="m9 18 6-6-6-6" /></>),
  // lucide:arrow-down
  arrowDown: (<><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>),
  // lucide:arrow-left
  arrowLeft: (<><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>),
  // lucide:loader-circle
  loader: (<><path d="M21 12a9 9 0 1 1-6.219-8.56" /></>),
  // lucide:circle-x
  circleX: (<><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></>),
  // lucide:circle-check
  circleCheck: (<><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>),
  // lucide:circle
  circle: (<><circle cx="12" cy="12" r="10" /></>),
  // lucide:wrench
  wrench: (<><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" /></>),
  // lucide:circle-help
  help: (<><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>),
  // lucide:lightbulb
  lightbulb: (<><path d="M15 14c.2-1 .7-1.7 1.5-2.5C17.5 10.6 18 9.3 18 8a6 6 0 0 0-6 0c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 22h4" /></>),
  // lucide:file
  file: (<><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /></>),
  // lucide:files
  files: (<><path d="M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" /><path d="M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z" /><path d="M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1" /></>),
  // lucide:image
  image: (<><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></>),
  // lucide:file-code
  fileCode: (<><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="m10 11.5L8 15l2 2.5" /><path d="m14 12.5 2 2.5-2 2.5" /></>),
  // lucide:file-diff
  fileDiff: (<><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M9 10h6" /><path d="M12 13V7" /><path d="M9 17h6" /></>),
  // lucide:refresh-cw
  refreshCw: (<><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></>),
  // lucide:square
  square: (<><rect width="18" height="18" x="3" y="3" rx="2" /></>),
  // lucide:volume-2
  volume2: (<><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /><path d="M16 9a5 5 0 0 1 0 6" /><path d="M19.364 18.364a9 9 0 0 0 0-12.728" /></>),
  // lucide:copy
  copy: (<><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>),
  // lucide:clipboard
  clipboard: (<><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>),
  // lucide:camera
  camera: (<><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 0 10.004 4z" /><circle cx="12" cy="13" r="3" /></>),
  // lucide:code
  code: (<><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></>),
  // lucide:folder-open
  folderOpen: (<><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></>),
  // lucide:share
  share: (<><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="m16 6-4-4-4 4" /><path d="M12 2v13" /></>),
  // lucide:message-square
  messageSquare: (<><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" /></>),
  // lucide:list-tree
  listTree: (<><path d="M8 5h13" /><path d="M13 12h8" /><path d="M13 19h8" /><path d="M3 10a2 2 0 0 0 2 2h3" /><path d="M3 5v12a2 2 0 0 0 2 2h3" /></>),
  // lucide:file-symlink
  fileSymlink: (<><path d="M4 11V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="m10 18 3-3-3-3" /></>),
  // lucide:layout-dashboard
  layoutDashboard: (<><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></>),
  // lucide:zap
  zap: (<><path d="M15.914 4a1.5 1.5 0 0 0-2.474-1.561l-9 9A1.5 1.5 0 0 0 5.5 14h4.002a.5.5 0 0 1 .471.666L8.086 20a1.5 1.5 0 0 0 2.475 1.56l9-9A1.5 1.5 0 0 0 18.5 10h-3.997a.5.5 0 0 1-.472-.667z" /></>),
  // lucide:wand-sparkles
  wand: (<><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72z" /><path d="m14 7 3 3" /><path d="M5 6v4" /><path d="M19 14v4" /><path d="M10 2v2" /><path d="M7 8H3" /><path d="M21 16h-4" /><path d="M11 3H9" /></>),
  // lucide:mic
  mic: (<><path d="M12 19v3" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><rect width="6" height="13" x="9" y="2" rx="3" /></>),
  // lucide:send-horizontal
  send: (<><path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z" /><path d="M6 12h16" /></>),
  // lucide:paperclip
  paperclip: (<><path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" /></>),
  // lucide:eye
  eye: (<><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></>),
  // lucide:sparkles
  sparkles: (<><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /><path d="M20 2v4" /><path d="M22 4h-4" /><circle cx="4" cy="20" r="2" /></>),
  // lucide:panel-right
  panelRight: (<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /></>),
} as const;

export type ChatIconName = keyof typeof GLYPHS;

export const CHAT_ICON_NAMES = Object.keys(GLYPHS) as ChatIconName[];

export type ChatIconProps = {
  name: ChatIconName;
  size?: number;
  /** Fill with currentColor instead of stroke (e.g. stop glyph). */
  filled?: boolean;
  spin?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

export function ChatIcon({name, size = 14, filled = false, spin = false, className, style}: ChatIconProps) {
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
      data-icon-name={name}
      className={`sl-icon${spin ? ' sl-icon-spin' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      {GLYPHS[name]}
    </svg>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && npx jest web/src/chat/ChatIcon.test.tsx`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add app/web/src/chat/ChatIcon.tsx app/web/src/chat/ChatIcon.test.tsx
git commit -m "feat(app): add ChatIcon with inline Lucide glyphs"
```

---

### Task 2: 纯数据层 — slash 图标名、分组、显示名；search target 图标名

**Files:**
- Modify: `app/web/src/chat/session/chatSessionActions.ts`
- Modify: `app/web/src/chat/search/searchTargetPicker.ts`
- Test: `app/__tests__/web-chat-session-actions.test.ts`（合并进现有文件）

- [ ] **Step 1: 写失败测试** — 在 `app/__tests__/web-chat-session-actions.test.ts` 顶部 import 追加 `chatSlashOptionDisplayName, groupChatSlashMenuOptions`，并更新/新增断言：

1. 把现有 `icon: 'codicon-circle-large-outline'` 改为 `icon: 'circle'`，`icon: 'codicon-dashboard'` 改为 `icon: 'layoutDashboard'`，`options[2].icon` 断言改为 `toBe('wand')`。
2. 文件末尾追加 describe：

```ts
describe('slash menu grouping and display names', () => {
  test('groups options into Commands and Skills sections preserving order', () => {
    const options = buildChatSessionActionOptions(['zoom-out', 'debug'], {
      status: {supported: true},
      compact: {supported: true},
    });
    const sections = groupChatSlashMenuOptions(options);
    expect(sections.map(section => section.id)).toEqual(['commands', 'skills']);
    expect(sections[0].title).toBe('Commands');
    expect(sections[0].options.map(option => option.name)).toEqual(['/compact', '/status']);
    expect(sections[1].title).toBe('Skills');
    expect(sections[1].options.map(option => option.name)).toEqual(['/debug', '/zoom-out']);
  });

  test('omits empty sections', () => {
    const sections = groupChatSlashMenuOptions([]);
    expect(sections).toEqual([]);
  });

  test('display name strips the leading slash for menu rows', () => {
    expect(chatSlashOptionDisplayName('/compact')).toBe('compact');
    expect(chatSlashOptionDisplayName('//deep-skill')).toBe('deep-skill');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx jest __tests__/web-chat-session-actions.test.ts`
Expected: FAIL（`groupChatSlashMenuOptions is not a function` / icon 断言不匹配）

- [ ] **Step 3: 实现** — `app/web/src/chat/session/chatSessionActions.ts`：

1. import 追加类型：`import type {ChatIconName} from '../ChatIcon';`
2. `ChatSessionSlashOption.icon` 类型从 `string` 改为 `ChatIconName`。
3. 三处硬编码 icon 值替换：`'codicon-circle-large-outline'` → `'circle'`，`'codicon-dashboard'` → `'layoutDashboard'`，`'codicon-zap'` → `'zap'`，`'codicon-wand'` → `'wand'`。
4. 文件末尾追加：

```ts
export type ChatSlashMenuSection = {
  id: 'commands' | 'skills';
  title: string;
  options: ChatSessionSlashOption[];
};

export function groupChatSlashMenuOptions(options: ChatSessionSlashOption[]): ChatSlashMenuSection[] {
  const commands = options.filter(option => option.kind === 'command');
  const skills = options.filter(option => option.kind === 'skill');
  const sections: ChatSlashMenuSection[] = [];
  if (commands.length > 0) {
    sections.push({id: 'commands', title: 'Commands', options: commands});
  }
  if (skills.length > 0) {
    sections.push({id: 'skills', title: 'Skills', options: skills});
  }
  return sections;
}

export function chatSlashOptionDisplayName(name: string): string {
  return name.replace(/^\/+/, '');
}
```

- [ ] **Step 4: searchTargetPicker 图标名** — `app/web/src/chat/search/searchTargetPicker.ts`：`'codicon-comment-discussion'` → `'messageSquare'`，`'codicon-list-tree'` → `'listTree'`，`'codicon-go-to-file'` → `'fileSymlink'`；icon 字段类型改为 `ChatIconName`（import type）。渲染侧在 Task 10 换成 ChatIcon。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd app && npx jest __tests__/web-chat-session-actions.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/web/src/chat/session/chatSessionActions.ts app/web/src/chat/search/searchTargetPicker.ts app/__tests__/web-chat-session-actions.test.ts
git commit -m "feat(app): type slash/search icons as ChatIconName and add slash menu grouping"
```

---

### Task 3: 桌面端 Enter 全平台发送

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx:18286-18298`
- Test: `app/__tests__/web-mobile-enter-key-settings.test.ts`（合并进现有文件）

- [ ] **Step 1: 更新测试断言** — `web-mobile-enter-key-settings.test.ts` 中定位现有 enter 发送逻辑断言（包含 `mobileEnterShouldSend`），改为断言新逻辑；再新增一条桌面断言：

```ts
test('sends on Enter for every desktop platform, not only Windows', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

  expect(mainTsx).toContain("const mobileEnterShouldSend = !isWide && mobileEnterKeyBehavior === 'send';");
  expect(mainTsx).toContain('if (isWide || mobileEnterShouldSend) {');
  const enterHandlerStart = mainTsx.indexOf('const shouldSendChatOnEnter');
  const enterHandlerEnd = mainTsx.indexOf('sendChatMessage().catch(() => undefined);', enterHandlerStart);
  const enterHandler = mainTsx.slice(enterHandlerStart, enterHandlerEnd);
  expect(enterHandler).not.toContain('isWindowsPlatform');
});
```

若现有测试断言了 `mobileEnterShouldSend || isWindowsPlatform`，同步改为新字符串。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx jest __tests__/web-mobile-enter-key-settings.test.ts`
Expected: FAIL（`if (isWide || mobileEnterShouldSend) {` 未找到）

- [ ] **Step 3: 实现** — `WorkspaceApp.tsx:18290-18291`，把：

```ts
                      const mobileEnterShouldSend = !isWide && mobileEnterKeyBehavior === 'send';
                      if (mobileEnterShouldSend || isWindowsPlatform) {
```

改为：

```ts
                      const mobileEnterShouldSend = !isWide && mobileEnterKeyBehavior === 'send';
                      if (isWide || mobileEnterShouldSend) {
```

注意保留上层 `shouldSendChatOnEnter`（Enter 且无 Shift/Alt/非 composing）与菜单打开时 Enter 优先的既有分支不动。`isWindowsPlatform` 本身仍被其他功能（全局快捷键）使用，不删除声明。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && npx jest __tests__/web-mobile-enter-key-settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/__tests__/web-mobile-enter-key-settings.test.ts
git commit -m "feat(app): send chat on Enter across all desktop platforms"
```

---

### Task 4: Stop 状态 pill

**Files:**
- Create: `app/web/src/chat/composer/ChatStopStatusPill.tsx`
- Test: `app/web/src/chat/composer/ChatStopStatusPill.test.tsx`（新模块，同目录）
- Modify: `app/web/src/app/WorkspaceApp.tsx`（18467-18482 stop-slot、16956 `chatComposerStopTriggerClassName`）
- Modify: `app/web/src/styles/chat.css`（3538-3596 stop-trigger 段、3578-3596 keyframes）

pill 形态：状态点 + `Responding` 文本 + 停止符（`square` filled）；cancelling 时文本变 `Cancelling`、glyph 变 `loader` spin、disabled。高度 26px ≤ toolbar 行高。非运行态的退场过渡用既有 `useMenuExitFlag` 驱动显隐。

- [ ] **Step 1: 写失败测试** `app/web/src/chat/composer/ChatStopStatusPill.test.tsx`

```tsx
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ChatStopStatusPill} from './ChatStopStatusPill';

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(element);
  });
  return tree!;
}

describe('ChatStopStatusPill', () => {
  it('shows responding state and fires onCancel', async () => {
    const onCancel = jest.fn();
    const tree = await render(<ChatStopStatusPill cancelling={false} onCancel={onCancel} />);
    const button = tree.root.findByType('button');
    expect(button.props.disabled).toBe(false);
    expect(button.props['aria-label']).toBe('Stop generating');
    expect(tree.root.findByProps({className: 'chat-stop-pill-label'}).children).toEqual(['Responding']);
    await act(async () => {
      button.props.onClick();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows cancelling state as disabled with spinner', async () => {
    const tree = await render(<ChatStopStatusPill cancelling={true} onCancel={() => undefined} />);
    const button = tree.root.findByType('button');
    expect(button.props.disabled).toBe(true);
    expect(button.props['aria-busy']).toBe(true);
    expect(tree.root.findByProps({className: 'chat-stop-pill-label'}).children).toEqual(['Cancelling']);
    const svg = tree.root.findByType('svg');
    expect(svg.props.className).toContain('sl-icon-spin');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx jest web/src/chat/composer/ChatStopStatusPill.test.tsx`
Expected: FAIL（module 不存在）

- [ ] **Step 3: 实现组件** `app/web/src/chat/composer/ChatStopStatusPill.tsx`

```tsx
import React from 'react';
import {ChatIcon} from '../ChatIcon';

export type ChatStopStatusPillProps = {
  cancelling: boolean;
  onCancel: () => void;
};

export function ChatStopStatusPill({cancelling, onCancel}: ChatStopStatusPillProps) {
  return (
    <button
      type="button"
      className={`chat-stop-pill${cancelling ? ' cancelling' : ''}`}
      onClick={onCancel}
      disabled={cancelling}
      aria-label={cancelling ? 'Cancelling prompt' : 'Stop generating'}
      aria-busy={cancelling}
    >
      <span className="chat-stop-pill-dot" aria-hidden="true" />
      <span className="chat-stop-pill-label">{cancelling ? 'Cancelling' : 'Responding'}</span>
      <ChatIcon
        name={cancelling ? 'loader' : 'square'}
        size={11}
        filled={!cancelling}
        spin={cancelling}
        className="chat-stop-pill-glyph"
      />
    </button>
  );
}
```

- [ ] **Step 4: 接线 WorkspaceApp**

a) import 追加：`import {ChatStopStatusPill} from '../chat/composer/ChatStopStatusPill';`
b) 删除 16956 行 `const chatComposerStopTriggerClassName = ...`。
c) 在 `selectedChatPromptRunning` 声明附近追加显隐驱动（复用 menuExit 语义）：

```ts
  const [chatStopPillVisible, setChatStopPillVisible, chatStopPillExiting] = useMenuExitFlag();
  useEffect(() => {
    setChatStopPillVisible(selectedChatPromptRunning);
  }, [selectedChatPromptRunning, setChatStopPillVisible]);
```

（`useMenuExitFlag` 已在文件内 import；`selectedChatPromptRunning` 若为后声明的变量，把这段 effect 放在它之后。）

d) 18467-18482 的 stop-slot 整段：

```tsx
                  <div className="chat-composer-stop-slot">
                    {selectedChatPromptRunning ? (
                      <button ...>...</button>
                    ) : null}
                  </div>
```

替换为：

```tsx
                  {chatStopPillVisible ? (
                    <div className={`chat-composer-stop-slot${chatStopPillExiting ? ' sl-menu-exit' : ''}`}>
                      <ChatStopStatusPill
                        cancelling={selectedChatPromptCancelling}
                        onCancel={() => cancelSelectedChatPrompt().catch(() => undefined)}
                      />
                    </div>
                  ) : null}
```

- [ ] **Step 5: CSS** — `chat.css`：删除 3538-3596 全部 `.chat-composer-stop-trigger` 规则与 `@keyframes chatStopBreath`（含其 reduced-motion 媒体块），替换为：

```css
.chat-composer-stop-slot {
  display: flex;
  align-items: center;
  min-width: 0;
}

.chat-stop-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 84%, transparent);
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition:
    color var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard),
    background var(--motion-fast) var(--ease-standard);
}

.chat-stop-pill:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: color-mix(in srgb, var(--state-danger) 46%, var(--border-subtle));
  background: color-mix(in srgb, var(--state-danger) 8%, transparent);
}

.chat-stop-pill.cancelling {
  cursor: default;
  opacity: 0.72;
}

.chat-stop-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--state-danger);
  animation: chat-stop-pill-pulse 1.6s var(--ease-standard) infinite;
}

.chat-stop-pill.cancelling .chat-stop-pill-dot {
  animation: none;
  opacity: 0.6;
}

.chat-stop-pill-glyph {
  color: var(--text-tertiary);
}

.chat-stop-pill:hover:not(:disabled) .chat-stop-pill-glyph {
  color: var(--state-danger);
}

@keyframes chat-stop-pill-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-stop-pill-dot {
    animation: none;
  }
}
```

旧的 `.chat-composer-stop-slot` 规则（4219-4226 附近）如与新块冲突则删除旧块，保留一份。

- [ ] **Step 6: 跑测试 + 类型检查**

Run: `cd app && npx jest web/src/chat/composer/ChatStopStatusPill.test.tsx && npm run tsc:web`
Expected: PASS + 无类型错误

- [ ] **Step 7: Commit**

```bash
git add app/web/src/chat/composer/ChatStopStatusPill.tsx app/web/src/chat/composer/ChatStopStatusPill.test.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css
git commit -m "feat(app): replace composer stop button with compact status pill"
```

---

### Task 5: 统一 composer 菜单状态（互斥收口）

**Files:**
- Create: `app/web/src/chat/composer/chatComposerMenu.ts`
- Create: `app/web/src/chat/composer/useChatComposerMenu.ts`
- Test: `app/web/src/chat/composer/useChatComposerMenu.test.tsx`（新模块，同目录）
- Modify: `app/web/src/app/WorkspaceApp.tsx`（2823-2825、3376-3395、17995 className）
- Modify: `app/web/src/shell/state/workspaceUiState.ts`（移除 chatConfigOverflowOpen 字段与 action）
- Test: `app/__tests__/web-chat-inline-composer-wiring.test.ts`（追加互斥源码断言）

设计要点：单一 union state 是唯一事实来源；**原 7 个 setter 名字保留**、改为委托 wrapper（调用方零改动）；setter 传 `false`/`null` 时走 menuExit 退场（Task 6 挂动画），传打开值时自动互斥其他菜单。`chatConfigOverflowOpen` 从 workspaceUiState reducer 迁出。

- [ ] **Step 1: 写失败测试** `app/web/src/chat/composer/useChatComposerMenu.test.tsx`

```tsx
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {MENU_EXIT_MS} from '../sessionlist/menuExit';
import type {ChatComposerMenuState} from './chatComposerMenu';
import {useChatComposerMenu, type ChatComposerMenuSetter} from './useChatComposerMenu';

function mockMatchMedia(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

type ProbeHandle = {
  menu: ChatComposerMenuState;
  exiting: boolean;
  setMenu: ChatComposerMenuSetter;
};

function Probe({handle}: {handle: ProbeHandle}) {
  const [menu, setMenu, exiting] = useChatComposerMenu();
  handle.menu = menu;
  handle.exiting = exiting;
  handle.setMenu = setMenu;
  return null;
}

async function renderProbe(): Promise<ProbeHandle> {
  const handle: ProbeHandle = {menu: {id: 'none'}, exiting: false, setMenu: () => undefined};
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(<Probe handle={handle} />);
  });
  expect(tree).toBeDefined();
  return handle;
}

describe('useChatComposerMenu', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMatchMedia(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps at most one menu open', async () => {
    const handle = await renderProbe();
    await act(async () => {
      handle.setMenu({id: 'slash'});
    });
    expect(handle.menu).toEqual({id: 'slash'});

    await act(async () => {
      handle.setMenu({id: 'file-mention'});
    });
    expect(handle.menu).toEqual({id: 'file-mention'});
    expect(handle.exiting).toBe(false); // switch is immediate, no exit for the previous menu
  });

  it('delays close until the exit animation finishes', async () => {
    const handle = await renderProbe();
    await act(async () => {
      handle.setMenu({id: 'slash'});
    });
    await act(async () => {
      handle.setMenu(null);
    });
    expect(handle.menu).toEqual({id: 'slash'}); // still mounted during exit
    expect(handle.exiting).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(MENU_EXIT_MS);
    });
    expect(handle.menu).toEqual({id: 'none'});
    expect(handle.exiting).toBe(false);
  });

  it('closes immediately under reduced motion', async () => {
    mockMatchMedia(true);
    const handle = await renderProbe();
    await act(async () => {
      handle.setMenu({id: 'slash'});
    });
    await act(async () => {
      handle.setMenu(null);
    });
    expect(handle.menu).toEqual({id: 'none'});
    expect(handle.exiting).toBe(false);
  });

  it('reopening the same menu during its exit cancels the exit', async () => {
    const handle = await renderProbe();
    await act(async () => {
      handle.setMenu({id: 'context-usage'});
    });
    await act(async () => {
      handle.setMenu(null);
    });
    expect(handle.exiting).toBe(true);

    await act(async () => {
      handle.setMenu({id: 'context-usage'});
    });
    expect(handle.exiting).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(MENU_EXIT_MS * 5);
    });
    expect(handle.menu).toEqual({id: 'context-usage'}); // survived
  });

  it('tracks config-value optionId and treats id-only equality per variant', async () => {
    const handle = await renderProbe();
    await act(async () => {
      handle.setMenu({id: 'config-value', optionId: 'model'});
    });
    expect(handle.menu).toEqual({id: 'config-value', optionId: 'model'});

    await act(async () => {
      handle.setMenu({id: 'config-value', optionId: 'effort'});
    });
    expect(handle.menu).toEqual({id: 'config-value', optionId: 'effort'});

    await act(async () => {
      handle.setMenu(current => (current.id === 'none' ? {id: 'slash'} : null));
    });
    expect(handle.exiting).toBe(true); // functional close
  });

  it('ignores close when nothing is open', async () => {
    const handle = await renderProbe();
    await act(async () => {
      handle.setMenu(null);
    });
    expect(handle.menu).toEqual({id: 'none'});
    expect(handle.exiting).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx jest web/src/chat/composer/useChatComposerMenu.test.tsx`
Expected: FAIL（module 不存在）

- [ ] **Step 3: 实现两个模块**

`app/web/src/chat/composer/chatComposerMenu.ts`：

```ts
export type ChatComposerMenuId =
  | 'slash'
  | 'file-mention'
  | 'attachment-tray'
  | 'context-usage'
  | 'core-config'
  | 'config-overflow'
  | 'config-value';

export type ChatComposerMenuState =
  | {id: 'none'}
  | {id: Exclude<ChatComposerMenuId, 'config-value'>}
  | {id: 'config-value'; optionId: string};

export const CHAT_COMPOSER_MENU_NONE: ChatComposerMenuState = {id: 'none'};

export function chatComposerMenuEquals(a: ChatComposerMenuState, b: ChatComposerMenuState): boolean {
  if (a.id !== b.id) {
    return false;
  }
  if (a.id === 'config-value' && b.id === 'config-value') {
    return a.optionId === b.optionId;
  }
  return true;
}
```

`app/web/src/chat/composer/useChatComposerMenu.ts`：

```ts
import {useCallback, useEffect, useRef, useState} from 'react';
import {MENU_EXIT_MS} from '../sessionlist/menuExit';
import {
  CHAT_COMPOSER_MENU_NONE,
  chatComposerMenuEquals,
  type ChatComposerMenuState,
} from './chatComposerMenu';

export type ChatComposerMenuSetter = (
  next: ChatComposerMenuState | null | ((current: ChatComposerMenuState) => ChatComposerMenuState | null),
) => void;

/**
 * Single source of truth for composer popups: at most one menu is open.
 * Setting null (or {id:'none'}) plays the CSS exit animation first
 * (`.sl-menu-exit` via the returned `exiting` flag) and only clears state
 * after MENU_EXIT_MS; setting a menu cancels any in-flight exit.
 */
export function useChatComposerMenu() {
  const [menu, setMenuRaw] = useState<ChatComposerMenuState>(CHAT_COMPOSER_MENU_NONE);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<number | null>(null);

  const cancelExit = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setExiting(false);
  }, []);

  useEffect(() => cancelExit, [cancelExit]);

  const setMenu = useCallback<ChatComposerMenuSetter>(
    next => {
      const resolved =
        (typeof next === 'function' ? next(menuRef.current) : next) ?? CHAT_COMPOSER_MENU_NONE;
      if (resolved.id !== 'none') {
        cancelExit();
        if (!chatComposerMenuEquals(resolved, menuRef.current)) {
          setMenuRaw(resolved);
        }
        return;
      }
      if (menuRef.current.id === 'none') {
        return;
      }
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setMenuRaw(CHAT_COMPOSER_MENU_NONE);
        return;
      }
      if (timerRef.current !== null) {
        return; // exit already in flight
      }
      setExiting(true);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setExiting(false);
        setMenuRaw(CHAT_COMPOSER_MENU_NONE);
      }, MENU_EXIT_MS);
    },
    [cancelExit],
  );

  return [menu, setMenu, exiting] as const;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && npx jest web/src/chat/composer/useChatComposerMenu.test.tsx`
Expected: PASS（6 tests）

- [ ] **Step 5: WorkspaceApp 接线 — 声明替换**

a) import 追加：

```ts
import {useChatComposerMenu} from '../chat/composer/useChatComposerMenu';
```

b) 3376-3395 的七个 useState 声明块：

```ts
  const [chatPromptMenuOpen, setChatPromptMenuOpen] = useState(false);
  const [chatFileMentionMenuOpen, setChatFileMentionMenuOpen] = useState(false);
  ...（中间 file-mention 结果集等保持不变）...
  const [chatAttachmentTrayOpen, setChatAttachmentTrayOpen] = useState(false);
  const [chatContextUsageOpen, setChatContextUsageOpen] = useState(false);
  const [chatContextUsagePopoverStyle, setChatContextUsagePopoverStyle] = useState<React.CSSProperties>({});
  const [chatCoreConfigMenuOpen, setChatCoreConfigMenuOpen] = useState(false);
  const [chatConfigMenuOptionId, setChatConfigMenuOptionId] = useState('');
  const closeChatCoreConfigMenu = useCallback((restoreFocus = false) => {
    setChatCoreConfigMenuOpen(false);
    setChatConfigOverflowOpen(false);
    if (restoreFocus) {
      chatCoreConfigTriggerRef.current?.focus();
    }
  }, [setChatConfigOverflowOpen]);
```

替换为（`chatFileMentionResults` 等中间声明原样保留，此处只列被替换的行）：

```ts
  const [chatComposerMenu, setChatComposerMenu, chatComposerMenuExiting] = useChatComposerMenu();
  const chatPromptMenuOpen = chatComposerMenu.id === 'slash';
  const chatFileMentionMenuOpen = chatComposerMenu.id === 'file-mention';
  const chatAttachmentTrayOpen = chatComposerMenu.id === 'attachment-tray';
  const chatContextUsageOpen = chatComposerMenu.id === 'context-usage';
  const chatCoreConfigMenuOpen = chatComposerMenu.id === 'core-config';
  const chatConfigOverflowOpen = chatComposerMenu.id === 'config-overflow';
  const chatConfigMenuOptionId = chatComposerMenu.id === 'config-value' ? chatComposerMenu.optionId : '';
  const setChatPromptMenuOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setChatComposerMenu(current => ((typeof next === 'function' ? next(current.id === 'slash') : next) ? {id: 'slash'} : null));
  }, [setChatComposerMenu]);
  const setChatFileMentionMenuOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setChatComposerMenu(current => ((typeof next === 'function' ? next(current.id === 'file-mention') : next) ? {id: 'file-mention'} : null));
  }, [setChatComposerMenu]);
  const setChatAttachmentTrayOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setChatComposerMenu(current => ((typeof next === 'function' ? next(current.id === 'attachment-tray') : next) ? {id: 'attachment-tray'} : null));
  }, [setChatComposerMenu]);
  const setChatContextUsageOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setChatComposerMenu(current => ((typeof next === 'function' ? next(current.id === 'context-usage') : next) ? {id: 'context-usage'} : null));
  }, [setChatComposerMenu]);
  const setChatCoreConfigMenuOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setChatComposerMenu(current => ((typeof next === 'function' ? next(current.id === 'core-config') : next) ? {id: 'core-config'} : null));
  }, [setChatComposerMenu]);
  const setChatConfigMenuOptionId = useCallback((next: string | ((id: string) => string)) => {
    setChatComposerMenu(current => {
      const previous = current.id === 'config-value' ? current.optionId : '';
      const resolved = typeof next === 'function' ? next(previous) : next;
      return resolved ? {id: 'config-value', optionId: resolved} : null;
    });
  }, [setChatComposerMenu]);
  const closeChatCoreConfigMenu = useCallback((restoreFocus = false) => {
    setChatComposerMenu(null);
    if (restoreFocus) {
      chatCoreConfigTriggerRef.current?.focus();
    }
  }, [setChatComposerMenu]);
```

注意：`chatConfigMenuOptionId` 原来是 `useState('')`，部分调用点传函数式 `current => (current === option.id ? '' : option.id)` — wrapper 的函数签名兼容。`setChatPromptMenuOpen(false)` 这类调用点在菜单未打开时由 hook 内部 no-op，不会误触发退场。

c) 2823-2825 的 reducer wrapper 替换为本地 wrapper：

```ts
  const setChatConfigOverflowOpen = useCallback((next: WorkspaceUiStateValue<boolean>) => {
    setChatComposerMenu(current => ((typeof next === 'function' ? next(current.id === 'config-overflow') : next) ? {id: 'config-overflow'} : null));
  }, [setChatComposerMenu]);
```

同时删除 2738 行 `const chatConfigOverflowOpen = workspaceUiState.mobile.chatConfigOverflowOpen;`（派生值已在 b 步声明）。注意声明顺序：b 的块在 3376 附近、先于所有使用点；c 在 2823 — 若 b 在 c 之后声明会导致 TDZ，把 b 整块放在 2823 之前（即 `workspaceUiState` 声明之后、所有 wrapper 之前）。

d) 17995 className：

```tsx
            className={`chat-composer${selectedActivePermission ? ' permission-open' : ''}${chatCoreConfigMenuOpen || chatConfigMenuOptionId || chatConfigOverflowOpen || chatContextUsageOpen ? ' config-menu-open' : ''}${chatSlashMenuVisible || chatFileMentionMenuOpen ? ' trigger-menu-open' : ''}`}
```

改为：

```tsx
            className={`chat-composer${selectedActivePermission ? ' permission-open' : ''}${chatComposerMenu.id !== 'none' ? ' menu-open' : ''}`}
```

e) `chatSlashMenuVisible`（3790）简化为：

```ts
  const chatSlashMenuVisible = chatPromptMenuOpen && chatSlashMenuOptions.length > 0;
```

- [ ] **Step 6: workspaceUiState.ts 移除 overflow 字段**

删除：`44` 行 `chatConfigOverflowOpen: boolean;`、`67` 行 `chatConfigOverflowOpen?: unknown;`、`174-176` 初始化分支、`302-303` `mobile/setChatConfigOverflowOpen` action case、`345` 重置行。若该文件有对应测试（grep `chatConfigOverflowOpen app/__tests__ app/web/src --include=*.test.*`），同步删除相关断言。

- [ ] **Step 7: 追加互斥源码断言** — `app/__tests__/web-chat-inline-composer-wiring.test.ts` 末尾加 describe：

```ts
describe('composer menu exclusivity', () => {
  test('all composer popups share one menu state', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('const [chatComposerMenu, setChatComposerMenu, chatComposerMenuExiting] = useChatComposerMenu();');
    expect(mainTsx).toContain("const chatPromptMenuOpen = chatComposerMenu.id === 'slash';");
    expect(mainTsx).toContain("const chatFileMentionMenuOpen = chatComposerMenu.id === 'file-mention';");
    expect(mainTsx).toContain("const chatAttachmentTrayOpen = chatComposerMenu.id === 'attachment-tray';");
    expect(mainTsx).toContain("const chatContextUsageOpen = chatComposerMenu.id === 'context-usage';");
    expect(mainTsx).toContain("const chatCoreConfigMenuOpen = chatComposerMenu.id === 'core-config';");
    expect(mainTsx).toContain("const chatConfigOverflowOpen = chatComposerMenu.id === 'config-overflow';");
    expect(mainTsx).not.toContain('const [chatPromptMenuOpen, setChatPromptMenuOpen] = useState(false);');
    expect(mainTsx).not.toContain('const [chatCoreConfigMenuOpen, setChatCoreConfigMenuOpen] = useState(false);');
    expect(mainTsx).not.toContain('workspaceUiState.mobile.chatConfigOverflowOpen');
  });
});
```

- [ ] **Step 8: 全量相关测试 + 类型检查**

Run: `cd app && npx jest web/src/chat/composer __tests__/web-chat-inline-composer-wiring.test.ts && npm run tsc:web`
Expected: PASS + 无类型错误

- [ ] **Step 9: Commit**

```bash
git add app/web/src/chat/composer/chatComposerMenu.ts app/web/src/chat/composer/useChatComposerMenu.ts app/web/src/chat/composer/useChatComposerMenu.test.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/shell/state/workspaceUiState.ts app/__tests__/web-chat-inline-composer-wiring.test.ts
git commit -m "feat(app): unify composer popup state with mutual exclusion and exit semantics"
```

---

### Task 6: 弹层进退场动画接线

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（7 个弹层根节点 className）
- Modify: `app/web/src/styles/chat.css`（弹层入场动画 + menu-open z-index）
- Test: `app/__tests__/web-chat-inline-composer-wiring.test.ts`（追加动画断言）

依赖 Task 5 的 `chatComposerMenuExiting`。进出场 keyframes 复用全局 `sl-menu-in` / `sl-menu-out`（sessionlist.css:301-315，`.sl-menu-exit` 自带 `pointer-events: none`，退场期间不可交互）。

- [ ] **Step 1: 追加测试断言** — `web-chat-inline-composer-wiring.test.ts` 的 `composer menu exclusivity` describe 里加：

```ts
  test('every composer popup renders with exit flag and entrance animation', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    for (const cls of [
      'chat-slash-menu',
      'chat-file-mention-menu',
      'chat-core-config-menu',
      'chat-config-value-menu',
      'chat-config-overflow-menu',
      'chat-context-usage-popover',
      'chat-attachment-action-tray',
    ]) {
      expect(mainTsx).toContain(`\${chatComposerMenuExiting ? ' sl-menu-exit' : ''}`);
      expect(stylesCss).toContain(`.${cls}`);
    }
    expect(stylesCss).toMatch(/\.chat-slash-menu,\s*\n\.chat-file-mention-menu,\s*\n\.chat-core-config-menu,\s*\n\.chat-config-value-menu,\s*\n\.chat-config-overflow-menu,\s*\n\.chat-context-usage-popover,\s*\n\.chat-attachment-action-tray \{[\s\S]*animation: sl-menu-in 140ms var\(--ease-out\);[\s\S]*\}/);
    expect(stylesCss).toContain('.chat-composer.menu-open');
    expect(stylesCss).not.toContain('.chat-composer.config-menu-open');
    expect(stylesCss).not.toContain('.chat-composer.trigger-menu-open');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx jest __tests__/web-chat-inline-composer-wiring.test.ts`
Expected: FAIL

- [ ] **Step 3: JSX 挂退场标记** — 7 个弹层根节点 className 各加 `${chatComposerMenuExiting ? ' sl-menu-exit' : ''}`：

| 弹层 | 位置（约） | 改法 |
|---|---|---|
| `chat-file-mention-menu` | 18333 | `className={\`chat-file-mention-menu${chatComposerMenuExiting ? ' sl-menu-exit' : ''}\`}` |
| `chat-slash-menu` | 18383 | 同上模式 |
| `chat-attachment-action-tray` | 18486 | 同上模式 |
| `chat-context-usage-popover` | 17638 | 同上模式（保留原有 static class） |
| `chat-core-config-menu` | 17702 | 同上模式 |
| `chat-config-value-menu` | `renderChatConfigValueMenu` 内 | 同上模式 |
| `chat-config-overflow-menu` | overflow 渲染处（17706 分支或独立函数） | 同上模式 |

- [ ] **Step 4: CSS** — `chat.css`：

a) 删除 `.chat-composer.config-menu-open`（3487-3489）与 `.chat-composer.trigger-menu-open`（3491-3493），替换为：

```css
.chat-composer.menu-open {
  z-index: 32;
}
```

b) 3495-3500 的 `.chat-composer.config-menu-open .chat-composer-frame` 选择器改为 `.chat-composer.menu-open .chat-composer-frame`（规则内容不变）；5720+ 段里同名补丁同样改名（Task 9 合并该段，此处仅改选择器名）。

c) 新增统一入场动画：

```css
.chat-slash-menu,
.chat-file-mention-menu,
.chat-core-config-menu,
.chat-config-value-menu,
.chat-config-overflow-menu,
.chat-context-usage-popover,
.chat-attachment-action-tray {
  transform-origin: bottom center;
  animation: sl-menu-in 140ms var(--ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .chat-slash-menu,
  .chat-file-mention-menu,
  .chat-core-config-menu,
  .chat-config-value-menu,
  .chat-config-overflow-menu,
  .chat-context-usage-popover,
  .chat-attachment-action-tray {
    animation: none;
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd app && npx jest __tests__/web-chat-inline-composer-wiring.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-inline-composer-wiring.test.ts
git commit -m "feat(app): animate composer popup enter and exit"
```

---

### Task 7: slash 菜单分组渲染 + 去 `/` 前缀

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（18382-18414 slash 菜单 JSX）
- Modify: `app/web/src/styles/chat.css`（新增 section header 样式）
- Test: `app/__tests__/web-chat-inline-composer-wiring.test.ts`（追加断言）

依赖 Task 2 的 `groupChatSlashMenuOptions` / `chatSlashOptionDisplayName`。键盘导航保持扁平索引（`chatSlashActiveIndex` 作用于 `chatSlashMenuOptions`），分组头只做视觉分隔、不可交互。

- [ ] **Step 1: 追加测试断言**

```ts
  test('slash menu renders grouped sections with display names without slash prefix', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('groupChatSlashMenuOptions(chatSlashMenuOptions)');
    expect(mainTsx).toContain('chat-slash-section');
    expect(mainTsx).toContain('chatSlashOptionDisplayName(option.name)');
    expect(mainTsx).not.toContain('<span className="chat-slash-name">{option.name}</span>');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx jest __tests__/web-chat-inline-composer-wiring.test.ts -t "slash menu renders grouped"`
Expected: FAIL

- [ ] **Step 3: 实现** — import 追加 `groupChatSlashMenuOptions, chatSlashOptionDisplayName`（来自 `../chat/session/chatSessionActions`，已存在的 import 上合并），并追加 `import {ChatIcon} from '../chat/ChatIcon';`（Task 10 的其他替换点复用同一 import）。18382-18414 整段替换为：

```tsx
              {chatSlashMenuVisible ? (
                <div ref={chatSlashMenuRef} className={`chat-slash-menu${chatComposerMenuExiting ? ' sl-menu-exit' : ''}`} role="listbox" aria-label="Available commands and skills">
                  {(() => {
                    let flatIndex = -1;
                    return groupChatSlashMenuOptions(chatSlashMenuOptions).map(section => (
                      <div key={section.id} className="chat-slash-section" role="group" aria-label={section.title}>
                        <div className="chat-slash-section-header">{section.title}</div>
                        {section.options.map(option => {
                          flatIndex += 1;
                          const index = flatIndex;
                          const selected = index === chatSlashActiveIndex;
                          return (
                            <button
                              key={option.name}
                              type="button"
                              className={`chat-slash-item ${option.kind}${selected ? ' active' : ''}${option.enabled ? '' : ' disabled'}`}
                              role="option"
                              aria-selected={selected}
                              aria-disabled={!option.enabled}
                              disabled={!option.enabled}
                              title={option.enabled ? option.description : option.disabledReason}
                              onMouseEnter={() => setChatSlashActiveIndex(index)}
                              onMouseDown={event => event.preventDefault()}
                              onClick={() => applyChatSlashCommand(option)}
                            >
                              <ChatIcon name={option.icon} size={16} className="chat-slash-icon" />
                              <span className="chat-slash-name">{chatSlashOptionDisplayName(option.name)}</span>
                              {option.description || option.disabledReason ? (
                                <span className="chat-slash-description">{option.enabled ? option.description : option.disabledReason}</span>
                              ) : null}
                              {option.checked !== undefined ? (
                                <span className={`chat-slash-switch${option.checked ? ' checked' : ''}`} aria-hidden="true">
                                  <span className="chat-slash-switch-knob" />
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    ));
                  })()}
                </div>
              ) : null}
```

（图标换 ChatIcon 属于 Task 10，这里一并落地以免二次改同一行。）

- [ ] **Step 4: CSS** — `chat.css` slash 菜单段新增：

```css
.chat-slash-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chat-slash-section + .chat-slash-section {
  margin-top: 2px;
  padding-top: 4px;
  border-top: 1px solid var(--border-faint);
}

.chat-slash-section-header {
  padding: 4px 10px 2px;
  color: var(--text-tertiary);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.2;
  user-select: none;
}
```

`.chat-slash-icon` 规则（3784-3793）保留，svg 版图标继承同样颜色；删除其中 `text-align: center` 等仅对字体图标有意义的属性无必要则保留不动。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd app && npx jest __tests__/web-chat-inline-composer-wiring.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-inline-composer-wiring.test.ts
git commit -m "feat(app): group slash menu into sections and drop slash prefix in rows"
```

---

### Task 8: 菜单几何统一 + kbd footer + preview hover-only

**Files:**
- Create: `app/web/src/chat/composer/ChatMenuKeyHints.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`（slash / file-mention 菜单 footer、删 shortcut tip）
- Modify: `app/web/src/styles/chat.css`（slash 菜单布局、footer 样式、preview 按钮可见性）
- Modify: `app/web/src/styles/file.css`（file-mention 菜单布局段迁出/删除）
- Test: `app/web/src/chat/composer/ChatMenuKeyHints.test.tsx`（新模块）+ `app/__tests__/web-chat-inline-composer-wiring.test.ts`（几何断言）

统一目标几何：两菜单 `left: 0; right: 0; bottom: calc(100% + 8px)`、圆角 8px、padding 4px、行高 min 34px、`max-height: min(42vh, 280px)`、gap 2px。材质（背景/边框/阴影/blur）只由 5290+ 瞬态弹层统一块输出，base 规则里删除重复定义。

- [ ] **Step 1: 写失败测试** `app/web/src/chat/composer/ChatMenuKeyHints.test.tsx`

```tsx
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ChatMenuKeyHints} from './ChatMenuKeyHints';

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(element);
  });
  return tree!;
}

describe('ChatMenuKeyHints', () => {
  it('renders each hint as kbd + label', async () => {
    const tree = await render(
      <ChatMenuKeyHints hints={[['↑↓', 'Select'], ['↵', 'Apply'], ['esc', 'Close']]} />,
    );
    const kbds = tree.root.findAllByType('kbd');
    expect(kbds.map(kbd => kbd.children.join(''))).toEqual(['↑↓', '↵', 'esc']);
    const root = tree.root.findByProps({className: 'chat-menu-footer'});
    expect(root).toBeDefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx jest web/src/chat/composer/ChatMenuKeyHints.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现组件** `app/web/src/chat/composer/ChatMenuKeyHints.tsx`

```tsx
import React from 'react';

export type ChatMenuKeyHintsProps = {
  hints: [keys: string, label: string][];
};

export function ChatMenuKeyHints({hints}: ChatMenuKeyHintsProps) {
  return (
    <div className="chat-menu-footer" aria-hidden="true">
      {hints.map(([keys, label]) => (
        <span key={label} className="chat-menu-hint">
          <kbd>{keys}</kbd>
          {label}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: JSX 接线** — WorkspaceApp：

a) slash 菜单在最后一个 section 之后、闭合 `</div>` 之前加：

```tsx
                  <ChatMenuKeyHints hints={[['↑↓', 'Select'], ['↵', 'Apply'], ['esc', 'Close']]} />
```

b) file-mention 菜单：删除 18334 行 `<div className="chat-file-mention-shortcut-tip">Up/Down to browse, Right to preview</div>`，在菜单末尾（结果列表之后）加：

```tsx
                  <ChatMenuKeyHints hints={[['↑↓', 'Select'], ['→', 'Preview'], ['↵', 'Insert'], ['esc', 'Close']]} />
```

c) file-mention preview 按钮（18366-18375）className 保持，可见性交给 CSS（Step 6）。

- [ ] **Step 5: CSS 布局统一** — `chat.css`：

a) `.chat-slash-menu`（3731-3752）替换为布局-only：

```css
.chat-slash-menu {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  max-height: min(42vh, 280px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  overscroll-behavior: contain;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 84%, transparent);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  z-index: 36;
}
```

（背景/阴影/blur 由 5290+ 统一块输出；border 保留与统一块一致的 84% 定义，避免双层边框。）

b) 新增 footer 样式：

```css
.chat-menu-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 2px;
  padding: 5px 10px 3px;
  border-top: 1px solid var(--border-faint);
  color: var(--text-tertiary);
  font-size: 10px;
  line-height: 1.4;
  user-select: none;
}

.chat-menu-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.chat-menu-hint kbd {
  font-family: inherit;
  font-size: 10px;
  line-height: 1.2;
  padding: 1px 4px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: var(--surface-raised);
  color: var(--text-secondary);
}
```

c) preview 按钮可见性（`.chat-file-mention-preview-button` 规则上追加）：

```css
.chat-file-mention-preview-button {
  opacity: 0;
  transition: opacity var(--motion-fast) var(--ease-standard);
}

.chat-file-mention-option:hover .chat-file-mention-preview-button,
.chat-file-mention-option.active .chat-file-mention-preview-button,
.chat-file-mention-preview-button:focus-visible {
  opacity: 1;
}
```

键盘可达性：`active` 行（键盘导航行）常显，tab 到按钮本身 `focus-visible` 显。

- [ ] **Step 6: file.css 迁移** — `file.css:1057-1075` 的 `.chat-file-mention-menu` 块删除，等效布局-only 规则移到 `chat.css` 紧跟 `.chat-slash-menu` 之后：

```css
.chat-file-mention-menu {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  max-height: min(42vh, 280px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  overscroll-behavior: contain;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 84%, transparent);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  z-index: 36;
}
```

删除 `.chat-file-mention-shortcut-tip` 规则（file.css 1141-1154）。file-mention 其余行内样式（option/name/path/chip）保留在 file.css 不动。注意 file.css 的 `z-index: 37` 改为与 slash 相同的 36（同级互斥菜单不需要层级差）。

- [ ] **Step 7: 几何断言** — `web-chat-inline-composer-wiring.test.ts` 追加：

```ts
  test('slash and file-mention menus share the same geometry', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);

    for (const cls of ['.chat-slash-menu', '.chat-file-mention-menu']) {
      const start = stylesCss.indexOf(`${cls} {`);
      const end = stylesCss.indexOf('}', start);
      const rule = stylesCss.slice(start, end);
      expect(rule).toContain('left: 0;');
      expect(rule).toContain('right: 0;');
      expect(rule).toContain('bottom: calc(100% + 8px);');
      expect(rule).toContain('border-radius: 8px;');
      expect(rule).toContain('max-height: min(42vh, 280px);');
      expect(rule).not.toContain('background');
      expect(rule).not.toContain('backdrop-filter');
    }
    expect(stylesCss).not.toContain('chat-file-mention-shortcut-tip');
    expect(stylesCss).toContain('.chat-menu-footer');
  });
```

- [ ] **Step 8: 跑测试确认通过**

Run: `cd app && npx jest web/src/chat/composer __tests__/web-chat-inline-composer-wiring.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add app/web/src/chat/composer/ChatMenuKeyHints.tsx app/web/src/chat/composer/ChatMenuKeyHints.test.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/web/src/styles/file.css app/__tests__/web-chat-inline-composer-wiring.test.ts
git commit -m "feat(app): unify trigger menu geometry with kbd footer hints"
```

---

### Task 9: 材质/色彩收敛 + Lexical placeholder

**Files:**
- Modify: `app/web/src/styles/chat.css`（frame 材质 3513-3528、胶囊 3657-3712、补丁段 5720-5800、placeholder 3638-3655）
- Modify: `app/web/src/styles/tokens.css`（胶囊色彩 token）
- Modify: `app/web/src/chat/composer/ChatRichComposer.tsx`（placeholder 机制）
- Test: `app/__tests__/web-chat-inline-composer-wiring.test.ts`（材质/placeholder 断言）

- [ ] **Step 1: 追加测试断言**

```ts
  test('composer frame uses the shared floating panel material', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);

    const frameStart = stylesCss.indexOf('.chat-composer-frame {');
    const frameEnd = stylesCss.indexOf('}', frameStart);
    const frameRule = stylesCss.slice(frameStart, frameEnd);
    expect(frameRule).toContain('border-radius: 8px;');
    expect(frameRule).toContain('var(--shadow-floating)');
    expect(frameRule).toContain('inset 0 1px 0');
    expect(stylesCss).not.toContain('#79c0ff');
    expect(stylesCss).not.toContain('#1f6feb');
    expect(stylesCss).not.toContain('rgba(248, 81, 73');
    expect(stylesCss).not.toContain('chatStopBreath');
    expect(stylesCss).toContain('inset: var(--chat-composer-input-pad-block) var(--chat-composer-input-pad-inline) auto');
  });

  test('composer placeholder uses the Lexical placeholder slot', () => {
    const projectRoot = path.join(__dirname, '..');
    const composerTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'composer', 'ChatRichComposer.tsx'));

    expect(composerTsx).toContain('placeholder={');
    expect(composerTsx).not.toContain('placeholder={null}');
    expect(composerTsx).not.toContain('chat-rich-composer:not(:empty)');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx jest __tests__/web-chat-inline-composer-wiring.test.ts`
Expected: FAIL

- [ ] **Step 3: tokens.css 胶囊 token** — `:root` 与 `.theme-light` 各加（dark 值贴现状、light 给合理对照）：

```css
  --chat-capsule-skill-text: color-mix(in srgb, var(--accent-primary) 62%, var(--text-primary));
  --chat-capsule-skill-bg: color-mix(in srgb, var(--accent-primary) 12%, transparent);
```

（两主题同一定义即可 —— 全部派生自已有的 per-theme accent/text token，自动适配。只加一次到 `:root`，`.theme-light` 无需覆写。）

- [ ] **Step 4: frame 材质** — `chat.css` 3513-3523 替换为：

```css
.chat-composer-frame {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-panel) 88%, var(--surface-raised));
  box-shadow:
    var(--shadow-floating),
    inset 0 1px 0 color-mix(in srgb, var(--text-primary) 6%, transparent);
  padding: 8px 8px 4px;
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard),
    background var(--motion-fast) var(--ease-standard);
}
```

drag-over 规则（3525-3528）保留并追加文案配合（Task 11）。focus-within / menu-open 高亮：把 5720-5750 补丁段的 `.chat-composer:focus-within .chat-composer-frame` 与 `.chat-composer.menu-open .chat-composer-frame`（Task 6 已改名）两条规则**原样上移**到 3513 主规则之后，删除 5720-5750 补丁段；5783-5797 的移动端 media query 若只包含 composer 相关规则也一并上移，该补丁段整体清空后删除注释 `/* workspace-ui-targeted-evolution: composer */`。

- [ ] **Step 5: 胶囊色彩** — `.chat-composer-capsule.skill, .chat-prompt-inline-capsule.skill`（3672-3676）替换为：

```css
.chat-composer-capsule.skill,
.chat-prompt-inline-capsule.skill {
  color: var(--chat-capsule-skill-text);
  background: var(--chat-capsule-skill-bg);
}
```

- [ ] **Step 6: Lexical placeholder** — `ChatRichComposer.tsx`：

a) PlainTextPlugin 的 `placeholder={null}` 改为：

```tsx
        placeholder={
          <div className="chat-rich-composer-placeholder" aria-hidden="true">
            {placeholder}
          </div>
        }
```

b) 删除组件尾部 467-469 的手写 `<span className="chat-rich-composer-placeholder">` 块。

c) `chat.css`：删除 `.chat-rich-composer:not(:empty) + .chat-rich-composer-placeholder` 规则（3653-3655）；placeholder 规则（3638-3651）替换为（定位值全部来自共享 pad 变量，无手写坐标）：

```css
.chat-composer-input-shell {
  --chat-composer-input-pad-block: 5px;
  --chat-composer-input-pad-inline: 8px;
}

.chat-composer-input {
  padding: var(--chat-composer-input-pad-block) var(--chat-composer-input-pad-inline) 2px;
}

.chat-rich-composer-placeholder {
  position: absolute;
  inset: var(--chat-composer-input-pad-block) var(--chat-composer-input-pad-inline) auto;
  z-index: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1.4;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
}
```

`.chat-composer-input` 原 `padding: 5px 8px 2px;` 行删除（并入上方变量写法，其余属性保持）。`.chat-composer-input-shell` 已有定位与 flex 属性，变量声明并入原规则而非新建。

- [ ] **Step 7: 跑测试确认通过**

Run: `cd app && npx jest __tests__/web-chat-inline-composer-wiring.test.ts web/src/chat/composer`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/web/src/styles/chat.css app/web/src/styles/tokens.css app/web/src/chat/composer/ChatRichComposer.tsx app/__tests__/web-chat-inline-composer-wiring.test.ts
git commit -m "feat(app): converge composer material and capsule colors to tokens"
```

---

### Task 10: chat 模块 codicon 清扫（JSX 渲染侧）

**Files:**
- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Modify: `app/web/src/chat/ChatToolCallGroup.tsx`
- Modify: `app/web/src/chat/ChatFileLinkContextMenu.tsx`
- Modify: `app/web/src/chat/permission/ChatPermissionDialog.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`（thinking 848-880、peek viewer 2130-2470、file-link 16415、config 菜单 17568/17697/17738/17784/17808、scroll-bottom 18026、composer 段 18093-18525）
- Modify: `app/web/src/features/speech/VoiceInputButton.tsx`（mic/send 两个）
- Test: `app/__tests__/web-chat-inline-composer-wiring.test.ts`（追加 rg 等价断言）、`app/__tests__/web-chat-file-link-context-menu.test.tsx`（更新 codicon 断言）

映射见计划头部映射表。统一替换模式：`<span className="codicon codicon-xxx" />` → `<ChatIcon name="yyy" size={14} />`；带修饰类时保留原 className 追加（如 `className="chat-slash-icon"`）；`codicon-loading codicon-modifier-spin` → `<ChatIcon name="loader" spin />`。

- [ ] **Step 1: 追加守卫断言** — `web-chat-inline-composer-wiring.test.ts` 追加（源码级 rg 等价）：

```ts
  test('chat module no longer references codicon classes', () => {
    const projectRoot = path.join(__dirname, '..');
    const chatDir = path.join(projectRoot, 'web', 'src', 'chat');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.tsx')) {
          if (readSourceText(full).includes('codicon')) {
            offenders.push(full);
          }
        }
      }
    };
    walk(chatDir);
    expect(offenders).toEqual([]);

    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const composerStart = mainTsx.indexOf('className={`chat-composer');
    const composerEnd = mainTsx.indexOf('</ChatSurface>', composerStart);
    expect(mainTsx.slice(composerStart, composerEnd)).not.toContain('codicon');

    const voiceTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'features', 'speech', 'VoiceInputButton.tsx'));
    expect(voiceTsx).not.toContain('codicon');
  });
```

注意：`ChatIcon.tsx` 注释里也不写 `codicon` 字样（本任务实现时规避）；`menuExit.ts` 等非图标文件本就无 codicon。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx jest __tests__/web-chat-inline-composer-wiring.test.ts -t "codicon"`
Expected: FAIL（offenders 列表非空）

- [ ] **Step 3: ChatToolCallGroup.tsx** — `toolStatusIcon` 返回 icon 名而非 class 字符串：

```ts
function toolStatusIcon(status: string): ChatIconName {
  if (status === 'running' || status === 'pending') return 'loader';
  if (status === 'failed') return 'circleX';
  if (status === 'completed') return 'circleCheck';
  return 'wrench';
}
```

渲染处：`86` 行 `<span className="codicon codicon-chevron-right chat-tool-group-chevron" />` → `<ChatIcon name="chevronRight" className="chat-tool-group-chevron" />`；`87` 行 tools → `<ChatIcon name="wrench" className="chat-tool-group-summary-icon" />`；`104` 行状态图标 → `<ChatIcon name={toolStatusIcon(call.status)} spin={call.status === 'running' || call.status === 'pending'} className={\`chat-tool-group-status ${toolStatusClass(call.status)}\`} />`。（spin 条件与 `toolStatusClass` 对齐；`codicon-modifier-spin` 的旋转由 `sl-icon-spin` 承担。）

- [ ] **Step 4: ChatTurnView.tsx** — 逐点替换：

| 行（约） | 现状 | 替换 |
|---|---|---|
| 73-79 | `sessionOperationView` 返回 codicon 字符串 | 返回 `ChatIconName`：queued→`circle`、completed→`circleCheck`、failed→`circleX`、默认→`loader`；`icon` 字段类型改 `ChatIconName` |
| 180 | thought chevron | `<ChatIcon name="chevronRight" className="chat-thought-chevron" />` |
| 181 | lightbulb | `<ChatIcon name="lightbulb" className="chat-thought-icon" />` |
| 335 | 附件图标三元 | `<ChatIcon name={imageAttachment ? 'image' : 'file'} className="chat-prompt-attachment-icon" />` |
| 404 | question | `<ChatIcon name="help" className="chat-permission-history-icon" />` |
| 415 | operation.icon | `<ChatIcon name={operation.icon} spin={operation.status === 'started'} className="chat-session-operation-icon" />` |
| 449 | sync | `<ChatIcon name="refreshCw" />` |
| 541 | loading/diff 三元 | `<ChatIcon name={loading ? 'loader' : 'fileDiff'} spin={loading} />` |
| 596-600 | loading / debug-stop / unmute 三元 | `<ChatIcon name={...} />` 依次为 `loader`+spin、`square`、`volume2`（保持原条件逻辑，只换渲染） |
| 611 | copy | `<ChatIcon name="copy" />` |
| 622 | device-camera | `<ChatIcon name="camera" />` |
| 633 | file-code | `<ChatIcon name="fileCode" />` |
| 744 | check | `<ChatIcon name="check" />` |

import 加 `import {ChatIcon, type ChatIconName} from './ChatIcon';`。

- [ ] **Step 5: ChatFileLinkContextMenu.tsx** — `item()` 的 icon 参数从 codicon class 改为 `ChatIconName`；64 行渲染 → `<ChatIcon name={icon} />`；映射：`vscode`→`code`、`folder`→`folderOpen`、`export-html`→`share`、`copy-relative`→`copy`、`copy-absolute`→`clipboard`。更新 `web-chat-file-link-context-menu.test.tsx` 中 codicon 断言为新 icon 名（先跑该测试看失败点再改断言）。

- [ ] **Step 6: ChatPermissionDialog.tsx** — 35 行 question → `<ChatIcon name="help" />`；53 行 loading → `<ChatIcon name="loader" spin />`；55 行 chevron-right → `<ChatIcon name="chevronRight" />`。

- [ ] **Step 7: WorkspaceApp.tsx** — 逐点：

| 行（约） | 现状 | 替换 |
|---|---|---|
| 856 | thinking sparkle | `<ChatIcon name="sparkles" className="thinking-icon" />` |
| 871 | thinking chevron 三元 | `<ChatIcon name={expanded ? 'chevronUp' : 'chevronDown'} className="thinking-chevron" />` |
| 2142 | files（peek 空态） | `<ChatIcon name="files" />` |
| 2151/2307/2324/2434 | error | `<ChatIcon name="circleX" />` |
| 2256 | arrow-left/close | `<ChatIcon name={mode === 'mobile' ? 'arrowLeft' : 'x'} />` |
| 2261 | layout-sidebar-right | `<ChatIcon name="panelRight" />` |
| 2371 | file | `<ChatIcon name="file" />` |
| 2444 | diff | `<ChatIcon name="fileDiff" />` |
| 2464 | chevron 三元 | `<ChatIcon name={file.expanded ? 'chevronDown' : 'chevronRight'} />` |
| 16415 | file-link file | `<ChatIcon name="file" className="chat-file-link-icon" />` |
| 17568/17738 | check | `<ChatIcon name="check" />` |
| 17697 | zap | `<ChatIcon name="zap" className="chat-core-config-fast" />` |
| 17784 | check 带 visible 类 | `<ChatIcon name="check" className={\`chat-core-config-check${selected ? ' visible' : ''}\`} />` |
| 17808 | chevron-right | `<ChatIcon name="chevronRight" />` |
| 18026 | scroll-bottom arrow-down | `<ChatIcon name="arrowDown" />` |
| 18093 | 附件 file | `<ChatIcon name="file" />` |
| 18121 | refresh | `<ChatIcon name="refreshCw" />` |
| 18132 | close | `<ChatIcon name="x" />` |
| 18327 | send | `<ChatIcon name="send" />` |
| 18362 | file-code | `<ChatIcon name="fileCode" />` |
| 18374 | open-preview | `<ChatIcon name="eye" />` |
| 18465 | file-media | `<ChatIcon name="image" className="chat-composer-tool-glyph" />` |
| 18506 | attach | `<ChatIcon name="paperclip" />` |
| 18525 | device-camera | `<ChatIcon name="camera" />` |

（18400 slash icon 与 18479 stop 已在 Task 7 / Task 4 换完。）import 加 `import {ChatIcon} from '../chat/ChatIcon';`。保留 `searchTargetPicker` 的渲染点：grep `searchTargetPicker` icon 渲染处（搜索目标选择器），同样 `<span className={\`codicon ${target.icon}\`}` → `<ChatIcon name={target.icon} />`（Task 2 已把数据改为 ChatIconName）。

- [ ] **Step 8: VoiceInputButton.tsx** — mic → `<ChatIcon name="mic" />`；send → `<ChatIcon name="send" />`（import 相对路径 `../../chat/ChatIcon`）。

- [ ] **Step 9: 清理 codicon-only CSS** — `chat.css` 中已无任何引用的 codicon 选择器（如 `.chat-prompt-status .codicon`、`chat-attachment-* .codicon` 字号规则等），逐条 grep 确认无引用后删除；保留仍被 shell/settings 使用的全局 codicon 字体 import 不动。

- [ ] **Step 10: 全量验证**

Run: `cd app && npx jest __tests__/web-chat-inline-composer-wiring.test.ts __tests__/web-chat-file-link-context-menu.test.tsx web/src/chat && npm run tsc:web`
Expected: PASS + 无类型错误；守卫断言的 offenders 为空

- [ ] **Step 11: Commit**

```bash
git add app/web/src/chat app/web/src/app/WorkspaceApp.tsx app/web/src/features/speech/VoiceInputButton.tsx app/web/src/styles/chat.css app/__tests__
git commit -m "feat(app): replace remaining chat codicons with ChatIcon"
```

---

### Task 11: 动效收尾 + drag-over 文案

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`（drag-over hint JSX、附件删除延迟卸载）
- Modify: `app/web/src/styles/chat.css`（底行高度统一、附件进出场、胶囊选中过渡、drop hint）
- Test: `app/__tests__/web-chat-inline-composer-wiring.test.ts`（断言）

- [ ] **Step 1: 追加断言**

```ts
  test('composer motion polish: drop hint text, attachment exit, capsule transition', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('Drop files to attach');
    expect(mainTsx).toContain('chatAttachmentRemovingId');
    expect(stylesCss).toContain('.chat-composer-drop-hint');
    expect(stylesCss).toMatch(/\.chat-attachment-preview \{[\s\S]*animation: chat-attachment-in var\(--motion-standard\) var\(--ease-out\)/);
    expect(stylesCss).toContain('.chat-attachment-preview.removing');
    expect(stylesCss).toMatch(/\.chat-composer-capsule \{[\s\S]*transition: box-shadow var\(--motion-fast\)/);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx jest __tests__/web-chat-inline-composer-wiring.test.ts -t "motion polish"`
Expected: FAIL

- [ ] **Step 3: drag-over 文案** — frame 内（附件列表之前）加：

```tsx
              {chatComposerDragActive ? (
                <div className="chat-composer-drop-hint" aria-hidden="true">
                  <ChatIcon name="paperclip" size={14} />
                  <span>Drop files to attach</span>
                </div>
              ) : null}
```

CSS：

```css
.chat-composer-drop-hint {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: inherit;
  background: color-mix(in srgb, var(--accent-primary) 10%, var(--surface-panel) 88%);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
  animation: sl-menu-in 140ms var(--ease-out);
}
```

- [ ] **Step 4: 附件增删过渡** — WorkspaceApp 加 state：

```ts
  const [chatAttachmentRemovingId, setChatAttachmentRemovingId] = useState('');
```

`removeChatAttachment(id)` 调用点（18127）改为：

```ts
                        onClick={() => {
                          setChatAttachmentRemovingId(attachment.id);
                          window.setTimeout(() => {
                            removeChatAttachment(attachment.id);
                            setChatAttachmentRemovingId('');
                          }, 140);
                        }}
```

附件根节点 className 追加 `${chatAttachmentRemovingId === attachment.id ? ' removing' : ''}`。CSS：

```css
@keyframes chat-attachment-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.chat-attachment-preview {
  animation: chat-attachment-in var(--motion-standard) var(--ease-out);
}

.chat-attachment-preview.removing {
  opacity: 0;
  transform: translateY(2px);
  transition:
    opacity var(--motion-fast) ease-in,
    transform var(--motion-fast) ease-in;
}

@media (prefers-reduced-motion: reduce) {
  .chat-attachment-preview {
    animation: none;
  }

  .chat-attachment-preview.removing {
    transition: none;
  }
}
```

reduced-motion 下 140ms 延迟删除保留（视觉上瞬时，逻辑一致）。

- [ ] **Step 5: 胶囊选中过渡** — `.chat-composer-capsule` 的选中环从 outline 改 box-shadow 并加过渡：

```css
.chat-composer-capsule,
.chat-prompt-inline-capsule {
  transition: box-shadow var(--motion-fast) var(--ease-standard);
}

.chat-composer-capsule.selected {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 58%, transparent);
}
```

（删除原 `outline`/`outline-offset` 两条声明。）

- [ ] **Step 6: 底行高度统一（voice 切换防跳变）** — 给工具栏行与录音条统一高度：

```css
.chat-composer-toolbar {
  min-height: 30px;
  align-items: center;
}

.chat-voice-recording-bar {
  min-height: 30px;
}
```

（`.chat-voice-recording-bar` 的实际类名以 VoiceRecordingBar 组件根节点为准，先 grep 确认；若已有高度则只补 `align-items: center`。）切换动画：voice bar 与 toolbar 根节点各加 `animation: sl-menu-in 140ms var(--ease-out);`（挂载即播，reduced-motion 全局已有降级）。

- [ ] **Step 7: 跑测试确认通过**

Run: `cd app && npx jest __tests__/web-chat-inline-composer-wiring.test.ts && npm run tsc:web`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-inline-composer-wiring.test.ts
git commit -m "feat(app): polish composer micro-interactions and drop hint"
```

---

### Task 12: 全量验证

**Files:** 无（只跑验证）

- [ ] **Step 1: 类型检查 + 全量 jest**

Run: `cd app && npm run tsc:web && npx jest`
Expected: 全部 PASS。已有测试若因行为变更失败（如断言旧 codicon 类名、旧 enter 逻辑、旧菜单 class），属于任务内遗漏 —— 回到对应任务修，不用豁免。

- [ ] **Step 2: 源码守卫复验**

Run: `cd app && rg -n "codicon" web/src/chat web/src/features/speech/VoiceInputButton.tsx`
Expected: 无输出（或仅测试文件/注释中说明性引用，逐一确认）

- [ ] **Step 3: 生产构建**

Run: `cd app && npm run build:web`
Expected: webpack 构建成功，产物输出到 `~/.wheelmaker/web`

- [ ] **Step 4: 人工走查清单（执行者本地 `npm run web` 或 Desktop 验证）**

- 运行中：stop pill 出现在 toolbar 左侧（点 + Responding + 停止符），点击触发取消，cancelling 态正确，结束后带退场消失
- 桌面浏览器（Windows + 非 Windows UA）Enter 发送、Shift+Enter 换行；移动端设置项行为不变
- `/` 菜单：分组头、无 `/` 前缀项名、footer kbd 提示、进退场动画；Esc/外点/toggle 关闭都有退场
- `@` 菜单：几何与 `/` 一致、预览按钮 hover/active 才显示、footer kbd
- config / context / tray 弹层：互斥（开一个关其他）、进退场
- 拖文件到 composer：边框 + "Drop files to attach" 文案
- placeholder：空输入显示、输入即隐、无定位漂移
- 附件添加/删除有过渡；语音条与工具栏切换无跳变
- 全部图标为细线性风格，无字体图标方框/缺字

## 自我审查记录

- **Spec 覆盖**：交互（stop pill T4、Enter T3、菜单互斥 T5、placeholder T9、drag-over T11）✓；表现（图标 T1/T2/T10、材质色彩 T9、菜单几何 T8、分组/去前缀 T7）✓；动效（弹层进退场 T6、stop 脉冲 T4、微过渡 T11）✓；验收标准逐条有对应任务；测试切入点遵循仓库现状（源码断言 + hook 单测）。
- **占位符**：无 TBD/TODO；每个代码步骤含完整代码或精确替换表。
- **类型一致性**：`ChatIconName`（T1 定义，T2/T4/T10 使用）、`ChatComposerMenuState`/`useChatComposerMenu`（T5 定义，T6 使用 `chatComposerMenuExiting`）、`groupChatSlashMenuOptions`/`chatSlashOptionDisplayName`（T2 定义，T7 使用）、`chatAttachmentRemovingId`（T11 定义并使用）—— 命名全程一致。
