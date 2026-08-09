# 007 — 微抛光批量：stagger 间隔、tooltip 缩放原点、动效死代码清理

- **Status**: DONE
- **Commit**: 5d9dd66e
- **Severity**: LOW
- **Category**: Cohesion / Physicality / 死代码
- **Estimated scope**: 6 files，~30 lines（三个独立小节，可分别提交验证）

## A — agent-choice pill 的 stagger 低于感知带

### Problem

`app/web/src/chat/AgentChoiceMenu.tsx:108`（当前代码）：

```tsx
                  style={{'--agent-choice-delay': `${Math.min(index, 14) * 18}ms`} as React.CSSProperties}
```

间隔 18ms/项低于 30-80ms 的感知带——人眼读不出级联，等于"同时出现"。消费端 `sessionlist.css:706-712` 的 `agent-choice-pill-in`（`backwards` fill + `animation-delay: var(--agent-choice-delay)`）机制本身正确，只是步进太小。

### Target

```tsx
                  style={{'--agent-choice-delay': `${Math.min(index, 14) * 40}ms`} as React.CSSProperties}
```

40ms/项（15 项封顶时末项延迟 560ms；动画是装饰性的 `backwards` 入场，不阻塞点击）。

## B — tooltip 缩放原点跟随 placement

### Problem

`app/web/src/styles/tooltip.css:21-26`（当前代码）：

```css
  opacity: 0;
  transform: translateY(2px) scale(0.98);
  transition:
    opacity var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
```

`.sl-tooltip` 无 `transform-origin`——scale 从中心缩放，而 tooltip 明明锚定在目标元素上。另外 placement 被 `flip()` 翻到下方时（`common/Tooltip.tsx:151-158`，`placement: 'top'` + flip middleware），隐藏的初始位移仍是 `translateY(2px)`（向下），方向反了——应向锚点方向收起。

`app/web/src/common/Tooltip.tsx:155-158`（当前代码）：

```ts
      }).then(({x, y}) => {
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
      });
```

### Target

`Tooltip.tsx` 的 then 回调改为：

```ts
      }).then(({x, y, placement}) => {
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        const side = placement.split('-')[0];
        node.style.transformOrigin = side === 'top' ? 'bottom center' : 'top center';
        node.dataset.placement = side === 'top' ? 'top' : 'bottom';
      });
```

`tooltip.css` 在 `.sl-tooltip.visible` 规则（28-31 行）之后追加：

```css
.sl-tooltip[data-placement='bottom']:not(.visible) {
  transform: translateY(-2px) scale(0.98);
}
```

（tooltip 在目标上方时 origin 是 bottom center、初始向下偏 2px——朝锚点长出；翻到下方时相反。reduced-motion 块已有 `transform: none; transition: none;`，无需改。）

## C — 动效死代码清理

### Problem（全部为已核实无消费者/被覆盖的规则）

1. `app/web/src/styles/shell.css:1508`：`.drawer-overlay` 块内 `transition: opacity 220ms cubic-bezier(0.2, 0.85, 0.3, 1);`——被 `shell.css:1594` 的 token 化规则整体覆盖，死声明。
2. `app/web/src/styles/shell.css:1524`：`.drawer` 块内 `transition: transform 220ms cubic-bezier(0.2, 0.85, 0.3, 1), box-shadow 220ms ease;`——被 `shell.css:1606`（`transition: transform var(--motion-emphasized) var(--ease-out);`）整体覆盖，死声明。
3. `app/web/src/styles/base.css:331-335`：`@keyframes folder-open-pop { 0% { transform: scale(0.88); } 60% { transform: scale(1.06); } 100% { transform: scale(1); } }`——全仓（css/ts/tsx）无任何 `folder-open-pop` 引用。
4. `app/web/src/styles/chat.css:6175-6181`：`.chat-attach-button` 与 `.chat-image-attach-button` 两条颜色规则——全仓 ts/tsx 无这两个 class 的使用。
5. `app/web/src/styles/shell.css:171-189`：`.desktop-window-source-popover` 与 `.theme-light .desktop-window-source-popover` 两个块——全仓（含 server/、mobile/、html/js）无此 class 使用。

### Target

删除上述 5 处（对 1、2 只删 `transition` 一行，块内其余声明保留）。

## Repo conventions to follow

- stagger 语义：装饰性、不阻塞交互（`backwards` fill 已保证）。
- tooltip 体系约定见 `visual-language.md`（共享 Tooltip 全局单例、`data-tooltip` 属性）；本改动不改 API。

## Steps

1. A：`AgentChoiceMenu.tsx:108` 的 `* 18` 改为 `* 40`。
2. B：按 Target 改 `Tooltip.tsx` 的 then 回调；`tooltip.css` 追加 data-placement 规则。
3. C：删除五处死代码；删前对每处做一次全仓 grep 复核（`folder-open-pop`、`chat-attach-button`、`chat-image-attach-button`、`desktop-window-source-popover`），确认仍无引用再删。

## Boundaries

- 不动 Tooltip 的 hover 延迟（300ms）、连续切换即时显示、EXIT_DURATION_MS=120 等行为逻辑；只加 origin/placement 两个写入。
- 死代码删除以 grep 复核为准：若任一 class 在删除前出现了新引用，跳过该条并在报告中注明。
- 不要顺带格式化/重排任何 css 块。
- 若行号处代码与引用不一致，停止并报告。

## Verification

- **Mechanical**：`cd app && npm run tsc:web` 无错误；`cd app && npx jest motionContracts` 与 `cd app && npx jest Tooltip` 通过；保险起见再跑 `cd app && npx jest` 全量。
- **Feel check**：
  - 新建会话选择 agent 的 pill 组：逐项级联淡入可感知但不拖沓。
  - hover 任意 `data-tooltip` 按钮：tooltip 从锚点一侧长出（上方锚定时从底部中心缩放）；把视口调到会触发 flip 的位置（目标贴近屏幕顶）→ tooltip 在下方时从顶部中心长出、初始偏移向上。
  - DevTools Rendering 模拟 reduced motion → tooltip 立即显隐（无补间）。
  - 死代码删除后 `cd app && npm run build:web` 通过，界面无样式回退（重点看 drawer、launch 覆盖层、附件按钮）。
- **Done when**：三节各自生效；测试与构建通过；grep 无残留引用。
