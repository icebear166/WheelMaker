> 摘要：本页维护 WheelMaker Registry 2.6 的消息封装、方法域、路由、认证和版本约束。

# WheelMaker Registry Protocol 2.6

> 来源：本页由原路径 `docs/registry-protocol.md` 于 2026-07-17 全文迁入 wiki；本次迁移未修改协议版本或 payload。

本文定义 WheelMaker Registry 2.6 协议。2.6 是一次硬切版本：Registry、Hub、App 的 `connect.init.payload.protocolVersion` 必须为 `2.6`，不保留旧端兼容入口。

## 0. 单一来源

- Go 协议常量与方法描述符：`server/internal/protocol/registry_methods.go`
- Go envelope、payload 与错误结构：`server/internal/protocol/registry.go`
- App 侧协议常量：`app/web/src/registry/registryMethods.ts`

业务代码必须使用协议常量，不再内联发送 Registry method 字符串。ACP 是 agent 业务协议，不属于 Registry method 注册表。

## 1. Envelope

所有消息使用同一个 WebSocket envelope：

```json
{
  "requestId": 1,
  "type": "request",
  "method": "project.fs.read",
  "hubId": "hub-a",
  "projectId": "hub-a:WheelMaker",
  "payload": {}
}
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `requestId` | request/response/error 使用正整数；event 不携带 |
| `type` | `request`、`response`、`event`、`error` |
| `method` | 必须在协议注册表中存在 |
| `hubId` | Hub 级请求放在 envelope 顶层 |
| `projectId` | Project/Session 级请求放在 envelope 顶层 |
| `payload` | 业务参数；不承载路由用 `hubId` 或 `projectId` |

`sessionId` 是 Session 实例 ID，继续放在 payload 中。

## 2. 连接与认证

### `connect.init`

请求：

```json
{
  "requestId": 1,
  "type": "request",
  "method": "connect.init",
  "payload": {
    "clientName": "wheelmaker-web",
    "clientVersion": "0.1.0",
    "protocolVersion": "2.6",
    "role": "client",
    "hubId": "hub-a",
    "token": "******"
  }
}
```

响应：

```json
{
  "requestId": 1,
  "type": "response",
  "method": "connect.init",
  "payload": {
    "ok": true,
    "principal": {
      "role": "client",
      "hubId": "hub-a",
      "connectionEpoch": 42
    },
    "serverInfo": {
      "protocolVersion": "2.6"
    }
  }
}
```

规则：

- `role` 只能是 `hub`、`client`。
- `role=hub` 必须在 payload 中携带 `hubId`。
- `role=client` 可选携带 `hubId`；携带后 client scope 限定在该 Hub。
- `protocolVersion` 必须等于 `2.6`。
- 配置了 token 时必须携带并匹配。
- 所有非 `connect.*` 业务请求必须在 `connect.init` 成功后发送。

## 3. 方法域与白名单

| 顶级域 | 归属 | 用途 |
| --- | --- | --- |
| `connect.*` | 连接层 | 初始化、关闭事件 |
| `registry.*` | Registry | Registry 自有目录、Project 报告事件、Relay 控制 |
| `hub.*` | Hub | Hub 报告、HubState、Hub 内部 Relay |
| `project.*` | Project | 文件、Git |
| `session.*` | Session | 会话、归档、附件、配置、会话事件 |
| `speech.*` | Registry speech | 语音输入流式通道 |
| `server.*` | Registry adapter | 服务端配置快照、更新与 Android ASR 凭据门禁 |
| `tts.*` | Registry TTS | 服务端文本转语音 |
| `debug.*` | Debug | 调试日志上传 |

| 角色 | 允许请求 |
| --- | --- |
| `hub` | `hub.report.projects`、`hub.report.project`、`hub.ping`、`session.message`、`session.updated` |
| `client` | `registry.project.list`、`registry.relay.*`、`hub.state.*`、`project.*`、`session.*`、`speech.*`、`server.*`、`tts.*`、`debug.uploadLog` |

事件方法由服务端推送，不作为 client request 白名单处理，包括 `registry.project.report`、`hub.state.updated`、`session.message`、`session.updated`、`connect.close`。

## 4. Hub 上报

Hub 建连后必须先发全量项目报告，后续按需发单项目报告。两个方法都要求 envelope 顶层 `hubId`。

### `hub.report.projects`

```json
{
  "requestId": 2,
  "type": "request",
  "method": "hub.report.projects",
  "hubId": "hub-a",
  "payload": {
    "connectionEpoch": 42,
    "projects": [
      {
        "name": "WheelMaker",
        "path": "D:/Code/WheelMaker",
        "online": true,
        "agent": "codex",
        "agents": ["codex", "claude"],
        "projectRev": "sha256:...",
        "git": {
          "branch": "main",
          "headSha": "abc123",
          "dirty": true,
          "gitRev": "sha256:...",
          "worktreeRev": "sha256:..."
        }
      }
    ]
  }
}
```

### `hub.report.project`

```json
{
  "requestId": 3,
  "type": "request",
  "method": "hub.report.project",
  "hubId": "hub-a",
  "payload": {
    "connectionEpoch": 42,
    "seq": 12,
    "project": {
      "name": "WheelMaker",
      "path": "D:/Code/WheelMaker",
      "online": true
    },
    "changedDomains": ["project", "git"],
    "updatedAt": "2026-06-05T10:00:00Z"
  }
}
```

Registry 使用 `connectionEpoch` 和 per-project `seq` 拒绝旧连接或乱序更新。Hub 断开、重连、单项目变化后，Registry 对 App 广播 `registry.project.report`，payload 包含完整 project snapshot。

## 5. Registry 项目目录

### `registry.project.list`

Client 读取 Registry 当前项目目录。返回范围受 client scope 限制。

```json
{
  "requestId": 1,
  "type": "request",
  "method": "registry.project.list",
  "payload": {}
}
```

响应：

```json
{
  "requestId": 1,
  "type": "response",
  "method": "registry.project.list",
  "payload": {
    "projects": [
      {
        "projectId": "hub-a:WheelMaker",
        "hubId": "hub-a",
        "name": "WheelMaker",
        "online": true,
        "path": "D:/Code/WheelMaker"
      }
    ],
    "hubs": [
      {"hubId": "hub-a"}
    ]
  }
}
```

### `registry.project.report`

Registry 对 App 广播单项目完整快照：

```json
{
  "type": "event",
  "method": "registry.project.report",
  "projectId": "hub-a:WheelMaker",
  "payload": {
    "hubId": "hub-a",
    "projectId": "hub-a:WheelMaker",
    "project": {}
  }
}
```

## 6. Project 方法

所有 Project 方法要求 envelope 顶层 `projectId`，由 Registry 通过 `projectId -> hubId` 路由到 Hub。Registry 不提供跨请求 batch 聚合；客户端应按目标 Hub/Project 分别发请求，并用 `requestId` 匹配乱序返回。

### Git rev 检查

- `project.git.rev`

请求 payload：

```json
{}
```

响应 payload：

```json
{
  "gitRev": "sha256:...",
  "worktreeRev": "sha256:..."
}
```

App 打开 Git tab 时先调用该方法；只有 `gitRev` 或 `worktreeRev` 相比已加载值变化时，才继续拉取 `project.git.refs`、`project.git.log`、`project.git.status` 等较重数据。

### 文件方法

- `project.fs.list`
- `project.fs.info`
- `project.fs.read`
- `project.fs.external.info`
- `project.fs.external.read`
- `project.fs.search`
- `project.fs.grep`
- `project.fs.index.search`

`project.fs.list` 与 `project.fs.read` 支持 `knownHash` 协商：

- 缓存未变：返回 `notModified: true`，不返回数据体。
- 缓存变化或无缓存：返回完整数据和新 `hash`。

文件读取为整文件语义。大文件由 App 先调用 `project.fs.info` 判定后再读取。

`project.fs.external.info` / `project.fs.external.read` 是 Registry 2.6 的增量只读能力。它们与其他 Project 方法一样要求 envelope 顶层 `projectId`，Registry 通过该项目把请求路由到对应 Hub，但 payload 中的 `path` 必须是 Hub 宿主机上的绝对路径。已认证 client 可以通过这两个方法读取目标 Hub 主机上的任意本地文件；这是文件链接功能明确采用的信任边界。

外部文件方法不接受 `knownHash`，不参与项目文件 cache、目录树、索引、搜索或同步，也不提供目录列举和写入能力。它们不会放宽 `project.fs.info` / `project.fs.read` 现有的项目根目录校验。新 App 连接尚未注册外部文件方法的旧 Hub 时必须返回明确的不支持错误，不得回退到项目文件方法。

> 决策来源：[`docs/scope/2026-07-24-external-file-links/spec-external-file-links.md`](../../scope/2026-07-24-external-file-links/spec-external-file-links.md)

### Git 方法

- `project.git.rev`
- `project.git.refs`
- `project.git.log`
- `project.git.commit.files`
- `project.git.commit.fileDiff`
- `project.git.diff`
- `project.git.diff.fileDiff`
- `project.git.status`
- `project.git.workingTree.fileDiff`

Git 列表按 `project.git.rev` 返回的 `gitRev` / `worktreeRev` 触发刷新，不使用 `knownHash`。

## 7. HubState

HubState 是 Hub 内存缓存；Registry 只鉴权、路由、转发，不缓存、不聚合、不持久化。

所有 `hub.state.*` 请求要求 envelope 顶层 `hubId`。

### `hub.state.get`

读取缓存，不触发刷新：

```json
{
  "method": "hub.state.get",
  "hubId": "hub-a",
  "payload": {
    "sections": ["agentPackages", "skills"]
  }
}
```

### `hub.state.refresh`

刷新指定 section：

```json
{
  "method": "hub.state.refresh",
  "hubId": "hub-a",
  "payload": {
    "sections": ["tokenStats"],
    "force": true
  }
}
```

### `hub.state.action`

执行受控 section action：

```json
{
  "method": "hub.state.action",
  "hubId": "hub-a",
  "payload": {
    "section": "skills",
    "action": "install",
    "params": {}
  }
}
```

### `hub.state.updated`

HubState 变化事件由已认证且 `hubId` 匹配的 Hub 发出，Registry 按客户端 scope 通用转发：

```json
{
  "type": "event",
  "method": "hub.state.updated",
  "hubId": "hub-a",
  "payload": {
    "state": {},
    "sections": ["skills"],
    "reason": "action.completed"
  }
}
```

### Sections

| Section | Refresh | Actions |
| --- | --- | --- |
| `agentPackages` | 扫描 agent npm 包 | `install`、`installMany`、`uninstall`、`reinstall` |
| `wheelmakerUpdate` | 查询 WheelMaker 发布状态 | `updatePublish` |
| `skills` | 扫描已安装 skills | `listSource`、`install`、`uninstall`、`update` |
| `tokenStats` | 返回 Hub 所有的完整 Limits 快照；自动扫描由 Hub 调度，手动 refresh 会等待同一轮扫描 | 无 |
| `fileIndex` | 查询 Hub 内项目索引状态 | `rebuild` |

`fileIndex.rebuild` 参数：

```json
{
  "projectId": "hub-a:WheelMaker"
}
```

`tokenStats` 不接受 Provider action 或凭据参数。Kimi、ZAI、DeepSeek 凭据只在 Hub 本地从 OpenCode auth 读取；Registry 对 HubState payload 按字节透传，不注入、缓存或记录 Provider 密钥。

## 8. Session

Session 请求要求 envelope 顶层 `projectId`。`sessionId` 放在 payload 中。

转发方法：

- `session.list`
- `session.read`
- `session.search`
- `session.create`
- `session.resume.list`
- `session.resume.import`
- `session.reload`
- `session.archive`
- `session.archive.list`
- `session.archive.read`
- `session.archive.restore`
- `session.delete`
- `session.rename`
- `session.pin`
- `session.mark`
- `session.send`
- `session.fork`
- `session.cancel`
- `session.markRead`
- `session.config`
- `session.attachment.start`
- `session.attachment.chunk`
- `session.attachment.finish`
- `session.attachment.cancel`
- `session.attachment.delete`

Hub 上传和 Registry 广播使用同一事件名：

- `session.updated`
- `session.message`

`session.create` 可在 payload 中携带可选的 `createRequestId`。Hub 将其持久化到会话摘要，并在创建响应、`session.list` 与 `session.updated` 中原样返回，使客户端能在请求响应丢失后将已创建会话与本地草稿重新关联。

`session.read` 响应 payload 使用 top-level `sessionId` 和 `turns[]`；turn 内不重复 `sessionId`。

### Session Pin 与颜色 Mark

`session.pin` 与 `session.mark` 是相互独立的 project-scoped Session summary 元数据写入。两者都使用现有 `session_forward` 路由，成功响应携带权威的 Session summary，不发布 `session.updated`；其他客户端在下次 `session.list` 时同步。

`session.mark` 请求：

```json
{
  "method": "session.mark",
  "projectId": "hub-a:WheelMaker",
  "payload": {
    "sessionId": "sess-1",
    "markColor": "red"
  }
}
```

`markColor` 只接受 `"red"`、`"yellow"`、`"green"`、`"blue"` 或用于清除的空字符串。Hub 校验 Session 属于 envelope 指定的 project，并拒绝其他值。

活跃 Session summary 可携带：

```ts
{
  pinned?: boolean
  markColor?: "red" | "yellow" | "green" | "blue"
}
```

缺失 `markColor` 表示无 Mark。Mark 不改变 `pinned`，Pin/Unpin 也不改变 `markColor`。字段与方法都是 Registry 2.6 的兼容性扩展，不修改 protocol version；旧客户端可忽略字段，新客户端不为旧 Hub 提供本地 Mark fallback。

> 决策来源：[`docs/scope/2026-07-26-session-color-mark/spec-session-color-mark.md`](../../scope/2026-07-26-session-color-mark/spec-session-color-mark.md)

### Codex 会话分叉

`session.fork` 从一个已经完成且有精确原生映射的 `prompt_done` 创建独立会话：

```json
{
  "method": "session.fork",
  "projectId": "hub-a:WheelMaker",
  "payload": {
    "sessionId": "source-session",
    "turnIndex": 7
  }
}
```

成功响应：

```json
{
  "ok": true,
  "session": {
    "sessionId": "forked-session",
    "forkedFrom": {
      "sessionId": "source-session",
      "turnIndex": 7,
      "title": "Source session"
    }
  }
}
```

持久化和显示规则：

- 新完成的 `prompt_done.param` 可携带 provider-neutral 的 `forkPoint: {provider, ref}`。Codex 的 `ref` 是原生 turn ID，但通用会话层不保存 `codexTurnId` 之类的 provider 专用字段。
- 老 Codex 历史没有 `forkPoint` 时，`session.read` 通过 `thread/read` 对完整 prompt 序列做精确匹配，只在响应内存中补充映射；不匹配时不猜测，也不重写 WMT2。
- 目标会话复制所选完成 turn 之前的 WMT2 历史、diff artifacts 和被引用附件，并把所有已映射的 `forkPoint` 改写成目标 Codex thread 的 turn ID。源会话和目标会话没有共享的可变历史文件。
- 目标摘要携带 `forkedFrom`，归档 manifest 与恢复流程保留该来源标记。复制历史末尾追加一个已完成的 `session_operation`，其中 `type:"fork"` 且携带相同的 `forkedFrom`，供前端显示被动提示行。
- `forkPoint`、`forkedFrom` 与 `session.fork` 都是增量字段/方法；Registry 协议仍为 2.6，WMT2 文件版本不变。

> 决策与实施计划：[`docs/scope-nospec/2026-07-26-codex-session-fork/plan-codex-session-fork.md`](../../scope-nospec/2026-07-26-codex-session-fork/plan-codex-session-fork.md)

## 9. Registry Relay

Session 的可选 Agent 控制面继续使用 project-scoped forwarding。Goal 增加 `session.goal.create`、`session.goal.get`、`session.goal.update`、`session.goal.stop`、`session.goal.clear`；Session summary 的 `sessionActions.goal` 声明 provider support，`goal` 携带最新 snapshot。它们是 Registry 2.6 的兼容性扩展，不修改 protocol version。字段和状态语义见 [`../agents/session-capabilities.md`](../agents/session-capabilities.md)。

Relay 是 Registry 自有全局控制器，不进入 HubState。

Client 方法：

- `registry.relay.status`
- `registry.relay.enable`
- `registry.relay.disable`
- `registry.relay.regenerateAccessCode`

Registry 下发给 Hub 的内部方法：

- `hub.relay.open`
- `hub.relay.close`

`registry.relay.enable` payload：

```json
{
  "listenPort": 28810,
  "hubId": "hub-a",
  "targetHost": "127.0.0.1",
  "targetPort": 12345,
  "accessCode": "483921"
}
```

约束：

- `accessCode` 必须是 6 位数字。
- `targetHost` 必须是 `127.0.0.1`。
- `listenPort` 与 `targetPort` 必须在 `1..65535`。
- `hubId` 必须指向在线 Hub。

## 10. Hub 间临时 Web 传输

临时 Debug Web 由构建源码的 Target Hub 通过 Registry 在线分块传给选定的 Web Hub。Registry 认证发送方与目标 Hub、维护短暂传输会话、按序转发分块并传回确认，但不在内存以外保存 ZIP，也不提供公开下载地址。

Web Hub 必须在线。它把分块写到本地临时文件，只有在最终大小与 SHA-256 均匹配后才原子替换 `~/.wheelmaker/web`。任一 Hub 断线、分块失序或校验失败都会终止会话，且现有 Web 保持不变。源 Hub 持久化构建产物、任务状态和日志，以便用户之后重新发起传输。

Target Hub 发给 Registry 的方法为：

- `hub.debugWeb.transfer.start`：声明 `transferId`、`targetHubId`、`size` 和小写十六进制 `sha256`。
- `hub.debugWeb.transfer.chunk`：携带 `transferId`、从 `0` 开始严格递增的 `sequence` 和 Base64 `data`。
- `hub.debugWeb.transfer.finish`：通知 Web Hub 校验并应用归档。
- `hub.debugWeb.transfer.abort`：中止并清理目标端临时文件。

Registry 转给 Web Hub 的内部方法依次为 `hub.debugWeb.receive.start`、`hub.debugWeb.receive.chunk`、`hub.debugWeb.receive.finish` 和 `hub.debugWeb.receive.abort`。每个已解码分块最多 `4 MiB`，完整归档最多 `512 MiB`；发送方必须等待当前分块得到 Web Hub 确认后才能发送下一个分块。Registry 仅在内存保存传输 ID、两个 Hub ID、声明大小/摘要、已确认字节数和下一序号，不保存 ZIP 字节。

这组方法是 Registry 2.6 的增量内部能力，没有改变协议版本。`hub.release.notify` / `hub.release.apply` 只用于正式 `version` 发布，不能再承载 `debugWeb`。

## 11. Server Data、Speech、TTS、Debug

Server Data 复用已认证的 Registry WebSocket，不新增 HTTP 或 Nginx 路径：

- `server.config.get` 接受空对象，返回 Voice Input、Text-to-Speech、DeepSeek 的 `configured` / `updatedAt` 以及 Model / Voice；响应永远不包含 Key。
- `server.config.update` 接受 `section`、`field`、`action`、可选 `value`，更新成功后返回完整非敏感快照。Key 只接受 `set` / `clear`，Model / Voice 只接受 `set`。
- `server.androidSpeechCredential.get` 接受空对象，只向“有效浏览器设备 Session + `role=client` + `clientName=wheelmaker-android`”返回 Volcengine `accessToken`、版本和 Model。

Android 客户端名称只是当前单用户模型下的便利门禁，不是设备硬件证明；持有有效登录 Cookie 的调用方可以伪造该名称。该方法不会返回 DeepSeek 或 MiMo Key。

`server.config.get` 响应示例：

```json
{
  "voiceInput": {"configured": true, "updatedAt": "2026-07-14T01:02:03Z", "model": "doubao-streaming-asr-2.0"},
  "textToSpeech": {"configured": false, "model": "mimo-v2.5-tts", "voice": "Mia"},
  "deepSeek": {"configured": false}
}
```

`server.config.update` Key 更新示例：

```json
{"section": "voiceInput", "field": "key", "action": "set", "value": "<access-token>"}
```

Speech：

- `speech.start`
- `speech.chunk`
- `speech.finish`
- `speech.cancel`
- 事件：`speech.transcript`、`speech.error`

TTS：

- `tts.synthesize`

Debug：

- `debug.uploadLog`

## 12. 错误

错误 envelope：

```json
{
  "requestId": 1,
  "type": "error",
  "method": "project.fs.read",
  "payload": {
    "code": "NOT_FOUND",
    "message": "file not found",
    "details": {}
  }
}
```

标准错误码：

| 错误码 | 含义 | 是否可重试 |
| --- | --- | --- |
| `INVALID_ARGUMENT` | 参数非法 | 否 |
| `UNAUTHORIZED` | 认证失败 | 否 |
| `FORBIDDEN` | 无权限 | 否 |
| `NOT_FOUND` | 资源不存在 | 否 |
| `CONFLICT` | 状态冲突或重复 requestId | 否 |
| `UNAVAILABLE` | Hub 离线或目标不可用 | 是 |
| `RATE_LIMITED` | 限流 | 是 |
| `TIMEOUT` | 超时 | 是 |
| `INTERNAL` | 内部错误 | 是 |

## 13. Hash 与版本戳

- Hash 算法：`sha256`。
- Hash 输出：`sha256:<hex-lowercase>`。
- 目录 hash：直接子项按 `(kind, name)` 排序后拼接 `kind|name`。
- 文件 hash：原始字节。
- `gitRev`：由 branch、headSha、dirty 归一生成。
- `worktreeRev`：由 `git status --porcelain` 归一生成。
- `projectRev`：当前由 `gitRev + worktreeRev` 派生。

## 14. 版本历史

### 2.6 相比 2.5

1. 协议版本硬切到 `2.6`，不接受 `2.5` 连接。
2. 后端 Key 配置由旧 `security.secret.*` 硬切为 `server.config.*` 非敏感快照与更新。
3. 新增受设备 Session 与 Android 客户端名称门禁的 `server.androidSpeechCredential.get`。

### 2.5 相比 2.4

1. 协议版本硬切到 `2.5`，不接受 `2.4` 连接。
2. 公开方法域统一为 `connect`、`registry`、`hub`、`project`、`session`。
3. Hub 报告改为 `hub.report.projects` / `hub.report.project`，并要求 envelope 顶层 `hubId`。
4. Project 目录改为 `registry.project.list`；Project 广播统一为 `registry.project.report`。
5. Project 文件与 Git 方法统一进入 `project.fs.*` / `project.git.*`。
6. Session 创建与配置改为 `session.create` / `session.config`；Session 事件统一为 `session.message` / `session.updated`。
7. App 面向的维护命令全部迁入 `hub.state.refresh` / `hub.state.action`，公开协议删除 `cmd.*`。
8. File index status/rebuild 迁入 HubState `fileIndex` section；`project.fs.index.search` 保持 Project 级搜索。
9. Relay 公开方法改为 `registry.relay.*`；Registry 下发 Hub 的内部方法改为 `hub.relay.*`。
10. 已删除旧公开方法：`connection.closing`、`registry.reportProjects`、`registry.updateProject`、`registry.session.*`、`project.list`、`project.sync.check`、`project.syncCheck`、`project.online`、`project.offline`、`session.new`、`session.setConfig`、`session.token.*`、裸 `fs.*`、裸 `git.*`、`cmd.*`、裸 `relay.*`。

### 2.4 相比 2.3

1. 协议版本硬切到 `2.4`，不接受 `2.3` 连接。
2. 引入 `hub.state.get`、`hub.state.refresh`、`hub.state.action`、`hub.state.updated`。
3. Hub 级请求开始收敛到 envelope 顶层 `hubId`。

### 2.3 相比 2.2

1. 协议版本硬切到 `2.3`。
2. Codex agent identity 收敛为 `codex`。
3. 旧 Codex ACP 路径下线。

### 2.2 相比 2.1

1. 协议版本硬切到 `2.2`。
2. 同步策略切换为 pull-only。
3. Hub 事件与 Session 方法开始收敛。
