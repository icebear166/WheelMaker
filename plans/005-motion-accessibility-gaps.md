# 005 — 动效无障碍三处缺口：侧栏 reduced-motion、stop-pill hover 门控、reduced 块保留颜色反馈

- **Status**: DONE
- **Commit**: 5d9dd66e
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 2 files（`app/web/src/styles/shell.css`、`app/web/src/styles/chat.css`），~30 lines

三个独立的 a11y 修正打包为一个计划（都属媒体查询正确性，步骤互不依赖，可分别验证）。仓库自家约定（`docs/wiki/frontend-interaction/visual-language.md`「动效原则」）："所有动画提供 `prefers-reduced-motion` 降级"。

## Problem A — 侧栏位移动画无 reduced-motion 覆盖

`app/web/src/styles/shell.css:991-1003`（当前代码节选）：

```css
.workspace-left {
  ...
  animation: wmSlideInLeft 180ms ease-out;
}
```

`wmSlideInLeft`（`base.css:488-497`）含 `transform: translateX(-6px)` 位移，是整个 shell 中唯一没有 reduced-motion 降级的位移动画（`shell.css` 的 8 个 reduced 块——84、675、1113、1392、1784、1795、2089、2127 行——都不含 `.workspace-left`）。

## Target A

reduced 时降级为纯 opacity 淡入（`wmFadeIn`，`base.css:479-486`，opacity-only keyframes）。在 `shell.css:2089-2093` 的现有块中追加：

```css
@media (prefers-reduced-motion: reduce) {
  .workspace-right > .content:has(> .chat-title-bar) {
    animation: none;
  }

  .workspace-left {
    animation: wmFadeIn var(--motion-standard) var(--ease-out);
  }
}
```

## Problem B — stop-pill hover 形变未门控

`app/web/src/styles/chat.css:6120-6129`（当前代码）：

```css
.chat-stop-pill:hover:not(:disabled) .chat-stop-bike,
.chat-stop-pill.armed .chat-stop-bike {
  opacity: 0;
  transform: scale(0.8);
}

.chat-stop-pill:hover:not(:disabled) .chat-stop-pill-stop-glyph,
.chat-stop-pill.armed .chat-stop-pill-stop-glyph {
  opacity: 1;
  transform: none;
}
```

全库唯一未加 `@media (hover: hover)` 门控的 hover transform。触屏点按会粘滞 hover，导致点 stop-pill 时自行车↔stop 图标的 swap 动画多播一次（`.armed` 通道是功能性的，应保留）。

## Target B

拆分选择器：`.armed` 通道保持无门控，`:hover` 通道包进完整门控查询（与 `settings.css:2124` 的 `@media (hover: hover) and (pointer: fine)` 一致）：

```css
.chat-stop-pill.armed .chat-stop-bike {
  opacity: 0;
  transform: scale(0.8);
}

.chat-stop-pill.armed .chat-stop-pill-stop-glyph {
  opacity: 1;
  transform: none;
}

@media (hover: hover) and (pointer: fine) {
  .chat-stop-pill:hover:not(:disabled) .chat-stop-bike {
    opacity: 0;
    transform: scale(0.8);
  }

  .chat-stop-pill:hover:not(:disabled) .chat-stop-pill-stop-glyph {
    opacity: 1;
    transform: none;
  }
}
```

## Problem C — reduced-motion 块把颜色反馈也杀了

playbook 原则：reduced motion = 去掉位移、**保留** opacity/颜色反馈。当前两处块 `transition: none` 一刀切：

`app/web/src/styles/chat.css:2191-2208`（当前代码，14 个 hub 类）：

```css
@media (prefers-reduced-motion: reduce) {
  .chat-hub-row,
  .chat-hub-color-button,
  .chat-hub-section-header,
  .chat-hub-action,
  .chat-hub-icon-btn,
  .chat-hub-detail-action,
  .chat-hub-project-row,
  .chat-hub-project-skill-trigger,
  .chat-hub-project-skill-option,
  .chat-hub-flicker-modes button,
  .chat-hub-skill-icon-button,
  .chat-hub-skill-toolbar-button,
  .chat-hub-skill-update-all,
  .chat-hub-skill-row-actions button,
  button.chat-hub-skill-name {
    transition: none;
  }
}
```

`app/web/src/styles/shell.css:675-685`（当前代码）：

```css
@media (prefers-reduced-motion: reduce) {
  .topbar-menu-surface,
  .floating-nav-card,
  .floating-nav-button,
  .floating-nav-card-item,
  .floating-control-drag-backdrop,
  .floating-control-dock-rail,
  .floating-control-stack {
    animation: none;
    transition: none;
  }
}
```

`chat.css:1750-1760`（hub-sections 块）同款 `animation: none; transition: none;`。

## Target C

把这三个块里的 `transition: none;` 替换为只保留非位移属性的属性过滤器（`animation: none` 行保留）：

```css
    transition-property: background, background-color, border-color, color, box-shadow, outline-color, opacity;
```

效果：reduced-motion 用户看不到 transform/位移补间，但 hover/按压的背景色、边框色反馈仍然平滑（时长沿用各元素自身声明的 token 值）。

## Repo conventions to follow

- 完整 hover 门控查询 exemplar：`settings.css:2124` `@media (hover: hover) and (pointer: fine)`（被契约测试 "anchors generic topbar surfaces and keeps hover-only movement off touch" pin 住的形式）。
- reduced 降级保留 opacity 的先例：`sessionlist.css:786-788`（spinner 降速而非删除）。
- token：`--motion-standard: 180ms`、`--ease-out`（`tokens.css:27-30`）。

## Steps

1. **A**：`shell.css:2089-2093` 的 reduced 块中追加 `.workspace-left` 规则（Target A）。
2. **B**：`chat.css:6120-6129` 两条合并规则替换为 Target B 的两条 `.armed` 规则 + 一个门控媒体查询块。
3. **C**：`chat.css:2191-2208`、`chat.css:1750-1760`、`shell.css:675-685` 三个块中的 `transition: none;` 替换为 Target C 的 `transition-property` 过滤器；`animation: none;` 行原样保留。

## Boundaries

- 只动上述五处；不要"顺手"审查其他 reduced 块（其余已审计为正确）。
- 计划 006 会把 `shell.css:1002` 的 `180ms ease-out` token 化——与本计划 Target A 是不同行，互不冲突；若 006 先执行，Target A 中新规则的值仍以本计划为准（直接用 token）。
- 不要给 `.workspace-left` 的 reduced 规则用 `animation: none`——保留 opacity 淡入是本次修正的要点。
- 若行号处代码与引用不一致，停止并报告。

## Verification

- **Mechanical**：`cd app && npx jest motionContracts` 全绿（特别是 "uses the valid reduced-motion query and avoids scale-zero indicators" 与 hover 门控断言）。
- **Feel check**：
  - DevTools Rendering 面板模拟 `prefers-reduced-motion: reduce`，刷新/折叠展开侧栏 → 侧栏只淡入、无位移。
  - 模拟 reduced motion 后 hover hub 菜单行、浮动导航按钮 → 背景色变化仍平滑（非跳变），但无任何位移/缩放入场。
  - 触屏（或 DevTools 设备模拟）点 stop-pill（会话运行时 composer 的停止按钮）→ 不再因粘滞 hover 多播图标 swap；`.armed` 态（真正停止中）图标切换仍正常。
  - 桌面 hover stop-pill → swap 动画照旧。
- **Done when**：三处修正各自生效且互不影响；契约测试全绿。
