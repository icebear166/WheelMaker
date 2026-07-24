# Floating Chrome Visual Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 浮窗三卡(Recent / Plan / Monitor)、顶栏(PC + 移动,含 4 个弹窗)、Monitor 内容区(Limits / IQ)全面接入既有视觉语言,并完成范围内 codicon 清零。

**Architecture:** 原地改造,不重构、不新增模块目录。`menuExit.ts` 新增 boolean 变体 hook `useMenuExitFlag` 统一 4 个弹窗的进/退场;`SessionIcon` 注册表新增 8 个 Lucide 字形承接范围内全部图标;样式按文件分段重写(chat.css / usage.css / modelEfficiency.css / shell.css / terminal.css),新色一律由 `tokens.css` 既有 token 派生(color-mix),不新增色值。

**Tech Stack:** React 18 + TypeScript,样式为 plain CSS custom properties;测试为 jest(node env)+ react-test-renderer,风格以源文本断言(`app/__tests__/web-*.test.ts*`)与组件渲染断言(`app/web/src/**/*.test.tsx`)混合。

**Spec:** [`spec-floating-chrome-visual-upgrade.md`](spec-floating-chrome-visual-upgrade.md)(同目录,已批准)

**通用约定(每个任务都适用,后文不再重复):**
- 所有命令在仓库根目录(`D:\Code\WheelMaker\.worktree\feat\floating-chrome-visual-upgrade`)执行;jest 命令先 `cd app`。
- 单测命令形如 `cd app; npx jest __tests__/web-chat-ui.test.ts`;src 内测试形如 `cd app; npx jest web/src/chat/sessionlist`。
- 每个任务末尾的 commit 只 add 该任务触及的文件。
- 全程禁止扫描 `**/dist/**`。

---

### Task 0: 提交 spec、wiki 同步与本计划

**Files:**
- Add: `docs/scope/2026-07-24-floating-chrome-visual-upgrade/`
- Modify: `docs/wiki/frontend-interaction/visual-language.md`、`docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md`、`docs/wiki/features/limits-monitoring.md`、`docs/wiki/features/model-efficiency.md`

这 4 个 wiki 页与 spec 已在 scope 阶段写好但尚未提交(visual-language 的 diff 是已完成的 wiki 同步)。

- [ ] **Step 1: 提交文档基线**

```bash
git add docs/scope/2026-07-24-floating-chrome-visual-upgrade docs/wiki/frontend-interaction/visual-language.md docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md docs/wiki/features/limits-monitoring.md docs/wiki/features/model-efficiency.md
git commit -m "docs: floating chrome visual upgrade spec, plan, and wiki sync"
```

---

### Task 1: `useMenuExitFlag` boolean 弹窗状态 hook

**Files:**
- Modify: `app/web/src/chat/sessionlist/menuExit.ts`
- Test: `app/web/src/chat/sessionlist/menuExit.test.tsx`(新建——menuExit.ts 目前无任何行为测试文件,spec 测试策略要求 hook 行为测试;含 JSX 必须是 .tsx,.ts 不过 babel JSX 解析)

hook 语义(useState<boolean> 的 drop-in):
- `setOpen(true)`(或函数式解析为 true):取消进行中的退场,立即打开。
- `setOpen(false)`:非 reduced-motion 下先置 `exiting=true`(CSS 播 `sl-menu-exit`),`MENU_EXIT_MS`(100ms)后才真正置 false;reduced-motion 直卸。
- 退场中重复 `setOpen(false)`(外点连发):不重置计时。
- 退场中函数式 toggle(`open => !open`):视为重新打开,取消退场。
- 测试环境可能没有 `window.matchMedia`:缺失时按"非 reduced-motion"处理(浏览器必然存在;DesktopTitleBar 的 jest 渲染测试用裸对象 stub window,不能崩)。

- [ ] **Step 1: 写失败测试**

新建 `app/web/src/chat/sessionlist/menuExit.test.tsx`:

```tsx
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {MENU_EXIT_MS, useMenuExitFlag} from './menuExit';

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
  open: boolean;
  exiting: boolean;
  setOpen: (next: boolean | ((current: boolean) => boolean)) => void;
};

function Probe({handle}: {handle: ProbeHandle}) {
  const [open, setOpen, exiting] = useMenuExitFlag();
  handle.open = open;
  handle.exiting = exiting;
  handle.setOpen = setOpen;
  return null;
}

async function renderProbe(): Promise<ProbeHandle> {
  const handle: ProbeHandle = {open: false, exiting: false, setOpen: () => undefined};
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(<Probe handle={handle} />);
  });
  expect(tree).toBeDefined();
  return handle;
}

describe('useMenuExitFlag', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMatchMedia(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('delays unmount until the exit animation finishes', async () => {
    const handle = await renderProbe();
    expect(handle.open).toBe(false);

    await act(async () => {
      handle.setOpen(true);
    });
    expect(handle.open).toBe(true);
    expect(handle.exiting).toBe(false);

    await act(async () => {
      handle.setOpen(false);
    });
    expect(handle.open).toBe(true); // still mounted during exit
    expect(handle.exiting).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(MENU_EXIT_MS);
    });
    expect(handle.open).toBe(false);
    expect(handle.exiting).toBe(false);
  });

  it('closes immediately under reduced motion', async () => {
    mockMatchMedia(true);
    const handle = await renderProbe();

    await act(async () => {
      handle.setOpen(true);
    });
    await act(async () => {
      handle.setOpen(false);
    });
    expect(handle.open).toBe(false);
    expect(handle.exiting).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(MENU_EXIT_MS * 2);
    });
    expect(handle.open).toBe(false);
  });

  it('does not restart the exit timer on repeated plain closes', async () => {
    const handle = await renderProbe();

    await act(async () => {
      handle.setOpen(true);
    });
    await act(async () => {
      handle.setOpen(false);
    });
    await act(async () => {
      jest.advanceTimersByTime(MENU_EXIT_MS / 2);
    });
    await act(async () => {
      handle.setOpen(false); // repeated outside-click close must not re-time
    });
    await act(async () => {
      jest.advanceTimersByTime(MENU_EXIT_MS / 2);
    });
    expect(handle.open).toBe(false); // closed 100ms after the FIRST close
  });

  it('reopens when toggled during the exit window', async () => {
    const handle = await renderProbe();

    await act(async () => {
      handle.setOpen(true);
    });
    await act(async () => {
      handle.setOpen(false);
    });
    expect(handle.exiting).toBe(true);

    await act(async () => {
      handle.setOpen(current => !current); // trigger toggle during exit
    });
    expect(handle.open).toBe(true);
    expect(handle.exiting).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(MENU_EXIT_MS * 5);
    });
    expect(handle.open).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app; npx jest web/src/chat/sessionlist/menuExit.test.tsx`
Expected: FAIL — `useMenuExitFlag is not exported`(编译/导入错误)。

- [ ] **Step 3: 实现 hook**

在 `app/web/src/chat/sessionlist/menuExit.ts` 末尾追加(保持文件内既有 `useMenuExit` / `useMenuExitState` 不动):

```ts
/**
 * useState<boolean> drop-in for popup state: setting false plays the CSS exit
 * animation first (`.sl-menu-exit` via the returned `exiting` flag) and only
 * flips to false after MENU_EXIT_MS; setting true cancels any in-flight exit.
 * A functional toggle during the exit window reopens instead of double-closing.
 */
export function useMenuExitFlag() {
  const [open, setOpenRaw] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
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

  const setOpen = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const resolved = typeof next === 'function' ? next(openRef.current) : next;
      if (resolved) {
        cancelExit();
        setOpenRaw(true);
        return;
      }
      if (!openRef.current) {
        return;
      }
      const reducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion) {
        setOpenRaw(false);
        return;
      }
      if (timerRef.current !== null) {
        if (typeof next === 'function') {
          cancelExit(); // toggle during exit reopens
        }
        return; // repeated plain close keeps the single in-flight timer
      }
      setExiting(true);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setExiting(false);
        setOpenRaw(false);
      }, MENU_EXIT_MS);
    },
    [cancelExit],
  );

  return [open, setOpen, exiting] as const;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app; npx jest web/src/chat/sessionlist/menuExit.test.tsx`
Expected: PASS(4 tests)。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/chat/sessionlist/menuExit.ts app/web/src/chat/sessionlist/menuExit.test.tsx
git commit -m "feat(app): add useMenuExitFlag for boolean popup state"
```

---

### Task 2: SessionIcon 注册表新增 8 个 Lucide 字形

**Files:**
- Modify: `app/web/src/chat/sessionlist/SessionIcon.tsx`(GLYPHS 表,`list` 条目之后追加)
- Test: `app/web/src/chat/sessionlist/SessionIcon.test.tsx`

新增映射(用途锁定,后续任务引用这些名字,禁止改名):`arrowRight`(Plan 进行中步骤)、`circle`(Plan 待办步骤)、`eyeOff`(Monitor 隐藏)、`layoutGrid`(Monitor 进入 detail)、`terminal`(顶栏终端)、`panelRight`(顶栏预览)、`history`(顶栏 prompt 历史)、`listChecks`(Plan compact 无活动步骤标记)。Monitor detail 态回切 compact 复用已有 `list`;刷新复用 `refreshCw`;关闭复用 `x`;加号复用 `plus`;chevron 复用现有三枚。

- [ ] **Step 1: 更新测试(先失败)**

`app/web/src/chat/sessionlist/SessionIcon.test.tsx` 中把:

```ts
    expect(SESSION_ICON_NAMES).toEqual(
      expect.arrayContaining(['import', 'archiveRestore', 'clock']),
    );
```

改为:

```ts
    expect(SESSION_ICON_NAMES).toEqual(
      expect.arrayContaining([
        'import',
        'archiveRestore',
        'clock',
        'arrowRight',
        'circle',
        'eyeOff',
        'layoutGrid',
        'terminal',
        'panelRight',
        'history',
        'listChecks',
      ]),
    );
```

Run: `cd app; npx jest web/src/chat/sessionlist/SessionIcon.test.tsx`
Expected: FAIL(arrayContaining 缺 8 个名字)。

- [ ] **Step 2: 注册字形**

`SessionIcon.tsx` 的 GLYPHS 中,在 `list` 条目(第 60 行)之后追加(沿用既有 `// lucide:<id>` 注释约定;字形为 Lucide 24 viewBox stroke 内节点,可用 better-icons 复核):

```tsx
  // lucide:arrow-right
  arrowRight: (<><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>),
  // lucide:circle
  circle: (<><circle cx="12" cy="12" r="10" /></>),
  // lucide:eye-off
  eyeOff: (<><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /><path d="m2 2 20 20" /></>),
  // lucide:layout-grid
  layoutGrid: (<><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></>),
  // lucide:terminal
  terminal: (<><path d="m4 17 6-6-6-6" /><path d="M12 19h8" /></>),
  // lucide:panel-right
  panelRight: (<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /></>),
  // lucide:history
  history: (<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>),
  // lucide:list-checks
  listChecks: (<><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" /></>),
```

- [ ] **Step 3: 跑测试确认通过**

Run: `cd app; npx jest web/src/chat/sessionlist/SessionIcon.test.tsx`
Expected: PASS(循环渲染断言会自动覆盖新字形,保证非空)。

- [ ] **Step 4: Commit**

```bash
git add app/web/src/chat/sessionlist/SessionIcon.tsx app/web/src/chat/sessionlist/SessionIcon.test.tsx
git commit -m "feat(app): register eight Lucide glyphs for floating chrome"
```

---

### Task 3: 浮窗三卡材质统一(实心面板 + 统一阴影 + aside 单层化)

**Files:**
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/web/src/styles/usage.css`(仅圆角)
- Test: `app/__tests__/web-chat-session-panel-layout.test.tsx`、`app/__tests__/web-usage-feature-surface.test.tsx`

背景事实(已核实):桌面三张卡都在 `.chat-edge-surface-stack` 内,实际材质由 2347–2355 的 stack glass override 承载(已是实心面板但 `box-shadow: none`);aside 级规则(2217–2234 Recent、2289–2309 Plan)里的 border/background/box-shadow 被 5298–5306 的同选择器后置规则覆盖,是死代码;`.chat-recent-sessions-surface.desktop.expanded .chat-edge-surface-glass`(2242–2248)同样被 stack override 覆盖,是死规则;Monitor 的 `.chat-function-surface.desktop` 圆角 10px 是唯一圆角例外。

目标材质(常驻浮窗):`border-subtle 80%` 发丝边 + `surface-panel 88%/raised` 底 + 8px 圆角 + `--shadow-floating` + 顶部 1px 内高光,aside 只留几何。

- [ ] **Step 1: 更新测试(先失败)**

`app/__tests__/web-chat-session-panel-layout.test.tsx` 的 `fuses the floating Sessions header and Recent content into one card aligned with the Hub edge` 测试中,把:

```ts
    expect(cssRuleBlock(chatStyles, '.chat-recent-sessions-surface.desktop.expanded')).toContain('border-radius: 8px;');
    const glassRule = cssRuleBlock(chatStyles, '.chat-recent-sessions-surface.desktop.expanded .chat-edge-surface-glass');
    expect(glassRule).toContain('border: 1px solid');
    expect(glassRule).toContain('box-shadow: none;');
    expect(glassRule).toContain('background: color-mix(in srgb, var(--surface-panel) 88%, var(--surface-raised));');
    expect(glassRule).toContain('backdrop-filter: none;');
```

改为:

```ts
    expect(cssRuleBlock(chatStyles, '.chat-recent-sessions-surface.desktop.expanded')).toContain('border-radius: 8px;');
    const glassRule = cssRuleBlock(
      chatStyles,
      '.chat-edge-surface-stack > .chat-recent-sessions-surface.desktop .chat-edge-surface-glass,\n.chat-edge-surface-stack > .chat-plan-surface.desktop .chat-edge-surface-glass,\n.chat-edge-surface-stack > .chat-function-surface.desktop .chat-edge-surface-glass',
    );
    expect(glassRule).toContain('border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);');
    expect(glassRule).toContain('box-shadow:');
    expect(glassRule).toContain('var(--shadow-floating)');
    expect(glassRule).toContain('inset 0 1px 0 color-mix(in srgb, var(--text-primary) 8%, transparent);');
    expect(glassRule).toContain('background: color-mix(in srgb, var(--surface-panel) 88%, var(--surface-raised));');
    expect(glassRule).toContain('backdrop-filter: none;');
```

同一文件新增一个独立测试(放在 `gives expanded Sessions, Plan, and Monitor cards the same width and radius` 之后):

```ts
  it('keeps floating-card material on the glass layer only, with no aside-level residue', () => {
    const recentAsideRule = cssRuleBlock(chatStyles, '.chat-recent-sessions-surface.desktop');
    expect(recentAsideRule).not.toContain('box-shadow');
    expect(recentAsideRule).not.toContain('border: 1px solid');
    const planAsideRule = cssRuleBlock(chatStyles, '.chat-plan-surface.desktop');
    expect(planAsideRule).not.toContain('box-shadow');
    expect(planAsideRule).not.toContain('background:');
    expect(planAsideRule).not.toContain('border: 1px solid');
    expect(chatStyles).not.toContain('.chat-recent-sessions-surface.desktop.expanded .chat-edge-surface-glass {');
  });
```

注意:`cssRuleBlock(chatStyles, '.chat-plan-surface.desktop')` 的 `indexOf('.chat-plan-surface.desktop {')` 命中的是 base 规则(aside 级),不会命中 `.chat-plan-surface.desktop.collapsed {`,符合预期。

`app/__tests__/web-usage-feature-surface.test.tsx` 的 `shares the desktop edge width and keeps detail expansion vertical` 测试中,在 `expect(compactRule).not.toContain('bottom:');` 之后加一行:

```ts
    expect(compactRule).toContain('border-radius: 8px;');
```

Run: `cd app; npx jest __tests__/web-chat-session-panel-layout.test.tsx __tests__/web-usage-feature-surface.test.tsx`
Expected: FAIL(新增断言不满足:shadow 仍是 none、aside 仍有残留、圆角仍 10px)。

- [ ] **Step 2: chat.css — aside 单层化**

2a. `.chat-recent-sessions-surface.desktop`(约 2217–2234)删除尾部两行材质声明,规则收尾改为:

```css
  width: var(--chat-recent-sessions-resolved-width);
  overflow: hidden;
  border-radius: 8px;
}
```

(即删掉 `border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, var(--accent-primary));` 与 `box-shadow: 0 14px 34px color-mix(in srgb, #000 28%, transparent);`,保留全部几何变量与 `border-radius`。)

2b. 整条删除死规则 `.chat-recent-sessions-surface.desktop.expanded .chat-edge-surface-glass { ... }`(2242–2248)。

2c. `.chat-plan-surface.desktop`(2289–2309)同样收尾为:

```css
  width: var(--chat-plan-resolved-width);
  max-height: min(42vh, 360px);
  overflow: hidden;
  border-radius: 8px;
}
```

(删掉 `border: 1px solid ...`、`background: color-mix(in srgb, var(--surface-panel) 92%, var(--surface-workspace-content));`、`box-shadow: 0 14px 34px ...;`。)

2d. stack glass override(2347–2355)改为统一材质:

```css
.chat-edge-surface-stack > .chat-recent-sessions-surface.desktop .chat-edge-surface-glass,
.chat-edge-surface-stack > .chat-plan-surface.desktop .chat-edge-surface-glass,
.chat-edge-surface-stack > .chat-function-surface.desktop .chat-edge-surface-glass {
  border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
  background: color-mix(in srgb, var(--surface-panel) 88%, var(--surface-raised));
  box-shadow:
    var(--shadow-floating),
    inset 0 1px 0 color-mix(in srgb, var(--text-primary) 8%, transparent);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
```

- [ ] **Step 3: usage.css — Monitor 圆角收齐**

`.chat-function-surface.desktop`(usage.css:12)`border-radius: 10px;` 改为 `border-radius: 8px;`(`.collapsed` 已是 8px,不动)。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app; npx jest __tests__/web-chat-session-panel-layout.test.tsx __tests__/web-usage-feature-surface.test.tsx __tests__/web-chat-plan-surface.test.tsx`
Expected: PASS。注意 `web-chat-plan-surface.test.tsx` 的几何/结构断言(360px 宽度、mask 合并选择器、hover 规则)不受影响,必须保持绿。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/styles/chat.css app/web/src/styles/usage.css app/__tests__/web-chat-session-panel-layout.test.tsx app/__tests__/web-usage-feature-surface.test.tsx
git commit -m "feat(app): unify floating card material on solid panel"
```

---

### Task 4: 顶栏 ghost 控件语言 + 顶栏图标 Lucide 化

**Files:**
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/web/src/styles/shell.css`(`.chat-menu-icon-button`)
- Modify: `app/web/src/styles/terminal.css`(删 `.chat-terminal-toggle`)
- Modify: `app/web/src/app/WorkspaceApp.tsx`(6 处图标 + 菜单加号)
- Test: `app/__tests__/web-chat-ui.test.ts`

ghost 语言:默认 `text-tertiary` → hover `var(--hover)` 底 + `text-primary`;active/开启 = `var(--accent-soft-bg)` 底 + accent 文字。28px 四按钮(search / terminal / preview / history)共用一条规则;设置按钮 30px 尺寸不动只改色;Project / Hubs 去 chip 改 ghost 文本按钮;session 标题 `text-primary` + 500。

- [ ] **Step 1: 更新测试(先失败)**

`app/__tests__/web-chat-ui.test.ts` 的 `chat title bar uses breadcrumb context and exposes preview toggle` 测试(约 2223–2231),把:

```ts
    const previewToggleBlock = cssRuleBlock(stylesCss, '.chat-preview-toggle');
    expect(previewToggleBlock).toContain('border: 0;');
    expect(previewToggleBlock).toContain('background: transparent;');
    expect(previewToggleBlock).toContain('color: color-mix(in srgb, var(--accent-primary) 88%, var(--text-primary));');
    expect(previewToggleBlock).not.toContain('var(--surface-raised)');
    const previewToggleActiveBlock = cssRuleBlock(stylesCss, '.chat-preview-toggle:hover');
    expect(previewToggleActiveBlock).toContain('background: color-mix(in srgb, var(--accent-primary) 13%, transparent);');
    const previewToggleOpenBlock = cssRuleBlock(stylesCss, '.chat-preview-toggle.active');
    expect(previewToggleOpenBlock).not.toContain('border-color:');
```

改为(注意:`cssRuleBlock` 用 `indexOf(selector + ' {')` 定位,因此新合并规则里必须把对应选择器放在逗号列表**最后一项**才能被定位,Step 2 的选择器顺序与此处断言一一对应,不得调换):

```ts
    const previewToggleBlock = cssRuleBlock(stylesCss, '.chat-preview-toggle');
    expect(previewToggleBlock).toContain('width: 28px;');
    expect(previewToggleBlock).toContain('border: 0;');
    expect(previewToggleBlock).toContain('background: transparent;');
    expect(previewToggleBlock).toContain('color: var(--text-tertiary);');
    expect(previewToggleBlock).not.toContain('var(--surface-raised)');
    const previewToggleHoverBlock = cssRuleBlock(stylesCss, '.chat-preview-toggle:hover');
    expect(previewToggleHoverBlock).toContain('background: var(--hover);');
    expect(previewToggleHoverBlock).toContain('color: var(--text-primary);');
    const previewToggleOpenBlock = cssRuleBlock(stylesCss, '.chat-preview-toggle.active');
    expect(previewToggleOpenBlock).toContain('background: var(--accent-soft-bg);');
    expect(previewToggleOpenBlock).not.toContain('border-color:');
    const terminalToggleBlock = cssRuleBlockContainingSelector(stylesCss, '.chat-terminal-toggle');
    expect(terminalToggleBlock).toContain('width: 28px;');
    expect(terminalToggleBlock).toContain('color: var(--text-tertiary);');
    expect(stylesCss).not.toContain('.chat-search-toggle {');
    const sessionTitleBlock2 = cssRuleBlock(stylesCss, '.chat-title-session-text');
    expect(sessionTitleBlock2).toContain('color: var(--text-primary);');
    expect(sessionTitleBlock2).toContain('font-weight: 500;');
```

Run: `cd app; npx jest __tests__/web-chat-ui.test.ts`
Expected: FAIL(颜色/字重断言不满足)。

- [ ] **Step 2: chat.css — 统一 28px ghost 规则**

2a. 把 120–151 的两条规则(`.chat-title-prompt-icon-button, .chat-preview-toggle { ... }` 与 hover/open/active 块)整体替换为:

```css
.chat-title-prompt-icon-button,
.chat-search-toggle,
.chat-terminal-toggle,
.chat-preview-toggle {
  appearance: none;
  position: relative;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  padding: 0;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

.chat-title-prompt-icon-button:hover,
.chat-title-prompt-icon-button.open,
.chat-search-toggle:hover,
.chat-terminal-toggle:hover,
.chat-preview-toggle:hover {
  background: var(--hover);
  color: var(--text-primary);
}

.chat-search-toggle.active,
.chat-terminal-toggle.active,
.chat-preview-toggle.active {
  background: var(--accent-soft-bg);
  color: var(--accent-primary);
}
```

2b. 删除 5855–5875 的旧 `.chat-search-toggle` 规则块(含其 `:hover` / `.active`)。

2c. `.chat-title-project-button`(163–181)的 `color` 改为 `var(--text-tertiary);`;其 hover/open 块(188–192)改为:

```css
.chat-title-project-button:hover,
.chat-title-project-button.open {
  background: var(--hover);
  color: var(--text-primary);
}
```

`.chat-title-project-button .codicon`(209–212)改为:

```css
.chat-title-project-button .sl-icon {
  flex: 0 0 auto;
}
```

2d. `.chat-title-session-text`(214–219)改为:

```css
.chat-title-session-text {
  min-width: 0;
  flex: 1 1 0;
  color: var(--text-primary);
  font-weight: 500;
  cursor: default;
}
```

2e. `.chat-hub-summary-button`(1251–1266)改为 ghost(保留字号/字重/几何,去 chip):

```css
.chat-hub-summary-button {
  height: 24px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-tertiary);
  padding: 0 7px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: none;
  white-space: nowrap;
  cursor: pointer;
}
```

`.chat-hub-summary-button:hover`(1296–1299)改为:

```css
.chat-hub-summary-button:hover {
  background: var(--hover);
  color: var(--text-primary);
}
```

`.chat-hub-summary-button .codicon`(1301–1303)改为 `.chat-hub-summary-button .sl-icon { flex: 0 0 auto; }`。

2f. 约 5208 的组合规则中把 `.chat-hub-summary-button,` 从选择器列表删除,使其变为:

```css
.chat-header-search-control,
.session-search-input {
  border-color: var(--border-subtle);
  background: var(--surface-panel);
}
```

- [ ] **Step 3: shell.css — 设置按钮 ghost 化**

`.chat-menu-icon-button`(202–216)`color` 改为 `var(--text-tertiary);`(尺寸变量 30px 不动);hover 块(218–224)改为:

```css
.chat-menu-icon-button:hover,
.chat-menu-icon-button:focus-visible,
.chat-menu-icon-button[aria-expanded='true'] {
  background: var(--hover);
  color: var(--text-primary);
  outline: none;
}
```

- [ ] **Step 4: terminal.css — 删除独立 toggle 规则**

删除 `.chat-terminal-toggle { ... }` 与 `.chat-terminal-toggle:hover, .chat-terminal-toggle.active { ... }` 两个规则块(约 3–24 行),保留 `@import` 与后续 terminal 规则。

- [ ] **Step 5: WorkspaceApp.tsx — 图标替换**

WorkspaceApp 已 import `SessionIcon`(设置按钮在用)。逐处替换:

- `renderDesktopChatProjectSelector` 内 `<span className="codicon codicon-chevron-down" aria-hidden="true" />` → `<SessionIcon name="chevronDown" />`
- `renderDesktopChatBreadcrumbTitle` 内 `<span className="codicon codicon-history" aria-hidden="true" />` → `<SessionIcon name="history" />`
- `renderMobileChatBreadcrumbTitle` 内 project 按钮的 `<span className="codicon codicon-chevron-down" aria-hidden="true" />` → `<SessionIcon name="chevronDown" />`
- `renderChatTitleBar` 内:`codicon-search` → `<SessionIcon name="search" />`;`codicon-terminal` → `<SessionIcon name="terminal" />`;`codicon-layout-sidebar-right` → `<SessionIcon name="panelRight" />`(preview 按钮内的 `chat-preview-badge` span 保留)
- `chatTitleProjectMenu` 内 create 按钮的 `<span className="codicon codicon-add" aria-hidden="true" />` → `<SessionIcon name="plus" />`

不动:移动端手势 pill 的 `codicon-settings-gear`(约 18979)、移动端快捷菜单的 `codicon-terminal`(约 18928)——均不在本轮范围(web-chat-ui.test.ts 对这两处的断言保持绿)。

- [ ] **Step 6: 跑测试确认通过**

Run: `cd app; npx jest __tests__/web-chat-ui.test.ts __tests__/web-chat-session-panel-layout.test.tsx; npm run tsc:web`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add app/web/src/styles/chat.css app/web/src/styles/shell.css app/web/src/styles/terminal.css app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-ui.test.ts
git commit -m "feat(app): ghost top bar controls with Lucide icons"
```

---

### Task 5: 顶栏 4 弹窗统一毛玻璃 + 进/退场接线

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`(3 个 boolean state 换 hook + 3 处 exit class)
- Modify: `app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx`(hook + 外点/Esc + exit class)
- Modify: `app/web/src/styles/chat.css`(材质配方 + sl-menu-in)
- Modify: `app/web/src/styles/shell.css`(扩展菜单材质 + 动画)
- Test: `app/__tests__/web-chat-ui.test.ts`、`app/__tests__/web-desktop-titlebar.test.tsx`

弹窗配方(复用 session 菜单):`surface-overlay 88%` + `blur(12px) saturate(1.1)` + `border-faint` + `--shadow-overlay` + 4px padding;进场 `sl-menu-in`、退场 `sl-menu-exit`(100ms 后卸载,退场期 `pointer-events: none` 由 `.sl-menu-exit` 自带)。DesktopTitleBar 扩展菜单当前无外点/Esc 关闭,一并补上(spec 决策:所有关闭路径走包装后的 setter)。

- [ ] **Step 1: 更新测试(先失败)**

1a. `app/__tests__/web-chat-ui.test.ts` 的 `chat drawer header keeps tools left and hub browser right` 测试中,把:

```ts
    expect(mainTsx).toContain('const [chatHubMenuOpen, setChatHubMenuOpen] = useState(false);');
```

改为:

```ts
    expect(mainTsx).toContain('const [chatHubMenuOpen, setChatHubMenuOpen, chatHubMenuExiting] = useMenuExitFlag();');
```

同文件新增一个独立测试(放在 `chat title bar uses breadcrumb context and exposes preview toggle` 之后):

```ts
  test('top bar menus share the session glass recipe and menu exit wiring', () => {
    expect(mainTsx).toContain("import {useMenuExitFlag, useMenuExitState} from '../chat/sessionlist/menuExit';");
    expect(mainTsx).toContain('const [chatTitleProjectMenuOpen, setChatTitleProjectMenuOpen, chatTitleProjectMenuExiting] = useMenuExitFlag();');
    expect(mainTsx).toContain('const [chatTitlePromptMenuOpen, setChatTitlePromptMenuOpen, chatTitlePromptMenuExiting] = useMenuExitFlag();');
    expect(mainTsx).toContain("className={`chat-title-project-menu${chatTitleProjectMenuExiting ? ' sl-menu-exit' : ''}`}");
    expect(mainTsx).toContain("className={`chat-title-prompt-menu${chatTitlePromptMenuExiting ? ' sl-menu-exit' : ''}`}");
    expect(mainTsx).toContain("chatHubMenuExiting ? ' sl-menu-exit' : ''");
    const menuRule = cssRuleBlock(stylesCss, '.chat-title-prompt-menu,\n.chat-hub-popover');
    expect(menuRule).toContain('background: color-mix(in srgb, var(--surface-overlay) 88%, transparent);');
    expect(menuRule).toContain('blur(12px) saturate(1.1)');
    expect(menuRule).toContain('border: 1px solid var(--border-faint);');
    expect(menuRule).toContain('box-shadow: var(--shadow-overlay);');
    expect(menuRule).toContain('padding: 4px;');
    expect(menuRule).toContain('animation: sl-menu-in 140ms var(--ease-out);');
    expect(stylesCss).not.toMatch(/\.chat-title-project-menu,[\s\S]{0,200}workspaceMenuEnter/);
    expect(stylesCss).not.toMatch(/\.chat-title-prompt-menu,[\s\S]{0,200}workspaceMenuEnter/);
    expect(stylesCss).not.toMatch(/\.chat-hub-popover,[\s\S]{0,200}workspaceMenuEnter/);
  });
```

(`mainTsx` / `stylesCss` / `cssRuleBlock` 均为该文件既有局部变量/辅助函数;若该测试所在 describe 块内变量名不同,沿用文件内既有同名测试的取源方式。)

1b. `app/__tests__/web-desktop-titlebar.test.tsx` 新增测试(文件内已有 react-test-renderer + window stub 模式,沿用其缩进风格):

```tsx
	test('plays the exit animation before unmounting the extensions menu', async () => {
		jest.useFakeTimers();
		window.matchMedia = ((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		})) as typeof window.matchMedia;
		(global as typeof globalThis & { window?: unknown }).window = {
			WheelMakerDesktop: {enabled: true, requestLocalDevMode: jest.fn()},
			matchMedia: window.matchMedia,
		};

		let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
		await ReactTestRenderer.act(async () => {
			renderer = ReactTestRenderer.create(<DesktopWindowControls />);
		});
		const root = renderer!.root;
		await ReactTestRenderer.act(async () => {
			root.findByProps({'aria-label': 'Windows extensions'}).props.onClick();
		});
		expect(root.findAllByProps({role: 'menu'})).toHaveLength(1);

		await ReactTestRenderer.act(async () => {
			root.findByProps({className: 'desktop-titlebar-button desktop-windows-extension-button'}).props.onClick();
		});
		const menu = root.findByProps({role: 'menu'});
		expect(menu.props.className).toContain('sl-menu-exit');

		await ReactTestRenderer.act(async () => {
			jest.advanceTimersByTime(100);
		});
		expect(root.findAllByProps({role: 'menu'})).toHaveLength(0);
		jest.useRealTimers();
	});
```

Run: `cd app; npx jest __tests__/web-chat-ui.test.ts __tests__/web-desktop-titlebar.test.tsx`
Expected: FAIL(useMenuExitFlag 未接线 / 无 exit class / 无配方规则)。

- [ ] **Step 2: WorkspaceApp.tsx — 三个 state 换 hook + exit class**

2a. import 行(129)改为:

```ts
import {useMenuExitFlag, useMenuExitState} from '../chat/sessionlist/menuExit';
```

2b. state 声明(3363–3372 区域)中**逐行**替换三条 useState(refs 与 `chatHubColorMenuHubId` 等其余声明行保持原样):

`const [chatHubMenuOpen, setChatHubMenuOpen] = useState(false);` →

```ts
  const [chatHubMenuOpen, setChatHubMenuOpen, chatHubMenuExiting] = useMenuExitFlag();
```

`const [chatTitleProjectMenuOpen, setChatTitleProjectMenuOpen] = useState(false);` →

```ts
  const [chatTitleProjectMenuOpen, setChatTitleProjectMenuOpen, chatTitleProjectMenuExiting] = useMenuExitFlag();
```

`const [chatTitlePromptMenuOpen, setChatTitlePromptMenuOpen] = useState(false);` →

```ts
  const [chatTitlePromptMenuOpen, setChatTitlePromptMenuOpen, chatTitlePromptMenuExiting] = useMenuExitFlag();
```

(所有既有调用点 `setX(false)` / `setX(open => !open)` / `setX(true)` 签名兼容,零改动。)

2c. exit class 三处:

- `chatTitleProjectMenu` 容器:`className="chat-title-project-menu"` →

```tsx
      className={`chat-title-project-menu${chatTitleProjectMenuExiting ? ' sl-menu-exit' : ''}`}
```

- `chatTitlePromptMenu` 容器:`className="chat-title-prompt-menu"` →

```tsx
      className={`chat-title-prompt-menu${chatTitlePromptMenuExiting ? ' sl-menu-exit' : ''}`}
```

- hub popover(createPortal 内):`className={`chat-hub-popover${chatHubColorMenuHubId ? ' no-overflow' : ''}`}` →

```tsx
          className={`chat-hub-popover${chatHubColorMenuHubId ? ' no-overflow' : ''}${chatHubMenuExiting ? ' sl-menu-exit' : ''}`}
```

- [ ] **Step 3: DesktopTitleBar.tsx — hook + 外点/Esc + exit class**

3a. 顶部 import 追加:

```ts
import {useMenuExitFlag} from '../../../chat/sessionlist/menuExit';
```

3b. `const [extensionsOpen, setExtensionsOpen] = useState(false);` 改为:

```ts
  const [extensionsOpen, setExtensionsOpen, extensionsExiting] = useMenuExitFlag();
```

3c. 新增 root ref 与外点/Esc effect(放在 `refreshDesktopUpdate` 的 useEffect 之后、`if (!bridge)` 早退之前;`window.addEventListener` 在 jest 裸 stub 下可能不存在,必须守卫):

```ts
  const extensionRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!extensionsOpen || typeof window.addEventListener !== 'function') {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && extensionRootRef.current?.contains(target)) {
        return;
      }
      setExtensionsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExtensionsOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [extensionsOpen, setExtensionsOpen]);
```

3d. `.desktop-windows-extension-root` div 加 `ref={extensionRootRef}`;菜单容器改为:

```tsx
              <div className={`desktop-windows-extension-menu${extensionsExiting ? ' sl-menu-exit' : ''}`} role="menu" aria-label="Windows extensions">
```

- [ ] **Step 4: chat.css — 菜单配方 + sl-menu-in**

4a. 在 5275–5296 的共享材质块之后、5298 的 aside strip 块之前插入(位置敏感:必须在 5371 的 reduced-transparency 块之前,保证后者能覆盖):

```css
.chat-title-project-menu,
.chat-title-prompt-menu,
.chat-hub-popover {
  background: color-mix(in srgb, var(--surface-overlay) 88%, transparent);
  backdrop-filter: blur(12px) saturate(1.1);
  -webkit-backdrop-filter: blur(12px) saturate(1.1);
  border: 1px solid var(--border-faint);
  box-shadow: var(--shadow-overlay);
  padding: 4px;
  transform-origin: top center;
  animation: sl-menu-in 140ms var(--ease-out);
}
```

4b. 5601–5608 的动画挂接块中删除 `.chat-hub-popover,`、`.chat-title-project-menu,`、`.chat-title-prompt-menu,` 三行,使该块只剩:

```css
.project-session-action-menu,
.session-archive-menu {
  transform-origin: top center;
  animation: workspaceMenuEnter var(--motion-standard) var(--ease-out) both;
}
```

(5637–5647 的 reduced-motion 块保留这三个选择器不动——它同时压制 sl-menu-in;`.sl-menu-exit` 已由 sessionlist.css 的 reduced-motion 块覆盖。)

- [ ] **Step 5: shell.css — 扩展菜单材质 + 动画**

`.desktop-windows-extension-menu`(1633–1644)替换为:

```css
.desktop-windows-extension-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 4px;
  z-index: 100;
  width: 190px;
  padding: 4px;
  border: 1px solid var(--border-faint);
  border-radius: 7px;
  background: color-mix(in srgb, var(--surface-overlay) 88%, transparent);
  backdrop-filter: blur(12px) saturate(1.1);
  -webkit-backdrop-filter: blur(12px) saturate(1.1);
  box-shadow: var(--shadow-overlay);
  transform-origin: top right;
  animation: sl-menu-in 140ms var(--ease-out);
}
```

文件内既有 `@media (prefers-reduced-motion: reduce)` 块(约 639)的选择器列表中追加 `.desktop-windows-extension-menu`;文件末尾追加:

```css
@media (prefers-reduced-transparency: reduce) {
  .desktop-windows-extension-menu {
    background: var(--surface-overlay);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd app; npx jest __tests__/web-chat-ui.test.ts __tests__/web-desktop-titlebar.test.tsx; npm run tsc:web`
Expected: PASS。注意 titlebar 既有 6 个扩展菜单测试必须保持绿(hook 对缺失 matchMedia 的守卫 + effect 对缺失 addEventListener 的守卫是关键)。

- [ ] **Step 7: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx app/web/src/styles/chat.css app/web/src/styles/shell.css app/__tests__/web-chat-ui.test.ts app/__tests__/web-desktop-titlebar.test.tsx
git commit -m "feat(app): glass top bar menus with enter and exit motion"
```

---

### Task 6: Plan 表面 — Lucide 步骤标记 + 分段进度轨 + 移动 pill 毛玻璃

**Files:**
- Modify: `app/web/src/chat/ChatPlanSurface.tsx`
- Modify: `app/web/src/styles/chat.css`
- Test: `app/__tests__/web-chat-plan-surface.test.tsx`

进度轨规则:桌面标题栏 `n/N` 文本旁;`totalCount <= 12` 用分段轨(每步一段:completed=绿 / in_progress=琥珀 1.6s 脉动 / pending=低透空槽);`> 12` 退化为连续填充条(宽 = `completedCount/totalCount`,纯 accent,未跑完时整体脉动);移动端 pill 不加轨、纯文本。阈值命名 `PLAN_SEGMENT_TRACK_MAX_STEPS`(避免魔数)。

- [ ] **Step 1: 更新测试(先失败)**

`app/__tests__/web-chat-plan-surface.test.tsx` 的 describe 内新增三个测试:

```tsx
  test('renders Lucide step markers and a segmented progress track in the desktop header', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatPlanSurface mode="desktop" plan={planSnapshot()} />,
      );
    });

    const iconNames = renderer!.root.findAllByType('svg').map(svg => svg.props['data-icon-name']);
    expect(iconNames).toContain('check');
    expect(iconNames).toContain('arrowRight');
    expect(iconNames).toContain('circle');
    expect(renderer!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('codicon'))).toHaveLength(0);

    const track = renderer!.root.findByProps({className: 'chat-plan-progress-track segmented'});
    expect(track.findAllByProps({className: 'chat-plan-progress-segment completed'})).toHaveLength(1);
    expect(track.findAllByProps({className: 'chat-plan-progress-segment in-progress'})).toHaveLength(1);
    expect(track.findAllByProps({className: 'chat-plan-progress-segment pending'})).toHaveLength(1);
    expect(renderer!.root.findByProps({className: 'chat-plan-progress'}).children).toEqual(['2/3']);
  });

  test('falls back to a continuous accent bar beyond twelve steps', async () => {
    const bigPlan: ChatPlanSnapshot = {
      turnIndex: 3,
      entries: Array.from({length: 13}, (_, index) => ({
        content: `Step ${index + 1}`,
        status: index < 5 ? 'completed' : index === 5 ? 'in_progress' : 'pending',
      })),
      activeEntry: {content: 'Step 6', status: 'in_progress'},
      activeIndex: 5,
      completedCount: 5,
      totalCount: 13,
    };
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatPlanSurface mode="desktop" plan={bigPlan} />,
      );
    });

    const track = renderer!.root.findByProps({className: 'chat-plan-progress-track continuous active'});
    expect(track.findByProps({className: 'chat-plan-progress-track-fill'}).props.style.width).toBe('38%');
    expect(renderer!.root.findAllByProps({className: 'chat-plan-progress-track segmented'})).toHaveLength(0);
    expect(renderer!.root.findByProps({className: 'chat-plan-progress'}).children).toEqual(['6/13']);
  });

  test('keeps the mobile pill text-only with glass material and Lucide icons', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatPlanSurface mode="mobile" plan={planSnapshot()} />,
      );
    });

    expect(renderer!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('chat-plan-progress-track'))).toHaveLength(0);
    expect(renderer!.root.findByProps({className: 'chat-plan-progress'}).children).toEqual(['2/3']);
    const iconNames = renderer!.root.findAllByType('svg').map(svg => svg.props['data-icon-name']);
    expect(iconNames).toContain('arrowRight');
    expect(renderer!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('codicon'))).toHaveLength(0);

    const stylesCss = readSourceText(path.join(__dirname, '..', 'web', 'src', 'styles', 'chat.css'));
    const pillRule = cssRuleBlock(stylesCss, '.chat-plan-compact-trigger');
    expect(pillRule).toContain('border: 1px solid var(--border-faint);');
    expect(pillRule).toContain('blur(12px) saturate(1.1)');
  });
```

Run: `cd app; npx jest __tests__/web-chat-plan-surface.test.tsx`
Expected: FAIL(组件尚未改)。

- [ ] **Step 2: ChatPlanSurface.tsx 改造**

2a. 顶部追加 `import {SessionIcon} from './sessionlist/SessionIcon';` 与常量:

```tsx
export const PLAN_SEGMENT_TRACK_MAX_STEPS = 12;
```

2b. `planStepIconClassName` 整体替换为:

```tsx
function planStepIconName(entry: ChatPlanEntry): 'check' | 'arrowRight' | 'circle' {
  switch (entry.status) {
    case 'completed':
      return 'check';
    case 'in_progress':
      return 'arrowRight';
    default:
      return 'circle';
  }
}
```

2c. `renderPlanList` 的 marker 行替换为:

```tsx
          <SessionIcon name={planStepIconName(entry)} className="chat-plan-step-marker" />
```

2d. 新增进度轨组件(文件内,`renderCompactTrigger` 之前):

```tsx
function PlanProgressTrack({plan}: {plan: ChatPlanSnapshot}) {
  if (plan.totalCount <= 0) {
    return null;
  }
  if (plan.totalCount > PLAN_SEGMENT_TRACK_MAX_STEPS) {
    const percent = Math.round((plan.completedCount / plan.totalCount) * 100);
    const active = plan.completedCount < plan.totalCount;
    return (
      <span className={`chat-plan-progress-track continuous${active ? ' active' : ''}`} aria-hidden="true">
        <span className="chat-plan-progress-track-fill" style={{width: `${percent}%`}} />
      </span>
    );
  }
  return (
    <span className="chat-plan-progress-track segmented" aria-hidden="true">
      {plan.entries.map((entry, index) => (
        <span
          key={`${plan.turnIndex}:${index}`}
          className={`chat-plan-progress-segment ${planStepClassName(entry)}`}
        />
      ))}
    </span>
  );
}
```

2e. `compactChevronClassName` 删除;`renderCompactTrigger` 中 marker 与 chevron 替换为:

```tsx
      <SessionIcon
        name={activeEntry ? planStepIconName(activeEntry) : 'listChecks'}
        className={`chat-plan-compact-marker${activeEntry ? ` ${planStepClassName(activeEntry)}` : ''}`}
      />
      <span className="chat-plan-progress">{progressLabel}</span>
      <span className="chat-plan-current">{activeEntry?.content ?? ''}</span>
      <SessionIcon
        name={mode === 'desktop' ? (expanded ? 'chevronUp' : 'chevronDown') : (expanded ? 'chevronDown' : 'chevronUp')}
        className="chat-plan-compact-chevron"
      />
```

(保持原 `compactChevronClassName` 的桌面/移动方向语义:desktop 展开时 up、收起时 down;mobile 反之。)

2f. 桌面 header 的 `actions` 替换为:

```tsx
            actions={
              <span className="chat-plan-header-progress">
                <PlanProgressTrack plan={plan} />
                <span className="chat-plan-progress">{progressLabel}</span>
              </span>
            }
```

2g. 自查:`rg codicon app/web/src/chat/ChatPlanSurface.tsx` 应为零结果。

- [ ] **Step 3: chat.css — 进度轨 + 标记 + 脉动 + pill 毛玻璃**

3a. `.chat-plan-step-marker`(2651–2660)改为(svg 盒子,去掉 font 属性与 `!important`):

```css
.chat-plan-step-marker {
  width: 16px;
  height: 18px;
  color: var(--text-secondary);
}
```

3b. 两条 codicon  keyed 颜色规则(2662–2670)替换为:

```css
.chat-plan-step.in-progress .chat-plan-step-marker,
.chat-plan-compact-marker.in-progress {
  color: var(--state-warning);
}

.chat-plan-step.in-progress .chat-plan-step-marker {
  animation: chat-plan-pulse 1.6s var(--ease-standard) infinite;
}

.chat-plan-step.completed .chat-plan-step-marker,
.chat-plan-compact-marker.completed {
  color: var(--state-success);
}
```

3c. `.chat-plan-compact-marker, .chat-plan-compact-chevron`(2732–2735 附近,font-size 规则)替换为:

```css
.chat-plan-compact-marker {
  color: var(--text-secondary);
}

.chat-plan-compact-chevron {
  color: var(--text-secondary);
}
```

3d. `.chat-plan-compact-trigger`(2690–2708)材质替换为毛玻璃(几何/网格不动,仅改 border/background/box-shadow 三行 + 新增 backdrop-filter 两行):

```css
  border: 1px solid var(--border-faint);
  background: color-mix(in srgb, var(--surface-overlay) 88%, transparent);
  backdrop-filter: blur(12px) saturate(1.1);
  -webkit-backdrop-filter: blur(12px) saturate(1.1);
  box-shadow: var(--shadow-floating);
```

其 hover 块(2722–2725)的 background 改为 `color-mix(in srgb, var(--surface-overlay) 96%, transparent);`(border-color accent 行保留)。

3e. 5371 的 reduced-transparency 块选择器列表中追加 `.chat-plan-compact-trigger,`(放在 `.chat-plan-surface.mobile.expanded,` 之后)。

3f. 进度轨与脉动,追加在 `.chat-plan-progress` 规则(2612–2618)之后:

```css
.chat-plan-header-progress {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.chat-plan-progress-track {
  display: inline-flex;
  align-items: center;
  height: 3px;
  min-width: 0;
}

.chat-plan-progress-track.segmented {
  gap: 2px;
}

.chat-plan-progress-segment {
  width: 8px;
  height: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-secondary) 22%, transparent);
}

.chat-plan-progress-segment.completed {
  background: var(--state-success);
}

.chat-plan-progress-segment.in-progress {
  background: var(--state-warning);
  animation: chat-plan-pulse 1.6s var(--ease-standard) infinite;
}

.chat-plan-progress-track.continuous {
  width: 48px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-secondary) 22%, transparent);
}

.chat-plan-progress-track-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--accent-primary);
}

.chat-plan-progress-track.continuous.active .chat-plan-progress-track-fill {
  animation: chat-plan-pulse 1.6s var(--ease-standard) infinite;
}

@keyframes chat-plan-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

@media (prefers-reduced-motion: reduce) {
  .chat-plan-step.in-progress .chat-plan-step-marker,
  .chat-plan-progress-segment.in-progress,
  .chat-plan-progress-track.continuous.active .chat-plan-progress-track-fill {
    animation: none;
  }
}
```

3g. Plan 列表展开动画:`.chat-plan-surface-list`(2620–2626)追加一行 `animation: sl-list-in 140ms var(--ease-out);`,并把 `.chat-plan-surface-list` 加进 3f 的 reduced-motion 块选择器(即该块再加一行 `.chat-plan-surface-list,` —— 注意放在 `.chat-plan-step.in-progress .chat-plan-step-marker,` 之前保持分组可读)。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app; npx jest __tests__/web-chat-plan-surface.test.tsx; npm run tsc:web`
Expected: PASS(含既有折叠/几何测试)。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/chat/ChatPlanSurface.tsx app/web/src/styles/chat.css app/__tests__/web-chat-plan-surface.test.tsx
git commit -m "feat(app): plan progress track and Lucide step markers"
```

---

### Task 7: Monitor 表面 — tabs 发丝边分段控件 + 动作图标 + sl-icon-spin

**Files:**
- Modify: `app/web/src/usage/MonitorSurface.tsx`
- Modify: `app/web/src/usage/MobileUsageDialog.tsx`
- Modify: `app/web/src/styles/usage.css`
- Test: `app/__tests__/web-usage-feature-surface.test.tsx`

- [ ] **Step 1: 更新测试(先失败)**

1a. `web-usage-feature-surface.test.tsx` 中三处 `'spinning'` 断言(约 123、414、434 行)`toContain('spinning')` 全部改为 `toContain('sl-icon-spin')`。

1b. `renders Monitor tabs as visible segmented toggles on desktop and mobile` 测试(464–480)整体替换为:

```tsx
  it('renders Monitor tabs as hairline segmented controls on desktop and mobile', () => {
    const projectRoot = path.join(__dirname, '..');
    const styles = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles', 'usage.css'), 'utf8').replace(/\r\n/g, '\n');
    const desktopTrack = styles.match(/\.monitor-tabs \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const desktopSelected = styles.match(/\.monitor-tabs button\[aria-selected='true'\] \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const mobileTrack = styles.match(/\.usage-mobile-tabs \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const mobileSelected = styles.match(/\.usage-mobile-tabs button\[aria-selected='true'\] \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(desktopTrack).toContain('background: transparent;');
    expect(desktopTrack).toContain('border: 1px solid');
    expect(desktopSelected).toContain('background: var(--accent-soft-bg);');
    expect(desktopSelected).toContain('color: var(--accent-primary);');
    expect(desktopSelected).not.toContain('inset 0 0 0 1px');
    expect(mobileTrack).toContain('background: transparent;');
    expect(mobileTrack).toContain('border: 1px solid');
    expect(mobileSelected).toContain('background: var(--accent-soft-bg);');
    expect(mobileSelected).toContain('color: var(--accent-primary);');
    expect(mobileSelected).not.toContain('inset 0 0 0 1px');
    expect(styles).not.toContain('--surface-root');
    expect(styles).not.toContain('usage-spin');
  });
```

1c. `MonitorSurface module` describe 内新增:

```tsx
  it('uses Lucide icons for the shared monitor actions', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <MonitorSurface
          usageSnapshot={fixtureSnapshot}
          efficiencySnapshot={efficiencySnapshot}
          onRefreshLimits={jest.fn()}
          onRefreshIq={jest.fn()}
          onRequestHide={jest.fn()}
        />,
      );
    });

    expect(view!.root.findByProps({'aria-label': 'Hide monitor'}).findByType('svg').props['data-icon-name']).toBe('eyeOff');
    expect(view!.root.findByProps({'aria-label': 'Show monitor details'}).findByType('svg').props['data-icon-name']).toBe('layoutGrid');
    expect(view!.root.findByProps({'aria-label': 'Refresh monitor'}).findByType('svg').props['data-icon-name']).toBe('refreshCw');
    expect(view!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('codicon'))).toHaveLength(0);
  });
```

1d. `UsageFeatureSurface` describe 内新增(移动弹窗图标):

```tsx
  it('uses Lucide icons for the mobile monitor actions', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <MobileUsageDialog
          snapshot={fixtureSnapshot}
          efficiencySnapshot={efficiencySnapshot}
          onRefresh={jest.fn()}
          onRefreshEfficiency={jest.fn()}
          onClose={jest.fn()}
        />,
      );
    });

    expect(view!.root.findByProps({'aria-label': 'Refresh monitor'}).findByType('svg').props['data-icon-name']).toBe('refreshCw');
    expect(view!.root.findByProps({'aria-label': 'Close monitor'}).findByType('svg').props['data-icon-name']).toBe('x');
    expect(view!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('codicon'))).toHaveLength(0);
  });
```

Run: `cd app; npx jest __tests__/web-usage-feature-surface.test.tsx`
Expected: FAIL。

- [ ] **Step 2: MonitorSurface.tsx**

顶部追加 `import {SessionIcon} from '../chat/sessionlist/SessionIcon';`。三个动作的 `<span className="codicon ..." />` 替换:

- Hide:`<SessionIcon name="eyeOff" />`
- Detail toggle:`<SessionIcon name={detail ? 'list' : 'layoutGrid'} />`
- Refresh:`<SessionIcon name="refreshCw" spin={refreshing} />`

- [ ] **Step 3: MobileUsageDialog.tsx**

顶部追加 `import {SessionIcon} from '../chat/sessionlist/SessionIcon';`。Refresh → `<SessionIcon name="refreshCw" spin={refreshing} />`;Close → `<SessionIcon name="x" />`。

- [ ] **Step 4: usage.css**

4a. `.chat-function-action`(23–35)改 22px ghost:

```css
.chat-function-action {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
```

其 hover(37)改为 `.chat-function-action:hover { background: var(--hover); color: var(--text-primary); }`;删除 `.chat-function-action .spinning { ... }`(39)。

4b. `.monitor-tabs`(49–59)改透明轨:`background: transparent;`(删除 `--surface-root` 行,border/padding 其余不动);`.monitor-tabs button`(61–73)删除 `font-family: 'IBM Plex Sans', sans-serif;` 一行;选中态(88–94)改为:

```css
.monitor-tabs button[aria-selected='true'] {
  background: var(--accent-soft-bg);
  color: var(--accent-primary);
  box-shadow: none;
}
```

4c. `.usage-mobile-tabs`(210–221)`background` 改 `transparent;`;选中态(233–240)改为:

```css
.usage-mobile-tabs button[aria-selected='true'] {
  background: var(--accent-soft-bg);
  color: var(--accent-primary);
  box-shadow: none;
}
```

4d. `.usage-mobile-action` 的 `:active`(207)改为 `.usage-mobile-action:active { background: var(--hover); color: var(--text-primary); }`;删除 `.usage-mobile-action .spinning { ... }`(208)。

4e. 删除 `@keyframes usage-spin`(247)与 reduced-motion 块中的两条 `.spinning` 规则(249–252,整个媒体块随之删除——它只装这两条)。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd app; npx jest __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-workspace-integration.test.tsx; npm run tsc:web`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add app/web/src/usage/MonitorSurface.tsx app/web/src/usage/MobileUsageDialog.tsx app/web/src/styles/usage.css app/__tests__/web-usage-feature-surface.test.tsx
git commit -m "feat(app): hairline monitor tabs and Lucide monitor actions"
```

---

### Task 8: Limits 内容 — 纯 accent rail + state token + 行层级 + detail 拍平

**Files:**
- Modify: `app/web/src/styles/usage.css`
- Test: `app/__tests__/web-usage-feature-surface.test.tsx`

组件 JSX 零改动(现有 class 钩子足够:tone 行 label 用 `.usage-limit-line.tone-* .usage-limit-label` 染色)。

- [ ] **Step 1: 更新测试(先失败)**

`UsageFeatureSurface` describe 内新增:

```tsx
  it('uses the unified type scale and token colors for Limits content', () => {
    const projectRoot = path.join(__dirname, '..');
    const styles = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles', 'usage.css'), 'utf8').replace(/\r\n/g, '\n');
    const rule = (selector: string) => styles.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';

    expect(rule('.usage-quota-rail > span')).toContain('background: var(--accent-primary);');
    expect(styles).not.toContain('--status-warning');
    expect(styles).not.toContain('--status-danger');

    const warningStrong = styles.match(/\.usage-compact-limit\.tone-warning \.usage-compact-limit-value strong,\n\.usage-limit-line\.tone-warning strong \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(warningStrong).toContain('color: var(--state-warning);');
    const warningLabel = styles.match(/\.usage-limit-line\.tone-warning \.usage-limit-label \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(warningLabel).toContain('color: var(--state-warning);');
    const dangerStrong = styles.match(/\.usage-compact-limit\.tone-danger \.usage-compact-limit-value strong,\n\.usage-limit-line\.tone-danger strong \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(dangerStrong).toContain('color: var(--state-danger);');
    const dangerLabel = styles.match(/\.usage-limit-line\.tone-danger \.usage-limit-label \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(dangerLabel).toContain('color: var(--state-danger);');

    expect(rule('.usage-provider-name')).toContain('color: var(--text-primary);');
    expect(rule('.usage-compact-limit-value')).toContain('color: var(--text-tertiary);');
    expect(rule('.usage-compact-limit-value')).toContain('font-size: 10px;');
    expect(rule('.usage-compact-limit-value strong')).toContain('font-size: 11px;');
    expect(rule('.usage-limit-label')).toContain('font-size: 10px;');
    expect(rule('.usage-account-hub')).toContain('font-size: 10px;');
    expect(rule('.usage-account-hub')).toContain('background: transparent;');
    expect(rule('.usage-account-card')).not.toContain('border: 1px solid');
    expect(rule('.usage-account-card')).toContain('background: transparent;');
    expect(styles).toContain('.usage-account-card + .usage-account-card {');
  });
```

Run: `cd app; npx jest __tests__/web-usage-feature-surface.test.tsx`
Expected: FAIL。

- [ ] **Step 2: usage.css 内容段重写**

2a. 行层级(108–119 区域内逐条改):

- `.usage-provider-name` 追加 `color: var(--text-primary);`(11px/650 已具备)。
- `.usage-compact-limit-value` 改为:`color: var(--text-tertiary); font-size: 10px;`(删 `font-family: 'JetBrains Mono', monospace;`,保留 display/gap/tabular-nums)。
- `.usage-compact-limit-value strong` 改为:`color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 620;`(保留 tabular-nums 继承)。
- `.usage-provider-balance` 的 `font-size: 10px` 改 `11px`(mono/text-primary 保留)。
- `.usage-provider-empty` 的 `color: var(--text-secondary)` 改 `var(--text-tertiary)`。
- `.usage-quota-rail > span` 的 background 改为 `var(--accent-primary);`。

2b. tone 段(120–127)整体替换为:

```css
.usage-compact-limit.tone-warning .usage-compact-limit-value strong,
.usage-limit-line.tone-warning strong { color: var(--state-warning); }
.usage-compact-limit.tone-warning .usage-quota-rail > span,
.usage-limit-line.tone-warning .usage-quota-rail > span { background: var(--state-warning); }
.usage-limit-line.tone-warning .usage-limit-label { color: var(--state-warning); }
.usage-compact-limit.tone-danger .usage-compact-limit-value strong,
.usage-limit-line.tone-danger strong { color: var(--state-danger); }
.usage-compact-limit.tone-danger .usage-quota-rail > span,
.usage-limit-line.tone-danger .usage-quota-rail > span { background: var(--state-danger); }
.usage-limit-line.tone-danger .usage-limit-label { color: var(--state-danger); }
```

2c. detail 段(129–144 区域):

- `.usage-account-card` 改为:

```css
.usage-account-card { padding: 7px 2px 6px; border: 0; border-radius: 0; background: transparent; }
.usage-account-card + .usage-account-card { border-top: 1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent); }
```

- `.usage-account-title` 的 `color: var(--text-secondary)` 改 `var(--text-primary)`(strong 11px/650 不动)。
- `.usage-account-hub` 改为:`background: transparent; color: var(--text-tertiary); font-size: 10px;`(mono、发丝边、999px、line-height 14px 保留)。
- `.usage-limit-line` 的 `color: var(--text-secondary); font-size: 9px;` 改为 `color: var(--text-tertiary); font-size: 10px;`。
- `.usage-limit-label` 改为:`font-size: 10px;`(删 `font-family: 'JetBrains Mono', monospace;`)。
- `.usage-limit-line strong` 不动(已是 11px mono text-primary)。

2d. 移动端覆盖(243–246):`.usage-mobile-body .usage-account-card { padding: 10px 11px 9px; border-radius: 10px; }` 改为 `.usage-mobile-body .usage-account-card { padding: 10px 2px 9px; border-radius: 0; }`。

- [ ] **Step 3: 跑测试确认通过**

Run: `cd app; npx jest __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-workspace-integration.test.tsx`
Expected: PASS(既有渲染断言:文案、rail 宽度 style、data 属性均不受影响)。

- [ ] **Step 4: Commit**

```bash
git add app/web/src/styles/usage.css app/__tests__/web-usage-feature-surface.test.tsx
git commit -m "feat(app): limits content hierarchy and token state colors"
```

---

### Task 9: IQ 内容 — 家族色单层化 + score 收敛 + detail 拍平 + 骨架条

**Files:**
- Modify: `app/web/src/styles/modelEfficiency.css`
- Modify: `app/web/src/modelEfficiency/ModelEfficiencyContent.tsx`(loading 分支)
- Test: `app/__tests__/web-model-efficiency-surface.test.tsx`

- [ ] **Step 1: 更新测试(先失败)**

1a. `uses compact split score cards with muted side accents` 测试改为(测试名也换):

```tsx
  test('uses single-layer family tint score cards', () => {
    const projectRoot = path.join(__dirname, '..');
    const styles = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'styles', 'modelEfficiency.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    const recommendationRule = styles.match(/\.model-efficiency-recommendation \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const familyRule = styles.match(/\.model-efficiency-family-row \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const modelNameRule = styles.match(/\.model-efficiency-model-name \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const scoreRule = styles.match(/\.model-efficiency-score \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const metaRule = styles.match(/\.model-efficiency-meta span \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(recommendationRule).toContain('grid-template-areas:');
    expect(recommendationRule).toContain('grid-template-rows: 20px 34px;');
    expect(recommendationRule).toContain('grid-template-columns: minmax(0, 1fr) 47px;');
    expect(recommendationRule).toContain('var(--model-efficiency-family-color) 30%');
    expect(recommendationRule).toContain('var(--model-efficiency-family-color) 3%');
    expect(recommendationRule).not.toContain('inset 3px 0 0');
    expect(recommendationRule).not.toContain('box-shadow');
    expect(familyRule).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(modelNameRule).toContain('padding: 7px 3px 1px 6px;');
    expect(modelNameRule).toContain('font-size: 10px;');
    expect(modelNameRule).not.toContain('text-overflow: ellipsis;');
    expect(modelNameRule).not.toContain('IBM Plex Sans');
    expect(scoreRule).toContain('font-size: clamp(18px, 1.35vw, 20px);');
    expect(scoreRule).toContain('font-weight: 700;');
    expect(scoreRule).toContain('letter-spacing: -0.02em;');
    expect(scoreRule).toContain('var(--model-efficiency-family-color) 58%');
    expect(metaRule).toContain('font-size: 10px;');
    expect(styles).not.toContain('--status-danger');
  });
```

1b. 同 describe 新增:

```tsx
  test('flattens detail families into hairline groups and shows a skeleton while loading', () => {
    const projectRoot = path.join(__dirname, '..');
    const styles = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'styles', 'modelEfficiency.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    const familyCardRule = styles.match(/\.model-efficiency-detail-family \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(familyCardRule).not.toContain('border: 1px solid');
    expect(familyCardRule).not.toContain('background:');
    expect(styles).toContain('.model-efficiency-detail-family + .model-efficiency-detail-family {');
    const tableRule = styles.match(/\.model-efficiency-detail-family table \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(tableRule).toContain('font-size: 10px;');
    expect(tableRule).toContain("font-family: 'JetBrains Mono', monospace;");
    expect(styles).toContain('.model-efficiency-skeleton-rail {');
  });
```

1c. 渲染行为测试(该文件已有 react-test-renderer 渲染模式,新增;`ModelEfficiencySnapshotContent` 若未 import 则扩展既有 import):

```tsx
  test('renders three skeleton rows while loading', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <ModelEfficiencySnapshotContent
          snapshot={{status: 'loading', refreshing: true, items: []}}
          mode="simple"
          onRetry={jest.fn()}
        />,
      );
    });

    expect(view!.root.findAllByProps({className: 'model-efficiency-skeleton-row'})).toHaveLength(3);
    expect(view!.root.findAllByProps({className: 'model-efficiency-skeleton-rail'})).toHaveLength(9);
    expect(renderedText(view!.root)).not.toContain('Loading CodexRadar');
  });
```

Run: `cd app; npx jest __tests__/web-model-efficiency-surface.test.tsx`
Expected: FAIL。

- [ ] **Step 2: modelEfficiency.css**

2a. `.model-efficiency-recommendation`(37–51)材质三行替换:border 改 `1px solid color-mix(in srgb, var(--model-efficiency-family-color) 30%, transparent);`;background 改 `color-mix(in srgb, var(--model-efficiency-family-color) 3%, var(--surface-panel));`;删除 `box-shadow: inset 3px 0 0 ...;`。

2b. `.model-efficiency-model-name`(53–62):删 `font-family: 'IBM Plex Sans', sans-serif;`;`font-size: 9.5px` 改 `10px`。

2c. `.model-efficiency-score`(64–76):`font-weight: 760` 改 `700`;`letter-spacing: -.055em` 改 `-0.02em`(clamp 与 family 58% 不动)。

2d. `.model-efficiency-meta span`(85–95):`font-size: 10.5px` 改 `10px`。

2e. `.model-efficiency-detail-family`(110–115)改为拍平 + 组间发丝线:

```css
.model-efficiency-detail-family {
  overflow: hidden;
}

.model-efficiency-detail-family + .model-efficiency-detail-family {
  padding-top: 5px;
  border-top: 1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent);
}
```

h3(117–122)`font-weight: 680` 改 `650`;表格(1–10)`font-size: 9px` 改 `10px`(mono 保留——纯数据位)。

2f. 状态色与字号:`.model-efficiency-state.error`(151)`color: var(--status-danger, #e16d76)` 改 `color: var(--state-danger);`;`.model-efficiency-inline-error`(163–169)两处 `var(--status-danger, #e16d76)` 改 `var(--state-danger)`,`font-size: 9px` 改 `10px`。

2g. 骨架条(文件末尾追加):

```css
.model-efficiency-skeleton {
  display: grid;
  gap: 4px;
  padding: 6px 7px 7px;
}

.model-efficiency-skeleton-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}

.model-efficiency-skeleton-rail {
  display: block;
  height: 54px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--text-secondary) 14%, transparent);
  animation: model-efficiency-skeleton-breathe 1.6s var(--ease-standard) infinite;
}

@keyframes model-efficiency-skeleton-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@media (prefers-reduced-motion: reduce) {
  .model-efficiency-skeleton-rail {
    animation: none;
  }
}
```

- [ ] **Step 3: ModelEfficiencyContent.tsx — loading 骨架**

`ModelEfficiencySnapshotContent` 的 loading 分支:

```tsx
    if (snapshot.status === 'idle' || snapshot.status === 'loading') {
      return <div className="model-efficiency-state">Loading CodexRadar data…</div>;
    }
```

替换为:

```tsx
    if (snapshot.status === 'idle' || snapshot.status === 'loading') {
      return (
        <div className="model-efficiency-skeleton" aria-label="Loading model efficiency">
          {MODEL_FAMILIES.map(family => (
            <span className="model-efficiency-skeleton-row" key={family}>
              <span className="model-efficiency-skeleton-rail" />
              <span className="model-efficiency-skeleton-rail" />
              <span className="model-efficiency-skeleton-rail" />
            </span>
          ))}
        </div>
      );
    }
```

(`MODEL_FAMILIES` 已在文件内 import。)error 分支与 Retry 不动。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app; npx jest __tests__/web-model-efficiency-surface.test.tsx __tests__/web-model-efficiency-workspace-integration.test.tsx __tests__/web-usage-feature-surface.test.tsx; npm run tsc:web`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add app/web/src/styles/modelEfficiency.css app/web/src/modelEfficiency/ModelEfficiencyContent.tsx app/__tests__/web-model-efficiency-surface.test.tsx
git commit -m "feat(app): single-layer IQ family tint and loading skeleton"
```

---

### Task 10: 范围清扫 + 全量验证

**Files:** 无新增改动(发现问题就回到对应任务修)。

- [ ] **Step 1: codicon 范围清扫**

Run(仓库根目录):

```bash
rg -n "codicon" app/web/src/chat/ChatPlanSurface.tsx app/web/src/usage/MonitorSurface.tsx app/web/src/usage/MobileUsageDialog.tsx
rg -n "codicon" app/web/src/app/WorkspaceApp.tsx | rg -n "172[0-9]{2}|173[0-9]{2}|187[3-9]{2}|188[0-1]{2}"
```

Expected: 第一条零结果;第二条只可能命中范围外行(顶栏段 17204–17334 与项目菜单 18737–18816 内必须零 codicon;若行号因编辑漂移,改用内容定位:`rg -n "codicon" app/web/src/app/WorkspaceApp.tsx | rg "codicon-chevron-down|codicon-history|codicon-search|codicon-layout-sidebar-right|codicon-add"` 应对顶栏段零结果——允许命中的只有范围外的 18928 附近 mobile 快捷菜单与 18979 附近手势 pill,以及 file/git/composer 区)。

- [ ] **Step 2: 失效变量与冗余字体清扫**

```bash
rg -n "status-warning|status-danger|surface-root" app/web/src --glob '!**/dist/**'
rg -n "IBM Plex Sans" app/web/src/styles/usage.css app/web/src/styles/modelEfficiency.css
rg -n "usage-spin" app/web/src --glob '!**/dist/**'
```

Expected: 全部零结果。

- [ ] **Step 3: 全量测试 + 类型检查**

```bash
cd app; npx jest; npm run tsc:web
```

Expected: 全部 PASS。若其他测试文件因共享选择器变动挂掉(例如 `web-chat-recent-sessions-ui.test.ts`、`web-ui-design-system.test.ts`),回到对应任务按同一视觉语言修断言,不要改实现迎合旧断言。

- [ ] **Step 4: 构建冒烟**

```bash
cd app; npm run build:web
```

Expected: webpack 编译成功(产物输出到 `~/.wheelmaker/web`,不提交)。

- [ ] **Step 5: 最终提交与推送(Completion Gate)**

```bash
git add -A
git commit -m "feat(app): complete floating chrome visual upgrade" || git log -1 --oneline
git push origin feat/floating-chrome-visual-upgrade
```

(若 Step 1–4 无遗留改动,commit 会因 nothing to commit 失败——此时跳过 commit 直接 push。)
