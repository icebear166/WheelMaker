> 由 scope skill 于 2026-08-13 生成
> 状态：已批准 2026-08-13

# Skills 管理界面优化

## 目标

把 Hub 菜单中的 Skills 管理区重构为紧凑、可折叠的 Source 清单，让用户无需依赖状态文案即可直接识别刷新 Source、下载未安装 Skill、升级已有 Skill 和卸载的入口，同时修正 Hub 标题中 WheelMaker 完整升级动作被循环刷新图标错误表达的问题。所有现有 Skills 能力、确认流程、状态所有权和服务端协议保持不变。

## 决策基线

### 需求边界

- Hub 标题中的 WheelMaker 完整升级继续执行现有下载、校验、部署和重启流程，但使用明确的下载升级图标；独立重启动作继续使用电源图标。
- 每个 scope 顶部保留 `Show uninstalled`、添加 Source 和升级当前 scope 全部 Sources 三项能力。操作按钮只显示图标；开关继续显示文字标签。
- Source 标题固定为单行，展示展开箭头、状态色点、Source 名称、刷新目录、全部升级和删除。删除保持直接可见并继续走现有确认流程；commit、刷新时间、安装数和更新数不再作为可见的第二行元数据。
- Source 默认展开。点击标题非操作区域切换展开状态；按钮点击不得同时触发展开。展开状态按 Hub、scope、Project 和 Source 在当前页面会话内记忆，应用重新打开后恢复默认展开。
- Source 刷新按钮始终存在；全部升级按钮占用固定槽位，在没有可升级项、Source 尚未获得有效快照或当前操作繁忙时禁用，而不是隐藏或改变行为。错误条不受折叠影响，仍保持可见。
- 每个 Skill 使用名称区和两个固定动作槽：第一槽按状态显示下载、升级或留空，第二槽显示卸载或留空。下载的产品语义是直接安装该 Skill，不提供只下载文件的能力。
- 普通 `Not installed`、`Up to date` 和 `Update available` 不显示行内状态文字；未安装项继续弱化显示。`Copies differ`、`Conflict`、`Removed upstream`、`Error`、`Pending removal` 和 `Unmanaged` 等异常状态继续显示文字与状态色。Source 级 `Needs refresh` 由 header 状态点统一表达，不在每个 Skill 行重复。
- 未安装项继续受每 scope 独立且默认关闭的 `Show uninstalled` 控制。已安装 Skill 名称继续打开详情；unmanaged 区域、加载/空态、批量操作结果、失败重试和所有确认流程必须保留。
- 操作可用性继续完全服从 Hub snapshot 的 `canInstall`、`canUpdate`、`canUninstall` 以及 Source 状态，不在前端推断远端或本机事实。同名冲突及不可操作项仍保持禁用。
- 桌面浮窗与移动端全屏 Hub 页面共享同一布局和行为。图标按钮必须具有 tooltip、可访问名称、键盘焦点和明确的 disabled/pending 表达。
- 不新增后端接口，不修改 Registry protocol version、source lock、Hub snapshot、刷新/安装/升级/卸载语义或批量 best-effort 行为；不顺带重构 NPM、MCP、Projects 等其他 Hub 区域。

### 技术决策

- UI 继续消费现有 `RegistrySkillSourceScopeSnapshot`、Source/Skill capability 字段和 `ChatHubSkillActions`，本次只改变前端呈现及客户端临时展开偏好。
- Source 展开状态使用客户端 `sessionStorage`，key 必须包含稳定的 Hub、scope、Project 和 `sourceKey` identity；存储不可用或内容损坏时安全回退为展开，且不得阻断 Skills 管理。
- 图标沿用现有 Lucide stroke 体系：Skill 下载使用 `cloudDownload`，Skill/Source/scope 升级新增并使用 `circleArrowUp`，Source 目录刷新使用 `refreshCw`，删除/卸载使用 `trash`，展开使用 chevron。WheelMaker 完整升级及其确认对话框统一使用 `cloudDownload`，重启使用 `power`。
- Source 状态色点以现有主题 token 表达 ready、needs refresh、stale 和 pending removal；状态文本进入 tooltip 和无障碍名称。异常错误仍用现有 warning/danger surface，不仅依赖颜色传达信息。
- Source header 使用不换行的固定动作列加可收缩名称列；Skill 行使用 `minmax(0, 1fr) 52px` 的名称/双动作槽结构。长 Source 和 Skill 名称必须省略显示并保留完整 tooltip，不允许在窄屏把操作挤出容器。
- 保留现有 preview/apply、pending-key 和全 Hub 单 operation 所有权。折叠只影响 Source 的 Skill 列表呈现，不改变数据读取、刷新边沿或进行中的任务。

## 设计视图

### 功能设计

Hub 标题把版本号、完整升级、重启和 Hub 展开放在同一行；完整升级以云下载图标与刷新操作区分。进入 Global Skills 或某个 Project Skills 后，顶部工具栏提供显示未安装开关、添加 Source 和 scope 级全部升级图标。

每个 Source 是一个紧凑 ledger。单行 header 从左到右为展开 chevron、状态点、可截断 Source 名称和刷新/全部升级/删除三个固定动作。用户点击 header 的非按钮区域收起或展开 Skill 列表；刷新只重新获取目录，全部升级只处理该 Source 中已安装且需要对齐的 Skills，删除继续预览并确认移除 Source。Source 处于首次待刷新或没有更新时，动作位置不移动，只禁用不适用的全部升级。刷新错误始终显示在 header 下方，即使列表已收起。

展开后的每个 Skill 占一行。名称区域同时承载可用的详情入口和仅异常时出现的状态提示；右侧第一槽在未安装时显示云下载、需要更新时显示向上升级图标，第二槽在允许卸载时显示垃圾桶。正常且已是最新的 Skill 因而只显示卸载；冲突或错误项依据 Hub capability 留空或禁用。所有动作继续先进入已有确认或 preview/apply 流程。

视觉上移除 Source header 的第二行元数据和多余留白，使用状态点、细边框、稳定的 32px Skill 行及两列动作形成清晰的 Git catalog ledger。颜色只强化可操作升级、异常和危险删除，其他结构保持安静并复用 WheelMaker 当前视觉 token。

### 技术设计

#### 整体方案

`ChatHubMenu` 只调整 WheelMaker update glyph；更新状态、回调和确认 target 不变。`ChatHubSkillManagement` 负责新的 Source header、折叠控制、状态点、异常状态过滤和双槽动作矩阵；`skillManagementView` 提供可单测的 session 展开 key 与容错读写 helper。共享 `Icon` 集合增加验证过的 Lucide `circle-arrow-up` geometry，确认对话框同步使用新的 WheelMaker update 图标语义。

CSS 把 Source header 收敛为单行 grid/flex，把 Skill row 固定为名称列加两个 24px 动作槽，并为 status dot、折叠态、异常文字、disabled/pending、hover/focus 和窄屏截断建立明确规则。组件继续复用现有 action callbacks，服务层和 Go 端不发生变化。

#### 关键结构

- Source 展开偏好 key：`hubId + scope + projectName + sourceKey`，仅在 session storage 中保存显式收起项；不存在即视为展开。
- Source header：disclosure、状态点、`sourceKey`、Refresh、Upgrade all、Delete 六个视觉单元，操作按钮阻止 header disclosure 触发。
- Skill action slots：primary 为 Install/Upgrade/empty，secondary 为 Uninstall/empty；pending 时当前 Hub 的 Skills 写操作保持统一禁用。
- 可见状态文案：异常状态保留，普通状态由动作与弱化样式表达；原始状态仍保留在 DOM tooltip/accessible copy 中。

#### 实现流程

1. Hub menu 从既有 update view model 读取完整升级可见性和 pending 状态，只把非 pending glyph 与确认对话框图标替换为 `cloudDownload`。
2. Skill scope 渲染时读取该 scope 的 show-uninstalled 持久偏好，并为每个 Source 从 session preference 得到展开状态；新增或没有记录的 Source 默认展开。
3. Source header 根据 snapshot 状态生成色点和无障碍文案，根据 `busy`、有效快照和 `updateCount`计算固定动作的禁用态；事件继续调用既有 Refresh、Update All 和 Delete callbacks。
4. Source 展开时先按既有规则过滤/排序 Skills，再由每行 capability 和状态选择 primary/secondary 动作。点击名称、下载、升级和卸载继续进入现有详情、preview/apply 或 uninstall 流程。
5. 操作结束后的 HubStore refresh 继续提供新 snapshot；组件只重渲染状态与能力，不自动改变用户的 Source 展开选择。存储异常被 helper 吞并回退，不影响操作。

### 预估改动面

- `app/web/src/app/ChatHubMenu.tsx`、`app/web/src/shell/AppDialogs.tsx`：修正 WheelMaker 完整升级图标。
- `app/web/src/app/ChatHubSkillManagement.tsx`：重构 Source header、折叠和 Skill 动作矩阵。
- `app/web/src/settings/skillManagementView.ts`：增加 session-only Source 展开偏好 helper。
- `app/web/src/common/Icon.tsx`：加入 `circleArrowUp` 图标。
- `app/web/src/styles/chat.css`：实现紧凑 Source ledger、单行 header、状态点和双槽响应式布局。
- 现有 React/源码结构测试及 `skillManagementView` 单元测试：覆盖图标、动作、折叠偏好、异常状态、布局和无障碍约束。
- 已确认更新 `docs/wiki/frontend-interaction/hub-menu.md` 与 `docs/wiki/features/skills-management.md`。
- 不修改 server、Registry 类型、协议和 source lock。

## 验收

- **Hub 完整升级表达** → Hub 标题和确认对话框均使用 `cloudDownload`，重启仍使用 `power`，两个动作继续调用原有 callback；React 测试验证 glyph、pending 与回调。
- **scope 工具栏能力完整** → Global/Project Skills 均保留 show-uninstalled、Add Source 和 scope 级全部升级，操作按钮只显示图标且具有 aria-label/tooltip；组件测试验证渲染和触发。
- **Source 单行 header** → 320px 级窄容器中 Source 名称省略而 chevron、状态点及三个动作不换行、不溢出；CSS 结构测试与响应式构建验证。
- **Source 动作语义** → Refresh 始终占位并调用目录刷新；Upgrade all 固定占位且在无更新、无有效快照或 busy 时禁用；Delete 直接可见并继续确认；组件测试覆盖状态矩阵。
- **折叠记忆** → Source 初次默认展开，点击非操作 header 收起，切换 Global/Project 后返回仍保留当前页面会话选择，新的应用会话恢复展开；helper 与组件测试覆盖 key 隔离、损坏 storage 和事件隔离。
- **错误可见性** → Source 收起时 stale/error 信息仍在 header 下可见，不能因折叠或 show-uninstalled 被隐藏；组件测试验证。
- **Skill 双槽动作** → 未安装显示 Download/空，待升级显示 Upgrade/Uninstall，最新版显示空/Uninstall，Removed/Pending/Conflict/Error 根据现有 capability 显示异常文案和允许动作；组件测试覆盖每种代表状态及 callback。
- **正常状态降噪** → 普通状态不显示行内文案，异常状态仍显示且不只依赖颜色；渲染测试验证可见文本、tooltip 和 accessible copy。
- **兼容行为** → Skill 详情、unmanaged、show-uninstalled 默认值、loading/empty/error/retry、operation results、preview/apply、确认和单 Hub operation 行为无回归；现有 Web 测试与相关新增回归测试全部通过。
- **边界不扩张** → Git diff 不含 server、Registry protocol/type 或 source-lock 行为变更；类型检查、Web 测试和构建通过。
- **长期文档同步** → 两个已确认 wiki 页面分别记录 Hub 完整升级图标与新的 Source/Skill ledger 稳定交互。
