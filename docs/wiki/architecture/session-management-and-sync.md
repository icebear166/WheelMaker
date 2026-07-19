> 摘要：本页维护 Session 数据模型、Turn 语义、持久化、同步和归档的当前稳定机制。

# Session 对话管理与同步

> 来源：本页整理自 [`../../references/session-management-and-sync.zh-CN.md`](../../references/session-management-and-sync.zh-CN.md) 的当前稳定部分；完整原文第 8 节是评审阶段设计，不作为 wiki 当前事实。原始路径为 `docs/session-management-and-sync.zh-CN.md`。

本文是 session 对话链路的基础协议、存储说明、turn-first 同步、状态和显示重构的主文档。旧的 `session_prompts`、`turns_json`、`promptIndex` 游标和一次性迁移工具都已移除；运行期协议只暴露 session 级全局 `turnIndex`。

## 1. 数据模型

SQLite 只保存会话索引和热状态，不保存对话正文：

- `sessions.id`：ACP session id，也是 app/web 侧的 session id。
- `sessions.project_name`：项目名。
- `sessions.status`：会话生命周期状态。
- `sessions.agent_type` / `sessions.agent_json`：agent 类型和运行态快照。
- `sessions.title`：会话标题，通常由最新用户 prompt 更新；服务端和 app 不再用 session id 或消息内容合成 fallback 标题。
- `sessions.created_at` / `sessions.updated_at`：创建时间和最后活动时间。`updated_at` 在 prompt start 和 prompt done 时都会更新，保存时不会被更旧的事件时间回退。
- `sessions.session_sync_json`：同步投影，保存服务端内部落盘进度和会话级 read/done cursor：

```json
{
  "latestPersistedTurnIndex": 132,
  "lastDoneTurnIndex": 132,
  "lastDoneSuccess": true,
  "lastReadTurnIndex": 128
}
```

- `latestPersistedTurnIndex` 表示已经写入 turn 文件的最大 turn。它不直接暴露给 app/web。
- `lastDoneTurnIndex` 表示最近一个 `prompt_done` turn。
- `lastDoneSuccess` 由 `prompt_done.param.stopReason !== "failed"` 推导。
- `lastReadTurnIndex` 表示该 session 已被任意客户端查看到的最大 done turn。当前没有 viewer 概念，因此是 session 级全局 read cursor。
- 服务端列 session 时会再叠加内存中的 live turn，得到返回给客户端的 `latestTurnIndex`。

## 2. Turn 语义

一个 session 内所有消息共享单调递增的 `turnIndex`，从 1 开始。`prompt_request`、agent message、thought、plan、tool call、`prompt_done` 都是普通 turn。

服务端、app source store、IndexedDB 都使用同一个 raw turn shape：

```ts
type RegistrySessionTurn = {
  turnIndex: number;
  content: string;
  finished: boolean;
};
```

实时 `session.message` 事件 payload 统一为：

```json
{
  "sessionId": "sess-1",
  "turn": {
    "turnIndex": 12,
    "content": "{\"method\":\"agent_message_chunk\",\"param\":{\"text\":\"...\"}}",
    "finished": false
  }
}
```

规则：

- 不再有 `promptIndex`、`turnId`、`updateIndex`。
- `sessionId` 只在 payload 顶层；`turn` 内不重复 `sessionId`。
- 不兼容旧的扁平 `{sessionId, turnIndex, content, finished}` payload。
- `content` 是 session turn JSON，包含 `method` 和 `param`。
- source store 和 IndexedDB 原样保存 `content`，不 parse-normalize 后重新 stringify。
- 服务端对客户端暴露的 `turnIndex` 必须连续；语义上为空的 turn 也必须返回一条非空 JSON `content`，不能跳过 index。
- `prompt_request.param` 会写入 `createdAt` 和当前 `modelName`。
- `prompt_done.param` 会写入 `completedAt` 和 `stopReason`。
- 实时消息和 `session.read` 返回都使用 `finished`；旧的 `done` 字段不参与解析。
- tool call 按 tool call id 合并到同一个 turn。
- 连续 `agent_message_chunk` 或连续 `agent_thought_chunk` 合并到同一个 turn。
- 文本/思考流式 turn 可以先以 `finished=false` 发布；服务端必须保证一个 session 最多只有当前尾部 turn 是 `finished=false`，不能出现中间 unfinished。
- 当下一个 turn 或 `prompt_done` 到来时，服务端用同一个 `turnIndex` 重发完整内容并标记 `finished=true`，再发布更大的 turn。
- 如果新 prompt 到来时上一个 prompt 还没有 terminal turn，服务端先合成 `prompt_done(stopReason="interrupted")`，再开始新 prompt。

### Thinking 实时发布频率

`agent_thought_chunk` 的合并内容仍然实时进入 prompt state，但完整快照的 Registry 发布采用按 session 隔离的限频规则：首个 chunk 立即发布；同一 thinking turn 持续更新时，中间快照发布间隔不短于 60 秒；没有新内容时不重复发布。thinking 被其他 turn 打断、取消或 prompt 完成时，服务端必须先立即发布最新完整快照并标记 `finished=true`，再发布后续 turn。

该规则只减少 `session.message` 实时事件数量，不改变 turn JSON、协议版本、内存合并结果、最终持久化内容或其他 turn 的实时性。来源：[`../../scope/2026-07-19-turn-streaming-and-tool-groups/spec-turn-streaming-and-tool-groups.md`](../../scope/2026-07-19-turn-streaming-and-tool-groups/spec-turn-streaming-and-tool-groups.md)。

## 3. 序列化

完成一个 prompt 时，`SessionRecorder` 会把该 prompt 内尚未持久化的 turns 追加写入二进制 turn 文件，然后更新 `sessions.session_sync_json`。

路径：

```text
~/.wheelmaker/db/session/<projectName>/<sessionId>/turns/t000000.bin
```

文件格式：

- 当前写入格式是 `WMT2` v2，每个文件保存 256 个 turn。
- 文件头固定 8 字节：

```text
0..3  magic = "WMT2"
4..5  version = 2
6     chunkSizeCode = 0
7     reserved = 0
```

- `chunkSizeCode=0` 表示 256 turns/file；后续如需扩展，按 `256 << chunkSizeCode` 推导容量。
- 当前 session turn 存储只接受 256 turns/file，不再兼容旧的 v1/128 文件。
- header 后跟 256 个 slot。
- 每个 slot 保存 body 的 `offset` 和 `len`。
- body 保存对应 turn 的 `content` bytes。
- turn index 由文件号和 slot 推导。
- 已写入文件的 turn 视为 `finished=true`。

写入顺序是先 append body，再同步文件，再写 header slot，再同步 header。header 未写成功时 slot 仍为 0，读路径不会把该 turn 视为存在。

## 4. 服务端读写流程

`RecordEvent` 接收 ACP/session 事件后转成 session turn：

1. `session/new` 更新或创建 `sessions` 投影。
2. `session/prompt` params 生成 `prompt_request` turn。
3. `session/update` 生成 agent/tool/thought/plan/user chunk turn。
4. `session/prompt` result 生成 `prompt_done` turn，并触发本 prompt 的 turn 文件落盘。

`session.read` 请求：

```json
{"sessionId":"sess-1","afterTurnIndex":128}
```

响应：

```json
{
  "sessionId": "sess-1",
  "latestTurnIndex": 132,
  "session": {
    "sessionId": "sess-1",
    "latestTurnIndex": 132,
    "running": false,
    "lastDoneTurnIndex": 132,
    "lastDoneSuccess": true,
    "lastReadTurnIndex": 128
  },
  "turns": [
    {"turnIndex":129,"content":"...","finished":true}
  ]
}
```

读取顺序：

- response 顶层必须带 `sessionId`，客户端必须校验它与请求 session 一致。
- `turns[]` 内不带 `sessionId`。
- `session` summary 随 read 返回，方便激活 session 时一次同步 turns 和列表状态。
- `afterTurnIndex < latestPersistedTurnIndex` 时，从 turn 文件读取持久化增量。
- 如果当前 session 有 live prompt state，再追加内存中 `turnIndex > afterTurnIndex` 且尚未持久化的 turns。
- 返回内容按 `turnIndex` 升序排序，并覆盖 `afterTurnIndex+1..latestTurnIndex` 的连续区间。
- 语义缺失的 durable slot 在 read projection 中合成 `session/gap` turn，不写回 WMT2。
- `turns` 为空只允许在 `latestTurnIndex <= afterTurnIndex`。
- read response 最多包含一个 `finished=false` turn，且只能是返回区间的最后一条。

`session.markRead` 请求：

```json
{"sessionId":"sess-1","lastReadTurnIndex":132}
```

服务端把 `lastReadTurnIndex` 按 `max(old, incoming)` 写入 `session_sync_json`，并返回更新后的 session summary。客户端只在用户打开 session，或当前可见 session 收到 `prompt_done` 后调用；列表刷新和后台事件不能清 read cursor。

`session.reload` 会清除该 session 的内存 turn state、删除该 session 的 turn 文件、把 `session_sync_json` 重置为 `latestPersistedTurnIndex=0`，然后从 agent replay 回灌。

## 5. App/Web 同步

app/web 只维护 session 级 finished cursor：

```ts
type Cursor = { turnIndex: number };
```

同步规则：

- 本地 raw turn identity 是 `sessionId:turnIndex`，但 wire/read 的 turn body 内不携带 `sessionId`。
- 本地持久缓存只保存 raw finished prefix：`1..Finished Cursor`。
- cursor 是本地已连续缓存 finished turn 的最大 `turnIndex`；如果本地缓存出现缺口，cursor 必须回退到缺口前。
- IndexedDB 保存 raw `turnsJson` 和 `cursorJson`；旧 `messagesJson` 或 chat cache 格式检测失败时，不做兼容迁移，只清理 chat/cache 表，保留全局用户配置，再由 `session.read` 重新补。
- finished prefix 变更后 5 秒 debounce 持久化；切换 session、切后台、断连前需要 flush。
- app/web 不维护有容量上限的运行集合。收到 `session.message` 的 session、被 hydrate 的 session、被 read 的 session、以及用户选择的 session 都进入内存 runtime store，直到页面生命周期结束或显式清除/reload。
- 用户打开 session 时，先 hydrate 本地 finished prefix；如果内存缺失或需要恢复可见内容，再调用 `session.read(after=Finished Cursor)`。
- 用户切回内存中已有 raw store 的 session 时，直接用内存 raw store 重建显示视图；必要的补读由 read repair / 可见恢复逻辑触发。
- 收到已知项目的实时 `session.message` 后，校验顶层 `sessionId` 和 `turn` shape，然后 upsert raw turn；未知 session 同时触发 project session list refresh，但不丢弃该条消息。
- 只有连续的 `finished=true` turn 推进 Finished Cursor。
- 如果 incoming `turnIndex > cursor.turnIndex + 1`，说明漏收，客户端用当前 cursor 调 `session.read` 补读；因此 `cursor=10` 收到 `12/false` 会 read，收到 `11/false` 不 read，之后收到 `12/true` 仍会因为 `12 > 10+1` read。
- 同一 session 最多一个 read in flight；等待期间新 gap 只设置 dirty flag，当前 read 返回后如仍不连续再读一次。
- `session.read` 返回的 turns 视为服务端权威结果，覆盖响应区间，并和等待期间收到的实时消息 reconcile，避免旧缓存覆盖新流式内容。
- `session.message` 只更新 turn store，不更新 title、preview、running、done、read、unread 状态。
- UI 列表状态只看 Session Summary：`running=true` 显示进行中；否则当 `lastDoneTurnIndex > lastReadTurnIndex` 时，`lastDoneSuccess=false` 显示失败未查看，其他情况显示完成未查看。
- 选中 session 的显示视图由 raw source store 派生完整轻量 Display Index，再由 `react-virtuoso` 只挂载 visible + overscan items。上滑/下滑只改变 virtualizer range，不触发 server read。
- 尾部锁定时新 turn 和 streaming 高度增长跟随到底；用户离开底部后保持当前锚点并显示回到底部 affordance。

打开项目、切换 tab、切换 session 时，补读流程异步执行，不阻塞 UI 交互。

## 6. 清理后的边界

当前实现不再包含：

- `session_prompts` 表。
- `SessionPromptRecord` store API。
- `turns_json` 正文存储。
- prompt 文件历史 adapter。
- 启动期旧 prompt 迁移代码。
- `promptIndex` 补读协议。
- app/web 侧 `prompts` read response 缓存。

历史迁移已经完成，后续版本启动时只做当前 SQLite schema 严格校验，不再执行旧结构自动迁移。

## 7. Session 归档

`session.archive` 用于把非运行中的普通 session 移出常规会话系统。服务端按 turn 总数决定后续处理：`latestPersistedTurnIndex < 3` 的短会话直接永久删除；`latestPersistedTurnIndex >= 3` 的会话把已完成正文保留到冷归档文件。冷归档以 WheelMaker manifest 为 source of truth，支持归档列表、只读读取和恢复。

对外协议暴露：

- turn 总数 `< 3`：直接删除 `sessions` 和原 `db/session/<projectName>/<sessionId>` 目录，不写归档 pack、manifest 或 tombstone。
- `session.archive`：turn 总数 `>= 3` 时先写归档 pack 和 manifest，成功后删除 `sessions`，再删除原 `db/session/<projectName>/<sessionId>` 目录。
- `session.archive.list`：按项目列出 manifest 中未恢复的归档 session。
- `session.archive.read`：读取并校验归档 pack，返回只读 turns/messages，不更新 read cursor，不进入普通 selected-chat 持久状态。
- `session.archive.restore`：把归档 turns 写回普通 session turn 文件，重建 `sessions` 行，并在 manifest 中标记 `restoredAt`。
- `session.delete`：硬删除协议，不写归档 pack、manifest 或 tombstone，直接删除 `sessions`、原 session 目录和 WheelMaker 管理的 session artifacts。

`session.archive`、`session.delete`、`session.reload` 都必须拒绝运行中的 session。running 判定以服务端内存态为准：如果 session 仍有 active prompt 或 recorder 中存在未 terminal 的 prompt state，则返回错误；客户端的 `running` 字段只用于禁用按钮。

归档目录：

```text
~/.wheelmaker/db/session-archive/<projectName>/
  archive.pack
  manifest.json
```

其中 `<projectName>` 使用和普通 session 历史相同的 safe path segment。归档只保存 turn 正文和 session summary 元信息；prompt diff artifacts 不进入归档，`prompt_done.artifacts` 元数据会在归档写入、归档读取和恢复时丢弃。服务端在归档写入、列表、读取和恢复入口会清理旧版留下的 `session-archive/<projectName>/artifacts` 目录。原 session 目录删除时一并删除图片/附件，恢复只重建 session 行和 turn 文件。

### 7.1 Manifest

`manifest.json` 是归档索引的 source of truth，按 session id 做 map upsert。时间字段统一为 UTC RFC3339。

```json
{
  "version": 1,
  "updatedAt": "2026-05-17T12:34:56Z",
  "sessions": {
    "019e...": {
      "sessionId": "019e...",
      "projectName": "WheelMaker",
      "title": "...",
      "agentType": "codex",
      "createdAt": "2026-05-12T00:34:13Z",
      "updatedAt": "2026-05-17T12:00:00Z",
      "archivedAt": "2026-05-17T12:34:56Z",
      "restoredAt": "2026-05-20T09:10:11Z",
      "turnCount": 932,
      "gapCount": 0,
      "nativeArchivedAt": "2026-05-17T12:34:57Z",
      "nativeUnarchivedAt": "2026-05-20T09:10:12Z",
      "nativeSyncWarning": "thread/unarchive failed: ...",
      "storage": "pack",
      "file": "archive.pack",
      "offset": 123456,
      "length": 9876,
      "uncompressedLength": 45678,
      "codec": "gzip",
      "sha256": "...",
      "uncompressedSha256": "...",
      "wmt2Version": 2,
      "chunkSizeCode": 2
    }
  }
}
```

manifest 只保存索引和元信息，不保存 `agent_json`、`session_sync_json`、route binding 或图片信息。`restoredAt` 非空表示该归档记录已恢复，`session.archive.list` 不再返回。`nativeArchivedAt`、`nativeUnarchivedAt` 和 `nativeSyncWarning` 只记录 agent 原生归档同步的 best-effort 结果，不改变 WheelMaker 归档 source of truth。

### 7.2 Pack Segment

归档 pack 是 append-only。每个 session 作为一个独立 gzip segment 追加到 `archive.pack`。v1 不做 compact；manifest 未引用的 orphan bytes 会被忽略。

每个 segment 的外层 header：

```text
0..3   magic = "WMSA"
4..5   version = 1
6      codec = 1  // gzip
7      reserved = 0
8..9   sessionIDLen uint16 little-endian
10..17 payloadLen uint64 little-endian
18..25 uncompressedLen uint64 little-endian
26..   sessionID bytes
...    gzip(WMT2 bytes)
```

manifest 的 `offset` 指向 WMSA segment header 起点，`length` 是整个 segment 长度。

### 7.3 WMT2 聚合

segment 解压后的 payload 是一个标准 WMT2 v2 文件，只是 `chunkSizeCode` 可大于 0。容量公式：

```text
turnCapacity = 256 << chunkSizeCode
headerSize = 8 + turnCapacity * 8
```

归档时按 `turnCount` 选择能容纳所有 turns 的最小 `chunkSizeCode`，上限为 `chunkSizeCode <= 10`，即最多 `262144` turns。普通热 session 写入仍固定使用 `chunkSizeCode=0`、`256` turns/file，不改变热路径效率。

归档读取源是 `1..latestPersistedTurnIndex`。如果某个 turn 文件或 slot 缺失，归档写入非空 gap turn 占位，保持 turn index 连续：

```json
{"method":"session/archive_gap","param":{"reason":"missing_turn"}}
```

manifest 记录 `gapCount`。WMT2 slot 不能使用 `len=0` 表示 gap，因为现有格式把 offset 或 len 为 0 视为不存在。

### 7.4 写入和失败语义

归档写入顺序：

1. 校验 session 非 running。
2. 从 `sessions` 读取元信息和 `latestPersistedTurnIndex`。
3. 如果 `latestPersistedTurnIndex < 3`，直接删除 `sessions` 和原 session 目录并结束。
4. 读取普通 turn 文件，丢弃 `prompt_done.artifacts` 元数据，并生成单 session WMT2 bytes，缺 turn 写 gap turn。
5. gzip 压缩 WMT2 bytes，计算压缩前后 SHA-256。
6. 持 project 级进程内锁 append WMSA segment 到 `archive.pack` 并 fsync。
7. 读取并 upsert `manifest.json`，写 temp 文件后 rename。
8. 对支持原生归档能力的 agent 做 best-effort native archive，并把 warning 写入 manifest。
9. 删除 `sessions`。
10. 删除原 `db/session/<projectName>/<sessionId>` 目录。

长会话归档时，1-7 任一步失败都不能删除 active index。8-10 失败时 manifest 已存在；下一次 `session.archive` 对同一 session 应幂等地继续尝试同步原生归档、删除 active index 和原目录。原生归档失败只记录 warning，不回滚 WheelMaker manifest。短会话删除不写归档痕迹。

### 7.5 列表、只读读取与恢复

`session.archive.list` 请求使用 project-scoped forwarding，响应：

```json
{
  "sessions": [
    {
      "sessionId": "019e...",
      "title": "...",
      "agentType": "codex",
      "updatedAt": "2026-05-17T12:00:00Z",
      "archivedAt": "2026-05-17T12:34:56Z",
      "turnCount": 932,
      "gapCount": 0
    }
  ]
}
```

只返回 `restoredAt` 为空的 manifest entries，排序为 `updatedAt desc`、`archivedAt desc`、`sessionId asc`。

`session.archive.read` 请求：

```json
{"sessionId":"019e..."}
```

响应：

```json
{
  "sessionId": "019e...",
  "readOnly": true,
  "latestTurnIndex": 932,
  "session": {"sessionId":"019e...", "archivedAt":"..."},
  "turns": [
    {"turnIndex":1,"content":"...","finished":true}
  ],
  "messages": []
}
```

服务端读取 manifest 指向的 `archive.pack` segment，校验 WMSA header、gzip payload length、压缩前后 SHA-256、WMT2 header 和 turn slots。read 返回只读视图，不调用 `session.markRead`，不恢复 active index，不影响普通 session list。

`session.archive.restore` 请求：

```json
{"sessionId":"019e..."}
```

恢复流程：

1. 读取并校验归档 payload。
2. 如果普通 `sessions` 中已存在同 id，拒绝恢复。
3. 如果 manifest 已有 `restoredAt`，拒绝重复恢复。
4. 删除目标 session id 的 partial turn 文件。
5. 把归档 turns 写回普通 WMT2 turn 文件。
6. 重建 `sessions` 行和 `session_sync_json`。
7. 对支持原生归档能力的 agent 做 best-effort native unarchive。
8. 在 manifest entry 上写入 `restoredAt` 和 native sync metadata。
9. 返回普通 session summary；如果 native sync 失败，响应带 `warning`。

恢复成功后 app 会退出 Archived mode、刷新目标项目 session list，并打开恢复后的普通 session。

### 7.6 App/Web 归档入口

App/Web 在每个 Project 的 session 列表中按 `updatedAt` 自动折叠超过 5 天的会话；只有超过 5 天的 session 数量大于 1 时才显示 `Show N older`，展开状态存于 `sessionStorage`，刷新页面不丢失，重启 app/浏览器后按 sessionStorage 生命周期处理。

聊天侧栏搜索按钮旁有 Archive 按钮；搜索展开或 active 时隐藏。菜单包含：

- `Archive > 7 days`
- `Archive > 14 days`
- `Recover...`

批量 archive 会从所有已知 Project（包含 hidden Project）收集候选，跳过 running session 和无效/缺失 `updatedAt` 的 session，按顺序逐个调用 `session.archive`，不并发、不使用 bulk API，并显示进度和失败摘要。

`Recover...` 进入 Archived mode，复用原 session 列表区域按 Project 分组展示归档记录。点击某条记录时右侧加载只读对话预览；选中的记录显示 Restore 操作，Restore 需要确认弹窗。恢复成功后退出 Archived mode，刷新目标 Project，并打开恢复后的普通 session。
