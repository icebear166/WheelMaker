> 摘要：本页维护 Model efficiency 的 CodexRadar 数据边界、候选选择规则以及桌面和窄屏展示约定。

# Model efficiency

Model efficiency 是 Workspace Web 内的只读模型比较功能。它展示 Codex 模型不同 reasoning effort 的 IQ、平均单任务费用 USD 和平均单任务耗时，不关联当前会话模型，也不提供模型切换。

## 数据所有权与刷新

- Workspace Web 前端的单例 store 直接读取 `https://codexradar.com/current.json`，Hub、Registry 和 ACP 不参与。
- 每个页面生命周期启动时请求一次；运行期间只有用户手动刷新才再次请求，不存在定时或 focus 刷新。
- 快照只保存在页面内存，不跨刷新或应用重启持久化。已有数据后的刷新失败保留当前快照并显示错误。
- 桌面卡片和窄屏弹层共享同一个 store 快照，不在组件内分别请求。
- 界面始终展示数据更新时间和可点击的 CodexRadar 来源标识。

## 展示范围与指标

- 只展示 Sol、Terra、Luna，顺序固定；GPT-5.5、未知家族和无效项不显示。
- IQ 来自公开摘要的 score，Cost 使用平均单任务费用 USD，Time 使用平均单任务耗时。
- 根级 `model_iq.latest` 与 `model_iq.comparisons.*.latest` 合并后按 `model + reasoning_effort` 去重。
- 功能不读取 session config、不标记当前模型，也不输出跨家族的唯一总推荐。

## Simple 候选矩阵

桌面 Simple 是 Sol、Terra、Luna 三行与 Quality、Balanced、Economy 三列组成的紧凑矩阵。每个非空单元格展示一个唯一 effort 的 IQ、Cost 和 Time，三列视觉同权。

同一家族先按以下公式计算综合成本：

`combinedCost = averageCostUsd × (averageMinutes / 10) ^ (log(2.5) / log(1.35))`

- **Quality** 选择 IQ 最高的完整项。
- **Economy** 选择尚未使用项中综合成本最低者。
- **Balanced** 从尚未使用项的 IQ/综合成本 Pareto 前沿中，选择归一化后最接近高 IQ、低综合成本理想点者。
- 三个角色不重复 effort；候选不足时显示 `—`，不以非 Pareto 项补位。

## 桌面与窄屏展示

- 桌面 Chat 主区右缘常驻独立卡片，默认 Simple，支持折叠、Detail、手动刷新和隐藏；显示偏好独立于 Limits，并可从 `Settings > Chat` 恢复。
- Detail 按 Sol、Terra、Luna 分组，以 Effort、IQ、Cost、Time 表格展示全部有效项，不展示图表或历史趋势。
- Preview 打开时右侧卡片继续位于剩余 Chat 主区；与对话列相交处使用右侧 edge-surface 渐隐。
- 窄屏从现有 Limits 入口进入双 Tab 弹层；每次打开默认选择 Limits，切到 Model efficiency 后直接显示 Detail。
- 弹层刷新按钮只刷新当前 Tab 的数据源。

来源：

- [`../../scope/2026-07-22-model-efficiency-card/spec-model-efficiency-card.md`](../../scope/2026-07-22-model-efficiency-card/spec-model-efficiency-card.md)
