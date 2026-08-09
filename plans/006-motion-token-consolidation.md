# 006 — 动效时长/曲线字面量归拢到 tokens

- **Status**: DONE
- **Commit**: 5d9dd66e
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens
- **Estimated scope**: 4 files（`chat.css`、`shell.css`、`sessionlist.css`、`file.css`），~40 处单行替换

## Problem

仓库约定（`docs/wiki/frontend-interaction/visual-language.md`「动效原则」原文）："时长与曲线统一走 tokens（`--motion-*` / `--ease-*`），禁止组件内自定义零散时长。" tokens 定义于 `app/web/src/styles/tokens.css:26-30`：

```css
  --motion-fast: 120ms;
  --motion-standard: 180ms;
  --motion-emphasized: 240ms;
  --ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
```

但约 40 处动画/过渡仍是手写毫秒或手写曲线。集中的几类（全部证据已逐条核对）：

1. **菜单入场 `sl-menu-in 140ms var(--ease-out)`**——140ms 不是任何 token，且与 token 化的退出（`sl-menu-out var(--motion-fast)`）不对称。出现位置：`sessionlist.css:354`、`shell.css:1815`、`chat.css:1329`、`chat.css:5195`（若 002 已执行则为两条规则各一处）、`chat.css:5266`、`chat.css:5839`、`chat.css:5963`。
2. **sheet 入场 `180ms` 字面量**（值等于 `--motion-standard` 但未用 token）：`sessionlist.css:856`（`sl-sheet-overlay-in 180ms`）、`sessionlist.css:881`、`sessionlist.css:981`、`shell.css:2120`（`sl-sheet-in 180ms`）。
3. **同一个 keyframes 两种时长**：`chat.css:4464` `animation: sl-list-in 140ms var(--ease-out);` vs `sessionlist.css:158` `animation: sl-list-in var(--motion-standard) var(--ease-out);`。
4. **context-usage-popover 裸 `ease` 入场**（全库唯一，`chat.css:6598-6600`）：

   ```css
     transition:
       opacity 120ms ease,
       transform 120ms ease;
   ```

   入场应 `ease-out`；时长应 token。
5. **hover/颜色过渡的散装毫秒**（80/100/120/140/160ms `ease`）：`shell.css:160`（80ms）、`shell.css:252`（80ms）、`shell.css:353`（100ms）、`shell.css:896`、`shell.css:916`（140ms）、`shell.css:973`（100ms）、`shell.css:1030`（120ms）；`chat.css:710`（120ms×3）、`chat.css:1683`（140ms）、`chat.css:2188`、`chat.css:2274`（120ms）、`chat.css:3192`（160ms）、`chat.css:3448`、`chat.css:3559`、`chat.css:3638`（chevron 140ms）、`chat.css:4196`、`chat.css:5641`、`chat.css:5655`（120ms）、`chat.css:5743`（140ms）、`chat.css:8083`（120ms）；`file.css:46`（120ms）、`file.css:210`（100ms）。
6. **位移类 transition 的散装毫秒**：`chat.css:1451`、`chat.css:1842`、`chat.css:2735`（`transform 150ms var(--ease-out)`）；`chat.css:7379`（`--chat-edge-hidden-alpha 180ms var(--ease-out)`）。
7. **hub 区域/圆点入场**：`chat.css:1747`（`chat-hub-region-in 150ms`）、`chat.css:2139`（`chat-hub-dot-in 140ms`）。
8. **shell 级入场关键字曲线**：`shell.css:28`（`wmFadeIn 160ms ease-out`）、`shell.css:1002`（`wmSlideInLeft 180ms ease-out`）、`shell.css:1047`（`wmFadeIn 180ms ease-out`）。
9. **launch shine 的 Material 曲线**：`shell.css:1769` `animation: wm-launch-shine-sweep 2.1s cubic-bezier(0.4, 0, 0.2, 1) 250ms infinite;`——`cubic-bezier(0.4,0,0.2,1)` 是契约测试在别处驱逐过的曲线，这是最后一个残留。

## Target（映射规则）

| 模式 | 替换为 |
| --- | --- |
| `sl-menu-in 140ms var(--ease-out)` | `sl-menu-in var(--motion-fast) var(--ease-out)`（与退出对齐 120ms） |
| `sl-sheet-in 180ms` / `sl-sheet-overlay-in 180ms` | `… var(--motion-standard) …` |
| `sl-list-in 140ms var(--ease-out)` | `sl-list-in var(--motion-standard) var(--ease-out)` |
| `chat-hub-region-in 150ms` / `chat-hub-dot-in 140ms` | `… var(--motion-fast) …` |
| 入场/hover 的 `Nms ease`（N ∈ 80/100/120/140/160） | `var(--motion-fast) var(--ease-standard)` |
| `transform 150ms var(--ease-out)` | `transform var(--motion-fast) var(--ease-out)` |
| `--chat-edge-hidden-alpha 180ms var(--ease-out)` | `--chat-edge-hidden-alpha var(--motion-standard) var(--ease-out)` |
| `wmFadeIn 160ms ease-out` / `wmFadeIn 180ms ease-out` / `wmSlideInLeft 180ms ease-out` | `… var(--motion-standard) var(--ease-out)` |
| `cubic-bezier(0.4, 0, 0.2, 1)`（launch shine） | `var(--ease-standard)` |
| `chat.css:6598-6600` 的 `opacity 120ms ease, transform 120ms ease` | `opacity var(--motion-fast) var(--ease-out), transform var(--motion-fast) var(--ease-out)` |

注意：hover 颜色过渡从 80/100ms 统一到 120ms 是**有意为之**（房子标准 hover 时长就是 `--motion-fast`，契约测试 P2 "maps common hover and sheet timings to shared motion tokens" 即此方向）。

## Repo conventions to follow

- 契约测试 `motionContracts.test.ts` P2 已 pin 的 token 形态即 exemplar，例如 `transition: background-color var(--motion-fast) var(--ease-standard);`、`animation: mobile-sheet-slide-up var(--motion-emphasized) var(--ease-out);`。
- 每个 token 在 `:root` 与 `.theme-light` 双定义（`tokens.css:26-30` 与 `:89-93`），无需新增 token。

## Steps

1. 对上表左侧的每个字面量，用 Grep 在 `app/web/src/styles/` 内定位（模式如 `sl-menu-in 140ms`、`140ms ease`），逐处替换为右侧 token 形态。Problem 中的 file:line 是写作时（commit 5d9dd66e）的位置；若 002/004 已先执行，个别规则会位移或拆分，以 grep 内容为准。
2. 每处替换只动时长/曲线值，不动属性列表、不动选择器、不动 keyframes 形状。
3. 完成后用 `grep -rn '[0-9]ms' app/web/src/styles/*.css` 复查：剩余毫秒值应只剩——keyframes 内部无时长、`MENU_EXIT_MS` 注释、`--motion-*` token 定义、`0.9s/1.2s/1.4s/1.6s/2.1s` 等环境氛围循环（breathe/pulse/spin/shine 的周期，本计划不动）、`--sl-sheet-release-duration` 相关注释。若发现漏网的 UI 过渡字面量，按上表精神补替并在完成报告中列出。

## Boundaries

- **不得**触碰：`chat.css:6003-6006` 与 `shell.css:619-621`（计划 004 已 token 化并加 transform，若 004 未执行则跳过这两处并在报告中注明）；`shell.css:1508` 与 `shell.css:1524`（死代码，计划 007 删除）；任何无限循环动画的周期时长（breathe、pulse、dot wave、bike spin、shine 2.1s 等——周期不是"过渡时长"）；`chat.css:5195` 所在规则的 `transform-origin`（计划 002 的职责）。
- 不得新增/修改 token 值；不得把 `ease-in-out` 的无限脉冲改成别的曲线。
- 不改任何 tsx。
- 若某处代码与描述不符（漂移），跳过该处并在报告中列出，不要即兴替换。

## Verification

- **Mechanical**：
  - `cd app && npx jest motionContracts` 全绿。
  - `grep -rn 'sl-menu-in 140ms\|sl-sheet-in 180ms\|150ms\|160ms\|80ms ease\|100ms ease' app/web/src/styles/*.css` 无 UI 过渡残留（launch shine 的 250ms delay 与 2.1s 周期除外）。
  - `cd app && npm run build:web` 构建通过（可选但推荐）。
- **Feel check**：
  - 打开/关闭会话操作菜单、topbar 菜单、composer 配置菜单：入场与退出对称感一致（都 120ms），无可见变化即为成功（这是归拢，不是重做）。
  - hover 各类行/按钮：反馈干脆，无明显变慢（80→120ms 的差异应几乎不可察）。
  - context-usage 指示器（composer 上的上下文用量）hover/focus 弹出：入场起笔更快（ease-out）。
- **Done when**：目标字面量全部 token 化；契约测试全绿；界面动效无可见回退。
