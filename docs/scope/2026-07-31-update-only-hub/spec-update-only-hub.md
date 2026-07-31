> 由 scope skill 于 2026-07-31 生成

# Update-only Hub

## 目标

Registry 主协议硬切后，旧 Hub 会在 `connect.init` 阶段被拒绝，因而无法再通过 Web 主动触发自身更新。目标是在不放宽完整业务协议兼容性、不自动更新 Hub 的前提下，引入一套独立且长期稳定的维护协议：经过正常认证、主协议落后但维护协议兼容的 Hub 可以以 `update_only` 模式连接，只暴露版本查询和更新请求；更新并重启到当前主协议后自动恢复正常连接。

## 决策

- 主业务协议继续由 `protocolVersion` 控制；本次只增加 `maintenanceProtocolVersion: 1`，不修改当前 Registry protocol version。
- 维护兼容只允许单向降级：Hub 主协议低于 Registry 时可以进入 `update_only`；Hub 主协议高于 Registry 时仍拒绝连接。
- 只有 Hub 与 Registry 都明确支持同一个 maintenance protocol version 时才允许受限连接。未声明维护版本的更老 Hub 不获得推断式兼容。
- Token、Hub ID、角色及其他现有认证检查在判断受限连接前照常执行；`update_only` 不是认证降级。
- `update_only` Hub 由 Registry 暴露在 Hub 目录中，但不注册、不缓存、不广播任何 Project。
- 更新由用户在 Web 中明确触发，不因受限连接成功而自动开始；目标机既有的每日 updater 保持不变。
- 维护通道使用固定的专用方法 `hub.maintenance.update.query` 和 `hub.maintenance.update.request`，不复用会随主协议演进的 HubState envelope。
- 维护协议 v1 的 wire contract 一旦发布即保持向后兼容。未来若维护协议本身必须做破坏性调整，则新增 maintenance version，而不是改变 v1 语义。
- 主协议下一次硬切必须分阶段发布：先让当前主协议 Hub 获得 maintenance v1，再在后续发布中提升主协议版本。更早且没有 maintenance v1 的 Hub 仍通过每日 updater 或完整安装命令恢复。

## 架构

Registry 连接状态新增 `normal` 与 `update_only` 两种模式。正常模式继续使用现有主协议方法注册表；受限模式使用独立的维护方法白名单。Hub Reporter 在握手中声明 maintenance version，并根据 Registry 返回的连接模式决定是继续完整项目上报，还是跳过所有业务初始化、只进入维护请求循环。

Registry 的 Hub 连接目录与 Project snapshot 分离：`update_only` 连接只贡献 Hub descriptor，不创建空 Project 或伪造在线 Project。Registry 在 Hub 连接模式变化或断开时发布 `registry.hub.updated` 客户端事件，使已经打开的 App 不依赖 Project 报告或重新连接就能更新 Hub 目录。App 从现有 Hub 列表读取连接模式和版本信息；更新页面为受限 Hub 渲染专用状态，其他 Hub 业务入口不得把它视为可操作的正常 Hub。

### 握手契约

Hub 的 `connect.init` 增量携带：

```json
{
  "protocolVersion": "2.6",
  "maintenanceProtocolVersion": 1,
  "role": "hub",
  "hubId": "hub-a"
}
```

Registry 成功响应增量携带：

```json
{
  "ok": true,
  "connectionMode": "update_only",
  "serverInfo": {
    "protocolVersion": "2.7",
    "maintenanceProtocolVersion": 1
  }
}
```

判定顺序为：

1. 校验 payload、角色、Hub ID 和 Token。
2. 主协议相同则返回 `normal`。
3. Hub 主协议低于 Registry，且双方 maintenance version 相同，则返回 `update_only`。
4. Hub 主协议高于 Registry、maintenance version 缺失或不匹配时，返回 `unsupported protocolVersion` 并关闭连接。

主协议版本必须按数值组件比较，不能按普通字符串字典序比较。`role=client` 不参与维护降级，仍要求主协议完全匹配。

### 维护方法

maintenance v1 只定义：

| 方法 | 方向 | 语义 |
| --- | --- | --- |
| `hub.ping` | Hub → Registry | 保持连接及确认 Registry 可达 |
| `hub.maintenance.update.query` | App → Registry → Hub | 查询本机安装版本、更新任务状态及是否可请求更新 |
| `hub.maintenance.update.request` | App → Registry → Hub | 原子接受一次更新请求并触发既有 `deploy.mjs update` 路径 |

query/request 的响应沿用现有 UpdateCommand 中与更新相关的固定字段语义，包括 Hub ID、已安装版本、任务状态、是否可请求、job ID 和错误码，但不包含其他 HubState section。Hub 内部复用现有 UpdateCommand 和 updater trigger，不创建第二套部署器或更新状态文件。

Registry 对 `update_only` 连接拒绝所有其他 Hub 请求、事件及转发，包括 Project、Session、文件、Git、HubState、HubConfig、Skills、发布、Debug Web、Relay 和业务状态事件。受限 Hub 也不得通过项目报告把自己提升为正常模式；只有断开并以当前主协议重新握手才能进入 `normal`。

### Hub 目录与 App

Hub descriptor 增量提供：

```json
{
  "hubId": "hub-a",
  "connectionMode": "update_only",
  "protocolVersion": "2.6",
  "supportedProtocolVersion": "2.7"
}
```

App 将其显示为“版本不兼容，需要更新”，只提供刷新更新状态和“更新”动作。该 Hub 不产生 Project，不可进入 Chat、Code、State、配置或其他业务界面。普通 Hub 的现有显示和交互保持不变。

Registry 在 Hub 建连、连接模式变化和断开时发送 `registry.hub.updated`，payload 携带完整 Hub descriptor 和 `online` 状态。App 用该事件增量更新 Hub 目录；收到断开事件时不保留一个可继续操作的离线 Hub。若断开前已有 accepted 更新任务，App 可以保留本地的“正在重连”展示，直到 Hub 重新上线或 Registry 连接自身中断。

App 发出更新请求并收到 accepted/job ID 后，将连接中断视为更新应用阶段的预期行为。Hub 以新版本重新上线后，目录 descriptor 变为 `normal`，App 自动恢复正常入口。更新失败但旧 Hub 能重新启动时，它再次以 `update_only` 连接，UI 展示可查询的失败状态并允许重试。

## 流程

```text
旧 Hub connect.init
→ Registry 完成正常认证
→ 主协议较旧 + maintenance v1 匹配
→ 返回 connectionMode=update_only
→ Hub 跳过 Project 报告和业务初始化
→ Registry 将受限 Hub 放入 Hub 目录
→ Registry 向已连接 App 发布 registry.hub.updated
→ App 显示“版本不兼容，需要更新”
→ 用户查询状态并点击更新
→ Registry 仅转发 maintenance update request
→ Hub 复用现有 updater 接受任务
→ Hub 在 applying 阶段断开并被替换
→ 新 Hub 以当前主协议重连
→ Registry 返回 connectionMode=normal
→ Hub 完成 Project 报告，App 恢复完整能力
```

## 验收标准

- 主协议相同的 Hub 与 App 行为不变，连接模式为 `normal`。
- 认证成功、主协议较旧且 maintenance v1 匹配的 Hub 能保持 `update_only` 连接。
- `update_only` Hub 出现在 Hub 目录中，但 Project 列表中没有该 Hub 的项目。
- Hub 进入 `update_only`、更新后进入 `normal` 或断开时，已连接 App 能通过 Hub 目录事件及时更新，不依赖 Project 报告。
- App 对 `update_only` Hub 只显示版本不兼容状态、更新状态刷新和手动更新动作。
- maintenance query 返回本机安装版本和现有更新任务状态，不访问或信任 App 提供的发布 URL。
- maintenance request 复用现有更新锁、状态文件和 `deploy.mjs update` 触发路径；重复请求保持现有幂等/冲突语义。
- Registry 对 `update_only` Hub 的所有非维护业务请求和事件返回 `FORBIDDEN`，且不会因 Project 报告升级连接模式。
- Hub 主协议高于 Registry、maintenance version 缺失或不匹配、Token 错误及非 Hub 角色都不能进入 `update_only`。
- 更新后 Hub 以当前主协议重新连接时自动恢复 `normal`，无需清理 Registry 端兼容状态。
- 当前主协议版本在引入 maintenance v1 时保持不变；下一次主协议硬切是独立发布决策。

### 测试

- Registry 单元/连接测试覆盖认证优先级、版本数值比较、两种连接模式、拒绝矩阵和受限方法白名单。
- Registry 路由测试覆盖受限 Hub 目录可见、Project 不可见、Hub 目录事件、维护请求可转发、其他请求全部拒绝。
- Hub Reporter 测试覆盖声明 maintenance v1、识别 `update_only`、跳过 Project 报告，以及只处理 maintenance query/request。
- Hub 更新工具测试复用现有 UpdateCommand fixtures，证明专用维护方法没有绕过更新锁、状态校验或本地可信发布链。
- App 测试覆盖受限 Hub 卡片、仅更新动作、正常 Hub 不回归，以及更新断线后重新连接的状态迁移。
- 不在本项目测试中执行真实系统任务注册、真实二进制替换或公网发布；继续依赖部署脚本现有平台测试与发布验收。

## 范围之外

- 本次不提升 Registry 主协议版本。
- 不为未声明 maintenance v1 的历史 Hub 猜测或模拟更新能力。
- 不支持新版 Hub 连接旧 Registry 的反向受限模式。
- 不自动触发更新，不改变每日 03:00 updater 策略。
- 不新增 updater、回滚机制、部署 URL 输入或绕过现有 SHA-256/HTTPS 信任链的路径。
- 不允许 `update_only` 访问任何只读业务能力；“受限”严格等于维护更新通道，而不是降级版 Workspace。
