> 由 scope skill 于 2026-08-12 生成
> 状态：已批准 2026-08-12

# 跨 Session Lazy 搜索迭代

## 目标

将 Sessions 侧栏中的跨 Session 搜索收敛为轻量的会话筛选器：显式提交后尽快逐个返回命中的会话，结果完全沿用既有 Project 与 Session 列表表现；用户选择会话后，再由现有会话内搜索完成正文定位，从而减少无意义的命中元数据、避免为低频搜索引入持久索引，并改善多 Project、大量 Session 下的首批结果速度。

## 决策基线

### 需求边界

- 不建设 Global Center；跨 Session 搜索继续位于现有 Sessions 侧栏，并保留既有标题栏入口与 `Ctrl/Cmd+Shift+F` 直达入口。当前会话搜索只新增跨 Session 点击后的程序化交接入口，其匹配、计数、高亮和导航语义不改；Preview 搜索、Quick File 和文件抽屉搜索不纳入本次改造。
- 搜索仅由搜索按钮点击或输入框 Enter 显式提交；输入关键词或切换 Project 筛选不会自动请求，Enter 不再承担跨 Session 结果导航。提交非空搜索时立即清空上轮结果并取消旧任务；输入为空时不启动任务。
- 搜索范围默认是 `All Projects`，可单选一个 Project；`All Projects` 仅包含当前可见 Project，隐藏 Project 不出现在筛选项或结果中。只搜索活跃 Session，Archived Session 继续通过 Recover 流程访问。
- 搜索内容为 Session 标题、用户消息和 Assistant 可见回复正文；Thinking、Tool Call、Plan、系统与状态消息均不参与匹配。匹配保持现有的大小写不敏感字符串包含语义，不新增模糊、正则、全词或大小写选项。
- 每个 Session 只表达“命中”或“不命中”。发现第一处匹配后即可返回该 Session；不统计或展示单 Session 命中数、总命中数、命中来源、Prompt、Turn、snippet 或标题高亮。
- 搜索结果完全复用正常列表的 Project 分组、Project 展开/收起、Session Row、Agent 标签、时间、运行状态、选中态与既有排序。搜索只过滤 Session，不按命中速度或数量重排，也不展示 Recent 重复分组、Draft、隐藏 Project、旧会话折叠门槛或管理辅助行。
- 搜索态只保留 Project 展开/收起与 Session 行点击。Project 的新建、恢复、固定和上下文菜单，以及 Session 的取消固定、右键/长按管理菜单等变更入口全部隐藏。
- 点击任意搜索结果后，跨 Session 搜索与结果列表保持打开；目标 Session 加载完成后，统一使用该次已提交关键词打开现有会话内搜索。跨 Session 层不根据标题或正文来源分流；若只命中标题，会话内搜索允许自然显示 `0` 个正文结果。
- 搜索进行时，命中的 Session 逐步加入过滤列表；完成后无结果时显示空状态。部分 Project 或部分 Session 扫描失败时保留已经返回的结果，并显示简短的部分失败提示；再次显式提交会重试所选完整范围。
- 本 spec 替换 `docs/scope/2026-08-10-global-search-ux-iteration.md` 中仅涉及全局会话搜索的自动 debounce、Enter 结果导航、专用结果行、命中元数据、结果计数以及直接跳转命中 Turn 的约定；该旧 spec 中当前会话、Preview、快捷键路由和 Search HUD 的其他约定继续有效。

### 技术决策

- 沿用现有 per-Project `session.search` start/query/cancel 任务模型：显式提交时仅为选中范围内的 Project 启动任务；All Projects 由前端并行调度，各 Project 的轮询只读取服务端任务内存中的累计结果，不重复扫描 Turn 文件。
- 服务端对单个 Project 的 Session 快照使用固定上限的受控并发；每个 Session 从标题开始并按现有 Turn 存储能力扫描，一旦首次命中立即短路。每次显式提交执行一次完整范围扫描，不建设持久索引、数据库迁移或跨搜索结果缓存。
- 搜索任务以 searchId 隔离。新提交、关闭搜索或组件清理必须取消旧任务；旧任务的完成、结果和错误不得写入新任务状态。并发结果在服务端去重，前端按现有 Project 与 Session 索引映射回规范顺序，而不是采用返回顺序。
- 跨 Session UI 的结果语义只依赖 `projectId + sessionId`。为兼容既有 Registry 版本，不提升 protocol version，不移除现有响应字段；`source` 与 `turnIndex` 可继续作为兼容字段传输，但新 UI 不读取它们来渲染或决定点击行为。
- 搜索内容提取与前端会话内搜索共享同一语义边界：仅用户 Prompt / user message 与 Agent 可见回复可搜索；服务端不再通过 generic fallback 纳入 thought、plan、system、status、done 或其他协议字段。
- 搜索模式必须走 `SessionListView`、`ProjectSection` 与 `SessionRow` 的共享渲染路径，通过显式的只读搜索模式屏蔽动作；不得继续维护独立的 `renderSessionSearchRow` 或仿制 Project header。筛选结果集合与已提交 query/scope 绑定，输入草稿不改变正在展示的已提交结果，直到下一次提交清空。
- 点击结果建立一次性、本地的搜索交接状态，至少绑定目标 Project、Session 和已提交关键词。目标 Session 的消息加载完成且仍是当前目标时，交接状态调用现有 chat search controller 打开搜索并设置 query；切换目标、重复点击、加载失败或任务被替代时必须清理过期交接，避免在错误 Session 打开搜索。
- Project 级启动/查询失败与 Session 读取错误统一汇总为部分失败状态，不阻断其他并发分支，也不清空成功结果。全部分支结束后停止轮询；轮询间隔可以沿用现有快慢退避策略。

## 设计视图

### 功能设计

Sessions 搜索入口展开后，用户在现有搜索控件中输入关键词，并通过单选筛选器选择 All Projects 或一个可见 Project。编辑仅形成草稿；点击搜索按钮或按 Enter 后，当前结果立即清空，界面进入搜索态。匹配到的 Project 和 Session 使用正常列表组件逐步出现，列表始终按正常 Project/Session 顺序组织，不添加搜索专属元数据或操作。

搜索态本质上是正常 Session 列表的只读过滤视图。Project 仍可展开和收起，Session 仍可被选中；所有会产生数据变更或打开管理流程的入口不渲染。无结果、搜索进行中和部分失败只提供完成操作所必需的状态，不以 Prompt、Turn、命中数量或来源占用列表信息层级。

选择结果后，侧栏保留原搜索。Workspace 先完成正常的跨 Project Session 选择与消息加载，再将已提交关键词交给当前会话 Search HUD；后续的命中数量、高亮、首个结果滚动及前后导航全部由既有会话内搜索负责。标题独立命中不会产生特殊分支，因此正文为零结果时也保持统一体验。

### 技术设计

#### 整体方案

前端分别维护搜索输入草稿、已提交 query、已提交 Project scope、searchId、per-Project 累计结果/完成/错误和待交接的本地搜索目标。提交控制器冻结 query 与 scope，取消旧 searchId，清空展示结果，并为范围内 Project 并行调用既有 Registry service。轮询增量合并 Session identity；共享 Session 列表根据 identity 集合过滤现有 Session 数据，因此异步返回不会改变最终排序。

Hub 的每个 Project 搜索任务持有提交时的活跃 Session 快照、取消上下文、累计命中集合和错误集合。固定大小的 worker pool 并行消费 Session；每个 worker 先判断标题，再按新到旧读取该 Session 的 Turn chunk，使用受限的可见文本提取器判断正文，首次命中后将 identity 原子加入任务结果并停止读取该 Session。query 请求只复制任务内存快照，不重新读取 Session 数据。

Session 点击仍使用现有选择/加载链路，但不再携带跨 Session `turnIndex`。前端记录待交接目标，在目标消息成为当前 Session 数据后调用扩展后的 chat search controller 以关键词打开本地 HUD；controller 继续负责匹配计数、DOM/虚拟列表高亮与导航。目标身份校验和一次性消费保证慢请求不会污染后来选择的 Session。

#### 关键结构

- 搜索提交快照：`searchId + query + scope`，只在显式提交时变化。
- 跨 Session 结果：按 Project 保存的 Session identity 集合、完成状态与错误状态；返回字段中的 source/turnIndex 不参与新 UI 逻辑。
- 搜索列表模式：正常列表数据与共享组件加只读能力开关；过滤掉非命中 Session 及所有搜索态不适用行。
- 本地交接：`targetProjectId + targetSessionId + query + generation`，由目标 Session 成功加载后一次性消费。

#### 实现流程

1. 用户打开 Sessions 搜索，默认 scope 为 All Projects；输入与 scope 变化只更新草稿。
2. 用户点击搜索或按 Enter。控制器拒绝空 query，取消旧 searchId，清空旧结果，冻结 query/scope，并为所选可见 Project 并行 start。
3. 每个 Hub 任务以受控 worker pool 扫描活跃 Session。任一 Session 首次命中即写入累计结果；前端轮询取得增量 identity 后，通过共享 Session 列表按正常顺序呈现。
4. 新提交、关闭搜索或卸载会取消旧任务并停止轮询；部分分支失败只更新聚合错误状态。所有 Project 完成后停止轮询，保留已返回结果或显示无结果状态。
5. 用户点击命中 Session。Workspace 保持跨 Session 搜索态，执行正常 Session 选择与加载；目标数据就绪且 generation 仍有效时，以已提交 query 打开当前会话 Search HUD。会话内搜索自行计算正文 matches，可能得到零结果。

### 预估改动面

- `app/web/src/app/WorkspaceApp.tsx` 与 chat search controller：显式提交、Project scope、任务取消/轮询、共享列表过滤、本地搜索交接以及紧凑状态接线。
- `app/web/src/chat/session/`、`app/web/src/chat/sessionlist/`：将 search mode 纳入正常 `ProjectSection` / `SessionRow` 渲染路径，提供只读动作边界并删除搜索专属元数据与高亮 helper。
- `app/web/src/registry/`：保持现有 Registry 版本兼容，收窄新 UI 的结果依赖并按需调整兼容归一化。
- `server/internal/hub/client/session_search.go`：受控 Session 并发、结果去重、取消、严格可搜索内容提取和首次命中短路。
- `app/__tests__/` 与 `server/internal/hub/client/*_test.go`：覆盖显式提交、筛选、共享 UI、交接、异步隔离、部分失败、内容边界、并发与短路。
- wiki 目标：更新 `docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md` 与 `docs/wiki/architecture/session-management-and-sync.md`。

## 验收

- 输入关键词或切换 Project scope 时不发送搜索请求；搜索按钮和 Enter 使用相同的非空提交路径，提交时清空旧结果并取消旧任务。验证：前端状态/交互测试与请求 mock 断言。
- 默认 All Projects 只启动当前可见 Project 的搜索；单选 Project 时只启动目标 Project；隐藏和 Archived Session 不出现在结果中。验证：范围纯函数测试、service mock 与多 Project 手动检查。
- 服务端仅匹配标题、用户消息和 Assistant 可见回复，明确忽略 Thinking、Tool Call、Plan、system/status/done 与 generic 协议字段；大小写不敏感包含匹配保持不变。验证：Go 内容边界表驱动测试。
- 单个 Session 首次命中后不再继续读取剩余 Turn；同一 Session 最多返回一次。Project 内并发受固定上限约束，取消能停止待处理与正在扫描的工作。验证：可观测 fake turn store/worker 测试与 race test。
- 搜索进行时，轮询不重新读取 Turn 文件；新命中逐步出现且列表始终保持正常 Project 分组和 Session 排序。验证：服务端累计结果测试、前端乱序增量测试与手动检查。
- 搜索结果由正常 `ProjectSection` 和 `SessionRow` 渲染，不显示总数、`N matches`、source、Prompt、Turn、snippet 或标题高亮；Project 展开/收起和 Session 选择可用，所有管理与变更入口不可见且不可通过右键/长按触发。验证：组件测试、可访问性查询与桌面/移动端手动检查。
- 点击任意结果后跨 Session 搜索保持打开；目标 Session 加载完成后自动打开现有会话内搜索并使用已提交 query。正文命中时沿用本地高亮与导航，仅标题命中时显示本地零结果；慢加载不得在后来选择的 Session 中错误启动搜索。验证：异步交接集成测试与手动检查。
- 部分 Project 或 Session 扫描失败时保留成功结果并显示简短部分失败状态；再次提交重试完整选中范围。全部完成且无匹配时显示无结果状态。验证：混合成功/失败 mock 测试。
- 不修改 Registry protocol version，不破坏旧 `session.search` start/query/cancel 响应兼容性；当前会话、Preview、Quick File、文件抽屉、Archived Recover 与搜索快捷键入口无回归。验证：Registry service 测试、现有相关测试、`go test ./...`、`npm test`、`npm run tsc:web` 和 `npm run build:web`。
