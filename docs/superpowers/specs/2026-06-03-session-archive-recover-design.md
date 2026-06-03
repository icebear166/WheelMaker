# Session 归档、恢复与旧会话折叠设计

日期：2026-06-03

## 目标

改进 Chat 会话导航和跨 Project 的归档管理：

1. 每个 Project 下自动折叠较旧的 session。
2. 在 session 搜索按钮旁增加 Archive 菜单。
3. 支持一次性批量归档旧 session，但不新增服务端批量归档协议。
4. 支持真正的 Recover 流程：先只读预览归档对话，再确认恢复到普通 session list。
5. WheelMaker archive store 是归档/恢复的 source of truth；Codex App 原生 archive/unarchive 只做同步增强。

## 当前上下文

现有 `session.archive` 是 project-scoped Registry 方法。它会把非 running 的普通 session 移出常规 chat list：

- 长 session 写入 `~/.wheelmaker/db/session-archive/<projectName>/archive.pack`，并在 `manifest.json` 中登记。
- 短 session 直接删除，不写 archive pack 或 manifest。
- 当前 v1 文档明确写着：归档后不支持恢复，也没有归档列表/读取 API。

`session.delete` 是 WheelMaker 硬删除，不写 archive store。

ACP 当前只定义了 `session/new`、`session/load`、`session/list`、`session/prompt`、`session/cancel` 等生命周期方法，没有标准的 archive、unarchive、restore 或 delete session 方法。

已确认本机 `codex-cli 0.133.0` 生成的 Codex App Server schema 包含：

- `thread/archive { threadId }`
- `thread/unarchive { threadId }`
- `thread/archived`
- `thread/unarchived`

当前 WheelMaker 的 Codex App adapter 还没有接这两个方法。schema 中没有看到 `thread/delete`。

## 非目标

- 不新增 `session.archive.bulk`。
- 不做持久化的自动归档策略。
- 不做后台定时归档任务。
- 不做 archive search 或 fuzzy search。
- 不允许归档预览直接编辑或发送消息。
- 不删除 `.codex`、`.claude`、`.copilot` 等 agent 原生历史。
- 不重新暴露 `codexapp` 作为公开 agent identity；`codexapp*` 可以继续作为内部 bridge 命名。

## 已确认的产品规则

- 所有时间判断都使用 session 的 `updatedAt`，也就是最后活跃时间。
- “超过 N 天”定义为 `now - updatedAt > N * 24h`。
- `updatedAt` 缺失或无法解析的 session 不参与 older folding，也不进入自动批量归档候选。
- 每个 Project 下超过 5 天的 session 进入 older 分组。
- older session 数量大于 1 时自动折叠；只有 0 或 1 条 older session 时不折叠。
- `Archive > 7 days` 和 `Archive > 14 days` 是一次性操作，不保存长期策略。
- 批量归档由前端逐个调用现有 `session.archive`，完全串行执行，不并发。
- 批量归档覆盖所有已知 Project，包括 Chat UI 中隐藏的 Project。
- 批量归档不受 Project 折叠状态、`Show older` 状态、搜索状态、当前可见行影响。
- 构建批量候选时跳过 running session；执行时如果服务端仍返回 running 或其他错误，以服务端结果为准。
- 批量归档执行前必须先计算候选数量并弹确认。
- Recover 必须是真恢复，恢复后 session 回到普通 session list，可打开查看，也可以继续发送消息。
- Recover 模式复用 chat session 区域，不使用独立列表弹窗。
- 点击归档 session 后，右侧加载只读对话预览，不立即恢复。
- 被选中的归档 row 上显示 Restore 操作。
- 点击 Restore 后弹确认框，确认后才调用恢复协议。
- 恢复成功后退出 Archived 模式，刷新对应 Project 的普通 session list，并打开恢复出来的普通 session。
- 搜索模式和 Archived 模式互斥。
- Archive 按钮放在搜索按钮左侧；搜索展开或搜索 active 时隐藏 Archive 按钮。
- `Show older` 展开状态按 Project 写入 `sessionStorage`，同一 tab 刷新页面不丢；关闭 App/重启后可以重置。

## 前端行为

### 旧 session 折叠

普通 chat session list 中，每个 Project 独立处理：

1. 按 `updatedAt` 把 session 分成 recent 和 older。
2. recent：`now - updatedAt <= 5 * 24h`。
3. older：`now - updatedAt > 5 * 24h`。
4. older 数量大于 1 时，默认隐藏全部 older session，只显示 `Show N older`。
5. older 数量为 0 或 1 时，正常显示，不折叠。
6. 点击 `Show N older` 后显示该 Project 下所有 older session，并显示 `Show less`。

展开状态存入 `sessionStorage`，建议 key：

```text
wheelmaker.chat.olderSessionsExpanded.v1
```

值是按 project id 索引的 JSON object。无效 JSON 或未知 key 直接忽略。

该状态只影响普通 session list 渲染，不影响：

- search results；
- Archived 模式；
- 批量归档候选；
- hidden Project 是否纳入批量归档。

### Archive 菜单

Archive 按钮使用 `codicon-archive`，位置：

- desktop：chat sidebar title actions 中，搜索按钮左侧；
- mobile：mobile chat toolbar 中，搜索按钮左侧。

搜索展开或 active search 存在时隐藏 Archive 按钮。

点击 Archive 按钮打开菜单：

1. `Archive > 7 days`
2. `Archive > 14 days`
3. `Recover...`

点击 `Recover...` 时，如果当前处于搜索模式，先退出搜索，再进入 Archived 模式。

### 批量归档流程

用户点击 `Archive > N days` 后：

1. 前端基于最新 `projectSessionsByProjectId`，从所有已知 Project 收集候选。
2. 候选条件：
   - `updatedAt` 可解析；
   - `now - updatedAt > N * 24h`；
   - `running !== true`。
3. hidden Project 和 collapsed Project 都要纳入。
4. 忽略 `Show older` 状态。
5. 候选数为 0 时，显示轻量提示，例如 `No sessions older than 7 days`。
6. 候选数大于 0 时，弹确认框，显示总数量和 Project 数量，例如：

```text
Archive 38 sessions older than 7 days across 6 projects?
```

7. 用户确认后完全串行执行：
   - 调用 `service.archiveProjectSession(projectId, sessionId)`；
   - 每完成一条就更新进度；
   - 成功则从普通 session list 本地状态中移除；
   - 失败则记录错误并继续下一条。

进度 UI 至少显示：

- 总候选数；
- 已完成数；
- 当前处理 session title 或 Project；
- 成功归档数；
- 失败数。

结束后显示 summary：

```text
Archived X, failed Y
```

如果有失败项，展示 Project 名称、session title 或 id、错误信息。单条失败不得中断剩余候选。

### Archived 模式

Archived 模式替换普通 session navigation body，但保留整体 chat shell。

进入：

- 用户点击 Archive 菜单中的 `Recover...`。
- UI 对所有已知 Project fan-out 调用 `session.archive.list`，包括 Chat UI 中隐藏的 Project。
- 退出普通 session search。

Header：

- 显示 `Archived`。
- 显示 `Cancel` 按钮。
- 点击 `Cancel` 退出 Archived 模式，清空归档选择和只读预览，恢复普通 session list。

左侧列表：

- 按 Project 分组展示归档记录。
- Project 顺序与普通 Project list 一致。
- session row 展示 title、agent tag、原 `updatedAt`、`archivedAt`。
- `session.archive.list` 默认只返回 `restoredAt` 为空的记录，所以已恢复记录默认不显示。

点击 archived row：

1. 调用该 Project 的 `session.archive.read`。
2. 右侧 chat 内容区加载返回的 turns/messages。
3. 该 archived row 进入 selected 状态。
4. selected row 上显示 `Restore` 浮层或 inline 操作按钮。
5. chat 内容区进入只读模式。

只读预览：

- composer 隐藏或禁用。
- 禁止发送、取消、配置更新、附件上传、语音输入。
- 不更新普通 selected chat persistence。
- 不更新 read cursor。
- 不把预览内容写入普通 chat durable cache。

Restore：

1. 用户点击 selected archived row 上的 `Restore`。
2. UI 弹确认框：

```text
Restore this archived session to the active chat list?
```

3. 确认后调用 `session.archive.restore`。
4. 成功后：
   - 退出 Archived 模式；
   - 刷新目标 Project session list；
   - 选中并打开恢复出来的普通 session；
   - 恢复正常 composer 行为。
5. 失败时：
   - 留在 Archived 模式；
   - 保留只读预览；
   - 显示 row-level 或 dialog-level 错误。

## 服务端协议

新增协议都保持 project-scoped，继续走现有 `session.*` Registry forwarding 模型。

### `session.archive.list`

请求：

```ts
type SessionArchiveListRequest = {};
```

响应：

```ts
type SessionArchiveListResponse = {
  sessions: SessionArchiveSummary[];
};

type SessionArchiveSummary = {
  sessionId: string;
  projectName: string;
  title?: string;
  agentType?: string;
  createdAt?: string;
  updatedAt?: string;
  archivedAt: string;
  restoredAt?: string;
  turnCount: number;
  gapCount: number;
  nativeArchivedAt?: string;
  nativeUnarchivedAt?: string;
  nativeSyncWarning?: string;
};
```

行为：

- 读取当前 Project 的 archive manifest。
- 只返回 `restoredAt` 为空的记录。
- 排序：`updatedAt` desc，缺失时用 `archivedAt` desc，再用 `sessionId` 稳定排序。
- archive store 或 manifest 不存在时返回空列表。
- manifest 损坏时返回清晰的 project-level error。

### `session.archive.read`

请求：

```ts
type SessionArchiveReadRequest = {
  sessionId: string;
};
```

响应要尽量贴近现有 `session.read`，方便复用 chat renderer：

```ts
type SessionArchiveReadResponse = {
  sessionId: string;
  session: SessionArchiveSummary;
  turns: RegistrySessionTurn[];
  messages: RegistrySessionMessage[];
  latestTurnIndex: number;
  readOnly: true;
};
```

行为：

- 校验 `sessionId`。
- 从 manifest 查找 entry。
- entry 不存在或已经 `restoredAt` 时返回明确错误。
- 按 `offset` 和 `length` 从 `archive.pack` 读取 WMSA segment。
- 校验 segment header、session id、codec、压缩长度、解压长度、SHA-256。
- gzip 解压。
- 解析 WMT2 turns。
- 使用与普通 `session.read` 相同或共享的转换逻辑，把 turn contents 转为前端可渲染的数据。
- archive gap turn 要作为可读 gap 展示，不要丢弃。
- 不创建普通 session。
- 不更新 read cursor 或普通 session sync。

### `session.archive.restore`

请求：

```ts
type SessionArchiveRestoreRequest = {
  sessionId: string;
};
```

响应：

```ts
type SessionArchiveRestoreResponse = {
  ok: boolean;
  sessionId: string;
  session: RegistrySessionSummary;
  warning?: string;
};
```

行为：

1. 校验 `sessionId`。
2. 加载 archive manifest entry。
3. 如果 `restoredAt` 已存在，返回已恢复错误。
4. 如果普通 session store 中已经存在同 id session，返回 `session already exists`，除非实现计划明确选择幂等 restore。
5. 按 `session.archive.read` 同样的规则读取并校验 archive payload。
6. 从 WMT2 payload 重建普通 session turn files。
7. 重建 `sessions` 表记录：
   - `ID = sessionId`；
   - `ProjectName = current project`；
   - `Status = SessionPersisted`；
   - `AgentType = entry.AgentType`；
   - `Title = entry.Title`；
   - `CreatedAt = entry.CreatedAt`，缺失时用 `entry.ArchivedAt`；
   - `LastActiveAt = entry.UpdatedAt`，缺失时用 `entry.ArchivedAt`；
   - `SessionSyncJSON.latestPersistedTurnIndex = turnCount`。
8. 对支持 native unarchive 的 agent 执行 best-effort native unarchive。
9. manifest entry 写入 `restoredAt = now`，同时记录 native sync metadata。
10. 返回恢复后的 session summary 和 warning。

恢复顺序要谨慎：

- WMSA 校验或 turn decode 失败时，不应留下半恢复的普通 session row 或 turn files。
- native unarchive 失败不回滚 WheelMaker restore。
- 如果普通 session 已恢复但 manifest 标记失败，要返回清晰错误，方便后续 retry 或 repair。

### 现有 `session.archive`

继续使用现有单条归档协议，作为唯一执行归档的服务端方法。

扩展行为：

- WheelMaker archive store 写入成功后，对支持 native archive 的 agent 做 best-effort native archive。
- native archive 失败不回滚 WheelMaker archive。
- 响应可以包含 `warning`。
- manifest 记录 native sync 信息：
  - 成功：`nativeArchivedAt`；
  - 失败：`nativeSyncWarning`。

`latestPersistedTurnIndex < 3` 的短 session 继续直接删除，不写 archive pack 或 manifest。因为没有 WheelMaker archive record，不要求 native archive。

### 现有 `session.delete`

`session.delete` 继续作为 WheelMaker 硬删除：

- 不写 archive pack；
- 不写 manifest tombstone；
- 不调用 Codex native delete，因为当前 Codex App schema 没有 `thread/delete`；
- 仍执行统一 WheelMaker artifact cleanup。

## Archive Manifest 扩展

manifest 可以保持向后兼容，新字段都是 optional。

每个 session entry 增加：

```go
RestoredAt          string `json:"restoredAt,omitempty"`
NativeArchivedAt    string `json:"nativeArchivedAt,omitempty"`
NativeUnarchivedAt  string `json:"nativeUnarchivedAt,omitempty"`
NativeSyncWarning   string `json:"nativeSyncWarning,omitempty"`
```

旧 v1 entry 没有这些字段仍然有效。

`restoredAt` 是 Recover 是否展示该记录的 source of truth。

## Archive Store 读写内部设计

扩展 `sessionArchiveStore` 的读/恢复 helper：

- `ListSessions(ctx, projectName) ([]sessionArchiveManifestEntry, error)`
- `ReadSession(ctx, projectName, sessionID) (entry, contents, error)`
- `MarkRestored(ctx, projectName, sessionID, restoredAt, nativeWarning) (entry, error)`
- `UpdateNativeSync(ctx, projectName, sessionID, fields) error`

WMSA read path：

1. 打开 `archive.pack`。
2. 读取 `offset:length`。
3. 校验 magic `WMSA`。
4. 校验 segment version 和 codec。
5. 校验 segment 内嵌 session id。
6. 校验 compressed / uncompressed length。
7. manifest 中有 SHA-256 时校验 hash。
8. gzip 解压。
9. 解析 WMT2 payload，得到 turn content strings。

restore 写普通 turn files 时，应尽量复用现有 session turn store 边界，而不是另写一份 WMT2 编码逻辑。如果现有 writer helper 不足，可以在 turn store 附近补一个小 helper。

## Agent native archive sync

### 边界

不要让 `client.Client` 直接调用 Codex App runtime 内部对象。native sync 边界应该在 agent 层。

可以新增一个小的 optional interface：

```go
type SessionArchiver interface {
  ArchiveSession(ctx context.Context, sessionID string) error
  UnarchiveSession(ctx context.Context, sessionID string) error
}
```

实现计划可以选择：

- 直接扩展 `agent.Instance`；
- 或让 `client.Client` 对 runtime instance 做 optional capability type assertion。

具体选哪种，以现有 `agent.Instance` 模式下最小、最清晰的改动为准。

### Codex App

`codexappConn` 实现 native sync：

- archive：调用 `thread/archive { threadId }`；
- unarchive：调用 `thread/unarchive { threadId }`。

thread id 解析遵循现有 ACP session id 到 runtime thread id 的映射：

- 如果存在 mapping，使用 runtime thread id；
- 如果没有 mapping，直接使用 ACP session id。

native sync 不应该创建新 thread。如果底层 Codex App thread 已不存在，返回 warning，WheelMaker manifest 仍是 source of truth。

### 其他 agent

其他 agent 不实现 native archive sync。unsupported native sync 不是用户可见错误。

## Resume 风险处理

当前 native resume scan 只排除普通 `sessions` 表里的 managed session id。session 被 archive 后不再存在于 `sessions`，但 agent 原生历史可能仍然存在。如果不处理，已归档 session 可能重新出现在 `Resume session` 入口。

处理方式：

- 扩展 `session.resume.list` 的 managed id 计算。
- managed id 包含普通 `sessions` 表记录，也包含 archive manifest 中 `restoredAt` 为空的 session id。
- 这样已归档未恢复 session 不会通过 native Resume 重新导入。
- Recover 是恢复 WheelMaker archived session 的唯一入口。

该过滤以 WheelMaker archive manifest 为准，而不是以 Codex native archive state 为准。

## 统一 artifact cleanup

WheelMaker-owned session artifacts 应该对所有 agent 统一清理。

当前 cleanup 只对 `agentType == codex` 清理附件目录，这不应该成为长期语义。应改成 provider-neutral cleanup，清理：

```text
~/.wheelmaker/db/session/<projectName>/<sessionId>/attachments
```

或等价的已配置 artifact root。

该 cleanup 只删除 WheelMaker 创建的临时资源，例如上传或转换后的本地附件；不能删除 agent 原生历史。

## 错误处理

批量归档：

- 单条 `session.archive` 失败时记录错误并继续。
- 最终 summary 必须展示失败项。
- native sync warning 不算硬失败。

native sync：

- native archive/unarchive 失败返回或记录 `warning`。
- WheelMaker archive/restore 状态正确更新后，native sync 失败不回滚。
- UI 在 batch summary 或 restore result 中展示 warning。

archive read：

- WMSA segment 损坏、checksum 不匹配、pack 文件缺失、gzip 失败、WMT2 decode 失败，都返回明确错误。
- read 失败不能把记录标记为 restored。

restore：

- archive entry 不存在：返回 `session archive not found`。
- 已恢复：返回 `session archive already restored`。
- 普通 session id 冲突：返回 `session already exists`。
- native unarchive warning 不导致 restore 失败。

## 测试计划

### 服务端测试

- `session.archive.list` 只返回未恢复 entry。
- `session.archive.list` 排序稳定。
- `session.archive.read` 能读取 WMSA/gzip/WMT2，并返回 chat renderer 可用数据。
- `session.archive.read` 拒绝已恢复 entry。
- `session.archive.read` 能暴露 pack 损坏和 hash mismatch。
- `session.archive.restore` 重建 session row 和普通 turn files。
- `session.archive.restore` 设置 `SessionSyncJSON.latestPersistedTurnIndex`。
- `session.archive.restore` 写入 `restoredAt`。
- restore 后 `session.list` 能看到该 session。
- restore 后 `session.read` 能读到历史。
- 对已恢复 entry 再 restore 返回清晰错误。
- `session.resume.list` 排除 archived 但未 restored 的 session id。
- artifact cleanup 对非 codex agent 也执行。
- Codex App native archive 调用 `thread/archive`。
- Codex App native unarchive 调用 `thread/unarchive`。
- native sync error 作为 warning 返回，不回滚 WheelMaker archive/restore。
- `session.delete` 不调用任何 native thread delete。

### 前端测试

- 超过 5 天的 older session 数量大于 1 时显示 `Show N older`。
- 只有一条 older session 时不折叠。
- `Show N older` 展开后，`Show less` 可以收回。
- 每个 Project 的 older 展开状态可写入/读取 `sessionStorage`。
- Archive 按钮位于搜索按钮左侧。
- 搜索展开或 active 时隐藏 Archive 按钮。
- 批量归档候选包含 hidden Project，并忽略 UI folding。
- 批量归档排除 invalid/missing `updatedAt` 和 running sessions。
- 批量归档执行前弹确认。
- 批量归档串行调用 `archiveProjectSession`。
- 每完成一条，进度递增。
- 单条失败后继续下一条。
- `Recover...` 进入 Archived 模式，并 fan-out 调用 archive list。
- `Cancel` 退出 Archived 模式。
- 点击 archived row 调用 `session.archive.read`。
- Archived preview 只读并禁用 composer actions。
- selected archived row 显示 Restore。
- Restore 先弹确认，再调用 `session.archive.restore`。
- Restore 成功后退出 Archived 模式、刷新 session list、选中恢复后的普通 session。
- Restore 失败后留在 Archived 模式并显示错误。

## 文档更新

实现完成后需要更新：

- `docs/session-management-and-sync.zh-CN.md`：移除“archive v1 不支持 list/read/restore”的旧说明，补充新协议。
- `docs/codex-app-server-acp-bridge.zh-CN.md`：补充 Codex App `thread/archive` / `thread/unarchive` 映射。

## 实现计划阶段待定的技术选择

以下不是产品需求悬而未决，而是实现计划中可以按代码结构选择的技术细节：

- native archive support 是直接扩展 `agent.Instance`，还是通过 optional interface type assertion。
- `session.archive.read` 是直接复用现有 `session.read` 转换路径，还是抽出一个 archived/normal 共享 helper。
- Archived 只读预览使用独立 in-memory store，还是在现有 selected chat state 上加只读分支。

产品行为以本文档为准；这些技术选择应在实现计划中按最小清晰改动确定。
