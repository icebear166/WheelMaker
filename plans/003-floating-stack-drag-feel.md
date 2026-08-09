# 003 — 移动端悬浮控件拖拽手感：精确跟手、边界阻尼、松手无跳变

- **Status**: DONE
- **Commit**: 5d9dd66e
- **Severity**: MEDIUM
- **Category**: Interruptibility / Gesture（手势）
- **Estimated scope**: 2 files（`app/web/src/styles/shell.css`、`app/web/src/app/WorkspaceApp.tsx`），~25 lines

## Problem

移动端右下（或左下）的 `.floating-control-stack` 可垂直拖拽换位置。三个问题：

1. **拖拽中滞后手指 ~120ms**。`shell.css:527-531`（当前代码）：

   ```css
   .floating-control-stack[data-drag-state='dragging'] {
     filter: drop-shadow(0 14px 30px rgba(0, 0, 0, 0.28));
     transition: transform var(--motion-fast) var(--ease-standard);
     will-change: transform;
   }
   ```

   拖拽中 transform 仍带 transition，每个 pointermove 都追 120ms 的补间。对比仓库自家 sheet 模式：`sessionlist.css:895-897` `.sl-sheet.dragging { transition: none; }`（"while dragging it tracks the finger exactly"）。

2. **边界硬停止**。`WorkspaceApp.tsx:1539-1541`（当前代码）：

   ```ts
   function clampFloatingTop(top: number, minTop: number, maxTop: number): number {
     return Math.min(maxTop, Math.max(minTop, top));
   }
   ```

   pointermove 处理器（`WorkspaceApp.tsx:7184-7192`）用它硬钳制 `currentTop`，拖过顶/底边界像撞墙，没有摩擦阻尼。

3. **松手位置跳变**。内联样式（`WorkspaceApp.tsx:7121-7131`，当前代码）：

   ```ts
   const effectiveFloatingControlStackStyle = useMemo(
     () =>
       !isWide
         ? ({
             top: `${floatingDragState ? floatingDragState.startTop : effectiveFloatingControlTop}px`,
             transform: floatingDragState
               ? `translateY(${floatingDragState.currentTop - floatingDragState.startTop}px) scale(1.06)`
               : undefined,
           } as React.CSSProperties)
         : undefined,
     [effectiveFloatingControlTop, floatingDragState, isWide],
   );
   ```

   基础规则 `shell.css:505-516` 有 `transition: transform var(--motion-standard) var(--ease-standard);`。松手时 `setFloatingDragState(null)`：`top` 从 startTop 换到最终值的同时，`transform` 以 180ms 从 `translateY(dy) scale(1.06)` 补间到 `none`——translateY 分量会在新 top 上再叠加一次 dy，元素先跳到 `最终位置 + dy` 再漂回来（dy 可达数百 px）。

## Target

- 拖拽中：无 transition，`translateY` 精确跟手。
- 拖过边界：0.35 系数的橡胶阻尼（overshoot 越小阻力相对越大）。
- 松手：`top` 承担最终位置（瞬时，无补间），`translateY` 直接消失（任何规则都不再过渡 `transform`，因此无跳变）；拿起时的 `scale(1.06)` 改用独立的 CSS `scale` 属性，松手后经 `transition: scale` 用 120ms 弹回 1。
- 已知取舍：松手时摩擦 overshoot 残量（通常 < 20-30px）会瞬时归位，不做回弹补间——见 Verification 的 feel check，如不可接受就回报而不是自行加动画。

## Repo conventions to follow

- 跟手模式 exemplar：`sessionlist.css:895-897`（dragging 时 `transition: none`）。
- 时长/曲线只用 tokens（`--motion-fast: 120ms`、`--ease-standard`），`tokens.css:26-30`。
- P1 契约（`motionContracts.test.ts` "uses a transform offset while dragging…"）pin 住的是：拖拽期间用 transform 偏移、`top: startTop` 冻结——本计划保持该结构（`transform: translateY(dy)` 保留），只把 `scale` 拆成独立属性。

## Steps

1. **`app/web/src/styles/shell.css`** — `.floating-control-stack` 基础规则（505-516 行）中：

   ```css
     transition: transform var(--motion-standard) var(--ease-standard);
   ```

   改为：

   ```css
     transition: scale var(--motion-fast) var(--ease-standard);
   ```

2. **`shell.css:527-531`** — `[data-drag-state='dragging']` 规则删掉 `transition` 行，保留 `filter` 与 `will-change`：

   ```css
   .floating-control-stack[data-drag-state='dragging'] {
     filter: drop-shadow(0 14px 30px rgba(0, 0, 0, 0.28));
     will-change: transform;
   }
   ```

3. **`app/web/src/app/WorkspaceApp.tsx:1539-1541`** — 在 `clampFloatingTop` 之后新增（不动原函数，finish 路径仍用它）：

   ```ts
   function applyFloatingDragFriction(top: number, minTop: number, maxTop: number): number {
     const OVERSHOOT_DAMPING = 0.35;
     if (top < minTop) {
       return minTop - (minTop - top) * OVERSHOOT_DAMPING;
     }
     if (top > maxTop) {
       return maxTop + (top - maxTop) * OVERSHOOT_DAMPING;
     }
     return top;
   }
   ```

4. **`WorkspaceApp.tsx:7184-7192`** — pointermove 里的钳制替换为摩擦：

   ```ts
         setFloatingDragState({
           ...current,
           currentTop: applyFloatingDragFriction(
             current.startTop + deltaY,
             floatingBounds.minTop,
             floatingBounds.maxTop,
           ),
         });
   ```

5. **`WorkspaceApp.tsx:7121-7131`** — 内联样式拆分 `scale` 为独立属性：

   ```ts
             top: `${floatingDragState ? floatingDragState.startTop : effectiveFloatingControlTop}px`,
             transform: floatingDragState
               ? `translateY(${floatingDragState.currentTop - floatingDragState.startTop}px)`
               : undefined,
             scale: floatingDragState ? '1.06' : undefined,
   ```

   （保留 `as React.CSSProperties`；`scale` 是 csstype 支持的独立变换属性。）

`finishFloatingDrag`（`WorkspaceApp.tsx:7204-7241`）与 `cancelFloatingDrag`（`:7245-7250`）保持不变——松手后 `top` 落到钳制后的最终值，`transform`/`scale` 内联移除，位置无跳变、scale 经 transition 弹回。

## Boundaries

- 不得删除或改写 `clampFloatingTop`（持久化路径仍用它钳制）；只新增摩擦函数并替换 move 路径的调用。
- 不得给 `top` 或 `transform` 加回任何 transition；不要做 FLIP（`visual-language.md` 禁布局级动效）。
- 不得改 `floatingControlTop` memo（`:7054-7070`）、side 切换逻辑、长按手势导航逻辑。
- `cancelFloatingDrag`（pointercancel）松手即瞬时归位、无回弹动画，属可接受的罕见路径，不要为它加状态机。
- 若行号处代码与引用不一致，停止并报告。

## Verification

- **Mechanical**：`cd app && npm run tsc:web` 无错误；`cd app && npx jest motionContracts` 全绿（"uses a transform offset while dragging the mobile floating control stack" 断言 `top: startTop` 与 `translateY(currentTop - startTop)` 结构仍在）。
- **Feel check**（移动视图或 ≤900px 窗口）：
  - 按住悬浮控件上下拖：完全跟手，无 120ms 滞后残影。
  - 拖过顶部/底部边界：阻力增大（橡胶感），不再撞墙。
  - 松手：控件停在松手处，scale 从 1.06 在 ~120ms 内收回到 1；**位置不跳、不漂**（DevTools 10% 慢放确认松手帧无 translateY 补间）。
  - 拖出边界很多再松手：overshoot 残量瞬时归位（已知取舍，评估是否可接受）。
  - 点按（不拖）触发导航开关的行为不变。
- **Done when**：拖拽跟手、边界有阻尼、松手无位置跳变；契约测试全绿。
