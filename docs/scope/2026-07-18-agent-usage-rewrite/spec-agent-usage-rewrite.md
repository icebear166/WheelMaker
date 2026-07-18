# Agent Usage Rewrite

> 由 scope skill 于 2026-07-18 生成

## 目标

现有 Agent 用量功能由每个前端客户端定时触发所有 Hub 扫描，再通过专用 `tokenStats.update` 事件增量拼装结果。这导致重复扫描、乱序和陈旧数据，也会因 Windows 下启动可见的 `codex app-server` 子进程而周期性闪出控制台窗口。本次先彻底移除这套实现及旧 TokenStats/DeepSeek secret 遗留，不恢复旧设置页；随后以 Hub 为唯一数据所有者重新实现 Codex、Kimi、ZAI、DeepSeek 用量扫描、缓存、刷新和桌面端展示。

## 决策

- 支持 Codex、Kimi、ZAI、DeepSeek；不支持 Copilot。
- Kimi、ZAI、DeepSeek 凭据只从 OpenCode auth 读取；Codex 使用 Codex 自身凭据。现有提交中的接口和解析方式仅作为取数参考，扫描模型和代码重新实现。
- Hub 启动后立即扫描一次，之后在每次扫描结束 10 分钟后再次扫描。
- 自动扫描只由 Hub 发起。前端没有轮询定时器，也不因打开页面或客户端数量增加而增加扫描次数。
- 手动刷新从桌面端功能显示区发起，一次请求所有在线 Hub。每个 Hub 同一时刻最多有一个扫描任务；重复请求复用正在执行的任务。
- 移除 Usage 专用的 Registry 转发代码和 `tokenStats.update`。用量作为 HubState 的 `tokenStats` section，通过通用 `hub.state.get`、`hub.state.refresh` 和 `hub.state.updated` 读取及同步；Registry 不包含 Provider 业务逻辑，也不读取或注入 Provider 密钥。
- 不修改 Registry protocol version。`hub.state.updated` 只做现有 HubState 语义内的补全，不新增 Usage 专用协议方法。
- 全链路不发送 API key、access token 或密钥片段。账号合并只使用 Provider 返回的稳定账号身份；拿不到稳定身份时，不跨 Hub 合并。
- Windows 下所有扫描辅助进程必须经过统一的后台命令配置，包含 `HideWindow`，自动扫描和手动刷新都不能出现控制台窗口。
- 旧 Token Stats 设置详情页及其快捷入口继续保持删除；Limits 监控不重新进入设置菜单。
- 旧入口删除后，设置快捷栏必须按实际的“设置 + Update + Skills + Port Relay”四项重新布局为 4 等分，并同步调整活动指示条和索引测试，不能保留最右侧空白列。
- 删除设置按钮旁的 Usage 入口。移动端本次不提供 Usage 入口。
- 桌面端在聊天文字区左侧浮层列增加通用“功能显示区”。它与 `Plan` 使用相同的水平几何和文字重叠渐隐规则，垂直锚定在输入框上方；侧栏展开或收起时位置逻辑不变。
- 功能显示区不是 `Plan` 的紧邻子项：`Plan` 位于浮层列上部，功能显示区位于同列下部，中间空间留给对话内容。
- 功能显示区标题栏支持折叠，右侧依次提供详情模式和刷新操作。
- 紧凑模式每个 Agent/Provider 一行。多账号时显示最紧张账号的额度及账号数量；DeepSeek 显示余额。
- 详情模式保持原底部锚点并向上扩展，显示全部账号、所属 Hub、各额度窗口、重置时间、余额、刷新状态和错误；再次切换可返回紧凑模式。
- 项目 Wiki 新增 `features/` 顶层目录，用于记录跨任务仍长期有效的产品功能知识；本功能以 `Limits 监控` 页面记录，并加入 Wiki 根索引和功能目录索引。

## 架构

Hub 内新增单一职责的 Usage 服务，负责凭据发现、Provider 扫描、定时调度、singleflight、不可变快照和 HubState 发布。各 Provider scanner 只负责将外部响应转换成统一的强类型模型，不负责调度或网络推送。Reporter 将 Usage 快照写入 `tokenStats` HubState section，并通过通用 `hub.state.updated` 通知 Registry；Registry 只验证已认证 Hub、按 Hub scope 转发通用事件。Web 从 HubState 初始化并消费完整快照，不再拼装 Provider 增量事件。

```text
Hub timer/manual refresh
        |
        v
Usage service -- singleflight --> Provider scanners
        |                              |
        +------ immutable snapshot <---+
        |
        v
HubState tokenStats --> hub.state.updated --> Registry --> Web store --> function display area
```

统一快照至少表达：

- Hub 扫描状态：`idle | scanning | ready | error`、扫描标识、开始时间、完成时间和顶层错误。
- Provider 状态：`ok | unavailable | error`。未配置凭据必须显式表示为 `unavailable`，不能通过缺少事件暗示。
- Account：稳定账号身份、展示名称、所属 Hub、状态、错误、额度窗口和可选余额。
- Limit：稳定 ID、标签、已用/剩余百分比和 UTC reset timestamp。服务端不得先格式化成缺少年份或时区的字符串。
- Balance：可用状态及各币种 total/granted/topped-up。

## 流程

### 自动扫描

1. Hub Usage 服务启动，异步触发首次扫描。
2. 服务发布 `scanning` 快照，同时保留上一份成功数据供前端标记为旧数据。
3. Provider 扫描并行执行；同一 Provider 内的账号也可并行，但必须保证每个 Codex profile 查询的是对应账号，不能用默认账号结果冒充其他 profile。
4. 所有 Provider 完成或超时后，服务一次性提交完整快照。
5. HubState 更新 `tokenStats` section，并发送通用 `hub.state.updated`。
6. 从本轮完成时间开始等待 10 分钟，再触发下一轮。

### 前端初始化与更新

1. Registry 连接完成后，Web 对在线 Hub 读取 `tokenStats` HubState 缓存。
2. Web 订阅 `hub.state.updated`，按 Hub 原子替换完整快照。
3. Hub 下线时移除其贡献；账号或凭据从新快照消失时同步删除旧数据。
4. 跨 Hub 聚合使用 `provider + stable account identity`。没有稳定身份的账号保持 Hub 隔离。

### 手动刷新

1. 用户点击功能显示区标题栏的刷新按钮。
2. Web 向所有在线 Hub 发送 `hub.state.refresh(tokenStats)`。
3. Hub 没有扫描任务时启动扫描；已有任务时复用该任务，不启动第二个进程或请求。
4. Web 根据 HubState 显示刷新中、部分完成、成功或失败；刷新按钮在任务运行期间呈 pending 状态。

## 前端表现

- 功能显示区仅在桌面宽布局的 Chat 界面显示。
- 默认是低干扰的浮动卡片，底边与 composer 上方留出稳定间距；内容增多时向上扩展，不推动消息或输入框布局。
- 与 `Plan` 共用 `useChatEdgeSurfaceGeometry('left')` 一类的几何计算和边缘渐隐。与主文字列重叠的部分降低可见度，hover 或 keyboard focus 时完整显现。
- 标题栏左侧是折叠控制和清晰标题，右侧是详情与刷新图标按钮；所有图标按钮提供 tooltip、可见焦点和可访问名称。
- 紧凑行优先显示 Provider、关键额度窗口和剩余百分比。颜色只表达紧张或错误，不用颜色承担唯一语义。
- 多账号行显示账号数量；摘要取剩余比例最低的账号，详情模式明确标出是哪一个账号。
- `unavailable` 显示“未配置”，扫描错误显示短错误类别；完整错误信息进入详情模式。
- 详情卡片有最大高度和内部滚动，不覆盖 composer；底部锚点保持不动。
- 刷新中保留上一份数据并显示正在刷新，不清空卡片或制造布局闪烁。
- 设置快捷栏仍不包含 Limits/Token Stats；四个现有入口均匀占满可用宽度，活动指示条与对应入口准确对齐。

## 验收标准

- 当前 Usage UI、UsageStream、专用 `tokenStats.update` sink/Registry 转发、旧 TokenStats 设置页及旧 DeepSeek secret 注入路径均被移除，且旧页面不会恢复。
- 设置快捷栏只有“设置、Update、Skills、Port Relay”四项，没有 Token Stats/Limits 入口或最右侧空白列。
- Hub 在启动后扫描一次，此后按“完成后 10 分钟”调度；没有前端在线时仍可正常扫描。
- 任意数量的前端客户端不会增加 Hub 自动扫描次数。
- 手动连续点击刷新不会产生重叠扫描；自动扫描与手动刷新相遇时也只运行一个任务。
- 新连接的客户端能立即读取 Hub 缓存，不需要等待下一次扫描。
- 一轮扫描提交完整快照；删除凭据、账号消失或 Hub 下线后，前端不会保留陈旧账号。
- 多 Hub 下相同稳定账号正确合并，不同账号不会因缺少 identity 被错误合并。
- 所有 reset 时间以完整 UTC timestamp 传输，在远程 Hub、不同时区和跨年场景下显示正确。
- Provider 凭据和密钥片段不出现在 HubState、Registry 消息、Web 状态、日志或错误文本中。
- Windows Desktop 启动后的首次扫描、手动刷新以及至少一个 10 分钟自动周期均不会出现 CMD/控制台窗口。
- 桌面端功能显示区在侧栏展开和收起时都位于 Plan 浮层列下部、composer 上方，并保持相同的渐隐交互。
- 紧凑模式每个 Provider 一行；详情模式在原位置向上扩展并展示全部账号信息。
- 移动端不渲染功能显示区或 Usage 入口。

### 测试

- Go：Provider 响应解析、完整 UTC 时间、凭据错误分类和敏感信息过滤。
- Go：使用 fake clock 验证启动扫描、完成后 10 分钟调度、关闭取消和 singleflight。
- Go/Windows：断言 Codex 及其他扫描辅助命令应用隐藏窗口配置。
- Go：HubState 完整快照替换、自主 `hub.state.updated` 发布、Registry Hub scope 转发及断线行为。
- Web：Hub 快照原子替换、Hub 下线清理、跨 Hub 身份合并、最紧张账号摘要、loading/stale/error 状态。
- Web UI：标题栏折叠、详情切换、刷新 pending、桌面显示、移动端隐藏、侧栏两种状态下的浮层位置约束。
- Web UI：设置快捷栏四等分布局、活动索引和旧 Token Stats 入口持续缺失。
- 集成：Hub 自动扫描结果可被新客户端读取；手动刷新后收到更新；消息中不含测试密钥。
- 回归：相关 Go 测试、Web Jest、TypeScript 检查和生产构建通过。

## 范围之外

- 移动端 Usage 入口和布局。
- Copilot 或其他新 Provider。
- 用量历史、趋势图、费用预测和磁盘持久化历史。
- Git 分支等后续功能显示模块的具体实现；本次只保证容器可扩展。
- Registry protocol version 变更。
