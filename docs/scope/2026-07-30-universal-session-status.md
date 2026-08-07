> 由 scope skill 于 2026-07-30 生成；2026-07-31 按统一 session-local status 决策更新

# Universal Session Status

## 目标

`/status`（registry method `session.status`）当前与 provider 的 `Status` 能力、agent 子进程和 limits/account 查询耦合，导致不同 agent 的可用性和展示内容不一致。

目标：让 `/status` 成为完全由 WheelMaker session 数据驱动的通用能力。所有 agent 的 `/status` 行为和布局一致，只显示当前 session 的 WheelMaker 稳定 session id、agent 类型和 session token 用量；Session ID 后提供一键复制按钮。

Provider limits/account 已由 Monitor 的 Limits 数据面负责。`/status` 不读取、不刷新、不展示 provider limits/account，也不调用 provider live status RPC。无论 provider 是否为 codex、cx-deepseek 或其他 agent，查询 `/status` 都不得创建或启动 agent 子进程。

## 决策

- **status 是 WheelMaker session-local 通用能力。** Session id、agent 类型和 `agentState.Usage` 都是 WheelMaker 当前 session 自身的数据，不属于 provider 能力；因此 status 对所有 session 恒为 supported。
- **所有 agent 显示相同内容。** 固定显示 WheelMaker 稳定 session id、agent 类型和 session token 用量；不按 provider 增减区块。
- **Session ID 支持一键复制。** Session ID 值后放置复用现有 `Icon` 系统的 `copy` icon button；点击后通过现有 clipboard abstraction 复制完整、未改写的 session id。按钮必须有可访问名称 `Copy session ID`。
- **所有 provider 都只走本地快照。** `/status` 直接读取 session 内存或持久化状态，不走 `ensureInstance`、`ensureInitialized` 或 `SessionStatusProvider`；codex 和 cx-deepseek 也不例外。
- **冷 session 可查、不 spawn。** 持久化 session 通过现有 session restore 路径读取 id、agent 类型和 token 用量，但不得创建 agent instance。
- **Limits 与 status 分离。** Provider 额度、余额、账户、额度刷新和历史采样继续由 Monitor/HubState `tokenStats` 负责；打开或刷新 `/status` 不触发 Limits 扫描，也不消费 Limits 快照。
- **factory 的 provider `Status` 标志不再门控或分流 `/status`。** 实现不得根据该标志决定 status 是否可用或是否查询 provider。若该标志在移除 `/status` 依赖后没有其他调用方，具体清理范围在 implementation plan 中列明。
- **协议只新增可选响应字段。** `SessionActionStatusResult` 新增可选 `agentType`，不改 protocol version。为兼容现有响应类型，`limits` 返回空数组，`account` 省略；不得填入 Monitor/provider 数据。

## 架构

```text
Web /status (any agent)
  -> session.status dispatch (client.go)
       sessionSupportsAction(status) 恒 true
       -> Session.SessionStatus
            snapshot: s.acpSessionID + s.agentType + s.agentState.Usage
            no ensureInstance / ensureInitialized / provider RPC
       -> SessionActionStatusResult{
            sessionId,
            agentType,
            context,
            limits: []
          }
  -> AppSessionStatusDialog
       all agents: Session ID + Copy + Agent + Context
```

### Capability 门控

status 当前经两条路径受 factory provider capability 门控，两处都要改为恒 supported：

- `client.go` `actionLookup`：`sessionActions.status.supported` 对已知和未知 agentType 都为 `true`；`compact`/`steer`/`fork`/`goal` 仍按 provider 声明。
- `client.go` `sessionSupportsAction`：合法 session 的 status 恒返回 `true`，不依赖 registry、agentType 解析结果或 factory `Status` 标志。

### Session-local status

`Session.SessionStatus` 在一次锁内取得当前快照：

- `SessionID = s.acpSessionID`
- `AgentType = s.agentType`
- `Context` 由 `s.agentState.Usage` 构造（`Used` / 可选 `Size` / 可选 `UpdatedAt`）
- `OK = true`
- `Limits = []`
- `Account = nil`

该方法不调用 agent factory、agent instance 或 provider RPC。`Usage` 缺失时 `Context` 省略，Web 显示现有的不可用空态。

### Monitor 边界

Limits 继续使用 HubState 的 `tokenStats` section，由 Hub 负责 provider 扫描、定时刷新、singleflight 和缓存。`session.status` 不读取该 section，也不触发 `hub.state.refresh`。两条链路只有 UI 同属 Workspace App，不共享请求或响应字段。

### Protocol

`SessionActionStatusResult` 新增可选字段：

```go
AgentType string `json:"agentType,omitempty"`
```

这是纯响应侧向后兼容字段，不改 protocol version，不动 registry method descriptor 的 method/scope。现有 `limits`/`account` 字段暂留以兼容旧客户端，但 `/status` 的新实现固定返回空 limits 且不返回 account。

### UI

`AppSessionStatusDialog` 对所有 agent 使用同一布局和相同区块：

1. Session ID：显示完整稳定 id，值后紧跟 copy icon button。
2. Agent：显示 `agentType`。
3. Context：显示当前 session 的 used tokens，以及存在时的 context size。

不渲染 Rate limits 或 Account 区块。loading 文案使用通用的 `Refreshing status…`；`/status` slash option 描述不再提及 rate limits。

复制按钮复用 `app/web/src/common/Icon.tsx` 已有的 `copy` glyph 和 `app/web/src/platform/clipboard.ts` 的 `writeTextToClipboard`，不新增 SVG 或独立 clipboard 实现。

## 流程

1. 用户对任意 agent session 触发 `/status`。
2. Web 调 `session.status`；capability 对所有 session 恒 supported。
3. Hub 恢复或读取当前 session，仅快照 id、agent 类型和 token 用量，不创建 agent instance。
4. Web 使用统一 dialog 展示 Session ID、Agent 和 Context。
5. 用户点击 Session ID 后的 copy icon，完整 session id 写入 clipboard。

## 验收标准

- 所有 agent（含 codex、cx-deepseek、claude、copilot、opencode、mimo、codebuddy、flicker、kimi 及各 cc-*）的 `/status` 可用且表现一致。
- 所有 agent 都只显示 WheelMaker session id、agent 类型和 session token 用量；不显示 provider Limits/Account。
- 任意 provider 的冷/持久化 session 执行 `/status` 都不调用 agent creator、不启动或初始化 agent 子进程。
- `/status` 不调用 `SessionStatusProvider`、provider limits RPC、HubState refresh 或 Monitor 扫描。
- Session ID 后有 copy icon button；点击后复制完整 session id，按钮可通过键盘操作且 accessible name 为 `Copy session ID`。
- `session.summary` 的 `sessionActions.status.supported` 对已知和未知 agentType 都为 `true`。
- generic JSON 响应包含 `limits: []` 而不是 `limits: null`，并省略 `account`。
- protocol version 不变；`session.status` 新增的 `agentType` 对旧 Web 向后兼容。

### 测试

- Go capability：`actionLookup` 与 `sessionSupportsAction` 对 status 恒 supported，覆盖已知 provider、未知 agentType 和 nil registry；其他 action 仍按 provider 声明。
- Go session：对 codex、cx-deepseek 和普通 provider 分别验证相同 session-local 结果；creator 调用次数、initialize 调用次数和 provider status 调用次数均为零。
- Go persisted session：从 SQLite 恢复 id、agent 类型和 `agentState.Usage`，返回正确 Context 且不 spawn。
- Go protocol：验证 `agentType` JSON tag/omitempty，以及 session-local status 的 `limits: []` JSON 形状。
- Web repository：验证 `agentType` 被规范化进 `RegistrySessionStatusResult`，空 limits 正常解析。
- Web dialog：验证所有 provider 使用相同的 Session ID/Agent/Context 布局，不存在 Rate limits/Account；loading 和 slash option 使用通用 status 文案。
- Web clipboard：点击 `Copy session ID` 后，现有 clipboard abstraction 收到完整 session id。
- 不测：各 provider 子进程的真实 token 上报，以及 Monitor 的 provider Limits 扫描；两者不属于本改动链路。

## 范围之外

- 在 `/status` 中展示或刷新 provider 限额、套餐、账户、余额或历史趋势。
- 修改 Monitor/HubState `tokenStats` 的数据所有权、扫描周期、聚合或 UI。
- 显示标题、生命周期状态等额外 session 字段。
- 修改 protocol version。
- 把 `compact`/`steer`/`fork`/`goal` 改为通用能力。
- 修改各 provider 的 token usage 上报机制。
