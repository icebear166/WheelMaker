> 摘要：本页维护 Agent Limits 监控的数据所有权、刷新机制、Provider 范围和桌面/移动端展示约定。

# Limits 监控

Limits 监控统一展示 Codex、Kimi、ZAI 和 DeepSeek 的当前额度或余额，不包含 Copilot、历史趋势和费用预测。

## 数据所有权

- Hub 是用量数据的唯一所有者，负责凭据发现、Provider 扫描、定时调度、singleflight 和完整快照缓存。
- Hub 启动后立即扫描一次，之后从每轮完成时间起每 10 分钟扫描一次。
- 前端不轮询 Provider，也不因客户端数量增加扫描次数；手动刷新对所有在线 Hub 发起，并复用 Hub 内正在运行的扫描。
- ZAI、DeepSeek 凭据只从 OpenCode auth 读取；Kimi 除 OpenCode auth 外还读取 Kimi Code CLI 本地凭据（`~/.kimi-code/credentials/kimi-code.json`，尊重 `KIMI_CODE_HOME`），只读未过期的 `access_token`，不做 OAuth 刷新、不写凭据文件；Codex 使用 Codex 自身凭据。
- API key、access token 和密钥片段不得进入 HubState、Registry 消息、Web 状态、日志或错误文本。
- Codex `app-server` 等辅助进程必须通过后台命令构造器启动；Windows 使用隐藏窗口配置。

## 同步边界

Limits 使用 HubState 的 `tokenStats` section。客户端通过 `hub.state.get` 读取缓存、通过 `hub.state.refresh` 手动刷新，并通过通用 `hub.state.updated` 接收完整快照替换。Registry 只验证 Hub 身份和 scope、转发通用 HubState，不包含 Provider 业务或密钥注入逻辑。

快照以 `generation` 原子替换，显式表达 `idle | scanning | ready | error` 扫描状态、Provider 的 `ok | unavailable | error` 状态、账号身份、额度窗口、完整 UTC reset timestamp 和可选余额。拿不到稳定账号身份时，不跨 Hub 合并账号。Kimi 以 usages 响应的 `user.userId` 作为稳定身份（`Identity{kind:"user"}`）：同一 userId 的多个凭证源（OpenCode、Kimi Code）在 Hub 扫描时合并为单个账户，全部源失败时才按源分别报错。

## 桌面端展示

- Chat 文字区左上方依次排列 Recent Sessions、Plan 和 Limits；缺少前一项时，后一项自动上移补位。
- 三类浮层共用左边界、宽度、间距、毛玻璃背景和正文交界处的渐隐规则，侧栏展开或收起不改变水平几何。
- 标题栏支持折叠，右侧提供详情和刷新操作。
- 紧凑模式每个 Provider 一行；多账号摘要显示最紧张账号及账号数量。
- 详情模式保持相同宽度，展示聚合后的账号、所属 Hub、额度窗口、重置时间、余额和刷新状态。
- 桌面 Chat 设置保留 Limits 显示开关，标题栏的隐藏操作会提示用户可从该设置重新打开；Limits 不恢复已移除的独立设置页面入口。

## 移动端展示

- 展开移动快捷菜单后，从上到下固定为 Preview、Terminal、Chat、Limits、Settings；收起时仍只显示 Chat。
- Terminal 复用现有移动全屏终端，不自动创建终端。Limits 入口始终可见，不受桌面 Limits 显示开关控制。
- Limits 使用覆盖移动视口的遮罩和保留安全区间距的大型详情卡片，正文复用桌面详情模式的账号聚合与额度展示。
- 详情卡片标题栏提供刷新和关闭操作；打开时只读取当前 Hub 缓存，只有手动刷新才触发现有跨 Hub 强制刷新。
- 点击卡片外遮罩、关闭按钮或移动端系统返回会关闭 Limits；卡片内部点击不关闭。Terminal、Preview、Settings 和 Limits 全屏层互斥。

## Windows 子进程

Provider 扫描启动的所有辅助进程都必须使用统一后台命令配置。Windows 必须设置隐藏窗口，首次扫描、周期扫描和手动刷新均不得出现控制台窗口。

来源：

- [`../../scope/2026-07-18-agent-usage-rewrite/spec-agent-usage-rewrite.md`](../../scope/2026-07-18-agent-usage-rewrite/spec-agent-usage-rewrite.md)
- [`../../scope/2026-07-18-mobile-limits-monitor/spec-mobile-limits-monitor.md`](../../scope/2026-07-18-mobile-limits-monitor/spec-mobile-limits-monitor.md)
- [`../../scope/2026-07-20-kimi-acp-provider/spec-kimi-acp-provider.md`](../../scope/2026-07-20-kimi-acp-provider/spec-kimi-acp-provider.md)
