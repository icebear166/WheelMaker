> 摘要：本页维护 Agent Limits 监控的数据所有权、刷新机制、Provider 范围和桌面端展示约定。

# Limits 监控

Limits 监控统一展示 Codex、Kimi、ZAI 和 DeepSeek 的当前额度或余额，不包含 Copilot、历史趋势和费用预测。

## 数据所有权

- Hub 是用量数据的唯一所有者，负责凭据发现、Provider 扫描、定时调度、singleflight 和完整快照缓存。
- Hub 启动后立即扫描一次，之后从每轮完成时间起每 10 分钟扫描一次。
- 前端不轮询 Provider，也不因客户端数量增加扫描次数；手动刷新对所有在线 Hub 发起，并复用 Hub 内正在运行的扫描。
- Kimi、ZAI、DeepSeek 凭据只从 OpenCode auth 读取；Codex 使用 Codex 自身凭据。
- API key、access token 和密钥片段不得进入 HubState、Registry 消息、Web 状态、日志或错误文本。
- Codex `app-server` 等辅助进程必须通过后台命令构造器启动；Windows 使用隐藏窗口配置。

## 同步边界

Limits 使用 HubState 的 `tokenStats` section。客户端通过 `hub.state.get` 读取缓存、通过 `hub.state.refresh` 手动刷新，并通过通用 `hub.state.updated` 接收完整快照替换。Registry 只验证 Hub 身份和 scope、转发通用 HubState，不包含 Provider 业务或密钥注入逻辑。

快照以 `generation` 原子替换，显式表达 `idle | scanning | ready | error` 扫描状态、Provider 的 `ok | unavailable | error` 状态、账号身份、额度窗口、完整 UTC reset timestamp 和可选余额。拿不到稳定账号身份时，不跨 Hub 合并账号。

## 桌面端展示

- Chat 文字区左侧浮层列下部设通用功能显示区，垂直锚定在输入框上方；侧栏展开或收起不改变位置逻辑。
- 功能显示区与 Plan 共用水平几何和文字重叠渐隐规则，但不紧邻 Plan，中间空间保留给对话内容。
- 标题栏支持折叠，右侧提供详情和刷新操作。
- 紧凑模式每个 Provider 一行；多账号摘要显示最紧张账号及账号数量。
- 详情模式保持底部锚点并向上扩展，展示账号、所属 Hub、额度窗口、重置时间、余额、刷新状态和错误。
- 移动端入口另行设计；Limits 不进入设置页面或设置快捷栏。

## Windows 子进程

Provider 扫描启动的所有辅助进程都必须使用统一后台命令配置。Windows 必须设置隐藏窗口，首次扫描、周期扫描和手动刷新均不得出现控制台窗口。

来源：[`../../scope/2026-07-18-agent-usage-rewrite/spec-agent-usage-rewrite.md`](../../scope/2026-07-18-agent-usage-rewrite/spec-agent-usage-rewrite.md)
