> 摘要：本页定义 WheelMaker 对 Codex 子 Agent 的发现、Session 化持久化、Registry 同步、只读观测、父会话审批路由和父子整体归档规格。

# 子 Agent 观测

> 状态：已确认，待实现。
>
> 确认日期：2026-08-19。
>
> Review 修订日期：2026-08-19。

## 1. 目标

当 Codex 在一个普通 Session 中派发子 Agent 时，WheelMaker 应持续显示每个子 Agent 的名称、状态和完整语义执行过程。用户刷新页面、Hub 重连或稍后重新打开父 Session 后，仍能查看这些内容。

该能力是**观测能力**，不改变 Codex 自己的多 Agent 编排语义。WheelMaker 不要求父 Agent 等待子 Agent，不替 Codex决定子 Agent 的结束条件，也不把子 Agent 提升成可独立对话的 Session。

首期只接入 Codex App Server，但 WheelMaker 层的数据字段、Registry 投影和前端组件不以 Codex 方法名作为通用业务语义，保留其他 Provider 后续接入空间。

## 2. 产品不变量

- 普通用户会话称为**根 Session**。
- 每个子 Agent 在 WheelMaker 中拥有独立的**子 Session**，并复用普通 Session 的 turn、持久化、实时同步和历史补读能力。
- 子 Session 永远不能成为前端 `activeSession`，不能出现在普通 Session 导航、Recent、跨 Session 搜索结果或独立归档列表中。
- 子 Session 只允许读取。用户不能在其中发送 Prompt、排队、取消、Steer、Retry、Fork、重命名、Pin、Mark、Reload、Archive、Delete 或修改配置。
- 子 Agent 的权限审批由根 Session 承接，审批结果仍发回发起请求的子线程。
- 子 Agent 可以继续派发下一层子 Agent。数据层保留直接父子关系，首期 UI 将同一根 Session 的全部后代平铺显示。
- 子 Agent 与根 Session 一起归档、恢复和删除，不产生独立可访问的孤儿记录。
- 首期用户入口仅覆盖 PC；移动端仍同步并过滤子 Session，但不显示 Subagents 卡片或详情入口。

## 3. Codex 事件模型

Codex 的父线程通过 `collabToolCall` 表达 `spawn_agent`、`send_input`、`wait`、`close_agent` 等协作操作。该 item 是父线程中的协作记录和关系发现入口，不是子 Agent 的完整输出。

子 Agent 作为独立 Codex thread 运行，继续产生普通的 turn/item lifecycle、消息、reasoning、命令、文件修改、MCP 调用和完成事件。完整内容必须从子 thread 接收，不能从父线程的 `collabToolCall` 结果反推。

```text
根 Codex thread
  ├─ collabToolCall：发现 child thread、名称、角色和派发关系
  └─ 根线程普通 turn/item 事件 → 根 SessionRecorder

子 Codex thread
  └─ 普通 turn/item/status 事件 → 子 SessionRecorder
                                      └─ WMT2 + session.message/session.updated
```

实现时必须使用当前已安装 Codex App Server 生成的 schema 校验 `collabToolCall`、thread source、父 thread 字段和状态字段，不把某个 Codex CLI 版本的实验字段直接扩散到 Registry 公共模型。

参考：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)。

## 4. 子 Session 身份与持久化

### 4.1 SQLite

每个子 Agent 创建一条普通 `sessions` 记录。继续使用现有 `sessions` 表，不新增 `session_subagents` 表，也不修改 SQLite schema。

WheelMaker `sessionId` 仍是稳定业务身份；Codex child thread ID 是 Provider runtime identity，二者不得在通用前端模型中混为一个字段。Hub 必须持久化映射，并在重连后重建路由。

子 Session 的关系和观测投影保存在现有 `session_sync_json` 中：

```json
{
  "sessionKind": "subagent",
  "parentSessionId": "wm-parent-session",
  "rootSessionId": "wm-root-session",
  "providerThreadId": "codex-child-thread",
  "spawnItemId": "collab-item-id",
  "spawnedAt": "2026-08-19T10:00:00Z",
  "spawnSequence": 1,
  "subagentName": "Zeno",
  "subagentRole": "worker",
  "subagentStatus": "running",
  "providerReplay": {
    "lastCompletedTurnId": "codex-turn-id"
  },
  "readOnly": true
}
```

规则：

- `parentSessionId` 指向直接派发者对应的 WheelMaker Session。
- `rootSessionId` 始终指向可成为 `activeSession` 的顶层根 Session。
- Provider thread ID 只用于 Hub 路由、恢复和去重，不下沉为前端选择身份。
- Hub 以 `project + agentType + providerThreadId` 做幂等发现；重复收到 spawn、thread list 或 replay 事件不得创建第二条子 Session。
- `spawnedAt` 优先取 Provider 的派发时间，缺失时取 Hub 首次确认父子关系的 UTC 时间；写入后不随状态变化更新。
- `spawnSequence` 是根 Session 内单调递增的稳定序号，由根 Session 的关系写入锁分配；重复发现复用原序号，所有后代共享同一根序列。
- 根 Session 的 `session_sync_json` 保存 `nextSubagentSequence`；恢复时还要与现有后代最大 `spawnSequence` 校准，保证新派发不会复用旧序号。
- `providerReplay.lastCompletedTurnId` 是 durable replay watermark。Provider item/turn identity 同时保留在子 Session turn 的 `_meta.wm` 中，用于恢复活动 turn 时按稳定 item ID 合并，而不是重复追加 WheelMaker turn。
- 子 Session 的 `agent_type` 继承根 Session 的 Agent 类型；首期只会创建 `codex` 子 Session。
- 名称优先使用 Codex 提供的 nickname，其次使用 role，最后使用短 Session ID 生成稳定回退名称。

### 4.2 Turn 正文

子 Session 使用现有 WMT2 路径和格式：

```text
~/.wheelmaker/db/session/<projectName>/<childSessionId>/turns/t000000.bin
```

子 thread 的委派输入被记录为该子 Session 的 `prompt_request`；消息、Thinking、Plan、Tool Call、权限请求、文件变更和最终结果继续转换为普通 WheelMaker turns；子 turn 结束时写入 `prompt_done`。

持久化保存与普通 Session 相同的**完整语义历史**：流式 delta 在 Recorder 中合并为完整消息或工具状态后落盘。首期不额外保存逐条原始 App Server JSONL、原始到达时间或专用审计日志。

## 5. Hub 与 Codex Adapter

### 5.1 路由

Codex App Server connection 必须支持一个根运行时绑定多个 thread：

- 根 thread 继续路由到根 Session。
- 已发现的 child thread 路由到对应子 Session。
- 子 thread 的事件使用自己的 `SessionRecorder` 状态和 turnIndex，不写入父 Session 的 turn 序列。
- 父线程中的 `collabToolCall` 仍按父线程内容显示；不得把子线程完整内容复制进父 Session。

当前仅按根 thread 注册、对未知 thread ID 丢弃通知的行为必须调整。若子 thread 通知早于 spawn 关系事件到达，Adapter 应短暂缓存或通过 thread metadata/read/list 补齐父关系后再投递，不能静默丢失。

App Server transport 可以共享，但 **Adapter 的可变转换状态必须按 provider thread 隔离**。每个 thread 至少独立持有：

- WheelMaker Session/Recorder sink；
- active provider turn ID 和 Prompt 完成边界；
- message phase、message completion 和 pending item update；
- Tool Call、Changed Files/diff 累加状态；
- unresolved permission request；
- replay watermark 和活动 turn 的 item identity。

通知必须先按 `threadId` 定位该 thread state，再执行 item 转换。子 turn 的 start/completed 不得写入根 thread 的 `activeTurnID`、关闭根 Prompt 或清空其他子 thread 的 pending 状态；根 thread 与多个 child thread 可以并发和交错完成。

### 5.2 发现与恢复

子 Session 可从以下来源幂等发现：

1. 父 thread 的 `collabToolCall` spawn 结果；
2. App Server thread metadata 中的 parent/ancestor/source 信息；
3. Hub 重启或 App Server 重连后的 thread list/read 恢复。

恢复顺序必须先重建 `providerThreadId → childSessionId` 映射和 Recorder sink，再恢复或读取可能立即发出通知的子 thread。无法确认根 Session 的 thread 不得发布成普通顶层 Session；应保留诊断日志并等待后续关系修复。

完整恢复流程：

1. 从根和子 Session 的 `session_sync_json` 恢复 provider thread 映射、父子关系、`spawnSequence` 和 replay watermark。
2. 使用 App Server experimental API 分页调用 `thread/list`，显式包含 subAgent source kinds，并以 root/ancestor thread 过滤；不得依赖默认 sourceKinds。
3. 对已持久化但 list 中暂未出现的 child 保留历史投影；`notLoaded` 或 `thread/closed` 只表示运行时驻留/订阅状态，不直接改成 interrupted。
4. 在调用任何可能立即发布通知的 resume/订阅操作之前，先创建或恢复独立 thread state、注册 event sink 和 permission owner。
5. 使用 `thread/read` 的 full items 视图校准快照。跳过 `lastCompletedTurnId` 及其之前的已完成 provider turns；活动 turn 依据 provider turn/item ID 与 `_meta.wm` 合并。
6. 只有可能继续产生事件的 child 才执行 App Server 所需的 resume/订阅恢复；`thread/read` 本身不视为已恢复实时订阅。
7. 完成校准后再开放 Registry 实时发布。校准期间到达的通知按 provider event identity 缓存和去重，然后按原顺序投递。

Hub 在活动 child turn 中途重启时，未落盘 live tail 仍按现有 stale read repair 丢弃；恢复后从该 provider active turn 的完整 item 快照重新构建一次，不与 durable WMT2 前缀重复。Registry 短暂断线但 Hub 未重启时沿用内存 thread state，不执行全量 replay。

如果当前 Codex App Server schema 不提供 subAgent source/ancestor 发现或恢复订阅所需能力，Hub 应将该运行时标记为不支持持久子 Agent 观测并记录明确诊断；不得以普通顶层 Session、静默不完整历史或猜测父关系降级。

### 5.3 状态

WheelMaker 对前端只暴露以下稳定状态：

| 状态 | 含义 |
| --- | --- |
| `initializing` | 已发现派发，但子 thread 尚未开始正常执行 |
| `running` | 子 Agent 正在执行 |
| `waiting_approval` | 存在尚未处理的权限请求；优先级高于普通 running |
| `completed` | 子 Agent 正常完成 |
| `failed` | Provider 明确报告失败 |
| `interrupted` | 被关闭、中断、丢失或无法继续恢复 |

Codex 原生状态由 Adapter 映射到该集合。`waiting_approval` 由子 Session 未解决的 permission turn 派生，不要求 Codex 提供同名 thread status。

状态按以下优先级和转换规则计算：

1. 新的 provider turn started 或 collab agent status=running 将同一子 Session 转为 `running`；因此已完成、失败或中断的 child 在父 Agent 再次 `send_input` 后可以重新进入运行态，不创建新 Session。
2. 活动执行存在 unresolved permission 时显示 `waiting_approval`；permission 被响应后回到 `running`。Prompt/turn 终止时清理未解决 permission，终态优先于陈旧请求。
3. 明确的 turn/collab failure 或影响活动执行的 runtime system error 映射为 `failed`。
4. 正常 turn/collab result 完成映射为 `completed`。后续 runtime `idle`、`notLoaded` 或 `thread/closed` 不覆盖该终态。
5. 只有明确 cancel/interrupt/close 且没有更高优先级的成功结果，或恢复确认活动 child 已永久丢失时，才映射为 `interrupted`。
6. 单独的 `thread/closed`、`notLoaded`、订阅断开或暂时 list 不可见是 transport/liveness 事实，不是业务终态。

归档/delete 的 active 判定使用真实 provider turn、collab running 和 unresolved permission，而不是把 `idle/notLoaded/closed` 当作完成，也不把历史 `completed` 当作永不可重开。

父 Agent 完成不由 WheelMaker强制终止子 Agent。只要 Provider 仍报告子线程活动，子状态和内容就继续同步。

## 6. Registry 契约

### 6.1 Session Summary

`session.list`、`session.read` 和 `session.updated` 的 Session summary 增加可选字段：

```ts
type RegistrySessionSummary = {
  sessionKind?: "subagent"
  parentSessionId?: string
  rootSessionId?: string
  readOnly?: boolean
  subagent?: {
    name: string
    role?: string
    spawnedAt: string
    spawnSequence: number
    status:
      | "initializing"
      | "running"
      | "waiting_approval"
      | "completed"
      | "failed"
      | "interrupted"
  }
}
```

普通根 Session 缺省这些字段，维持当前 payload。Provider thread ID 和 spawn item ID 属于 Hub 内部持久化信息，不要求 Registry 客户端理解。

### 6.2 列表与实时事件

- `session.list` 返回项目下全部热 Session，包括根 Session 和子 Session。
- Registry 不新增子 Agent 专属 list/read/message 方法。
- 子 Session 继续使用普通 `session.message`，payload 顶层 `sessionId` 为子 Session ID。
- 状态、名称或关系变化通过对应子 Session 的 `session.updated` 发布。
- `session.read`、现有 turn pagination/read repair 和 `session.markRead` 对子 Session继续可用。
- 客户端收到尚未出现在本地 summary 集合中的子 `session.message` 时，先保留事件并触发正常 project session list refresh，不得丢弃内容。

### 6.3 服务端只读门禁

前端隐藏操作不是安全边界。Hub 根据持久化的 `sessionKind/readOnly` 拒绝对子 Session 的所有执行和管理请求。允许的例外只有：

- `session.read`；
- `session.markRead`；
- 由根 Session UI 发起、但明确携带目标子 Session/permission identity 的现有审批响应链路；
- Hub 内部的 Recorder、状态同步、父子整体归档/恢复/删除。

拒绝使用稳定的 `FORBIDDEN` 或现有等价 typed error，不启动或恢复独立 Agent instance。

### 6.4 版本与发布

本规格不授权修改 Registry `protocolVersion`。关系字段作为 Registry 2.7 payload 的可选增量字段加入，WMT2 版本保持 v2。

虽然 JSON 字段是可选的，但 `session.list` 开始返回子 Session 是行为变化：未适配的旧前端可能把子 Session 当普通会话显示。Hub、Registry 和 App 应配套发布；该兼容代价已接受，不增加服务端隐藏子 Session 的旧客户端分支。

## 7. 前端状态与展示

### 7.1 Session 索引

前端同步和保存全部 Session summary，但建立两个派生集合：

- **可激活根 Session**：`sessionKind !== "subagent"`；用于 Recent、完整 Session 列表、Project 分组、跨 Session 搜索、归档入口和 `activeSession` 恢复。
- **子 Agent 集合**：`sessionKind === "subagent"`；按 `rootSessionId` 归属于根 Session，只用于 Subagents 卡片、状态提示和详情模态框。

任何 URL 恢复、IndexedDB 恢复、列表点击或搜索结果都不得把子 Session 写入 `activeSession`。即使旧缓存保存了子 Session ID，也必须回退到其 `rootSessionId` 或普通默认选择。

子 Session 的 raw turn store、finished cursor、gap repair 和 `session.read` 与普通 Session 相同。收到实时事件时直接更新目标子 store，不要求详情模态框已打开，也不切换当前会话。

### 7.2 Subagents 卡片

PC Chat 左侧浮动功能列在当前根 Session 存在至少一个子 Agent 时显示 `SUBAGENTS` 卡片，位置在 Plan 上方：

```text
Recent Sessions
Goal（存在时）
Subagents（存在时）
Plan（存在时）
Limits
```

Pin 模式沿用同一相对顺序和现有 edge-surface 视觉语言。没有子 Agent 时不渲染空卡片。

列表规则：

- 查询 `rootSessionId === activeSession.sessionId` 的全部后代；
- 首期不表现嵌套关系，统一平铺；
- 按持久化的 `spawnSequence` 升序、`sessionId` 升序作为兜底，保持稳定派发顺序；状态、消息和 `updatedAt` 变化不得重排；
- 每行展示名称和状态，不展示 Provider thread ID；
- 运行中、等待审批、完成、失败和中断使用现有状态色、Lucide 图标和动效 token，不引入自定义 Agent 图标；
- 卡片可使用现有折叠标题栏，但折叠不停止后台 turn 同步。

### 7.3 PC 详情模态框

点击子 Agent 行后，在 PC 打开大型只读模态框。模态框不是 Session 导航，不改变地址栏、`activeSession`、根 Session read cursor 或 Composer 归属。

内容包括：

- 子 Agent 名称、角色、稳定状态和耗时；
- 原始委派 Prompt；
- 完整消息、Thinking、Plan、Tool Call、Changed Files 和最终结果；
- 正在流式执行时的实时更新；
- `waiting_approval` 时指向父会话审批入口的只读提示。

正文复用普通 Chat 的 raw turn → Display Index → `react-virtuoso` 渲染链路以及 Thinking、Tool Call、Completed Work 折叠规则。模态框不渲染 Composer、Queue、Stop、Retry、Fork、Session 菜单或配置入口。

首期验收范围是 PC（宽屏 `>=900px`）。已确认首期移动端无 Subagents 卡片和详情入口；窄屏仍同步 Session summaries/turns、过滤普通导航和 `activeSession`，不把子 Session 暴露成可点击会话。

## 8. 子 Agent 权限审批

子 Agent 仍可能因命令执行、文件写入或沙箱策略触发权限申请。

- permission request/response 作为子 Session turns 保存，保持真实审计归属。
- permission 的运行时 owner 是根 AgentInstance/App Server connection 下对应的被动 child thread state；该 owner 保存 `childSessionId → provider request/permission identity` 映射，但不把子 Session 注册成可执行的普通 Session，也不启动独立 Agent instance。
- 前端在当前根 Session 下聚合所有后代的 unresolved permission，并使用现有审批弹窗/卡片呈现。
- 审批 UI 明确显示来源子 Agent 名称；多个请求按原 request turnIndex/FIFO 规则处理。
- 用户选择时，Registry 请求仍携带实际子 Session ID 和 permission identity；Hub 把结果发回对应 child thread。
- 子详情模态框只显示等待状态，不提供第二个可操作审批入口，避免重复响应。
- 当前根 Session 未激活时不在其他会话上弹出子审批；前端从已同步的 child summaries 派生根 Session 的 pending 提示，使用户进入父会话后处理，不把子 permission turn 复制进根 summary 或根 transcript。

审批同步流程：

1. Adapter 先在 child thread state 注册 live provider request，再向子 Recorder 写 `permission_request`，最后发布 child `session.message/session.updated`。
2. 子 Session summary 复用现有 `pendingPermissionCount`。前端从已同步的全部 child summaries 汇总当前 root 的 pending 状态；根 Session 激活时，对 pending child 主动执行 `session.read`，即使详情模态框未打开。
3. 子 turn read 与本地缓存 reconcile 完成后，才允许父会话审批 UI 根据 unresolved request 打开；断线或 read 未完成时不使用陈旧缓存响应。
4. 用户响应携带真实 `childSessionId + permissionId`。Hub 经父子关系定位根 AgentInstance 中的 child owner，完成原 provider request，并只向子 Recorder 写 `permission_response`。
5. Registry 重连但 Hub 存活时，live owner 不变，重新 read 后恢复 UI。Hub/App Server 重启后不得从旧缓存伪造可操作请求；只有 Provider 恢复并重新发出或确认 live request 后才能再次操作。

## 9. 归档、恢复与删除

### 9.1 整体归档

根 Session 和 `rootSessionId` 指向它的全部子 Session 是一个逻辑归档组：

- 用户和批量归档只选择根 Session；子 Session 不作为独立候选出现。
- 根或任一后代仍在运行、初始化或等待审批时，整体归档按现有 active execution 规则拒绝。
- 只要归档组包含子 Session，就不应用普通 Session `latestPersistedTurnIndex < 3` 的直接删除捷径；整组成员都必须进入冷归档。没有子 Session 的普通短会话继续沿用现有规则。
- 每个成员继续写成独立 WMSA/WMT2 segment，但一次 manifest temp-file/rename 必须同时提交整组 entries。
- archive manifest 升级为内部 schema version 2。Reader 同时接受 v1/v2；v1 entry 视为没有子成员的普通根 Session。Writer 将现有 v1 entries 原样提升为 v2 standalone group，不重写 pack segment。
- v2 根 entry 保存 `archiveGroupId=rootSessionId`、`memberSessionIds` 和 `subagentCount`。子 entry 保存 `sessionKind`、`parentSessionId`、`rootSessionId`、`readOnly`、名称、角色、`spawnedAt`、`spawnSequence`、终态、`providerThreadId` 和 `providerReplay`。
- 任一成员读取、压缩、append 或 manifest 提交失败时，不删除任何热 `sessions` 行和热 turn 目录。已 append 但未被 manifest 引用的 bytes 按现有 orphan segment 规则忽略。
- manifest 成功后再删除整组热记录和目录；Provider 原生 archive 仍是 best-effort，失败只记录 warning。

`session.archive.list` 只返回归档组的根 Session，并可携带 `subagentCount`。以根 ID 调用 `session.archive.read` 时继续返回根 turns，同时增加 `subagents[]` 只读 summary（成员 Session ID、名称、角色、状态、派发顺序和关系）。点击归档子 Agent 后仍调用同一个 `session.archive.read` method，但 payload 同时携带 `rootSessionId` 和目标 child `sessionId`；Hub 必须验证该 child 属于该归档组。子 entry 不允许被独立列出、恢复或删除。

### 9.2 整体恢复

恢复根 Session 时原子恢复全部组成员的 WMT2 turns、`sessions` 行和关系投影。实现先在临时目录校验并写完全部成员，再以一个 SQLite transaction 重建整组 rows；失败时清理 staging 并回滚，不能发布部分可见的父子树。恢复成功后只打开根 Session，子 Session 继续保持只读、不可激活。

恢复必须保留 `providerThreadId` 和 `providerReplay`。根 Codex thread 被原生 unarchive/resume 后，如果再次发现同一 child thread，应被动重新绑定到原子 Session 并从 watermark 后继续同步；不得创建重复记录。终态 child 在没有新 Provider 活动时保持归档前状态，暂时找不到或 `notLoaded` 不改成 interrupted；若同一 thread 收到新 turn，则按状态机重新进入 running。Provider 已永久删除时，历史仍可只读查看，只有在确认其原本处于活动状态且无法恢复时才标记 interrupted。

### 9.3 删除

`session.delete` 只接受根 Session 作为用户入口，并级联删除全部后代的 SQLite 记录、热 turn 文件、附件和 WheelMaker 管理的 artifacts。子 Session 的独立 delete 请求由服务端拒绝。

删除或归档前的 running 判定必须包含全部后代，不能只检查根 Session 的 `running`。

## 10. 失败与竞态语义

- 重复 spawn/replay：复用已有子 Session，不复制 turns。
- child event 早于关系发现：暂存并补关系，不投递到根 Session，也不创建可激活顶层 Session。
- child thread 暂时找不到、`notLoaded` 或 `thread/closed`：保留最后语义状态和历史；只有确认原活动执行永久无法恢复时才转为 `interrupted`。
- Hub 重启时存在未落盘 live tail：沿用普通 Session 的 `latestPersistedTurnIndex` 和 stale read repair，不伪造完成内容。
- Registry 断线但 Hub 仍运行：Recorder 继续维护 live state；重连后通过 `session.list`、`session.read` 和正常实时事件恢复。
- 父 Prompt 已完成但子 thread 仍运行：继续同步子内容和状态，WheelMaker不追加父 Prompt 生命周期。
- 名称或角色晚到：通过 `session.updated` 更新 summary，不修改已有 turn identity。

## 11. 非目标

- 从 WheelMaker创建、选择或指挥子 Agent。
- 在子详情中发送 follow-up、Stop、Retry、Steer 或关闭 child thread。
- 把子 Agent 作为独立 active/Recent/Search/Archived Session。
- 首期展示嵌套树。
- 保存逐条原始 App Server JSONL 审计流。
- 首期实现 Claude 或其他 Provider 的子 Agent Adapter。
- 首期新增移动端 Subagents 卡片或详情入口（已确认 PC-only）。
- 改变 Codex 父 Agent 等待、汇总或关闭子 Agent 的原生行为。

## 12. 主要实现边界

服务端预计涉及：

- `server/internal/hub/agent/codexapp_convert.go`：补齐 collab/thread/status DTO 和 provider-neutral 转换。
- `server/internal/hub/agent/codexapp_agent.go`：一对多 thread 路由、逐 thread 转换状态隔离、child lifecycle、重连恢复和审批回送。
- Session/Recorder/SQLite projection：子 Session 创建、关系持久化、只读门禁和父子生命周期。
- Registry protocol model/handler：可选 summary 字段、全部 Session 同步和子 Session action 校验。
- archive store：归档组 manifest、整体提交、只读 child read 和整体恢复。

前端预计涉及：

- Registry Session summary 类型和 project session 派生索引；
- 所有 active/Recent/Search/Archive 入口的根 Session 过滤；
- 子 Session raw turn store 的后台实时 upsert/read repair；
- Plan 上方 Subagents edge surface；
- PC 大型只读详情模态框；
- 子 permission 向根 Session 的聚合与响应路由。

实现必须复用现有 Session turn 和 Chat 展示组件，不建立第二套子 Agent 消息协议或前端 transcript 模型。

## 13. 验收标准

1. Codex 派发一个子 Agent 后，当前根 Session 的 Plan 上方出现 Subagents 卡片，显示稳定名称和实时状态。
2. 子 Agent 消息、Thinking、工具调用、文件变更和最终结果实时进入独立子 Session；父 Session turn 序列不包含这些复制内容。
3. 点击子 Agent 打开 PC 大型只读模态框；关闭后根 Session 和 Composer 状态不变。
4. 刷新页面、Registry 重连和 Hub 重启后，父子关系、状态和已落盘内容可恢复，不重复创建子 Session 或追加重复 provider turn/item；恢复后活动 child 继续收到实时通知。
5. 多层子 Agent 都归属于同一 `rootSessionId`，首期在根卡片中平铺显示。
6. `session.list` 返回根和子 Session；普通 Session 列表、Recent、Search 和 active restore 只使用根 Session。
7. 直接尝试对子 Session enqueue、cancel、fork、rename、archive 或 delete 时，Hub 明确拒绝且不启动 Agent。
8. 子 Agent 触发审批时，根 Session 显示带来源名称的审批 UI；选择结果只写入并回送实际子 Session。
9. 根 Session 或任一后代运行时，整体 archive/delete 被拒绝。
10. 根 Session 归档后，归档预览仍能读取全部子 Agent；恢复后整组关系和内容完整，任何失败都不产生部分恢复。
11. 删除根 Session 后，所有后代 SQLite 行、turn 目录和相关 artifacts 都被删除。
12. 旧普通 Session 不需要 SQLite/WMT2 迁移；Registry 协议号和 WMT2 版本不变。
13. 根 turn 与至少两个 child turns 并发、事件交错和逆序完成时，各自的 active turn、消息、Tool Call、diff 和 prompt_done 完全隔离，根 Prompt 不被子完成事件提前结束。
14. child turn 执行中重启 Hub 后，恢复查询显式包含 subAgent source kinds，durable 前缀不重复，未落盘 tail 从 Provider 快照重建一次并继续实时订阅。
15. 子 Agent 等待审批时刷新页面或 Registry 重连，父 Session 在完成 child read/reconcile 后恢复可操作审批；旧缓存或已失活 provider request 不产生幽灵审批。
16. 完成的 child 被 runtime unload/closed 后仍显示 completed；同一 child 收到后续 send_input/turn started 时，以原 Session 从 completed 转为 running。
17. 平铺列表在状态和 updatedAt 变化、页面刷新及 Registry 重连后仍按 `spawnSequence` 保持顺序。
18. 移动端收到相同子 Session 数据，但普通列表、active restore 和搜索均不暴露子 Session，且首期没有 Subagents 入口。
19. 旧 v1 archive manifest 仍按 standalone Session 读取；v2 根 archive read 返回成员 summaries，child 不能独立恢复，整组恢复后相同 Provider thread 被重新发现时复用原子 Session 和 replay watermark。

## 14. 相关知识

- [`../architecture/session-management-and-sync.md`](../architecture/session-management-and-sync.md)：Session、WMT2、实时同步和归档基础机制。
- [`../agents/codex.md`](../agents/codex.md)：Codex App Server thread/turn 接入边界。
- [`../agents/session-capabilities.md`](../agents/session-capabilities.md)：Session action 与服务端能力门禁。
- [`../protocols/registry.md`](../protocols/registry.md)：Registry 2.7 Session 方法、事件和版本约束。
- [`../frontend-interaction/pc-chat-sidebar-modes.md`](../frontend-interaction/pc-chat-sidebar-modes.md)：PC edge surface 顺序与布局。
- [`../frontend-interaction/chat-turn-presentation.md`](../frontend-interaction/chat-turn-presentation.md)：Thinking、Tool Call 与 Completed Work 展示规则。
