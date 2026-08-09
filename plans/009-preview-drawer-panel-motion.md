# 009 — Preview workbench 抽屉面板：mobile 补入场、全平台补退场

- **Status**: DONE
- **Commit**: 5d9dd66e
- **Severity**: MEDIUM
- **Category**: Missed opportunity / Interruptibility
- **Estimated scope**: 2 files（`app/web/src/preview/PreviewWorkbenchChrome.tsx`、`app/web/src/styles/file.css`），~40 lines

## Problem

文件/Git 抽屉面板（`.preview-workbench-drawer-panel`，内含文件树或 git 视图）的动画现状：

1. **desktop（portal 形态）有入场、无退场**。`PreviewWorkbenchChrome.tsx:94-98`（当前代码）：

   ```tsx
   const useDrawerPortal = mode === 'desktop' && !!drawerPortalTarget;
   const drawerPanel = drawerOpen && drawerContent ? (
     <div
       ref={drawerPanelRef}
       className={`preview-workbench-drawer-panel${useDrawerPortal ? ' external' : ''}`}
   ```

   `file.css:648-655` 仅给 `.external` 挂了入场：

   ```css
   .preview-workbench-drawer-panel.external {
     width: 100%;
     height: 100%;
     pointer-events: auto;
     border-right: 1px solid var(--border-subtle);
     box-shadow: -20px 0 44px color-mix(in srgb, #000 30%, transparent);
     animation: preview-workbench-drawer-in var(--motion-standard) var(--ease-out);
   }
   ```

   关闭时 `drawerOpen = false` → 面板立即卸载，无退场。

2. **mobile（内联形态）进退场都没有**。内联规则 `file.css:639-646`（`.preview-workbench-surface .preview-workbench-drawer-panel`，左锚 `inset: 0 auto 0 0`、宽 `min(360px, 100% - 56px)`）无 `animation` 声明——面板瞬现瞬灭。

   这违反仓库约定（`docs/wiki/frontend-interaction/visual-language.md`「动效原则」）："弹层/菜单必须有进**和退**场动画，禁止只进不出。"

   注：唯一的 `<PreviewWorkbenchChrome>` 使用点是 `app/web/src/app/WorkspaceApp.tsx:21029`，`drawerPortalTarget={mode === 'desktop' ? previewDrawerHost : null}`（`:21035`）——即 desktop 必为 portal/external，mobile 必为内联。

## Target

- **入场**：内联（mobile）面板获得与 external 相同的入场（左锚面板，`translateX(-10px)` 从左缘滑入方向正确）。
- **退场**：两种形态统一。`drawerMode` 变为 `'closed'` 时组件本地保留上一个打开的模式继续渲染 120ms，挂 `.exiting` 播放滑出，结束后卸载；退场期间 `pointer-events: none`；退场中重新打开立即取消退场。
- reduced-motion：入场/退场都关闭，立即显隐（JS 侧跳过退场延迟 + CSS 侧 `animation: none`）。
- keyframes 目标（新增）：

  ```css
  @keyframes preview-workbench-drawer-out {
    to {
      opacity: 0;
      transform: translateX(-10px);
    }
  }
  ```

## Repo conventions to follow

- 入场声明沿用 pinned 形态：`animation: preview-workbench-drawer-in var(--motion-standard) var(--ease-out);`（契约测试 "tokenizes Preview Workbench entry motion…" pin 住，不得改 `.external` 这条）。
- 退场时长沿用菜单体系的 `MENU_EXIT_MS = 120`（`app/web/src/chat/sessionlist/menuExit.ts:3`）= `--motion-fast`，与全站菜单退场一致。
- reduced-motion 的 JS 判断写法参照 `menuExit.ts:29`：`window.matchMedia('(prefers-reduced-motion: reduce)').matches`。
- 注意 `file.css:658-662` 的 reduced 块被契约 regex pin 住（必须继续包含 `.preview-workbench-search-bar,` 和 `.preview-workbench-drawer-panel.external` 这两个选择器字样）——**只能追加，不得改写**该块：

  ```css
  @media (prefers-reduced-motion: reduce) {
    .preview-workbench-search-bar,
    .preview-workbench-drawer-panel.external {
      animation: none;
    }
  }
  ```

## Steps

1. **`app/web/src/styles/file.css`**：
   - 在 `.preview-workbench-surface .preview-workbench-drawer-panel` 规则（639-646 行）内追加 `animation: preview-workbench-drawer-in var(--motion-standard) var(--ease-out);`。
   - 在 `@keyframes preview-workbench-drawer-in`（664-673 行）之后新增 `@keyframes preview-workbench-drawer-out`（Target）。
   - 在 `.external` 规则之后新增退场规则（放在所有入场规则之后，靠源码顺序赢同特异度竞争）：

     ```css
     .preview-workbench-drawer-panel.exiting {
       /* Must fit MENU_EXIT_MS (120ms); the chrome unmounts after the exit. */
       animation: preview-workbench-drawer-out var(--motion-fast) var(--ease-out) forwards;
       pointer-events: none;
     }
     ```

   - reduced 块（658-662 行）保持 pinned 选择器原样，在其后追加：

     ```css
       .preview-workbench-surface .preview-workbench-drawer-panel,
       .preview-workbench-drawer-panel.exiting {
         animation: none;
       }
     ```

2. **`app/web/src/preview/PreviewWorkbenchChrome.tsx`**：
   - 顶部 import 追加：`import {MENU_EXIT_MS} from '../chat/sessionlist/menuExit';`
   - 在 `:88` 附近（`const drawerOpen = drawerMode !== 'closed';` 之后）新增退场快照状态：

     ```tsx
     const [exitMode, setExitMode] = React.useState<'files' | 'git' | null>(null);
     const prevDrawerModeRef = React.useRef(drawerMode);
     React.useEffect(() => {
       const prev = prevDrawerModeRef.current;
       prevDrawerModeRef.current = drawerMode;
       if (drawerMode !== 'closed') {
         setExitMode(null);
         return undefined;
       }
       if (prev === 'closed' || prev === drawerMode) {
         return undefined;
       }
       if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
         return undefined;
       }
       setExitMode(prev);
       const timer = window.setTimeout(() => setExitMode(null), MENU_EXIT_MS);
       return () => window.clearTimeout(timer);
     }, [drawerMode]);
     ```

   - 渲染逻辑（`:88-105`）改为：关闭后按 `exitMode` 继续渲染 120ms——

     ```tsx
     const renderedMode = drawerOpen ? drawerMode : exitMode;
     const drawerContent = renderedMode === 'files'
       ? fileDrawer
       : renderedMode === 'git'
         ? gitDrawer
         : null;
     const drawerExiting = !drawerOpen && exitMode !== null;
     ```

     className 改为：

     ```tsx
     className={`preview-workbench-drawer-panel${useDrawerPortal ? ' external' : ''}${drawerExiting ? ' exiting' : ''}`}
     ```

     （`drawerPanel` 的条件相应改为 `renderedMode && drawerContent ?`；原 `drawerContent` 定义在 `:89-93`，合并替换。）

## Boundaries

- 不得修改 `.preview-workbench-drawer-panel.external` 的入场声明与 `file.css:658-662` reduced 块内既有选择器（契约 pin）。
- 不改 `drawerMode` 的状态归属（仍在 WorkspaceApp）；退场纯组件本地，不通知父组件。
- 不改外点关闭逻辑（`:145-159`，含 `drawerPinned` 判断）、portal 目标、面板宽度/定位。
- 执行前确认 `fileDrawer` / `gitDrawer` props 在 drawer 关闭时仍被父组件无条件构造传入（`WorkspaceApp.tsx:21029` 附近）；若某个 drawer 内容在 `'closed'` 时为 null，停止并报告（空面板滑出是不可接受的）。
- 若行号处代码与引用不一致，停止并报告。

## Verification

- **Mechanical**：`cd app && npm run tsc:web` 无错误；`cd app && npx jest motionContracts` 与 `cd app && npx jest PreviewWorkbenchChrome` 全绿。
- **Feel check**：
  - desktop 宽视图：开 files 抽屉 → 既有入场不变；关闭（toggle 按钮/外点）→ 面板 120ms 向左滑出再消失，不瞬灭。
  - mobile 视图（≤900px 或移动布局）：开 files/git 抽屉 → 从左缘 180ms 滑入；关闭 → 120ms 滑出。
  - 关闭后 120ms 内立刻重开 → 退场取消、面板直接在场（无叠影）。
  - 退场期间点击面板区域 → 不响应（pointer-events: none）。
  - Rendering 模拟 reduced motion → 开关均立即显隐。
  - DevTools 10% 慢放：mobile 入场从 `translateX(-10px)` 起笔。
- **Done when**：mobile 有入场、两形态有退场、重开无叠影、契约与组件测试全绿。
