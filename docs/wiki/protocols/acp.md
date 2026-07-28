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
- `session/request_permission.params` 包含 `sessionId`、`toolCall: ToolCallUpdate` 和 `options`。`toolCall` 是当前请求携带的操作详情，不要求 Client 把 permission 转换成 ToolCall，也不保证 `content` 是专门的问题字段。
- `plan` 和 `config_option_update` 携带完整快照，消费者应替换对应状态，不把它们当成增量 patch。
- `session/set_config_option` 返回完整配置项列表。Session Modes 只作为 legacy 输入字段保留，新路径使用 `configOptions`。

### WheelMaker Request Permission

该行为由 [`../../scope/2026-07-21-request-permission/spec-request-permission.md`](../../scope/2026-07-21-request-permission/spec-request-permission.md) 定义。

- WheelMaker 对所有 provider 使用同一 permission 路径，不识别 Kimi `AskUserQuestion` 或其他 provider 私有工具名。
- Client 只从当前 request 投影 title、标准 text content 和 permission options；不关联已有 ToolCall，不保存完整 `ToolCallUpdate`、raw input/output 或富内容。
- permission request 在当前 prompt 中成为 `permission_request` turn；只有用户实际选择才产生 `permission_response` turn。两者是追加事件，UI 可以按 `permissionId` 折叠展示。
- 用户选择通过 WheelMaker Registry `session.permission.respond` 回到持有 ACP request 的 Hub Session；它不是新的 `session/prompt` 或 user message。
- prompt cancel 时，ACP waiter 返回 `cancelled`，但历史中不伪造用户 response；`prompt_done` 是未回答 permission 的 terminal 边界。
- Hub 重启不恢复旧 permission waiter。未完成 prompt tail 按 WheelMaker 现有 turn rollback 语义清理，session resume/load 不因历史 request 打开交互。

## WheelMaker 实现边界

- ACP wire 类型只表达协议字段；WheelMaker 内部 side-band 数据不得序列化进 wire payload。
- `SessionUpdate.ModeID` 仅用于解析 legacy `current_mode_update` 输入，当前配置路径使用 `ConfigOptions` 和 `config_option_update`。
- Agent/provider 层负责外部运行时与 ACP 的转换。Session、Registry 和 recorder 不应依赖 provider 私有 thread、turn 或 item 字段。
- ACP 负责 Agent 交互语义；App 侧跨机器路由、项目归属和 Session 事件广播属于 [Registry 协议](registry.md)。

### Claude-compatible provider 约定

`cc-deepseek`、`cc-glm`、`cc-kimi`、`cc-qwen`、`cc-flicker` 复用 `claude-agent-acp` 与 Claude Agent SDK，不在 WheelMaker 内重新实现 Anthropic Messages。它们是独立 ACP provider：使用不同的 Hub 本地 Key、Anthropic-compatible endpoint、模型来源和 `CLAUDE_CONFIG_DIR`，但继续复用 owned ACP process、权限请求、工具调用和通用 `configOptions` 链路。

- provider 只在 Hub 启动时、`claude-agent-acp` 与对应 Key 都存在时注册；Registry 只接收平铺的可用 agent ID，不接触 Key。
- 模型选择由 provider 注入 `availableModels` 和默认模型，App 不增加 provider 私有模型协议。
- `cc-kimi` 的模型白名单是 `k3[1m]`、`k3`、`kimi-for-coding`、`kimi-for-coding-highspeed`，默认 `k3[1m]`；`cc-glm` 的模型白名单是 `glm-5.2[1m]`、`glm-5.2`、`glm-4.7`、`glm-4.5-air`，默认 `glm-5.2[1m]`。Claude ACP 无法移除的 `Default` 条目仍可能出现，但会解析到对应 provider 默认模型。
- `cc-flicker` 连接由 Hub 托管的本地 Flicker Bridge（`http://127.0.0.1:17999`），默认 `CLAUDE_OPUS_4_8`。Hub 在 bridge 健康后缓存当前 `/v1/models`，启动 ACP 时将同一动态目录写入 `models`（展示元数据）和 `availableModels`（`claude-agent-acp` 的 ACP model config option 输入），同时注入 `env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`，不写 `enforceAvailableModels`。Bridge 有两个互斥运行模式：V1 是 WheelMaker 当前内置的 Go MyFlicker 协议迁移实现；V2 是通过 Node 加载 npm `@myflicker/cli` AI SDK provider 的 Wanqing 出口。Hub 菜单选择并持久化模式，两个模式复用相同 endpoint、`cc-flicker` agent ID 和配置目录，同一时刻只有一个模式监听 17999。
- V1 模型选择跟随 bridge `/v1/models` 动态 catalog 全量展示（非 Claude 模型带 `CLAUDE-MYFLICKER-` 前缀 id）。Opus/Fable 映射到 `CLAUDE_OPUS_4_8`，Sonnet/Haiku/Subagent 映射到 `CLAUDE_4_6`，WheelMaker 侧不做 effort 归一化。V2 由 MyFlicker AI SDK 按模型选择 Anthropic、OpenAI 或 Responses 上游格式，并接受 canonical ID、MyFlicker alias，以及能由 `epModelName` 唯一对应的 V1 model ID；不存在或冲突的模型不得静默替换。V2 的 Anthropic 转换兼容 Claude Code 放在 `messages[]` 中的 `system` role，合并时只注入一次 MyFlicker 基础 prompt。
- Hub 配置 `api_keys.flicker` 后才拉起当前选中的 bridge 子进程并注册 `cc-flicker`；该配置是两个模式共同的产品启用门槛。V1 继续把它作为本地门禁，Claude Code 因而在两个模式下都可继续发送该 header。V2 不读取、不校验也不转发这个 fake key；其 `/v1/models`、`/v1/messages` 和 `/v1/messages/count_tokens` 只通过 loopback 暴露，真实万擎认证完全由 Node worker 内的 npm `@myflicker/cli` 执行 `login`、写入 login/userInfo context 并初始化 `wanqingPlugin` 获得。MyFlicker 凭证不离开 worker，WheelMaker 和 Claude Code 均不读取。运行中切换会重启 bridge 但不主动删除 `cc-flicker` Session；目标模式失败时 Hub 恢复原模式。
- 状态与上游 Session 分别位于各自的 `<stateDir>/.data/cc-*` 目录；历史、settings、agents、hooks、plugins 和认证配置继续相互隔离。唯一共享的用户配置是全局 Skills：每个 `cc-*` 的 `<configDir>/skills` 整目录链接到 `~/.claude/skills`，Windows 使用 Junction，其他平台使用目录符号链接。已有非空真实目录或指向其他位置的链接不会被覆盖，provider 启动会返回明确错误。
- Session 恢复以 agent ID 和各自 projects 目录为边界，不允许在 Claude、GLM、Kimi 间跨 provider 导入或恢复。
- App 可以把平铺 ID 投影为 Claude 主项旁的展开子项，但分组只属于展示层，不进入 ACP 或 Registry wire schema。

来源：[`../../scope/2026-07-23-claude-compatible-agents/spec-claude-compatible-agents.md`](../../scope/2026-07-23-claude-compatible-agents/spec-claude-compatible-agents.md)。

## 完整参考的使用方式

完整中文参考适合查阅字段示例、废弃 API 和来源链接，但其中的 unstable 草案、codex-acp 使用摘要、旧飞书阶段说明以及过期内部文件路径不能直接视为当前实现事实。需要更新本页时，应同时核对当前代码和上游稳定 schema。

来源：

- [`../../scope/2026-07-20-kimi-acp-provider/spec-kimi-acp-provider.md`](../../scope/2026-07-20-kimi-acp-provider/spec-kimi-acp-provider.md)
- [`../../scope/2026-07-21-request-permission/spec-request-permission.md`](../../scope/2026-07-21-request-permission/spec-request-permission.md)
- [`../../scope/2026-07-23-claude-compatible-agents/spec-claude-compatible-agents.md`](../../scope/2026-07-23-claude-compatible-agents/spec-claude-compatible-agents.md)
- [`../../scope/2026-07-28-flicker-bridge-mode-switch/spec-flicker-bridge-mode-switch.md`](../../scope/2026-07-28-flicker-bridge-mode-switch/spec-flicker-bridge-mode-switch.md)
