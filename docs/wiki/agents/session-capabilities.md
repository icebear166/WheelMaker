> 摘要：本页维护 Agent 可选 Session 能力、执行所有权和通用控制面边界。

# Session 可选能力

WheelMaker 不假定每个 Agent 都实现相同的 Session 控制能力。Agent factory 为每个 provider 声明 `status`、`compact`、`steer`、`fork`、`goal` 等 action capability；Session summary 以 `{supported, reason}` 投影到 Web。Web 据此隐藏不可用入口，Hub 仍是最终校验者，不为 unsupported provider 模拟能力。

Agent 层用可选接口承接能力。通用 Client/Session 只使用 provider-neutral 参数、结果和错误；runtime thread ID、turn ID、原生 JSON-RPC method 与 provider 状态只存在于 adapter。

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
