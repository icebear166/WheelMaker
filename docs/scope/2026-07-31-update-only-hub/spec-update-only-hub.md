> 由 scope skill 于 2026-07-31 生成，按永久 Registry 兼容策略修订

# Update-only Hub

## 目标

Registry 主协议升级后，旧 Hub 不再因 `protocolVersion` 落后而失去更新机会。Registry 允许认证成功且协议版本较旧的 Hub 保持连接，将其标记为 `update_only`，丢弃其业务上报，只允许 Web 查询更新状态和由用户手动触发更新。Hub 更新并重启到当前协议后，自动恢复正常连接。

该能力是 Registry 从本次开始长期保留的兼容行为，不针对某一次 `2.6 → 2.7` 升级，也不新增维护协议版本。

## 决策

- 不新增 `maintenanceProtocolVersion`、维护握手、专用维护 RPC 或 Hub 端维护适配器。
- Registry 根据现有 `protocolVersion` 派生连接模式：
  - Hub 协议等于 Registry：`normal`。
  - Hub 协议低于 Registry：`update_only`。
  - Hub 协议高于 Registry：拒绝连接。
- `update_only` 只适用于 `role=hub`。Client 仍必须与 Registry 主协议完全一致。
- Token、角色、Hub ID 及现有握手校验照常执行；兼容处理不降低认证要求。
- Registry 在握手成功时登记 Hub 连接，不再依赖项目报告才登记 Hub。
- 旧 Hub 无需感知 `update_only`。它仍按原流程发送项目报告和其他上报；Registry 对需要响应的兼容上报返回成功，但不存储、不路由、不广播其内容。
- Registry 仅允许现有 WheelMaker 更新查询和更新请求穿过受限连接；其他 Client → Hub 操作全部拒绝。
- 更新只由用户在 Web 中明确触发，不自动开始；既有每日 updater 行为不变。
- 受限状态只存在于当前连接。Hub 更新、重启并以当前协议重新握手后自然进入 `normal`。

## Registry 兼容规则

### 握手

不改变 `connect.init` wire contract。Registry 完成正常认证后，按数值组件比较 Hub 与 Registry 的协议版本，不能使用字符串字典序比较。

```text
Hub protocol == Registry protocol  → normal
Hub protocol <  Registry protocol  → update_only
Hub protocol >  Registry protocol  → unsupported protocolVersion
```

`update_only` 是 Registry 内部的连接状态。Registry 可以在现有 Hub descriptor 中以可选字段 `connectionMode: "update_only"` 暴露该状态，但不得要求旧 Hub 发送或理解这个字段。

格式错误、无法比较的协议版本仍按不支持处理。该策略不会修改当前协议常量；何时提升主协议版本仍是独立的发布决策。

### Hub 上报隔离

旧 Hub 的 Reporter 在握手成功后会立即发送 `hub.report.projects`，并把错误响应视为握手失败。因此，受限连接不能简单地对该报告返回错误。

Registry 对 `update_only` Hub 的上报执行以下处理：

- `hub.report.projects`：返回现有成功响应，但丢弃 payload。
- 其他 Hub 主动发送的业务请求和单向事件：静默丢弃，不进入业务路由；若协议要求请求必须有响应，则只返回不含业务数据的成功确认。
- 不创建 Project snapshot，不更新 Project 路由，不广播 Project/Session/状态事件。
- 上报成功响应不能改变连接模式，也不能让 Hub 获得任何业务能力。

因此，App 从 Registry 看到该 Hub 在线，但其项目数自然为 `0`；这不是伪造空项目，而是 Registry 没有接纳任何项目数据。

### 更新白名单

Registry 复用当前已经存在的 HubState 更新路径，不增加新方法：

| 方法 | 允许的 payload | 作用 |
| --- | --- | --- |
| `hub.state.refresh` | 只允许请求 `wheelmakerUpdate` section | 查询本机 WheelMaker 版本与更新任务状态 |
| `hub.state.action` | section 必须为 `wheelmakerUpdate`，action 必须为 `requestUpdate` | 触发现有手动更新流程 |

为维持连接和完成上述请求，Registry 同时允许必要的 `hub.ping` 与对应 response envelope。白名单校验必须同时检查 method 和 payload，不能因为方法属于 HubState 就开放其他 section 或 action。

Registry 对 `update_only` Hub 拒绝所有其他 Client → Hub 操作，包括 Project、Session、文件、Git、Terminal、Relay、HubConfig、NPM、MCP、Skills、发布、Debug Web 以及其他 HubState 查询或动作。

Hub 内部继续使用既有 `wheelmakerUpdate` HubState adapter、`UpdateCommand`、更新锁、状态文件和 `deploy.mjs update` 触发路径，不创建第二套 updater。

## Hub 目录与 App

Registry 的现有项目快照 `hubs[]` 增量携带可选连接状态：

```json
{
  "hubId": "hub-a",
  "connectionMode": "update_only"
}
```

这是对现有响应的向后兼容扩展，不新增协议方法或事件。未提供 `connectionMode` 时，App 按 `normal` 处理。

App 对 `update_only` Hub：

- 显示“版本不兼容，需要更新”。
- 显示现有 WheelMaker 更新状态，并仅保留刷新和手动更新动作。
- 不把该 Hub 放入任何业务扫描、项目操作、配置、终端、Relay、发布或其他选择器。
- 从 Registry 项目快照看到 `0` 个项目。

App 使用既有项目快照刷新机制发现 Hub 状态；打开 Hub 菜单或执行相关刷新时重新获取快照即可，不为该能力增加实时目录事件。

更新请求被接受后，Hub 在应用更新过程中断线属于预期行为。新 Hub 以当前协议重连时 descriptor 恢复为 `normal`，随后正常上报项目并恢复全部入口。若更新失败且旧 Hub 重新启动，它再次进入 `update_only`，用户可以查看失败状态并重试。

## 长期兼容约束

从该能力发布起，Registry 必须长期保留当前 `wheelmakerUpdate` 查询/请求 payload 子集及其响应语义，使任何实现了该子集的旧 Hub 都能通过未来 Registry 更新。

未来主协议可以继续演进，但 Registry 的受限防火墙不得随着完整 HubState 协议一起放宽。若更新实现内部变化，应在 Hub/Registry 内部适配并保持该既有 wire 子集兼容，不通过新增维护版本重新建立平行协议。

早于该更新子集、无法处理现有 `wheelmakerUpdate` 请求的历史 Hub 仍可进入受限连接，但查询或更新会返回其真实的不支持结果；Registry 不模拟 Hub 不具备的更新能力。

## 流程

```text
旧 Hub connect.init
→ Registry 完成正常认证
→ 发现 Hub protocol 低于 Registry
→ 将连接标记为 update_only，并立即登记 Hub
→ 旧 Hub 照常发送项目报告
→ Registry 成功应答但丢弃报告
→ App 快照中看到该 Hub、项目数为 0
→ App 只显示更新状态与手动更新动作
→ Registry 仅放行 wheelmakerUpdate 查询/请求
→ Hub 复用现有 updater 执行更新并重启
→ 新 Hub 以当前协议重连
→ Registry 将连接作为 normal
→ Hub 正常上报项目，App 恢复完整能力
```

## 验收标准

- 协议相同的 Hub 行为不变，连接模式为 `normal`。
- 认证成功且协议较旧的 Hub 能保持 `update_only` 连接，不要求 Hub 代码理解受限模式。
- Hub 协议高于 Registry、协议格式无效、Token 错误或角色不合法时不能进入 `update_only`。
- Client 协议不匹配时仍拒绝连接。
- 受限 Hub 在现有 Hub 目录中可见，Project 列表中没有该 Hub 的项目。
- Registry 对受限 Hub 的自动项目报告成功应答但不存储、不路由、不广播。
- App 对受限 Hub 只显示版本不兼容状态、更新状态刷新和手动更新动作。
- 只有 `wheelmakerUpdate` refresh 和 `requestUpdate` action 可以穿过受限连接；同一 HubState 方法下的其他 payload 也必须拒绝。
- 更新继续复用现有更新锁、状态文件、可信发布链和部署触发路径。
- Hub 更新后以当前协议重新连接时自动恢复 `normal`，无需清理 Registry 端状态。
- 方案不增加 maintenance version、专用 maintenance RPC、Hub 端握手分支或实时 Hub 目录事件。
- 后续 Registry 主协议升级继续沿用同一判定与受限白名单，不编写针对特定版本对的迁移分支。

### 测试

- Registry 连接测试覆盖认证优先级、协议数值比较、Hub 三种版本关系和 Client 严格匹配。
- Registry 路由测试覆盖受限 Hub 握手即登记、项目报告成功丢弃、Project 不可见、断开清理。
- Registry 防火墙测试覆盖两个允许的精确 update payload、必要 ping/response，以及所有其他请求、事件和变体被拒绝或丢弃。
- 现有 Hub Reporter 测试证明 Registry 的兼容响应能让旧握手流程保持在线；不修改 Reporter 行为。
- App 测试覆盖受限 descriptor、零项目、仅更新动作、业务扫描过滤和正常 Hub 不回归。
- 不在本项目测试中执行真实系统任务注册、真实二进制替换或公网发布。

## 范围之外

- 本次不提升 Registry 主协议版本。
- 不支持新版 Hub 连接旧 Registry 的反向受限模式。
- 不修改 Hub Reporter 握手或增加 Hub 端兼容分支。
- 不自动触发更新，不改变每日 updater 策略。
- 不新增 updater、回滚机制、部署 URL 输入或绕过现有 SHA-256/HTTPS 信任链的路径。
- 不为受限 Hub 提供任何降级版 Workspace 或只读业务能力。
