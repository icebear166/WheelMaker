# HubState 与 Registry 协议整理设计

日期：2026-06-05
状态：已实现（Registry Protocol 2.5 硬切）

## 目标

把 Registry 协议整理成稳定的领域命名，并引入 Hub 侧缓存的 `HubState`，用于承载设置页和维护页当前分散的 scan/query/action 模式。

最终效果：

- App 不再直接调用一批零散的 `cmd.*` scan/query 方法。
- Hub 级状态由 Hub 缓存，Registry 只负责鉴权、路由、转发和广播。
- Hub、Project、Session 的路由 ID 规则统一。
- 协议方法集中注册，调用侧使用常量，不再散落字符串。

## 背景

当前协议已经有几个问题叠在一起：

- `registry.message`、`session.message` 这类命名表达不清，容易混淆消息来源和业务领域。
- `cmd.npm`、`cmd.update`、`cmd.skills`、`cmd.token` 是 Hub 能力，但挂在 `cmd` 顶级域。
- 一些 Hub 级请求把 `hubId` 放在 payload 里，路由字段和业务参数混在一起。
- Settings 页面打开时会连续发起多组 Hub scan/query，并在 App 内维护很多局部 loading/error/operation 状态。
- `fs.index.status` 是 Hub 级状态，`fs.index.search` 是 Project 级查询，两者现在命名层级相同。
- Registry 当前还保留 `project.online/offline` 事件，后续应该改成统一的 Project 报告事件。

这次整理不是单纯改名，而是把协议按能力边界重新收口。

## 总体协议域

下一阶段协议保留这些顶级域：

| 顶级域 | 归属 | 用途 |
| --- | --- | --- |
| `connect.*` | 连接层 | 初始化、关闭、本地读连接证明 |
| `registry.*` | Registry | Registry 自己拥有的目录、广播、控制能力 |
| `hub.*` | Hub | Hub 报告、HubState、Hub 内部能力 |
| `project.*` | Project | 项目文件、Git、同步检查等 Project 级能力 |
| `session.*` | Session | 会话列表、读取、发送、归档、附件、配置 |
| `speech.*` | Registry speech | 语音输入流式通道 |
| `monitor.*` | Monitor | 监控面板能力 |
| `debug.*` | Debug | 调试日志上传等调试能力 |

旧的 `cmd.*` 不再作为 App 面向协议。2.5 版本已经硬切，不保留旧端兼容入口；App 流程统一改用 `hub.state.*`。

## Envelope 与路由 ID

共享 Envelope 增加顶层 `hubId`：

```json
{
  "requestId": 1,
  "type": "request",
  "method": "hub.state.get",
  "hubId": "local-hub",
  "payload": {}
}
```

ID 放置规则：

- `hubId`：Hub 级请求放在 envelope 顶层。
- `projectId`：Project 级请求放在 envelope 顶层。
- `sessionId`：Session 实例 ID 继续放在 payload 中。
- payload 不再承载路由用的 `hubId` 或 `projectId`。
- 返回数据如果需要自描述，可以继续包含 `hubId`、`projectId` 字段。

Registry 不提供跨 Hub batch 聚合。App 对多个 Hub 读取 HubState 时，按 Hub 分别发送 `hub.state.get`，通过各自 `requestId` 独立接收响应。

服务端协议描述符需要增加或强化：

- `RequiresHubID`
- `RequiresProjectID`
- `RequiresSessionID`
- `Route`
- `Roles`
- `LocalRead`

`RequiresHubID` 校验 envelope 顶层 `hubId`，不再解析 payload。`RequiresProjectID` 校验 envelope 顶层 `projectId`。`RequiresSessionID` 校验 payload 中的 `sessionId`。

## 协议集中注册

所有 Registry 协议方法继续以 `server/internal/protocol/registry_methods.go` 作为服务端单一注册表，并补齐描述符。

App 侧应增加对应的协议常量模块，例如：

```ts
export const RegistryMethods = {
  HubStateGet: 'hub.state.get',
  HubStateRefresh: 'hub.state.refresh',
  HubStateAction: 'hub.state.action',
} as const;
```

调用代码不再直接写字符串。测试可以允许 fixture 字符串，但业务调用应引用常量。

后续可以考虑生成 TS 常量，但第一步可以手写并用测试保证覆盖。

## 协议命名调整清单

### Connect

| 当前 | 目标 | 说明 |
| --- | --- | --- |
| `connect.init` | `connect.init` | 保留 |
| `connection.closing` | `connect.close` | 放回 connect 域 |
| `local_read.proof` | `connect.localRead.proof` | 本地读连接证明，不再单独顶级域 |

### Registry 与 Project 目录

| 当前 | 目标 | 说明 |
| --- | --- | --- |
| `project.list` | `registry.project.list` | App 主动读取 Registry 项目目录 |
| `project.online` | 删除 | 用 `registry.project.report` 统一表达 |
| `project.offline` | 删除 | Hub 断开时也发 `registry.project.report` |
| 无 | `registry.project.report` | Registry 广播单个 Project 的完整快照 |

`registry.project.report` 事件应包含 envelope 顶层 `projectId`，payload 中包含完整的面向 App 的 project。Project payload 可以自带 `projectId`、`hubId`，方便 App 合并。

### Hub 报告

| 当前 | 目标 | 说明 |
| --- | --- | --- |
| `registry.reportProjects` | `hub.report.projects` | Hub 向 Registry 报告全量 projects |
| `registry.updateProject` | `hub.report.project` | Hub 向 Registry 报告单个 project |

这两个是 Hub 到 Registry 的上行报告。它们应使用 envelope 顶层 `hubId`。payload 不再需要路由用 `hubId`。

### HubState

新增：

| 方法 | 说明 |
| --- | --- |
| `hub.state.get` | 读取 Hub 内缓存，不触发扫描 |
| `hub.state.refresh` | 刷新指定 section |
| `hub.state.action` | 对指定 section 执行动作 |
| `hub.state.updated` | HubState 变化事件 |

这些方法使用 envelope 顶层 `hubId`。

### Project 能力

| 当前 | 目标 | 说明 |
| --- | --- | --- |
| `project.syncCheck` | `project.sync.check` | Project 同步检查 |
| `fs.list` | `project.fs.list` | Project 文件能力 |
| `fs.info` | `project.fs.info` | Project 文件能力 |
| `fs.read` | `project.fs.read` | Project 文件能力 |
| `fs.search` | `project.fs.search` | Project 文件能力 |
| `fs.grep` | `project.fs.grep` | Project 文件能力 |
| `fs.index.search` | `project.fs.index.search` | Project 级文件索引搜索 |
| `git.refs` | `project.git.refs` | Project Git 能力 |
| `git.log` | `project.git.log` | Project Git 能力 |
| `git.commit.files` | `project.git.commit.files` | Project Git 能力 |
| `git.commit.fileDiff` | `project.git.commit.fileDiff` | Project Git 能力 |
| `git.status` | `project.git.status` | Project Git 能力 |
| `git.workingTree.fileDiff` | `project.git.workingTree.fileDiff` | Project Git 能力 |

`fs.index.status` 和 `fs.index.rebuild` 不再作为 Project/FS 协议暴露给 App，迁移到 HubState：

- `hub.state.refresh` section `fileIndex`
- `hub.state.action` section `fileIndex` action `rebuild`

### Session 能力

| 当前 | 目标 | 说明 |
| --- | --- | --- |
| `session.new` | `session.create` | 命名更直观 |
| `session.setConfig` | `session.config` | 配置更新 |
| `session.markRead` | `session.markRead` | 保留 camelCase |
| `registry.session.message` | `session.message` | 统一事件名 |
| `registry.session.updated` | `session.updated` | 统一事件名 |

Session 事件不再区分 `registry.session.*` 和 `session.*` 两套名字。Hub 向 Registry 上传和 Registry 向 App 广播都使用同一个业务事件名，Registry 通过角色和 route 判断来源。

保留：

- `session.list`
- `session.read`
- `session.search`
- `session.send`
- `session.cancel`
- `session.delete`
- `session.rename`
- `session.reload`
- `session.resume.list`
- `session.resume.import`
- `session.archive`
- `session.archive.list`
- `session.archive.read`
- `session.archive.restore`
- `session.attachment.start`
- `session.attachment.chunk`
- `session.attachment.finish`
- `session.attachment.cancel`
- `session.attachment.delete`

`session.token.*` 不应继续作为 session 域扩展。当前 App 侧 token scan 迁入 HubState 的 `tokenStats` section。若后续还需要 provider 级或 DeepSeek 专项查询，应归入 `hub.state.action` 的 `tokenStats` section，或者另建 `hub.token.*`，不要放在 `session.*`。

### CMD

旧 `cmd.*` 的 App 面向能力迁移到 HubState：

| 当前 | 目标 |
| --- | --- |
| `cmd.npm` `scan` | `hub.state.refresh` section `agentPackages` |
| `cmd.npm` `install/install_many/uninstall` | `hub.state.action` section `agentPackages` |
| `cmd.update` `query` | `hub.state.refresh` section `wheelmakerUpdate` |
| `cmd.update` `update-publish` | `hub.state.action` section `wheelmakerUpdate` action `updatePublish` |
| `cmd.skills` `scan` | `hub.state.refresh` section `skills` |
| `cmd.skills` `list/install/uninstall/update` | `hub.state.action` section `skills` |
| `cmd.token` `scan` | `hub.state.refresh` section `tokenStats` |

2.5 已删除这些旧公开方法，不再保留兼容别名。Hub 内部仍可复用既有 command handler 作为实现细节，但它们不是 Registry public protocol。

### Relay

Relay 是 Registry 控制器状态，不进入 HubState。

| 当前 | 目标 | 说明 |
| --- | --- | --- |
| `relay.status` | `registry.relay.status` | Registry 自有状态 |
| `relay.enable` | `registry.relay.enable` | Registry 控制 |
| `relay.disable` | `registry.relay.disable` | Registry 控制 |
| `relay.regenerateAccessCode` | `registry.relay.regenerateAccessCode` | Registry 控制 |
| `relay.open` | `hub.relay.open` | Registry 发给 Hub 的内部请求 |
| `relay.close` | `hub.relay.close` | Registry 发给 Hub 的内部请求 |

### Speech、Monitor、Debug

这些本轮不进入 HubState。

- `speech.start/chunk/finish/cancel` 保留在 `speech.*`。
- `speech.transcript/error` 保留为 speech 事件。
- `monitor.*` 暂时保留。
- `debug.uploadLog` 暂时保留。

## HubState 模型

Hub 拥有一个内存 `HubState` 缓存。Registry 不缓存、不聚合、不持久化。

```ts
type HubStateStatus = 'empty' | 'ready' | 'refreshing' | 'partial' | 'error';

interface HubState {
  hubId: string;
  status: HubStateStatus;
  updatedAt?: string;
  sections: {
    agentPackages?: HubStateSection<NpmState>;
    wheelmakerUpdate?: HubStateSection<WheelMakerUpdateState>;
    skills?: HubStateSection<SkillsState>;
    tokenStats?: HubStateSection<TokenStatsState>;
    fileIndex?: HubStateSection<FileIndexState>;
  };
}
```

顶层 `status` 从 section 状态汇总：

- `empty`：没有任何 section 有数据、刷新结果或 action 结果。
- `refreshing`：至少一个 section 正在刷新，或至少一个 section 有运行中的 action。
- `ready`：所有已加载 section 都是 ready，且没有运行中任务。
- `partial`：至少一个 section ready，同时至少一个 section empty 或 error。
- `error`：所有已加载 section 都是 error，且没有运行中任务。

顶层 `updatedAt` 取最新的 section `updatedAt`。

## Section 模型

每个 section 都独立可读、可刷新、可执行 action。

```ts
type HubStateSectionStatus = 'empty' | 'ready' | 'refreshing' | 'error';

interface HubStateSection<T> {
  status: HubStateSectionStatus;
  updatedAt?: string;
  startedAt?: string;
  error?: string;
  data?: T;
  action?: HubStateActionSnapshot;
}

interface HubStateActionSnapshot {
  id: string;
  name: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}
```

规则：

- `hub.state.get` 只读缓存，不启动扫描。
- `hub.state.refresh` 刷新指定 sections。
- `hub.state.action` 对一个 section 执行受控操作。
- section 刷新中可以保留上一次成功的 `data`。
- refresh 失败时 section 进入 `error`，但可以保留旧 `data`。
- action 运行中时写入 `section.action`，并让 section 进入 `refreshing`。
- action 完成后保留快照，直到下一次 action 替换或 Hub 重启。
- `refresh` 和 `action` 都返回最新 HubState 或最新 section，不要求 App 立刻补一次 `get`。

## HubState 协议

### `hub.state.get`

读取 Hub 缓存，不触发扫描。

请求：

```json
{
  "method": "hub.state.get",
  "hubId": "local-hub",
  "payload": {
    "sections": ["agentPackages", "skills"]
  }
}
```

`sections` 为空或省略时返回所有已知 sections。

响应：

```json
{
  "state": {
    "hubId": "local-hub",
    "status": "ready",
    "updatedAt": "2026-06-05T10:00:00Z",
    "sections": {}
  }
}
```

### `hub.state.refresh`

刷新指定 sections。

请求：

```json
{
  "method": "hub.state.refresh",
  "hubId": "local-hub",
  "payload": {
    "sections": ["agentPackages", "wheelmakerUpdate", "fileIndex"],
    "force": true
  }
}
```

规则：

- `sections` 必填且非空。
- `force` 让 collector 绕过可用的 freshness check。
- section 已有运行中 refresh/action 时，不启动重复任务，返回当前 section 状态。
- 长任务可以先返回 `refreshing`，后台继续执行。
- 后台状态变化后 Hub 发 `hub.state.updated`。

### `hub.state.action`

对一个 section 执行动作。

请求：

```json
{
  "method": "hub.state.action",
  "hubId": "local-hub",
  "payload": {
    "section": "agentPackages",
    "action": "install",
    "params": {
      "packageName": "@openai/codex",
      "version": "latest"
    }
  }
}
```

规则：

- `section` 和 `action` 必填。
- Hub 按 section 校验 action 名称。
- Hub 按 action 校验 params。
- App 不能传 raw command、raw args、cwd 或 env。
- 长任务 accepted 后立即返回更新后的 state。
- action 完成后 Hub 刷新受影响 section，或标记错误。
- action 状态和 section data 变化时发 `hub.state.updated`。

### `hub.state.updated`

HubState 变化事件。

事件：

```json
{
  "method": "hub.state.updated",
  "hubId": "local-hub",
  "payload": {
    "state": {},
    "sections": ["agentPackages"],
    "reason": "action.completed"
  }
}
```

Registry 只转发给对应 scope 的 App client，不保存 payload。

## HubState 分区

### `agentPackages`

替代：

- `cmd.npm` `scan`
- `cmd.npm` `install`
- `cmd.npm` `install_many`
- `cmd.npm` `uninstall`

刷新：

```json
{
  "sections": ["agentPackages"]
}
```

动作：

- `install`
- `installMany`
- `uninstall`

保留现有 package allowlist 和 Hub 单操作并发限制。运行时包通过 `install` 安装或更新；废弃包通过 `uninstall` 移除。

### `wheelmakerUpdate`

替代：

- `cmd.update` `query`
- `cmd.update` `update-publish`

刷新等价于 update query。

动作：

- `updatePublish`

section data 保留现有 update response 信息：status、release、git snapshot、pending signal、remote refresh running、can update publish。

### `skills`

替代：

- `cmd.skills` `scan`
- `cmd.skills` `list`
- `cmd.skills` `install`
- `cmd.skills` `uninstall`
- `cmd.skills` `update`

刷新等价于 installed skills scan。

动作：

- `listSource`
- `install`
- `uninstall`
- `update`

`listSource` 是 read-like action，但仍属于 skills section 的受控动作。候选结果放在 `section.action.result` 中。

### `tokenStats`

替代：

- `cmd.token` `scan`

刷新等价于 token scan。

动作：

- `providers`
- `deepseekStats`

`providers` 返回当前支持的 token provider 列表；`deepseekStats` 使用 `apiKey`、`rangeType`、`month` 参数查询 DeepSeek 专项统计。两者都归入 `hub.state.action` 的 `tokenStats` section，不放回 `session.token.*`。

### `fileIndex`

替代：

- `fs.index.status`
- `fs.index.rebuild`

刷新返回 Hub 内所有项目的 file index status。

动作：

- `rebuild`

参数：

```json
{
  "projectId": "local-hub:WheelMaker"
}
```

`project.fs.index.search` 保持 Project 级搜索方法，不进入 HubState。

## Registry 路由行为

Registry 对 `hub.state.*`：

- 校验 client role。
- 校验 envelope 顶层 `hubId`。
- 校验 scoped client 不能访问 scope 外 Hub。
- 校验目标 Hub 已知且在线。
- 转发请求到目标 Hub。
- 把 Hub response 原样返回 App。
- 转发 Hub 发出的 `hub.state.updated`。
- 不缓存 HubState。
- 不聚合多 Hub 状态。
- 不轮询 Hub operation。

Hub 断开时，Registry 不提供旧 HubState。App 可以保留本地上次渲染值，但协议权威不在 Registry。

## Hub 侧架构

新增 `HubStateManager`，挂在 Hub `Reporter` 后面。

职责：

- 持有内存 HubState。
- 分发 section refresh。
- 分发 section action。
- 维护 section status、timestamps、error、action snapshot。
- 复用现有 command/manager 实现。
- 通过 Reporter publisher 发 `hub.state.updated`。

初始 adapter：

- `agentPackages` 复用 `tools.NPMCommand`。
- `wheelmakerUpdate` 复用 `tools.UpdateCommand`。
- `skills` 复用 `tools.SkillsCommand`。
- `tokenStats` 复用 `tools.TokenCommand`。
- `fileIndex` 复用 `projectFileIndexManager`。

第一版可以保留旧 command handler，通过相同底层对象提供兼容。关键是新的 App 设置页流程走 `HubStateManager`。

## App 数据流

打开 settings 页面：

1. App 调用 `registry.project.list` 获取 hubs/projects。
2. App 对可见 hubs 分别调用 `hub.state.get`。
3. App 直接渲染缓存 sections。
4. 空 section 显示 empty/stale 状态，并允许用户 refresh。

手动刷新：

1. App 调用 `hub.state.refresh`，传入 sections。
2. App 合并返回的 HubState。
3. 如果 section 仍在 `refreshing`，等待 `hub.state.updated`，必要时轮询 `hub.state.get`。

执行动作：

1. App 调用 `hub.state.action`，传入 section/action/params。
2. App 合并返回的 HubState。
3. App 渲染 `section.action`。
4. App 通过 `hub.state.updated` 接收 action 和 section data 的后续变化。

迁移后 App 不再为 NPM、update、skills、token stats、file index status 各自维护定制扫描轮询循环。

## 错误处理

- 缺少 `hubId`：`INVALID_ARGUMENT`。
- 未知 Hub：`NOT_FOUND`。
- Hub 离线：`UNAVAILABLE`。
- refresh 缺少 `sections`：`INVALID_ARGUMENT`。
- 未知 section：`INVALID_ARGUMENT`。
- 未知 section action：`INVALID_ARGUMENT`。
- action params 非法：`INVALID_ARGUMENT`。
- section 已有运行中操作：能表达为 state 时返回当前 section；不能接受新 action 时返回 `CONFLICT`。
- collector 失败：section `status:"error"`，写入短 `error`。
- action 失败：`section.action.status:"failed"`，写入短 `error`，保留旧 data。

App 不显示完整 stdout/stderr。

## 迁移计划

1. 协议常量与 descriptor：加入新命名、`hubId`、`RequiresSessionID`，补齐 route 分类。
2. Registry envelope：读写 `hubId`。
3. Registry routing：实现 `hub.state.*` 转发和 `hub.state.updated` 广播。
4. HubStateManager：先实现空 state、section 状态模型和 `get/refresh/action` 框架。
5. Section adapters：按 `agentPackages`、`wheelmakerUpdate`、`skills`、`tokenStats`、`fileIndex` 接入现有逻辑。
6. App 协议常量：新增 TS 常量，Repository 支持 `hub.state.*` 顶层 `hubId`。
7. App 设置页迁移：Update、Skills、Token Stats、File Index 状态依次迁移到 HubState。
8. 协议重命名迁移：`project.*`、`session.*`、`registry.*`、`connect.*` 已按上表重命名。
9. 清理旧公开方法：旧 `cmd.*`、`fs.index.status/rebuild` 等入口已从 public Registry protocol 删除。

## 测试策略

服务端协议测试：

- 所有新方法在 descriptor 中注册。
- `hub.state.*` 要求 envelope 顶层 `hubId`。
- client role 可调用 HubState 方法。
- Registry 按 envelope `hubId` 转发。
- Registry 拒绝缺失、未知、离线、越权 Hub。
- Registry 不缓存 HubState。
- 旧 `registry.session.*` 不再注册，Session 事件统一为 `session.*`。
- `project.online/offline` 迁移到 `registry.project.report` 后 App 可收到完整 project snapshot。

Hub 测试：

- `get` 只读缓存，不启动 collector。
- `refresh` 只刷新指定 sections。
- 顶层 status 从 section statuses 正确汇总。
- refresh 失败保留旧 data。
- action running 会让 section 和 HubState 进入 refreshing。
- 后台变化会发 `hub.state.updated`。
- `agentPackages` refresh/action 复用 NPM policy。
- `wheelmakerUpdate` refresh/action 复用 update policy。
- `skills` refresh/action 复用 skills policy。
- `tokenStats` refresh 复用 token scanner。
- `fileIndex` refresh/rebuild 复用 file index manager。
- `project.fs.index.search` 保持 Project 级搜索，不受 HubState 影响。

App 测试：

- Repository 使用协议常量，不直接写 method 字符串。
- HubState 请求发送顶层 `hubId`。
- Settings 页面打开先调用 `hub.state.get`。
- Refresh 按 section 调用 `hub.state.refresh`。
- NPM、Skills、Update、File Index 动作调用 `hub.state.action`。
- 返回 state 直接合并，不强制补 `get`。
- `hub.state.updated` 能更新可见 section。
- 旧 method 只允许出现在历史说明或测试中的 removed-name guardrail，不允许 App service 继续发送。

## 验收标准

- 协议顶级域清晰区分 `connect`、`registry`、`hub`、`project`、`session`。
- Hub 级请求使用 envelope 顶层 `hubId`。
- Project 级请求使用 envelope 顶层 `projectId`。
- Session 实例请求校验 payload `sessionId`。
- HubState 缓存在 Hub，不在 Registry。
- Registry 只路由 HubState 请求和事件。
- App 可通过 `hub.state.get` 读取缓存。
- App 可通过 `hub.state.refresh` 刷新指定 sections。
- App 可通过 `hub.state.action` 执行受控 section 动作。
- 每个 section 有独立 status、timestamps、data、error、action。
- 顶层 HubState 能表达 empty、refreshing、ready、partial、error。
- NPM scan 和 package operations 进入 HubState。
- Project 目录事件统一为 `registry.project.report`。
- Session 消息事件统一为 `session.message` 和 `session.updated`。
- 新代码调用协议常量，不再散落 method 字符串。
