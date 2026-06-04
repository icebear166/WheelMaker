# OpenAI-Compatible Chat Agent 协议与接入计划

更新日期：2026-06-04  
状态：设计落地，待实现  
目标 agent 名称：`chat`

本文定义 WheelMaker `chat` agent 对接 Chat2API 的 OpenAI-compatible HTTP 协议子集，以及它如何接入当前 WheelMaker ACP agent 系统。

## 1. 资料来源

官方协议依据：

- OpenAI OpenAPI spec `2.3.0`，base URL `https://api.openai.com/v1`。
- `POST /chat/completions`：官方仍支持 Chat Completions，但官方文档提示新项目优先考虑 Responses API。
- `GET /models`、`GET /models/{model}`：模型列表与单模型查询。
- `POST /completions`：legacy completions API，仅作为兼容参考。
- OpenAI Function Calling guide：tool calling 是应用侧多步循环，不是模型自动执行工具。

本地实现依据：

- Chat2API `src/main/proxy/routes/chat.ts`：`POST /v1/chat/completions`。
- Chat2API `src/main/proxy/routes/models.ts`：`GET /v1/models` 与 `GET /v1/models/:model`。
- Chat2API `src/main/proxy/routes/completions.ts`：legacy `POST /v1/completions`。
- Chat2API `src/main/proxy/types.ts`：当前兼容请求、响应、tool call、`reasoning_content` 扩展字段。
- WheelMaker `docs/architecture-3.0.md` 与 `docs/codex-app-server-acp-bridge.zh-CN.md`：agent 层协议转换边界。

## 2. 设计结论

`chat` 不是新的业务 Session 系统。它是一个 WheelMaker agent provider，对上实现 `server/internal/hub/agent.Instance`，对下调用 Chat2API 的 OpenAI-compatible HTTP API。

WheelMaker 继续保持当前边界：

```text
Registry -> Client -> Session -> AgentInstance(chat) -> Chat2API HTTP API
```

核心规则：

1. WheelMaker Session ID 仍然是 App/Registry 的唯一会话身份。
2. `chat` agent 的 ACP session ID 可以直接使用 WheelMaker 分配给该 agent 的 session ID。
3. Chat2API 不拥有 WheelMaker Session，不参与 Registry 同步，不写 WheelMaker turn。
4. `chat` adapter 只在 agent 层做 OpenAI HTTP 与 ACP event 的转换。
5. 第一版不发送 OpenAI `tools`，不执行、不展示、不回灌 tool calls。
6. 第一版只支持文本输入输出，图片、音频、resource link、MCP 全部不声明 capability。

## 3. 接口选择

### 3.1 必接接口

| 接口 | 来源 | 用途 | 实现阶段 |
|---|---|---|---|
| `GET /health` | Chat2API extension | 依赖探活，提示用户 Chat2API 未启动 | Phase 1 |
| `GET /v1/models` | OpenAI-compatible | 生成 ACP `model` config option 候选列表 | Phase 1 |
| `GET /v1/models/{model}` | OpenAI-compatible | 可选模型校验，模型列表失败时不阻塞发送 | Phase 2 |
| `POST /v1/chat/completions` | OpenAI Chat Completions | 唯一推理接口，默认 `stream: true` | Phase 1 |

### 3.2 暂不接接口

| 接口 | 原因 |
|---|---|
| `POST /v1/completions` | legacy API；Chat2API 内部已转换到 chat request，`chat` agent 无需使用。 |
| `GET /v1/chat/completions` | 官方 stored completions 查询；Chat2API 未实现，WheelMaker 不需要。 |
| `GET /v1/chat/completions/{id}` | 同上。 |
| `GET /v1/chat/completions/{id}/messages` | 同上。 |
| `/v1/responses` | Chat2API 当前未暴露；引入后会改变状态和 tool 语义。 |
| Chat2API management API | proxy 未运行时不可用，不能作为冷启动依赖；第一版不管理账号、provider、proxy 生命周期。 |

## 4. OpenAI-compatible HTTP 协议子集

### 4.1 Base URL 与认证

默认 base URL：

```text
http://127.0.0.1:8080/v1
```

请求头：

```http
Content-Type: application/json
Accept: application/json
Authorization: Bearer <api-key>
```

规则：

- `Authorization` 仅在 WheelMaker 配置了 API key 时发送。
- Chat2API 允许未开启 API key 的本地模式；adapter 不强制 key。
- Phase 1 不读取或修改 Chat2API management API 的 API key 配置。

### 4.2 Chat Completions 请求

`chat` agent 第一版发送的最小请求：

```json
{
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "Optional adapter-level instruction." },
    { "role": "user", "content": "Hello" }
  ],
  "stream": true
}
```

字段规则：

| 字段 | 发送策略 |
|---|---|
| `model` | 必填。来自 `model` config option、环境变量或默认值。 |
| `messages` | 必填。由 `chat` agent 自己维护的 OpenAI message log 生成。 |
| `stream` | Phase 1 固定 `true`；非流式只作为 fallback。 |
| `temperature`、`top_p`、`max_tokens`、`stop` | Phase 1 不暴露；后续可作为 pass-through config。 |
| `reasoning_effort` | Phase 2 暴露，取值先限制为 `low`、`medium`、`high`。 |
| `web_search` | Phase 2 暴露为 `off/on` 配置，必要时也可用 `X-Web-Search` header。 |
| `web_search_options` | Phase 2 以后再设计。 |
| `tools` | 不发送。 |
| `tool_choice` | 不发送；如实现需要强约束，可发送 `"none"`。 |
| `tool_format` | 不发送。 |

兼容性说明：

- OpenAI 新文档示例包含 `developer` role，但 Chat2API 当前 `ChatMessage.role` 只声明 `system | user | assistant | tool`。第一版使用 `system`，不发送 `developer`。
- Chat2API 支持 content array 中的 `text` 与 `image_url`，但第一版 `chat` agent 不声明 image capability，因此只发送字符串 content。

### 4.3 Message log

OpenAI Chat Completions 是 caller-supplied history 模型：每次请求需要调用方提供本轮所需上下文。ACP `session/prompt` 只包含本次用户 prompt，因此 `chat` agent 必须自己维护 provider-side message log。

Phase 1 采用 agent 层持久化：

```text
~/.wheelmaker/db/session/<project>/<session>/agent/chat/messages.json
```

建议 JSON 形状：

```json
{
  "version": 1,
  "sessionId": "acp-session-id",
  "model": "deepseek-chat",
  "messages": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi." }
  ],
  "updatedAt": "2026-06-04T00:00:00Z"
}
```

规则：

1. `session/new` 创建空 message log。
2. `session/load` 读取 message log；不存在时创建空 log。
3. `session/prompt` 先追加 user message，再请求 Chat2API。
4. 上游正常完成后追加 assistant message。
5. 上游失败、取消、tool call 不支持时，不追加 assistant message。
6. 不读取 SessionRecorder turn，不把其他 agent 的历史自动注入 `chat`。
7. 删除 WheelMaker session 时，`CleanupSessionArtifacts` 需要删除 `chat` 的 message log。

这样做的代价是 `chat` 与 `codex`、`claude` 一样拥有各自 provider history。跨 agent 历史共享不属于第一版。

### 4.4 Streaming 响应

Chat Completions streaming 使用 SSE：

```text
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

解析规则：

1. 只处理 `data:` 行。
2. 空行表示一次 SSE event 结束。
3. `data: [DONE]` 表示流结束。
4. 每个 JSON event 读取 `choices[0]`；多 choice 不支持，忽略 `index != 0`。
5. `delta.content` 追加到当前 assistant buffer，并转成 ACP `agent_message_chunk`。
6. `delta.reasoning_content` 是 Chat2API 扩展字段；如非空，转成 ACP `agent_thought_chunk`。
7. `delta.tool_calls` 不处理。第一版如果收到 tool call delta，记录为不支持状态并停止本轮。
8. 最后一个非空 `finish_reason` 决定 ACP `stopReason`。

ACP chunk 形状：

```json
{
  "sessionId": "acp-session-id",
  "update": {
    "sessionUpdate": "agent_message_chunk",
    "content": { "type": "text", "text": "Hello" }
  }
}
```

### 4.5 Non-stream 响应

非流式响应作为 fallback：

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1741569952,
  "model": "deepseek-chat",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 19,
    "completion_tokens": 10,
    "total_tokens": 29
  }
}
```

转换规则：

- `message.content` 作为单个 `agent_message_chunk` 发出。
- `message.reasoning_content` 如存在，作为单个 `agent_thought_chunk` 发出。
- `message.tool_calls` 不处理，按不支持 tool call 结束。
- `usage` 可在 Phase 2 转成 ACP `usage_update`。

### 4.6 Finish reason 映射

| OpenAI `finish_reason` | ACP `stopReason` | 规则 |
|---|---|---|
| `stop` | `end_turn` | 正常完成。 |
| `length` | `max_tokens` | 上游到达 token 限制。 |
| `content_filter` | `refusal` | 内容被过滤。 |
| `tool_calls` | `failed` | 第一版禁用 tool call，返回清晰不支持消息。 |
| `null` 且 SSE 正常 `[DONE]` | `end_turn` | 兼容部分 provider 漏 finish reason。 |
| HTTP context cancelled | `cancelled` | `session/cancel` 或上层 context 取消。 |
| HTTP/API error | `failed` | 返回 sanitized error message。 |

### 4.7 错误响应

OpenAI-compatible 错误形状：

```json
{
  "error": {
    "message": "No available account for model: deepseek-chat",
    "type": "service_unavailable_error",
    "param": null,
    "code": "no_available_account"
  }
}
```

adapter 规则：

- 保留 `message`、`type`、`code`，但不要输出 token、cookie、Authorization header。
- `401`、`403`：认证失败，`stopReason=failed`。
- `404` 且来自 `/models/{model}`：模型不可用，可提示用户切换模型。
- `429`、`503`：provider 暂不可用，`stopReason=failed`。
- 网络连接失败：提示 Chat2API base URL 与 proxy 是否启动。

## 5. Tool call 屏蔽策略

官方 Function Calling 是五步应用侧循环：

1. 应用把 `tools` 传给模型。
2. 模型返回 tool call。
3. 应用执行本地工具。
4. 应用把 tool output 回传给模型。
5. 模型继续输出最终回答或更多 tool calls。

`chat` agent 第一版不做这个循环。

强约束：

- 不声明 ACP tool capability。
- 不发送 OpenAI `tools`。
- 不发送 MCP servers 到 Chat2API。
- 不把 OpenAI `tool_calls` 映射为 ACP `tool_call`。
- 不触发 `session/request_permission`。
- 不执行文件系统或终端工具。

如果上游仍返回 `tool_calls`：

1. 终止本轮 OpenAI message log 的 assistant 追加。
2. 返回 `SessionPromptResult{stopReason:"failed", message:"chat agent does not support tool calls"}`。
3. 记录 provider 原始 tool call 到 debug log 时必须对参数中的潜在 secrets 做脱敏处理。默认不写完整 arguments。

## 6. ACP 接入设计

### 6.1 Provider 注册

新增 provider：

```go
const ACPProviderChat ACPProvider = "chat"
```

需要更新：

- `server/internal/protocol/acp_const.go`
  - `ACPProviderChat`
  - `acpProviders`
  - `ParseACPProvider`
- `server/internal/hub/agent/factory.go`
  - `newACPFactoryWithDefaults` 注册 `chat`
  - `PreferredName` 把 `chat` 放在现有 coding agents 之后，避免变成默认首选
- `server/internal/hub/agent/skills.go`
  - `chat` 返回空 skills，不扫描 Codex/Claude skills

注册策略：

- `chat` 可无条件注册，因为它不依赖本地 CLI binary。
- Chat2API 未启动不是注册失败，而是 prompt/health 阶段的运行时错误。

### 6.2 Instance 实现方式

建议直接实现 `agent.Instance`，不要伪造 `agent.Conn`。

原因：

- `agent.Conn` 在当前架构中是 transport-only ACP 连接，业务转换不应放进去。
- Chat2API 是 HTTP JSON/SSE API，不是 ACP JSON-RPC subprocess。
- direct `chatInstance` 可以在 agent 层保留 ACP 语义，同时避免把 HTTP request 伪装成 raw ACP transport。

建议文件：

| 文件 | 职责 |
|---|---|
| `server/internal/hub/agent/chat_agent.go` | 实现 `Instance`，负责 ACP lifecycle 与 callbacks。 |
| `server/internal/hub/agent/chat_openai_client.go` | HTTP client、SSE parser、error mapping。 |
| `server/internal/hub/agent/chat_openai_types.go` | OpenAI-compatible request/response structs。 |
| `server/internal/hub/agent/chat_message_store.go` | agent 层 message log 持久化。 |
| `server/internal/hub/agent/agent_test.go` | 延续现有包测试，不新增外部 test package。 |

### 6.3 Initialize

返回：

```json
{
  "protocolVersion": 1,
  "agentCapabilities": {
    "loadSession": true,
    "promptCapabilities": {
      "image": false,
      "audio": false,
      "embeddedContext": false
    }
  },
  "agentInfo": {
    "name": "chat",
    "title": "Chat",
    "version": "1"
  }
}
```

规则：

- 必须声明 `loadSession=true`，因为当前 `client.Session.ensureReady` 要求 agent 支持 load。
- 不声明 `sessionCapabilities.list`。
- 不声明 MCP capability。
- `ListSkills` 返回空列表。

### 6.4 SessionNew / SessionLoad

`session/new`：

1. 生成或接受当前 ACP session ID。
2. 初始化空 message log。
3. 返回 `sessionId` 与 config options。

`session/load`：

1. 绑定传入 `sessionId`。
2. 读取 message log，不向 SessionRecorder replay 历史。
3. 返回 config options。

说明：ACP 完整语义通常要求 load 通过 `session/update` replay provider 历史。`chat` 的历史已由 WheelMaker SessionRecorder 渲染，agent message log 只用于下一次 OpenAI request 上下文，所以第一版不 replay，避免重复显示历史。

### 6.5 SessionPrompt

流程：

```text
SessionPrompt
  -> validate only text prompt blocks
  -> append user message to message log in memory
  -> POST /v1/chat/completions stream=true
  -> parse SSE
  -> emit ACP session/update chunks
  -> append assistant message on success
  -> persist message log
  -> return SessionPromptResult
```

并发与取消：

- 依赖 `client.Session.promptMu` 保证同一 WheelMaker Session 内 prompt 串行。
- `chatInstance` 仍需 per-session in-flight cancel map。
- `SessionCancel` 调用当前 HTTP request cancel function。
- cancel 后 `SessionPrompt` 返回 `stopReason=cancelled`，不返回 error。

### 6.6 SessionSetConfigOption

第一版 config options：

| ACP config id | 类型 | 值 | 来源 |
|---|---|---|---|
| `model` | select | `/v1/models` data ids；失败时保留当前 model | Chat2API |

第二版 config options：

| ACP config id | 类型 | 值 | 请求落点 |
|---|---|---|---|
| `reasoning_effort` | select | `low`、`medium`、`high` | request body `reasoning_effort` |
| `web_search` | select | `off`、`on` | request body `web_search` |

规则：

- `session/set_config_option` 必须返回完整 config option 列表。
- 模型切换只影响后续 prompt，不改已持久化 message。
- 如果 `/v1/models` 失败，不阻断当前 prompt，只在 config option 描述中体现不可刷新。

## 7. 配置计划

当前 `server/internal/shared/config.go` 对 `config.json` 使用 `DisallowUnknownFields`，且 `projects[].client` 已被移除。因此不要在 Phase 1 重新引入旧 client 配置。

Phase 1 使用环境变量，便于 POC：

| 变量 | 默认值 | 用途 |
|---|---|---|
| `WHEELMAKER_CHAT_BASE_URL` | `http://127.0.0.1:8080/v1` | Chat2API OpenAI-compatible base URL。 |
| `WHEELMAKER_CHAT_API_KEY` | 空 | 可选 Bearer token。 |
| `WHEELMAKER_CHAT_MODEL` | 空 | 指定默认模型；为空时从 `/v1/models` 取第一个。 |
| `WHEELMAKER_CHAT_REQUEST_TIMEOUT` | `120s` | 非流式请求与建连超时。 |
| `WHEELMAKER_CHAT_STREAM_IDLE_TIMEOUT` | `300s` | SSE idle timeout。 |

Phase 2 再考虑正式配置：

```json
{
  "agents": {
    "chat": {
      "baseUrl": "http://127.0.0.1:8080/v1",
      "apiKeyEnv": "CHAT2API_API_KEY",
      "defaultModel": "deepseek-chat"
    }
  }
}
```

正式配置需要单独设计迁移，因为当前配置文件明确禁止旧 `projects[].client`。

## 8. 安全与日志

必须遵守：

1. 不记录 `Authorization` header。
2. 不记录 API key、cookie、provider token。
3. HTTP error body 进入用户消息前需要 sanitize。
4. tool call arguments 默认不写入日志。
5. request/response debug log 默认关闭。
6. 如果后续接 Chat2API management API，management secret 只能通过 env 或 secret store 注入。

## 9. 实现任务计划

### Task 1: Provider enum 与 factory 注册

- 修改 `server/internal/protocol/acp_const.go` 增加 `chat`。
- 修改 `server/internal/hub/agent/factory.go` 注册 direct `chat` instance creator。
- 修改 `server/internal/hub/agent/skills.go` 让 `chat` 返回空 skills。
- 测试 `ParseACPProvider("chat")` 与 factory `Names()`。

### Task 2: OpenAI-compatible HTTP client

- 新增 `chat_openai_types.go` 定义 request/response/error/SSE structs。
- 新增 `chat_openai_client.go`：
  - `ListModels(ctx)`
  - `ValidateModel(ctx, model)`
  - `CreateChatCompletionStream(ctx, request, onChunk)`
  - `CreateChatCompletion(ctx, request)`
- 使用 `httptest.Server` 覆盖 stream、error、cancel。

### Task 3: Message store

- 新增 `chat_message_store.go`。
- 以 project name、session id 生成安全路径。
- 支持 load、save、append user、append assistant、truncate policy。
- 更新 `CleanupSessionArtifacts`，按 agent type 删除 `chat` message log。

### Task 4: chatInstance

- 新增 `chat_agent.go` 实现 `agent.Instance`。
- `Initialize` 返回保守 capabilities。
- `SessionNew`/`SessionLoad` 绑定 message log。
- `SessionPrompt` 校验 text-only，调用 HTTP stream，发 ACP chunks。
- `SessionCancel` 取消 in-flight HTTP request。
- `SessionSetConfigOption` 更新 model。

### Task 5: Config option 与模型列表

- Phase 1 实现 `model` option。
- `/v1/models` 失败时保留当前 model，并让 prompt 使用已配置 model。
- 无 model 且 `/v1/models` 为空时，prompt 返回 `failed`，提示用户配置 `WHEELMAKER_CHAT_MODEL`。

### Task 6: 端到端回归

- `go test ./internal/protocol ./internal/hub/agent ./internal/hub/client`
- 手动启动 Chat2API，设置 `/use chat`，验证：
  - 新会话首轮 streaming 正常。
  - 第二轮带上第一轮上下文。
  - `/model` 可切换。
  - `session/cancel` 返回 cancelled。
  - Chat2API 未启动时错误清晰。
  - 上游返回 tool call 时不执行工具。

## 10. 验收标准

Phase 1 完成后必须满足：

1. App 中能选择或 `/use chat` 切到 `chat` agent。
2. 不启动任何 CLI subprocess。
3. Chat2API 已运行时，`chat` 能通过 `/v1/chat/completions` 流式输出文本。
4. WheelMaker Registry/SessionRecorder 仍然只看到 ACP `session/update` 与 `session/prompt` result。
5. `chat` 不发送 OpenAI `tools`，不产生 ACP `tool_call`。
6. 取消 prompt 后本轮结果是 `cancelled`。
7. 重启 WheelMaker 后，`chat` agent 能从自己的 message log 恢复上下文。
8. Chat2API 未运行、模型不可用、认证失败时，用户看到明确错误。

## 11. 后续扩展

不属于第一版，但设计上保留空间：

- `reasoning_effort`、`web_search` config options。
- `usage_update` 映射。
- 图片输入，前提是逐 provider 验证 Chat2API 真正支持。
- WheelMaker 侧 OpenAI tool loop，仍由 WheelMaker 执行权限与工具，不交给 Chat2API。
- Chat2API headless lifecycle 管理。
- 正式 `agents.chat` config schema。
