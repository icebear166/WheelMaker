> 由 scope skill 于 2026-07-31 生成

# Hub State Unification

## 目标

WheelMaker 当前把 Hub 运行态分散在 HubState、Project Snapshot 的 `agentProfiles`、`WorkspaceApp` 内多组独立缓存和轮询中，导致 Hub 版本、Skills 管理数据与 Composer 自动提示容易不同步。目标是把 Hub 运行态收敛为服务端拥有的 Section 快照：每个 Section 独立排队、整段原子提交，前端统一订阅和读取；删除 Project Skill 的第二条数据路径，同时按真实 UI 控制更新触发和服务端主动发送，避免重复扫描与广播。

## 决策

- HubState 是 Hub 运行态的唯一权威；删除 `ProjectInfo.agentProfiles`，不双写、不 fallback。
- 保留 `agentPackages`、`wheelmakerUpdate`、`skills`、`tokenStats`、`fileIndex`、`flickerBridge` 六个 Section。
- `releasePublish` 移出 HubState，改为独立 Release Job 协议；HubConfig 继续独立管理持久化配置。
- HubState 只驻内存。Hub 进程重启后重建；Registry 断线重连时重发当前内存快照。
- 每个 Section 独立拥有 mutex、一个运行任务和至多一个补跑；不同 Section 可以并发更新。
- Section 的数据可用性与更新进度分离。刷新期间保留最近成功数据，失败不覆盖数据。
- `hub.state.refresh` 异步入队并立即响应；最终结果通过 `hub.state.updated` 通知。
- 触发式更新和通知式更新都以完整 Section 为提交单位，不支持局部 patch。
- 完整通知到达时立即提交；此前启动的扫描结果作废，并至多补跑一次校正扫描。
- HubState 框架不提供通用周期刷新。`tokenStats` 是业务特例，保留 Usage Service 的启动扫描、10 分钟周期扫描、API Key 变更扫描和手动刷新。
- Hub 启动时异步初始化全部运行态，但 `tokenStats` 由 Usage Service 自己启动，HubState 启动流程不得重复发起第二次 Token 扫描。
- Skills 使用一个 Hub 级 `skills` Section，包含 Hub inventory、Project 本地 inventory 和按 Project/Agent 派生的 effective Skills。
- Skills 只在 Hub 启动、显式 reindex、Project/Agent 拓扑变化和 Skills 操作完成后扫描；不监听文件系统。
- `.agents` / `.claude` 不同步只做非阻塞黄色提示；Composer 继续按当前 Agent 的实际有效 Skills 工作，不自动复制或覆盖文件。
- Registry Protocol 保持 `2.6`，在 2.6 内硬切；Hub 与 Web 配套发布，不保留旧字段兼容层。
- 不增加独立 Skills Management 或 File Index Management 页面；两者继续位于 Hub 菜单。

## 架构

```text
Hub
├─ HubStateManager
│  └─ SectionController[section]
│     ├─ committedData
│     ├─ availability
│     ├─ updateStatus
│     ├─ revision
│     ├─ activeUpdate
│     ├─ pendingRerun
│     ├─ updater
│     └─ updateQueue
├─ UsageService ──notify──> tokenStats
├─ Skills actions / explicit refresh ──enqueue/refresh──> skills
├─ runtime managers ──notify──> corresponding section
└─ Registry Reporter ──hub.state.updated──> Web HubStore

Web HubStore
├─ hubs[hubId].config
└─ hubs[hubId].sections
   ├─ Hub menu selectors
   ├─ UsageStore projection
   └─ Composer Skills selector
```

### HubState

HubState 包含 `hubId`、Hub 进程级 `instanceId` 和 Section map。`instanceId` 在 Hub 进程启动时生成；Registry 重连不改变它。前端遇到新 `instanceId` 时替换该 Hub 的旧状态，避免进程重启后从零开始的 revision 被误判为过期。

每个 Section 至少包含：

```text
availability: empty | ready
updateStatus: idle | queued | updating
revision
updatedAt
lastAttemptAt
lastError
data
```

`revision` 在每次需要对外发布的原子 Section 快照提交时递增，包括完整业务数据成功提交、终态失败以及 `tokenStats` 保留的可见 scanning 状态。`data` 只在业务数据成功时替换，始终保留最近一次成功的完整快照；查询详情、搜索候选和 Action 接收结果不得覆盖它。普通 queued、非 Usage 扫描开始以及无变化成功结果不形成新的对外快照。

### Section Queue

同一 Section 同时最多运行一个 updater。普通重复请求合并到现有任务；运行期间的 `force`、Action 完成或失效通知最多安排一次补跑。多 Section refresh 分别入队和提交，不提供跨 Section 事务。

通知式快照在 Section mutex 下立即提交。正在运行的触发式 updater 记录其起始 revision；完成时若 revision 已变化，则丢弃结果并按单补跑规则校正，避免旧扫描覆盖新通知。

### Frontend Store

Web 建立统一 HubStore，负责 HubState 的 `instanceId + section revision` 判序、refresh 去重和事件消费。`WorkspaceApp` 不再为 WheelMaker Update、NPM、Skills、File Index、Flicker 分别维护独立 Hub 数据缓存、generation ref 和轮询 timer。

UsageStore 可以继续承担跨 Hub 的 Usage 聚合和展示，但只作为 HubStore `tokenStats` 的派生投影，不再拥有独立的 HubState 获取时序。

## 流程

### Hub 启动与重连

Hub 启动后并发初始化 `agentPackages`、`wheelmakerUpdate`、`skills`、`fileIndex`、`flickerBridge`。这些启动更新在内部逐 Section 原子提交，启动批次结束后主动发送一次完整 HubState，避免逐 Section 连续广播。

Usage Service 独立执行首次 `tokenStats` 扫描，并继续保留现有 10 分钟周期；扫描开始和结束的可见状态继续通知 HubState，以维持常驻 Monitor 的刷新反馈。HubState 启动批次不重复调用 Token updater。

Registry 重连时不重新扫描，只主动发送一次当前完整 HubState。Web 首次发现 Hub 时调用 `hub.state.get` 获取当前内存快照，该调用不触发更新。

### Refresh

`hub.state.refresh` 接收一个或多个 Section 以及 `force`：

```text
client refresh
→ enqueue/coalesce
→ immediate response with updateId and queue status
→ updater builds a complete section snapshot
→ atomic commit or retained old data on failure
→ hub.state.updated with the complete changed section
```

服务端不因 Queue 长度、queued、普通扫描开始、心跳或无业务变化结果主动广播。请求方从 refresh 响应获知入队状态，最终成功或失败由一次终态通知表达。`tokenStats` 保留 Usage Service 已有的 scanning/terminal 通知语义。

### 服务端主动发送

客户端没有当前操作时，服务端只因以下事件主动发送：

| 事件 | 发送 |
|---|---|
| Hub 启动运行态初始化结束 | 一次完整 HubState |
| Registry 重连 | 一次当前完整 HubState |
| Usage Service 启动、10 分钟周期或配置变更扫描 | `tokenStats` |
| Flicker 自身进入稳定运行态 | 完整 `flickerBridge` Section |
| Project 加入、移除或路径变化 | 更新后的 `skills`、`fileIndex` Section |
| 先前异步 Action 最终完成 | 对应完整 Section |
| Release Job 状态变化 | 独立 `release.publish.updated` |

不因定时器更新其他 Section，不监听或轮询外部 Skill 文件，不广播每个文件事件、每个日志行或异步任务轮询结果。

### Hub 菜单与其他 UI

| UI/操作 | 更新行为 |
|---|---|
| Web 首次发现 Hub | `hub.state.get`，不扫描 |
| 打开 Hub 菜单 | refresh `wheelmakerUpdate` |
| 展开某个 Hub | refresh `flickerBridge`、`agentPackages`、`skills`、`fileIndex` |
| 展开 Settings | 不重复 refresh；独立读取 HubConfig |
| 展开 NPM、Global Skills、Project Skills、Scan | 只消费展开 Hub 时的数据，不重复 refresh |
| 展开 Visibility 或 MCP | 不触发 HubState |
| Skill Detail / Source Search | 独立查询，不覆盖或刷新 `skills` |
| Composer Slash Menu | 只读取 `skills`，不触发扫描 |
| Chat 文件 `@mention` | 查询现有 File Index，不刷新 `fileIndex` |
| Desktop 常驻 Monitor / 打开 Mobile Monitor | 不因渲染或打开而刷新 |
| Usage Refresh | refresh `tokenStats` |
| API Key 更新 | Usage Service refresh `tokenStats` |
| File Index Scan | 提交 rebuild；完成后服务端更新 `fileIndex` |

前端只在 UI 的 closed→open 或 collapsed→expanded 边沿发起一次请求，不能由 render 或 effect 依赖变化重复触发。同一 Section 已 queued/updating 时，HubStore 和服务端 Queue 都复用现有任务。除 `tokenStats` 的业务周期外，不使用前端或服务端轮询保持 Section 新鲜度。

### Skills

`skills.data` 组织为：

```text
hubInventory
projectLocalInventories[projectId]
effectiveSkills[projectId][agent]
```

Hub Skill 更新时只重扫 Hub inventory，再复用 Project 本地 inventory 重新派生所有 Project 的 effective Skills，并一次性提交整个 `skills` Section。Project Skill 更新时只重扫目标 Project，再组装完整 Section。所有在线 Web 收到同一 revision，因此 Hub 菜单与 Composer 同步切换。

Skill inventory 只在初始化、显式 refresh/reindex、Project/Agent 拓扑变化和 install/uninstall/update 完成后扫描。扫描由当前已注册 Agent 决定；共享目录是 Project/User 的 `.agents/skills` 与 `.claude/skills`，`codebuddy`、`mimo`、`qoder` 的 native 目录只做发现，不做统一管理或链接。物理目录只扫描一次，同名 Skill 聚合所有位置和 Agent 来源。inventory 记录 `.agents`、`.claude` 的位置、`SKILL.md` 指纹、链接目标、managed metadata 和 Agent 可见性，并派生：

```text
aligned | contentMismatch | unknown
```

Hub 菜单在 Skills 汇总和具体 Skill 行显示黄色诊断；受影响 Project 的 Composer 显示非阻塞说明，并继续展示当前 Agent 实际可用的 Skills。不递归比较 supporting files，不自动修复目录差异。

### Release Publishing

删除 HubState `releasePublish` Section，改为：

```text
release.publish.start
release.publish.get
release.publish.updated
```

Version Release 和 Temporary Debug Web 功能、持久化 Job、日志及目标状态继续保留。Release Publishing 页面按 Job API 读取和订阅，不再通过 HubState Action 或 2 秒轮询获取进度。

## 验收标准

- Hub 重启后所有运行态能按各自所有者初始化；Registry 重连不会重复扫描。
- `wheelmakerUpdate` 在启动初始化或 Hub 菜单触发后稳定提供当前版本，不依赖旧的 Project Report 路径。
- 同一 Section 的并发 refresh 只运行一次，并至多补跑一次；不同 Section 可并发。
- refresh 立即返回入队结果，旧数据在更新和失败期间继续可用。
- 通知式快照不会被先前启动的旧扫描覆盖。
- HubState 不存在 `releasePublish`，Project Snapshot 不存在 `agentProfiles`。
- Hub 菜单、Skills 子区和 Composer 使用同一个 `skills` revision。
- Hub/Project Skill 状态通过启动、显式 refresh、拓扑变化和写操作完成后的定向扫描同步；`.agents` / `.claude` 差异得到非阻塞提示。
- Usage Monitor 继续收到启动扫描、10 分钟周期扫描、API Key 更新和手动刷新结果。
- Skills、File Index、WheelMaker Update、NPM、Flicker 不新增周期刷新或前端轮询。
- Hub 菜单子区展开、React render、Composer Slash Menu 和 Monitor 打开不会重复触发 Section 更新。
- Registry Protocol 仍为 2.6，Hub/Web 在同一版本内配套工作，不包含旧兼容 fallback。

### 测试

- HubStateManager 单元测试覆盖原子提交、旧数据保留、并发合并、单补跑、通知抢占和 revision 判序。
- Reporter/Registry 协议测试覆盖异步 refresh 响应、完整 Section 通知、instanceId、Release Job 路由及删除 `agentProfiles`。
- Usage Service 测试保留启动扫描和 10 分钟周期，新增“HubState 启动不重复扫描”验证。
- Skills 测试覆盖 Hub/Project 定向扫描、effective Skills 派生、写操作完成后的刷新和同步诊断。
- HubStore 测试覆盖 instance 切换、revision 去重、事件更新和 refresh 复用。
- Hub 菜单测试按真实 open/expand 边沿断言请求次数；子区、Composer 和 Monitor 测试断言不会隐式 refresh。
- Release Publishing 测试覆盖独立 Job start/get/updated 和移除原 2 秒轮询。
- 运行 Go、Web 单元测试和 TypeScript 类型检查；不新增依赖真实外网、真实 Agent CLI 或真实 Registry 部署的测试。

## 范围之外

- HubState 快照落盘及跨进程恢复。
- Registry Protocol 版本升级或旧 schema 兼容层。
- 自动修复、复制或覆盖 `.agents` / `.claude` Skills。
- supporting files 的递归一致性哈希。
- 新增独立 Skills Management 或 File Index Management 页面。
- 通用 freshness TTL、广播时间窗、客户端 Section 订阅协议等额外防风暴机制。
- 除 `tokenStats` 外的周期刷新。
