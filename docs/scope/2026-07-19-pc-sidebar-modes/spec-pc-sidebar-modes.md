# PC 侧边栏模式迭代

> 由 scope skill 于 2026-07-19 生成

## 目标

PC 端（宽屏 ≥900px）当前默认进入固定侧边栏（pin）模式，会话导航常驻左侧，recent/plan 等浮动面板只在手动收起侧边栏后出现。本次迭代把**浮动态变为默认模式**：recent + plan 等面板浮动在聊天区左缘，需要完整会话导航时从 recent 面板原位滑出；pin 仍作为可选的固定模式。同时统一标题栏信息架构（顶部标题栏只留设置与 hubs，搜索/archive 下移进 recent 标题栏），并修复 800px 对话列在窗口缩放时的横向对齐（当前存在跳变，要求改为连续移动）。移动端（<900px）本次完全不动，后续再统一。

## 决策

- **Q: pin 模式的含义？** A: pin 态 = 现有固定侧边栏行为，零改动；plan 面板仍在会话列表右侧的现有位置，不搬到右侧。
- **Q: 默认态与持久化？** A: 浮动态成为新默认值（`sidebarCollapsed` 默认值改为 true）；pin 状态持久化，用户手动 pin 后跨会话记住。
- **Q: 滑出列表内容形态？** A: 复用 pin 态的完整会话导航（项目分组 + older folding + archive 入口），即把 `renderWideProjectSessionNav` 搬进滑出层；不是平铺列表。
- **Q: 滑出层位置与标题栏？** A: 从 recent 面板原位滑出，与 recent 共用标题栏，标题栏在滑出层内 sticky 置顶；宽度 ≈360px，正好覆盖左侧浮动列区域；层叠在 plan/用量面板与文字区之上。
- **Q: 自动滑回的抑制条件？** A: 搜索框聚焦、上下文菜单打开、拖拽滚动条期间，鼠标移出不滑回；交互结束后再次移出才滑回。
- **Q: 滑出层打开时滚动位置？** A: 恢复上次滑出时的 scrollTop（不自动定位到活跃 session）。
- **Q: recent 标题栏按钮配置？** A: 未滑出态左侧 `[全部session] [pin]`；滑出态右侧增加 `[搜索] [archive]`（搜索/archive 复用现有 sessionSearch/sessionArchive 逻辑，结果替换列表内容）。
- **Q: 顶部标题栏改法？** A: 只保留设置按钮 + hubs 下拉，搜索/archive 下移出顶部标题栏；顶部标题栏在 pin/浮动两态都常驻；浮动态下它是浮动元素，浮在聊天区左上角、recent 面板上方，不占布局宽度，聊天区通栏。
- **Q: 「全局会话标题栏」（recent 标题栏迭代后的组件）落位范围？** A: 本期 PC 三处中的两处生效：浮动态 recent 面板、pin 态侧边栏 recent 区（替换现有 recent section header，pin 态顶部标题栏同样只剩设置+hubs）；移动端 sheet 本期不改，组件设计需可被移动端后续直接复用。
- **Q: 全局会话标题栏按钮矩阵？** A: 浮动态 recent 面板：`[全部session/收起] [pin]` 居左，滑出后 `[搜索] [archive]` 居右；pin 态侧边栏 recent 区：`[pin] [搜索] [archive]`（无「全部session」）；移动端：本期不变（后续统一时 `[搜索] [archive]`）。
- **Q: 800px 对齐收缩顺序？** A: 文字列恒 800px 不缩窄；空间不足时优先收缩右侧 gutter，左 margin 保持悬浮列预留区 R；右 gutter 到底后继续缩小窗口则左 margin 侵入 R，文字列以现有 fade mask 遮挡悬浮列。
- **Q: 800px 对齐适用范围？** A: pin 态与浮动态共用同一公式；浮动态时 pin 侧边栏宽度按 0 计。
- **Q: 移动端？** A: 本期完全不动，后续再统一复用两条标题栏组件。

## 架构

涉及单元（均在 `app/web/src`）：

- **顶部标题栏**（改造 `renderChatSessionHeader`，WorkspaceApp.tsx:17066）：瘦身为设置按钮 + hubs 下拉；PC 两态常驻，浮动态作为浮动元素渲染在聊天区左上角（脱离 `workspace-left` aside 的布局流）。
- **全局会话标题栏**（新组件，建议落在 `app/web/src/chat/`）：recent 标题栏的迭代形态，承载 `[全部session] [pin] [搜索] [archive]` 按钮矩阵；用于浮动态 recent 面板与 pin 态侧边栏 recent 区。组件接口需与端无关（props 传入按钮可见性与回调），为移动端后续复用预留。
- **滑出会话导航层**（新）：浮动态 recent 面板的展开态，内容复用 `renderWideProjectSessionNav`（WorkspaceApp.tsx:17482），宽 ≈360px，覆盖 `.chat-edge-surface-stack` 区域并层叠于文字区之上；管理 hover 滑出/滑回、抑制条件、scrollTop 记忆。
- **浮动面板列**（现有 `.chat-edge-surface-stack`，chat.css:2757+）：浮动态下顶部标题栏加入该浮动列顶部；滑出层展开时盖住列内其余面板。
- **800px 对齐**（改造现有居中逻辑，chat.css:2461-2471、4135-4162 及 `chatEdgeSurfaceGeometry.ts`）：改为统一连续公式，见流程节。
- **状态**（`shell/state/workspaceUiState.ts`）：`sidebarCollapsed` 默认值改为 true；新增滑出层 UI 状态（展开与否、scrollTop 记忆可不持久化）。

## 流程

**模式切换**：浮动态点 pin → `sidebarCollapsed=false`，渲染现有固定侧边栏（recent 区标题栏替换为全局会话标题栏）；pin 态点取消 pin → 回到浮动态。

**滑出层**：点「全部session」→ 滑出层展开（恢复上次 scrollTop）→ 鼠标移出且无抑制条件 → 自动滑回（记录 scrollTop）。抑制条件：搜索框聚焦 / 菜单打开 / 拖拽滚动条。

**800px 对齐（连续，无跳变）**：
- W = 窗口宽 − preview 宽 − pin 侧边栏宽（浮动态 = 0）；R = 悬浮列预留宽（≈360px + edge-gap）。
- 左 margin 按 W 连续分段：
  1. **居中段**：W 富余时，左 margin = (W − 800) / 2，文字列居中；
  2. **左贴段**：居中会导致侵入 R 时，左 margin = R，右 gutter = W − 800 − R 继续收缩；
  3. **遮挡段**：右 gutter 到最小值（edge-gap）后，左 margin 随 W 继续减小侵入 R，文字列经 fade mask 遮挡悬浮列。
- 三段在边界处衔接连续，窗口缩放过程中 800px 列位置连续移动、无跳变。

## 验收标准

- 新用户（或重置持久化后）默认进入浮动态；手动 pin 后重启仍为 pin 态。
- 浮动态可见：顶部标题栏（设置+hubs，浮动、不占布局）、recent 面板（全局会话标题栏 + 列表）、plan/用量面板。
- 点「全部session」滑出完整会话导航（项目分组 + older folding），宽 ≈360px 覆盖浮动列并层叠文字区；标题栏 sticky；再次打开恢复上次 scrollTop。
- 鼠标移出自动滑回；搜索聚焦 / 菜单打开 / 拖滚动条期间不移回。
- 滑出态标题栏右侧出现搜索、archive，功能与现有搜索/archive 一致（结果替换列表）。
- pin 态：侧边栏固定，顶部标题栏只剩设置+hubs，recent 区标题栏为全局会话标题栏（`[pin] [搜索] [archive]`），plan 位置与现状一致。
- 800px 模式：窗口从宽到窄连续缩放时，文字列位置连续变化（居中 → 左贴 → fade 遮挡），无跳变；文字列始终 800px；pin/浮动态公式一致。
- 移动端（<900px）行为与 UI 完全不变。

### 测试

- 以组件/状态级测试为主：`workspaceUiState` 默认值变更；滑出层状态机（展开/滑回/抑制/scrollTop）；800px 左 margin 分段函数的纯计算测试（居中段/左贴段/遮挡段边界与连续性）。
- 不测：移动端 UI、视觉像素级回归。
- 测试切入点：分段计算抽为纯函数后单测；滑出层状态逻辑抽为 hooks/纯状态机单测。

## 范围之外

- 移动端任何改动（含 session sheet、标题栏复用），后续单独迭代统一。
- 搜索/archive 功能本身的新增能力（仅改变入口位置）。
- preview 面板宽度逻辑、plan 面板内容。
- 非 800px（full 宽度）模式的对齐行为调整。
