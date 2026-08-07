# ACP Request Permission 实现计划

> **执行要求：** 使用 `executing-plans` skill 分批执行本计划；每一批都先写失败测试，再写最小实现，并在批次检查点做自检。

**目标：** 把 ACP `session/request_permission` 从静默自动允许改成真正的用户选择流程；请求和响应进入既有 Session turn 流，当前会话显示 session-scoped 选择弹窗，非当前会话显示待回答图标，并正确处理并发、取消、断线、Hub 强关和重连校正。

**架构摘要：** Hub `Session` 持有正在等待的 ACP permission waiter；`SessionRecorder` 追加不可变的 `permission_request` / `permission_response` turns，并从 live prompt turns 推导 `pendingPermissionCount`。Web 通过新的 project-scoped Registry 方法 `session.permission.respond` 提交 optionId；弹窗只由完成 `session.read` 校正后的 turns 推导，summary count 只服务会话列表图标。

**技术栈：** Go、ACP JSON-RPC、WheelMaker Registry 2.6、React 19、TypeScript、Jest/react-test-renderer、WMT2 turn store。

**规格来源：** [`spec-request-permission.md`](../../scope/2026-07-21-request-permission.md)

---

## Task 1：补齐 ACP wire、turn payload 与 Registry 方法声明

**文件：**

- 修改：`server/internal/protocol/acp.go`
- 修改：`server/internal/protocol/session_turn.go`
- 修改：`server/internal/protocol/registry.go`
- 修改：`server/internal/protocol/registry_methods.go`
- 测试：`server/internal/protocol/acp_test.go`
- 测试：`server/internal/protocol/registry_methods_test.go`

### 1.1 先写失败测试

在 `acp_test.go` 增加：

- `TestPermissionRequestParamsDecodeToolCallTextContent`：解码标准 `{sessionId, toolCall:{toolCallId,title,content:[...]}, options}`，断言 text content 可达，未声明的 `rawInput` / `rawOutput` 不会进入后续内部 payload。
- `TestPermissionTurnPayloadSerialization`：断言 request/response turn JSON 字段精确，response 不重复 title/details/options。
- 覆盖 Kimi 当前 payload 的标准 ACP 外形，但不出现 `AskUserQuestion` 名称判断。

在 `registry_methods_test.go` 增加 `TestSessionPermissionRespondIsClientProjectForwardWithoutVersionChange`，断言：

- `session.permission.respond` 注册为 `RegistryRouteSessionForward`。
- Client role 可调用，Hub role 不可作为调用方。
- `DefaultProtocolVersion` 仍是 `2.6`。

运行并确认测试先失败：

```powershell
cd server
go test ./internal/protocol -run 'TestPermission|TestSessionPermissionRespond'
```

### 1.2 实现最小协议类型

在 `acp.go`：

- 给 permission request 使用的 `ToolCallRef` 增加 `Content []ToolCallContent \`json:"content,omitempty"\``。保持它是标准 `ToolCallUpdate` 的有意子集，不加入 raw input/output、diff 投影或 provider 私有字段。
- 保持 `PermissionRequestParams.ToolCall` 是嵌套 toolCall 对象；不要把 permission 转成 `session/update(tool_call)`。

在 `session_turn.go` 增加：

- `SessionTurnMethodPermissionRequest = "permission_request"`
- `SessionTurnMethodPermissionResponse = "permission_response"`
- `SessionTurnPermissionOption { OptionID, Name, Kind }`
- `SessionTurnPermissionRequest { PermissionID, Title, DetailsText, Options, CreatedAt }`
- `SessionTurnPermissionResponse { PermissionID, RequestTurnIndex, Outcome, OptionID, OptionName, RespondedAt }`

在 `registry_methods.go` 增加：

- `RegistryMethodSessionPermissionRespond = "session.permission.respond"`
- method table 中使用 `registryProjectMethod(..., RegistryRouteSessionForward)`。

在 `registry.go` 增加通用的 `RegistryRequestError`（包含 `Code`、`Message`，实现 `error`），供 Hub session handler 把 `INVALID_ARGUMENT` / `NOT_FOUND` / `CONFLICT` 传给 Reporter；不要为 permission 发明私有 envelope。

### 1.3 验证并提交

```powershell
cd server
gofmt -w internal/protocol/acp.go internal/protocol/session_turn.go internal/protocol/registry.go internal/protocol/registry_methods.go internal/protocol/acp_test.go internal/protocol/registry_methods_test.go
go test ./internal/protocol
git add internal/protocol
git commit -m "feat(protocol): define request permission turns"
```

---

## Task 2：让 SessionRecorder 追加 permission turns 并推导 pending count

**文件：**

- 修改：`server/internal/hub/client/session_recorder.go`
- 修改：`server/internal/hub/client/client.go`
- 测试：`server/internal/hub/client/client_test.go`

### 2.1 替换旧的 ignored 测试并先跑红

在现有 `client_test.go` 中：

- 删除/改写 `TestSessionViewReadSkipsPermissionRequestTurns`。
- 删除/改写 `TestSessionViewPermissionEventsAreIgnored`。
- 增加 `TestSessionRecorderAppendsPermissionRequestAndResponseTurns`：先建 prompt，再追加 request/response，断言两个不同、连续 turnIndex，均 `finished=true`，`session.read` 增量可读。
- 增加 `TestSessionRecorderPermissionSummaryCountTracksLiveTurns`：request 后 count=1，第二个 request 后 count=2，response 后 count=1，prompt_done 后 count=0。
- 增加 `TestSessionRecorderPersistsPermissionTurnsOnlyWithPromptDone`：terminal 前 WMT2/persisted cursor 不前移，terminal 后 request/response 与 prompt 一起落盘。
- 扩展 `TestSessionRecorderResetPromptStateRestartsTurnIndexWhenNothingPersisted`：live permission tail 在 `ResetPromptState` 后回滚，summary count=0，服务端 latest 回到 persisted cursor。
- 增加非法 response 测试：不存在的 request、重复的不同 response、terminal prompt 都不得追加 response turn。

```powershell
cd server
go test ./internal/hub/client -run 'TestSessionRecorder.*Permission|TestSessionView.*Permission|TestSessionRecorderResetPromptState'
```

### 2.2 扩展 sink 为同步 typed API

在 `SessionViewSink` 增加：

```go
RecordPermissionRequest(ctx context.Context, sessionID string, payload acp.SessionTurnPermissionRequest) (int64, error)
RecordPermissionResponse(ctx context.Context, sessionID string, payload acp.SessionTurnPermissionResponse) (int64, error)
```

在 `Client` 上实现同名委托方法。同步返回 request turnIndex，避免 Session 通过解析 Registry event 反查。

更新 `client_test.go` 里的 `failingSessionViewSink` 和 `recordingSessionViewSink`，让测试可控制 recorder 成功/失败并捕获 payload。

### 2.3 在 recorder 内追加不可合并的完成事件

在 `SessionRecorder` 增加 typed 方法，二者都在 `writeMu` 内：

1. 读取当前非 terminal `sessionPromptState`；没有 active prompt 则返回 error。
2. request 使用 `state.nextTurnIndex` 追加；response 先验证 matching request、`requestTurnIndex` 和尚无 response，再使用新的 turnIndex 追加。
3. 调用既有 `publishOpenTextTurnDone`，确保 permission turn 不会与未完成的 thought/message 共用 turnIndex。
4. 以 `finished=true` 发布 `session.message`。
5. 从当前 `SessionRecord + promptState` 构造并发布 `session.updated`，但不改变 `LastActiveAt`。

不要把 permission 接回通用 ACP `RecordEvent` 解析器，也不要复用会原地 merge 的 ToolCall key。

### 2.4 从 turns 推导 `pendingPermissionCount`

给 `sessionViewSummary` 增加 `PendingPermissionCount int \`json:"pendingPermissionCount,omitempty"\``。

新增纯 helper，按 turnIndex 扫描当前 `sessionPromptState.turns`：

- `permission_request` 将 permissionId 加入 set。
- matching `permission_response` 删除。
- `prompt_done` 清空。
- terminal state 或不存在 live prompt state 时返回 0。

在 `sessionViewSummaryFromRecordLocked` 中填充该值。不要写入 `sessionSyncProjection`、SQLite 或 archive metadata。

### 2.5 验证并提交

```powershell
cd server
gofmt -w internal/hub/client/session_recorder.go internal/hub/client/client.go internal/hub/client/client_test.go
go test ./internal/hub/client -run 'TestSessionRecorder.*Permission|TestSessionView.*Permission|TestSessionRecorderResetPromptState'
git add internal/hub/client
git commit -m "feat(server): record permission turns"
```

---

## Task 3：实现 Session permission waiter、规范化和并发收敛

**文件：**

- 新增：`server/internal/hub/client/session_permission.go`
- 修改：`server/internal/hub/client/session.go`
- 修改：`server/internal/hub/client/client.go`
- 测试：`server/internal/hub/client/client_test.go`

### 3.1 先写 Session 行为测试

在 `client_test.go` 用现有 Session/fake sink 基础设施增加：

- `TestSessionRequestPermissionWaitsForUserResponse`：调用保持阻塞；request turn 已记录；respond 后返回精确 optionId。
- `TestSessionRequestPermissionDoesNotAutoAllow`：含 `allow_always` / `allow_once` 也不得在用户响应前返回。
- `TestSessionRequestPermissionNormalizesBoundedDisplayFields`：只提取 `toolCall.content` 中 `type=content + ContentBlock.type=text`；title/details/name UTF-8 安全截断；图片/resource/diff/terminal/raw 字段不进入 turn。
- `TestSessionRequestPermissionRejectsInvalidIdentityAsCancelled`：缺 toolCallId、空/重复/超长 optionId、0 或超过 32 个 options 都返回 ACP cancelled，且不生成 request turn。
- `TestSessionPermissionRespondFirstChoiceWins`：两个 goroutine 选择不同 option，只有一个 accepted，另一方得到 `CONFLICT`，只追加一个 response。
- `TestSessionPermissionRespondSameChoiceIsIdempotent`：相同 permissionId+optionId 重试返回同一成功，不追加第二个 response。
- `TestSessionPermissionRespondRejectOptionIsSelectedOutcome`：reject option 仍返回 `{outcome:selected, optionId}`。
- `TestSessionRequestPermissionContextCancelHasNoResponseTurn`：request ctx 或 prompt ctx 取消返回 cancelled，不生成 response；随后既有 prompt terminal 路径使 turn-derived pending count 清零。
- `TestSessionPromptDoneCancelsUnansweredPermissions`：cancelled/failed/interrupted terminal 先使 waiter 返回 cancelled，再记录 prompt_done。
- `TestSessionMultiplePermissionsReceiveDistinctIDs`：多个请求可同时等待，turnIndex 保持进入 recorder 的顺序；服务端不建 UI FIFO 队列。

```powershell
cd server
go test ./internal/hub/client -run 'TestSession(RequestPermission|PermissionRespond|MultiplePermissions|PromptDoneCancels)'
```

### 3.2 建立 Session 运行时状态

在 `session_permission.go` 定义私有类型：

- `pendingPermission`：permissionId、requestTurnIndex、原始合法 options 的 map、prompt context、buffered result channel。
- `resolvedPermission`：optionId 和标准 accepted response。
- `sessionPermissionState`：独立 mutex、pending map、Session 运行期 resolution ledger。

在 `Session` 增加 `permissions sessionPermissionState`。不要把这些字段写入 `SessionRecord`。

### 3.3 实现有界投影

在 `session_permission.go` 集中定义并测试常量：

- title：512 bytes
- details text：8 KiB
- options：最多 32
- optionId：256 bytes，超限为 invalid
- option name：512 bytes，UTF-8 安全截断
- option kind：64 bytes，UTF-8 安全截断

规则：

- `permissionId` 用 `perm_` + `uuid.NewString()`，不复用 requestId 或 toolCallId。
- title trim 后为空时使用 `Agent requests your decision`。
- details 只连接标准 text content，以换行分隔并在总上限处截断。
- optionId 保留 ACP 原值用于回传；只在输入边界验证非空、唯一和 byte 上限。
- 不记录或打印完整 params。

### 3.4 改写 `SessionRequestPermission`

流程必须按以下顺序：

1. 校验 `params.SessionID == s.acpSessionID` 并规范化；无效请求直接返回 `{outcome:"cancelled"}`。
2. 在 permission mutex 下先注册 pending waiter。
3. mutex 未释放时调用 `viewSink.RecordPermissionRequest`；拿到 requestTurnIndex 后写回 pending。这样实时 event 到达 Web 后，极快的 response 只能等待 mutex，不会看到半注册状态。
4. recorder 失败则删除 pending 并返回 error。
5. 等待 result channel、ACP request ctx 或 prompt ctx。
6. context 分支重新拿 mutex：若选择已经线性化则返回已选择结果，否则删除 pending 并返回 cancelled。
7. 如果是 ACP request ctx 独立取消，在释放 permission mutex 后触发现有 `cancelPrompt`，保证随后产生可观察的 `prompt_done`；不要留下只有内存 waiter 已失效、turn 却仍 unresolved 的状态。

### 3.5 实现 `Session.RespondPermission`

在 permission mutex 下完成完整原子序列：

1. resolution ledger 中相同 option 返回原 accepted response；不同 option 返回 `CONFLICT`。
2. pending 不存在返回 `NOT_FOUND` 或 `CONFLICT`（已系统终止用 `CONFLICT`）。
3. 校验 optionId 属于该 request，并检查 pending prompt context 尚未取消。
4. 调用 `RecordPermissionResponse`；只有成功追加 turn 后才写 resolution ledger、删除 pending 并投递 result channel。
5. 返回 accepted ACK。不要等待 Agent 后续 prompt 完成。

resolution ledger 保留到 Session 被释放/Hub 退出，保证 prompt 很快结束后 ACK 重试仍幂等；它不跨 Hub 重启恢复。

### 3.6 统一取消路径

- `recordPromptDone` 在记录 terminal turn 前调用 `cancelAllPendingPermissions`，向仍 pending waiter 投递 cancelled；不要写 response。
- `cancelPrompt` 也调用同一 helper，然后执行现有 ACP `session/cancel` 和 prompt context cancel。
- `Suspend` / Agent close 继续走既有 cancel/context 路径。
- cancel 与 respond 使用同一 permission mutex；谁先完成状态迁移谁获胜，杜绝 prompt 已取消后再写用户 response。

### 3.7 暴露 Client request handler

在 `Client.HandleSessionRequest` 增加 `session.permission.respond`：

- 严格解码 `{sessionId, permissionId, optionId}`。
- 只查 `c.sessions` 中的 live Session；不要从 SQLite lazy restore 一个没有 waiter 的 Session。
- 调用 `Session.RespondPermission`。
- 返回 `{accepted:true, permissionId, outcome:"selected", optionId}`。
- 使用 `protocol.RegistryRequestError` 返回 `INVALID_ARGUMENT` / `NOT_FOUND` / `CONFLICT`。

### 3.8 验证并提交

```powershell
cd server
gofmt -w internal/hub/client/session_permission.go internal/hub/client/session.go internal/hub/client/client.go internal/hub/client/client_test.go
go test ./internal/hub/client -run 'TestSession(RequestPermission|PermissionRespond|MultiplePermissions|PromptDoneCancels)'
go test ./internal/hub/client
git add internal/hub/client
git commit -m "feat(server): wait for user permission choices"
```

---

## Task 4：打通 Hub Reporter 与 Registry project forwarding

**文件：**

- 修改：`server/internal/hub/reporter.go`
- 测试：`server/internal/hub/hub_test.go`
- 测试：`server/internal/registry/server_test.go`（仅当现有通用 forward 测试未覆盖新 method table entry）

### 4.1 先写路由和错误码测试

增加测试覆盖：

- Client 发 `session.permission.respond`，Registry 按 projectId 转发到正确 Hub，而不是广播或按 sessionId 猜路由。
- Hub/project 不在线返回既有 `NOT_FOUND` / `UNAVAILABLE`。
- Hub handler 的 typed `CONFLICT` 保持为 Registry `CONFLICT`，不能被降级成 `INTERNAL`。
- 未授权角色不能调用。

```powershell
cd server
go test ./internal/hub ./internal/registry -run 'Test.*SessionPermissionRespond'
```

### 4.2 实现 forwarding

- 把 `RegistryMethodSessionPermissionRespond` 加入 `Reporter.handleRegistryRequest` 的 session allowlist。
- 在 `replySession` 使用 `errors.As` 识别 `*protocol.RegistryRequestError`，调用 `writeError` 保留其 code/message；其他 error 仍走 `INTERNAL`。
- Registry server 不增加 permission 专属状态。依赖 Task 1 method descriptor 的既有 `handleForwardRequest`、鉴权、project route 和 timeout。

### 4.3 验证并提交

```powershell
cd server
gofmt -w internal/hub/reporter.go internal/hub/hub_test.go internal/registry/server_test.go
go test ./internal/hub ./internal/registry -run 'Test.*SessionPermissionRespond'
git add internal/hub/reporter.go internal/hub/hub_test.go internal/registry/server_test.go
git commit -m "feat(registry): forward permission responses"
```

---

## Task 5：增加 Web Registry 类型、规范化和 service API

**文件：**

- 修改：`app/web/src/registry/registryMethods.ts`
- 修改：`app/web/src/registry/registryTypes.ts`
- 修改：`app/web/src/registry/RegistryRepository.ts`
- 修改：`app/web/src/registry/RegistryWorkspaceService.ts`
- 测试：`app/__tests__/web-session-list-schema.test.ts`
- 测试：`app/__tests__/web-chat-project-service.test.ts`

### 5.1 先写失败测试

覆盖：

- summary 将 `pendingPermissionCount` 规范化为非负整数，缺失时为 0/undefined 的既有兼容形状。
- repository request 精确发送 `session.permission.respond`、projectId 和 `{sessionId, permissionId, optionId}`。
- response 规范化为 `{accepted, permissionId, outcome, optionId}`。

```powershell
cd app
npm test -- --runInBand __tests__/web-session-list-schema.test.ts __tests__/web-chat-project-service.test.ts
```

### 5.2 实现 API

- `RegistryMethods.SessionPermissionRespond`。
- `RegistrySessionSummary.pendingPermissionCount?: number`。
- `RegistryPermissionRespondResponse` 类型。
- `RegistryRepository.respondSessionPermission(projectId, sessionId, permissionId, optionId)`。
- `RegistryWorkspaceService.respondProjectSessionPermission(...)` 委托。

所有 trim/number clamp 只放在 Repository wire 输入边界；Workspace 不重复清洗。

### 5.3 验证并提交

```powershell
cd app
npm test -- --runInBand __tests__/web-session-list-schema.test.ts __tests__/web-chat-project-service.test.ts
npm run tsc:web
git add web/src/registry __tests__/web-session-list-schema.test.ts __tests__/web-chat-project-service.test.ts
git commit -m "feat(web): add permission response registry API"
```

---

## Task 6：实现纯 turn permission reducer 与历史折叠模型

**文件：**

- 新增：`app/web/src/chat/permission/chatPermissionState.ts`
- 修改：`app/web/src/chat/turns/chatDisplayIndex.ts`
- 修改：`app/web/src/chat/ChatTurnView.tsx`
- 测试：`app/__tests__/web-request-permission-state.test.ts`
- 测试：`app/__tests__/web-chat-display-index.test.ts`
- 测试：`app/__tests__/web-chat-turn-rendering.test.ts`

### 6.1 先写 reducer 失败测试

构造 raw `RegistryChatMessage[]`，覆盖：

- request 在最新 open prompt 中成为 pending。
- matching response 变成 selected record，request/response 最终只显示一行。
- 不同 permissionId 或错误 requestTurnIndex 不得错误匹配。
- 多个 pending 按 request turnIndex FIFO，active 是最小项。
- prompt_done 将所有 unmatched request 变成 unanswered，并按 stopReason 映射 cancelled/failed/interrupted/ended。
- 新 prompt 边界不会复活旧 request。
- 只有历史 request、已有 matching response、terminal prompt、archive 输入都没有 actionable pending。
- 未知/畸形 permission turn 安全忽略，不抛异常。

```powershell
cd app
npm test -- --runInBand __tests__/web-request-permission-state.test.ts
```

### 6.2 实现纯状态分析器

导出：

```ts
type ChatPermissionRecord = {
  permissionId: string;
  requestTurnIndex: number;
  request: RegistryChatMessage;
  response?: RegistryChatMessage;
  status: 'pending' | 'selected' | 'unanswered';
  optionId?: string;
  optionName?: string;
  unansweredReason?: 'cancelled' | 'failed' | 'interrupted' | 'ended';
};

type ChatPermissionState = {
  active: ChatPermissionRecord | null;
  byRequestTurnIndex: Map<number, ChatPermissionRecord>;
  hiddenTurnIndexes: Set<number>;
};
```

分析器严格按 turnIndex 扫描 prompt 边界。`active` 只从最新未结束 prompt 的 pending records 选最小 requestTurnIndex；不要读取 summary count。

### 6.3 折叠到聊天历史

- `permission_response` 永远不单独进入 Display Index。
- pending `permission_request` 不渲染历史行，只由 dialog 表达。
- selected/unanswered request 在自己的 turnIndex 渲染一个 compact permission row。
- `ChatTurnView` 接收对应 `ChatPermissionRecord`，显示当前产品语言一致的单行：`Permission · Selected: <option>` 或 `Permission · Unanswered (<reason>)`；无 option 按钮。
- `estimateChatTurnHeight` 为终态 permission row 返回固定 compact 高度。
- archive display 也使用同一 reducer，但永远不产生 dialog。

不要把 response 改写进 request message，也不要修改 raw turn store。

### 6.4 验证并提交

```powershell
cd app
npm test -- --runInBand __tests__/web-request-permission-state.test.ts __tests__/web-chat-display-index.test.ts __tests__/web-chat-turn-rendering.test.ts
npm run tsc:web
git add web/src/chat/permission web/src/chat/turns/chatDisplayIndex.ts web/src/chat/ChatTurnView.tsx __tests__/web-request-permission-state.test.ts __tests__/web-chat-display-index.test.ts __tests__/web-chat-turn-rendering.test.ts
git commit -m "feat(web): derive permission state from turns"
```

---

## Task 7：实现 session-scoped permission dialog 与 submit/read-repair 流程

**文件：**

- 新增：`app/web/src/chat/permission/ChatPermissionDialog.tsx`
- 修改：`app/web/src/app/WorkspaceApp.tsx`
- 修改：`app/web/src/styles/chat.css`
- 测试：`app/__tests__/web-request-permission-dialog.test.tsx`
- 测试：`app/__tests__/web-chat-read-repair.test.ts`
- 测试：`app/__tests__/web-chat-ui.test.ts`

### 7.1 先写组件和编排测试

组件测试覆盖：

- title、可选 details 和纵向 options。
- 点击 option 立即回调原 optionId。
- submitting 时所有 option disabled，只显示当前提交状态。
- backdrop 没有 dismiss handler；Escape 被拦截且不调用关闭回调。
- `role="dialog"` 但不把 session sidebar 设为 inert；这是只覆盖 chat-main 的 session-scoped dialog。
- desktop/mobile 使用同一组件和语义。

Workspace 编排/源码契约测试覆盖：

- `connected=false` 立即隐藏 dialog。
- 初始加载、切换 session 和 silent reconnect 时，在对应 runtimeKey 的 `session.read` 成功 reconcile 前不展示，即使 IndexedDB cache 含 pending request。
- read 成功后才用 reducer.active 打开；read 失败保持隐藏。
- 切走立即隐藏；切回先 read，仍 pending 才重开。
- response live turn 或 prompt_done 到达后关闭；下一个 FIFO request 自动成为 active。
- active permission 阻止 `sendChatMessage` 和 send button，但不清空 composer draft。

```powershell
cd app
npm test -- --runInBand __tests__/web-request-permission-dialog.test.tsx __tests__/web-chat-read-repair.test.ts __tests__/web-chat-ui.test.ts
```

### 7.2 实现 read-ready 门禁

在 `WorkspaceApp.tsx` 使用按 runtimeKey 的纯运行时 readiness set/ref：

- cold load、session selection load、silent reconnect 开始前移除目标 runtimeKey。
- `loadChatSession` / `refreshSessionTurns` 成功执行 `applySessionReadResult` 后加入 runtimeKey。
- Registry `onClose` 清空全部 readiness 并使 dialog 条件立即为 false。
- read 失败不加入。
- 不把 permissionId、pending 列表或 revision 放入该门禁，也不持久化到 workspace store。

dialog 条件必须同时满足：已连接、当前 session 非 archive/draft、当前 runtimeKey read-ready、reducer.active 非空。

### 7.3 实现 submit 状态机

在 Workspace 保存 `{runtimeKey, permissionId, optionId, pending, error}` 的短期 UI 状态：

1. 点击调用 `service.respondProjectSessionPermission`。
2. 不乐观关闭 dialog；服务端 response turn 才是关闭真相。
3. ACK 成功后主动 `refreshSessionTurns`，即使 `session.message` 丢失也会收敛。
4. request error（含 conflict/网络错误）后也执行一次 read repair；若 read 显示已被其他 client 解决则关闭，否则保留 dialog 并显示可重试错误。
5. Registry close、runtimeKey 改变或 active permission 改变时清掉旧 in-flight/error 展示。

在 `sendChatMessage` 入口和 `chatSendDisabled` 都检查 active actionable permission，避免键盘/语音/按钮旁路提交。不要清空 `chatComposerDrafts`。

### 7.4 挂载和样式

- 把 dialog layer 挂在 `.chat-main` 内，覆盖消息区和 composer，但不覆盖 desktop sidebar/session panel 或 mobile session-switch title bar。
- 使用 `position:absolute; inset:0`、现有 token、清晰层级和可滚动 options。
- 窄屏变为底部安全区内的 sheet-like dialog；宽屏居中。
- 不替换或覆盖 `ChatPlanSurface`；它在 dialog 关闭后保持原状态。
- option 使用真实 button focus 样式；首次打开聚焦第一项，prefers-reduced-motion 下无强制动画。

### 7.5 验证并提交

```powershell
cd app
npm test -- --runInBand __tests__/web-request-permission-dialog.test.tsx __tests__/web-chat-read-repair.test.ts __tests__/web-chat-ui.test.ts
npm run tsc:web
git add web/src/chat/permission/ChatPermissionDialog.tsx web/src/app/WorkspaceApp.tsx web/src/styles/chat.css __tests__/web-request-permission-dialog.test.tsx __tests__/web-chat-read-repair.test.ts __tests__/web-chat-ui.test.ts
git commit -m "feat(web): show session permission dialog"
```

---

## Task 8：给 Session 列表增加高优先级待回答图标

**文件：**

- 修改：`app/web/src/app/WorkspaceApp.tsx`
- 修改：`app/web/src/styles/chat.css`
- 测试：`app/__tests__/web-session-list-schema.test.ts`
- 测试：`app/__tests__/web-chat-session-state.test.ts`

### 8.1 先写失败测试

覆盖：

- `pendingPermissionCount > 0` 时显示 `codicon-question` 和可访问 title/label；count>1 显示数量。
- permission marker 优先于 running/completed/failed dot，但不修改底层 `ChatSessionVisualState` 计算。
- count 归零恢复原 marker。
- project sessions、Recent Sessions 和 search result 共用 `renderSessionLeadingState`，desktop/mobile 都生效。

```powershell
cd app
npm test -- --runInBand __tests__/web-session-list-schema.test.ts __tests__/web-chat-session-state.test.ts
```

### 8.2 实现 marker

- 在 `renderSessionLeadingState` 最前判断 normalized `pendingPermissionCount`。
- 返回专用 `.session-state-leading.permission-pending`，使用 question icon 和 count badge；不要靠颜色单独表达。
- 保持 row 点击逻辑不变，图标自身不拦截 pointer。

### 8.3 验证并提交

```powershell
cd app
npm test -- --runInBand __tests__/web-session-list-schema.test.ts __tests__/web-chat-session-state.test.ts
npm run tsc:web
git add web/src/app/WorkspaceApp.tsx web/src/styles/chat.css __tests__/web-session-list-schema.test.ts __tests__/web-chat-session-state.test.ts
git commit -m "feat(web): mark sessions awaiting permission"
```

---

## Task 9：端到端回归、文档转正和最终完成门禁

**文件：**

- 修改：`docs/wiki/protocols/acp.md`
- 修改：`docs/wiki/architecture/session-management-and-sync.md`
- 复核：`docs/scope/2026-07-21-request-permission.md`
- 复核：本计划涉及的全部 server/app 文件

### 9.1 Server 全量验证

```powershell
cd server
go test ./...
go build ./cmd/wheelmaker/
```

重点人工检查测试输出中不存在 race/hang，并额外复跑并发集合：

```powershell
cd server
go test ./internal/hub/client -run 'TestSession.*Permission' -count=20
```

若环境允许，运行 race detector：

```powershell
cd server
go test -race ./internal/hub/client -run 'TestSession.*Permission'
```

### 9.2 App 全量验证

```powershell
cd app
npm test -- --runInBand
npm run tsc:web
npm run build:web
```

### 9.3 手工场景验收

用标准 ACP fixture 或本地 fake Agent 逐项验证：

1. 当前 session 发一个 request：dialog 出现，composer 草稿保留，sidebar 可切换。
2. 选择 allow/reject：Agent 收到精确 optionId，dialog 关闭，历史只一行。
3. 同 session 同时两个 request：只显示最早项，完成后显示第二项。
4. 另一浏览器先选择：本浏览器 conflict 后 read repair，dialog 自动关闭。
5. `session.cancel` / Agent failed：无 response turn，显示 unanswered 行。
6. 临时断 Registry、Hub 不退出：dialog 立即隐藏；重连 read 后恢复。
7. Hub 强关并重启：stale live permission tail 被 repair 删除，不出现幽灵 dialog。
8. 切 session、resume、archive read：历史不会单靠旧 request 弹窗。
9. Kimi 发起 AskUserQuestion：permission dialog 工作，同时它自己发送的 `Asking user questions` ToolCall 仍按原逻辑独立显示。

### 9.4 文档转正与自检

- 从两个 Wiki 中删除“目标契约、尚未实现”的警示，改为当前实现说明。
- 确认 Wiki 第一行标题和既有 `summary` 结构未被破坏。
- `rg` 确认没有残留自动 allow 逻辑、provider 私有判断或新协议版本：

```powershell
rg -n "allow_always|AskUserQuestion|permissionRevision|pendingPermissionIds|session.permission.read|permission_closed" server app/web/src docs/wiki
rg -n "DefaultProtocolVersion" server/internal/protocol
git diff --check
git status --short
```

预期：`SessionRequestPermission` 中不再按 allow kind 自动选择；`AskUserQuestion` 只可能存在于既有 provider/test 语境，permission 新实现不依赖它；协议仍为 2.6。

### 9.5 最终 completion gate

按根 `CLAUDE.md` 的最高优先级要求，把文档转正和最终修正保留为最后一笔提交，然后执行精确尾序列：

```powershell
git add -A
git commit -m "docs: finalize request permission contract"
git push origin main
```

任一步失败都不得宣称完成；修复后重新执行完整尾序列。
