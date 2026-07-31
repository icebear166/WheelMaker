> 摘要：本页维护 Monitor 中 IQ 模型比较功能的 CodexRadar 数据边界、候选选择规则和展示约定。

# IQ 模型比较

IQ 是 Workspace Web 内的只读模型比较功能。它展示 Codex 模型不同 reasoning effort 的 IQ、平均单任务费用 USD 和平均单任务耗时，不关联当前会话模型，也不提供模型切换。

## 数据所有权与刷新

- Workspace Web 前端的单例 store 通过 Registry 请求 `registry.codexRadar.efficiency.get`；Registry 服务端读取 CodexRadar 实时表并聚合为紧凑的 `points` 快照，Hub 和 ACP 不参与。
- Registry 连接建立后请求一次，随后每 10 分钟刷新；用户点击 Monitor 的刷新按钮时也会立即刷新 IQ。无 Registry 连接时不发起外部请求。
- store 仍保留默认的浏览器直连 loader，使用 `https://codexradar.com/data/intelligence-efficiency.json` 和 `cache: no-store`，仅供未注入 Registry loader 的独立调用方使用。
- store 对并发刷新做 singleflight。快照只保存在页面内存，不跨刷新或应用重启持久化；已有数据后的刷新失败保留当前快照并显示错误。
- 桌面 Monitor 和窄屏 Monitor 弹层共享同一个 store 快照，不在组件内分别请求。
- Monitor 不显示 CodexRadar 标题栏图标或独立状态栏；桌面刷新按钮 tooltip 可显示 IQ 数据更新时间。

## 展示范围与指标

- 只展示 Sol、Terra、Luna，顺序固定；GPT-5.5、未知家族、未知 effort 和无效项不显示。
- 数据从 `points` 读取，以 `model + effort` 去重。IQ 使用 `iq`，Cost 使用 `average_price_usd`，Time 使用 `average_minutes` 并显示为整数分钟。
- 功能不读取 session config、不标记当前模型，也不输出跨家族的唯一总推荐。

## Simple 候选

Simple 按 Sol、Terra、Luna 固定为三行。每个家族按 IQ 从高到低选择前三个 effort，每个候选以低饱和家族色的紧凑分区卡片展示模型名、IQ、Cost 和 Time；IQ 四舍五入为整数，候选不足时不增加占位卡片。家族色收敛为单层表达：卡片只保留 `family-color 30%` 发丝边与 3% 底色，家族色主要体现在模型名与 IQ 文字色，不使用 inset 色条；IQ score 保留 display 尺寸（clamp 18–20px、700、-0.02em）。

## Monitor 展示

- 桌面 Chat edge stack 只挂载一张 `Monitor` 卡片，IQ 与 Limits 通过标题栏同一行的 Tab 切换。
- Monitor 默认选择 Limits、默认 Simple；Simple/Detail 是两个 Tab 共用的桌面状态。IQ Detail 按 Sol、Terra、Luna 分组，以 Effort、Score、Cost、Time 表格展示全部有效项，Score 同样四舍五入为整数；家族分组拍平为 hairline 分隔（家族标题 + 表格），表格使用 10px mono，不使用卡片套卡片。
- IQ 加载态使用与内容同形的骨架条（3 组 rail 占位，opacity 呼吸），error 态保留 Retry。
- Monitor 的折叠、隐藏和显示设置作用于整张桌面卡片。旧 Limits 或 Model efficiency 任一显示偏好为 true 时，迁移后的 Monitor 默认显示。
- 窄屏快捷入口始终可用并统一命名为 Monitor。`Limits / IQ` Tab 与 Monitor 标题、刷新和关闭按钮位于同一标题行；弹层默认 Limits，IQ Tab 固定显示 Detail，不提供 Simple/Detail 按钮和底部状态栏。
- Monitor 的共享刷新按钮同时触发 Limits 与 IQ 刷新，两条数据链路仍独立处理成功和失败。

来源：

- [`../../scope/2026-07-22-model-efficiency-card/spec-model-efficiency-card.md`](../../scope/2026-07-22-model-efficiency-card/spec-model-efficiency-card.md)
- [`../../scope/2026-07-22-monitor-card/spec-monitor-card.md`](../../scope/2026-07-22-monitor-card/spec-monitor-card.md)
- [`../../scope/2026-07-24-floating-chrome-visual-upgrade/spec-floating-chrome-visual-upgrade.md`](../../scope/2026-07-24-floating-chrome-visual-upgrade/spec-floating-chrome-visual-upgrade.md)
