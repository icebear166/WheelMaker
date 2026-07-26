> 摘要：本页维护 WheelMaker App-only Session 运行时架构、组件职责和生命周期边界。

# Architecture 3.0

> 来源：本页由原路径 `docs/architecture-3.0.md` 于 2026-07-17 全文迁入 wiki。

Updated: 2026-05-27  
Status: **Implemented, App-only session runtime**

Agent provider 还可以通过可选接口声明 Session action capability。Client/Session 负责通用执行所有权、持久化和 Registry 投影，adapter 只负责原生协议映射；Steer/Goal 的稳定边界见 [`../agents/session-capabilities.md`](../agents/session-capabilities.md)，Codex 映射见 [`../agents/codex.md`](../agents/codex.md)。

## 0. Terms

- App Session: WheelMaker business session identified by `projectId + sessionId` in Registry requests.
- ACP Session: provider protocol session identified by ACP `sessionId`; one WheelMaker Session can hold per-agent ACP state.
- SessionRecorder: the only configured session event outlet. It persists session turns and publishes Registry `session.*` events.
- AgentInstance: runtime executor bound to exactly one Session. The only ACP interface visible to Session.
- AgentConn: ACP connection abstraction used internally by AgentInstance. Hidden from Session.
- AgentFactory: creates AgentInstance and selects AgentConn policy (shared/owned) based on agent capability.
- SessionStore: persistence interface for Session snapshots (SQLite-backed).

Notes:

- Session identity is no longer derived from chat routes. App clients address sessions directly by `projectId + sessionId`.
- A Session stores per-agent state in `agents map[string]*SessionAgentState`, preserving ACP session id and config across agent switches.
- Shared behavior happens at AgentConn, not at AgentInstance.
- Multiple Sessions can be Active simultaneously within one Client.

## 1. Goals

Keep ACP payload unchanged while enabling true multi-session concurrency and clear ownership boundaries:

- Registry accepts App `session.*` requests and forwards them to the owning Hub project.
- Client handles session lookup/orchestration by session id.
- Session handles lifecycle, agent switching, prompt execution, and terminal management.
- Session does not know about external transports; it is a business object.
- SessionRecorder records ACP/session events and publishes `registry.session.message` / `registry.session.updated`.
- AgentFactory creates AgentInstance and selects AgentConn policy based on `SupportsSharedConn()`.
- AgentInstance handles ACP execution and callback dispatch to its owner Session.
- Sessions can be persisted to SQLite and restored on demand.

## 2. Core Decisions

1. Agent layer is App/Registry agnostic and only speaks ACP semantics.
2. Routing is handled by Registry project ownership plus Client session id lookup.
3. Execution is handled in Session: Session -> AgentInstance.
4. Each Session always owns exactly one AgentInstance at a time, but stores per-agent state for all agents it has used.
5. SessionRecorder is the only session message outlet in configured runtime.
6. AgentFactory does not own runtime connections; it only creates instances and wires AgentConn strategy.
7. AgentConn mode is selected automatically by the agent's self-declared capability (`SupportsSharedConn()`):
   - shared: many AgentInstance objects use one outbound ACP connection.
   - owned: one AgentInstance owns one ACP connection.
8. Agent switching is a session behavior: Session snapshots current agent state, creates new AgentInstance, restores previously saved state if available.
9. Multiple Sessions can be Active concurrently; each has independent promptMu.
10. Session persistence: Active -> Suspended -> Persisted (SQLite). Restore by `session.read` / `session.send` session id access.
11. Provider 可用性依赖 Hub 本地运行时配置时，AgentFactory 必须是 Hub-scoped 实例；项目上报与 Session 创建必须使用同一个 Factory，不能从进程级全局 Factory 重新推导。

## 3. Responsibilities

### Registry

- Authenticate hub, client, and monitor roles.
- Track which Hub owns each `projectId`.
- Forward App `session.*`, `fs.*`, and `git.*` requests to the owning Hub.
- Broadcast `session.updated` and `session.message` events to App clients.
- Reject retired chat-style request methods.

### Hub Reporter

- Report project snapshots to Registry.
- Register session request handlers for each project.
- Forward `SessionRecorder` output to Registry as `registry.session.*` events.

### Client

- Maintain session registry (`SessionID -> Session`). Multiple Sessions can be Active simultaneously.
- Resolve App session requests by session id.
- Handle `session.new`, `session.list`, `session.read`, `session.send`, `session.cancel`, archive/delete/reload, and config requests.
- Manage SessionStore (SQLite) for persistence/restore.

### Session

- Own business session identity (WheelMaker Session ID, UUID).
- Maintain per-agent state map (`agents map[string]*SessionAgentState`), each holding ACP session id, configOptions, commands, title.
- Own exactly one AgentInstance at a time; switch via snapshot/restore.
- Manage prompt/cancel/config/load/new lifecycle.
- Own a per-session terminalManager.
- Independent promptMu: concurrent Sessions do not block each other.
- Implement `SessionCallbacks` to receive ACP callbacks from AgentInstance.

### SessionRecorder

- Convert ACP/session events into persisted session turns.
- Publish Registry-facing `session.message` and `session.updated` events.
- Keep session list/read projections aligned with live prompt state.

### AgentFactory

- Create AgentInstance by agent type.
- Self-declare `SupportsSharedConn()` capability.
- Select and inject AgentConn policy (shared or owned) automatically.
- If shared: maintain one shared AgentConn internally; multiple `CreateInstance` calls reuse it.
- If owned: each `CreateInstance` creates an independent AgentConn.
- Own the Hub-local provider registry used by both project capability reporting and every project Client.
- Keep runtime-configured credentials inside provider launch configuration; do not project them into Registry-facing provider metadata.

### AgentInstance

- Provide ACP operations (initialize, session/new, session/load, session/prompt, session/cancel).
- Internally hold AgentConn (hidden from Session).
- Dispatch ACP callbacks to its owner Session via SessionCallbacks interface.
- Cache initialize handshake result (initMeta).
- No direct awareness of App or Registry request routing.

## 4. Component Diagram

```mermaid
flowchart LR
    App[Workspace App]
    R[Registry Server]
    H[Hub Reporter]
    C[Client]
    Rec[SessionRecorder]
    S1[Session A]
    S2[Session B]
    I1[AgentInstance codex]
    I2[AgentInstance claude]
    ACs[AgentConn Shared codex]
    ACo[AgentConn Owned claude]
    P1[codex process]
    P2[claude process]
    DB[(SQLite)]

    App -->|session.* projectId + sessionId| R
    R -->|forward request| H
    H --> C
    C -->|SessionByID/CreateSession| S1
    C -->|SessionByID/CreateSession| S2

    S1 --> I1
    S2 --> I2
    I1 --> ACs
    I2 --> ACo
    ACs --> P1
    ACo --> P2

    S1 --> Rec
    S2 --> Rec
    Rec -->|registry.session.message / updated| H
    H --> R
    R -->|session.message / updated| App
    C -.->|persist/restore| DB
    Rec -.->|turn files + projections| DB
```

## 5. Sequence

```mermaid
sequenceDiagram
    participant App as Workspace App
    participant R as Registry
    participant H as Hub Reporter
    participant C as Client
    participant S as Session
    participant I as AgentInstance
    participant AC as AgentConn
    participant A as Agent process
    participant Rec as SessionRecorder

    App->>R: session.send(projectId, sessionId, text)
    R->>H: forward request to owning Hub
    H->>C: HandleSessionRequest(session.send)
    C->>S: PromptToSession(sessionId, blocks)
    S->>I: SessionPrompt(acpSessionId, blocks)
    I->>AC: forward ACP request
    AC->>A: ACP session/prompt

    A-->>AC: session/update
    AC-->>I: dispatch by ACP session id
    I-->>S: SessionUpdate
    S-->>Rec: record ACP/session event
    Rec-->>H: registry.session.message / registry.session.updated
    H-->>R: publish event
    R-->>App: session.message / session.updated
```

## 6. Session State Machine

```text
Created -> Active -> Suspended -> Persisted
              ^          |             |
              +-- Restored <-----------+

Active -> Closed (cancel + cleanup, no persistence)
```

| Status | Meaning | Memory |
|--------|---------|--------|
| Active | Receiving/processing messages | Full |
| Suspended | Session is idle but recoverable | Retained, prompt cancelled |
| Persisted | Suspended timeout or process exit | Only SessionID in index; data in SQLite |
| Restored | Recovered from SQLite back to Active | Full |
| Closed | User explicitly closed | Released |

## 7. Current Implementation Status

- App conversations use Registry `session.*` requests only.
- Session output is recorded by SessionRecorder and published through Registry session events.
- Typed slash commands and chat-style route keys have been removed from runtime.
- Retired chat adapter runtimes have been removed.
- Route binding DB table remains as inert migration schema only; production code does not query or expose it.

## 8. Claude-compatible Provider Isolation

Claude 与 `cc-deepseek`、`cc-glm`、`cc-kimi`、`cc-qwen`、`cc-flicker` 使用稳定 agent ID。每个 `cc-*` provider 都通过 owned connection 启动 `claude-agent-acp`，因此每个 Active WheelMaker Session 仍独占一个 adapter process；provider-specific endpoint、Key、模型和配置目录只存在于该子进程环境。

```text
Hub-scoped AgentFactory
  ├─ claude       ──► ~/.claude
  ├─ cc-deepseek  ──► <stateDir>/.data/cc-deepseek
  ├─ cc-glm       ──► <stateDir>/.data/cc-glm
  ├─ cc-kimi      ──► <stateDir>/.data/cc-kimi
  ├─ cc-qwen      ──► <stateDir>/.data/cc-qwen
  └─ cc-flicker   ──► <stateDir>/.data/cc-flicker
```

Client 持久化 agent ID 与上游 ACP Session ID。恢复扫描器按 agent ID 选择对应 projects 目录（例如 `<stateDir>/.data/cc-flicker/projects`），因而 provider 切换不会把一个上游的 transcript 交给另一个上游。Registry 仍只负责平铺 agent ID 的路由和广播；App 的 Claude 二级展示不改变运行时所有权。

来源：[`../../scope/2026-07-23-claude-compatible-agents/spec-claude-compatible-agents.md`](../../scope/2026-07-23-claude-compatible-agents/spec-claude-compatible-agents.md)。

## 9. Historical Context

The original Architecture 3.0 rollout used chat route keys and command routing while multi-session support was being introduced. That design has been retired. Current code should be read through the App-only Registry/session model above.
