# 008 — 四个右键上下文菜单补齐进退场动画

- **Status**: DONE
- **Commit**: 5d9dd66e
- **Severity**: LOW
- **Category**: Missed opportunity / Cohesion
- **Estimated scope**: 4 个菜单组件 + 2 处父状态 + 3 个 css 文件，~80 lines

## Problem

仓库约定（`docs/wiki/frontend-interaction/visual-language.md`「动效原则」原文）："弹层/菜单必须有进**和退**场动画，禁止只进不出；进退场统一 `sl-menu-in` / `sl-menu-exit`。boolean state 弹窗通过 menuExit 布尔变体 hook 包装所有关闭路径（外点、Esc、toggle），退场动画期间禁止交互，结束后才卸载。"

但四个右键菜单目前**完全没有**进退场动效（无 animation 声明、直接条件挂载）：

| 菜单 class | CSS 位置 | 组件/渲染处 | 状态持有者 |
| --- | --- | --- | --- |
| `.chat-file-link-context-menu` | `chat.css:8119` | `chat/ChatFileLinkContextMenu.tsx:128` | 父组件 `app/WorkspaceApp.tsx:21283` 渲染 |
| `.preview-tab-context-menu` | `file.css:451` | `preview/PreviewTabContextMenu.tsx:42` | 父组件 `app/WorkspaceApp.tsx:21099` 渲染 |
| `.preview-selection-context-menu` | `file.css:917` | 内联 JSX `app/WorkspaceApp.tsx:21266` | `WorkspaceApp.tsx:3249` `const [previewSelectionMenu, setPreviewSelectionMenu] = useState<PreviewSelectionMenuState \| null>(null);` |
| `.terminal-copy-context-menu` | `terminal.css`（grep 定位） | `terminal/TerminalView.tsx:380` | `terminal/TerminalView.tsx:96` `const [copyMenu, setCopyMenu] = useState<{left: number; top: number; text: string} \| null>(null);` |

四个菜单都是 `position: fixed` + 内联 `left/top` 定位在光标处（exemplar 当前代码，`ChatFileLinkContextMenu.tsx:125-132`）：

```tsx
  return (
    <div
      ref={menuRef}
      className="chat-file-link-context-menu"
      style={{left: x, top: y}}
      role="menu"
      onKeyDown={event => handleMenuKeyDown(event, menuRef.current)}
    >
```

## Target

每个菜单获得与全站菜单一致的进出场：

- 入场：`sl-menu-in`（全局 keyframes，定义于 `sessionlist.css:344-347`：opacity 0 + translateY(-2px) + scale(0.98)），origin 在光标角（`top left`）。
- 退场：`sl-menu-out`（`sessionlist.css:348-351`），经共享 class `sl-menu-exit` 触发；退场期间 `pointer-events: none`，120ms（`MENU_EXIT_MS`）后卸载。
- 所有关闭路径（外点、Esc、选择菜单项）自动走退场——用 `useMenuExitState` 替换 `useState` 即可实现（它是 useState 的 drop-in：设 null 先播退场再清空，设非 null 取消进行中的退场）。
- reduced-motion：`menuExit.ts:29-32` 已在 JS 侧跳过退场直接卸载；入场用 CSS reduced 块关动画。

目标 CSS（每个菜单一条基础声明补充 + 一条退场规则 + reduced 覆盖）：

```css
.x-context-menu {
  /* …现有声明不动… */
  transform-origin: top left;
  animation: sl-menu-in var(--motion-fast) var(--ease-out);
}

.x-context-menu.sl-menu-exit {
  /* Must fit MENU_EXIT_MS (120ms) or the portal unmounts mid-animation. */
  animation: sl-menu-out var(--motion-fast) var(--ease-out) forwards;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .x-context-menu {
    animation: none;
  }
}
```

注意 `.x-context-menu.sl-menu-exit`（0,2,0）必须比入场规则（0,1,0）特异度高——按上面写法天然满足；不要依赖共享 `.sl-menu-exit` 规则（0,1,0，`sessionlist.css:355-358`），它在与各文件入场规则的源码顺序竞争中不保证赢。

## Repo conventions to follow

- 状态包装 exemplar：`terminal/TerminalView.tsx:96` 改造目标形态——

  ```ts
  const [copyMenu, setCopyMenu, copyMenuExiting] = useMenuExitState<{left: number; top: number; text: string}>();
  ```

  `useMenuExitState` 定义于 `app/web/src/chat/sessionlist/menuExit.ts:54-73`；import 路径按所在文件相对位置（TerminalView：`../chat/sessionlist/menuExit`；WorkspaceApp：`../chat/sessionlist/menuExit`，该文件已有 menuExit 相关 import，合并即可）。
- 退场时长 token 与 `MENU_EXIT_MS = 120`（`menuExit.ts:3`）严格配对，沿用 `--motion-fast`。
- 组件加 `exiting` prop 的模式参照 `SessionMenu.tsx:30,64,99`（`exiting?: boolean` → className 追加 `' sl-menu-exit'`）。

## Steps

对四个菜单逐个执行（顺序无关）：

1. **terminal-copy-context-menu**（最简单，状态与渲染同文件）：
   - `terminal/TerminalView.tsx:96`：`useState` → `useMenuExitState`（Target 形态），加 import。
   - 渲染处（`:380` 附近）：className 改为模板，追加 `${copyMenuExiting ? ' sl-menu-exit' : ''}`。
   - `terminal.css`：按 Target 加三条 CSS（grep `.terminal-copy-context-menu` 定位基础块）。
2. **preview-selection-context-menu**（状态与渲染同在 WorkspaceApp）：
   - `WorkspaceApp.tsx:3249`：`useState<PreviewSelectionMenuState | null>` → `useMenuExitState<PreviewSelectionMenuState>()`，返回的 exiting 命名为 `previewSelectionMenuExiting`。
   - 渲染处 `:21266`：className 追加 `${previewSelectionMenuExiting ? ' sl-menu-exit' : ''}`。
   - `file.css:917` 基础块按 Target 加 CSS。
3. **chat-file-link-context-menu**：
   - 找到 `WorkspaceApp.tsx:21283` 渲染处对应的状态声明（grep `setFileLink` 或渲染附近的 menu state），改为 `useMenuExitState`，exiting 传入 `<ChatFileLinkContextMenu … exiting={…} />`。
   - `ChatFileLinkContextMenu.tsx`：props 类型加 `exiting?: boolean`；`:128` className 改模板追加。
   - `chat.css:8119` 基础块按 Target 加 CSS。
4. **preview-tab-context-menu**：
   - 同 3 的模式：`WorkspaceApp.tsx:21099` 渲染处的状态（grep `previewTabMenu`）→ `useMenuExitState`；`PreviewTabContextMenu.tsx:42` 加 prop + className；`file.css:451` 加 CSS。

## Boundaries

- 不改菜单的定位（内联 left/top）、尺寸、z-index、键盘处理（`handleMenuKeyDown`）、aria 角色。
- `useMenuExitState` 是 drop-in：所有既有 `setX(null)` 调用点（外点、Esc、项点击）**不要**改写法，语义自动变为先退后卸。
- 若某菜单的关闭路径不经过状态 setter（例如直接操作 DOM 或条件渲染父级），停止并报告，不要即兴包 hook。
- `.sl-menu-exit` 共享规则（`sessionlist.css:355-358`）不动；`sl-menu-in`/`sl-menu-out` keyframes 不动。
- 若行号/代码与引用不一致，停止并报告。

## Verification

- **Mechanical**：`cd app && npm run tsc:web` 无错误；`cd app && npx jest` 通过（重点：`npx jest TerminalView PreviewTab motionContracts`）。
- **Feel check**：
  - 聊天中右键文件链接 → 菜单从光标角（top left）以 120ms 长出；点任意项/Esc/外点 → 快速淡出收起，无瞬灭。
  - 预览 tab 右键、终端选中文本右键、预览选区菜单：同上。
  - 快速连续右键不同位置：旧菜单退场不叠影、不阻塞新菜单（`useMenuExitState` 设非 null 会取消进行中退场）。
  - Rendering 模拟 reduced motion：菜单立即显隐。
  - DevTools 10% 慢放：scale 起点在光标角。
- **Done when**：四个菜单进退场与全站菜单体系一致；所有关闭路径都有退场；测试全绿。
