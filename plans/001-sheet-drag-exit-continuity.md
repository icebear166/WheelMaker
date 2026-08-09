# 001 — Sheet 甩动关闭时退出动画从手势位置继续

- **Status**: DONE
- **Commit**: 5d9dd66e
- **Severity**: MEDIUM
- **Category**: Interruptibility（可中断性 / 手势连续性）
- **Estimated scope**: 3 files, ~20 lines

## Problem

移动端会话操作底部 sheet（`.project-session-action-menu.sl-sheet`，宽度 ≤900px 时出现）支持下拉关闭：拖动距离超过 72px 或速度超过 0.5px/ms 即触发 dismiss。但 dismiss 路径在同一个批次里把拖动偏移清零并调用 `onDismiss()`，导致 sheet 先瞬移回 `translateY(0)`，再从头播放 `sl-sheet-out`（0 → 16px 淡出）。手势位置与退出动画起点断裂——用户从 200px 处甩出，sheet 却跳回 0 再退出。

`app/web/src/chat/sessionlist/sheetDragDismiss.ts:78-85`（当前代码）：

```ts
    if (!dismissed) {
      setReleaseDurationMs(resolveSheetReleaseDuration(velocity));
    }
    setDragging(false);
    setDragOffset(0);
    if (dismissed) {
      onDismiss();
    }
```

`app/web/src/chat/sessionlist/SessionMenu.tsx:99` 与 `:104-105`（当前代码）：

```tsx
      className={`project-session-action-menu sl-session-list-popover${sheet ? ' sl-sheet' : ''}${exiting ? ' sl-menu-exit' : ''}${dragging ? ' dragging' : ''}`}
```

```tsx
            '--sl-sheet-release-duration': `${releaseDurationMs}ms`,
            ...(dragOffset > 0 ? {transform: `translateY(${dragOffset}px)`} : {}),
```

退出动画规则 `app/web/src/styles/sessionlist.css:924-927`（当前代码，被 `motionContracts.test.ts` pin 住，**不得修改**）：

```css
  .project-session-action-menu.sl-sheet.sl-menu-exit {
    /* Must fit MENU_EXIT_MS (120ms) or the portal unmounts mid-animation. */
    animation: sl-sheet-out var(--motion-fast) var(--ease-out) forwards;
  }
```

`sl-sheet-out` keyframes（`sessionlist.css:840-842`）：

```css
@keyframes sl-sheet-out {
  to { opacity: 0; transform: translateY(16px); }
}
```

## Target

dismiss 路径保留当前 `dragOffset`（内联 `translateY(dragOffsetpx)` 在退出期间继续渲染），并为拖拽关闭使用专用退出 keyframes：从手势位置（隐式 `from` = 当前内联 transform）继续滑出屏幕外（`translateY(100%)`，sheet `bottom: 0` 锚定，自身高度即完全移出视口）。点击关闭（dragOffset = 0）行为完全不变，仍走 pinned 的 `sl-sheet-out`。

改动后目标代码见 Steps。

## Repo conventions to follow

- 进退场统一 `sl-menu-in` / `sl-menu-exit` + `menuExit.ts` 状态包装（`docs/wiki/frontend-interaction/visual-language.md`「动效原则」）；本计划只增加一个拖拽专用的 `animation-name` 覆盖，不改 pinned 规则。
- 退出时长 token `--motion-fast`（120ms）与 `MENU_EXIT_MS = 120`（`menuExit.ts:3`）严格配对，父组件 120ms 后卸载——新 keyframes 同样在该窗口内完成，不得加长。
- 参照模式：`.sl-sheet.dragging { transition: none; }`（`sessionlist.css:895-897`，拖拽中精确跟手）。

## Steps

1. **`app/web/src/chat/sessionlist/sheetDragDismiss.ts`** — 改写 `endDrag` 的收尾（当前 78-85 行，见 Problem）。改为：

   ```ts
       setDragging(false);
       if (dismissed) {
         // Dismissed by drag: keep dragOffset so the exit animation starts
         // from the gesture position instead of teleporting back to 0.
         onDismiss();
         return;
       }
       setReleaseDurationMs(resolveSheetReleaseDuration(velocity));
       setDragOffset(0);
   ```

   即：dismiss 时不再 `setDragOffset(0)`，直接 `onDismiss()`；非 dismiss 回弹路径保持不变（先设速度推导的时长，再清零偏移，由 CSS transition 弹回）。

2. **`app/web/src/chat/sessionlist/SessionMenu.tsx:99`** — className 模板中追加 `from-drag` 标记（拖拽关闭时 dragOffset > 0 且 exiting 为真）：

   ```tsx
         className={`project-session-action-menu sl-session-list-popover${sheet ? ' sl-sheet' : ''}${exiting ? ' sl-menu-exit' : ''}${dragging ? ' dragging' : ''}${exiting && dragOffset > 0 ? ' from-drag' : ''}`}
   ```

3. **`app/web/src/styles/sessionlist.css`** — 在 `@keyframes sl-sheet-out`（840-842 行）之后新增 keyframes：

   ```css
   @keyframes sl-sheet-out-drag {
     to { opacity: 0; transform: translateY(100%); }
   }
   ```

   并在 `@media (max-width: 900px)` 块内 `.project-session-action-menu.sl-sheet.sl-menu-exit` 规则（924-927 行）之后新增：

   ```css
     .project-session-action-menu.sl-sheet.sl-menu-exit.from-drag {
       /* Drag dismiss: continue from the gesture offset (implicit `from`) to
          fully off-screen, instead of replaying the 16px tap-close exit. */
       animation-name: sl-sheet-out-drag;
     }
   ```

   只覆盖 `animation-name`；时长/曲线/fill 继承 pinned 规则（`--motion-fast` = 120ms ≤ `MENU_EXIT_MS`）。

## Boundaries

- 不得修改 pinned 规则 `.project-session-action-menu.sl-sheet.sl-menu-exit`（`sessionlist.css:924-927`）与 `sl-sheet-out` keyframes；`motionContracts.test.ts` 断言 `animation: sl-sheet-out var(--motion-fast) var(--ease-out) forwards;` 必须继续成立。
- 不得修改 `resolveSheetReleaseDuration`（被 test pin：`0→180, 0.4→140, 0.8→100`）。
- 不得改 `.sl-sheet-overlay` 退出（overlay 淡出与拖动无关，保持现状）。
- 不得动非 dismiss 回弹路径、`MENU_EXIT_MS`、`menuExit.ts`。
- `useSheetDragToDismiss` 唯一消费者是 `SessionMenu.tsx`；不要给其他组件接这个 hook。
- 若上述行号处代码与 Problem 引用不一致（commit 漂移），停止并报告，不要自行发挥。

## Verification

- **Mechanical**：
  - `cd app && npm run tsc:web` — 无类型错误。
  - `cd app && npx jest motionContracts` — 全部通过（特别是 "uses one tokenized exit duration for shared menu surfaces"）。
  - `cd app && npx jest sheetDragDismiss`（若存在对应测试文件）— 通过。
- **Feel check**：窗口缩到 ≤900px（或移动视图），打开会话列表，长按一个会话弹出操作 sheet：
  - 下拉约 150px 后快速甩出 → sheet 从松手位置继续向下滑出屏幕，**不出现先跳回顶部再退出的瞬移**。
  - 下拉超过 72px 慢速松手 → 同样从当前位置滑出。
  - 下拉 30px 松手 → 弹回原位（行为与改动前一致，时长随速度 100-180ms）。
  - 直接点关闭按钮（不拖动）→ 仍是原来的 16px 淡出退出。
  - DevTools Animations 面板 10% 慢放确认：退出起点连续。
  - Rendering 面板勾选 `prefers-reduced-motion: reduce` → dismiss 立即卸载，无动画（`closeWithExit` 的 reduced 分支）。
- **Done when**：甩动关闭无瞬移；点按关闭、回弹、reduced-motion 路径均不回归；契约测试全绿。
