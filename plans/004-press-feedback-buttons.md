# 004 — 高频按钮补齐 :active 按压反馈

- **Status**: DONE
- **Commit**: 5d9dd66e
- **Severity**: MEDIUM
- **Category**: Physicality（按压反馈）
- **Estimated scope**: 2 files（`app/web/src/styles/chat.css`、`app/web/src/styles/shell.css`），~12 lines

## Problem

两组高频按钮没有任何 `:active` 按压反馈，点下去界面"没听见"：

1. **`.chat-tool-button`**（composer 工具按钮：/、@、回形针等，24×24 图标按钮，每天点击几十次）——`app/web/src/styles/chat.css:5993-6007`（当前代码）：

   ```css
   .chat-tool-button {
     width: 24px;
     height: 24px;
     border: none;
     border-radius: 7px;
     background: transparent;
     color: color-mix(in srgb, var(--text-secondary) 86%, var(--text-primary));
     cursor: pointer;
     display: inline-grid;
     place-items: center;
     line-height: 1;
     transition:
       background 120ms ease,
       color 120ms ease,
       box-shadow 120ms ease;
   }
   ```

   状态规则只有 `:hover`/`:focus-visible`/`:disabled`（`chat.css:6239-6258`），无 `:active`。

2. **`.floating-nav-card-item`**（移动端浮动导航卡片项，44×44）——`app/web/src/styles/shell.css:607-628`（当前代码节选）：

   ```css
   .floating-nav-card-item {
     ...
     transition: background var(--motion-fast) var(--ease-standard),
       color var(--motion-fast) var(--ease-standard);
   }

   .floating-nav-card-item:hover {
     background: var(--hover);
     color: var(--text-primary);
   }
   ```

   无 `:active`。它的兄弟 `.floating-nav-button` 有 `shell.css:559-560`：

   ```css
   .floating-nav-button:active {
     transform: scale(0.96);
   }
   ```

## Target

```css
/* chat.css — .chat-tool-button 的 transition 目标（token 化 + 加 transform） */
  transition:
    background var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);

/* 新增规则 */
.chat-tool-button:active:not(:disabled) {
  transform: scale(0.95);
}

/* shell.css — .floating-nav-card-item 的 transition 目标 */
  transition: background var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);

/* 新增规则（与兄弟按钮一致的幅度） */
.floating-nav-card-item:active {
  transform: scale(0.96);
}
```

## Repo conventions to follow

- 按压反馈 exemplar（pinned 契约）：`.chat-send-button:active:not(:disabled)`（`chat.css` 中 scale(0.97)，`motionContracts.test.ts` "keeps keyboard composer menus immediate and gives the send action press feedback"）。幅度区间 0.95-0.98；24px 小按钮用 0.95，44px 用 0.96 对齐兄弟。
- 时长/曲线只用 tokens（`tokens.css:26-30`）：`--motion-fast: 120ms`、`--ease-standard`。本计划顺带把 `.chat-tool-button` 的 `120ms ease` 字面量 token 化（`visual-language.md`：禁止组件内自定义零散时长），**计划 006 不再重复处理这两条规则**。
- 按压反馈属即时物理反馈，参照 send-button 先例不做 `prefers-reduced-motion` 豁免。

## Steps

1. **`app/web/src/styles/chat.css:6003-6006`** — 替换 `.chat-tool-button` 的 transition 为 Target 中的四属性 token 版本。
2. **`chat.css`** — 在 `.chat-tool-button:hover, .chat-tool-button:focus-visible { ... }` 规则（6239-6244 行）之后新增 `.chat-tool-button:active:not(:disabled)` 规则（Target）。
3. **`app/web/src/styles/shell.css:619-621`** — 替换 `.floating-nav-card-item` 的 transition 为 Target 中的三属性版本（加 transform）。
4. **`shell.css`** — 在 `.floating-nav-card-item:hover { ... }`（625-628 行）之后新增 `.floating-nav-card-item:active` 规则（Target）。

## Boundaries

- 只加 `:active` 与 transition 声明；不改 hover/disabled/focus-visible 规则、不改尺寸颜色。
- 幅度不得超过 0.95-0.98 区间；不要给 disabled 态加按压。
- 不要顺手给其他次级按钮加 `:active`（`.project-session-menu-btn`、`.app-menu-trigger`、`.chat-hub-action` 等已评估为 LOW，不在本计划）。
- 计划 006（token 化）执行时若发现这两条 transition 已是 token 形态，跳过即可。
- 若行号处代码与引用不一致，停止并报告。

## Verification

- **Mechanical**：`cd app && npx jest motionContracts` 全绿（send-button 契约不受影响）。
- **Feel check**：
  - 桌面：鼠标按住 composer 的 /、@、回形针按钮 → 按钮按下缩到 0.95，松开弹回，120ms 内完成，"脆"不拖泥。
  - 移动视图：点开浮动导航卡片，按住任一项 → scale(0.96) 反馈与外层浮动按钮一致。
  - 触屏/鼠标都要有反馈（`:active` 两种指针都触发）。
- **Done when**：两处按钮按压可见反馈；无布局抖动（scale 不影响布局）；契约测试全绿。
