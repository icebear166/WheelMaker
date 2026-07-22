> 由 scope skill 于 2026-07-22 生成

# Model efficiency 卡片

## 目标

在 Workspace Chat 中接入 CodexRadar 的公开智力效率摘要，让用户在不离开当前工作区的情况下比较 Codex 模型家族及 reasoning effort 的 IQ、平均单任务费用和平均单任务耗时。桌面端以右侧紧凑卡片承载，窄屏端复用现有 Limits 弹层并增加 Tab；功能保持只读、前端自包含，不依赖当前会话模型、Hub、Registry 或 ACP。

## 决策

- 数据源固定为 `https://codexradar.com/current.json`，界面始终显示更新时间和可点击的“Data from CodexRadar”来源标识。
- 数据由 Workspace Web 前端的单例 store 获取、规范化并在桌面与移动视图之间共享；服务端、Hub 和协议不参与。
- Workspace 启动时自动请求一次。运行期间不定时刷新、不因窗口聚焦刷新，只有用户点击 Model efficiency 的刷新按钮时才再次请求。
- 数据只保存在当前页面内存，不跨刷新或应用重启持久化。首次请求失败时显示错误与重试；已有快照后的手动刷新失败时保留快照并显示刷新错误。
- 仅展示 `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`，顺序固定为 Sol、Terra、Luna；GPT-5.5 和未知家族不显示。
- “消耗”使用 CodexRadar 的平均单任务费用 USD，“时间”使用平均单任务耗时，不展示总测试费用、总墙钟时间或 Token 总量。
- 功能不读取当前会话配置，不标记“使用中”，不点击切换模型，也不输出跨家族的唯一推荐结论。
- 桌面卡片默认显示 Simple，支持折叠、Simple/Detail 切换、手动刷新和隐藏。显示开关独立于 Limits，默认开启，并作为全局偏好持久化到 `Settings > Chat`；折叠状态和 Simple/Detail 状态不持久化。
- 卡片位于 Chat 主区右缘，宽度与 Limits 卡片列一致。Preview 打开时卡片继续显示并跟随剩余 Chat 主区；与 800px 对话列相交时使用现有右侧 edge-surface 渐隐几何，不主动关闭 Preview 或隐藏自身。
- 窄屏继续使用现有 Limits 入口。弹层增加 `Limits` 与 `Model efficiency` 两个 Tab，每次打开默认进入 Limits；切到 Model efficiency 后直接显示 Detail。刷新按钮只刷新当前 Tab 对应的数据。

## 架构

前端新增独立的 Model efficiency 数据模块。单例 store 负责远端请求、运行期快照、刷新去重和错误状态；纯函数负责把 `model_iq.latest` 与 `model_iq.comparisons.*.latest` 合并为以 `model + reasoning_effort` 唯一标识的展示项，并计算 Simple 矩阵的三个角色。桌面 surface 和移动 Detail 只消费 store 快照，不自行发请求。

桌面 surface 复用 Chat edge surface 的标题栏、动作按钮和边缘渐隐能力，但锚定右侧。移动端在现有 Limits dialog 内增加 Tab 容器，Limits 继续复用原内容，Model efficiency 复用与桌面 Detail 相同的分组表格内容。

### 数据规范化

- 根级 `model_iq.latest` 与 `model_iq.comparisons` 中每个 comparison 的 `latest` 都是候选输入。
- 展示项至少需要可识别的 model、reasoning effort 和有限 IQ 分数；费用或耗时缺失时 Detail 对应单元格显示 `—`，该项不参与 Simple 角色计算。
- 重复的 `model + reasoning_effort` 只保留日期较新的项；日期相同或缺失时，根级 latest 优先于 comparison。
- 平均耗时优先读取 `average_task_seconds` 并格式化为分钟；费用读取 `average_cost_usd`。
- 未识别字段、未知家族、GPT-5.5 和无效数值不会让整个快照失败。

### Simple 矩阵

Simple 是三行三列的紧凑矩阵：行依次为 Sol、Terra、Luna，列依次为 Quality、Balanced、Economy。每个非空单元格代表一个唯一的 `model + effort`，显示 effort、IQ、平均费用和平均耗时；三列视觉同权，不单独强调 Balanced。

同一家族只使用同时具备有限 IQ、正数平均费用和正数平均耗时的项。先计算综合成本：

`combinedCost = averageCostUsd × (averageMinutes / 10) ^ (log(2.5) / log(1.35))`

三个角色按以下顺序选择且不得重复：

1. **Quality**：IQ 最高；并列时取综合成本较低者。
2. **Economy**：尚未使用的项中综合成本最低；并列时取 IQ 较高者。
3. **Balanced**：在尚未使用项的 IQ/综合成本 Pareto 前沿中选择最接近“高 IQ、低综合成本”理想点的项。距离计算在同一家族全部完整项上对 IQ 和 `log(combinedCost)` 分别做 min-max 归一化后使用等权欧氏距离；并列时依次取 IQ 较高、综合成本较低、effort 较强者。

界面列顺序仍为 Quality、Balanced、Economy。某个角色没有可用且未重复的项时显示 `—`，不重复已有 effort，也不使用非 Pareto 项补位。

### Detail 表格

Detail 按 Sol、Terra、Luna 分组。每个 `model + effort` 一行，列为 Effort、IQ、Cost、Time；effort 按 `ultra → max → xhigh → high → medium → low` 排列，接口未提供的档位不生成占位行。Detail 不显示散点图、历史趋势、社区评分或额外测试指标。

## 流程

1. Workspace 创建前端 store 并订阅快照，store 发起本次页面生命周期内的首次请求。
2. store 校验响应并规范化 Model efficiency 数据；成功后原子替换内存快照，桌面与移动视图同步更新。
3. 用户在桌面切换 Simple/Detail、折叠或隐藏卡片，这些操作不触发网络请求；隐藏偏好可从 Settings > Chat 恢复。
4. 用户在桌面卡片或移动 Model efficiency Tab 点击刷新，store 合并并发请求。成功时替换快照；失败时保留已有快照并暴露可见错误。
5. 页面刷新或应用重启后内存快照丢弃，新页面生命周期重新执行一次首次请求。

## 验收标准

- 桌面 Chat 右侧默认出现 Model efficiency 卡片，Simple 矩阵能在与 Limits 相同的宽度内展示三家族与三角色，且每个非空单元格包含 effort、IQ、USD 费用和耗时。
- Simple 的 Quality、Balanced、Economy 选择可由确定性纯函数复现；同一家族三个单元格不重复 effort，候选不足时显示 `—`。
- Detail 只展示 Sol、Terra、Luna 的完整分组表格，排序稳定，GPT-5.5 不出现在 Simple、Detail 或移动端。
- 桌面卡片支持折叠、Simple/Detail、刷新和隐藏；独立设置开关能恢复隐藏卡片，且不改变 Limits 的显示状态。
- Preview 与卡片可同时打开；卡片保持在剩余 Chat 主区右缘，交叠区域使用右侧渐隐，不遮断卡片自身操作。
- 窄屏 Limits 弹层包含两个 Tab，每次打开默认选中 Limits；Model efficiency Tab 直接展示 Detail，并将刷新动作路由到 Model efficiency store。
- 首次加载、首次失败、刷新中、已有数据后的刷新失败和空数据都有明确的内联状态；刷新失败不清空已有快照。
- 每个页面生命周期只自动请求一次，不存在定时器、focus 自动刷新或 Model efficiency 数据持久化；并发手动刷新合并为一个请求。
- 桌面与移动视图使用同一 store 快照，不产生组件级重复请求。
- 界面始终显示数据更新时间和 CodexRadar 来源链接，键盘焦点、按钮标签和 Tab 语义可访问。

### 测试

- 纯函数测试覆盖根级 latest 与 comparisons 合并、去重、家族过滤、缺失字段、格式化、角色选择、Pareto 判定、归一化退化区间、稳定 tie-break 和候选不足。
- store 测试覆盖启动请求一次、手动刷新、并发去重、首次失败以及刷新失败保留快照；使用注入的 fetch，不访问真实网络。
- 组件测试覆盖 Simple 矩阵、Detail 分组与排序、桌面模式切换/隐藏、设置恢复、移动 Tab 默认值与刷新路由。
- 运行现有 Web 测试、TypeScript 检查和生产构建；不以真实 CodexRadar 可用性作为测试通过条件。

## 范围之外

- 不接入 CodexRadar 授权 API、完整任务数据、历史趋势、社区体感分或 Fast 雷达。
- 不新增 Go 服务端、HubState、Registry 或 ACP 字段，不修改 protocol version。
- 不关联当前会话模型，不提供模型切换、自动推荐应用或 session 配置写入。
- 不加入后台刷新、定时刷新、focus 刷新、服务端缓存或跨重启数据缓存。
- 不展示 GPT-5.5，也不为未知未来家族自动生成界面行。
