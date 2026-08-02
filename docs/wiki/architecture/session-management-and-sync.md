> 摘要：本页维护 Session 数据模型、Turn 语义、持久化、Hub 内存 Queue、同步和归档的当前稳定机制。

# Session 对话管理与同步

> 来源：本页整理自 [`../../references/session-management-and-sync.zh-CN.md`](../../references/session-management-and-sync.zh-CN.md) 的当前稳定部分；完整原文第 8 节是评审阶段设计，不作为 wiki 当前事实。原始路径为 `docs/session-management-and-sync.zh-CN.md`。
>
> Queue 决策来源：[`../../scope/2026-07-31-server-owned-session-queue/spec-server-owned-session-queue.md`](../../scope/2026-07-31-server-owned-session-queue/spec-server-owned-session-queue.md)

本文是 session 对话链路的基础协议、存储说明、turn-first 同步、状态和显示重构的主文档。旧的 `session_prompts`、`turns_json`、`promptIndex` 游标和一次性迁移工具都已移除；运行期协议只暴露 session 级全局 `turnIndex`。

Agent 的 Steer、Goal 等可选 Session 能力统一见 [`../agents/session-capabilities.md`](../agents/session-capabilities.md)。普通 prompt start/done 边界对 Goal 有一个明确例外：active Goal 可以跨多个 provider Turn 保持同一个 running execution，只有暂停/终态/clear 且当前物理 Turn 完成后才写最终 `prompt_done`。Goal snapshot 随 `SessionAgentState` 持久化并通过现有 `session.updated` 同步；active Goal 在 Hub 重启时主动恢复，paused/terminal Goal 仍保持懒加载。

## 1. 数据模型

SQLite 只保存会话索引和热状态，不保存对话正文：

- `sessions.id`：ACP session id，也是 app/web 侧的 session id。
- `sessions.project_name`：项目名。
- `sessions.status`：会话生命周期状态。
- `sessions.agent_type` / `sessions.agent_json`：agent 类型和运行态快照。
- `sessionFeatures`：从已协商 ACP capabilities 投影的稳定展示能力。当前可含 `messageLifecycle:{version:1}`，随活跃 summary/read 返回；新归档也保存该投影。
- `sessions.title`：会话标题，通常由最新用户 prompt 更新；服务端和 app 不再用 session id 或消息内容合成 fallback 标题。
- `sessions.created_at` / `sessions.updated_at`：创建时间和最后活动时间。`updated_at` 只在 session 创建、prompt start 和 prompt done 时推进，保存时不会被更旧的事件时间回退；中间 turn、usage update 和 compact 等 session operation 都不推进。运行时快照持久化只保存 agent 状态，不回写推进 `updated_at`；内存中按 turn 推进的 `lastActiveAt` 仅供 Suspended 会话驱逐判断，不进入 `updated_at`。因此 `updated_at` 的排序、折叠、归档候选和 age 展示口径统一为"最后一次 prompt start/done"。
- `sessions.session_sync_json`：同步投影，保存服务端内部落盘进度和会话级 read/done cursor：

```json
{
  "latestPersistedTurnIndex": 132,
  "lastDoneTurnIndex": 132,
  "lastDoneSuccess": true,
  "lastReadTurnIndex": 128,
  "pinned": true,
  "markColor": "blue"
}
```

- `latestPersistedTurnIndex` 表示已经写入 turn 文件的最大 turn。它不直接暴露给 app/web。
- `lastDoneTurnIndex` 表示最近一个 `prompt_done` turn。
- `lastDoneSuccess` 由 `prompt_done.param.stopReason !== "failed"` 推导。
- `lastReadTurnIndex` 表示该 session 已被任意客户端查看到的最大 done turn。当前没有 viewer 概念，因此是 session 级全局 read cursor。
- `pinned` 是活跃 Session 的共享置顶状态。
- `markColor` 是独立于 Pin 的可选共享颜色标记，只允许 `red`、`yellow`、`green`、`blue`；缺失表示无 Mark。
- 服务端列 session 时会再叠加内存中的 live turn，得到返回给客户端的 `latestTurnIndex`。

## 2. Turn 语义

一个 session 内所有消息共享单调递增的 `turnIndex`，从 1 开始。`prompt_request`、agent message、thought、plan、tool call、permission request/response、`prompt_done` 都是普通 turn。

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
- `content` 是 WheelMaker 内部 WMT2 session turn JSON，包含 `method` 和 `param`；它不是 ACP wire DTO，可以保存 `contentBlocks`、`clientMessageId`、`steered`、`messageId`、完整 `_meta` 和工具展示所需的标准富内容投影。
- source store 和 IndexedDB 原样保存 `content`，不 parse-normalize 后重新 stringify。
- 服务端对客户端暴露的 `turnIndex` 必须连续；语义上为空的 turn 也必须返回一条非空 JSON `content`，不能跳过 index。
- `prompt_request.param` 会写入 `createdAt` 和当前 `modelName`。
- `prompt_done.param` 会写入 `completedAt` 和 `stopReason`。
- 实时消息和 `session.read` 返回都使用 `finished`；旧的 `done` 字段不参与解析。
- tool call 按 tool call id 合并到同一个 turn，并保留标准 tool content、locations、rawInput、rawOutput 与 `_meta`。
- 连续 `agent_message_chunk` 或连续 `agent_thought_chunk` 按稳定 `messageId` 合并到同一个 turn；metadata 深合并，`messageComplete=true` 完成原 turn 而不新增空行。缺失 messageId 的旧历史继续使用相邻同类型回退。
- 文本/思考流式 turn 可以先以 `finished=false` 发布；服务端必须保证一个 session 最多只有当前尾部 turn 是 `finished=false`，不能出现中间 unfinished。
- 当下一个 turn 或 `prompt_done` 到来时，服务端用同一个 `turnIndex` 重发完整内容并标记 `finished=true`，再发布更大的 turn。
- 如果新 prompt 到来时上一个 prompt 还没有 terminal turn，服务端先合成 `prompt_done(stopReason="interrupted")`，再开始新 prompt。

### Request Permission Turn

该行为由 [`../../scope/2026-07-21-request-permission/spec-request-permission.md`](../../scope/2026-07-21-request-permission/spec-request-permission.md) 定义。

ACP `session/request_permission` 不映射为 ToolCall，而是在当前 prompt 内追加一个 `permission_request` turn。用户实际选择后再追加 `permission_response` turn；两个事件使用不同的连续 turnIndex，存储层不原地覆盖 request，显示层按 `permissionId` 折叠为一条紧凑记录。

```json
{"method":"permission_request","param":{"permissionId":"perm_...","title":"Choose","detailsText":"...","options":[{"optionId":"a","name":"Continue","kind":"allow_once"}],"createdAt":"..."}}
```

```json
{"method":"permission_response","param":{"permissionId":"perm_...","requestTurnIndex":20,"outcome":"selected","optionId":"a","optionName":"Continue","respondedAt":"..."}}
```

规则：

- request 和 response 都是完整不可变事件，以 `finished=true` 发布；permission 是否 unresolved 由 prompt 内 turn 序列推导，不复用 turn 的 `finished` 字段。
- `permission_request` 只保存当前 ACP request 的有界展示投影，不保存完整 ToolCallUpdate 或 provider 私有结构。
- `permission_response` 只代表真实用户选择；cancel、failed、interrupted 和 Hub close 不生成伪造 response。
- Web 顺序扫描 prompt：request 加入 unresolved，matching response 移除，`prompt_done` 清空剩余 unresolved。只有最新未结束 prompt 中 unmatched request 才可打开交互。
- 多个 unresolved request 按 request turnIndex FIFO；非当前 session 的列表提示使用 summary 中由 recorder live turns 推导的 `pendingPermissionCount`，不要求预读所有 turns。
- permission 交互复用 `session.message`、`session.read` 和 finished cursor，不增加 permission 专属 read、revision 或 pending-id snapshot。

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

真实 ACP payload 先由严格 wire DTO 解码并映射为 typed internal Agent event；`RecordEvent` 只接收该内部事件和 WheelMaker session 事件，再转成 session turn。这样 ACP 标准字段、正式 `_meta.wm` / `_wm/*` 扩展与 WMT2 私有持久化字段互不混用：

1. `session/new` 更新或创建 `sessions` 投影。
2. `session/prompt` params 生成 `prompt_request` turn。
3. `session/update` 生成 agent/tool/thought/plan/user chunk turn。
4. `session/request_permission` 生成 `permission_request`；用户选择通过 Registry `session.permission.respond` 生成 `permission_response` 并完成等待中的 ACP request。
5. `session/prompt` result 生成 `prompt_done` turn，并触发本 prompt 的 turn 文件落盘。

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
- `session` 信息随 read 返回，包含完整 queue snapshot，方便激活 session 时一次同步 turns、queue 和列表状态。
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

`session.reload` 只在没有 active execution 时允许。它会清除该 session 的内存 turn state、queue waiting/failed item 和 queue 幂等记录，创建新的 queue generation，删除该 session 的 turn 文件，把 `session_sync_json` 的 turn/read/done cursor 重置后从 agent replay 回灌；`pinned` 与 `markColor` 作为独立 Session 元数据保留。

`session.mark` 通过 project-scoped 请求更新 `markColor` 并返回权威 Session summary。空字符串清除 Mark；写入路径拒绝未知颜色。该操作不改变 `pinned`、`updated_at` 或列表排序，也不发布 `session.updated`。发起请求的客户端立即合并响应，其他客户端在下次 `session.list` 时同步。

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
- Session resume、load 或 Registry reconnect 时，permission modal 必须等本次 `session.read` 与本地缓存 reconcile 完成后再由 turn 状态机决定；读取失败或连接断开时不从旧缓存打开 modal。Web 可以为 runtimeKey 保存一个不含 permission identity、也不持久化的 read-ready 门禁，但 pending 真相仍只来自 turns。
- 选中 session 的显示视图由 raw source store 派生完整轻量 Display Index，再由 `react-virtuoso` 只挂载 visible + overscan items。上滑/下滑只改变 virtualizer range，不触发 server read。
- 尾部锁定时新 turn 和 streaming 高度增长跟随到底；用户离开底部后保持当前锚点并显示回到底部 affordance。

### Hub 内存 Session Queue

Prompt 与 compact 共用由 Hub `Session` 持有的 FIFO。Queue 不写入 SQLite、SessionRecorder、turn history 或 Registry；Hub 重启后允许丢失。Queue 非空（包括 failed 后暂停）时 Session 不得被闲置回收，所有 App 断开后 Hub 仍继续调度。Goal、status、fork 等 Session action 不进入 queue，其他 active execution 会阻止下一项启动。

Queue snapshot 包含 `generation`、单调递增的 `revision`、`paused`、`activeItem` 和 `waitingItems`。Item 状态为 `queued`、`running`、`cancelling`、`steering` 或 `failed`；完成、取消或 steer 被 transcript 确认后从 live queue 移除。App 对不同 generation 整体替换；同 generation 只接受更高 revision，不自行 dequeue 或 drain。

客户端生成 Session 内唯一 `itemId`。Hub 以它执行 enqueue 幂等、后续 queue 操作和 transcript 归因：同 ID 同 payload 返回原结果，同 ID 不同 payload 冲突。幂等记录保留到 reload、archive/delete 或 Hub 重启。Queue mutation 按 Hub 接收顺序串行执行，每次可观察变化递增 revision，并通过 `session.updated` 推送完整 snapshot；`session.read` 返回完整 snapshot，`session.list` 只返回 generation/revision、paused、active kind 和 waiting count 摘要。

Active item 成功或 prompt 取消后自动继续下一项；执行失败时 failed item 保留为 active failure 并暂停，`retry` 重试原 item，`cancel` failed item 会移除它并恢复调度。Waiting item 可取消或移到队首。Active prompt 取消进入 cancelling，等待 Agent 的正式 cancelled 结果；active compact 不支持取消。

Waiting prompt 可以尝试 steer。Provider 接受后 item 保持 steering，直到相同 item ID 的 transcript 确认；若错过 active steer 窗口，则成为最高优先级的下一条 prompt；不支持或失败时恢复原位置和 queued 状态。

### Permission 的关闭与强关恢复

正常 prompt cancel 或 Agent failure 由 `prompt_done(cancelled/failed)` 关闭该 prompt 内所有 unmatched permission。协议层可以向等待中的 ACP request 返回 cancelled，但 turn history 不把它记录成用户 response。

permission turns 与所在 prompt 共用持久化边界。Hub 强关时尚未 terminal 的 prompt tail 仍只存在于 recorder 内存；重启后的 `latestTurnIndex` 回退到 `latestPersistedTurnIndex`。如果客户端缓存 cursor 领先服务端，既有 stale read repair 会清除该 live tail并全量重读，因此不会在 resume/load 后留下可操作的幽灵 permission。Registry 短暂断线但原 Hub 仍存活时，live tail 不回退，重连 read 完成后可以重新显示仍 unmatched 的 request。

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

`session.archive`、`session.delete`、`session.reload` 都必须拒绝存在 active execution 的 session。判定以服务端内存态为准：如果 session 仍有 active prompt/compact、其他 execution，或 recorder 中存在未 terminal 的 prompt state，则返回错误；客户端的 `running` 字段只用于禁用按钮。没有 active execution 时，archive/delete 直接清除 waiting/failed queue 和幂等记录，不额外确认。

归档目录：

```text
~/.wheelmaker/db/session-archive/<projectName>/
  archive.pack
  manifest.json
```

其中 `<projectName>` 使用和普通 session 历史相同的 safe path segment。归档只保存 turn 正文和 session summary 元信息；queue 不进入归档。Prompt diff artifacts 不进入归档，`prompt_done.artifacts` 元数据会在归档写入、归档读取和恢复时丢弃。服务端在归档写入、列表、读取和恢复入口会清理旧版留下的 `session-archive/<projectName>/artifacts` 目录。原 session 目录删除时一并删除图片/附件，包括 waiting/failed item 曾上传但未发送的附件；恢复只重建 session 行和 turn 文件。

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

manifest 只保存索引、元信息和稳定 `sessionFeatures`，不保存完整 `agent_json`、`session_sync_json`、route binding 或图片信息。`session.archive.read` 原样返回该 capability 投影；旧 manifest 缺失时保持缺失。`restoredAt` 非空表示该归档记录已恢复，`session.archive.list` 不再返回。`nativeArchivedAt`、`nativeUnarchivedAt` 和 `nativeSyncWarning` 只记录 agent 原生归档同步的 best-effort 结果，不改变 WheelMaker 归档 source of truth。

由于归档 manifest 不保存 `session_sync_json`，Pin 与 Mark 都不会进入冷归档；归档或删除清除这些活跃 Session 元数据，恢复后的 Session 默认未 pin 且无 Mark。

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

ACP/WMT2 边界与 capability 投影见 [`../../scope/2026-08-02-acp-extension-boundary-v27/spec-acp-extension-boundary-v27.md`](../../scope/2026-08-02-acp-extension-boundary-v27/spec-acp-extension-boundary-v27.md)。

### 7.6 App/Web 归档入口

App/Web 在每个 Project 的 session 列表中按 `updatedAt` 自动折叠超过 5 天的会话；只有超过 5 天的 session 数量大于 1 时才显示 `Show N older`，展开状态存于 `sessionStorage`，刷新页面不丢失，重启 app/浏览器后按 sessionStorage 生命周期处理。

聊天侧栏搜索按钮旁有 Archive 按钮；搜索展开或 active 时隐藏。菜单包含：

- `Archive > 7 days`
- `Archive > 14 days`
- `Recover...`

批量 archive 会从所有已知 Project（包含 hidden Project）收集候选，跳过 running session 和无效/缺失 `updatedAt` 的 session，按顺序逐个调用 `session.archive`，不并发、不使用 bulk API，并显示进度和失败摘要。

`Recover...` 进入 Archived mode，复用原 session 列表区域按 Project 分组展示归档记录。点击某条记录时右侧加载只读对话预览；选中的记录显示 Restore 操作，Restore 需要确认弹窗。恢复成功后退出 Archived mode，刷新目标 Project，并打开恢复后的普通 session。
