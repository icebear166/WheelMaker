> 摘要：本页维护 WheelMaker Registry 2.7 的消息封装、方法域、Session Queue、路由、认证和版本约束。

# WheelMaker Registry Protocol 2.7

> 来源：本页由原路径 `docs/registry-protocol.md` 于 2026-07-17 全文迁入 wiki。
>
> Session Queue 决策来源：[`Server-owned Session Queue spec`](../../scope/2026-07-31-server-owned-session-queue.md)
>
> HubState 当前契约同步自：[`Hub State Unification spec`](../../scope/2026-07-31-hub-state-unification.md)

本文定义 WheelMaker Registry 2.7 主协议。App 与 Registry 的 `connect.init.payload.protocolVersion` 必须一致。Hub 主协议相同时获得完整业务能力；2.6 Hub 只可保持 `update_only` 连接，以便通过现有 HubState 更新路径升级；2.6 App 直接拒绝。

HubState 统一使用协议号 2.7，其 Section schema、异步 refresh、Skills 所有权和 Release Job 方法同样按硬切契约发布；Hub 与 Web 必须配套部署，不保留旧 `agentProfiles` 或旧 HubState payload fallback。

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
    "protocolVersion": "2.7",
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
      "protocolVersion": "2.7"
    }
  }
}
```

规则：

- `role` 只能是 `hub`、`client`。
- `role=hub` 必须在 payload 中携带 `hubId`。
- `role=client` 可选携带 `hubId`；携带后 client scope 限定在该 Hub。
- `role=client` 的 `protocolVersion` 必须等于 Registry 当前主协议版本。
- `role=hub` 主协议相同时进入 `normal`；主协议较旧时进入 `update_only`；Hub 主协议较新时仍拒绝。
- 配置了 token 时必须携带并匹配。
- 所有非 `connect.*` 业务请求必须在 `connect.init` 成功后发送。

认证、Hub ID 和角色校验始终先于连接模式判定，`update_only` 不降低认证要求。主协议版本按数值组件比较，不按普通字符串顺序比较。握手 wire contract 不增加维护版本或连接模式字段；旧 Hub 不需要感知受限状态。Registry 在连接内部记录模式，并通过项目列表的 Hub descriptor 向 App 暴露可选的 `connectionMode`。

Hub 只有断开并以当前主协议重新握手后才能从 `update_only` 进入 `normal`，不能通过业务消息提升连接模式。

> 决策来源：[`docs/scope/2026-07-31-update-only-hub.md`](../../scope/2026-07-31-update-only-hub.md)

## 3. 方法域与白名单

| 顶级域 | 归属 | 用途 |
| --- | --- | --- |
| `connect.*` | 连接层 | 初始化、关闭事件 |
| `registry.*` | Registry | Registry 自有目录、Project 报告事件、Relay 控制 |
| `hub.*` | Hub | Hub 报告、HubState、Hub 内部 Relay |
| `release.*` | Release Job | Hub 驱动的版本发布与临时 Web 发布任务 |
| `project.*` | Project | 文件、Git |
| `session.*` | Session | 会话、归档、附件、配置、会话事件 |
| `speech.*` | Registry speech | 语音输入流式通道 |
| `server.*` | Registry adapter | 服务端配置快照、更新与 Android ASR 凭据门禁 |
| `tts.*` | Registry TTS | 服务端文本转语音 |
| `debug.*` | Debug | 调试日志上传 |
| `share.*` | Registry | 已认证客户端创建、列出、停止公共 HTML 快照 |

| 角色 | 允许请求 |
| --- | --- |
| `hub`（`normal`） | `hub.report.projects`、`hub.report.project`、`hub.ping`、`session.message`、`session.updated` |
| `hub`（`update_only`） | `hub.ping`；业务上报由 Registry 确认后丢弃 |
| `client` | `registry.project.list`、`registry.relay.*`、`hub.state.*`、`hub.config.*`、`release.publish.*`、`share.*`、`project.*`、`session.*`、`speech.*`、`server.*`、`tts.*`、`debug.uploadLog` |

事件方法由服务端推送，不作为 client request 白名单处理，包括 `registry.project.report`、`hub.state.updated`、`release.publish.updated`、`session.message`、`session.updated`、`connect.close`。

## 4. Hub 上报

`normal` Hub 建连后必须先发全量项目报告，后续按需发单项目报告。两个方法都要求 envelope 顶层 `hubId`。旧 Hub 不知道 `update_only`，仍会发送全量项目报告；Registry 必须返回成功响应但丢弃 payload，否则旧 Reporter 会把握手视为失败。受限连接的后续业务报告和事件同样不进入业务路由，不创建 Project snapshot，也不广播状态。

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

Project report 只承载 Project、Git、Session 与 Agent 配置元数据，不承载 Skills inventory 或 `agentProfiles`。Project Skills 统一属于 HubState `skills` Section。

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
      {
        "hubId": "hub-a",
        "connectionMode": "normal"
      }
    ]
  }
}
```

Hub 目录与 Project snapshot 分离。Registry 在 Hub 握手成功时登记连接，而不是等到首次项目报告。`update_only` Hub 会出现在 `hubs` 中并携带 `connectionMode: "update_only"`，但不会在 `projects` 中产生空项目或伪造项目状态。字段缺失时 App 按 `normal` 处理。

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

`project.fs.external.info` / `project.fs.external.read` 是 Registry 2.7 的只读能力。它们与其他 Project 方法一样要求 envelope 顶层 `projectId`，Registry 通过该项目把请求路由到对应 Hub，但 payload 中的 `path` 必须是 Hub 宿主机上的绝对路径。已认证 client 可以通过这两个方法读取目标 Hub 主机上的任意本地文件；这是文件链接功能明确采用的信任边界。

外部文件方法不接受 `knownHash`，不参与项目文件 cache、目录树、索引、搜索或同步，也不提供目录列举和写入能力。它们不会放宽 `project.fs.info` / `project.fs.read` 现有的项目根目录校验。新 App 连接尚未注册外部文件方法的旧 Hub 时必须返回明确的不支持错误，不得回退到项目文件方法。

> 决策来源：[`docs/scope/2026-07-24-external-file-links.md`](../../scope/2026-07-24-external-file-links.md)

### Git 方法

- `project.git.rev`
- `project.git.refs`
- `project.git.log`
- `project.git.commit.files`
- `project.git.commit.fileDiff`
- `project.git.commit.diff`
- `project.git.diff`
- `project.git.diff.fileDiff`
- `project.git.status`
- `project.git.workingTree.fileDiff`

Git 列表按 `project.git.rev` 返回的 `gitRev` / `worktreeRev` 触发刷新，不使用 `knownHash`。

`project.git.commit.diff` 一次返回整个提交的 `git show --no-color --unified=N <sha>` 原始输出（payload `{sha, contextLines?}`，响应 `{sha, diff}`），不带路径过滤；逐文件拆分由 App 完成。它是路由表纯增量注册，不变更 protocol version。

> 决策来源：[`docs/scope/2026-08-06-git-commit-diff-page.md`](../../scope/2026-08-06-git-commit-diff-page.md)

## 6A. Public Share methods

`share.*` is a client-only Registry route. Requests remain authenticated over the
existing Registry WebSocket; anonymous recipients never connect to Registry. The
route does not change the Registry protocol version.

### `share.create`

Payload fields are `{projectId, path, kind, title, expiry, encoding, content}`. `kind`
is `markdown` or `html`, `expiry` is `1h`, `1d`, `7d`, `30d`, or `permanent`, and
`encoding` is `gzip+base64`. The complete decoded UTF-8 HTML is capped at 16 MiB and
the request must fit the existing complete-message limit. The response returns a new
43-character bearer token, the current configured Share URL when enabled, and its
creation/expiry timestamps.

### `share.list` and `share.delete`

`share.list` accepts an opaque cursor and optional limit (default 50, maximum 100),
returns active records newest first, and reports whether the current Share origin is
enabled. `share.delete` accepts a token and is idempotent. Registry owns expiry repair
and cleanup on disk; no access statistics or tombstones are recorded.

## 7. HubState

HubState 是 Hub 内存缓存；Registry 只鉴权、路由、转发，不缓存、不聚合、不持久化。

所有 `hub.state.*` 请求要求 envelope 顶层 `hubId`。

HubState 包含 Hub 进程级 `instanceId` 和 Section map。Section 使用独立 revision；每次事件都携带完整 Section，不传局部 patch：

```json
{
  "hubId": "hub-a",
  "instanceId": "hub-state-instance",
  "sections": {
    "skills": {
      "availability": "ready",
      "updateStatus": "idle",
      "revision": 7,
      "updatedAt": "2026-07-31T10:00:00Z",
      "lastAttemptAt": "2026-07-31T10:00:00Z",
      "data": {}
    }
  }
}
```

`availability` 为 `empty | ready`，`updateStatus` 为 `idle | queued | updating`。更新期间保留最近成功的 `data`；失败通过 `lastError` 表达，不清空旧数据。普通 queued、非 Usage 扫描开始和无变化成功结果不要求产生事件；`tokenStats` 保留 scanning/terminal 可见状态。

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

异步刷新指定 Section。请求只负责入队，不等待扫描完成：

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

响应立即返回当前状态和每个 Section 的入队结果：

```json
{
  "accepted": true,
  "updates": [
    {
      "section": "tokenStats",
      "updateId": "tokenStats:42",
      "status": "queued"
    }
  ],
  "state": {}
}
```

同一 Section 已 queued/updating 时返回合并后的现有任务；`force=true` 在当前任务运行期间最多安排一次补跑。最终成功或失败通过 `hub.state.updated` 通知。

### `hub.state.action`

执行受控 Section Action：

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

Action 的接收结果、详情查询和来源搜索结果放在 action response 中，不覆盖 Section `data`。异步 Action 最终完成后，Hub 重新采集或直接通知对应完整 Section。

### `hub.state.updated`

HubState 变化事件由已认证且 `hubId` 匹配的 Hub 发出，Registry 按客户端 scope 通用转发：

```json
{
  "type": "event",
  "method": "hub.state.updated",
  "hubId": "hub-a",
  "payload": {
    "instanceId": "hub-state-instance",
    "sections": {
      "skills": {
        "availability": "ready",
        "updateStatus": "idle",
        "revision": 8,
        "data": {}
      }
    },
    "reason": "action.completed"
  }
}
```

Hub 启动运行态初始化结束和 Registry 重连时可发送一次完整 HubState。普通事件只发送发生变化的完整 Section。Registry 断线期间不保留事件历史；Web 重新发现 Hub 后通过 `hub.state.get` 读取当前内存快照。

### Sections

| Section | Refresh | Actions |
| --- | --- | --- |
| `agentPackages` | 扫描 agent npm 包 | `install`、`installMany`、`uninstall`、`reinstall` |
| `wheelmakerUpdate` | 查询 WheelMaker 当前安装与发布状态 | `requestUpdate`、`restart` |
| `skills` | 扫描 Hub inventory、Project inventory 和 effective Skills | `reindex`、`listSource`、`detail`、`install`、`uninstall`、`update` |
| `tokenStats` | 请求 Usage Service 刷新完整 Limits 快照 | 无 |
| `fileIndex` | 查询 Hub 内项目索引状态 | `rebuild` |
| `flickerBridge` | 查询 Bridge 配置能力与运行态 | `start`、`stop`、`restart`、`switchMode` |

`fileIndex.rebuild` 参数：

```json
{
  "projectId": "hub-a:WheelMaker"
}
```

`tokenStats` 不接受 Provider action 或凭据参数。Usage Service 负责 Hub 启动扫描、10 分钟周期扫描、API Key 变更扫描和手动 refresh singleflight；HubState 不重复调度启动扫描。Kimi、ZAI、DeepSeek 凭据只在 Hub 本地读取；Registry 对 HubState payload 按字节透传，不注入、缓存或记录 Provider 密钥。

`skills` 是 Hub 菜单、Project Skills 与 Composer 自动提示的唯一来源。Project report 不再提供 `agentProfiles`。`.agents` / `.claude` inventory 差异属于 `skills` 数据中的非敏感诊断，不触发 Registry 业务处理。

正常 Hub 的 `hub.state.action` 可以对 `wheelmakerUpdate` 发送 `requestUpdate` 或 `restart`。`restart` 只返回 accepted 结果并触发托管 runtime 重启，不下载或部署新版本；Hub 必须先写回 response，再异步调用 `deploy.mjs runtime restart`。runtime 重启可能同时重启同一 guardian 管理的 Registry worker。

## 7A. HubConfig

HubConfig 是 Hub 的持久化配置，存放在 Hub 本地 `<stateDir>/db/hub-config.json`；Registry 同样只鉴权、路由、转发。所有 `hub.config.*` 请求要求 envelope 顶层 `hubId`（与 `hub.state.*` 同路由）。

旧版 Hub 不支持这两个方法时会返回 unknown-method 错误，客户端应据此降级（隐藏或禁用对应设置项），protocol version 不因此变更。

### `hub.config.get`

读取配置的脱敏快照。**secret 值永不出 Hub**：每个 API key 只返回 `configured` / `updatedAt` 标记。

```json
{
  "method": "hub.config.get",
  "hubId": "hub-a",
  "payload": {}
}
```

响应：

```json
{
  "hubId": "hub-a",
  "config": {
    "flickerBridge": {"mode": "v1", "enabled": true},
    "apiKeys": {
      "kimi": {"configured": true, "updatedAt": "2026-07-29T12:00:00Z"},
      "qwen": {"configured": false},
      "zai": {"configured": false},
      "deepSeek": {"configured": false},
      "flicker": {"configured": true}
    }
  }
}
```

### `hub.config.update`

单字段部分更新，响应与 get 相同（更新后的脱敏快照）：

```json
{
  "method": "hub.config.update",
  "hubId": "hub-a",
  "payload": {
    "section": "apiKeys",
    "field": "kimi",
    "action": "set",
    "value": "sk-..."
  }
}
```

允许的 `section.field`：

| Section | Field | Action | 说明 |
| --- | --- | --- | --- |
| `apiKeys` | `kimi` / `qwen` / `zai` / `deepSeek` / `flicker` | `set`（1 B–16 KiB）/ `clear` | 写入 Hub 本地 hub-config.json；**重启 Hub 后生效**。hub-config.json 是唯一 Key 来源，`clear` 后对应 Key 立即显示为未配置；旧 `config.json` 中的 `api_keys` 仅为启动兼容而接受，加载时整体忽略并记录迁移 warning |
| `flickerBridge` | `enabled` | `set`（启用）/ `clear`（禁用） | 持久化开关，即时 start/stop bridge；Hub 启动时 enabled=true 会自动 start |
| `mcpServers` | server `id` 或空（add） | `add` / `update` / `delete` / `enable` / `disable` / `preview` / `import` | Hub 级 MCP 配置；支持 STDIO 与 Streamable HTTP。secret env/header 只返回 `configured` / `updatedAt`，Codex/Claude 原生配置导入先返回脱敏预览；MCP 能力不匹配或运行时连接失败只更新 HubState 状态，不阻塞普通会话 |

`mcpServers` 的 `preview` / `import` value 为 `{"source":"codex"|"claude","raw":"..."}`；预览会返回可导入服务器、冲突和首批不支持字段。`import` 是一次性批量写入，不修改原生配置文件，也不建立持续同步。Codex 的 `-c mcp_servers.*` 是叠加覆盖，未被 Hub materialize 的用户原生 `config.toml` 内容仍由 Codex 保持。

Flicker Bridge 的 API key 不需要用户填写：未显式设置 `apiKeys.flicker` 时，Hub 使用 loopback-only 的内置占位门禁 `00000000000000000000`。设置面板只保留 Off/V1/V2：选择 V1/V2 会持久化 enabled 并立即启动对应模式，Off 会立即停止且 Hub 下次启动不会加载 Bridge。底层 start/stop/restart/switchMode 仍走 `hub.state.action` 的 `flickerBridge` section，但 UI 不再提供独立的临时 Start/Stop toggle。

## 7B. Release Publishing

Release Publishing 是持久化长任务，不属于 HubState。所有 `release.publish.*` 请求要求 envelope 顶层 `hubId`，表示拥有源码 checkout 并执行发布命令的 Publishing Hub。

### `release.publish.start`

创建 `version` 或 `debugWeb` Job：

```json
{
  "method": "release.publish.start",
  "hubId": "publisher-hub",
  "payload": {
    "kind": "version",
    "sourcePath": "D:/Code/WheelMaker",
    "baseUrl": "https://release.wheelmaker.top",
    "desktop": true,
    "android": false,
    "targetHubId": "server-hub",
    "autoPull": true
  }
}
```

`debugWeb` 使用 `webHubId` 指定接收临时 Web 的在线 Hub。响应立即返回 accepted Job；任务状态和日志继续由 Publishing Hub 持久化。

### `release.publish.get`

按 Publishing Hub 和 `jobId` 读取任务：

```json
{
  "method": "release.publish.get",
  "hubId": "publisher-hub",
  "payload": {
    "jobId": "release-job-id"
  }
}
```

### `release.publish.updated`

Publishing Hub 在 Job 阶段或终态变化时发送：

```json
{
  "type": "event",
  "method": "release.publish.updated",
  "hubId": "publisher-hub",
  "payload": {
    "job": {
      "id": "release-job-id",
      "kind": "version",
      "status": "success",
      "targetState": "success"
    }
  }
}
```

Release Publishing 页面通过 `start/get/updated` 工作，不通过 HubState Action，也不以 2 秒轮询维持进度。正式版本发布后的 Hub 通知仍使用内部 `hub.release.notify/apply`；临时 Debug Web 仍使用第 10 节的分块传输方法。

## 7C. Update-only Hub

`update_only` 是 Registry 的永久兼容状态，不是独立协议。Registry 对目标受限 Hub 只放行既有 HubState 更新子集：

- `hub.state.refresh`，且 `sections` 必须只包含 `wheelmakerUpdate`。
- `hub.state.action`，且 `section=wheelmakerUpdate`、`action=requestUpdate`。

方法与 payload 必须同时匹配；`hub.state.get`、其他 section、其他 action 及 Project、Session、文件、Git、Terminal、HubConfig、Skills、发布、Debug Web 和 Relay 请求统一返回 `FORBIDDEN`。App 不承担此权限判断，只在 Hub 展开内容中显示“Protocol 不匹配，仅可更新”，并继续复用现有更新状态和按钮。

Hub 内部仍使用既有 WheelMaker Update HubState adapter、UpdateCommand、更新租约、`staging/status.json` 和 `node deploy.mjs update`。用户必须明确触发更新；受限握手本身不启动更新。`restart` 不属于受限连接能力。该 HubState wire 子集从本能力发布起保持兼容，不增加 maintenance version 或平行 RPC。

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
- `session.queue`
- `session.fork`
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

`session.read` 响应 payload 使用 top-level `sessionId` 和 `turns[]`；turn 内不重复 `sessionId`。响应中的 `session` 信息包含完整 queue snapshot；`session.list` 的 Session summary 只携带 queue generation/revision、paused、active kind 和 waiting count 摘要。

Registry 2.7 的普通 Session summary/read 与新 archive manifest/read 都可携带稳定 capability 投影：

```json
{"sessionFeatures":{"messageLifecycle":{"version":1}}}
```

该字段来自 ACP initialize 的双向扩展协商，决定 App 是否启用 Completed Work；新实时 Session 不按 agent ID 猜测。旧 WMT2/manifest 缺失字段时保持缺失，仅展示层可为历史 codex/cx-deepseek 数据保留回退。

Session summary 的 provider-neutral `sessionActions` 同时投影 ACP native capability 与 WheelMaker WM capability。`sessionActions.fork.historicalTurn=true` 表示可以从带 fork point 的历史 turn 分叉，`currentSession=true` 表示可以从当前 Session 分叉。标准 ACP `fork + loadSession` 声明不会自动开启 current mode；它还需要通过 target 独立 load/继续 prompt E2E 并显式开启 WheelMaker release gate。旧 summary 缺少 mode 时按 `historicalTurn=true, currentSession=false` 解释。App 根据这两个 capability 选择历史消息上的 fork button 或 Session Header/Menu 的 current-session fork 入口，不按 `agentType` 分支。

### Session Queue

`session.queue` 是 prompt 与 compact 的统一入口，替换 `session.send`、`session.compact`、`session.cancel` 和 `session.steer`，不保留旧方法兼容。Payload 使用 action union，action 仅为：

- `enqueue`：提交客户端生成的 `itemId` 与 prompt blocks 或 compact item。
- `cancel`：取消 waiting item、取消 active prompt，或移除 failed item并恢复调度。
- `prioritize`：把 waiting item 移到队首，不中断 active item。
- `steer`：尝试把 waiting prompt steer 到 active prompt；错过窗口时退化为最高优先级的下一条 prompt。
- `retry`：以原 item 重试当前 failed item。

Hub `Session` 是 queue 的唯一所有者和调度者；Registry 只沿既有 project/session 路由转发，不保存 queue。Mutation 按 Hub 接收顺序串行处理。每次成功响应返回最新 Session/queue snapshot，enqueue 响应不等待执行完成。

完整 snapshot 包含 `generation`、单调递增的 `revision`、`paused`、`activeItem` 和 `waitingItems`。Item 状态为 `queued`、`running`、`cancelling`、`steering` 或 `failed`；active compact 以 `cancelSupported:false` 表明不可取消。Queue 状态变化复用 `session.updated` 推送完整 Session/queue snapshot，不增加 queue 专属 read 或 event。

`itemId` 在 Session 内唯一，同时用于 enqueue 幂等、queue 操作、steer 与 transcript 归因。同 ID 同 payload 返回原结果，同 ID 不同 payload 返回冲突。Hub reload/restart 会更换 generation；客户端只在同 generation 内比较 revision。

该 queue 契约随 Registry Protocol `2.7` 发布。Registry、Hub、App 必须同步发布，不接受旧 App 以兼容字段混用。

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

缺失 `markColor` 表示无 Mark。Mark 不改变 `pinned`，Pin/Unpin 也不改变 `markColor`。Registry 2.7 客户端不为旧 Hub 提供本地 Mark fallback。

> 决策来源：[`docs/scope/2026-07-26-session-color-mark.md`](../../scope/2026-07-26-session-color-mark.md)

### Session 会话分叉

`session.fork` 统一使用一个 method。缺少 `turnIndex` 表示当前 session fork；携带 `turnIndex` 表示 historical turn fork。历史 turn fork 要求已经完成且有精确原生映射的 `prompt_done`，显式的零或负数 `turnIndex` 无效：

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

当前 session fork：

```json
{
  "method": "session.fork",
  "projectId": "hub-a:WheelMaker",
  "payload": {
    "sessionId": "source-session",
  }
}
```

Hub 只在 source summary 明确携带 `currentSession=true` 时接受无 `turnIndex` 请求，并在发布本地 child 前用独立 Agent instance 验证 target `session/load`。`claude-agent-acp 0.65.0` 当前未通过该验证（返回的 target ID load 为 `Resource not found`），因此 Claude summary 不发布该 mode，App 不显示入口。

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

- 新完成的 `prompt_done.param` 可携带 provider-neutral 的 `forkPoint: {provider, ref}`。Codex 的 `ref` 是原生 turn ID，但通用会话层不保存 `codexTurnId` 之类的 provider 专用字段。携带 `turnIndex` 时使用该映射；当前 session fork 不伪造历史 fork point。
- 老 Codex 历史没有 `forkPoint` 时，`session.read` 通过 `thread/read` 对完整 prompt 序列做精确匹配，只在响应内存中补充映射；不匹配时不猜测，也不重写 WMT2。
- 目标会话复制所选完成 turn 之前的 WMT2 历史、diff artifacts 和被引用附件，并把所有已映射的 `forkPoint` 改写成目标 Codex thread 的 turn ID。源会话和目标会话没有共享的可变历史文件。
- 目标摘要携带 `forkedFrom`，归档 manifest 与恢复流程保留该来源标记。复制历史末尾追加一个已完成的 `session_operation`，其中 `type:"fork"` 且携带相同的 `forkedFrom`，供前端显示被动提示行。
- Codex 的历史 turn fork 继续通过 `_wm/session/fork/resolve` 与 `_wm/session/fork` 传递 provider ref 和 prompt history；统一 method 由 Hub 将其封装到 `session/fork` 的 `_meta.wm.fork`；通过 release gate 的 Claude-compatible provider 才会把无 `turnIndex` 请求映射到 ACP `session/fork`，且不提供历史 turn fork。
- `forkPoint`、`forkedFrom`、可选 `turnIndex` 与 `session.fork` 属于 Registry 2.7 Session 契约；WMT2 文件版本不变。旧 summary 缺少 fork mode 时保持历史 turn UI 行为。

> 历史 turn fork 决策与实施计划：[`docs/plans/nospec/2026-07-26-codex-session-fork/plan-codex-session-fork.md`](../../plans/nospec/2026-07-26-codex-session-fork/plan-codex-session-fork.md)。Claude ACP 对齐决策：[`docs/scope/2026-08-06-claude-acp-alignment.md`](../../scope/2026-08-06-claude-acp-alignment.md)

## 9. Registry Relay

Session 的可选 Agent 控制面继续使用 project-scoped forwarding。Goal 使用 `session.goal.create`、`session.goal.get`、`session.goal.update`、`session.goal.stop`、`session.goal.clear`；Session summary 的 `sessionActions.goal` 声明 provider support，`goal` 携带最新 snapshot。Hub 到 Agent 的调用按能力映射：Claude steering 使用 native `_session/steering`，通过 release gate 的当前 session fork 使用 `session/fork`，Codex 历史 fork 与 WheelMaker-specific compact/goal/archive 继续使用 capability-gated `_wm/session/*` ACP 扩展。字段和状态语义见 [`../agents/session-capabilities.md`](../agents/session-capabilities.md)。

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

### Gateway 固定端口数据面

Relay 的公网入口由宿主机 Gateway/Caddy 或手工 Nginx 提供，不再由 Registry 在
`listenPort` 上创建独立 TCP listener。Gateway 的固定边缘端口事实源是 Gateway 自己的
`~/.wheelmaker/gateway/config.json` 中的 `relay.listenPort`；Registry worker 不读取该文件，
而只读取 Hub 自己的 `config.json.registry.relayPort`。任一配置为 `0` 时，Registry 进入
client-managed standalone 模式，允许客户端在 enable payload 中提供 Nginx 端口。
Gateway 模式下 App 的 LocalStorage 不能覆盖服务端端口；standalone 模式下 LocalStorage
只作为客户端端口输入的持久化值，Nginx 必须手工保持一致。

当存在 Registry route 时，Gateway 在固定端口按 Registry `publicUrl` 的 scheme 监听
HTTP 或 HTTPS，把所有 URI 和 WebSocket 连接反代到 Registry loopback `9630`，并覆盖写入
`X-WheelMaker-Relay: 1`。Registry `handleHTTP` 在普通 `/ws` 和 HTML preview 路由之前
检查该标记，将请求交给现有 `portrelay.Controller.ServeHTTP`；Controller 继续负责
access code、Relay cookie、HTTP/WS stream、Hub tunnel 和 singleton slot。固定端口上的
`/__wheelmaker/relay/hub` 仍是 Hub 主动连接的 tunnel path。

Gateway 模式下 `registry.relay.enable.listenPort` 必须等于当前固定端口，否则返回
`INVALID_ARGUMENT` 且不发送 `hub.relay.open`；standalone 模式下该字段由客户端提供。
Relay enable/disable 不触发边缘代理 reload；disable 只关闭当前 tunnel/streams，监听器可以
继续存在并返回 `Disabled`/unavailable。Gateway 端口配置移除、变更或 provider 出错时，
Registry 先失效旧 slot，不允许旧 tunnel 继续访问 target。Relay 方法、Hub 方法、frame
协议和 Registry protocol version 均不变；status 额外用 `listenPortManaged` 标识端口是否由
Gateway 管理。

> 固定端口 Port Relay 设计来源：[`docs/scope/2026-08-06-port-relay-fixed-gateway-port.md`](../../scope/2026-08-06-port-relay-fixed-gateway-port.md)

## 10. Hub 间临时 Web 传输

临时 Debug Web 由构建源码的 Target Hub 通过 Registry 在线分块传给选定的 Web Hub。Registry 认证发送方与目标 Hub、维护短暂传输会话、按序转发分块并传回确认，但不在内存以外保存 ZIP，也不提供公开下载地址。

Web Hub 必须在线。它把分块写到本地临时文件，只有在最终大小与 SHA-256 均匹配后才原子替换 `~/.wheelmaker/web`。任一 Hub 断线、分块失序或校验失败都会终止会话，且现有 Web 保持不变。源 Hub 持久化构建产物、任务状态和日志，以便用户之后重新发起传输。

Target Hub 发给 Registry 的方法为：

- `hub.debugWeb.transfer.start`：声明 `transferId`、`targetHubId`、`size` 和小写十六进制 `sha256`。
- `hub.debugWeb.transfer.chunk`：携带 `transferId`、从 `0` 开始严格递增的 `sequence` 和 Base64 `data`。
- `hub.debugWeb.transfer.finish`：通知 Web Hub 校验并应用归档。
- `hub.debugWeb.transfer.abort`：中止并清理目标端临时文件。

Registry 转给 Web Hub 的内部方法依次为 `hub.debugWeb.receive.start`、`hub.debugWeb.receive.chunk`、`hub.debugWeb.receive.finish` 和 `hub.debugWeb.receive.abort`。每个已解码分块最多 `4 MiB`，完整归档最多 `512 MiB`；发送方必须等待当前分块得到 Web Hub 确认后才能发送下一个分块。Registry 仅在内存保存传输 ID、两个 Hub ID、声明大小/摘要、已确认字节数和下一序号，不保存 ZIP 字节。

这组方法属于 Registry 2.7 内部能力。`hub.release.notify` / `hub.release.apply` 只用于正式 `version` 发布，不能再承载 `debugWeb`。

## 11. Server Data、Speech、TTS、Debug

Server Data 复用已认证的 Registry WebSocket，不新增 HTTP 或 Nginx 路径：

- `server.config.get` 接受空对象，返回 Voice Input、Text-to-Speech、DeepSeek 的 `configured` / `updatedAt` 以及 Model / Voice；响应永远不包含 Key。
- `server.config.update` 接受 `section`、`field`、`action`、可选 `value`，更新成功后返回完整非敏感快照。Key 只接受 `set` / `clear`，Model / Voice 只接受 `set`。
- `server.androidSpeechCredential.get` 接受空对象，只向“有效浏览器设备 Session + `role=client` + `clientName=wheelmaker-android`”返回 Volcengine `accessToken`、版本和 Model。
- `registry.codexRadar.efficiency.get` 接受空对象，由 Registry 服务端请求 CodexRadar 实时效率表并返回聚合后的 `source_updated_at` 与 `points`；仅允许 `role=client` 调用。Registry 进程级缓存 TTL 为 10 分钟，过期并发请求合并为一次上游请求；刷新失败时返回最近一次成功快照，无成功快照时返回 `UNAVAILABLE`。

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

### 2.7 相比 2.6

1. 正常 App/Hub 连接硬切到 `2.7`，不读写旧 ACP 私有根字段；`2.6` Hub 只保留 `update_only` 升级通道，`2.6` App 拒绝连接。
2. Session summary/read 与新 archive manifest/read 新增 `sessionFeatures.messageLifecycle:{version:1}`，作为 Completed Work 的实时能力依据。
3. ACP 消息统一使用标准 `content`、`messageId` 和完整 `_meta`；tool rich content 完整进入内部 WMT2 投影，WMT2 仍为 v2。
4. WheelMaker-specific ACP 扩展继续进入 `_meta.wm` 与 `_wm/*`；Claude-compatible native steering 通过已协商的 ACP method 接入，current-session fork 还受真实 lifecycle release gate 约束，Session action 不依赖 provider name 猜测。

决策来源：[`../../scope/2026-08-02-acp-extension-boundary-v27.md`](../../scope/2026-08-02-acp-extension-boundary-v27.md)。

### 2.6 相比 2.5

1. 协议版本硬切到 `2.6`，不接受 `2.5` 连接。
2. 后端 Key 配置由旧 `security.secret.*` 硬切为 `server.config.*` 非敏感快照与更新。
3. 新增受设备 Session 与 Android 客户端名称门禁的 `server.androidSpeechCredential.get`。
4. Session prompt/compact/取消/steer 在 2.6 内硬切为统一 `session.queue` action；删除旧方法且不提供兼容，Registry、Hub、App 必须同步发布。

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
