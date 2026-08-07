> 由 scope skill 于 2026-08-02 生成

# ACP 正式扩展边界与 Registry 2.7

## 目标

WheelMaker 当前把官方 ACP wire 对象、Codex/CX DeepSeek 适配器事件、Session 业务事件和 WMT2 持久化对象混在同一组 Go 类型中。`SessionUpdate` 因而出现 `contentBlocks`、`clientMessageId`、`steered`、`toolCallContent`、`goal`、`turnId` 等非标准根字段；部分内部数据也借用 ACP JSON 形状进入 Session Recorder。这种结构虽然让内置适配器和外部 ACP Agent 暂时共用一条处理链，却无法从类型上保证 ACP 合规，也直接造成 CX DeepSeek 在 `item/completed` 后丢失权威 message phase、完成后工作内容不能稳定折叠的问题。

本次把边界硬切为“严格 ACP v1 wire + 正式 WheelMaker 扩展 + 独立内部事件/WMT2 类型”，同时把 Registry Protocol 升级到 `2.7`。升级后必须保留 Codex、CX DeepSeek、其他标准 ACP Agent、Steer、Goal、Tool Call、Session Load/Replay、搜索、Fork、导出和完成后工作折叠的完整可用性。

## 标准依据

实现以 2026-08-02 的 ACP v1 稳定协议为准：

- [ACP v1 Extensibility](https://agentclientprotocol.com/protocol/v1/extensibility)：所有协议类型通过 `_meta` 携带自定义数据；标准类型根级不得增加自定义字段；自定义方法/通知必须以 `_` 开头；扩展能力应在 capability 对象的 `_meta` 中声明。
- [ACP v1 Schema](https://agentclientprotocol.com/protocol/v1/schema)：消息 chunk 使用单个标准 `content` 与可选 `messageId`；Tool Call 使用标准 `content: ToolCallContent[]`；当前稳定 wire major version 为 `1`。

ACP v2 仍是 Draft，不进入本次实现。WheelMaker 只对当前已经使用的方法、通知和嵌套类型完成 v1 对齐，不以本次重构为由实现所有未使用的 ACP 可选能力。

## 决策

- ACP `protocolVersion` 保持官方稳定值 `1`，不得自行发布 WheelMaker ACP v2。
- WheelMaker Registry Protocol 从 `2.6` 硬切到 `2.7`；正常 App、Hub 与 Registry 必须配套升级，不提供 2.6 业务协议 fallback。
- ACP wire 类型与 WheelMaker 内部事件/WMT2 类型彻底拆分，不再使用一个宽泛 `SessionUpdate` 同时表达所有 update variant 和内部 side-band。
- ACP 标准类型根级只允许当前 v1 Schema 定义的字段。WheelMaker 语义只通过 `_meta.wm.*` 或 `_wm/*` 扩展承载。
- Steer、Compact、Goal、Fork、Archive 等 provider action 统一改为 capability-gated `_wm/*` JSON-RPC request，不再由 `Conn` 的 Go 可选接口作为隐藏 transport。
- 所有已实现 ACP 类型都显式保留原始 `_meta`；未知 namespace 和未知值不得因 decode、normalize、转发或持久化被删除。
- 新实现不读取、不发送旧的非标准 ACP 根字段，不双写，不提供旧 Agent wire fallback。
- 历史 WMT2 继续读取。WMT2 是 WheelMaker 内部存储格式，不属于 ACP wire；保留旧历史可读性不视为兼容旧 ACP 实现。
- Codex 和 CX DeepSeek 共用同一严格 ACP 投影与测试路径；外部标准 ACP Agent 进入同一 wire decoder，避免内置和外部两套语义漂移。
- 完成后工作折叠改为能力驱动。内置 Codex/CX DeepSeek 声明 message lifecycle 能力；其他 Agent 声明同一能力后可获得相同行为，不再依赖 provider 名称硬编码。

## 分层架构

```text
External ACP Agent ──JSON-RPC──┐
                              ├─> strict ACP v1 decoder
Codex/CX bridge ──ACP encoder─┘          │
                                         v
                              Agent internal events/outcomes
                                         │
                                         v
                               Session business lifecycle
                                         │
                                         v
                         Session Recorder + WMT2 internal turns
                                         │
                                         v
                              Registry 2.7 session projection
                                         │
                                         v
                                   Workspace App
```

### 严格 ACP Wire 类型

ACP update 使用按 `sessionUpdate` 判别的 variant 类型，而不是所有字段并列的宽结构。每个 variant 只能序列化自己的标准字段与 `_meta`。例如 message chunk、tool call、plan、session info、usage 各自使用独立 DTO。

同样的约束适用于嵌套 union：ContentBlock、ToolCallContent、MCP Server、Session Config Option 和 Set Config Value 必须按 discriminator 使用严格 variant，不保留“所有可能字段并列”的 wire struct。WheelMaker 可以在 decoder 之后投影成便于业务使用的内部 normalized type，但内部类型不得直接 marshal 为 ACP。

外部 Agent 的 JSON-RPC notification 先解码成严格 wire variant，再投影成内部事件。Codex/CX bridge 也必须先生成严格 wire 对象并经过同一投影入口；不得直接构造带内部字段的 `SessionUpdate` 绕过边界。

初始化、Session request/response、capability、ContentBlock、ToolCallContent、PlanEntry 等已实现协议类型都增加统一 raw metadata carrier。完整保存指 JSON 对象语义完整，不要求保留原始空白或对象 key 顺序。

实现前必须对仓库已表示的 ACP v1 类型逐项对照当前 Schema，而不只删除本 spec 表格列出的私有字段。尤其需要把 Session Config Option/Set Response 更新到当前 discriminated union 与 wrapper response、把 AvailableCommand input 更新到标准形状，并清除 bare array response 等旧兼容解析。对 WheelMaker 尚未实现的可选 ACP 方法，只保留 capability 为 unsupported，不扩张本次产品范围。

### WheelMaker 内部类型

以下数据属于内部业务或存储模型，不是 ACP wire：

- prompt queue 的 `clientMessageId` 与 enqueue/steer 归因；
- WMT2 用户消息的多 `contentBlocks` 聚合与 `steered` 展示标记；
- Prompt 的 Artifact、ForkPoint 和本地失败信息；
- Goal snapshot、Goal turn 状态与 Session summary；
- Session Recorder 的 turn key、turnIndex、完成状态与时间戳。

Session 不再为了记录 prompt request/result 而构造“看起来像 ACP”的任意 JSON。它直接发送 typed internal event 给 Recorder；只有真实经过 ACP connection 的消息才使用 ACP wire DTO。

## ACP 字段清理

| 当前写法 | 2.7 写法 |
| --- | --- |
| message update 根级 `contentBlocks` | 每个标准 `user_message_chunk` 携带一个 `content`；同一消息共享 `messageId`，Recorder 聚合为内部多 block turn |
| message update 根级 `clientMessageId` | 使用标准 `messageId` 做 wire 关联；queue client ID 只保留在内部事件/WMT2 |
| message update 根级 `steered` | `_meta.wm.steered: true` |
| tool update 根级 `toolCallContent` | 标准 `content: ToolCallContent[]` |
| `goal_updated`、`goal_cleared`、`goal_turn_*` sessionUpdate | `_wm/session/goal` 自定义通知 |
| 标准 SessionUpdate 上的 `goal`、`turnId` | `_wm/session/goal` 自定义 params；内部再投影成 Goal event |
| `SessionNewResult.title` | 标准 `session_info_update.title` |
| `SessionPromptResult.message` | 补充说明放 response `_meta.wm.message`；真实运行失败走 JSON-RPC error 和内部 failure outcome |
| 自定义 StopReason `failed` | 删除；wire 只接受 ACP v1 标准 StopReason，运行失败不得伪装成 stop reason |
| `current_mode_update.modeId` | 标准 `currentModeId` |
| `agentCapabilities.mcp` | 标准 `mcpCapabilities` |
| `usage_update.updatedAt` | wire 不发送该非标准字段；Recorder 使用事件接收时间，必要的 Agent 时间只可放 `_meta` |
| Prompt Result 上的 `Artifacts` / `ForkPoint` side-band | 移入内部 PromptOutcome，不属于 ACP response 类型 |

删除宽结构后，message chunk 不再可能意外带 `status/title`，usage update 不再可能带 tool 字段，新的非标准根字段也不能仅靠增加一个 Go struct field 混入 wire。

## WheelMaker 扩展能力

WheelMaker namespace 固定为 `_meta.wm`。WheelMaker Client 在 `clientCapabilities._meta.wm` 声明可消费的扩展 version：

```json
{
  "clientCapabilities": {
    "_meta": {
      "wm": {
        "messageLifecycle": {"versions": [1]},
        "goalLifecycle": {"versions": [1]},
        "sessionActions": {"versions": [1]}
      }
    }
  }
}
```

Agent 只有在双方都声明同一 version 时才发送对应扩展语义。

内置 Codex/CX DeepSeek 在 initialize response 中声明：

```json
{
  "agentCapabilities": {
    "_meta": {
      "wm": {
        "messageLifecycle": {
          "version": 1,
          "phases": ["commentary", "final_answer"],
          "completion": true,
          "steered": true
        },
        "goalLifecycle": {
          "version": 1,
          "notification": "_wm/session/goal"
        },
        "sessionActions": {
          "version": 1,
          "steer": true,
          "compact": true,
          "goal": true,
          "fork": true,
          "archive": true
        }
      }
    }
  }
}
```

规则：

- 未声明 capability 时，WheelMaker 仍完整保存 `_meta`，但不得假设 Agent 会发送对应扩展语义。
- Client 或 Agent 任一侧未声明对应 version 时，该扩展视为不可用；ACP 核心连接仍可继续。
- Session 把已识别能力投影并持久化为 Registry 2.7 的 `sessionFeatures.messageLifecycle: {version: 1}`。普通 Session summary、Session read 与新归档 manifest/read 都保留该 feature，App 与归档预览据此决定是否启用完成工作折叠。
- 未识别的 `_meta.wm` 子字段与其他 namespace 一样保留，不自动获得业务含义。

## Message Lifecycle

### 流式 chunk

Agent message 使用标准 `messageId` 和 `_meta.wm.messagePhase`：

```json
{
  "sessionId": "session-1",
  "update": {
    "sessionUpdate": "agent_message_chunk",
    "content": {"type": "text", "text": "正在检查代码……"},
    "messageId": "message-1",
    "_meta": {
      "wm": {"messagePhase": "commentary"}
    }
  }
}
```

`messagePhase` 当前只解释 `commentary` 与 `final_answer`。未知值完整保存但不参与折叠判断。

### 权威完成标记

`item/completed` 是 Codex App Server 对 message phase 的权威来源。为了在不延迟实时 delta、不重复正文的前提下更新消息 metadata，Codex/CX bridge 为同一 `messageId` 发送一个标准空文本 chunk：

```json
{
  "sessionId": "session-1",
  "update": {
    "sessionUpdate": "agent_message_chunk",
    "content": {"type": "text", "text": ""},
    "messageId": "message-1",
    "_meta": {
      "wm": {
        "messagePhase": "final_answer",
        "messageComplete": true
      }
    }
  }
}
```

Recorder 将该 chunk 视为同一消息的 metadata update：不追加可见文本，不新建 assistant row，使用 completed item 的有效 phase 覆盖该消息的非权威 phase，并把 `messageComplete` 保存到 WMT2。completed item 的 phase 缺失或未知时只写完成标记、保留此前有效 phase，不把它清空。完成后才释放 `(turnId, itemId) -> message lifecycle` 状态；晚到 delta 不得重新打开已完成消息。

Session Load replay 对每个完整 Agent item 使用其原生 item ID 作为 `messageId`，一次发送正文并同时携带 `messageComplete: true`，无需额外空 chunk。

### Steered 用户消息

Steer 接受后的每个标准 `user_message_chunk` 使用 queue item/client ID 作为共同 `messageId`，每个 chunk 只携带一个标准 `content`。最后一个真实 block 携带：

```json
{
  "wm": {
    "steered": true,
    "messageComplete": true
  }
}
```

Recorder 按 `messageId` 依次聚合 text、image、resource 与 resource_link，生成一个内部 WMT2 用户 turn，并继续保存 `clientMessageId` 与 `steered`，保证刷新、搜索、Fork、附件复制与 UI 标记不退化。

### Metadata 合并

- 有 `messageId` 时，method + messageId 是 message turn 的关联键；无 ID 的标准外部 Agent 继续按相邻 chunk 处理，但不能使用 metadata-only completion patch。
- 同一消息的 `_meta` 以 JSON object 深合并：对象递归合并，incoming scalar/array 覆盖同 key 旧值，未出现的未知 key 保留。
- `messageComplete: true` 与 completed item 的 `messagePhase` 是权威终态，不允许后续非权威 chunk 回退。
- WMT2 保存合并后的完整 `_meta`、`messageId` 和内部展示字段。旧 WMT2 没有 messageId/phase 时继续使用现有最终回答 fallback。

## Goal Lifecycle

Goal 不再伪装成 `session/update` variant。统一使用 ACP 自定义 notification：

```json
{
  "jsonrpc": "2.0",
  "method": "_wm/session/goal",
  "params": {
    "sessionId": "session-1",
    "event": "updated",
    "goal": {"id": "goal-1", "status": "active"},
    "_meta": {"wm": {"goalLifecycleVersion": 1}}
  }
}
```

`event` 只允许：

- `updated`：必须携带完整 Goal snapshot；
- `cleared`：不得携带 Goal snapshot；
- `turn_started`：必须携带 `turnId`；
- `turn_completed`：必须携带 `turnId`。

Instance 只在 Agent 声明 `goalLifecycle.version: 1` 后解释该通知。未知 `_wm/*` notification 按 ACP 规则忽略；已声明但 payload 非法的 Goal notification 记录可诊断错误，不污染 Session Goal 状态。Registry 面向 App 的 `session.goal.*` 方法、Session summary 和 Goal UI 保持 provider-neutral，不暴露 ACP 扩展方法名。

## Provider Action 扩展

当前 `SessionSteerer`、`SessionCompactor`、`SessionGoalController`、`SessionForker`、`SessionArchiver` 等 `Conn` type assertion 属于隐藏 transport。2.7 后，Session 仍调用 provider-neutral 的 typed Instance 方法，但 Instance 必须把它们映射为以下 ACP 自定义 request：

| 能力 | ACP request | 核心 params/result |
| --- | --- | --- |
| Steer | `_wm/session/steer` | `sessionId`、稳定 `messageId`、`prompt: ContentBlock[]`；返回可选 provider `turnId` |
| Compact | `_wm/session/compact` | `sessionId`；request 在 compact 成功或失败后结束 |
| Goal Set | `_wm/session/goal/set` | `sessionId` 与完整目标配置；返回权威 Goal snapshot |
| Goal Get | `_wm/session/goal/get` | `sessionId`；返回 Goal snapshot 或空结果 |
| Goal Clear | `_wm/session/goal/clear` | `sessionId`；返回成功结果，后续状态仍以 Goal notification 为权威 |
| Fork Resolve | `_wm/session/fork/resolve` | `sessionId` 与内部 prompt 序列；返回 turnIndex 到 provider ref 的映射 |
| Fork | `_wm/session/fork` | `sessionId`、provider ref 与 prompt 序列；返回新 sessionId/title/ref |
| Archive | `_wm/session/archive` | `sessionId`、`archived: boolean` |

这些 request 的 params/result 是 WheelMaker 自定义类型，可以定义自身根字段，但都必须带可选 `_meta`。Instance 只在 `agentCapabilities._meta.wm.sessionActions` 对应布尔能力为 true 且 version 为 1 时调用；否则返回现有 provider-neutral unsupported 结果。Provider 的 inactive、busy、unavailable 与 invalid request 使用稳定的 JSON-RPC error data code，Session queue 的 Steer fallback 和 Retry 继续依据 typed internal error 分类工作。

内置 Codex/CX bridge 在自身 JSON-RPC dispatcher 中实现这些 `_wm/*` request；外部 Agent 可以按相同能力契约接入。实现完成后删除 `Conn` 级 action type assertion，避免内置 Agent 拥有外部 ACP Agent 无法使用的旁路功能。Registry 的 `session.queue`、`session.goal.*`、`session.fork` 和 archive 方法保持不变，只在 Hub 内映射到对应 Agent extension。

## Session 标题、早期通知与 Prompt 失败

删除 `session/new` response 的非标准 `title`。Codex/CX 在创建 thread 后发送标准 `session_info_update`；Instance 在 Session callback 尚未绑定时按 connection 顺序暂存 session-scoped notification，`SetCallbacks` 后再 flush，避免新建阶段标题或 Goal 通知丢失。暂存必须有数量/生命周期边界，并在连接关闭或 Session 创建失败时清理。

Prompt 正常结束只返回标准 `stopReason`。refusal/cancelled 等需要补充可读说明时可以使用 response `_meta.wm.message`；transport、runtime 或 Agent 执行失败使用 JSON-RPC error。Agent 层把 wire response/error 统一投影成内部 PromptOutcome，Session Recorder 继续生成现有成功、取消或失败的 `prompt_done`/failure turn，错误文本和 Retry UI 不退化。

## Tool Call 与内容保留

Tool Call/Tool Call Update 统一使用标准 `content`。严格 decoder 根据 `sessionUpdate` 把同名 `content` 解码为 `ContentBlock` 或 `ToolCallContent[]`，不再为避免 Go 字段类型冲突创造 `toolCallContent` alias。

内部 tool event 与 WMT2 tool payload 保留当前 UI 所需的 title/kind/status，并完整保留标准 content、locations、rawInput、rawOutput 与 `_meta`。Workspace App 可以继续只显示现有 Tool Group；未展示字段仍可用于 replay、诊断和后续功能，不在 ACP→Recorder 边界丢失。

## Registry Protocol 2.7

`DefaultProtocolVersion` 与 Web `RegistryProtocolVersion` 同时升级为 `2.7`。

2.7 的 Session projection 增加 provider-neutral `sessionFeatures.messageLifecycle: {version: 1}`，使新 Session 不再通过 `agentType === codex/cx-deepseek` 决定折叠。WMT2 turns 继续通过现有 `session.message` / `session.read` 传输，新增的 messageId、完整 metadata 和 tool content 是 2.7 契约的一部分。旧 WMT2/归档缺失 `sessionFeatures` 时，只允许历史读取路径继续用已有 codex/cx-deepseek fallback；新建与实时 Session 不使用该 provider fallback。

兼容策略：

- Registry 拒绝 2.6 App 的正常连接。
- 2.6 Hub 不获得 Project/Session 等业务能力，但保留既有 `update_only` 维护子协议，只允许查询并触发 WheelMaker Update；升级到 2.7 后重新建立完整连接。
- 2.7 App、Hub 与 Registry 不为 2.6 payload 或旧 Session feature 提供业务 fallback。
- 不修改 WMT2 文件 major version；新字段为内部 turn 的可选增量，历史读取器继续接受缺失字段。

推荐发布顺序是 Registry → Hub → App。Registry 升级后旧 Hub 只能 update-only；Hub 升级后恢复完整业务；旧 App 必须刷新/升级后才能连接。

## 不兼容清单

新版本明确不再接受或产生：

- `session/update.update.contentBlocks`；
- `session/update.update.clientMessageId`；
- `session/update.update.steered`；
- `session/update.update.toolCallContent`；
- `session/update.update.goal` / `turnId` 与 `goal_*` discriminator；
- `session/new` result 的 `title`；
- `session/prompt` result 的根级 `message`；
- StopReason `failed`；
- `current_mode_update.modeId`；
- `agentCapabilities.mcp`；
- `usage_update.updatedAt`。

依赖这些 WheelMaker 私有 wire 字段的独立旧 Agent 必须随版本升级；标准 ACP Agent 不受这份旧字段清单影响。

## 功能验收

- Codex 与 CX DeepSeek 运行期间的 Commentary、Thinking、Tool Call、流式文本与当前 UI 一致；`prompt_done` 后工作区默认折叠，Final Answer 保持在外。
- Codex/CX 的 `item/completed.phase` 能通过相同 messageId 权威更新既有消息；不重复文本、不出现空 assistant row、不因先清理 phase cache 而把 Final Answer 误记成 Commentary。
- Session Load/Replay 与实时流产生一致的 phase、messageComplete、messageId 和折叠结果。
- 声明 message lifecycle v1 的第三方标准 ACP Agent 可获得相同折叠；未声明的 Agent 保持原展示。
- Steer 的文本、图片、附件和 resource link 仍聚合为一个用户 turn；queue item 正确完成，刷新、搜索、Fork 和附件复制可用。
- Goal create/get/update/stop/clear、自动 turn 生命周期、Session summary 与 UI 状态在 `_wm/session/goal` 迁移后完整可用。
- Steer、Compact、Goal、Fork 与 Archive 都通过已声明的 `_wm/*` request 工作；外部 Agent 可按同一 capability 契约接入，Conn 不再有 action transport 旁路。
- Session 新建和 Load 期间的 title/Goal 等早期 notification 不丢失且保持原始顺序。
- Tool Call 的标准 content、locations、rawInput、rawOutput 与 `_meta` 经过实时、持久化和 read-back 后不丢失；现有 Tool Group 视觉行为不退化。
- Prompt 成功、refusal、cancelled、runtime failure 和连接中断都生成正确内部终态、文案、Retry 与 queue 调度结果。
- 外部 ACP Agent 发送标准 message/tool/plan/config/session info/usage update 时可以正常处理；未知 `_meta` 完整 round-trip，未知 `_wm/*` notification 被安全忽略。
- 所有内置 ACP emitter 的 JSON shape 测试证明没有非标准根字段；新增字段必须先归类为 ACP 标准、`_meta`、`_wm/*` 或内部类型。
- Registry 2.7 App/Hub 正常连接；2.6 App 被拒绝；2.6 Hub 仅能 update-only 并可完成升级。

### 测试范围

- Protocol：严格 variant encode/decode、标准字段 allowlist、`_meta` 全类型 round-trip、messageId、Tool Call content、currentModeId、mcpCapabilities、标准 StopReason。
- Extension：capability decode/version gating、message lifecycle metadata 深合并、未知 namespace 保留、未知 `_wm/*` ignore、Goal payload 校验。
- Provider Action：每个 `_wm/*` request 的参数、响应、错误分类、capability gating，以及删除 Conn type-assertion 旁路。
- Codex/CX Adapter：started/delta/completed 权威 phase、completion marker、late delta、无正文 item、replay、Steer 多 block、Goal notification、标题通知和 Prompt error。
- Instance：外部与内置进入同一 decoder、早期 notification buffer/flush/cleanup、非法 wire 不进入 Session。
- Session/Recorder：typed internal event、messageId merge、metadata-only completion、完整 tool content、Steer dedup、Goal lifecycle、WMT2 旧历史读取与新历史 read-back。
- Web：capability-driven completed work、实时视图不变、成功/失败/停止折叠、Final Answer 分离、旧 WMT2 fallback、搜索/跳转/Fork/导出回归。
- Registry：2.7 handshake、2.6 App reject、2.6 Hub update-only、Session feature/turn projection。
- 完成前运行相关 Go package tests、`go test ./...`、Web Jest、TypeScript typecheck 和 production build。

## 范围之外

- 实现 ACP v2 Draft。
- 一次性补齐 ACP v1 所有当前未使用的可选方法、Elicitation 或新 Session lifecycle 能力。
- 把 Goal 提交为 ACP 核心标准。
- 改写或迁移既有 WMT2 历史文件。
- 保留旧私有 ACP wire 字段的 reader、dual-write 或版本协商 fallback。
- 改变完成折叠栏、Thinking、Tool Group 的既定视觉设计。
- 自动发布 WheelMaker 产品版本；本 spec 只定义 Registry/ACP 协议版本与实现边界。
