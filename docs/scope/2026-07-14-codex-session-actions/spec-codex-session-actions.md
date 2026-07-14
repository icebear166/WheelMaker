> 由 scope skill 于 2026-07-14 生成

# Codex Session Status and Context Compaction Actions

## 目标

WheelMaker 已经通过 Codex App Server 接收 `thread/tokenUsage/updated`，将当前上下文用量持久化到 session summary，并在聊天输入区显示用量圆环；但当前斜杠菜单只展示项目 Skills，已保存的 agent commands 没有进入菜单，也没有调用 Codex 原生状态查询或上下文压缩的控制链路。本次为 Workspace 增加 `/status` 和 `/compact` 两个会话动作：保持 Registry、Client/Session 和前端为 provider-neutral，通过 Agent 可选能力由 Codex adapter 映射到原生 App Server；其他 Agent 暂不实现，但使用同一能力与接口边界。

## 决策

- `/status` 与 `/compact` 是立即调用后台的会话动作，不作为 prompt 发送给模型；从菜单选择时立即触发，手动输入完整且独立的命令后回车也触发。
- 带附加参数或附件的 `/status`、`/compact` 不执行，并向用户说明命令只能独立使用。
- 斜杠菜单保持单一列表，不增加 Commands/Skills 分组标题或 `CMD`、`SKILL` 标签。每行统一为左侧图标、名称和灰色描述：`/compact` 使用参考 Codex 的环形压缩图标，`/status` 使用仪表盘图标，Skills 使用统一 Skill 图标。
- `/compact`、`/status` 固定排在 Skills 前面；搜索和键盘导航覆盖整个列表。动作是否立即调用或插入输入框由显式 `kind`/`behavior` 决定，不从名称推断。
- 所有 Agent 都显示两个动作。当前 session 未声明对应能力时，动作置灰并显示原因；手动输入未支持的动作只提示，不发送给模型。
- WheelMaker 不向标准 ACP 增加 Codex 私有方法，也不让前端按 `agentType` 分支。Session summary 暴露通用 `sessionActions` 能力；Agent 层用可选接口承载状态读取和上下文压缩，Codex adapter 首先实现，其他 provider 后续可独立接入。
- `/status` 弹层立即打开，先显示稳定的 WheelMaker/ACP Session ID 和前端已有的缓存上下文用量，同时后台刷新实时账户限额。不得暴露 Codex adapter 内部的 runtime thread ID。
- 状态响应以 Session ID 和限额为基本内容；上下文容量、限额窗口、重置时间、计划类型、credits、individual limit、限额触发原因等字段按 provider 实际返回情况渐进展示，不为缺失字段制造占位数据。
- 状态刷新失败不关闭弹层，也不清除缓存；限额区域显示不可用原因和上次成功更新时间。`/status` 不进入操作队列，也不写入聊天历史。
- `/compact` 在 session 空闲时立即调用；当前 prompt 或其他队列项仍在执行时，作为 `compact` 项加入现有前端内存队列，并与 queued prompts 严格按加入顺序执行。
- 同一 session 最多保留一个等待中的 compact；重复触发聚合到已有项，不产生连续重复压缩。
- 前端队列扩展为 `prompt | compact` 联合类型，继续只存在于当前 App 客户端内存。页面刷新、App/Workspace 重启后内存自然清空；Registry 连接断开时前端也立即清空未执行项，因此 Hub 重启后不恢复旧队列。不提供跨客户端全局排序保证。
- 后台仍必须拒绝并发压缩或压缩与 prompt 重叠。若动作出队时 session 又变为 busy，`session.compact` 返回 busy，前端保留队首项并在 session 再次空闲后重试，而不是绕过队列或取消当前 prompt。
- 压缩进度写入 session history，但不生成用户消息。开始、完成或失败事件共享 `operationId`；前端把追加式事件投影为一条系统记录，显示“正在压缩上下文”并原位更新为完成或失败状态。
- Codex 压缩完成后继续通过现有 `usage_update` 链路刷新 context usage；本功能不自行猜测压缩后的 token 数。

## 架构

Registry 新增 `session.status` 和 `session.compact` 两个 project-scoped session 方法。现有 `session.list`、`session.read`、`session.create` 和 `session.updated` 返回的 session summary 增加 `sessionActions`，其每个动作包含 `supported` 与可选 `reason`。能力由后台 provider/instance 可选接口产生，前端只读取能力，不识别 Codex 名称。

```text
Workspace unified slash menu
  -> Registry session.status / session.compact
    -> client.Session provider-neutral orchestration
      -> optional Agent capability
        -> Codex App Server account/rateLimits/read
        -> Codex App Server thread/compact/start

Codex contextCompaction + turn/item notifications
  -> provider-neutral session operation events
    -> SessionRecorder / session.message
      -> one folded operation row in Workspace
```

### Session capabilities

Session summary 使用以下通用形状；draft session 或未实现的 provider 返回 `supported: false`，并提供可直接展示的简短原因。

```json
{
  "sessionActions": {
    "status": { "supported": true },
    "compact": { "supported": true }
  }
}
```

Agent 层新增与现有 `SessionArchiver` 相同风格的可选接口，例如 `SessionStatusProvider`、`SessionCompactor`，由通用 instance wrapper 委托给实现该能力的 Conn。缺少接口时返回统一的 unsupported 错误；Codex 私有请求和响应类型只存在于 `codexapp` adapter。

### Status contract

`session.status` 请求为 `{ "sessionId": "..." }`。响应使用 provider-neutral、可缺省的结构，不转发 Codex 原始 JSON：

```json
{
  "ok": true,
  "sessionId": "stable-session-id",
  "context": {
    "used": 42000,
    "size": 258400,
    "updatedAt": "2026-07-14T10:00:00Z"
  },
  "limits": [
    {
      "id": "codex:primary",
      "name": "Primary",
      "usedPercent": 37,
      "remainingPercent": 63,
      "windowDurationMins": 10080,
      "resetsAt": "2026-07-20T00:00:00Z"
    }
  ],
  "account": {
    "planType": "plus",
    "credits": {
      "hasCredits": true,
      "unlimited": false,
      "balance": "42.00"
    },
    "individualLimit": {
      "limit": "1000",
      "used": "250",
      "remainingPercent": 75,
      "resetsAt": "2026-08-01T00:00:00Z"
    },
    "rateLimitReachedType": "primary",
    "rateLimitResetCredits": 10
  },
  "updatedAt": "2026-07-14T10:00:01Z"
}
```

Codex adapter 将 `rateLimits` 以及 `rateLimitsByLimitId` 中实际存在的 primary、secondary 周期窗口归一化为稳定的 `limits` 数组；百分比限定在 0–100，`remainingPercent` 由归一化后的 `usedPercent` 计算。individual limit 保留在可选的 `account.individualLimit` 中，因为它包含字符串额度值而不是同一套周期窗口字段。credits、rate-limit reached type 和 reset credits 也只在 provider 返回时进入可选账户信息。所有 Unix reset timestamp 均在服务端转换为 UTC RFC 3339。

状态查询可以复用运行中的 instance；休眠 session 只启动并初始化 Codex App Server 以查询账户限额，不执行 `session/load`、不回放历史、不创建 turn。为此 Session 的初始化与 session ready/load 阶段需要拆开复用。

### Compact contract and progress

`session.compact` 请求为 `{ "sessionId": "..." }`。后台确认 session 空闲、能力可用并注册 operation tracker 后，调用 Codex `thread/compact/start`，立即响应：

```json
{
  "ok": true,
  "accepted": true,
  "sessionId": "stable-session-id",
  "operationId": "operation-id"
}
```

Codex adapter 在发起请求前注册 tracker，避免快速通知先于状态登记。它把同一 thread 上的 `contextCompaction` item started/completed、`turn/completed`、进程退出和超时归并为唯一终态，不复用 prompt 的 `promptDone` 状态。Session 在终态前保持该会话的执行互斥，防止另一客户端同时启动 prompt。

SessionRecorder 追加 `operation_started` 和 `operation_completed` 或 `operation_failed` turn payload；三者包含同一 `operationId`、`type: "compact"`、状态、时间以及可选失败信息。`session.message` 继续作为唯一 App 会话事件通道，前端按 `operationId` 折叠显示，不增加另一条实时事件总线。

## 流程

### 状态

1. 用户选择 `/status`，或发送独立的 `/status` 文本。
2. Workspace 立即打开弹层，从 selected session 展示稳定 Session ID 和缓存 context usage。
3. Workspace 调用 `session.status`；后台检查通用能力并初始化 provider status reader，但不 load thread。
4. Codex adapter 调用 `account/rateLimits/read`，归一化可用窗口和账户字段。
5. Workspace 用响应更新弹层；失败时保留缓存并显示限额不可用状态。

### 压缩

1. 用户选择 `/compact`，或发送独立的 `/compact` 文本。
2. 若 session 或前端队列正在运行，Workspace 按当前位置加入一个 compact 项；若已有等待中的 compact，则聚合到已有项。
3. compact 到达队首且 session 空闲后，Workspace 调用 `session.compact`。若后台返回 busy，该项保持队首，等待下一次空闲信号后重试。
4. 后台记录 started 事件并调用 Codex `thread/compact/start`；Workspace 收到 `operationId` 后展示运行状态。
5. Codex 的 compaction item/turn 通知驱动 completed 或 failed 事件，SessionRecorder 持久化并通过 `session.message` 发布。
6. Workspace 将同一 operation 的事件折叠为一条系统记录，然后继续执行下一条前端队列项。
7. 后续 `usage_update` 到达时，现有 context usage 圆环和 session summary 自动更新。
8. Registry 连接一旦断开，Workspace 清空所有尚未出队的 prompt/compact；重连后只从持久化 session history 恢复已开始的 operation 记录，不重建旧队列。

## 验收标准

- 统一斜杠菜单同时包含 `/compact`、`/status` 和 Skills；没有分组标题或类型标签，但三类项目具有约定图标、名称和描述。
- `/compact`、`/status` 位于 Skills 之前；搜索、鼠标和键盘导航在一个连续列表中工作。
- 选择动作会立即调用或排队，选择 Skill 仍只插入输入框；手动输入独立动作不会产生用户 prompt。
- Codex session 的两个动作可用；未实现能力的 Agent 仍显示动作但置灰，手动输入时给出 unsupported 提示。
- `/status` 弹层无需等待网络即可显示稳定 Session ID 和缓存 context；实时限额成功后就地更新，失败时保留缓存并显示错误与上次更新时间。
- 状态 UI 能展示 Codex 返回的多个限额窗口及重置时间，并正确处理缺失 plan、credits、secondary window 或 context size 的响应。
- `/status` 不 load thread、不回放历史、不创建 turn，也不进入聊天操作队列。
- 空闲 session 触发 `/compact` 后产生唯一 operation ID，并显示一条从运行到完成或失败的系统记录；刷新会话历史后仍只投影为一条记录。
- prompt 运行时触发 compact 会加入前端 FIFO；compact 前后的 queued prompts 严格按加入顺序执行。
- 重复触发不会创建多个等待中的 compact；前端刷新会清空队列，Registry 断连也会显式清空队列，App/Workspace 或 Hub 重启后尚未执行的队列项均不恢复。
- compact 出队后的 busy 竞态不会打断当前 prompt，也不会丢弃 compact；session 再次空闲后能够重试。
- Codex method unavailable、App Server 退出、compaction 失败或超时时都会产生明确失败终态，队列随后可以继续执行下一项。
- compact 完成后的 usage notification 继续更新现有 session summary 和输入区 context usage 圆环。

### 测试

- Go agent tests覆盖 Codex `account/rateLimits/read` 请求与归一化、`thread/compact/start` 请求、runtime thread ID 映射、快速通知、contextCompaction 完成、失败、超时和进程退出。
- Go client/protocol tests覆盖 session action capability、unsupported/busy 错误、status 不触发 session load、compact operation 互斥、operation 事件持久化和 `session.message` 发布。
- 扩展现有 SessionRecorder/turn tests，验证追加式 operation events 能在读回时保持 operation ID、顺序与唯一终态。
- 前端状态测试覆盖 `prompt | compact` FIFO、compact 去重、busy 重试、完成后 drain、刷新不恢复和 session 间隔离。
- 前端交互测试覆盖统一列表排序、图标、disabled reason、搜索、键盘导航、动作立即调用、Skill 插入和手动命令拦截。
- 前端状态弹层测试覆盖缓存首屏、实时合并、多窗口、可选字段、错误和更新时间；聊天渲染测试覆盖 operation events 折叠为单行。
- 运行相关 Go package tests、App Jest tests、TypeScript 检查、生产 Web 构建，并在 Codex 可用环境中做一次真实 status 与 compact 冒烟验证。

## 范围之外

- 不实现 Claude、Copilot、OpenCode、Mimo、CodeBuddy 或 Flicker 的状态与压缩 adapter。
- 不新增后台 queue worker、SQLite 队列表、队列 Registry 协议或跨客户端队列同步。
- 不恢复页面刷新、App/Workspace 重启或 Hub 重启前尚未执行的 queued prompts/compact。
- 不保证多个客户端同时操作同一 session 时的全局 FIFO；后台只保证单 session 执行互斥并拒绝 busy 竞态。
- 不增加自动压缩阈值、自动重试策略或定时状态刷新。
- 不制作完整账户用量统计页，不展示 Codex 内部 runtime thread ID，也不原样透传 provider 私有 payload。
