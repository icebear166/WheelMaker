# ACP Request Permission 交互与 Turn 同步

> 由 scope skill 于 2026-07-21 生成

## 目标

WheelMaker 当前收到 ACP `session/request_permission` 后，会在 `SessionRequestPermission` 内静默选择允许项；请求不会进入 Web、Registry 或 Session history。Kimi 的 `AskUserQuestion` 会把用户选择适配成标准 ACP permission request，因此现状会替用户自动作答，同时用户只能看到 Kimi 另外发送的 `session/update(tool_call)`，看不到真正等待回答的 permission。

本次改动把 `session/request_permission` 建模为 provider 无关的用户交互：请求和用户选择进入既有 turn 流，Web 在请求仍有效时显示会话级选择弹窗，用户选择通过 Registry 回到持有 ACP 请求的 Hub Session。实现复用现有 `session.message`、`session.read`、prompt 落盘和 stale cursor repair，不增加 permission 专属读取协议，也不把 permission 与历史 ToolCall 绑定。

## 决策

- 所有 ACP `session/request_permission` 都需要真实用户选择，不再自动 allow 或自动 reject。
- permission 不关联、查找、生成或更新聊天中的 ToolCall。Agent 另外发送的 `session/update(tool_call)` 继续按现有路径独立记录和展示。
- WheelMaker 只解析当前 permission request 自身携带的标准字段：`sessionId`、嵌套 `toolCall` 的展示字段和 `options`。不依赖 provider 私有 `AskUserQuestion` 结构。
- `toolCall.content` 不是 permission 专属问题字段。实现只把其中标准 text content 投影为可选 `detailsText`；`title` 仍来自 `toolCall.title`，options 来自 permission request 顶层 `options`。
- 不保存完整 `ToolCallUpdate`、原始 JSON-RPC params、`rawInput`、`rawOutput`、diff、图片、resource 或 terminal 内容。只保存有界、规范化后的展示数据。
- permission 使用两个追加式 turn：`permission_request` 和 `permission_response`。存储层不原地覆盖旧 turn；Web 按 `permissionId` 把 response 折叠进 request，最终只显示一行记录。
- 只有用户实际选择选项才产生 `permission_response`。prompt cancel、失败、Agent 断开或 Hub 关闭都不伪造用户 response，也不增加 `permission_closed` turn。
- 正常 cancel/failed 由现有 `prompt_done` 终止该 prompt 内所有未回答 permission；Hub 强关由现有未完成 prompt 回滚和 stale cursor repair 处理。
- 弹窗有效性只分析完成 `session.read` 校正后的 turn 序列，不增加 `pendingPermissionIds`、`permissionRevision` 或 `session.permission.read`。
- 非当前会话仍需要 `pendingPermissionCount` session summary 字段，以便在不读取所有会话 turns 的情况下显示 session icon。
- 多个 permission 按 `permission_request.turnIndex` FIFO 展示，一次只显示一个弹窗。
- 所有已授权 Registry Client 都能响应；第一个合法选择获胜。相同选择重试幂等成功，不同选择或失效请求返回 conflict。
- permission 不设超时。它只在用户选择、prompt/session cancel、Agent 断开、Hub 退出或请求 context 取消时结束。
- Registry 协议版本保持 2.6，不增加兼容分支、capability 协商或旧客户端降级路径。

## 协议与数据模型

### ACP 输入

ACP wire 保持标准结构：

```json
{
  "method": "session/request_permission",
  "params": {
    "sessionId": "sess-1",
    "toolCall": {
      "toolCallId": "call-1",
      "title": "Choose how to continue",
      "content": [
        {
          "type": "content",
          "content": {
            "type": "text",
            "text": "The specification is missing. What should I do?"
          }
        }
      ]
    },
    "options": [
      {
        "optionId": "q0_opt_0",
        "name": "Continue with the plan",
        "kind": "allow_once"
      }
    ]
  }
}
```

`toolCall` 的协议类型按 ACP `ToolCallUpdate` 接收，但进入 Session 后立即投影为 permission 展示数据。它只属于当前 request 的输入，不用于关联已有 `session/update(tool_call)`。

规范化规则：

- `title`：trim 后保存；为空时使用通用文案 `Agent requests your decision`。
- `detailsText`：只拼接 `toolCall.content` 中标准 text content，其他 content kind 忽略。
- `options`：保留原始 `optionId`、人类可读 `name` 和 `kind`；用户响应必须回传原始 `optionId`。
- `title`、`detailsText`、option 数量、`optionId`、`name` 和 `kind` 都必须有常量上限。基线为 title 512 bytes、details text 8 KiB、最多 32 个 options、option id 256 bytes、option name 512 bytes、option kind 64 bytes；超长展示文本安全截断，缺失/重复/超限的 option identity 使请求失败并按 ACP cancelled 收敛。
- 不把 `_meta` 或 provider 私有字段解释成问题正文。

### `permission_request` turn

Hub 为每个当前运行期请求生成 session 内唯一、不可预测的 `permissionId`，注册 pending waiter 后追加 request turn：

```json
{
  "method": "permission_request",
  "param": {
    "permissionId": "perm_...",
    "title": "Choose how to continue",
    "detailsText": "The specification is missing. What should I do?",
    "options": [
      {
        "optionId": "q0_opt_0",
        "name": "Continue with the plan",
        "kind": "allow_once"
      }
    ],
    "createdAt": "2026-07-21T10:00:00Z"
  }
}
```

该 turn 是完整的不可变事件，因此以 `finished=true` 发布。这里的 finished 表示 request 事件已经完整，不表示 prompt 或 permission 已经结束。

### 用户响应协议

Web 通过 project-scoped Registry request 提交选择：

```json
{
  "method": "session.permission.respond",
  "projectId": "hub/project",
  "payload": {
    "sessionId": "sess-1",
    "permissionId": "perm_...",
    "optionId": "q0_opt_0"
  }
}
```

成功响应：

```json
{
  "accepted": true,
  "permissionId": "perm_...",
  "outcome": "selected",
  "optionId": "q0_opt_0"
}
```

服务端必须同时校验 project 路由、session、permission、option identity 和 pending 状态。第一次合法选择完成 waiter；同一 `permissionId + optionId` 的重试返回同一成功结果，其他 option 返回 conflict。不存在、已经系统终止或属于其他 session 的 permission 不得交给 Agent。

### `permission_response` turn

用户选择被原子接受后追加 response turn，再完成 ACP waiter：

```json
{
  "method": "permission_response",
  "param": {
    "permissionId": "perm_...",
    "requestTurnIndex": 20,
    "outcome": "selected",
    "optionId": "q0_opt_0",
    "optionName": "Continue with the plan",
    "respondedAt": "2026-07-21T10:01:00Z"
  }
}
```

response 不重复 title、details 或完整 options。reject 类 option 仍是 ACP `outcome=selected`，其拒绝语义由被选 option 的 `kind` 表达。

## Server 状态与并发

`Session` 持有当前 prompt 的 pending permission map 和已解决结果 ledger。它们都是运行时状态，不写入 SQLite、turn 文件或 archive：

- pending map 连接 `permissionId`、ACP request、允许的 options、request turnIndex 和一次性完成通道。
- FIFO 不需要额外的服务端队列；多个 ACP request 可以同时等待，Web 直接按 request turnIndex 选择最早项。
- resolution ledger 在 Session 运行期保留，用于处理 ACK 丢失后的同 option 幂等重试；它不跨 Hub 重启恢复。
- 同一个 Session 内的注册、用户选择、取消和清理必须串行化；一个 permission 只能从 pending 进入一次 terminal 状态。
- 用户选择的提交只有在 response turn 成功进入 recorder 后才算 accepted；随后向等待中的 ACP handler 返回 `{outcome:"selected", optionId}`。
- prompt context 取消时，所有仍 pending 的 ACP handler 返回 `{outcome:"cancelled"}`，但不写 `permission_response`。
- 如果单个 ACP permission request context 独立取消，Session 也取消当前 prompt，使既有 `prompt_done` 成为 turns 中可观察的 terminal；否则在没有 `permission_closed` turn 的设计下，Web 无法安全区分失效 waiter 与仍可回答请求。
- Session summary 的 `pendingPermissionCount` 由 recorder 当前 live prompt 的 permission turns 推导：request 加入、response 移除、`prompt_done` 清零；Hub 重启后 live prompt state 不存在，因此自然为 0。该值只驱动列表提示，不参与 Web 弹窗真相判断。

## Turn 状态机

Web 按 `turnIndex` 顺序分析每个 prompt：

```text
prompt_request
  └─ 开始 prompt

permission_request(permissionId)
  └─ 加入该 prompt 的 unresolved 集合

permission_response(permissionId)
  └─ 从 unresolved 集合移除，并生成已选择摘要

prompt_done
  └─ 清空该 prompt 的 unresolved 集合，并生成未回答摘要

下一个 prompt_request
  └─ 服务端先把前一未结束 prompt 补为 interrupted，再开始新 prompt
```

只有最新未结束 prompt 中 unresolved 的 permission 才能成为弹窗候选。历史中存在 `permission_request` 本身不足以打开弹窗。

UI 在 session resume、切换和 Registry reconnect 时，必须先完成一次 `session.read` 与本地缓存校正，再根据 turn 状态机决定是否打开弹窗。读取失败、Registry 未连接或校正仍在进行时不得展示 permission modal，避免 stale cache 短暂复活旧请求。

这里允许 Web 保存一个纯运行时的“该 runtimeKey 已完成本次 read 校正”门禁。它不包含 permission identity，不进入 Registry 协议或持久化；permission 是否 pending、显示哪一项以及何时终止仍完全由校正后的 turns 推导。

## UI 行为

- Session 列表沿用现有 icon 区，在 `pendingPermissionCount > 0` 时显示明确的待回答图标和数量。
- 当前会话收到 unresolved request 后显示会话级 modal。它阻止当前会话 composer 提交，但不阻止侧栏、会话切换和其他会话操作；输入草稿保留。
- modal 展示 title、可选 detailsText 和纵向排列的 options。点击 option 立即提交；请求 in flight 时禁用重复点击。
- Esc 和点击遮罩不关闭 modal。用户可以选择 Agent 提供的 option、停止当前 session，或切换到其他会话。
- 切离会话时 modal 隐藏但 icon 保留；切回且 turn 状态仍 unresolved 时重新显示。
- 多个 unresolved permission 只显示 turnIndex 最小的一项；当前项结束后显示下一项。
- pending request 在聊天列表中不额外渲染卡片。用户选择后，request/response 被投影为一行紧凑记录，例如 `Permission · 已选择：Continue with the plan`。
- 没有用户 response 而 prompt cancelled/failed/interrupted/end 时，保留一行 `Permission · 未回答（会话已取消/失败/中断/结束）`。
- 终态记录不再提供 option 按钮，也不作为新的用户 chat message。
- 原输入区上方卡片和移动端覆盖 Plan 卡片方案取消；Desktop 和移动端使用同一语义的响应式 modal。

## 断线、取消、关闭与 Resume

### Registry 临时断线

Web 立即隐藏 modal，不向 Agent发送选择或取消。若原 Hub 仍存活，SessionRecorder 的 live request turn 仍在；重连并完成 `session.read` 后，unresolved request 会再次打开 modal。

### 正常 cancel / Agent failure

`session.cancel` 取消 prompt context，等待中的 ACP permission 得到协议层 `cancelled` outcome；recorder 按现有流程生成 `prompt_done(stopReason=cancelled)`。Agent error 使用 failed prompt_done。Web 由 prompt terminal turn 关闭所有 unresolved permission，不写用户 response。

### Hub 强关或崩溃

permission request/response 与所在 prompt 共用现有落盘边界，不能绕过 prompt completion 单独持久化。强关时尚未完成的 prompt tail 留在内存而未进入 WMT2；Hub 重启后服务端 `latestTurnIndex` 回退到 `latestPersistedTurnIndex`。客户端发现本地 cursor 领先服务端后执行现有 stale repair，清理旧 live tail 并从 0 重读，因此不会残留或弹出幽灵 permission。

如果用户已经选择但 prompt 尚未完成就发生强关，request 和 response 与同一未完成 prompt tail 一起回滚。这与当前进行中对话的强关语义一致。

### Session Resume / Load

Resume、`session/load` 和读取历史本身永远不能打开 modal。只有经过 session.read 校正后，最新未结束 prompt 内真实存在的 unmatched request 才能打开。正常历史 request 总有 matching response 或后续 prompt_done；Hub 重启后未完成 tail 已由 stale repair 删除。

## 持久化与资源边界

- SQLite 只继续保存 session summary 和 sync projection，不保存 permission 正文或原始 ACP payload。
- `permission_request` / `permission_response` 和同 prompt 的其他 turns 一样，仅在 prompt terminal 时写入 WMT2。
- Archive 读取这些 turns 后只生成历史折叠行，从不提供可操作 modal。
- request turn 只保存规范化后的 title、detailsText 和 options；response 只保存被选 option 的小型摘要。
- pending waiter、resolution ledger 和原始 ACP request 生命周期只存在于 Session 内存。
- 日志不得记录未经裁剪的 request params、question text、option 内容或可复用 Registry 凭证。

## 主要改动面

### Server

- 扩展 ACP permission wire 类型，完整接收标准 `ToolCallUpdate` 的必要展示字段，同时在 Session 边界做有界投影。
- 把 `SessionRequestPermission` 从自动 allow 改为 pending waiter + turn 发布 + context cancellation。
- 为 recorder 增加 permission request/response turn payload、解析、实时发布、prompt terminal 持久化和 read 支持；删除“permission events are ignored”的旧断言。
- 增加 `session.permission.respond` 的 Client/Hub/Registry project-scoped forwarding 和一次性并发控制。
- Session summary 增加 `pendingPermissionCount`，所有状态变化发布 `session.updated`。

### App/Web

- Registry types/service 增加 response request 和 summary count。
- 增加纯 turn permission reducer，负责 prompt 边界、request/response 匹配、FIFO 和历史摘要。
- Session icon 展示 pending 数量。
- 增加当前会话 permission modal、提交状态、冲突/失效后的 read repair，以及 composer 阻塞。
- Resume/reconnect 必须等待 session.read 校正完成后才允许 reducer 驱动 modal。

## 验收标准

- Agent 发出标准 `session/request_permission` 后，ACP handler 保持等待，不再自动选择 allow。
- 当前会话在完成 session.read 校正后显示 modal，title、text details 和所有合法 options 正确；点击后返回精确 optionId。
- `permission_request` 与 `permission_response` 使用不同 turnIndex 追加，Web 最终只显示一行选择摘要。
- permission 不会生成第二条 ToolCall，也不会修改 Agent 已发送 ToolCall 的状态或内容。
- 同一 session 多个请求按 turnIndex FIFO 显示；一个解决后自动显示下一个。
- 多客户端同时选择时只有第一个不同选择成功；同一选择的重试幂等成功。
- 当前会话 modal 阻止 composer 提交但不阻止切换会话；Esc 和遮罩不能关闭。
- 非当前会话通过 icon/count 表示待回答；切回后仍 unresolved 才重新显示。
- Registry 短暂断线时 modal 立即隐藏；连接原 Hub 后读校正完成可恢复。
- 正常 cancel/failed/interrupted 后没有 permission_response，modal 关闭并留下未回答摘要。
- Hub 强关重启后未完成 permission tail 被现有 stale repair 清理，resume/load/history 不会弹出 modal。
- prompt 完成后 request/response 落入 WMT2；SQLite、session summary 和 archive metadata 不含完整 permission payload。
- 没有 `session.permission.read`、`permissionRevision`、`pendingPermissionIds` 或 `permission_closed`。
- Registry 协议版本仍为 2.6。

### 测试

- Server：覆盖 ACP 字段解析和裁剪、无自动 allow、请求等待、用户响应、reject option、context cancel、多个请求、FIFO、first-wins、幂等重试、conflict、pending count、prompt terminal 落盘和强关尾部回滚。
- Recorder：覆盖 permission request/response turn JSON、连续 turnIndex、session.read 增量、prompt_done 对 unmatched request 的终止语义，以及旧 permission ignored 测试的替换。
- Registry：覆盖 project 路由、鉴权边界、Hub 离线、无效 session/permission/option 和响应 ACK。
- App：用纯 reducer 测试 request/response 匹配、多个 pending、prompt_done 清理、resume/history 不弹、stale read 修复、临时断线隐藏和同 Hub 重连恢复。
- UI：覆盖 session icon/count、modal FIFO、不可 Esc/遮罩关闭、切换会话、composer 阻塞、立即提交、in-flight 防重和终态单行摘要。
- 不依赖真实 Kimi 端到端测试；使用标准 ACP permission fixture，并补一个与 Kimi 当前 payload 形状一致的解析样例。

## 范围之外

- 修复 Kimi ACP adapter 只转发 `AskUserQuestion` 第一问的限制。
- 为 Kimi 或任何 provider 增加私有 question 字段、专属 UI 或 tool 名称判断。
- 隐藏、合并或改写 Kimi 另外发送的 `Asking user questions` ToolCall。
- permission policy、always allow 记忆、自动审批或超时。
- Hub 重启后恢复并继续等待旧 ACP permission；原 Agent 请求已经不存在。
- 把用户选择发送为新的 `session/prompt` 或普通 user message。
- Registry 2.6 版本升级、旧客户端兼容和 capability 协商。
