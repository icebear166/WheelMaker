> 由 scope skill 于 2026-08-06 生成；根据 review 修订

# Claude ACP 对齐与旧 Codex Session 兼容

## 目标

WheelMaker 当前的 Codex/CX bridge 以 `_wm/*` 扩展承载 steering、历史 turn fork、compact、goal、archive 和 message lifecycle；Claude-compatible provider 已经提供 Claude ACP 原生 steering 与标准 `session/fork` 能力。

本任务在不改变 Codex/CX 既有产品行为、Session 记录语义和 compact 操作的前提下，统一 fork method 为 `session/fork`，补齐 ACP facade、能力声明、能力持久化和 Claude provider adapter；同时兼容已有 Codex Session 数据。

## 核心边界

ACP wire method、Registry request 和 Web product action 分层处理：

- `session/fork` 是唯一 fork method，语义始终是“从 source session 创建一个新的 child session”。
- “从当前 session 分叉”还是“从历史 turn 分叉”由可选的 source selector 决定，不再用 `scope` 改变 method 语义。
- Registry/UI 只暴露已被 WheelMaker runtime 完整支持的 action；ACP 层可以保存标准能力和 `_meta.wm` 扩展能力。
- Web 不按 `agentType` 或 provider name 分支，而根据归一化 capability 和 action 参数决定入口。

## Fork 统一语义

### 1. Source selector

统一的 Registry request：

```json
{
  "method": "session.fork",
  "projectId": "hub-a:WheelMaker",
  "payload": {
    "sessionId": "source-session"
  }
}
```

含义是从 source session 当前状态分叉。当前状态以最近一个已完成 turn 为本地关系标记，但不要求调用者提供历史位置。

Codex 历史 turn fork 使用同一个 method 增加可选 source selector：

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

`turnIndex` 是 WheelMaker 的 provider-neutral source selector，不是第二种 fork method，也不叫 `scope`。它只在 provider 宣布 historical turn fork 能力时有效；Claude 当前不实现该路径。

旧客户端已经发送的 `{sessionId, turnIndex}` payload 继续表示历史 turn fork。新客户端发送 current-session fork 时省略 `turnIndex`；Hub 必须使用可区分“字段缺失”和“零值”的解析方式，缺失字段不能再被当作 `turnIndex=0`。

### 2. ACP method 层

所有 provider 都使用 `session/fork`：

- Claude-compatible provider：发送标准 ACP current-session fork 参数，必须带真实 `cwd`，不发送 `_meta.wm.fork`。
- Codex/CX current-session facade：使用标准参数，内部适配现有 Codex thread fork 的最近完成位置；这只是 ACP facade，不改变 Registry/UI 既有历史 fork 产品行为。
- Codex/CX historical fork：仍使用 `session/fork` method，但在 params 的 `_meta.wm.fork` 中携带 WheelMaker 扩展数据。扩展承载现有 `_wm/session/fork` 所需的 `lastTurnId`、prompt history 和可选 source turn metadata，由 Codex bridge 转换到原有 `thread/fork`。

标准 ACP 参数不加入 Codex 专用根字段；Codex 扩展放在 `_meta.wm.fork`，以免外部 Claude adapter 看到无法识别的 provider-specific 参数。`turnIndex` 只属于 Registry/WheelMaker 层，Hub 在调用 ACP 前将其解析为 provider fork point 和 prompt history。

### 3. Provider 映射

| 请求 | ACP 调用 | Provider 行为 |
| --- | --- | --- |
| `{sessionId}` | `session/fork`，无 WM fork 扩展 | current-session fork |
| `{sessionId, turnIndex}` | `session/fork` + Codex `_meta.wm.fork` | Codex historical turn fork |
| 旧 `_wm/session/fork` | legacy WM method | 仅兼容旧 Session/旧调用 |

`_wm/session/fork/resolve`、`_wm/session/fork` 不再作为新 Registry fork 的主路径，但必须继续被旧 Session 和旧 ACP caller 读取/调用。

### 4. Product capability

`sessionActions.fork` 不再使用单个 `scope` 字段，而表达 Registry/UI 可用的 source selector：

```json
{
  "supported": true,
  "currentSession": true,
  "historicalTurn": false
}
```

规则：

- Claude-compatible provider：`currentSession=true`；`historicalTurn=false`。
- Codex/CX 的既有 Registry/UI 产品行为保持历史 turn fork；因此至少宣告 `historicalTurn=true`。Codex 的标准 current-session ACP facade 不自动新增 current-session UI action。
- 如果未来需要在 Codex UI 同时提供两种入口，再单独扩展 product action，不重新定义 `session/fork`。
- 旧 capability 只有 `supported` 时，按 `historicalTurn=true, currentSession=false` 兼容解释。

## 决策

### 1. Codex/CX

- 现有 `turn/steer`、`thread/fork`、`thread/compact`、goal、archive、Recorder、WMT2 和历史 fork-point 逻辑不改。
- 新增 `_session/steering` facade。它只做参数和结果适配，内部仍调用 `turn/steer`。
- 新增标准 `session/fork` facade。无 `_meta.wm.fork` 时按当前 session 最近完成位置分叉；有 `_meta.wm.fork` 时复用现有历史 fork 参数并调用 `thread/fork`。
- 新 Registry historical fork 由 Hub 统一解析 `turnIndex`，再调用 `session/fork + _meta.wm.fork`；不再新建 `_wm/session/fork` Registry 分支。
- 保留 `_wm/session/steer`、`_wm/session/fork/resolve`、`_wm/session/fork` 及旧 capability 数据，旧调用继续有效。
- Codex 的 Registry/UI 仍只显示历史 turn fork button，不因标准 facade 自动新增 current-session button。

Codex facade 生成的内部 `clientMessageID` 必须稳定关联到 steering request，使既有 Recorder 和 queue correlation 继续工作；该内部 ID 不要求出现在 Claude-compatible standard method 的公开参数中。

### 2. Claude steering

Claude `_session/steering` 的 native outcome 不能简单视为 bool。adapter 必须归一化为至少以下结果：

- `injected`：steering 被注入当前 active prompt。目标 queue item 保持 `steering`，直到带 provider turn identity 的 transcript 确认。
- `startedNewTurn`：provider 接受 steering 并启动新的 provider turn。只有在 Hub 已经为该 Session 持有执行所有权时才能接受；不得再额外 dispatch 一次普通 prompt。
- `promptRequired`：当前没有可注入的 active prompt。Hub 不把它当成功，而是回到既有 queued-prompt fallback。
- `rejected`/transport error：保留 queue item 和原位置，按现有 steer failure 反馈。

Hub 只在已获得 active Session 执行所有权时调用 native steering；inactive Session 仍走现有排队路径，不能让 native method 私自启动一个脱离 Hub queue 的 turn。

Claude native request 如果没有 WheelMaker 的 `clientMessageID`，adapter 使用本地 request-to-provider-turn 映射关联 transcript。一个 Session 同时只能有一个待确认的 native steering correlation；收到 provider turn identity 后，后续事件必须落到对应 queue item，不能靠文本内容猜测。

### 3. Claude current-session fork

Claude `agentCapabilities.sessionCapabilities.fork` 的存在只证明 ACP schema 暴露了该字段，不自动证明 WheelMaker runtime 可用。`currentSession=true` 进入 Registry/UI 前必须满足以下验证门槛：

1. 在同一个 `CLAUDE_CONFIG_DIR`、同一个 provider 配置和同一个 ACP lifecycle 中创建或 load source Session。
2. 使用 source 的真实 `cwd` 调用 native `session/fork`；`cwd` 是必传的，不从用户请求缺省猜测。
3. 成功返回 target session identity，并能在同一配置边界下 load target。
4. target 能读到 source 当前已完成上下文，后续 prompt 与 source 相互独立。
5. source、target 的 provider identity、Hub Session identity、WMT2 transcript 和 fork relationship 能稳定对应。

生产 runtime 的规则：

- current-session fork request 不接受 `turnIndex`；若存在 `turnIndex`，必须由 capability 路由到 Codex historical path，Claude 明确返回 unsupported。
- provider fork 成功后，Hub 才创建并发布本地 child Session；本地创建失败时不得向 UI 暴露半成品 Session。
- child Session 保存 target provider identity、source relationship、project、cwd、provider 配置边界和最新 AgentJSON。
- child transcript 必须包含 source 截止最近已完成 turn 的一致快照。可以复制现有 WMT2/artifact/attachment 快照，也可以从 native load 重建，但 load 或恢复时不能重复写入。
- 当前 fork 的 `forkedFrom.turnIndex` 使用 source 最近一个已完成 turn；历史 fork 使用请求中的 `turnIndex`。
- 若 provider fork 成功但本地 child 创建失败，adapter 使用已声明可用的 native `session/delete` 或等价 cleanup 能力清理 target；没有 cleanup 能力时只记录 orphan diagnostic，仍不得发布本地 child。
- native fork 返回 unsupported、resource not found、参数不完整或恢复边界不一致时，归一化为 current-session action 不可用；不得退化成历史 fork，也不得伪造成功。

真实 `claude-agent-acp` 版本和 WheelMaker 使用的配置边界必须有 opt-in E2E 覆盖上述流程；仅有 initialize capability fixture 不算通过。

2026-08-06 对 `claude-agent-acp 0.65.0` 的隔离配置实测结果：source load 与 `session/fork` 成功，adapter 返回新的 target ID，但独立 ACP instance 随后的 `session/load(target)` 返回 `Resource not found`。因此该版本未通过上述门槛；标准 `fork + loadSession` 声明只保存、不直接投影为 `currentSession=true`，Claude current-session UI 保持隐藏。runtime 仍保留 target load 验证和失败 cleanup，供后续 adapter 版本通过 opt-in fixture 后显式开启 release gate。

### 4. Compact 保留 WheelMaker 扩展

WheelMaker 的 `compact` 仍是 provider-neutral operation，不新增标准 `session/compact`，也不把 Claude 的 `/compact` command 当作普通 `session/prompt`。

- 支持该 action 的 provider 继续通过 initialize 双向协商的 `_wm/session/compact` 调用。
- compact 与普通 prompt/steering 共享 Session execution ownership；busy 时沿用现有 operation 排队或拒绝规则，不能并发占用同一个 ACP Session。
- adapter 必须提供明确的 operation completion boundary；只有收到 provider compact 完成信号或等价稳定结束状态才标记 completed，错误、取消和超时分别映射到现有 failed/cancelled 语义。
- available commands 仍然保存，供 UI/未来 provider 能力使用；本任务不把 `/compact` command 作为 compact capability 的推断依据。

### 5. 能力保存、刷新与投影

`SessionAgentState` 持久化以下 ACP 初始化结果：

- `AgentCapabilities`，包括标准 `sessionCapabilities` 和已有 `agentCapabilities._meta`；
- `InitializeResult._meta` 顶层元数据，例如 Claude `_meta.steering.supported`；
- `AgentInfo`、auth methods、available commands 及已有 provider 状态。

能力投影必须以完整 SessionAgentState 和 adapter runtime support 为输入，不再只接收 `AgentCapabilities`。归一化优先级如下：

1. legacy WM capability 保证已有 WheelMaker 行为可用；
2. 标准 ACP capability 只有在对应 adapter method 和 lifecycle 已实现时才可投影；
3. historical turn fork 由 legacy WM fork 或 Codex `_meta.wm.fork` extension 提供；
4. current-session fork 由标准 `session/fork` 和 provider lifecycle 验证提供；
5. steering 优先使用 native method，但 native 不可用时保留 WM fallback；
6. compact 由已协商的 WM capability 和对应 adapter support 决定。

旧 `agent_json` 的兼容默认值：

- 缺少顶层 `InitializeResult._meta`：按旧版本处理；
- 缺少 `currentSession`/`historicalTurn` 且 fork supported：按 `historicalTurn=true, currentSession=false` 处理；
- 缺少标准 capability：不影响旧 `_wm/*` capability；
- 未知新字段保留兼容读取，不要求 SQLite、WMT2 或归档迁移。

### 6. Registry 兼容策略

当前 Registry protocol version 2.7 保持不变，但混合版本只通过 capability gate 保证：

- 新 Hub 只有在 summary 明确宣告 `currentSession=true` 后，才允许新 App 发送不带 `turnIndex` 的 current-session fork。
- 旧 Hub 不会宣告 `currentSession`；新 App 连接旧 Hub 时只能显示/调用 historical turn fork，不能根据本地 ACP capability 越过 Registry summary 直接发送 current-session fork。
- 旧客户端发送 `{sessionId, turnIndex}` 时，新 Hub 按 historical fork 处理。
- 新 Hub 必须对 historical request 缺少或无效的 `turnIndex` 返回明确参数错误；不能把零值当作有效历史 turn。
- current-session request 发送到不支持该 action 的 Hub 时返回明确 unsupported，不得隐式改成 historical turn 0。
- 任何无法建立上述 capability gate 的实现都必须暂停当前 Registry payload 方案，另行评估 protocol version 或独立 method；本任务不隐式修改 protocol version。

### 7. UI 行为

- `historicalTurn=true`：沿用当前 ChatTurn 历史 fork button，仅在有效 `prompt_done` fork point 上显示 “Fork session from here”；点击发送 `session.fork` 并携带 `turnIndex`。
- `currentSession=true`：在 Session Header/Menu 提供 “Fork current session”；点击发送不带 `turnIndex` 的 `session.fork`。
- action unsupported 时隐藏入口；running、cancelling 或已有 fork operation 时禁用并显示 loading 状态。
- fork 成功后切换/选中新 child Session；失败显示现有错误反馈，不生成空 Session。
- 桌面端和移动端使用同一 capability-driven action，不复制 agent/provider 分支。

## 架构

能力链路分为四层：

1. **ACP protocol layer**：统一定义 `session/fork` typed params/result；标准参数表示 current session，Codex historical source 放在 `_meta.wm.fork`；保留 legacy WM 类型。
2. **Provider adapter layer**：`codexappConn` 将统一 `session/fork` facade 映射到现有 App Server 调用；Claude adapter 调用 native steering/fork，compact 继续使用已协商的 WheelMaker extension。外部 `claude-agent-acp` 不在 WheelMaker 内修改。
3. **Session state layer**：保存完整 initialize meta、available commands、标准/WM capability 和 current/historical fork action 状态；恢复 Session 后刷新并重新归一化 action。
4. **Registry/Web layer**：只传递一个 `session.fork` method 和可选 `turnIndex`；Codex 使用 historical turn UI，满足验证门槛的 Claude provider 使用 current-session UI。

## 验收标准

- Codex/CX 既有 active-turn steering、历史 turn fork、compact、goal、archive、Recorder、WMT2 和 Registry 行为不变。
- 所有新 fork 请求统一使用 `session/fork`；Codex historical path 使用 `_meta.wm.fork` 扩展，Claude current path 不使用 WM fork 扩展。
- Codex/CX 标准 facade 的底层仍使用已有 App Server method；`_wm/session/fork/resolve`、`_wm/session/fork` 和旧 capability 数据仍可读取。
- Registry `{sessionId}` 与 `{sessionId, turnIndex}` 路径都能正确路由；缺失 historical turnIndex、current action unsupported 和 provider fork failure 都返回明确错误。
- Claude native steering 的 `injected`、`startedNewTurn`、`promptRequired`、rejected、取消和 transport error 均能映射到现有 queue/Session 语义，且不存在脱离 Hub ownership 的 native turn。
- Claude current-session fork 只有在同配置、同 ACP lifecycle 的真实 E2E 通过后才进入 `currentSession=true`；失败时不显示入口、不伪造历史 fork。
- Claude fork 成功后 source/target provider identity、Hub Session、transcript、artifact/attachment 和 fork relationship 一致，恢复不重复。
- Codex 与支持 WM compact 的 provider 都能从同一个 provider-neutral compact action 触发正确 adapter；compact 不产生普通可见 prompt turn，operation 状态正确记录。
- `sessions.agent_json` 保存顶层 initialize meta、available commands 和 fork action capability；旧 JSON、旧 WMT2 和旧归档仍可读取。
- capability projection 不依赖 agent/provider name；标准 current fork 需要通过 WheelMaker 显式 release gate，旧数据缺少 fork mode 时默认 historical turn。
- 新旧 Registry 混合版本在 capability gate 下安全工作；旧 Hub 不会收到不带 `turnIndex` 的 current-session fork。
- UI 对 historical turn 和 current session 使用不同入口；Claude 不在历史消息上出现错误 fork button。
- Codex 不虚假宣布 close/delete/resume/additionalDirectories 的 runtime 语义；Claude 已声明的原生字段可以保存，但 WheelMaker 只调用本 spec 明确实现的路径。

## 测试

### Hermetic tests

- ACP JSON round-trip：initialize 顶层 meta、标准 session capabilities、统一 `session/fork` params/result、Codex `_meta.wm.fork` 扩展和 steering outcome。
- SessionAgentState fixture：WM-only、包含顶层 meta、包含 available commands、缺少 fork mode、含未知字段的 JSON 读取、投影和再次保存。
- Codex/CX bridge：统一 `session/fork` 到既有 App Server method 的映射、历史扩展、内部 clientMessageID/correlation，以及旧 `_wm/*` handler 回归。
- Fake Claude ACP：steering 四种 outcome、active ownership、queue fallback、current-session fork lifecycle、cleanup；WM compact completion/error 保持既有覆盖。
- Hub/Registry：current/historical request 路由、缺少 turnIndex 明确报错、旧 Hub summary 下禁止发送 current fork。
- Web：historical turn button、current-session Header/Menu action、busy/loading/error/success、旧 summary 默认 historical mode。

### Opt-in Claude integration

使用项目实际支持的 `claude-agent-acp` 版本和真实隔离 `CLAUDE_CONFIG_DIR`，覆盖：

- native steering active/inactive/race；
- source load、current-session fork、target load、后续独立 prompt；
- provider fork 成功后本地创建失败的 cleanup；
- compact 仍由 WM extension 覆盖。

真实集成测试不作为依赖在线 provider 的默认 CI 测试；普通 CI 使用 fake ACP 和历史 capability fixture。

## 范围之外

- 不修改 Codex App Server 的 `turn/steer`、`thread/fork`、`thread/compact`、goal 或 archive 业务实现。
- 不实现 Claude 历史 turn fork；Claude 收到 `turnIndex` 时返回 unsupported，不把它伪装成 current fork。
- 不向 Web 暴露 standard `session/close`、`session/delete`、独立 `session/resume` 或 additional directories action；fork 失败时允许 adapter 使用已经声明的 native cleanup 能力清理孤儿 target。
- 不把 goal、archive、message lifecycle 改造成 Claude capability。
- 不迁移 SQLite schema，不改 WMT2 major version。
- 不修改 ACP/Registry protocol version；若 capability gate 无法保证安全兼容，必须先停下并单独取得协议变更决策。
- 不按 provider name 或 agent type 在 Web 中硬编码能力分支。
