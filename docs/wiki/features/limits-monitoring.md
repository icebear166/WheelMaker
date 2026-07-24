> 摘要：本页维护 Monitor 中 Limits 的数据所有权、刷新机制、Provider 范围和跨屏展示约定。

# Limits 监控

Limits 监控统一展示 Codex、MyFlicker、Kimi、ZAI 和 DeepSeek 的当前额度或余额，不包含 Copilot、历史趋势和费用预测。

## 数据所有权

- Hub 是用量数据的唯一所有者，负责凭据发现、Provider 扫描、定时调度、singleflight 和完整快照缓存。
- Hub 启动后立即扫描一次，之后从每轮完成时间起每 10 分钟扫描一次。
- 前端不轮询 Provider，也不因客户端数量增加扫描次数；手动刷新对所有在线 Hub 发起，并复用 Hub 内正在运行的扫描。
- Kimi、ZAI 和 DeepSeek 优先读取 Hub 已加载的 `config.json` `api_keys`，再发现外部凭据：三者均可读取 OpenCode auth，Kimi 还读取 Kimi Code CLI 本地凭据（`~/.kimi-code/credentials/kimi-code.json`，尊重 `KIMI_CODE_HOME`）中未过期的 `access_token`；不做 OAuth 刷新、不写凭据文件。每个 Provider 在发请求前按完整 credential 精确去重，保留最先出现的 config 来源；不同 credential 继续分别扫描并保留多账号语义。Codex 使用 Codex 自身凭据。
- MyFlicker 只读 `~/.myflicker/ai-token.json` 中的登录 token 和 username，调用 Takumi `GET /rest/codeflicker/credit-alert` 获取账号额度；当前只发布总额大于零的月度额度，周额度为零时不生成额度窗口。
- API key、access token 和密钥片段不得进入 HubState、Registry 消息、Web 状态、日志或错误文本。
- Codex `app-server` 等辅助进程必须通过后台命令构造器启动；Windows 使用隐藏窗口配置。

## 同步边界

Limits 使用 HubState 的 `tokenStats` section。客户端通过 `hub.state.get` 读取缓存、通过 `hub.state.refresh` 手动刷新，并通过通用 `hub.state.updated` 接收完整快照替换。Registry 只验证 Hub 身份和 scope、转发通用 HubState，不包含 Provider 业务或密钥注入逻辑。

快照以 `generation` 原子替换，显式表达 `idle | scanning | ready | error` 扫描状态、Provider 的 `ok | unavailable | error` 状态、账号身份、额度窗口、完整 UTC reset timestamp 和可选余额。拿不到稳定账号身份时，不跨 Hub 合并账号。Kimi 以 usages 响应的 `user.userId` 作为稳定身份（`Identity{kind:"user"}`）：同一 userId 的多个凭证源（OpenCode、Kimi Code）在 Hub 扫描时合并为单个账户，全部源失败时才按源分别报错。

## 桌面端展示

- Chat 文字区左上方依次排列 Recent Sessions、Plan 和 Monitor；缺少前一项时，后一项自动上移补位。
- 三类浮层共用左边界、宽度、间距、实心面板材质（8px 圆角、发丝边、悬浮阴影、顶部 1px 内高光）和正文交界处的渐隐规则，侧栏展开或收起不改变水平几何。
- Monitor 在同一标题行提供 `Limits / IQ` 发丝边分段控件（透明轨、选中 `accent-soft-bg` + accent 文字），以及共享的折叠、隐藏、Simple/Detail 和刷新操作。默认选择 Limits 和 Simple；切换 Tab 保持 Monitor 级 Simple/Detail 状态。
- 共享刷新同时触发 Limits 与 IQ 的刷新入口。任一数据源刷新时图标旋转；两条数据链路继续独立处理快照和错误。
- 紧凑模式每个可用账号一行，单账号只显示 Provider 名；同一 Provider 有多个账号时按当前列表顺序显示为 `Kimi-1`、`Kimi-2`。每行固定展示两个额度槽位：第一槽为 5 小时额度，只显示百分比和进度条；缺失时显示 `-/-` 和空轨道。第二槽显示较长周期额度，Codex/Kimi 周额度标记为 `1W`，MyFlicker 月额度标记为 `1M`。
- Limits 内容行层级：Provider/账号名为 `text-primary` 650 的行锚点；数据值 11px tabular-nums；标签、后缀与空态为 `text-tertiary` 10px；hub pill 为 `text-tertiary` 10px mono、只留发丝边。
- 正常态额度 rail 使用纯 `--accent-primary`，不与 `text-primary` 混色；警告/危险分别接 `--state-warning` / `--state-danger`，tone 行 label 同步染色，不保留双色值。
- 详情模式保持相同宽度，展示聚合后的账号、所属 Hub、额度窗口、重置时间、余额和刷新状态；账号区块拍平为 hairline 分隔分区（标题行 + 额度行），不使用卡片套卡片。
- 桌面 Chat 设置只保留 `Show Monitor`。新偏好键不存在时，旧 Limits 或 Model efficiency 任一显示偏好为 true 就迁移为显示；迁移后只写新键。标题栏隐藏仅关闭桌面 Monitor，可从该设置恢复。

## 移动端展示

- 展开移动快捷菜单后，从上到下固定为 Preview、Terminal、Chat、Monitor、Settings；收起时仍只显示 Chat。
- Terminal 复用现有移动全屏终端，不自动创建终端。Monitor 入口始终可见，不受桌面 `Show Monitor` 开关控制。
- Monitor 使用覆盖移动视口的遮罩和保留安全区间距的大型详情卡片。标题栏同一行固定提供 `Monitor`、带明确容器与选中态的 `Limits / IQ` 分段 Toggle、刷新和关闭；每次打开默认选择 Limits，两个 Tab 都直接使用 Detail 正文，不提供 Simple/Detail 按钮和底部状态栏。
- 标题栏提供共享刷新和关闭操作。共享刷新同时触发现有跨 Hub 强制刷新与 IQ 前端 store 刷新；打开 Monitor 本身只读取当前缓存，不额外触发请求。
- 点击卡片外遮罩、关闭按钮或移动端系统返回会关闭 Monitor；卡片内部点击不关闭。Terminal、Preview、Settings 和 Monitor 全屏层互斥。

## Windows 子进程

Provider 扫描启动的所有辅助进程都必须使用统一后台命令配置。Windows 必须设置隐藏窗口，首次扫描、周期扫描和手动刷新均不得出现控制台窗口。

来源：

- [`../../scope/2026-07-18-agent-usage-rewrite/spec-agent-usage-rewrite.md`](../../scope/2026-07-18-agent-usage-rewrite/spec-agent-usage-rewrite.md)
- [`../../scope/2026-07-18-mobile-limits-monitor/spec-mobile-limits-monitor.md`](../../scope/2026-07-18-mobile-limits-monitor/spec-mobile-limits-monitor.md)
- [`../../scope/2026-07-20-kimi-acp-provider/spec-kimi-acp-provider.md`](../../scope/2026-07-20-kimi-acp-provider/spec-kimi-acp-provider.md)
- [`../../scope/2026-07-22-monitor-card/spec-monitor-card.md`](../../scope/2026-07-22-monitor-card/spec-monitor-card.md)
- [`../../scope/2026-07-24-floating-chrome-visual-upgrade/spec-floating-chrome-visual-upgrade.md`](../../scope/2026-07-24-floating-chrome-visual-upgrade/spec-floating-chrome-visual-upgrade.md)
- [`model-efficiency.md`](model-efficiency.md)
