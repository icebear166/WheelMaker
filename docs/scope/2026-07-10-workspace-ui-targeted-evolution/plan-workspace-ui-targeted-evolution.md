# Workspace UI Targeted Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 WheelMaker Workspace 功能、信息架构、宽窄两档响应式和核心交互的前提下，统一视觉基础并定向升级壳层、会话侧栏、Chat、输入区、Settings 与公共状态，优先保证 360–430px 竖屏移动端体验。

**Architecture:** 保留现有 React 组件边界和原生 CSS 架构，新增一个最先加载的语义 Token 层，再由 `base.css`、`shell.css`、`chat.css`、`settings.css` 消费。仅在现有 DOM 无法表达可访问状态或安全的新消息动效时增加最小标记；不改 Registry 协议、状态机、缓存或页面信息架构。File/Git 不做页面级改造，只参与最终回归验证。

**Tech Stack:** React 19、TypeScript 5.8、原生 CSS、Webpack 5、Jest 30、react-test-renderer、react-virtuoso、Codicon

## 执行结果（2026-07-11）

- Tasks 1–8 已按计划实施并分别提交；Task 9 的类型检查、全量测试、生产构建与可用浏览器矩阵均通过。
- `tsc:web` exit code 0；Jest 160/160 suites、779/779 tests 通过；`build:web` exit code 0。
- 360x800、390x844、430x932 的深浅主题实测均无横向溢出，连接页表面、控件和错误状态正常适配。
- 本机 `127.0.0.1:9630` 未运行 Registry，因此已连接状态的人工点击矩阵由 Chat、Settings、移动端返回、输入区、动效和 File/Git 边界自动化测试代替验证。
- File/Git 页面专属样式与组件未修改。

---

## 实施约束

- 所有命令默认从仓库根目录 `D:\Code\WheelMaker` 执行。
- 严格保持现有宽屏/窄屏两档，不增加第三档布局判断或新的 JavaScript breakpoint。
- 保持侧栏顺序、搜索位置、项目分组、按项目新建会话入口和所有会话行为不变。
- 保持 Chat 消息顺序和类型不变；`agent_plan` 继续不进入正文，Tool call 继续是一行。
- 保持输入区两层 DOM、`/`、`@`、附件、语音、模型、推理强度和上下文入口不变；发送/语音按钮仍为 `36px`，工具按钮仍为 `24px`，Codicon 尺寸不变。
- 不编辑 `app/web/src/styles/file.css`、`app/web/src/styles/git.css` 或 File/Git 页面组件。
- 每个任务先写失败测试，再做最小实现；不得通过放宽既有结构断言来“修复”测试。
- 每次提交只包含当前任务列出的文件。工作区存在其他用户改动时，使用精确 `git add <paths>`，不要把无关改动带入提交。

## 文件结构

### 新增

- `app/web/src/styles/tokens.css`：深浅主题语义颜色、表面、边框、圆角、阴影、焦点和动效 Token，以及现有变量的兼容映射。
- `app/__tests__/web-ui-design-system.test.ts`：公共 Token、交互状态、范围边界和减弱动效的源结构回归测试。

### 修改

- `app/web/src/styles/index.css`：最先加载 `tokens.css`。
- `app/testHelpers/webStyles.ts`：让测试按生产顺序读取 Token。
- `app/web/src/styles/base.css`：公共焦点、按钮/输入状态、连接页和反馈状态。
- `app/web/src/styles/shell.css`：壳层、桌面侧栏、移动抽屉、浮动控件和页面/菜单过渡。
- `app/web/src/styles/chat.css`：侧栏内容、消息阅读层级、单行 Tool call、输入区和窄屏适配。
- `app/web/src/styles/settings.css`：Settings 标题、分组、行、控件、危险态和移动快捷栏视觉。
- `app/web/src/app/WorkspaceApp.tsx`：连接状态的可访问属性；不改变连接调用和其他业务逻辑。
- `app/web/src/chat/turns/ChatVirtuosoTurnList.tsx`：仅为运行时新增的尾部消息提供一次性进入标记。
- `app/__tests__/web-chat-ui.test.ts`：侧栏、消息、输入区尺寸及窄屏不变量。
- `app/__tests__/web-chat-turn-rendering.test.ts`：消息类型、Tool call、计划排除和减弱动效断言。
- `app/__tests__/web-chat-virtuoso-mount.test.tsx`：尾部新消息动效不在初始加载或虚拟列表重挂载时误播。
- `app/__tests__/web-responsive-shell.test.ts`：两档壳层、抽屉和连接页结构。
- `app/__tests__/web-settings-navigation.test.ts`：Settings 顺序与视觉钩子。

## Task 1: 建立语义 Token 与范围护栏

**Files:**

- Create: `app/web/src/styles/tokens.css`
- Create: `app/__tests__/web-ui-design-system.test.ts`
- Modify: `app/web/src/styles/index.css`
- Modify: `app/testHelpers/webStyles.ts`
- Modify: `app/web/src/styles/chat.css:1`

- [ ] **Step 1: 写公共 Token 与排除范围的失败测试**

在 `app/__tests__/web-ui-design-system.test.ts` 写入：

```ts
import fs from 'fs';
import path from 'path';

const appRoot = path.resolve(__dirname, '..');
const stylesRoot = path.join(appRoot, 'web', 'src', 'styles');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

describe('workspace visual foundation', () => {
  test('loads semantic tokens before every surface stylesheet', () => {
    const index = read('web/src/styles/index.css');
    const helper = read('testHelpers/webStyles.ts');
    expect(index.split('\n')[0]).toBe("@import './tokens.css';");
    expect(helper).toMatch(/const STYLE_ENTRY_ORDER = \[\s*'tokens\.css',/);
  });

  test('defines matching dark and light semantic token families', () => {
    const tokens = read('web/src/styles/tokens.css');
    for (const token of [
      '--surface-canvas',
      '--surface-panel',
      '--surface-raised',
      '--text-primary',
      '--text-secondary',
      '--border-subtle',
      '--accent-primary',
      '--state-danger',
      '--focus-ring-color',
      '--motion-standard',
    ]) {
      expect(tokens.match(new RegExp(`${token}:`, 'g'))).toHaveLength(2);
    }
    expect(tokens).toContain('.theme-light {');
  });

  test('keeps File and Git out of page-specific redesign work', () => {
    const index = read('web/src/styles/index.css');
    expect(index).toContain("@import './file.css';");
    expect(index).toContain("@import './git.css';");
    expect(read('web/src/styles/file.css')).not.toContain('workspace-ui-targeted-evolution');
    expect(read('web/src/styles/git.css')).not.toContain('workspace-ui-targeted-evolution');
  });
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-ui-design-system.test.ts
```

Expected: FAIL，提示 `tokens.css` 不存在或首个 import 不是 `tokens.css`。

- [ ] **Step 3: 新增完整 Token 文件并迁移旧变量**

创建 `app/web/src/styles/tokens.css`：

```css
:root {
  color-scheme: dark;
  --surface-canvas: #191c21;
  --surface-sidebar: #20242a;
  --surface-panel: #242930;
  --surface-raised: #2a3038;
  --surface-overlay: #303741;
  --text-primary: #dce1e7;
  --text-secondary: #9aa4af;
  --text-tertiary: #747f8b;
  --border-subtle: #343b45;
  --border-strong: #48515e;
  --accent-primary: #2784c7;
  --accent-hover: #3492d4;
  --state-success: #58a86d;
  --state-warning: #d0a24f;
  --state-danger: #e2767f;
  --state-info: #65a3d8;
  --focus-ring-color: color-mix(in srgb, var(--accent-primary) 72%, white);
  --shadow-floating: 0 8px 24px rgb(3 8 15 / 22%);
  --shadow-overlay: 0 16px 40px rgb(3 8 15 / 34%);
  --radius-control: 6px;
  --radius-panel: 10px;
  --radius-floating: 12px;
  --motion-fast: 120ms;
  --motion-standard: 180ms;
  --motion-emphasized: 240ms;
  --ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);

  --bg: var(--surface-canvas);
  --panel: var(--surface-sidebar);
  --panel-2: var(--surface-raised);
  --panel-3: var(--surface-panel);
  --text: var(--text-primary);
  --muted: var(--text-secondary);
  --border: var(--border-subtle);
  --accent: var(--accent-primary);
  --hover: rgb(255 255 255 / 6%);
  --soft-shadow: var(--shadow-floating);
  --danger: var(--state-danger);
  --line-num: var(--text-tertiary);
  --chat-message-text: #e0e4e9;
  --wm-safe-area-top: env(safe-area-inset-top, 0px);
  --wm-safe-area-right: env(safe-area-inset-right, 0px);
  --wm-safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --mobile-floating-control-lane: 56px;
}

.theme-light {
  color-scheme: light;
  --surface-canvas: #eef1f4;
  --surface-sidebar: #f6f7f9;
  --surface-panel: #ffffff;
  --surface-raised: #e8ecf1;
  --surface-overlay: #ffffff;
  --text-primary: #20262d;
  --text-secondary: #687380;
  --text-tertiary: #87919c;
  --border-subtle: #d9dfe6;
  --border-strong: #bdc6d0;
  --accent-primary: #1478ba;
  --accent-hover: #0d6ca9;
  --state-success: #347d4b;
  --state-warning: #9b6a13;
  --state-danger: #c93c48;
  --state-info: #367fab;
  --focus-ring-color: color-mix(in srgb, var(--accent-primary) 78%, black);
  --shadow-floating: 0 8px 24px rgb(31 44 59 / 12%);
  --shadow-overlay: 0 16px 40px rgb(31 44 59 / 18%);
  --radius-control: 6px;
  --radius-panel: 10px;
  --radius-floating: 12px;
  --motion-fast: 120ms;
  --motion-standard: 180ms;
  --motion-emphasized: 240ms;
  --ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);

  --bg: var(--surface-canvas);
  --panel: var(--surface-sidebar);
  --panel-2: var(--surface-raised);
  --panel-3: var(--surface-panel);
  --text: var(--text-primary);
  --muted: var(--text-secondary);
  --border: var(--border-subtle);
  --accent: var(--accent-primary);
  --hover: rgb(21 31 43 / 6%);
  --soft-shadow: var(--shadow-floating);
  --danger: var(--state-danger);
  --line-num: var(--text-tertiary);
  --chat-message-text: #252c34;
}
```

从 `app/web/src/styles/chat.css` 删除原有开头的 `:root` 与 `.theme-light` 两个变量块，使变量只有一个来源。

- [ ] **Step 4: 按生产顺序加载 Token**

把 `app/web/src/styles/index.css` 改为：

```css
@import './tokens.css';
@import './base.css';
@import './shell.css';
@import './settings.css';
@import './portRelay.css';
@import './debug.css';
@import './file.css';
@import './git.css';
@import './chat.css';
@import './code.css';
@import './surfaces.css';
```

在 `app/testHelpers/webStyles.ts` 的 `STYLE_ENTRY_ORDER` 首项加入：

```ts
const STYLE_ENTRY_ORDER = [
  'tokens.css',
  'base.css',
  'shell.css',
  'settings.css',
  'portRelay.css',
  'debug.css',
  'file.css',
  'git.css',
  'chat.css',
  'code.css',
  'surfaces.css',
] as const;
```

- [ ] **Step 5: 运行测试与类型检查**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-ui-design-system.test.ts __tests__/web-chat-ui.test.ts
npm --prefix app run tsc:web
```

Expected: PASS。

- [ ] **Step 6: 提交 Token 基础**

```powershell
git add app/web/src/styles/tokens.css app/web/src/styles/index.css app/web/src/styles/chat.css app/testHelpers/webStyles.ts app/__tests__/web-ui-design-system.test.ts
git commit -m "style(web): establish semantic workspace tokens"
```

## Task 2: 统一公共控件、焦点与连接状态

**Files:**

- Modify: `app/__tests__/web-ui-design-system.test.ts`
- Modify: `app/__tests__/web-responsive-shell.test.ts`
- Modify: `app/web/src/styles/base.css`
- Modify: `app/web/src/app/WorkspaceApp.tsx:19393`

- [ ] **Step 1: 写交互状态和连接语义的失败测试**

向 `web-ui-design-system.test.ts` 增加：

```ts
test('defines keyboard focus, disabled, loading, empty and error feedback', () => {
  const base = read('web/src/styles/base.css');
  expect(base).toContain(':focus-visible');
  expect(base).toContain('outline: 2px solid var(--focus-ring-color);');
  expect(base).toContain('.button:disabled');
  expect(base).toContain('.feedback-state');
  expect(base).toContain('.feedback-state.error');
  expect(base).toContain('.feedback-state.loading');
});
```

向 `web-responsive-shell.test.ts` 的连接页测试增加：

```ts
expect(disconnectedReturn).toContain('aria-busy={autoConnecting}');
expect(disconnectedReturn).toContain('disabled={autoConnecting}');
expect(disconnectedReturn).toContain('role="alert"');
```

- [ ] **Step 2: 运行定向测试并确认失败**

```powershell
npm --prefix app test -- --runInBand __tests__/web-ui-design-system.test.ts __tests__/web-responsive-shell.test.ts
```

Expected: FAIL，缺少公共状态样式和连接页属性。

- [ ] **Step 3: 在 `base.css` 中替换公共控件与连接页样式**

保留现有尺寸，在 `base.css` 中用以下完整规则替换 `.connect`、`.input`、`.button`、`.error` 对应规则，并补充公共反馈：

```css
:where(
  button,
  input,
  select,
  textarea,
  [role='button'],
  [role='menuitem'],
  [role='menuitemradio'],
  [role='option'],
  [tabindex]
):focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 2px;
}

.connect {
  margin: auto;
  width: min(480px, calc(100vw - 32px));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-floating);
  background: var(--surface-panel);
  box-shadow: var(--shadow-floating);
  padding: 24px;
}

.connect h3 {
  margin: 0 0 14px;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.input {
  width: 100%;
  min-height: 36px;
  margin-top: 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
  background: var(--surface-canvas);
  color: var(--text-primary);
  padding: 8px 10px;
  font: inherit;
  transition: border-color var(--motion-fast) var(--ease-standard), background var(--motion-fast) var(--ease-standard);
}

.input:hover {
  border-color: var(--border-strong);
}

.input:focus {
  border-color: var(--accent-primary);
}

.button {
  margin-top: 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: var(--accent-primary);
  color: #fff;
  padding: 8px 16px;
  cursor: pointer;
  font: inherit;
  font-weight: 500;
  transition: background var(--motion-fast) var(--ease-standard), border-color var(--motion-fast) var(--ease-standard), opacity var(--motion-fast) var(--ease-standard);
}

.button:hover:not(:disabled) {
  background: var(--accent-hover);
}

.button:active:not(:disabled) {
  filter: brightness(0.94);
}

.button:disabled {
  cursor: default;
  opacity: 0.55;
}

.error,
.feedback-state.error {
  color: var(--state-danger);
}

.feedback-state {
  display: grid;
  justify-items: start;
  gap: 6px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: color-mix(in srgb, var(--surface-raised) 72%, transparent);
  color: var(--text-secondary);
}

.feedback-state.loading {
  animation: feedbackStatePulse 1.4s ease-in-out infinite;
}

@keyframes feedbackStatePulse {
  0%, 100% { opacity: 0.72; }
  50% { opacity: 1; }
}

@media (max-width: 520px) {
  .connect {
    width: calc(100vw - 24px);
    padding: 18px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .feedback-state.loading {
    animation: none;
  }
}
```

- [ ] **Step 4: 只给连接页增加状态语义，不改调用流程**

把 `WorkspaceApp.tsx` 的连接块改为：

```tsx
<div className="connect" aria-busy={autoConnecting}>
  <h3>Connect to WheelMaker Registry</h3>
  <input
    className="input"
    value={address}
    onChange={e => setAddress(e.target.value)}
    placeholder="127.0.0.1:9630 or ws://127.0.0.1:9630/ws"
  />
  <input
    className="input"
    value={token}
    onChange={e => setToken(e.target.value)}
    placeholder="Token (optional)"
  />
  <button
    className="button"
    disabled={autoConnecting}
    onClick={() => connect().catch(() => undefined)}
  >
    {autoConnecting ? 'Connecting...' : 'Connect'}
  </button>
  {error ? <div className="error" role="alert">{error}</div> : null}
</div>
```

- [ ] **Step 5: 验证并提交**

```powershell
npm --prefix app test -- --runInBand __tests__/web-ui-design-system.test.ts __tests__/web-responsive-shell.test.ts
npm --prefix app run tsc:web
git add app/web/src/styles/base.css app/web/src/app/WorkspaceApp.tsx app/__tests__/web-ui-design-system.test.ts app/__tests__/web-responsive-shell.test.ts
git commit -m "style(web): unify controls and connection states"
```

Expected: 测试和类型检查 PASS。

## Task 3: 升级壳层、会话侧栏与移动抽屉视觉

**Files:**

- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-responsive-shell.test.ts`
- Modify: `app/web/src/styles/shell.css`
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: 写侧栏结构与两档响应式护栏测试**

在 `web-chat-ui.test.ts` 增加断言，锁定搜索和按项目新建入口不被移动：

```ts
test('keeps sidebar search fixed in the title region and new sessions project-scoped', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
  const stylesCss = readWebStyles(projectRoot);
  expect(mainTsx).toContain("const chatSessionHeaderClassName = `sidebar-title-row chat-session-header");
  expect(mainTsx).toContain('{renderChatHeaderSearchControls()}');
  expect(mainTsx).toContain('className="chat-header-search-wrap"');
  expect(mainTsx).toContain('className="wide-project-action-btn"');
  expect(mainTsx).not.toContain('className="global-new-session"');
  expect(stylesCss).toContain('/* workspace-ui-targeted-evolution: session sidebar */');
});
```

在 `web-responsive-shell.test.ts` 增加完整测试：

```ts
test('keeps the existing two responsive modes while styling the mobile drawer', () => {
  const projectRoot = path.join(__dirname, '..');
  const stylesCss = readWebStyles(projectRoot);
  expect(stylesCss).toContain('@media (max-width: 900px)');
  expect(stylesCss).not.toMatch(/@media[^\{]+\(min-width:\s*901px\)[^\{]+\(max-width:/);
  expect(stylesCss).toContain('.drawer.show');
  expect(stylesCss).toContain('.drawer-overlay.show');
  expect(stylesCss).toContain('background: rgb(4 9 16 / 48%);');
});
```

- [ ] **Step 2: 运行测试并确认失败或暴露旧样式缺口**

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-ui.test.ts __tests__/web-responsive-shell.test.ts
```

- [ ] **Step 3: 在 `shell.css` 末尾增加统一壳层覆盖**

```css
/* workspace-ui-targeted-evolution: shell */
.workspace-left {
  border-right-color: var(--border-subtle);
  background: var(--surface-sidebar);
}

.sidebar-title-row {
  min-height: 44px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-sidebar);
}

.sidebar-title-text {
  color: var(--text-primary);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.sidebar-scroll {
  background: var(--surface-sidebar);
}

.drawer-overlay {
  background: rgb(4 9 16 / 0%);
  backdrop-filter: blur(0);
  transition: background var(--motion-standard) var(--ease-standard), backdrop-filter var(--motion-standard) var(--ease-standard);
}

.drawer-overlay.show {
  background: rgb(4 9 16 / 48%);
  backdrop-filter: blur(2px);
}

.drawer {
  border-color: var(--border-subtle);
  background: var(--surface-sidebar);
  box-shadow: var(--shadow-overlay);
  transition: transform var(--motion-emphasized) var(--ease-out);
}

.drawer-toggle-bubble,
.floating-control-stack-layer button {
  border-color: var(--border-subtle);
  background: color-mix(in srgb, var(--surface-overlay) 94%, transparent);
  box-shadow: var(--shadow-floating);
}

@media (prefers-reduced-motion: reduce) {
  .drawer,
  .drawer-overlay {
    transition-duration: 0ms;
  }
}
```

- [ ] **Step 4: 在 `chat.css` 末尾增加侧栏层级覆盖**

```css
/* workspace-ui-targeted-evolution: session sidebar */
.wide-project-section {
  border-radius: var(--radius-panel);
}

.wide-project-row {
  min-height: 34px;
  color: var(--text-secondary);
}

.wide-project-name {
  color: var(--text-primary);
  font-weight: 500;
}

.wide-project-hub-tag,
.wide-session-agent-tag {
  border-color: color-mix(in srgb, currentColor 20%, var(--border-subtle));
  background: color-mix(in srgb, currentColor 8%, transparent);
}

.wide-session-row {
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  transition: background var(--motion-fast) var(--ease-standard), border-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.wide-session-row:hover {
  background: var(--hover);
}

.wide-session-row.selected {
  border-color: color-mix(in srgb, var(--accent-primary) 32%, var(--border-subtle));
  background: color-mix(in srgb, var(--accent-primary) 11%, var(--surface-sidebar));
  color: var(--text-primary);
}

.wide-session-row.selected::before {
  background: var(--accent-primary);
}

.chat-hub-summary-button,
.chat-header-search-control,
.session-search-input {
  border-color: var(--border-subtle);
  background: var(--surface-panel);
}

.chat-hub-popover,
.project-session-action-menu,
.session-archive-menu,
.mobile-project-sheet {
  border-color: var(--border-subtle);
  border-radius: var(--radius-floating);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-overlay);
}

@media (max-width: 900px) {
  .mobile-project-row,
  .mobile-session-row {
    min-height: 44px;
  }

  .mobile-project-sheet {
    max-width: 100%;
    padding-bottom: max(12px, var(--wm-safe-area-bottom));
  }
}
```

- [ ] **Step 5: 验证侧栏与移动壳层，提交**

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-ui.test.ts __tests__/web-responsive-shell.test.ts __tests__/web-mobile-chat-quick-switch-ui.test.ts __tests__/web-mobile-settings-system-back.test.ts
git add app/web/src/styles/shell.css app/web/src/styles/chat.css app/__tests__/web-chat-ui.test.ts app/__tests__/web-responsive-shell.test.ts
git commit -m "style(web): refine shell and session navigation"
```

Expected: PASS；无新的布局档位或全局新建会话入口。

## Task 4: 重整 Chat 阅读层级并锁定单行 Tool call

**Files:**

- Modify: `app/__tests__/web-chat-turn-rendering.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: 写消息结构和窄屏 Tool call 的失败测试**

在 `web-chat-turn-rendering.test.ts` 增加：

```ts
test('keeps tool calls single-line and plan updates outside message content', () => {
  const chatTurn = readChatTurnView();
  const styles = readStyles();
  expect(chatTurn).toContain('<div className="chat-tool-line" title={text}>');
  expect(chatTurn).toContain("if (message.method === 'agent_plan') {");
  expect(chatTurn).toMatch(/if \(message\.method === 'agent_plan'\) \{\s*return null;/);
  expect(styles).toContain('/* workspace-ui-targeted-evolution: chat reading */');
  expect(styles).toMatch(/\.chat-tool-line\s*\{[^}]*min-width:\s*0;/s);
  expect(styles).toMatch(/\.chat-tool-line span:last-child\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/s);
});
```

在 `web-chat-ui.test.ts` 增加完整测试：

```ts
test('keeps assistant content inside the narrow chat viewport', () => {
  const projectRoot = path.join(__dirname, '..');
  const stylesCss = readWebStyles(projectRoot);
  expect(stylesCss).toContain('.chat-main-message');
  expect(stylesCss).toContain('max-width: 100%');
  expect(stylesCss).toContain('overflow-wrap: anywhere');
});
```

- [ ] **Step 2: 运行测试并确认失败**

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-turn-rendering.test.ts __tests__/web-chat-ui.test.ts
```

- [ ] **Step 3: 在 `chat.css` 末尾增加消息阅读样式**

```css
/* workspace-ui-targeted-evolution: chat reading */
.chat-block {
  gap: 14px;
  padding-top: 20px;
}

.chat-view-content {
  min-width: 0;
  max-width: 100%;
}

.chat-prompt-user {
  border: 1px solid color-mix(in srgb, var(--accent-primary) 20%, var(--border-subtle));
  border-radius: var(--radius-panel);
  background: color-mix(in srgb, var(--accent-primary) 9%, var(--surface-raised));
  box-shadow: none;
}

.chat-main-message {
  max-width: 100%;
  color: var(--chat-message-text);
  font-size: 14px;
  line-height: 1.66;
  overflow-wrap: anywhere;
}

.chat-main-message h1,
.chat-main-message h2,
.chat-main-message h3,
.chat-main-message h4,
.chat-main-message h5,
.chat-main-message h6 {
  color: var(--text-primary);
  letter-spacing: -0.015em;
}

.thinking-header,
.chat-prompt-done {
  color: var(--text-secondary);
}

.chat-tool-line {
  min-width: 0;
  max-width: 100%;
  color: var(--text-secondary);
}

.chat-tool-line span:last-child {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

@media (max-width: 900px) {
  .chat-block {
    padding: 14px 12px 0;
  }

  .chat-main-message {
    font-size: 14px;
    line-height: 1.62;
  }
}
```

- [ ] **Step 4: 验证并提交**

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-turn-rendering.test.ts __tests__/web-chat-ui.test.ts
git add app/web/src/styles/chat.css app/__tests__/web-chat-turn-rendering.test.ts app/__tests__/web-chat-ui.test.ts
git commit -m "style(web): improve chat reading hierarchy"
```

Expected: PASS；`ChatTurnView.tsx` 无需改变消息分支。

## Task 5: 增加不会被虚拟列表重复触发的新消息动效

**Files:**

- Modify: `app/__tests__/web-chat-virtuoso-mount.test.tsx`
- Modify: `app/__tests__/web-chat-turn-rendering.test.ts`
- Modify: `app/web/src/chat/turns/ChatVirtuosoTurnList.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/web/src/styles/shell.css`
- Modify: `app/web/src/styles/settings.css`

- [ ] **Step 1: 写尾部消息只播放一次的失败测试**

在 `web-chat-virtuoso-mount.test.tsx` 增加：

```tsx
test('marks only a newly appended tail item for entry motion', async () => {
  jest.useFakeTimers();
  const scrollRef = {current: {} as HTMLElement};
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  try {
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatVirtuosoTurnList
          scrollRef={scrollRef}
          displayIndex={{items: [turnItem(1)]}}
          runtimeKey="project-a/session-a"
          renderItem={item => <span>{item.key}</span>}
        />,
      );
    });
    expect(renderer!.root.findAllByProps({className: 'chat-turn-entry'})).toHaveLength(0);

    await ReactTestRenderer.act(() => {
      renderer!.update(
        <ChatVirtuosoTurnList
          scrollRef={scrollRef}
          displayIndex={{items: [turnItem(1), turnItem(2)]}}
          runtimeKey="project-a/session-a"
          renderItem={item => <span>{item.key}</span>}
        />,
      );
    });
    expect(renderer!.root.findAllByProps({className: 'chat-turn-entry'})).toHaveLength(1);

    await ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(240);
    });
    expect(renderer!.root.findAllByProps({className: 'chat-turn-entry'})).toHaveLength(0);
  } finally {
    if (renderer) {
      await ReactTestRenderer.act(() => {
        renderer!.unmount();
      });
    }
    jest.useRealTimers();
  }
});
```

在 `web-chat-turn-rendering.test.ts` 增加完整的减弱动效测试：

```ts
test('disables new message entry motion when reduced motion is requested', () => {
  const styles = readStyles();
  expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.chat-turn-entry[\s\S]*?animation:\s*none;/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-virtuoso-mount.test.tsx __tests__/web-chat-turn-rendering.test.ts
```

- [ ] **Step 3: 在虚拟列表中跟踪运行时尾部 key**

在 `ChatVirtuosoTurnListInner` 的 state/ref 区加入：

```tsx
const previousTailRef = React.useRef<{runtimeKey: string; key: string} | null>(null);
const [entryKey, setEntryKey] = React.useState('');
const tailKey = displayIndex.items.at(-1)?.key ?? '';

React.useEffect(() => {
  const previous = previousTailRef.current;
  previousTailRef.current = {runtimeKey, key: tailKey};
  if (!tailKey || !previous || previous.runtimeKey !== runtimeKey || previous.key === tailKey) {
    setEntryKey('');
    return undefined;
  }
  setEntryKey(tailKey);
  const timer = window.setTimeout(() => {
    setEntryKey(current => current === tailKey ? '' : current);
  }, 240);
  return () => window.clearTimeout(timer);
}, [runtimeKey, tailKey]);
```

把 `itemContent` 的返回值改为：

```tsx
itemContent={(index, displayItem) => {
  const size = heightEstimates[index] ?? defaultItemHeight;
  const content = renderItem(displayItem, {
    end: size,
    index,
    key: displayItem.key,
    lane: 0,
    size,
    start: 0,
  });
  return displayItem.key === entryKey
    ? <div className="chat-turn-entry">{content}</div>
    : content;
}}
```

这段逻辑必须保持：首次加载不播放、切换会话不播放、同一消息流式增高不播放、仅新增尾部 key 播放一次。

- [ ] **Step 4: 增加消息、菜单和页面过渡 CSS**

向 `chat.css` 增加：

```css
.chat-turn-entry {
  animation: chatTurnEnter var(--motion-emphasized) var(--ease-out) both;
}

@keyframes chatTurnEnter {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

.chat-hub-popover,
.project-session-action-menu,
.session-archive-menu,
.mobile-project-sheet {
  transform-origin: top center;
  animation: workspaceMenuEnter var(--motion-standard) var(--ease-out) both;
}

@keyframes workspaceMenuEnter {
  from { opacity: 0; transform: translateY(-4px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .chat-turn-entry,
  .chat-hub-popover,
  .project-session-action-menu,
  .session-archive-menu,
  .mobile-project-sheet {
    animation: none;
  }
}
```

向 `shell.css` 增加页面进入规则：

```css
.workspace-right > .content,
.workspace-right > .block {
  animation: workspacePageEnter var(--motion-standard) var(--ease-out) both;
}

@keyframes workspacePageEnter {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .workspace-right > .content,
  .workspace-right > .block {
    animation: none;
  }
}
```

向 `settings.css` 增加设置详情进入规则：

```css
.settings-detail-page {
  animation: workspacePageEnter var(--motion-standard) var(--ease-out) both;
}

@media (prefers-reduced-motion: reduce) {
  .settings-detail-page {
    animation: none;
  }
}
```

不要给 `.chat-virtuoso-row` 或所有元素添加全局动画。

- [ ] **Step 5: 验证并提交**

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-virtuoso-mount.test.tsx __tests__/web-chat-turn-rendering.test.ts __tests__/web-responsive-shell.test.ts __tests__/web-settings-navigation.test.ts
npm --prefix app run tsc:web
git add app/web/src/chat/turns/ChatVirtuosoTurnList.tsx app/web/src/styles/chat.css app/web/src/styles/shell.css app/web/src/styles/settings.css app/__tests__/web-chat-virtuoso-mount.test.tsx app/__tests__/web-chat-turn-rendering.test.ts
git commit -m "style(web): add restrained workspace motion"
```

Expected: PASS；虚拟列表原有高度估算和滚动测试继续通过。

## Task 6: 轻量化输入区，同时锁死移动端尺寸与结构

**Files:**

- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-voice-input-button.test.tsx`
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: 写输入区不可变约束的失败测试**

在 `web-chat-ui.test.ts` 增加或收紧：

```ts
test('keeps the two-row composer and current control sizes on portrait mobile', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
  const stylesCss = readWebStyles(projectRoot);
  expect(mainTsx).toMatch(/chat-composer-frame[\s\S]*chat-composer-input-row[\s\S]*chat-composer-toolbar/);
  expect(stylesCss).toMatch(/\.chat-composer-action-column\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
  expect(stylesCss).toMatch(/\.chat-send-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
  expect(stylesCss).toMatch(/\.voice-input-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
  expect(stylesCss).toMatch(/\.chat-tool-button\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s);
  expect(stylesCss).toContain('max-width: calc(100vw - 24px)');
  expect(stylesCss).toContain('padding-bottom: max(4px, var(--wm-safe-area-bottom))');
});
```

保留 `web-voice-input-button.test.tsx` 中所有现有语音按钮结构与尺寸断言，不修改期望值。

- [ ] **Step 2: 运行测试并确认窄屏约束尚未满足**

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-ui.test.ts __tests__/web-voice-input-button.test.tsx
```

- [ ] **Step 3: 替换输入框的视觉属性，不修改尺寸属性**

在 `chat.css` 中把 `.chat-composer-frame` 默认与 open 状态改为：

```css
.chat-composer-frame {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-floating);
  background: color-mix(in srgb, var(--surface-panel) 96%, transparent);
  box-shadow: 0 4px 14px rgb(3 8 15 / 12%);
  padding: 8px 8px 4px;
  transition: border-color var(--motion-fast) var(--ease-standard), box-shadow var(--motion-fast) var(--ease-standard), background var(--motion-fast) var(--ease-standard);
}

.chat-composer:focus-within .chat-composer-frame {
  border-color: color-mix(in srgb, var(--accent-primary) 56%, var(--border-subtle));
  box-shadow: 0 4px 16px rgb(3 8 15 / 14%), 0 0 0 1px color-mix(in srgb, var(--accent-primary) 10%, transparent);
}

.chat-composer.config-menu-open .chat-composer-frame,
.chat-composer.trigger-menu-open .chat-composer-frame {
  border-color: color-mix(in srgb, var(--accent-primary) 48%, var(--border-subtle));
  box-shadow: 0 8px 22px rgb(3 8 15 / 18%);
}

.chat-composer-frame.drag-over {
  border-color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 7%, var(--surface-panel));
}

.chat-send-button {
  width: 36px;
  height: 36px;
  border-color: color-mix(in srgb, var(--accent-primary) 58%, var(--border-subtle));
  background: color-mix(in srgb, var(--accent-primary) 17%, var(--surface-panel));
  color: color-mix(in srgb, var(--accent-primary) 88%, var(--text-primary));
  box-shadow: none;
}

.chat-send-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-primary) 24%, var(--surface-panel));
}

.voice-input-button {
  width: 36px;
  height: 36px;
  border-color: color-mix(in srgb, var(--state-success) 56%, var(--border-subtle));
  background: color-mix(in srgb, var(--state-success) 13%, var(--surface-panel));
  color: color-mix(in srgb, var(--state-success) 82%, var(--text-primary));
  box-shadow: none;
}
```

明确保留以下现有值不变：

```css
.chat-composer-input-row { gap: 6px; min-height: 32px; }
.chat-composer-input { min-height: 32px; max-height: 180px; padding: 5px 8px 2px; font-size: 15px; line-height: 1.4; }
.chat-composer-action-column { width: 36px; height: 36px; }
.chat-send-button { width: 36px; height: 36px; }
.voice-input-button { width: 36px; height: 36px; }
.chat-tool-button { width: 24px; height: 24px; }
```

- [ ] **Step 4: 增加竖屏移动端的留白与弹层边界**

```css
@media (max-width: 900px) {
  .chat-composer {
    padding-right: 12px;
    padding-bottom: max(4px, var(--wm-safe-area-bottom));
    padding-left: 12px;
  }

  .chat-composer-content,
  .chat-composer-frame {
    max-width: calc(100vw - 24px);
  }

  .chat-slash-menu,
  .chat-file-mention-menu,
  .chat-config-overflow-menu,
  .chat-config-value-menu {
    max-width: calc(100vw - 24px);
    max-height: min(56vh, 420px);
    overflow: auto;
    overscroll-behavior: contain;
  }
}
```

不得减少 toolbar 间距来“塞下”更多入口；已有 secondary config overflow 行为保持不变。

- [ ] **Step 5: 验证输入、语音、附件和键盘避让，提交**

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-ui.test.ts __tests__/web-voice-input-button.test.tsx __tests__/web-voice-recording-bar.test.tsx __tests__/web-session-attachment-preview-service.test.ts __tests__/web-mobile-enter-key-settings.test.ts
git add app/web/src/styles/chat.css app/__tests__/web-chat-ui.test.ts
git commit -m "style(web): lighten composer without shrinking controls"
```

Expected: PASS；按钮/图标尺寸和两层结构断言保持原值。

## Task 7: 统一 Settings 视觉而不改变信息架构

**Files:**

- Modify: `app/__tests__/web-settings-navigation.test.ts`
- Modify: `app/web/src/styles/settings.css`

- [ ] **Step 1: 写 Settings 顺序和视觉层级测试**

在 `web-settings-navigation.test.ts` 增加：

```ts
import fs from 'fs';
import path from 'path';

test('styles settings groups without changing shortcut order', () => {
  const css = fs.readFileSync(
    path.resolve(__dirname, '../web/src/styles/settings.css'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  expect(mobileSettingsShortcutIndex(null)).toBe(0);
  expect(mobileSettingsShortcutIndex('update')).toBe(1);
  expect(mobileSettingsShortcutIndex('skills')).toBe(2);
  expect(mobileSettingsShortcutIndex('portRelay')).toBe(3);
  expect(mobileSettingsShortcutIndex('tokenStats')).toBe(4);
  expect(css).toContain('/* workspace-ui-targeted-evolution: settings */');
  expect(css).toContain('.settings-danger-row');
  expect(css).toContain('var(--state-danger)');
});
```

- [ ] **Step 2: 运行测试并确认失败**

```powershell
npm --prefix app test -- --runInBand __tests__/web-settings-navigation.test.ts
```

- [ ] **Step 3: 在 `settings.css` 末尾增加视觉覆盖**

```css
/* workspace-ui-targeted-evolution: settings */
.mobile-settings-screen {
  background: var(--surface-canvas);
}

.mobile-settings-panel {
  border-color: var(--border-subtle);
  background: var(--surface-panel);
}

.settings-list {
  gap: 16px;
}

.settings-section-title {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.settings-section-rows {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: var(--surface-panel);
  box-shadow: none;
}

.settings-row {
  min-height: 42px;
  border-bottom-color: var(--border-subtle);
  color: var(--text-primary);
  transition: background var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.settings-row:hover {
  background: var(--hover);
}

.settings-row-icon,
.settings-row > span:first-child > .codicon:first-child {
  color: var(--text-secondary);
}

.settings-danger-row,
.settings-danger-row .settings-row-icon {
  color: var(--state-danger);
}

.settings-detail-title {
  color: var(--text-primary);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.mobile-settings-shortcuts {
  border-top-color: var(--border-subtle);
  background: color-mix(in srgb, var(--surface-panel) 94%, transparent);
  backdrop-filter: blur(12px);
}

@media (max-width: 900px) {
  .mobile-settings-panel {
    padding-bottom: max(12px, var(--wm-safe-area-bottom));
  }

  .settings-row {
    min-height: 44px;
  }
}
```

只修改样式；`SettingsRootContent.tsx`、`SettingsSurface.tsx` 和快捷栏定义不得改序。

- [ ] **Step 4: 跑完整 Settings 相关测试并提交**

```powershell
npm --prefix app test -- --runInBand __tests__/web-settings-navigation.test.ts __tests__/web-connection-settings-ui.test.ts __tests__/web-database-settings-ui.test.ts __tests__/web-token-stats-settings-ui.test.ts __tests__/web-skill-management-settings.test.ts __tests__/web-mobile-settings-system-back.test.ts
git add app/web/src/styles/settings.css app/__tests__/web-settings-navigation.test.ts
git commit -m "style(web): align settings visual hierarchy"
```

Expected: PASS；设置分组、详情入口和快捷栏顺序完全不变。

## Task 8: 完成公共状态、继承页面与排除页面回归

**Files:**

- Modify: `app/__tests__/web-ui-design-system.test.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx:18300`
- Modify: `app/web/src/styles/base.css`
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: 为已有空/错/重试/处理中 DOM 写样式覆盖测试**

向 `web-ui-design-system.test.ts` 增加：

```ts
test('maps existing workspace feedback hooks to semantic states', () => {
  const styles = [
    read('web/src/styles/base.css'),
    read('web/src/styles/chat.css'),
    read('web/src/styles/settings.css'),
  ].join('\n');
  for (const selector of [
    '.chat-empty-hint',
    '.wide-project-empty',
    '.mobile-project-session-error',
    '.session-search-error',
    '.empty-card',
    '.chat-loading-state',
  ]) {
    expect(styles).toContain(selector);
  }
  expect(styles).toContain('var(--state-danger)');
  expect(read('web/src/app/WorkspaceApp.tsx')).toContain('className="session-archive-progress" role="status"');
  expect(read('web/src/app/WorkspaceApp.tsx')).toContain('className="chat-loading-state" role="status"');
});
```

- [ ] **Step 2: 运行测试并确认缺失映射**

```powershell
npm --prefix app test -- --runInBand __tests__/web-ui-design-system.test.ts
```

- [ ] **Step 3: 将现有状态钩子映射到统一语义样式**

把 `WorkspaceApp.tsx` 中现有 `chatLoading` 分支替换为不改变条件的数据无关骨架：

```tsx
{!chatReadOnlyPreview && chatLoading ? (
  <div className="chat-loading-state" role="status" aria-label="Loading chat">
    <span className="chat-loading-line" />
    <span className="chat-loading-line" />
    <span className="chat-loading-line" />
  </div>
) : null}
```

在 `base.css` 与 `chat.css` 中加入：

```css
.chat-empty-hint,
.wide-project-empty,
.empty-card {
  color: var(--text-secondary);
  text-align: center;
}

.mobile-project-session-error,
.session-search-error {
  border: 1px solid color-mix(in srgb, var(--state-danger) 28%, var(--border-subtle));
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--state-danger) 7%, var(--surface-panel));
  color: var(--state-danger);
}

.mobile-project-session-error button,
.session-search-error button {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.session-archive-progress[role='status'] {
  border-color: var(--border-subtle);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-floating);
}

.chat-loading-state {
  display: grid;
  gap: 10px;
  width: min(620px, 100%);
  padding: 12px 0;
}

.chat-loading-line {
  height: 10px;
  border-radius: 999px;
  background: var(--surface-raised);
  animation: feedbackStatePulse 1.4s ease-in-out infinite;
}

.chat-loading-line:nth-child(2) { width: 86%; }
.chat-loading-line:nth-child(3) { width: 62%; }

@media (prefers-reduced-motion: reduce) {
  .chat-loading-line {
    animation: none;
  }
}
```

Port Relay、日志、Token Stats、Skills 只允许通过公共变量被动继承，不追加页面专属覆盖。

- [ ] **Step 4: 运行公共、继承与排除页测试**

```powershell
npm --prefix app test -- --runInBand __tests__/web-ui-design-system.test.ts __tests__/web-port-relay-settings.test.ts __tests__/web-registry-debug-settings.test.ts __tests__/web-token-stats-settings-ui.test.ts __tests__/web-skill-management-settings.test.ts __tests__/web-file-surface-boundary.test.ts __tests__/web-git-surface-boundary.test.ts __tests__/web-file-icon-startup-boundary.test.ts __tests__/web-git-diff-startup-boundary.test.ts
```

Expected: PASS；File/Git 页面文件没有专属改动。

- [ ] **Step 5: 提交状态完善**

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/base.css app/web/src/styles/chat.css app/__tests__/web-ui-design-system.test.ts
git commit -m "style(web): complete workspace feedback states"
```

## Task 9: 竖屏、深浅主题与全量回归验收

**Files:**

- Modify only if verification exposes a defect: files already listed in Tasks 1–8

- [ ] **Step 1: 跑核心自动化回归**

```powershell
npm --prefix app test -- --runInBand __tests__/web-ui-design-system.test.ts __tests__/web-chat-ui.test.ts __tests__/web-chat-turn-rendering.test.ts __tests__/web-chat-virtuoso-mount.test.tsx __tests__/web-responsive-shell.test.ts __tests__/web-settings-navigation.test.ts __tests__/web-mobile-chat-quick-switch-ui.test.ts __tests__/web-mobile-settings-system-back.test.ts __tests__/web-mobile-enter-key-settings.test.ts __tests__/web-voice-input-button.test.tsx __tests__/web-voice-recording-bar.test.tsx __tests__/web-session-attachment-preview-service.test.ts __tests__/web-file-surface-boundary.test.ts __tests__/web-git-surface-boundary.test.ts
```

Expected: PASS，0 failed。

- [ ] **Step 2: 跑完整类型检查、测试与生产构建**

```powershell
npm --prefix app run tsc:web
npm --prefix app test -- --runInBand
npm --prefix app run build:web
```

Expected: 三条命令均 exit code 0。

- [ ] **Step 3: 启动 Web 并执行竖屏移动端矩阵**

```powershell
npm --prefix app run web
```

在浏览器设备模式分别验证 `360x800`、`390x844`、`430x932`，深色和浅色主题各一次：

- 页面无横向滚动；侧栏搜索仍固定在标题区。
- 抽屉、浮动控件、快捷切换、底部面板、系统返回和安全区正常。
- 打开软键盘后输入内容、发送/语音按钮、`/`、`@`、附件和模型菜单均可触达。
- 输入底栏没有因按钮缩小或间距压缩而变得拥挤；发送/语音仍为 `36px`，工具按钮仍为 `24px`。
- Tool call 单行省略且不撑宽页面；`agent_plan` 不出现在正文。
- Settings 快捷栏顺序和详情返回行为不变。

- [ ] **Step 4: 执行桌面与动效矩阵**

在常用桌面宽度验证：

- 深浅主题的壳层、侧栏、Chat、Settings、浮层表面层级一致。
- 新尾部消息仅进入一次；滚动虚拟列表或切换会话不重复播放。
- 菜单与页面过渡不妨碍点击、键盘焦点或关闭操作。
- 系统启用 `prefers-reduced-motion: reduce` 后，新消息、菜单、抽屉和页面过渡变为静态或即时反馈。
- File/Git 功能和页面专属布局与改造前一致。

- [ ] **Step 5: 如验收发现缺陷，先补失败测试再做最小修复**

修复只能落在 Tasks 1–8 已列文件中；若需要改协议、状态机、信息架构、输入区结构、图标/按钮尺寸或 File/Git 专属文件，停止执行并回到 scope 确认。

- [ ] **Step 6: 提交验收修复（仅在产生修复时）**

```powershell
git add app/web/src/styles/tokens.css app/web/src/styles/base.css app/web/src/styles/shell.css app/web/src/styles/chat.css app/web/src/styles/settings.css app/web/src/chat/turns/ChatVirtuosoTurnList.tsx app/web/src/app/WorkspaceApp.tsx app/testHelpers/webStyles.ts app/__tests__/web-ui-design-system.test.ts app/__tests__/web-chat-ui.test.ts app/__tests__/web-chat-turn-rendering.test.ts app/__tests__/web-chat-virtuoso-mount.test.tsx app/__tests__/web-responsive-shell.test.ts app/__tests__/web-settings-navigation.test.ts
git commit -m "test(web): close workspace visual regressions"
```

若没有修复，不创建空提交。

## 完成定义

- Tasks 1–9 全部勾选，所有自动化验证通过。
- 360px、390px、430px 竖屏深浅主题人工矩阵通过。
- 输入区结构和尺寸、两档响应式、侧栏信息架构、Settings 顺序、Chat 消息结构全部保持不变。
- 新消息、菜单、页面和抽屉动效均支持 reduced motion。
- File/Git 无页面专属改动，Port Relay/日志/Token Stats/Skills 仅继承公共 Token。
- 每个任务的提交只包含计划范围内文件，没有夹带工作区现有无关改动。
