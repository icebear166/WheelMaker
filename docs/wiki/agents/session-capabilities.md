> 摘要：本页维护 Agent 可选 Session 能力、执行所有权和通用控制面边界。

# Session 可选能力

WheelMaker 不假定每个 Agent 都实现相同的 Session 控制能力。`status` 是 WheelMaker 层通用能力——所有 session 恒可用，显示数据库身份（session id、agent 类型）与累计 token 用量，不依赖 provider；`compact`、`steer`、`fork`、`goal`、`archive` 由 initialize 协商得到的 `agentCapabilities._meta.wm.sessionActions` 声明。Session summary 以 `{supported, reason}` 投影到 Web；Web 据此隐藏不可用入口，Hub 仍是最终校验者，不为 unsupported provider 模拟能力。

Agent 层通过 ACP 正式扩展 request 承接 provider-gated 能力。通用 Client/Session 只使用 provider-neutral 参数、结果和错误；runtime thread ID、turn ID 与原生 provider method 只存在于 adapter。`status` 不经过 Agent request。

| 能力 | ACP 扩展 request |
| --- | --- |
| steer | `_wm/session/steer` |
| compact | `_wm/session/compact` |
| goal | `_wm/session/goal/set`、`get`、`clear` |
| fork | `_wm/session/fork/resolve`、`fork` |
| archive | `_wm/session/archive` |

Goal snapshot 的异步变化使用 `_wm/session/goal` notification，并由 `goalLifecycle` capability 门禁。未协商能力时不得通过 Go type assertion、provider 名称或其他 side-channel 猜测支持情况。

扩展 request 失败时使用 JSON-RPC error，并在 `error.data.code` 中返回稳定分类：`inactive`、`busy`、`unavailable`、`unsupported` 或 `invalid`。Hub 只根据该 code 映射 provider-neutral typed error；不解析 message 文案来决定 Steer fallback、Retry 或 unsupported 行为。

## Status

`status` 对所有 session 恒 supported：只返回 WheelMaker 稳定 session id、agent 类型与累计 token 用量（`agentState.Usage`），这些都是 WheelMaker 自身事实，不属于 provider 能力。读取时只取当前 Session 的内存或持久化 snapshot，不创建、初始化或加载 Agent，不调用 provider RPC，因此冷/归档 session 和所有 provider 的表现一致。Provider 限流、套餐与账号数据由 Monitor 负责，不属于 session status。其余 provider-gated 能力（`compact`/`steer`/`fork`/`goal`）不支持时隐藏入口并由服务端拒绝。

详细设计见 [`../../scope/2026-07-30-universal-session-status/spec-universal-session-status.md`](../../scope/2026-07-30-universal-session-status/spec-universal-session-status.md)。

## 执行与 side-channel

- 普通 Prompt、Compact 和 Goal 都是排他的 Session execution owner。
- Steer 是活动 Turn 的 side-channel，不取得 execution lock，也不取消当前 Turn。
- 普通 Prompt 是单次 request/result 生命周期；Goal 可以跨多个物理 Turn 持续占有 Session。
- Goal continuation 之间不能发布短暂 idle，否则 App 会过早 drain queued prompts。
- Resume 可以把正在运行的普通 Prompt 所有权原子升级为 Goal；当前物理 Turn 完成后由 Goal 继续。
- Pause、Clear 不打断物理 Turn。Session 等 Turn 真正完成后才结束 Goal execution；Stop 是 Pause + Interrupt。

## Steer

支持 Steer 的 Agent 接收正在运行 Turn 的附加用户输入。App 中的新消息默认仍进入本地 prompt queue，只有用户显式点击 Steer 才即时发送。成功输入进入当前 prompt 的内部用户 turn；若目标 Turn 在接受前结束，Session 可原子接管为优先下一 Prompt。

详细产品和竞态语义见 [`../../scope/2026-07-26-session-steer/spec-session-steer.md`](../../scope/2026-07-26-session-steer/spec-session-steer.md)。

## Goal

Goal 是持久化的 Session 控制面。通用 snapshot 包含 objective、status、nullable token budget、tokens used、elapsed time和时间戳；状态为 `active`、`paused`、`blocked`、`usageLimited`、`budgetLimited` 或 `complete`。

`/goal <objective>` 使用普通 App queue，在 Hub 执行到队首时转换为 Goal create。原始命令保留为用户 turn，但不发送给模型。Goal 的 edit、Pause、Resume、Clear 不进入聊天正文；第二个及之后的自动 Turn 以前置 `Goal continued` system divider 区分。

Active Goal 是 Session 懒加载策略的例外：Hub 启动时主动恢复；运行期间的 liveness probe 发现 provider runtime 失活后，会丢弃旧连接、清除已终止的物理 Turn、重新 load Session，并用 provider Goal get 校准 snapshot。Paused 与 terminal Goal 只恢复 snapshot，不启动 Agent。普通 Fork 不继承 Goal。

详细行为见 [`../../scope/2026-07-26-session-goal/spec-session-goal.md`](../../scope/2026-07-26-session-goal/spec-session-goal.md)。

ACP 扩展边界见 [`../../scope/2026-08-02-acp-extension-boundary-v27/spec-acp-extension-boundary-v27.md`](../../scope/2026-08-02-acp-extension-boundary-v27/spec-acp-extension-boundary-v27.md)。
