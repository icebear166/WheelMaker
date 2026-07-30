> 由 scope skill 于 2026-07-30 生成

# Universal Session Status

## 目标

`/status`（registry method `session.status`）目前只对 codex 可用：只有 codex 在 agent factory 注册了 `Status` 能力，且只有 codex 连接实现了 `SessionStatusProvider`（调用 codex app server 的 `account/rateLimits/read` 拿限流与套餐）。其他所有 agent 的 `sessionActions.status.supported` 都是 `false`，`/status` 命令在 Web 直接灰掉。

目标：让 `/status` 对所有 agent 可用。非 codex agent 走 provider-neutral 回退，显示 WheelMaker 稳定 session id、agent 类型、token 用量；冷/持久化 session 可查且不启动 agent 子进程。codex 维持现有 live 行为不变。弹窗布局向 codex 看齐。

## 决策

- **status 从 provider 私有能力变为 WheelMaker 层通用能力。** DB 身份（session id、agent 类型）和累计 token 用量是 WheelMaker 自己的事实，不属于 provider 能力；因此 status 对所有 session 恒为 supported。`compact`/`steer`/`fork`/`goal` 仍按 provider 声明。
- **非 codex 显示 A+B+C**：WheelMaker 稳定 session id、agent 类型、token 用量（`agentState.Usage`，provider-neutral）。不显示标题 / 生命周期 / 时间戳（用户未要求）。
- **冷 session 可查、不 spawn。** 回退路径不走 `ensureInstance`，直接读 `s.sessionID`、`s.agentType`、`s.agentState.Usage`；持久化归档的 session 也能查。
- **codex 路径不变。** codex 仍 `ensureInstance` 后调 `SessionStatusProvider`，返回 Limits/Account；冷 codex session 仍按现行为 spawn。
- **live vs 回退的判据是 factory 的 status 标志。** 该标志不再用于门控可用性（status 恒可用），转为内部标记"该 provider 是否提供 rich live status"；今天只有 codex 为 true。判据在持有 registry 的 Client/dispatch 层得出。
- **弹窗复用现有 "Session status" 对话框**，布局向 codex 看齐；Limits/Account 段落按返回数据按需渲染（仅 codex）。
- **协议只新增可选响应字段**（`agentType`），不改 protocol version。

## 架构

```text
Web /status (any agent)
  -> session.status dispatch (client.go)
       sessionSupportsAction(status) 恒 true          ← 改：status 不再受 provider 门控
       -> 依据 factory status 标志分流
            true  (codex) -> Session live status: ensureInstance + SessionStatusProvider  [不变，可能 spawn]
            false (其他) -> Session fallback: s.sessionID + s.agentType + agentState.Usage [新增，不 spawn]
       -> SessionActionStatusResult{ sessionId, agentType, context, [limits, account] }
  -> AppSessionStatusDialog 条件渲染
```

### Capability 门控（两处都要改）

status 今天由 factory 的 `Status` 标志经两条路径门控，都要改为恒 supported：

- `client.go` `actionLookup`（喂给 session summary 的 `sessionActions.status`，Web 据此启用 `/status`）：status 分支恒 `Supported: true`，不再读 `support.Status`；包括 `ParseACPProvider` 失败的未知 agentType 路径。
- `client.go` `sessionSupportsAction`（dispatch 的服务端二次校验）：`case status` 恒返回 `true`。

factory 的 `Status` 标志保留，语义从"是否可用"转为"是否提供 rich live status"，供 dispatch 层分流。

### Session status 回退

provider 不提供 live status（factory 标志 false）时，不调用 `ensureInstance`，直接用 session 自身状态拼结果：

- `result.SessionID = s.sessionID`（WheelMaker 稳定 id）
- `result.AgentType = s.agentType`
- `result.Context` 由 `s.agentState.Usage` 构造（复用现有 `SessionActionStatusContext` 的 Used/Size/UpdatedAt）
- `OK = true`；Limits/Account 留空

codex 分支（factory 标志 true）保持现有 `ensureInstance` + `provider.SessionStatus` + Context 富化逻辑不变。

### Protocol

`SessionActionStatusResult` 新增可选字段：

```go
AgentType string `json:"agentType,omitempty"`
```

纯响应侧加字段，向后兼容，不改 protocol version，不动 registry method descriptor 的 method/scope。

### UI

`AppSessionStatusDialog` 新增 agent 类型展示；Limits/Account 维持现有"数据存在才渲染"的退化行为（非 codex 时这两段为空，自然不显示）。`/status` slash option 对所有 agent 可点（capability 恒 supported 后自动生效，无需额外 gating 改动）。

## 流程

1. 用户对任意 agent session 触发 `/status`。
2. Web 调 `session.status`；capability 恒 supported，命令不再灰。
3. dispatch 通过 `sessionSupportsAction(status)`（恒 true），依据 factory status 标志分流。
4. codex → spawn/连接后返回 Limits/Account + Context；其他 → 回退，读 session 自身 id/类型/用量，不 spawn。
5. Web 按返回数据渲染：所有 agent 显示 session id + agent 类型 + token 用量；codex 额外显示 Limits/Account。

## 验收标准

- 所有 agent（含 claude/copilot/opencode/mimo/codebuddy/flicker/kimi 及各 cc-*）的 `/status` 可用且不再灰；非 codex 显示 WheelMaker session id、agent 类型、token 用量。
- 持久化/冷 session（agent 子进程未启动）执行 `/status` 不启动子进程，仍返回 id/类型/用量。
- codex 行为与现状一致：显示 Limits/Account，冷 session 仍 spawn。
- 弹窗布局与 codex 一致；Limits/Account 仅在数据存在时渲染。
- `session.summary` 的 `sessionActions.status.supported` 对所有 agent 为 `true`。
- protocol version 不变；`session.status` 响应向后兼容旧 Web（新增 `agentType` 可选字段）。

### 测试

- Go：`client` 包测 `actionLookup` 与 `sessionSupportsAction` 对 status 恒 supported（含未知 agentType 边界）；`Session` 回退路径返回正确 id/类型/Context 且不调用 `ensureInstance`（用 spy/计数器断言未 spawn）；codex live 路径回归不破坏。`protocol` 包测新增字段 JSON tag、omitempty 行为。
- Web：`AppSessionStatusDialog` 非 codex 渲染 id/类型/用量、不渲染 Limits/Account；codex 渲染不变。`/status` slash option 对所有 agent 可点。
- 不测：各 provider 子进程的真实 token 上报（依赖外部 CLI）。

## 范围之外

- 为其他 provider 实现 codex 式 live 限流/套餐查询（其他 agent 无对应 RPC）。
- 显示标题、生命周期状态、时间戳等额外 DB 字段（用户未要求）。
- 改变 codex 现有 status 行为或其 spawn 语义。
- 修改 protocol version。
- 把 `compact`/`steer`/`fork`/`goal` 改为通用能力。
