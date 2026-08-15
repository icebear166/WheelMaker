> 摘要：本方案定义 Registry WebSocket 的统一连接管理层、静默重连、半开检测、消息生命周期、状态恢复和关键日志策略。

# Registry WebSocket 连接管理重构方案

## 状态

- 状态：已确认，待实施。
- 日期：2026-08-15。
- 范围：Registry WebSocket；覆盖 Web、Desktop、APK 使用的前端 Registry 通道，以及 Registry 服务端 WebSocket 对端。
- 不包含：Android WebMessage bridge、Android 原生 Doubao speech WebSocket，以及其他独立 WebSocket。
- 协议版本：保持 Registry 2.7，不因本方案升级主版本。

## 1. 目标

本次重构的首要目标是维护上层应用稳定性。连接异常、断线、半开连接和重连不应要求每个业务模块单独处理，也不应因为一次短暂网络波动触发业务错误提示、页面状态清空或多个重连循环。

目标包括：

- 由一个连接管理层独占 Registry WebSocket 的建立、发送、接收、关闭和重连。
- 维护明确的逻辑连接状态，只有业务状态恢复完成后才进入 ready。
- 对上层静默处理预期的连接异常；不把原始 WebSocket 错误传播到业务模块。
- 已发送 request 不自动重发，不跨连接保存 request state。
- 断线后从 Registry 权威状态重新恢复当前项目、活跃聊天和终端。
- 使用服务端原生 Ping/Pong，并补充浏览器侧可观察的技术级 heartbeat。
- 记录关键连接生命周期事件，不记录正常高频心跳和普通消息。

## 2. 当前问题

当前 RegistryClient 同时承担物理连接、request pending、request timeout、业务 liveness probe、event 分发和 close 通知：

- 普通 request 默认使用约 8 秒业务超时；超时后通过 server.config.get 做业务探活。
- 连接关闭时统一 reject pending，但没有区分已发送、未发送、旧连接和未知 response。
- request 在 ready 检查和 WebSocket send 之间发生断开时可能留下 pending，或者直接抛出底层 send 异常。
- 没有 request 重放和操作级恢复，断线后的结果只能由上层零散修复。
- RegistryWorkspaceService 通过创建新 Repository、connectionGeneration 和 retry delay 防止旧连接覆盖新连接，但它仍然是连接生命周期的第二个控制器。
- WorkspaceApp 还维护连接重试、close 处理、visibility/online 监听和 Android WebView frame watchdog，多处可能同时触发重连。
- 服务端当前使用“5 分钟无客户端入站消息即 idle close”，这会使安静的 PC 进入连接状态异常；connect.init 返回的 PingPong 能力声明也没有对应的完整原生 Ping/Pong 管理。
- 当前 app diagnostics 没有独立 connection 类别。

## 3. 目标架构

WorkspaceApp / platform lifecycle adapter
  → pause / resume / status subscription
RegistryWorkspaceService
  → domain recovery and event consumers
RegistryRepository
  → stable domain API and centralized transport-error adapter
RegistryConnectionManager
  → FSM, socket ownership, request matching, routing, retry, heartbeat, epoch and diagnostics
RegistrySocket
  → DOM WebSocket only
Registry server peer

### 3.1 RegistrySocket

RegistrySocket 只封装浏览器 WebSocket 的物理行为：

- 创建和关闭 DOM WebSocket。
- 转发 open、message、error、close。
- 执行原始 send，并把同步 send 异常返回给管理层。
- 不维护业务 request、不设置业务 timeout、不决定是否重连。

现有 RegistryClient 可以在实施时拆分为 RegistrySocket 和 RegistryConnectionManager；如为降低迁移风险暂时保留文件名，职责仍必须按上述边界拆开。

### 3.2 RegistryConnectionManager

连接管理层是 Registry WS 的唯一消息出入口和唯一重连所有者，负责：

- 连接状态机和单一重连循环。
- 每个物理连接的 connection epoch。
- requestId 分配、当前连接 pending 匹配和 pending 上限。
- 合法 event 的统一转发。
- 旧连接 response、未知 response 和已结束 request 的丢弃。
- 握手、技术 heartbeat、恢复控制消息。
- pause/resume、在线状态、认证失败和主动关闭。
- 关键连接诊断日志。

管理层不理解聊天、终端和 Hub 业务数据，不重放业务消息，不维护跨连接业务 state。

### 3.3 RegistryRepository 与 RegistryWorkspaceService

RegistryRepository 继续提供领域方法，但所有方法通过统一 transport adapter 调用 ConnectionManager：

- 预期的 ConnectionInterruptedError 由 Repository 统一捕获和归一化。
- 不把 WebSocket close、send failure、半开检测等异常传播到每个业务调用方。
- 业务错误、认证错误和明确的服务端业务错误仍保留正常语义。
- 副作用 request 被中断时不伪造成功，不自动重发；恢复后的权威状态负责反映服务端最终状态。

RegistryWorkspaceService 变成恢复协调器：

- 连接建立后执行项目、Hub、活跃聊天和终端的权威恢复。
- 连接事件监听在连接开始前绑定，避免恢复期间丢失合法 event。
- 调用 completeRecovery(epoch) 后，ConnectionManager 才能从 recovering 进入 ready。
- 删除当前 Repository 轮换式连接所有权、独立 retry 和 close 驱动的重连。

### 3.4 WorkspaceApp 与三端生命周期

Web、Desktop、APK 使用同一套前端 ConnectionManager。平台适配层只提供：

- pause：后台或明确要求暂停。
- resume：回到前台或网络重新在线。
- keepAlive：存在活跃任务时阻止后台暂停。

WorkspaceApp 不再直接创建 WebSocket、不再维护重连计时器、不再根据每个业务模块的 onClose 自行重连。UI 可以订阅逻辑连接状态，但预期断线不进入业务错误流程。

## 4. 状态机

公开逻辑状态：

| 状态 | 含义 |
| --- | --- |
| idle | 尚未启动或已释放 |
| connecting | 正在创建物理 WebSocket 或执行初始握手 |
| recovering | 物理连接和握手已完成，正在恢复权威业务状态 |
| ready | 业务状态恢复完成，可以接收新的业务消息 |
| reconnecting | 物理连接丢失，正在按退避策略重连 |
| paused | 由后台、离线或上层主动暂停，停止重连 |
| auth_required | 认证失效，等待上层刷新认证后恢复 |
| stopped | 主动关闭，不再自动重连 |

关键规则：

- 初次连接和每次重连都必须经过 recovering，不能握手成功后直接报告 ready。
- ready 断线后先进入 reconnecting；新 socket 握手成功后进入 recovering。
- 只有当前 epoch 的恢复协调器调用 completeRecovery，状态才能进入 ready。
- 新 socket 建立后，所有旧 socket callback 都必须失效。
- 并发 connect 调用合并为同一个连接尝试；不能产生多个 retry owner。
- 预期网络错误、半开和服务端异常关闭无限重试，使用指数退避和 full jitter，建议上限 30 秒；进入 ready 后重置退避。
- offline、pause 和后台状态停止重试；resume 或 online 触发一次立即检查。
- 认证失效进入 auth_required，等待认证刷新，不进行无效热循环。
- stop 是明确的用户或生命周期关闭，不自动恢复。

退避数值、心跳间隔和 pending 上限是实现参数，不是业务协议契约；实现时应集中定义并可测试。

## 5. Connection Epoch

每次创建新物理 WebSocket 时递增 epoch。所有 request、response、event callback 和恢复任务都带有内部 epoch：

- pending 只属于创建它的 epoch。
- 旧 epoch 的 response 即使 requestId 恰好存在，也不能影响新 epoch。
- 连接关闭时清空该 epoch 的 pending，并以 ConnectionInterruptedError 结束底层 Promise。
- 旧 socket 的 late onopen、onmessage、onerror、onclose 全部忽略。
- epoch 不要求写入普通业务 envelope；如协议需要服务端判断旧数据，继续使用已有的业务 connectionEpoch 或 seq 语义。

## 6. 消息出入口规则

### 6.1 出站消息

| 消息 | ready | reconnecting/recovering | 处理 |
| --- | --- | --- | --- |
| 普通 request | 发送 | 不发送 | 返回 ConnectionNotReadyError |
| 普通 event | 发送 | 不发送 | 直接丢弃或返回发送失败，不排队 |
| connect.init | 管理层内部 | 管理层内部 | 仅用于新 epoch 握手 |
| connect.ping | 管理层内部 | 管理层内部 | 技术 heartbeat，使用技术 deadline |
| 恢复请求 | 管理层/恢复协调器 | recovering 允许 | 仅用于当前恢复流程 |

不设置通用出站队列。尤其不允许把聊天发送、终端输入、语音 chunk 或其他副作用消息隐式延迟到恢复后执行。

### 6.2 入站消息

| 消息 | 处理 |
| --- | --- |
| 当前 epoch 且匹配 pending 的 response/error | 完成或拒绝对应 request |
| 无匹配 pending 的 response/error | 直接丢弃，不抛错、不重连、不写高频日志 |
| 旧 epoch response | 直接丢弃 |
| 合法 event | 立即转发，即使当前处于 recovering |
| 握手、heartbeat、恢复控制消息 | 由 ConnectionManager 内部消费 |
| 无法解析或不符合 envelope 的消息 | 丢弃；只有严重或连续协议异常才关闭物理连接 |

ConnectionManager 不缓存业务 event。恢复协调器通过项目快照、聊天 read-repair、终端 snapshot/seq 和业务去重处理恢复期间到达的 event。

### 6.3 Request 生命周期

一个普通 request 只有以下结束路径：

- 收到匹配 response：resolve。
- 收到匹配 error：reject RegistryRequestError。
- AbortSignal 主动取消：reject AbortError。
- 物理连接失效：reject ConnectionInterruptedError，立即清理。
- pending 数量或聚合内存达到上限：新 request 返回 PendingLimitError，已有 request 不因上限被超时取消。
- 管理层主动关闭：reject ConnectionInterruptedError 或明确的 stopped error。

不设置业务 timeout。建议初始使用 256 个 pending request 和 32 MiB 聚合序列化大小作为硬上限，最终数值在实现测试中校准。

### 6.4 上层稳定性契约

底层 Promise 仍必须及时结束，以避免 pending 泄漏；但 ConnectionInterruptedError 只在 ConnectionManager 到 Repository 的边界内部使用。Repository 统一消费预期连接中断，业务模块不需要各自添加 WebSocket 异常 catch、重连和静默逻辑。

对只读操作，恢复流程重新读取权威数据；对副作用操作，不自动重发，也不把中断伪装成成功。服务端可能已经执行但 response 丢失时，以恢复后的权威状态为准，避免连接层制造重复副作用。

## 7. 恢复流程

一次新的 epoch 按以下顺序恢复：

1. 建立 WebSocket，执行 connect.init。
2. ConnectionManager 进入 recovering，并通知 RegistryWorkspaceService。
3. 读取 Registry 项目和 Hub 权威快照，替换旧连接关联的目录状态。
4. 清空当前活跃聊天和终端的连接态运行时，从服务端权威起点重新建立。
5. 活跃聊天执行 session read/read-repair；活跃终端执行 snapshot 并按 seq 补齐。
6. 恢复期间到达的合法 event 继续转发，由领域 store 按 revision、turnIndex 或 seq 去重。
7. 非活跃会话不在 ready gate 内全部加载，按用户访问按需恢复。
8. 所有必需恢复步骤成功后调用 completeRecovery(epoch)，进入 ready。

“从 0 恢复”表示不继承旧连接 epoch 的 pending、订阅、response 或运行态判断；不要求每次重新下载所有历史数据。持久化缓存只能作为渲染优化，不能在权威恢复前覆盖服务端状态。

## 8. 心跳与半开连接

### 8.1 服务端

Registry 服务端使用 gorilla/websocket 的原生控制帧：

- writer 统一发送 Ping control frame。
- Pong handler 更新最近一次有效 Pong 时间并刷新 read deadline。
- 读超时或连续未收到 Pong 时关闭 peer，触发客户端重新建连。
- 所有 control frame 写入必须经过 peer 的唯一 writer，不能和普通 writer 并发写。
- 删除当前 clientIdleTimeout 以及“无客户端业务入站就关闭”的 idle timer。

正常业务空闲不再被当作连接异常。connect.init 中已有的 PingPong 能力声明应与实际行为一致。

### 8.2 浏览器前端

浏览器 JS 不能主动发送原生 WebSocket Ping，因此 ConnectionManager 还需要技术级 connect.ping request/response：

- 只在长时间没有入站 frame 时触发。
- 只用于确认客户端到 Registry 的应用层往返。
- 具备独立技术 deadline，不属于业务 request。
- 超时后主动使当前 socket 失效，让状态机进入 reconnecting。
- 不加入普通业务 request 重试，不向上层暴露 heartbeat 错误。

connect.ping 是 Registry 2.7 内的连接层控制方法，只由 ConnectionManager 使用，不对业务模块开放；不升级 protocolVersion。正常 heartbeat 不记录日志，只记录 heartbeat timeout 等异常。

## 9. 静默重连与日志

前端复用现有 app diagnostics，新增 connection 类别和统一记录入口。只记录关键事件：

- state_changed
- connect_attempt_failed
- handshake_failed
- recovery_started
- recovery_completed
- recovery_failed
- socket_closed
- heartbeat_timeout
- request_interrupted
- pending_limit_reached

诊断字段可以包含 epoch、attempt、旧/新状态、reason、close code、retry delay、恢复阶段、pending 数量和最近入站时间；不得包含 Token、消息正文、语音数据或普通 payload。

不记录每次正常 Ping/Pong、普通 frame 收发和每个 event。服务端使用现有 Registry logger 记录同类生命周期信息，保持 payload 脱敏。

## 10. 预计实施范围

### 前端

- 重构 app/web/src/registry/RegistryClient.ts 的职责，形成 RegistrySocket 和 RegistryConnectionManager。
- 调整 app/web/src/registry/RegistryRepository.ts，使 transport interruption 在统一边界归一化。
- 重构 app/web/src/registry/RegistryWorkspaceService.ts，使其成为恢复协调器，移除多代 Repository 和独立重连所有权。
- 收敛 app/web/src/app/WorkspaceApp.tsx 的 connect、onClose、retry、visibility、online/offline 和 frame watchdog 逻辑。
- 在 app/web/src/debug/appDiagnostics.ts 和 workspaceDiagnostics.ts 增加 connection 类别及统一记录入口。
- 保持领域 API 尽量稳定，避免把 WebSocket 错误处理扩散到调用方。

### 服务端

- 修改 server/internal/registry/server.go 的 peer read/write 生命周期，加入原生 Ping/Pong 和 read deadline。
- 删除 client idle timeout 关闭路径。
- 注册并处理 connect.ping 控制方法。
- 继续使用现有 Registry envelope、认证、路由和 16 MiB 完整消息限制。

## 11. 测试与验收

### 前端单元测试

- connecting、reconnecting、recovering、ready、paused、auth_required、stopped 状态转移。
- 多次 connect 合并，旧 socket callback 不影响新 epoch。
- send 与 close 竞态不留下 pending。
- 无业务 timeout；response、error、abort、ConnectionInterruptedError 和 PendingLimitError 正确结束。
- 无匹配 response、旧 epoch response 和已完成 request response 被丢弃。
- 非 ready request/event 不排队。
- event 在 recovering 期间可转发。
- 指数退避、pause/resume、online/offline 和认证恢复。
- heartbeat timeout 触发 socket 失效和重连，正常 heartbeat 不产生日志。

### 服务端测试

在现有 server/internal/registry/server_test.go 等 Registry 测试中扩展：

- 原生 Ping/Pong 和 Pong read deadline。
- 普通业务空闲超过 5 分钟不会被 idle timer 主动关闭。
- connect.ping 只允许连接层使用并返回技术响应。
- peer writer 不发生并发写。
- close reason、认证失败和协议异常分类保持稳定。

### 跨平台验收

- Web、Desktop、APK 共用同一连接管理行为。
- PC 长时间无业务操作仍保持逻辑 ready。
- 断网、恢复网络、服务端重启、代理断开、半开连接和 Android WebView resume 都能静默恢复。
- 断线期间页面不清空现有 UI，不出现重复 retry，不产生未处理 Promise rejection。
- 恢复完成前不允许新的业务 request；恢复完成后项目、活跃聊天和终端状态与 Registry 权威状态一致。
- 已发送副作用 request 不会被自动重复执行。

## 12. 风险与边界

- 已发送 request 在 response 丢失时无法知道服务端是否执行；本方案明确采用不重发和恢复后以权威状态为准。
- Registry 没有通用 event history，因此领域恢复必须依赖现有 snapshot、read-repair、revision 和 seq 机制。
- 连接层不能保证 terminal input、speech chunk 等 fire-and-forget event 在断线时送达；这些消息在非 ready 时直接丢弃。
- heartbeat、退避和 pending 上限需要通过真实 Web、Desktop、APK 网络场景校准，但不能演变为业务 timeout 或分散的重连控制器。

## 13. 参考

- 当前实现：app/web/src/registry/RegistryClient.ts
- 当前连接协调：app/web/src/registry/RegistryWorkspaceService.ts
- 当前领域封装：app/web/src/registry/RegistryRepository.ts
- 当前应用生命周期：app/web/src/app/WorkspaceApp.tsx
- 当前服务端 WebSocket：server/internal/registry/server.go
- Registry 协议：docs/wiki/protocols/registry.md
- Session 恢复：docs/wiki/architecture/session-management-and-sync.md
- Gateway 与 WebSocket 入口：docs/wiki/architecture/gateway.md
- 问题来源：分享页面 kEwnInbqImYrMZKz88f1-wTcKNSdomvlLClEVquY0Cw 记录的 Registry 五分钟 idle close 与多重重连问题。
