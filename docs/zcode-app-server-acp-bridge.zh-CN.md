# ZCode App-Server 与 ACP 转换文档

日期：2026-07-16
状态：协议逆向 Phase 1（基于 wire 抓包 + 成功路径验证，非官方文档）

本文是 WheelMaker 未来接入 `zcode` agent 的协议转换说明。`zcode` 对上必须表现为 ACP agent，对下连接 `zcode app-server`。与 `codex` 一样，转换逻辑只能落在 agent 层，不能污染 `client.Session`、IM、registry、recorder 或 ACP 基础 transport。

> ⚠️ **重要前提**：ZCode 官方（[zcode.z.ai/en/docs](https://zcode.z.ai/en/docs)、[docs.z.ai](https://docs.z.ai)）**未公开任何 app-server 协议规范**。本文结论来自对本机 `zcode app-server`（v0.15.2，`zcode.cjs` bundle）的 wire 抓包与 bundle 静态逆向。其中握手、方法集、schema、配置机制、成功路径事件流（`model.streaming` text_delta → `turn.completed`）均已用真实 API key（`api.z.ai/api/anthropic`）实测跑通；权限协议基于 bundle 静态逆向（待 build 模式 wire 实测）。**协议无稳定契约保证**，ZCode 版本升级可能改变方法名/字段，且不会有 deprecation notice——实现时以"抓包重放 + 行为回归"作为校验手段。

> ⚠️ **重要前提**：ZCode 官方（[zcode.z.ai/en/docs](https://zcode.z.ai/en/docs)、[docs.z.ai](https://docs.z.ai)）**未公开任何 app-server 协议规范**。本文所有结论来自对本机 `zcode app-server`（v0.15.2，`zcode.cjs` bundle）的 wire 抓包与 bundle 静态逆向，**无稳定契约保证**。ZCode 任何版本升级都可能改变方法名/字段，且不会有 deprecation notice。实现时必须以"抓包重放 + 行为回归"作为校验手段。

## 资料来源

- 抓包工具：`docs/.zcode-probe/probe.js`（spawn `zcode app-server` 子进程，收发 JSONL）
- 抓包脚本：`docs/.zcode-probe/probe-*.js`（方法枚举 / schema 探测 / 事件流捕获）
- 本机版本：`zcode 0.15.2`（CLI 入口 `resources/glm/zcode.cjs`，进程名 `zcode-cli`，桌面版 `3.3.6`）
- 协议自标识：`session/create` 响应中 `protocol = { name: "ZCode Protocol", version: 1 }`
- 对比参考：[codex-app-server-acp-bridge.zh-CN.md](./codex-app-server-acp-bridge.zh-CN.md)

## 与 Codex App-Server 的关键异同

| 维度 | Codex app-server | ZCode app-server |
|---|---|---|
| 传输 | JSONL over stdio | JSONL over stdio |
| `jsonrpc:"2.0"` 字段 | **wire 上省略** | **wire 上省略**（携带会被 zod `unrecognized_keys` 拒绝）|
| 握手 | `initialize` + `initialized` | **无握手方法**（`initialize` 返回 -32601 method-not-found）；首请求即可直接 `session/create` |
| 核心对象 | Thread / Turn / Item | Session / Turn / Message |
| 发起 prompt | `turn/start`（同步等到 `turn/completed`）| `session/send`（**立即返回 `{accepted:true}`**，结果纯异步事件流）|
| 事件模型 | `item/*`、`turn/*` notification | 两层：`state.updated`（状态 patch）+ `session/event`（带 `seq` 的结构化事件）|
| 配置 | Codex CLI 自身配置 | `~/.zcode/cli/config.json` + `ZCODE_*` 环境变量（与桌面版 `~/.zcode/v2/` 隔离）|

**最大差异**：ZCode 的 `session/send` 是**纯异步**的——请求只投递，所有输出（模型文本增量、工具调用、完成）都通过 `session/event` notification 流式推送，请求本身不等模型。这与 Codex（`turn/start` 同步阻塞到 `turn/completed`）和标准 ACP（`session/prompt` 同步返回 `stopReason`）都不同。桥接层必须自己"合成"对上的同步 prompt 语义：发送 `session/send` 后挂起，订阅事件流，直到收到终态事件再 resolve。

## 传输与帧格式

### 传输

- JSONL over stdio（一行一个 JSON 对象，`\n` 分隔）。
- 客户端请求、服务端响应、服务端 notification、服务端反向 request 共用同一条 stdout stream。

### 帧格式（JSON-RPC 2.0 语义，但省略 `jsonrpc` 字段）

请求（client → server）：
```json
{ "id": "1", "method": "session/create", "params": { ... } }
```

响应（server → client）：
```json
{ "id": "1", "result": { ... } }
```
或
```json
{ "id": "1", "error": { "code": -32602, "message": "Invalid params", "data": { "name": "ZodError", "message": "..." } } }
```

通知（server → client，无 `id`）：
```json
{ "method": "state.updated", "params": { ... } }
{ "method": "session/event", "params": { ... } }
```

> **禁止携带 `jsonrpc` 字段**。实测发送 `{"jsonrpc":"2.0",...}` 会被以 `Unrecognized key: "jsonrpc"` 拒绝（`id` 返回 `"invalid-message"`）。
>
> `id` 必须是字符串。请求/响应按 `id` 配对；notification 无 `id`。

### 错误码

| code | 含义 | 触发场景 |
|---|---|---|
| `-32600` | Invalid Request | 帧整体不符合 union schema（如携带 `jsonrpc`）|
| `-32601` | Method not found | 方法名不存在（用于探测方法集）|
| `-32602` | Invalid params | params 缺字段/类型错；`data.message` 是 zod 的 issue 列表，可据此逆向 schema |
| `-32603` | Internal error | 运行时错误（如 `model_config_missing`），`data.stack` 含调用栈 |

`data.message`（zod issues）是逆向入参 schema 的金矿：`path` 指向缺失字段，`expected`/`received` 暴露类型，`values` 暴露枚举。

## 方法集（session/* 命名空间）

实测确认存在的方法（v0.15.2）。命名规范是**斜杠分隔**（`session/xxx`），不是 Codex 的 `thread/xxx`/`turn/xxx`。

| 方法 | 入参 | 出参（result）| 用途 |
|---|---|---|---|
| `session/list` | `{}` | `{ sessions: SessionInfo[] }` | 列出本机所有 session |
| `session/create` | `{ workspace: {workspacePath, workspaceKey}, mode?, model? }` | `{ session, projection, runtime, settings, messages, protocol }` | 创建新 session |
| `session/resume` | `{ sessionId }` | 同 `session/read` | 恢复已有 session（含历史）|
| `session/read` | `{ sessionId }` | `{ messages, projection, ... }` | 读取 session 完整快照（历史消息 + 当前投影）|
| `session/send` | `{ sessionId, content }` | `{ accepted: true, sessionId, stateRevision }` | **异步**投递用户消息 |
| `session/steer` | `{ sessionId, content }` | — | turn 进行中插入消息（steering）|
| `session/stop` | `{ sessionId }` | `{}` | 停止当前 turn |
| `session/rewind` | `{ sessionId, target }` | — | 回退到某个检查点 |
| `session/setMode` | `{ sessionId, mode }` | `{ messages, ... }`（快照）| 切换**权限**模式（plan/edit/build/yolo）|
| `session/events` | `{ sessionId }` | `{ events: [] }` | 拉取/重放事件（配合 seq）|
| `session/subscribe` | `{ sessionId, deliveryKind }` | `{ sessionId, eventSeq, events: [] }` | 订阅事件流 |

> **`session/create` 的 `mode` 语义（实测）**：`mode` 参数（`build`/`edit`/`plan`/`yolo`）设置的是**权限模式** `settings.permission.mode`，**不是** `session.mode`。`session.mode` 创建后恒为 `build`（session 类型分类，不可变），`projection.mode` 同样恒为 `build`。要改权限模式用 `session/setMode`。`permission` 不是 create 的合法字段（返回 -32602）。

**不存在的方法**（返回 -32601，已逐个实测验证）：`initialize`、`session/new`、`session/load`、`session/prompt`、`session/cancel`、`session/delete`、`session/archive`、`thread/*`、`turn/*`、`model/list`、`auth/*`，以及 bundle 内部可见的 camelCase 名 `sendPrompt`/`subscribeSession`/`readMessages`/`readEvents`/`steerSession`/`rewindSession`（这些是内部 JS 函数名，**不是 wire 方法名**；wire 层统一用斜杠形式）。

### deliveryKind 枚举

`session/subscribe` 的 `deliveryKind`：
- `desktop-continuous`：持续推送，适合本地长连接（WheelMaker 接入用这个）。
- `web-remote-replayable`：可重放，基于 `seq` 的断点续传（适合远程/不可靠连接）。

### SessionInfo（session/list 元素）

```json
{
  "sessionId": "sess_xxx",
  "sessionKind": "interactive",
  "mode": "build",
  "status": "idle",
  "title": "...",
  "titleSource": "generated",
  "workspace": { "workspaceKey": "...", "workspacePath": "..." },
  "traceId": "uuid",
  "createdAt": 1784170516988,
  "updatedAt": 1784172388481
}
```

### session/create 完整响应结构

```json
{
  "protocol": { "name": "ZCode Protocol", "version": 1 },
  "session": {
    "sessionId": "sess_xxx",
    "sessionKind": "interactive",
    "mode": "build",
    "status": "idle",
    "model": { "providerId": "zai", "modelId": "glm-5.2" },
    "target": null,
    "title": "",
    "workspace": { "workspacePath": "...", "workspaceKey": "..." },
    "traceId": "uuid",
    "createdAt": <ms>,
    "updatedAt": <ms>
  },
  "projection": {
    "status": "idle",
    "mode": "build",
    "turnCount": 0,
    "contextUsed": 0,
    "contextWindow": 1000000,
    "totalTokenCount": 0,
    "activeToolCalls": [],
    "backgroundJobs": [],
    "pendingPermissions": [],
    "sessionId": "unknown",
    "target": null
  },
  "runtime": {
    "mainActive": false,
    "eventSeq": 0,
    "stateRevision": 0,
    "pendingRequestIds": [],
    "goalVerifications": [],
    "goalVerificationTimeline": []
  },
  "settings": {
    "mode": { "current": "yolo" },
    "model": {
      "available": [ { "ref": { "providerId": "zai", "modelId": "glm-5.2" }, "label": "glm-5.2", "providerLabel": "Z.AI", "contextWindow": 1000000 } ],
      "current": { "providerId": "zai", "modelId": "glm-5.2" },
      "lastUsed": { "providerId": "zai", "modelId": "glm-5.2" }
    },
    "permission": { "mode": "yolo" },
    "thoughtLevel": { "available": [...] }
  },
  "messages": []
}
```

关键字段：
- `runtime.eventSeq`：事件序列号起点（事件流的"水位"）。
- `runtime.stateRevision`：状态版本号，每次 `state.updated` 自增。
- `projection`：实时状态快照，`session/read` 也返回同结构。
- `settings.model.available`：可用模型列表（替代 Codex 的 `model/list`）。
- `settings.permission.mode`：当前权限模式（`build`/`edit`/`plan`/`yolo`）；由 create 的 `mode` 参数或 `session/setMode` 设置。

### Message 结构（session/read / session/resume 返回的 `messages[]` 元素，实测）

`session/create` 时 `messages` 为空；`session/send` 产生 turn 后，`session/read`/`session/resume` 返回完整历史。每个 message 结构：

```json
{
  "info": {
    "agent": "zcode-agent",
    "messageId": "msg_xxx",
    "model": { "modelId": "glm-5.2", "providerId": "zai" },
    "role": "user",                       // "user" | "assistant"
    "sessionId": "sess_xxx",
    "time": { "created": 1784184475931 },
    "tools": { "Bash": true, "Read": true, "Edit": true, "Write": true, ... }  // 仅 assistant 消息：该 turn 启用的工具集
  },
  "parts": [
    { "messageId": "msg_xxx", "partId": "part_xxx", "type": "...", ... }
  ]
}
```
- `info.role` 区分用户/助手消息（不在顶层，在 `info.role`）。
- `info.tools` 仅在 assistant 消息出现，枚举该 turn 实际启用的工具（16 个：Agent/AskUserQuestion/Bash/Edit/EnterPlanMode/ExitPlanMode/Read/Skill/TaskStop/TodoRead/TodoWrite/WebFetch/WebSearch/Write/SendMessage/ReadSessionContext）。
- `parts[]` 是消息内容分块（文本/工具调用等），带 `partId`。历史 replay 时按 message → part 展开。

## 事件流模型（核心）

`session/send` 立即返回后，模型工作通过两类 notification 异步推送：

### 1. `state.updated`（状态机 patch）

```json
{
  "method": "state.updated",
  "params": {
    "type": "state.updated",
    "scope": "session",
    "sessionId": "sess_xxx",
    "workspace": { "workspacePath": "...", "workspaceKey": "..." },
    "revision": 1,
    "reason": "prompt_started",
    "patch": { "status": "running" }
  }
}
```
- `patch` 是对 `projection` 的局部更新（如 `{status:"running"}`）。
- `revision` 单调递增，等于 `stateRevision`。
- `reason` 如 `prompt_started`。

### 2. `session/event`（结构化业务事件）

```json
{
  "method": "session/event",
  "params": {
    "type": "turn.started",
    "sessionId": "sess_xxx",
    "turnId": "turn_xxx",
    "traceId": "uuid",
    "eventId": "uuid",
    "seq": 2,
    "timestamp": <ms>,
    "deliveryKind": "desktop-continuous",
    "payload": { ... }
  }
}
```
- `seq` 单调递增，是事件流的绝对序号（`web-remote-replayable` 模式下用于断点续传）。
- `turnId` 标识当前 turn。
- `type` 在外层 `params.type`，`payload` 携带具体内容。

### 已观测的 session/event type 谱系

| type | payload 要点 | 阶段 |
|---|---|---|
| `session.titleUpdated` | `{title, previousTitle, source:"first_input"}` | turn 开始 |
| `turn.started` | `{turnNumber, input, queryId}` | turn 开始 |
| `session.updated` | `{turnNumber, model, modelRef, messageCount, toolCount, iteration}` | 模型迭代 |
| `model_request_started` | `{baseURL, model, requestId, spanId, traceId, providerKind, transport:"sse", attempt, requestHeaders...}` | 发起模型请求 |
| `model_request_*` | 模型请求结果（started/failed/...）| 模型 IO |
| `model.streaming` | `{kind:"text_delta", delta:"<增量文本>", assistantMessageId, done:false}` —— 多条，逐 token | **模型输出增量（核心）** |
| `model.streaming` | `{kind:"reasoning*"（待测具体 kind）, delta, ...}` | reasoning 增量 |
| `tool.updated` | `{toolCallId, toolName, kind:"scheduled"\|"started"\|"result"\|"batch", ...}` —— 工具生命周期 | **工具执行（实测）** |
| `permission.requested` | `{requestId, toolCallId, toolName, riskLevel, ...}` —— 权限审批通知通道 | 权限（实测）|
| `permission.resolved` | 权限已决断 | 权限 |
| `turn.failed` | `{error:{type,code,message,detail,stack}, turnPhase}` | **终态·失败** |
| `turn.completed` | `{resultType:"success", response:"<完整文本>", usage:{inputTokens,outputTokens,cacheReadTokens,...}, toolCallCount, duration, cacheStats}` | **终态·成功** |

`tool.updated` 实测样本（Read 工具调用，build 模式只读自动放行）：
```json
// scheduled
{ "type":"tool.updated", "payload":{ "toolCallId":"call_xxx", "toolName":"Read", "kind":"scheduled", "schedule":{...}, "inputRef":"model_stream", "inputOmitted":true } }
// started
{ "type":"tool.updated", "payload":{ "toolCallId":"call_xxx", "toolName":"Read", "kind":"started", "startedAt":<ms> } }
// result
{ "type":"tool.updated", "payload":{ "toolCallId":"call_xxx", "result":{ "success":true, "content":"..." } } }
// batch (整批完成)
{ "type":"tool.updated", "payload":{ "toolCallIds":[...], "successCount":1, "errorCount":0, "kind":"batch" } }
```
工具入参 `input` 在事件里默认省略（`inputOmitted:true, inputRef:"model_stream"`），完整入参需从模型流或 `session/read` 的 message parts 取。

`model.streaming` 实测样本（问 "2+2"）：
```json
// seq=5
{ "type":"model.streaming", "payload":{ "kind":"text_delta", "delta":"2", "assistantMessageId":"msg_...", "done":false } }
// seq=6
{ "type":"model.streaming", "payload":{ "kind":"text_delta", "delta":"+2 is 4.", "assistantMessageId":"msg_...", "done":false } }
// turn.completed
{ "type":"turn.completed", "payload":{ "resultType":"success", "response":"2+2 is 4.", "usage":{...}, "toolCallCount":0, "duration":2941 } }
```

> **说明**：早期抓包曾因 harness 用错环境变量名（`ZCODE_MODEL_BASE_URL` 应为 `ZCODE_BASE_URL`）导致 baseURL 未注入、模型 404，只能看到 `turn.failed`。修正后 `model.streaming`（`text_delta`）与 `turn.completed`（`resultType=success`）均已实测捕获。工具调用路径（`tool_call_scheduled` 等）尚未在成功 turn 中触发（测试 prompt 未要求工具），待一个会触发工具的 prompt 补测。

## ACP 桥接映射（草案）

### ACP In -> ZCode In

| ACP 方法 | ZCode 方法 | 备注 |
|---|---|---|
| `initialize` | （无对应，直接 `session/create`）| ZCode 无握手；ACP `initialize` 的 `agentInfo.name = zcode` |
| `session/new` | `session/create` | 传 `workspace`；返回的 `sessionId` 即 ACP sessionId |
| `session/load` | `session/resume` | replay `session/resume` 返回的 `messages` 为 `session/update` |
| `session/prompt` | `session/send` + 事件流合成 | **异步→同步**：发送后挂起，订阅 `session/event`，终态事件 resolve |
| `session/cancel` | `session/stop` | 停止当前 turn |
| `session/list` | `session/list` | 字段映射见下 |

### 停止原因映射（已验证）

| ZCode 终态事件 | `payload.resultType` | ACP stopReason |
|---|---|---|
| `turn.completed` | `success` | `end_turn` |
| `turn.failed` | （error 结构）| `refusal` 或 error |
| `session/stop` 主动取消 | — | `cancelled` |

### 事件 -> ACP 输出映射（已验证）

| ZCode session/event type | payload 关键字段 | ACP 输出 |
|---|---|---|
| `model.streaming`（`kind=text_delta`）| `delta`、`assistantMessageId`、`done` | `agent_message_chunk` |
| `model.streaming`（`kind=reasoning*`，待测）| reasoning delta | `agent_thought_chunk` |
| 工具调度（待测）| — | `tool_call` pending |
| 工具结果（待测）| — | `tool_call_update` completed/failed |
| `session.titleUpdated` | `title` | `session_info_update.title` |
| `turn.completed`（`resultType=success`）| `response`、`usage` | 终止挂起的 `session/prompt`，返回 `end_turn` |
| `turn.failed` | `error` | 终止挂起的 `session/prompt`，返回失败 |

## 权限审批协议（server→client 反向 request，已实测触发）

> wire 实测确认（v0.15.2，build 模式 + `rm -rf` 高风险命令触发）：`interaction/requestPermission` 真实发出，且未应答时按指数退避重发（实测 6 次）；同时通过 `session/event` 推送 `permission.requested` 通知。低风险命令（如 `echo`）在 build 模式下**自动放行**，不触发审批。

### 反向 request 全集

server 向 client 发起的**带 `id` 的 JSON-RPC request 只有 3 种**，均在 `interaction/*` 命名空间。`id` 形如 `"server-1"`、`"server-2"`（字符串 `server-` 前缀）。未应答时带指数退避重发（上限 10000ms）。

| method | params schema | result schema | 用途 |
|---|---|---|---|
| `interaction/requestPermission` | `hrn` | `Yx`（decision allow/deny/escalate/modify）| **工具执行审批**（核心）|
| `interaction/requestUserInput` | `xrn` | `nG`（action accept/decline/cancel）| 用户输入征询：`AskUserQuestion`、plan 模式计划审批 |
| `interaction/requestProviderRuntimeHeaders` | `yrn` | `vwe`（headersApplied/errorMessage）| 模型请求前向 client 索要 provider 运行时头（认证/代理注入），reason 为 `model-request` 或 `captcha-retry` |

### interaction/requestPermission

params：
```json
{
  "requestId": "...", "sessionId": "...", "turnId": "...",
  "toolCallId": "...", "toolName": "Bash",
  "reason": "<人类可读原因>",
  "riskLevel": "low|medium|high|critical",
  "input": { /* 工具原始入参，按 toolName 解读；无独立 command/filePath 字段 */ },
  "origin": { "kind": "subagent", "agentId": "...", ... },  // 仅 subagent 发起时出现
  "options": [ /* ≥1 个预填好的选项，client 选一个返回其 response */ ]
}
```

`options` 标准三项（每个携带预填的 `response`，client 选一个返回即可）：
- `allow_once` → `{decision:"allow", reason:"Approved once"}`
- `allow_project`（kind=`allow_always`）→ `{decision:"allow", permissionUpdates:[{type:"addRules", behavior:"allow", rules:[{toolName, ruleContent?}]}]}`
- `deny` → `{decision:"deny", reason:"Denied"}`

client result（`Yx`）：
```json
{
  "decision": "allow|deny|escalate|modify",
  "reason": "...",
  "modifiedInput": { /* decision==="modify" 时，改写后的工具入参 */ },
  "permissionUpdates": [ { "type": "addRules", "behavior": "allow|deny|ask", "rules": [{"toolName":"Bash","ruleContent":"..."}] } ]
}
```
> `decision` 是 4 值枚举（`allow`/`deny`/`escalate`/`modify`），不是简单 allow/deny。`modify` 允许 client 改写工具入参后放行。`ask` 只在 `permissionUpdates.behavior` 内部出现，不是 wire result。

### 权限模式与触发规则

内部 mode 枚举为 5 个（`plan|build|edit|yolo|auto`），对外别名兼容 `default`/`acceptEdits`/`dontAsk`/`bypassPermissions`/`autoEdit` 等（`default` 归一化为 `build`）。`auto` 当前未实现（直接 deny）。

判定顺序（短路）：
1. 需要用户交互的工具（`AskUserQuestion`）→ `ask`（无视模式）
2. **`yolo`** → 一律 `allow`（**这就是 yolo 模式抓不到权限包的原因**）
3. `auto` → `deny`（未实现）
4. disallowedTools / project 规则
5. `plan` → 仅放行只读；写/破坏操作**直接 deny**（不审批）
6. `edit` → 文件编辑工具（Write/Edit/ApplyPatch，`sideEffectScope=workspace`）自动放行；其余走 build
7. `build`/default → 只读低风险放行；`critical` 或 `high`(非 autoApprove) 或有副作用 → **ask**

工具风险分类：`Read/Glob/Grep/WebSearch/WebFetch/TodoRead/TodoWrite/AskUserQuestion/Agent/Task/Skill` = 只读(low)；`Write/Edit/ApplyPatch/Bash` = 写(medium)；`Bash` = 破坏性(high)。所以 build 模式下 **Bash 和写工具都会触发 `interaction/requestPermission`**。

### 权限状态也可从事件流观察

除带-id 的 request 外，权限生命周期还通过 `session/event` 推送 notification：`permission_requested` / `permission_resolved` / `permission_denied`；且 `state.updated` 的 `projection.pendingPermissions[]` 实时反映挂起的审批列表（entry 结构与 request params 一致，多 `requestedAt`）。两种通道 payload 一致。

### ACP 映射（权限）

| ZCode | ACP |
|---|---|
| `interaction/requestPermission`（toolName=Bash/Write 等）| `session/request_permission`（kind: execute/write/other）|
| `decision:"allow"` | 批准；可映射 `acceptForSession` 到 `permissionUpdates` 持久化 |
| `decision:"deny"` | 拒绝 |
| `interaction/requestUserInput`（AskUserQuestion）| ACP 无直接对应，Phase 1 可返回 `cancel`/默认值 |

## 配置与凭证

### 配置文件

- **CLI app-server 读 `~/.zcode/cli/config.json`**（与桌面版 `~/.zcode/v2/config.json` **隔离**）。
- 最小 config（`model` 必填，否则 `session/create` 报 `model_config_missing`）：
  ```json
  {
    "model": { "main": "zai/glm-5.2", "lite": "zai/glm-5.2" },
    "provider": {
      "zai": {
        "kind": "anthropic",
        "name": "Z.AI",
        "options": { "apiKey": "<KEY>", "baseURL": "https://api.z.ai/api/anthropic" },
        "models": { "glm-5.2": { "name": "GLM-5.2" } }
      }
    }
  }
  ```
- `model` 是 `"provider/model"` 格式的引用字符串（或 `{main,lite}`）；apiKey/baseURL 放 `provider.options`。

### 环境变量（优先级高于 config）

| 变量 | 作用 |
|---|---|
| `ZCODE_MODEL` | model 引用，如 `zai/glm-5.2`（无 `/` 时默认 provider=`anthropic`）。解析出**裸 provider id**（如 `zai`，不加 `builtin:` 前缀）|
| `ZCODE_BASE_URL` | **model 的 baseURL**（注意：是 `ZCODE_BASE_URL`，不是 `ZCODE_MODEL_BASE_URL`——后者 bundle 不读取）|
| `ZCODE_API_KEY` | API key 兜底（优先级：`<PROVIDER>_API_KEY` > `ZCODE_API_KEY`）|
| `ZCODE_ENDPOINT_ORIGIN` | 覆盖 ZCode 平台 origin（默认 `https://zcode.z.ai`，仅用于 plan 计费/OAuth，**不**用于模型 baseURL）|

配置源优先级（数值大者优先）：System(0) < User(10) < Project(20) < Session(30) < **Env(40)** < Cli(50)。

> **关键纠错**：早期版本曾误记 `ZCODE_MODEL_BASE_URL` 为 baseURL 环境变量——这是笔误，bundle 从不读取该名。正确变量是 `ZCODE_BASE_URL`（`ZCODE_` + `BASE_URL`）。baseURL 的唯一来源是 `config.provider.<id>.options.baseURL` 或 `ZCODE_BASE_URL`，二者之一必须给出，否则 provider 解析后 baseURL 为空，模型请求会落到不可达的默认域并 404。

### 凭证来源

- **API key（推荐，已验证可用）**：明文存于 `~/.zcode/v2/config.json` 的 `provider["builtin:zai"].options.apiKey`（49 字符）。实测对 `https://api.z.ai/api/anthropic/v1/messages` 走 Anthropic Messages 协议（`x-api-key` 认证）返回 200；同样在 `zcode app-server` 子进程里实测成功（`turn.completed resultType=success`）。**这是 WheelMaker 接入应采用的凭证路径，无需 OAuth。**
- **OAuth（plan）**：`zcode login` → 写入加密的 `~/.zcode/v2/credentials.json`。`zcode login` 的 well-known 端点（`zcode.z.ai/.well-known/oauth-authorization-server`）当前返回 Next.js 404 HTML，CLI `login` 在 `init` 阶段 `parseJson` 失败——纯命令行 OAuth 当前不可用，仅能在桌面版 GUI 内完成。app-server 接入不必依赖此路径。

### ✅ app-server 用 API key 跑通的正确配置（已验证）

**核心要点：provider id 必须自洽、baseURL 必须落对字段。** bundle 没有任何"强制 plan 路由"逻辑——早期抓包失败（baseURL 变成 `zcode.z.ai`）的根因是 harness 用错了环境变量名（`ZCODE_MODEL_BASE_URL` 不存在），导致 baseURL 未注入。修正后即成功。

**方式 A：纯环境变量（最小，推荐用于桥接进程）**
```bash
ZCODE_MODEL=zai/glm-5.2
ZCODE_BASE_URL=https://api.z.ai/api/anthropic   # 必须用这个名字
ZCODE_API_KEY=<49字符key>                        # 或写进 config provider options
```
要点：
- provider id 用**裸 `zai`**（`ZCODE_MODEL` 解析后无前缀）；它必须能匹配到 config 的 `provider.zai` 条目或由 env 自洽。
- bundle 的 `Xyo` 会自动给 anthropic baseURL 补 `/v1`，最终请求 `https://api.z.ai/api/anthropic/v1/messages`。
- `kind` 默认 `anthropic`，走 anthropic SDK。

**方式 B：config 文件（`~/.zcode/cli/config.json`）**
```json
{
  "model": { "main": "zai/glm-5.2", "lite": "zai/glm-5.2" },
  "provider": {
    "zai": {
      "kind": "anthropic",
      "name": "Z.AI",
      "options": { "apiKey": "<KEY>", "baseURL": "https://api.z.ai/api/anthropic" },
      "models": { "glm-5.2": { "name": "GLM-5.2" } }
    }
  }
}
```
要点：provider key 必须是裸 `zai`（与 `ZCODE_MODEL` 解析出的 id 一致）；baseURL 必须在 `provider.zai.options.baseURL`（不是顶层），且值为 `api.z.ai/api/anthropic`。若 env 和 config 同时存在，env（优先级 40）覆盖 config（优先级 10）。

> **`builtin:` 前缀不是路由开关**：`ZCODE_MODEL=builtin:zai/glm-5.2` 会解析出 provider id `builtin:zai`，则 config 里必须有 `provider["builtin:zai"]` 条目才能匹配，否则 `ProviderNotFound`。桌面版日志显示 `builtin:zai` 是 GUI 运行时的展示归一化；app-server 环境下用裸 `zai` + `provider.zai` 条目最简单。

### 复用桌面版已有 API key

桌面版登录后，可用 API key 存于 `~/.zcode/v2/config.json` 的 `provider["builtin:zai"].options.apiKey`。桥接进程可直接读取该 key 注入子进程 env（参考 `docs/.zcode-probe/probe.js` 的 `buildModelEnv`），无需用户再次配置。注意这是用户私有凭证，进程内使用即可，不要落盘到日志或仓库。

## 实现框架（草案）

```text
client.Session
  -> agent.Instance                    // existing ACP-shaped interface
    -> zcodeappConn                    // implements agent.Conn, per WheelMaker session
      -> zcodeappRuntime               // ZCode Protocol request/event matching + sessionId routing
        -> ACPProcess                  // JSONL stdio subprocess transport (reused as-is)
          -> node <zcode.cjs> app-server
```

文件边界（对标 codexapp）：

| 文件 | 职责 |
|---|---|
| `server/internal/hub/agent/zcodeapp_agent.go` | provider launch（`node <path>/glm/zcode.cjs app-server --cwd <dir>`）、runtime request/event matching、conn lifecycle、notification/request 转发 |
| `server/internal/hub/agent/zcodeapp_convert.go` | ZCode Protocol 最小 schema、与 ACP 字段转换、config 映射 |

注册改动（`acp_const.go` / `factory.go` / `skills.go`）参考 Codex 的 `codexappInstanceCreator`。

### 桥接必须解决的关键点

1. **异步→同步合成**：`session/send` 立即返回，桥接需挂起 ACP `session/prompt`，订阅事件流，直到 `turn.completed`/`turn.failed` 才 resolve 返回 stopReason。
2. **二进制发现**：ZCode 入口随安装位置变（`%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`）。`ResolveACPBinary` 需支持定位 ZCode 安装目录，或 preset 允许配置路径。
3. **凭证配置**：桥接进程以环境变量注入 model 配置即可，无需 OAuth——`ZCODE_MODEL=zai/glm-5.2` + `ZCODE_BASE_URL=https://api.z.ai/api/anthropic` + `ZCODE_API_KEY=<key>`（key 可从桌面版 `~/.zcode/v2/config.json` 的 `provider["builtin:zai"].options.apiKey` 复用）。详见"配置与凭证"节。
4. **`workspace` 映射**：`session/create` 必须传 `{workspacePath, workspaceKey}`，二者通常都等于项目绝对路径。

## 复现工具

`docs/.zcode-probe/` 下提供可复现的抓包工具：
- `probe.js`：交互式 harness，spawn app-server，支持 `method@{json}` REPL 或脚本驱动。
- `probe-handshake.js`：握手方法枚举。
- `probe-methods.js`：`session/*` 方法集探测。
- `probe-session-list.js`：`session/list` / `create` schema。
- `probe-create-send.js`：创建 session + send/subscribe schema。
- `probe-send-live.js` / `probe-events.js`：真实 prompt 事件流捕获。
- `probe-lifecycle.js`：read/resume/stop/steer/rewind/setMode/events schema。
- `verify-1.js` … `verify-4c.js`：逐断言验证脚本（PASS/FAIL），用真实 API key 覆盖帧格式/错误码/方法存在性/create/list/read/resume/send 成功闭环/setMode/stop/steer/rewind/events/权限请求。

> harness 会从 `~/.zcode/v2/config.json` 的 `builtin:zai` 读 apiKey 注入子进程 env（`ZCODE_MODEL` + `ZCODE_BASE_URL` + `ZCODE_API_KEY`，不落盘、不打印），用真实 API key 跑通完整闭环。`verify-*.js` 是逐断言点的验证脚本（PASS/FAIL）。

## Phase 1 待补

- [x] 权限请求形态（`interaction/requestPermission` 等 3 个 server-request，wire 实测触发）
- [x] 成功路径事件（`model.streaming` text_delta / `tool.updated` / `turn.completed`）
- [x] 配置/凭证：API key 经环境变量已验证可用，无需 OAuth
- [x] message 结构（`{info, parts}`）、`session/create` mode 语义（设置 permission.mode）
- [ ] 图片/附件输入（`session/send` 的 `content` 是否支持非文本）待测
- [ ] `session/rewind` 的 `target` 结构待测
- [ ] reasoning delta 的具体 `model.streaming.kind` 待测
- [ ] 权限闭环（回复 allow 后的 `permission.resolved` + 工具继续执行）待补完整 capture
