> 由 scope skill 于 2026-07-18 生成

# Mobile Limits Monitor

## 目标

将现有 Limits 监控接入移动端快捷菜单，让用户无需打开桌面侧边功能区即可查看各 Agent 账号的详细用量。移动端继续消费现有 Hub 用量快照和手动刷新能力，不改变 Hub 的 10 分钟扫描节奏、Registry 协议或桌面端 Limits 卡片。

## 决策

- 移动快捷菜单展开后从上到下固定为 `Preview → Terminal → Chat → Limits → Settings` 五个按钮；收起状态仍只显示当前 Chat 按钮。
- Terminal 按钮复用现有移动端全屏终端，不自动创建终端；没有终端时使用现有创建入口。
- Limits 按钮在移动端始终显示，不受桌面设置 `Show Limits Monitor` 控制。
- Limits 使用覆盖整个移动视口的遮罩层，遮罩内放置一张四周保留安全区间距的大型详情卡片。
- 详情卡片头部包含 `Limits` 标题、刷新按钮和关闭按钮；正文只展示现有 detail 账号卡片，不提供简略模式、隐藏按钮或模式切换按钮。
- 点击详情卡片外的遮罩、点击关闭按钮或触发移动端系统返回都会关闭 Limits。
- 点击卡片内部不会关闭；打开 Terminal 或 Limits 时先收起快捷菜单，并确保同一时间只呈现一个移动端全屏层。
- 打开 Limits 不触发扫描，默认展示当前 Hub 缓存；只有点击刷新按钮才发起现有的强制刷新流程。

## 架构

移动快捷菜单仍由 Workspace 的 floating control stack 管理，只增加 Terminal 和 Limits 两个动作。现有 Limits detail 内容从桌面 `UsageFeatureSurface` 中提取为可复用展示单元，桌面卡片和新的移动模态框共享账号聚合、额度、余额、重置时间与空状态表现。Workspace 负责移动模态框开关、全屏层互斥、刷新动作和系统返回处理；ResponsiveShell 继续通过现有 mobile overlay 插槽承载当前唯一的移动全屏层。

## 流程

1. 用户展开移动快捷菜单，看到五个固定顺序的按钮。
2. 点击 Terminal 时收起菜单并打开现有终端全屏层。
3. 点击 Limits 时收起菜单、关闭其他移动全屏层并打开 Limits 遮罩。
4. Limits 正文读取当前 `UsageViewSnapshot`，直接渲染 detail 账号卡片。
5. 点击刷新后调用现有跨 Hub 强制刷新，模态框保持打开并展示刷新状态；新快照到达后原位更新。
6. 点击遮罩、关闭按钮或系统返回时仅关闭 Limits，返回 Chat。

## 验收标准

- 移动快捷菜单展开后恰好有五个按钮，顺序为 Preview、Terminal、Chat、Limits、Settings。
- Terminal 入口打开现有移动终端；没有终端时不自动创建。
- Limits 入口无论桌面 `Show Limits Monitor` 是否关闭都保持可见。
- Limits 模态框覆盖移动视口，正确处理安全区，并以大型卡片展示与桌面 detail 一致的账号用量信息。
- 模态框头部有可访问名称明确的刷新和关闭按钮。
- 点击遮罩关闭，点击卡片内部不关闭，移动端系统返回优先关闭 Limits。
- 打开 Limits 不调用刷新；点击刷新只调用一次现有强制刷新动作，并显示刷新状态。
- 打开 Terminal、Preview、Settings 或 Limits 时不会叠加两个移动全屏层。
- 没有可用快照或没有成功账号时展示现有语义一致的空状态，不崩溃、不显示未认证噪音。
- 桌面 Limits 的显示开关、卡片位置、折叠/详情切换与隐藏确认行为保持不变。

### 测试

- 用 Workspace 源码契约或组件测试验证五个快捷按钮的顺序、Terminal/Limits 点击动作及 Limits 不受桌面显示开关控制。
- 用组件渲染测试验证移动 Limits 头部、detail 内容复用、刷新、遮罩关闭、内部点击不关闭和空状态。
- 用状态/集成测试验证系统返回优先关闭 Limits，以及移动全屏层互斥。
- 运行 Web TypeScript 检查、相关 Jest 测试、全量 Web 测试和生产 Web 构建。
- 不新增 Hub、Registry 或协议测试，因为本需求不改变数据生产与传输链路。

## 范围之外

- 不修改 Hub 扫描器、Provider 解析、10 分钟调度、Registry 方法或协议版本。
- 不重做 Terminal、Preview、Settings 的移动全屏内容。
- 不改变桌面 Limits 卡片、桌面显示设置或移动端快捷浮钮的拖拽与停靠机制。
- 不为移动 Limits 增加独立缓存、自动刷新定时器或新的持久化设置。
