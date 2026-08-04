> 摘要：本页维护 WheelMaker 采用 ACP 时的稳定协议边界、生命周期和兼容约束。

# ACP

> 来源：本页整理自原路径 `docs/acp-protocol-full.zh-CN.md`。带废弃 API、unstable 草案和历史集成说明的完整原文保存在 [`../../references/acp-protocol-full.zh-CN.md`](../../references/acp-protocol-full.zh-CN.md)。

## 适用范围

WheelMaker 把 ACP 作为 Client 与 Agent 之间的业务协议。协议类型和方法常量分别以 [`server/internal/protocol/acp.go`](../../../server/internal/protocol/acp.go) 和 [`server/internal/protocol/acp_const.go`](../../../server/internal/protocol/acp_const.go) 为代码侧依据；具体 provider 的转换与连接策略位于 `server/internal/hub/agent/`，不进入 Registry 或 Session 业务协议。

完整参考中标记为 unstable、特定工具版本、历史阶段或后续计划的内容不属于本页所述的当前稳定边界。

内置 ACP provider 为 codex、claude、copilot、opencode、mimo、codebuddy、flicker、kimi、qoder；统一以 `ACPProviderPreset` 声明启动方式，kimi 走官方 Kimi Code CLI 的 `kimi acp` 子进程，登录由用户在 CLI 侧自行完成，WheelMaker 不触发 device-code 授权。kimi CLI 的安装与更新纳入 Hub npm 管理（官方包 `@moonshot-ai/kimi-code`，缺 binary 时提示 `npm install -g`），不再指向原生安装脚本。qoder 走官方 Qoder CLI 的 `qodercli --acp` 子进程，登录同样由用户在 CLI 侧完成（`qodercli login` 或 `QODER_PERSONAL_ACCESS_TOKEN` 环境变量），安装与更新一并纳入 Hub npm 管理（官方包 `@qoder-ai/qodercli`）。

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

## WheelMaker 正式扩展

WheelMaker 只使用 ACP v1 规定的两类扩展点：数据放在 `_meta.wm`，自定义 JSON-RPC 方法和通知使用 `_wm/*`。扩展只有在 initialize 双向 capability 协商成功后才启用；未知 `_meta` 必须完整透传和保存，未知 `_wm/*` 按普通未知方法处理。

- `clientCapabilities._meta.wm` 与 `agentCapabilities._meta.wm` 分别声明双方支持的扩展版本；当前 `messageLifecycle`、`goalLifecycle`、`sessionActions` 均为 version 1。
- 消息继续使用标准 `agent_message_chunk` / `agent_thought_chunk`、单个 `content` 和可选 `messageId`。`_meta.wm.messagePhase`、`messageComplete`、`steered` 只补充生命周期，不替代标准内容。
- Codex/CX 收到原生 item completed 时，以相同 `messageId` 发送空文本标准 chunk，并用 `_meta.wm.messageComplete=true` 与权威 phase 完成已有消息；replay 则发送完整文本和完成标记。
- Goal 状态使用 `_wm/session/goal` notification；Steer、Compact、Goal、Fork、Archive 使用 `_wm/session/*` request。通用 Session 层通过已协商能力调用这些 request，不再依赖隐藏的 provider Go 可选接口。

扩展契约见 [`../../scope/2026-08-02-acp-extension-boundary-v27/spec-acp-extension-boundary-v27.md`](../../scope/2026-08-02-acp-extension-boundary-v27/spec-acp-extension-boundary-v27.md)。

## 内容、工具与权限

- `text` 和 `resource_link` 是基础 ContentBlock；`image`、`audio` 和嵌入式 `resource` 受 prompt capabilities 门禁。
- 工具调用使用 `tool_call` 建立，再通过 `tool_call_update` 更新。稳定状态集合是 `pending`、`in_progress`、`completed`、`failed`。
- Agent 可以通过 `session/request_permission` 请求用户授权；回合取消时，待处理的权限请求也必须得到取消结果。
- `session/request_permission.params` 包含 `sessionId`、`toolCall: ToolCallUpdate` 和 `options`。`toolCall` 是当前请求携带的操作详情，不要求 Client 把 permission 转换成 ToolCall，也不保证 `content` 是专门的问题字段。
- `plan` 和 `config_option_update` 携带完整快照，消费者应替换对应状态，不把它们当成增量 patch。
- `session/set_config_option` 使用 ACP v1 的判别式配置值，并以 `{configOptions:[...]}` 返回完整配置项列表。Mode 更新使用标准 `currentModeId` 与 `session/set_mode`，不保留私有或 legacy wire 字段。

### WheelMaker Request Permission

该行为由 [`../../scope/2026-07-21-request-permission/spec-request-permission.md`](../../scope/2026-07-21-request-permission/spec-request-permission.md) 定义。

- WheelMaker 对所有 provider 使用同一 permission 路径，不识别 Kimi `AskUserQuestion` 或其他 provider 私有工具名。
- Client 只从当前 request 投影 title、标准 text content 和 permission options；不关联已有 ToolCall，不保存完整 `ToolCallUpdate`、raw input/output 或富内容。
- permission request 在当前 prompt 中成为 `permission_request` turn；只有用户实际选择才产生 `permission_response` turn。两者是追加事件，UI 可以按 `permissionId` 折叠展示。
- 用户选择通过 WheelMaker Registry `session.permission.respond` 回到持有 ACP request 的 Hub Session；它不是新的 `session/prompt` 或 user message。
- prompt cancel 时，ACP waiter 返回 `cancelled`，但历史中不伪造用户 response；`prompt_done` 是未回答 permission 的 terminal 边界。
- Hub 重启不恢复旧 permission waiter。未完成 prompt tail 按 WheelMaker 现有 turn rollback 语义清理，session resume/load 不因历史 request 打开交互。

## WheelMaker 实现边界

- ACP wire DTO 只表达官方 v1 字段和正式扩展点；顶层对象及 `ContentBlock`、`ToolCallContent`、MCP Server、Session Config Option 等嵌套 union 都按 discriminator 严格解码。
- 文本消息只使用标准单个 `content` 与 `messageId`，工具更新只使用标准 `content: ToolCallContent[]`。`contentBlocks`、`clientMessageId`、`steered`、`toolCallContent`、`modeId` 等旧私有 wire 字段不再读写。
- `Artifacts`、`ForkPoint`、queue/Goal 状态和 WMT2 turn payload 属于 WheelMaker 内部模型，不伪装成 ACP 字段。真实 ACP 解码后先映射到 typed internal event，再进入 Session、Recorder 和 Registry。
- Agent/provider 层负责外部运行时与 ACP 的转换。Session、Registry 和 recorder 不应依赖 provider 私有 thread、turn 或 item 字段。
- ACP 负责 Agent 交互语义；App 侧跨机器路由、项目归属和 Session 事件广播属于 [Registry 协议](registry.md)。

### Claude-compatible provider 约定

`cc-deepseek`、`cc-glm`、`cc-kimi`、`cc-qwen`、`cc-flicker` 复用 `claude-agent-acp` 与 Claude Agent SDK，不在 WheelMaker 内重新实现 Anthropic Messages。它们是独立 ACP provider：使用不同的 Hub 本地 Key、Anthropic-compatible endpoint、模型来源和 `CLAUDE_CONFIG_DIR`，但继续复用 owned ACP process、权限请求、工具调用和通用 `configOptions` 链路。

- provider 只在 Hub 启动时、`claude-agent-acp` 与对应 Key 都存在时注册；Registry 只接收平铺的可用 agent ID，不接触 Key。
- 模型选择由 provider 注入 `availableModels` 和默认模型，App 不增加 provider 私有模型协议。
- `cc-kimi` 的模型白名单是 `k3[1m]`、`k3`、`kimi-for-coding`、`kimi-for-coding-highspeed`，默认 `k3[1m]`；`cc-glm` 的模型白名单是 `glm-5.2[1m]`、`glm-5.2`、`glm-4.7`、`glm-4.5-air`，默认 `glm-5.2[1m]`。Claude ACP 无法移除的 `Default` 条目仍可能出现，但会解析到对应 provider 默认模型。
- `cc-flicker` 连接由 Hub 托管的本地 Flicker Bridge（`http://127.0.0.1:17999`）。Hub 在 bridge 健康后缓存当前 `/v1/models`，启动 ACP 时将同一动态目录写入 `models`（展示元数据）和 `availableModels`（`claude-agent-acp` 的 ACP model config option 输入），同时注入 `env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`，不写 `enforceAvailableModels`。Default、Opus/Fable、Sonnet、Haiku 和 Subagent 都从当前目录选择有效 ID，模式切换后不得继续引用旧模式 ID；首选缺失时回退到目录内最强的实际 Claude 模型。模型顺序固定为 Claude、GPT、Kimi、GLM、DeepSeek，其他厂商按名称排列，`auto` 最后；厂商内部按能力从弱到强排列。Bridge 有两个互斥运行模式：V1 是 WheelMaker 当前内置的 Go MyFlicker 协议迁移实现；V2 是通过 Node 加载 npm `@myflicker/cli` AI SDK provider 的 Wanqing 出口。Hub 菜单选择并持久化模式，两个模式复用相同 endpoint、`cc-flicker` agent ID 和配置目录，同一时刻只有一个模式监听 17999。
- V1 模型选择跟随 bridge `/v1/models` 动态 catalog 全量展示（非 Claude 模型带 `CLAUDE-MYFLICKER-` 前缀 id）。Opus/Fable 映射到 `CLAUDE_OPUS_4_8`，Sonnet/Haiku/Subagent 映射到 `CLAUDE_4_6`，WheelMaker 侧不做 effort 归一化。V2 由 MyFlicker AI SDK 按模型选择 Anthropic、OpenAI 或 Responses 上游格式，并接受 canonical ID、MyFlicker alias，以及能由 `epModelName` 唯一对应的 V1 model ID；不存在或冲突的模型不得静默替换。
- V2 的请求拟真以 Claude Code 能力和缓存稳定为上限：只把版本化 allowlist 中精确匹配的 Claude Code 身份句替换为当前原生 MyFlicker 身份，不注入完整 MyFlicker prompt，也不按关键词删除、拆分、trim 或重组其余 system 内容。system string/text blocks、messages、tools 的顺序和 cache control 归属保持不变；模板未知时原样透传。
- V2 对当前请求建立无冲突的双向 tool-name 映射，覆盖 MyFlicker 已知的 Claude 工具别名，并在 tool choice、历史 tool use/result 和响应 tool call 中复用。只改变名称，不改变工具数量、顺序、description、schema、cache control 或 ID；未知工具、MCP 工具以及 MyFlicker 原生表标记 unsupported 但由 Claude Code 提供的工具继续原样透传。映射冲突时保留所有冲突项的原名，不删除 Claude Code 工具，也不添加其无法执行的 MyFlicker 专属工具。
- V2 请求字段按 Claude Code Anthropic JSON、AI SDK V3 参数和最终 Wanqing JSON 三层做脱敏归类。字段只有在 capture 证明语义丢失时才增加转换；MyFlicker provider 已生成的 endpoint、header、model 或 `output_config` 等内容不重复模拟，未知字段不整体塞入 `providerOptions`。响应除请求级工具名反向映射和协议封装外，不改写 text、reasoning、signature、usage 或 stop reason。
- Hub 使用 `hub-config.json` 的 `apiKeys.flicker`，未配置时自动使用 loopback-only 占位门禁 `00000000000000000000`，因此只要 `claude-agent-acp` 可用即可注册 `cc-flicker`；用户不需要在 UI 填写 MyFlicker Key。V1 把该值作为本地门禁，Claude Code 因而在两个模式下都可继续发送该 header。V2 不读取、不校验也不转发这个 fake key；其 `/v1/models`、`/v1/messages` 和 `/v1/messages/count_tokens` 只通过 loopback 暴露，真实万擎认证完全由 Node worker 内的 npm `@myflicker/cli` 执行 `login`、写入 login/userInfo context 并初始化 `wanqingPlugin` 获得。MyFlicker 凭证不离开 worker，WheelMaker 和 Claude Code 均不读取。运行中切换会重启 bridge 但不主动删除 `cc-flicker` Session；目标模式失败时 Hub 恢复原模式。
- 状态与上游 Session 分别位于各自的 `<stateDir>/.data/cc-*` 目录；历史、settings、agents、hooks、plugins 和认证配置继续相互隔离。唯一共享的用户配置是全局 Skills：每个 `cc-*` 的 `<configDir>/skills` 整目录链接到 `~/.claude/skills`，Windows 使用 Junction，其他平台使用目录符号链接。已有非空真实目录或指向其他位置的链接不会被覆盖，provider 启动会返回明确错误。
- Session 恢复以 agent ID 和各自 projects 目录为边界，不允许在 Claude、GLM、Kimi 间跨 provider 导入或恢复。
- App 可以把平铺 ID 投影为 Claude 主项旁的展开子项，但分组只属于展示层，不进入 ACP 或 Registry wire schema。

来源：[`../../scope/2026-07-23-claude-compatible-agents/spec-claude-compatible-agents.md`](../../scope/2026-07-23-claude-compatible-agents/spec-claude-compatible-agents.md)。

### Codex Responses provider 约定

`cx-deepseek` 是独立 ACP provider，复用原生 Codex App Server bridge，但使用 DeepSeek Responses 上游和独立 Codex home。协议、Session 与 Registry payload 始终保留稳定 agent ID `cx-deepseek`；`cx.deepseek` 仅是 App 展示名。它与原生 Codex 共用严格 ACP v1、`_meta.wm.messageLifecycle` 和 `_wm/*` 扩展，不引入 provider 私有根字段；现有 `model/list` 与标准 `configOptions` 链路继续作为模型和推理档位来源。

provider 只在 Hub 配置 DeepSeek Key 且本机 Codex CLI 满足最低版本时注册。Key、上游地址和模型 provider 设置属于 Hub 本地启动配置，不进入 ACP wire payload 或 Registry metadata。Session 恢复以 agent ID 和 `<stateDir>/.data/cx-deepseek` 为边界，禁止从原生 `codex` 或任意 `cc-*` provider 导入历史。

来源：[`../../scope/2026-07-31-cx-deepseek-codex-mode/spec-cx-deepseek-codex-mode.md`](../../scope/2026-07-31-cx-deepseek-codex-mode/spec-cx-deepseek-codex-mode.md)。

## 完整参考的使用方式

完整中文参考适合查阅字段示例、废弃 API 和来源链接，但其中的 unstable 草案、codex-acp 使用摘要、旧飞书阶段说明以及过期内部文件路径不能直接视为当前实现事实。需要更新本页时，应同时核对当前代码和上游稳定 schema。

来源：

- [`../../scope/2026-07-20-kimi-acp-provider/spec-kimi-acp-provider.md`](../../scope/2026-07-20-kimi-acp-provider/spec-kimi-acp-provider.md)
- [`../../scope/2026-07-21-request-permission/spec-request-permission.md`](../../scope/2026-07-21-request-permission/spec-request-permission.md)
- [`../../scope/2026-07-23-claude-compatible-agents/spec-claude-compatible-agents.md`](../../scope/2026-07-23-claude-compatible-agents/spec-claude-compatible-agents.md)
- [`../../scope/2026-07-28-flicker-bridge-mode-switch/spec-flicker-bridge-mode-switch.md`](../../scope/2026-07-28-flicker-bridge-mode-switch/spec-flicker-bridge-mode-switch.md)
- [`../../scope/2026-07-28-flicker-v2-request-parity/spec-flicker-v2-request-parity.md`](../../scope/2026-07-28-flicker-v2-request-parity/spec-flicker-v2-request-parity.md)
- [`../../scope/2026-07-31-cx-deepseek-codex-mode/spec-cx-deepseek-codex-mode.md`](../../scope/2026-07-31-cx-deepseek-codex-mode/spec-cx-deepseek-codex-mode.md)
- [`../../scope/2026-08-02-acp-extension-boundary-v27/spec-acp-extension-boundary-v27.md`](../../scope/2026-08-02-acp-extension-boundary-v27/spec-acp-extension-boundary-v27.md)
