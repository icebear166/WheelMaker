> 摘要：本页维护 WheelMaker 采用 ACP 时的稳定协议边界、生命周期和兼容约束。

# ACP

> 来源：本页整理自原路径 `docs/acp-protocol-full.zh-CN.md`。带废弃 API、unstable 草案和历史集成说明的完整原文保存在 [`../../references/acp-protocol-full.zh-CN.md`](../../references/acp-protocol-full.zh-CN.md)。

## 适用范围

WheelMaker 把 ACP 作为 Client 与 Agent 之间的业务协议。协议类型和方法常量分别以 [`server/internal/protocol/acp.go`](../../../server/internal/protocol/acp.go) 和 [`server/internal/protocol/acp_const.go`](../../../server/internal/protocol/acp_const.go) 为代码侧依据；具体 provider 的转换与连接策略位于 `server/internal/hub/agent/`，不进入 Registry 或 Session 业务协议。

完整参考中标记为 unstable、特定工具版本、历史阶段或后续计划的内容不属于本页所述的当前稳定边界。

内置 ACP provider 为 codex、claude、copilot、opencode、mimo、codebuddy、flicker、kimi；统一以 `ACPProviderPreset` 声明启动方式，kimi 走官方 Kimi Code CLI 的 `kimi acp` 子进程，登录由用户在 CLI 侧自行完成，WheelMaker 不触发 device-code 授权。

## 消息与初始化

- ACP 使用双向 JSON-RPC 语义，stdio 传输时每条消息使用 UTF-8 JSON 并以换行分隔。
- `initialize` 必须先于任何 `session/*` 调用，用于协商协议版本、Client capabilities、Agent capabilities 和身份信息。
- 未声明的 capability 视为不支持。调用文件系统、终端、Session load/list 或扩展内容块前，调用方必须检查对应 capability。
- 文件路径使用绝对路径，协议中的文本位置按 1-based 行号解释。

## Session 与 Prompt 生命周期

1. Client 完成 `initialize`。
2. Client 使用 `session/new` 建立 Session，或在 Agent 声明支持时使用 `session/load` 恢复 Session。
3. `session/load` 先通过 `session/update` 重播历史，再返回 load 结果。
4. `session/prompt` 发起一次回合；Agent 先流出零条或多条 `session/update`，最后用包含 `stopReason` 的 prompt response 收尾。
5. `session/cancel` 是 notification。取消成功后，原 prompt 仍以 `stopReason=cancelled` 正常结束，而不是留下悬挂请求。
6. `session/list` 只有在 `agentCapabilities.sessionCapabilities.list` 存在时才可调用。

## 内容、工具与权限

- `text` 和 `resource_link` 是基础 ContentBlock；`image`、`audio` 和嵌入式 `resource` 受 prompt capabilities 门禁。
- 工具调用使用 `tool_call` 建立，再通过 `tool_call_update` 更新。稳定状态集合是 `pending`、`in_progress`、`completed`、`failed`。
- Agent 可以通过 `session/request_permission` 请求用户授权；回合取消时，待处理的权限请求也必须得到取消结果。
- `plan` 和 `config_option_update` 携带完整快照，消费者应替换对应状态，不把它们当成增量 patch。
- `session/set_config_option` 返回完整配置项列表。Session Modes 只作为 legacy 输入字段保留，新路径使用 `configOptions`。

## WheelMaker 实现边界

- ACP wire 类型只表达协议字段；WheelMaker 内部 side-band 数据不得序列化进 wire payload。
- `SessionUpdate.ModeID` 仅用于解析 legacy `current_mode_update` 输入，当前配置路径使用 `ConfigOptions` 和 `config_option_update`。
- Agent/provider 层负责外部运行时与 ACP 的转换。Session、Registry 和 recorder 不应依赖 provider 私有 thread、turn 或 item 字段。
- ACP 负责 Agent 交互语义；App 侧跨机器路由、项目归属和 Session 事件广播属于 [Registry 协议](registry.md)。

## 完整参考的使用方式

完整中文参考适合查阅字段示例、废弃 API 和来源链接，但其中的 unstable 草案、codex-acp 使用摘要、旧飞书阶段说明以及过期内部文件路径不能直接视为当前实现事实。需要更新本页时，应同时核对当前代码和上游稳定 schema。

来源：

- [`../../scope/2026-07-20-kimi-acp-provider/spec-kimi-acp-provider.md`](../../scope/2026-07-20-kimi-acp-provider/spec-kimi-acp-provider.md)
