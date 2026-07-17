# Session list redesign

> 由 scope skill 于 2026-07-17 生成

## 目标

右侧会话列表的 UI/UX 迭代。现状：Recent 区使用彩色项目卡片 + 大写水印 + 组外悬浮 `+`；Recent 的 pin 状态同时驱动 sticky 与折叠侧栏 surface 的显隐；侧栏与 surface 的折叠状态分裂；Recent 内选中竖条被 CSS 显式移除；桌面端无显式项目 pin 入口（仅 mobile 长按）；session 行视觉多年未动。目标是在保持信息层级与核心交互双端一致的前提下，让列表精简、精致、有设计感，并建立统一的项目分组视觉语言。

## 决策

- 保留现有 Recent 排序与项目分组结构，不改为全局扁平时间序。
- 会话上下文操作保持桌面右键 / mobile 长按，不新增常驻行内按钮（hover 浮现除外，见下）。
- Recent 是普通项目文件夹同级的虚拟文件夹，恒置顶 sticky；删除 `recentSessionsPinned` 状态、pin 按钮与 `.recent-sessions-section.pinned` 门控。
- 桌面侧栏折叠时 `ChatRecentSessionsSurface` 恒可用（不再由 pin 门控）；其折叠状态提升为与主列表共享的单一状态（`collapsedProjectIds[RECENT_SESSIONS_VIRTUAL_PROJECT_ID]`），删除 surface 私有 `collapsed` state、unpin 按钮与 `onUnpin` prop。
- 删除 Recent 的彩色项目卡背景、项目名水印、组外悬浮 `+`（对应 `recent-project-session-group` accent 体系、`recent-project-session-watermark`、`recent-project-session-create`）。
- Recent 内项目分组标注 = 14–16px 微分隔行：仅在项目变化处出现，含项目图标/名称 + 简洁 hub 标签 + `+`；`+` 打开与普通项目头 `+` 相同的 new-session agent 流程。项目组不获得独立折叠状态，session 行本身不增高、不内嵌项目标签。
- 恢复选中竖条：Recent 与普通项目列表的选中样式完全一致；选中实现从 `-21px` 负 margin 突破方案改为卡内 inset 语言（负 margin 会把竖条戳出安静卡片）。
- 项目分组视觉语言 = 中性安静卡片：普通项目组与 Recent 统一使用低透明中性 surface + 8px 圆角 + 1px 极浅边框 + 组间留白；不做 accent 染色（旧决策禁的是彩色卡片，不是卡片本身）。Recent 内部的子分组只用微分隔行，不套第二层卡片。
- 项目 pin 显式化：普通项目头 `wide-project-actions` 增加显式 pin 按钮（与 `+`、Resume 同一 action 位）；mobile 保留长按作为对应。pin 仅将项目重排到普通项目列表顶部，pinned 项目随列表正常滚动，不做 sticky、不新增浮面。
- Session 行单行精修（行高与 grid 列模型不变）：
  - 选中态强化（与竖条一致的 inset 高亮语言）。
  - hover 浮现快捷操作；grid 预留固定操作位或覆盖式浮层，按钮出现不得挤压 title、不得引起行抖动。
  - 运行中状态标记加呼吸动画。
  - 未读从小圆点升级为计数 badge：复用 session 模型已有的 `unreadCount` 字段，cap 99（对齐 `ChatQuickSwitchMenu` 的 `Math.min(99, unreadCount)` 先例）。
  - agent tag chip 化。
  - 时间列右对齐 + tabular-nums，消除右缘抖动（Recent 已有的 `min-width: 22px` 特例与普通列表统一）。
- draft 行（creating / sendingFirstPrompt / failed）与 "Show N old sessions..." 行对齐新行语言。
- 顺手清理：`.wide-session-row` 的 24px / 12.5px 基础规则永不生效（渲染时总带 `data-session-list-density`，仅 relaxed/compact 两档），删除或归并。
- focus-visible 键盘焦点环规范统一不做。

## 架构

纯 Web UI 渲染层迭代，无协议与数据流变更。

- `app/web/src/app/WorkspaceApp.tsx` — 重写 `renderRecentSessionsSection` / `renderRecentProjectSessionSection`（微分隔行 + 去卡片）；删除 `recentSessionsPinned` 及其在 `showPinnedRecentSessionsSurface` 中的门控；普通项目头 `wide-project-actions` 增加 pin 按钮；行 hover 操作与选中 class 调整。
- `app/web/src/chat/ChatRecentSessionsSurface.tsx` — 改为受控折叠（collapse state 由父级注入），删除 unpin UI。
- `app/web/src/chat/mobileChatQuickSwitch.ts` — 不改。section 已携带 `projectHubId`，微分隔行的 hub 标签无需数据层改动。
- `app/web/src/styles/chat.css` — 新增安静卡片、微分隔行、inset 选中、计数 badge、呼吸动画、hover 操作槽位样式；删除 accent 卡片、水印、悬浮 `+`、pin 相关样式；归并密度死代码。

## 流程

状态改动仅两处：pin 状态删除（`recentSessionsPinned` 及其全部消费点）、Recent 折叠状态从 surface 私有提升为共享（`collapsedProjectIds`）。Recent 数据链路（`buildRecentChatSessionProjectSections` → `recentSessionSections`）与 session 行数据（`unreadCount`、`running`、agent、updatedAt）均不变。

## 验收标准

- Recent 恒置顶 sticky 且无 pin 按钮；桌面侧栏折叠时 Recent surface 恒显示。
- 主列表与 surface 的 Recent 折叠状态同步：任一处折叠/展开，另一处一致。
- Recent 内仅在项目切换处渲染微分隔行（同一项目连续 session 不重复）；微分隔行含项目名、hub 标签、`+`；`+` 打开与项目头 `+` 相同的 agent 选择流程。
- 彩色卡片、水印、组外悬浮 `+` 的 DOM 与 CSS 全部移除，无残留类名。
- Recent 与普通项目列表的选中样式（含竖条）逐像素一致；选中高亮不溢出安静卡片边界。
- 普通项目组与 Recent 均为中性安静卡片，无 accent 染色；Recent 内无第二层卡片。
- 项目头出现显式 pin 按钮；pin 后项目移至普通列表顶部并随列表滚动；mobile 长按 pin 仍可用。
- 行 hover 浮现操作时 title 不被挤压、行高不变、无布局抖动。
- 有 `unreadCount > 0` 的 session 显示计数 badge（>99 显示 99）；运行中 session 的状态标记有呼吸动画。
- draft 行与 "Show N old sessions..." 行视觉与精修后的 session 行一致。
- mobile 端与桌面端信息层级、分组语言一致；右键/长按的平台差异保留。
- Recent 为空时整个 Recent section 不渲染（保留现有行为）。

### 测试

- 重构四个现有测试文件中依赖旧结构的断言，从字面 CSS/字符串断言改为结构/行为断言：
  - `app/__tests__/web-chat-recent-sessions-ui.test.ts`
  - `app/__tests__/web-chat-plan-surface.test.tsx`
  - `app/__tests__/web-chat-ui.test.ts`
  - `app/__tests__/web-chat-session-nav-expansion.test.ts`
- 测：collapse 状态共享、pin 重排行为、微分隔行仅在项目切换处出现、badge cap 99、Recent/普通列表选中 class 一致、折叠侧栏 surface 无条件渲染。
- 不测：具体色值、像素级视觉、动画时长。

## 范围之外

- 搜索、归档、session 协议/数据语义、Recent 排序逻辑。
- relaxed 密度的双行信息升级（已明确否决，行模型保持单行）。
- focus-visible 焦点环规范。
- protocol version 任何变更。

## 工作区安全

worktree 中已存在与本迭代无关的用户改动（terminal copy feedback 涉及 `WorkspaceApp.tsx`、`TerminalView.tsx` 及两个 terminal 测试文件），实施时不得丢弃或覆盖。
