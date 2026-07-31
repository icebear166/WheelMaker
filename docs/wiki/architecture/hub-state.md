> 摘要：本页维护 Hub 运行态 Section 的所有权、原子更新队列、主动同步边界、Skills 唯一数据源和前端 HubStore 约定。

# HubState

> 状态：目标架构已批准，来源为 [`Hub State Unification spec`](../../scope/2026-07-31-hub-state-unification/spec-hub-state-unification.md)。

HubState 是 Hub 运行态的唯一权威，Registry 只负责鉴权和路由，Web 只缓存并派生展示。HubState 只驻内存；Hub 进程重启后重新构建，Registry 断线重连时复用当前内存快照。

## 状态边界

HubState 固定包含六个 Section：

- `agentPackages`
- `wheelmakerUpdate`
- `skills`
- `tokenStats`
- `fileIndex`
- `flickerBridge`

`releasePublish` 是独立的长任务域，不属于 HubState。HubConfig 是持久化配置域，也不属于 HubState。Project Snapshot 不承载 Skills 或 `agentProfiles`；Hub 菜单内的 Global/Project Skills 区域和 Composer 自动提示都读取 `skills` Section，不新增独立 Skills 管理页。

HubState 使用 Hub 进程级 `instanceId`。每个 Section 使用独立 `revision`；Web 先按 `instanceId` 区分 Hub 进程实例，再按 Section revision 拒绝旧事件。

## Section 模型

每个 Section 分离数据可用性和更新进度：

```text
availability: empty | ready
updateStatus: idle | queued | updating
revision
updatedAt
lastAttemptAt
lastError
data
```

`data` 始终是最近一次成功提交的完整快照。刷新期间继续可用；刷新失败只更新终态错误，不清空旧数据。查询详情、搜索候选和 Action 接收结果不覆盖 Section data。

Section revision 在需要对外发布的完整 Section 快照提交时递增。普通 queued、非 Usage 扫描开始和无变化成功结果不产生广播；`tokenStats` 保留常驻 Monitor 需要的 scanning/terminal 可见状态。

## 更新队列

每个 Section 独立拥有 mutex、一个运行任务和至多一个补跑：

- 同一 Section 的普通重复 refresh 合并。
- 运行期间收到 `force`、Action 完成或失效通知时，最多安排一次补跑。
- 不同 Section 可以并发。
- 多 Section refresh 分别提交，不提供跨 Section 事务。

触发式 updater 构造完整 Section 快照后原子提交。通知式更新也必须提供完整 Section 快照；通知到达时立即提交。若通知发生在旧扫描运行期间，旧扫描完成结果作废，并按单补跑规则校正。

`hub.state.refresh` 只负责入队并立即返回 `updateId` 和队列状态；最终成功或失败通过 `hub.state.updated` 发送完整 Section。

## 启动与主动发送

Hub 启动时异步初始化 `agentPackages`、`wheelmakerUpdate`、`skills`、`fileIndex` 和 `flickerBridge`，启动批次结束后发送一次完整 HubState。Registry 重连不重新扫描，只发送一次当前完整 HubState。

`tokenStats` 由 Usage Service 自己拥有启动扫描和 10 分钟周期扫描；HubState 启动流程不得重复发起 Token 扫描。API Key 更新和用户手动刷新也会触发 Usage 扫描。HubState 框架不为其他 Section 提供通用周期刷新。

客户端没有当前操作时，服务端只因以下真实状态变化主动发送：

- 启动初始化完成或 Registry 重连。
- Usage Service 扫描状态和结果变化。
- debounce 后确认的外部 Skill inventory 变化。
- Flicker 生命周期进入稳定状态。
- Project 加入、移除或路径变化。
- 先前异步 Action 最终完成。

Queue 长度、普通 updater 开始、心跳、单个文件事件、日志行和无变化扫描不产生 HubState 广播。

## Skills

每个 Hub 只有一个 `skills` Section：

```text
hubInventory
projectLocalInventories[projectId]
effectiveSkills[projectId][agent]
```

Hub Skill 更新时只重扫 Hub inventory，再复用 Project 本地 inventory 派生全部 effective Skills。Project Skill 更新时只重扫目标 Project。最终始终原子提交完整 `skills` Section，使 Hub 菜单和 Composer 使用同一 revision。

Hub 监听 `.agents/skills`、`.claude/skills` 和 `skills-lock.json`，按 Hub/Project 做 750ms debounce。inventory 记录位置、`SKILL.md` 指纹、链接目标、managed metadata 和 Agent 可见性，并派生：

```text
aligned | agentsOnly | claudeOnly | contentMismatch | unknown
```

目录差异只作为非阻塞诊断，不自动复制或覆盖。Composer 按当前 Project 和 Agent 的 effective Skills 生成提示； supporting files 不参与递归一致性比较。

## Web 消费

Web 使用统一 HubStore 保存：

```text
hubs[hubId]
├─ instanceId
├─ config
└─ sections
```

HubConfig 仍通过独立配置 API 获取，但可以与运行态一起组织在 HubStore。UsageStore 可以继续聚合跨 Hub Limits，只作为 `tokenStats` 的派生投影，不拥有独立 HubState 获取时序。

UI 只在明确的 open/expand 边沿触发 refresh；render、子区切换、Composer Slash Menu 和 Monitor 打开不隐式刷新。除 Usage Service 的业务周期外，前端不通过轮询保持 Section 新鲜度。
