# 002 — 修正三组浮层的 transform-origin 与锚点错位

- **Status**: DONE
- **Commit**: 5d9dd66e
- **Severity**: MEDIUM
- **Category**: Physicality & origin
- **Estimated scope**: 1 file（`app/web/src/styles/chat.css`），~10 lines

## Problem

浮层入场动画（`sl-menu-in`：opacity + translateY(-2px) + scale(0.98)）从 `transform-origin` 缩放，但三组浮层的 origin 与实际锚点不符，看起来像从空气中长出：

1. **Composer 配置菜单** `app/web/src/styles/chat.css:5191-5196`（当前代码）：

   ```css
   .chat-core-config-menu,
   .chat-config-value-menu,
   .chat-attachment-action-tray {
     transform-origin: bottom center;
     animation: sl-menu-in 140ms var(--ease-out);
   }
   ```

   实际锚点：`.chat-core-config-menu`（`chat.css:6770-6773`）与 `.chat-config-value-menu`（`chat.css:6963-6969`）都是 `position: absolute; right: 0; bottom: calc(100% + 10px);`——菜单右对齐在触发器上方，从 bottom **center** 缩放会向左偏移生长。`.chat-attachment-action-tray` 相反：`left: 28px; bottom: calc(100% + 6px);`（`chat.css:6185-6187`），锚在左侧。

2. **标题栏菜单与 hub popover** `chat.css:7329-7333`（当前代码）：

   ```css
   .chat-title-project-menu,
   .chat-title-prompt-menu,
   .chat-hub-popover {
     transform-origin: top center;
   }
   ```

   实际锚点：`.chat-title-project-menu`（`chat.css:241-247`）与 `.chat-title-prompt-menu`（`chat.css:332-335`）均为 `position: fixed; left: 12px;`，宽度 360/430px——origin 在菜单水平中心，离左侧触发器约 180-215px。`.chat-hub-popover`（`chat.css:1306-1312`，宽 340px）位于 `left: 12px` 的 hub 栈内，同理。三者都带 `topbar-menu-surface` class（入场动画来源，origin 变量 `--popover-origin` 的默认值是 `top center`，被上述硬编码覆盖）。

注意：`chat.css:5186-5189` 的 `.chat-slash-menu, .chat-file-mention-menu { transform-origin: bottom center; }` 是 **pinned 契约**（全宽 composer 菜单，bottom center 正确），不得触碰。

## Target

```css
/* chat.css — 目标 */
.chat-core-config-menu,
.chat-config-value-menu {
  transform-origin: bottom right;
  animation: sl-menu-in 140ms var(--ease-out);
}

.chat-attachment-action-tray {
  transform-origin: bottom left;
  animation: sl-menu-in 140ms var(--ease-out);
}

.chat-title-project-menu,
.chat-title-prompt-menu,
.chat-hub-popover {
  transform-origin: top left;
}
```

（`140ms` 字面量由计划 006 统一 token 化，本计划保持原样，只改 origin。）

## Repo conventions to follow

- origin 派生的房子模式是 `--popover-origin` / `--sl-popover-origin` 变量（`shell.css:1814`、`sessionlist.css:389`，契约测试 "derives anchored project popover origin from its placement"）。本组菜单位置全部固定，直接写静态 origin 即可，不需要引入变量。
- `chat.css:5198-5204` 已有这三类菜单的 `prefers-reduced-motion` 块（`animation: none`），拆分时保持选择器覆盖一致。

## Steps

1. **`app/web/src/styles/chat.css:5191-5196`** — 把合并规则拆成两条（selector 拆分 + origin 修正），结果如 Target 前两段。动画声明逐字保留。
2. **`chat.css:5198-5204` 的 reduced-motion 块** — 当前为：

   ```css
   @media (prefers-reduced-motion: reduce) {
     .chat-core-config-menu,
     .chat-config-value-menu,
     .chat-attachment-action-tray {
       animation: none;
     }
   }
   ```

   选择器不变（与拆分后的规则仍然匹配），**无需修改**，确认即可。
3. **`chat.css:7329-7333`** — 把 `transform-origin: top center;` 改为 `transform-origin: top left;`，选择器不变。

## Boundaries

- 不得触碰 `.chat-slash-menu, .chat-file-mention-menu` 的 origin 规则（pinned，`chat.css:5186-5189`）。
- 不得改任何菜单位置/尺寸/动画时长；本计划只改 `transform-origin`（以及为区分 origin 而做的选择器拆分）。
- `.chat-config-value-menu` 有 `min-width: 100%`：内容窄于触发器时菜单与触发器等宽，bottom right 依然正确（右缘对齐）。
- modal/对话框类（`.app-dialog`、`.usage-dialog` 等）origin 居中是正确的，不要动。
- 若行号处代码与引用不一致，停止并报告。

## Verification

- **Mechanical**：`cd app && npx jest motionContracts` 全绿（特别是 "keeps keyboard composer menus immediate…" 与 "anchors generic topbar surfaces…"）。
- **Feel check**：
  - 桌面宽视图，点 composer 右下角配置触发器（model/reasoning 等 pill）→ 菜单从触发器右下角向上生长，不再从中心。
  - 点回形针旁的附件操作入口 → tray 从其左侧长出。
  - 点标题栏项目名 / prompt 菜单 / hub 按钮 → 菜单从左上角长出。
  - DevTools 10% 慢放确认 scale 起点在触发器一侧。
- **Done when**：五处浮层的缩放起点都落在各自触发器上；契约测试不红。
