> 由 scope skill 于 2026-07-26 生成

# Session Goal

## 目标

WheelMaker 增加通用、可选的 Session Goal 能力：用户用 `/goal <objective>` 创建一个持续目标，支持该能力的 Agent 在同一个 Session 内自动连续执行 Turn，直到目标完成、暂停、阻塞、用量受限、预算耗尽或被清除。Codex App Server 是首个 provider。

Goal 是 Session 控制面，不是普通 Prompt 循环，也不是 Codex 私有 UI。Registry、Session 状态、恢复语义和控制台保持 provider-neutral；Codex adapter 只负责把通用操作映射到原生 `thread/goal/*`。

## 决策

- Goal 是 Agent 声明的可选 Session 能力。Unsupported Agent 隐藏 `/goal` 和 Goal 控制台；服务端仍拒绝手工构造的 Goal 请求。
- `/goal` 只负责创建，格式为 `/goal <objective>`；objective 去除首尾空白后必须为 1–4000 字符。
- `/goal` 使用现有 App prompt queue，不增加特殊队列类型。它与普通消息一样排队，只在成为队首并实际调用 `session.send` 时由 Hub 识别。
- Hub 保存原始 `/goal ...` 为可见的 `prompt_request`，但不把这段命令发给模型；随后调用 provider 的 Goal API。首个原生 Goal Turn 由 Agent 以隐藏 continuation 自动启动。
- 新建 Goal 的 token budget 默认无限制，以 `null` 表示。用户可以在创建后编辑 objective 和 budget。
- 同一 Session 最多有一个未完成 Goal。`active`、`paused`、`blocked`、`usageLimited`、`budgetLimited` 都必须先 Clear 才能新建；`complete` 可以直接被新 Goal 替换。
- Goal status 使用 provider-neutral 字符串：`active`、`paused`、`blocked`、`usageLimited`、`budgetLimited`、`complete`。
- Goal 为 `active` 时持续拥有 Session。普通消息继续进入现有 App prompt queue；用户显式点击 Steer 时，消息注入当前 Goal Turn。
- 首个 Goal Turn 只显示原始 `/goal ...` 用户消息；之后每个自动 continuation 前插入轻量 `Goal continued` system divider，不制造虚假用户消息。
- Pause 使用原生语义：当前物理 Turn 继续，完成后不再启动下一 Turn；Session 在该 Turn 真正结束前仍保持 running。
- Stop 等于 Pause 后 Interrupt 当前 Turn。当前 Turn 结束后释放 Session。
- Resume 立即生效。若此时普通 Prompt 正在运行，Codex 会把该 Turn 从点击时刻起纳入 Goal；WheelMaker 同步把执行所有权从 prompt 升级为 goal，Turn 结束后继续自动运行。
- 编辑 objective 立即生效；Codex 在 active Turn 中以原生隐藏 Steer 注入，不显示用户消息。编辑 budget 也立即生效。
- Clear 需要二次确认。Provider 立即删除 Goal，但当前物理 Turn 不被中断；Turn 完成后不再 continuation，Session 才释放。
- `paused`、`blocked`、`usageLimited`、`budgetLimited` 可编辑并 Resume；`complete` 保留统计，只允许 Clear 或创建新 Goal，不显示 Resume。
- Goal 控制台显示 objective、status、tokens used / budget、elapsed time，并提供编辑 objective/budget、Pause/Resume、Clear。
- PC 控制台位于聊天左侧浮窗栈，排在 Plan 上方；移动端位于输入框上方，也排在 Plan 上方。
- 重新打开 Session、Hub 重启或 Codex App Server 重连后，持久化的 `active` Goal 自动恢复并继续；暂停和终态只恢复状态与控制台，不启动 Agent。
- 普通 Fork 不继承 Goal，与 Codex 原生行为一致。
- Registry protocol version 保持 `2.6`，本功能是兼容性扩展。

## 架构

```text
/goal queued prompt
  -> existing session.send
    -> Session recognizes Goal command
      -> records raw prompt_request
      -> optional Agent SessionGoalController
        -> Codex App Server thread/goal/set

thread/goal/updated + Goal-owned turn notifications
  -> Codex adapter
    -> provider-neutral Goal snapshot / turn lifecycle
      -> Session ownership + persistence
        -> session.updated + transcript turns
          -> Goal console / normal chat rendering
```

普通 Prompt 生命周期由一次 `session/prompt` request/result 包围；Goal 生命周期可以跨越多个原生 Turn。Session 因此必须把“物理 Turn 是否仍运行”和“Goal 是否允许继续”分开管理，不能在每个 Codex `turn/completed` 后短暂发布 idle。

### Capability

Agent factory 的 Session action support 增加 `Goal`。Session summary 使用现有通用 action 形状：

```json
{
  "sessionActions": {
    "goal": {
      "supported": true
    }
  }
}
```

`supported` 是 provider 能力；当前 Goal snapshot 单独出现在 summary 的 `goal` 字段。Web 只在 capability supported 时展示 `/goal` 和控制台。

### Goal snapshot

Registry 和持久化状态使用同一个 provider-neutral snapshot：

```json
{
  "sessionId": "stable-session-id",
  "objective": "Finish the migration",
  "status": "active",
  "tokenBudget": null,
  "tokensUsed": 18340,
  "timeUsedSeconds": 912,
  "createdAt": 1785052800,
  "updatedAt": 1785053712
}
```

- 对 Web 暴露稳定 Session ID，不暴露 Codex runtime thread ID。
- `tokenBudget: null` 表示无限制；`tokensUsed` 和 `timeUsedSeconds` 是 provider 累计值。
- Goal snapshot 持久化在 `SessionAgentState`，并复制到 Session summary；每次 provider Goal update 都保存并发布现有 `session.updated`。
- Fork 创建的新 Session 不复制 snapshot。

### Registry contract

新增 project-scoped Registry 2.6 methods：

#### `session.goal.create`

```json
{
  "sessionId": "stable-session-id",
  "objective": "Finish the migration",
  "tokenBudget": null
}
```

成功返回：

```json
{
  "ok": true,
  "sessionId": "stable-session-id",
  "goal": {
    "objective": "Finish the migration",
    "status": "active"
  }
}
```

`objective` 必填；`tokenBudget` 可省略或为 `null`，两者都表示新 Goal 无限制。存在未完成 Goal 时返回 conflict；已有 `complete` Goal 时允许替换。

#### `session.goal.get`

```json
{"sessionId":"stable-session-id"}
```

返回 `goal: null` 或最新 snapshot，用于 reconnect 后主动校准。

#### `session.goal.update`

```json
{
  "sessionId": "stable-session-id",
  "objective": "Finish migration and tests",
  "tokenBudget": 120000,
  "status": "active"
}
```

`objective`、`tokenBudget`、`status` 都是 patch：

- 省略字段表示不修改；
- `tokenBudget: null` 表示清除预算；
- Web 只能把 status 写为 `active` 或 `paused`；
- `blocked`、`usageLimited`、`budgetLimited`、`complete` 只由 provider 报告。

请求至少包含一个 patch 字段。

#### `session.goal.stop`

```json
{"sessionId":"stable-session-id"}
```

服务端先把 Goal 更新为 `paused`，再调用当前 Session 的 cancel/interrupt。成功响应返回最新 Goal snapshot。若没有活动物理 Turn，仍完成 Pause。

#### `session.goal.clear`

```json
{"sessionId":"stable-session-id"}
```

服务端调用 provider clear，并返回 `cleared: true`。二次确认属于 Web 交互，服务端操作本身保持幂等。

### `/goal` command

`session.send` 只在以下条件全部满足时识别 Goal：

- 请求只有一个 text block；
- 没有图片、附件、resource link 或 Skill capsule；
- trim 后匹配精确的 `/goal` 命令名并带非空 objective；
- 当前 Agent 声明支持 Goal。

大小写不做别名扩展，命令名固定为小写 `/goal`。Hub 保存用户发送的原始 text block，然后走 `session.goal.create` 的同一业务路径；命令内容不进入 provider prompt。

不满足识别条件的 `/goal` 文本按普通 Prompt 发送，唯独精确 `/goal` 或空白 objective 返回明确校验错误，避免误把不完整控制命令发给模型。

### Session execution ownership

Session 的互斥执行态增加 `goal`：

- `prompt`：一次普通 Prompt；
- `compact` 等现有 operation；
- `goal`：一个跨多个物理 Turn 的 Goal execution。

创建 active Goal 时，Session 原子取得 `goal` 所有权并保持 recorder prompt 开放。原生 Goal Turn 完成但 status 仍为 `active` 时不写 `prompt_done`、不释放 execution，也不发布 idle。

当 status 变为 `paused` 或终态时：

- 没有物理 Turn：立即写 `prompt_done` 并释放；
- 仍有物理 Turn：记录“结束后释放”，等待 `goal_turn_completed`；
- `clear` 使用同一延迟释放规则。

Resume 普通 Prompt 时，Session 把 `executionKind` 从 `prompt` 原子升级为 `goal`。普通 Prompt 的 provider result 只结束物理 Turn，不写外层 `prompt_done`；Goal 继续持有 recorder lifecycle。这个升级必须先于向 Web 发布 active snapshot，避免前端误判 idle 并 drain queue。

Steer 不获取 Goal execution lock。只要 adapter 报告 Goal 当前有可 Steer active turn，现有 `session.steer` side-channel 直接复用。

### Provider-neutral Agent interface

Agent 层增加可选 `SessionGoalController`：

```go
type SessionGoalController interface {
    SessionGoalSet(context.Context, SessionGoalSetParams) (SessionGoal, error)
    SessionGoalGet(context.Context, string) (*SessionGoal, error)
    SessionGoalClear(context.Context, string) error
}
```

Instance 对缺少接口的 Agent 返回统一 `ErrSessionActionUnsupported`。Session 负责 objective/budget 校验、replace 规则、执行所有权、持久化和 transcript；adapter 负责 provider ID 映射与原生事件转换。

### Codex mapping

Codex adapter 使用 App Server：

- `thread/goal/set`
- `thread/goal/get`
- `thread/goal/clear`
- `thread/goal/updated`
- `thread/goal/cleared`

`thread/goal/set` 的 objective、status、tokenBudget 都保留 omitted 与 null 的区别；Codex status 原样映射到通用枚举。原生时间戳和累计统计进入 snapshot。

Adapter 为每个绑定 Session 维护 Goal 状态和当前 Goal Turn：

- active Goal 下的 `turn/started` 设置 `activeTurnID`，允许现有 `turn/steer`；
- 第二个及之后的自动 Turn 发出 `goal_continued`；
- `turn/completed` 发出 `goal_turn_completed`，但只有 Goal 状态/clear 决定是否结束外层 execution；
- 普通 Prompt 运行中 Resume 时，当前 `promptDone` 仍可完成一次原生 `session/prompt` 调用，但 Session 会把外层 ownership 保留为 Goal；
- Objective 更新中的原生隐藏 Steer 不生成 `user_message_chunk`。

`thread/resume` 可能立即恢复 active Goal 并发出通知。Codex load 路径必须在调用 resume 前建立 stable Session ID 到 runtime thread ID 的映射及 Goal event sink，避免启动通知丢失。

### Persistence and restore

- 每次 Goal update/clear 都先更新 `SessionAgentState` 并持久化，再发布 summary。
- Session reopen 从 `AgentJSON` 恢复 snapshot；`session.goal.get` 与 provider 校准后以 provider 为权威。
- Hub 启动时扫描当前 Project 的 Session records。只有 capability supported 且 snapshot status 为 `active` 的 Session 会被主动 materialize，调用 provider load/resume，并重新取得 Goal execution ownership。
- 其他 Session 保持现有懒加载；paused/terminal Goal 不启动 subprocess。
- Codex App Server 断开重连后，adapter 重新绑定 thread，调用 get 校准；active Goal 继续，暂停和终态保持停止。
- 恢复过程中不追加新的 `/goal` user bubble；首个恢复 Turn 视为 continuation，显示 `Goal continued` divider。

### Transcript

一个 Goal execution 使用一个外层 recorder prompt：

```text
prompt_request("/goal Finish the migration")
agent / thought / tool turns from native Goal turn 1
system("Goal continued")
agent / thought / tool turns from native Goal turn 2
...
prompt_done
```

Resume 已存在 Goal时不创建用户消息。恢复、编辑 objective/budget、Pause、Resume、Clear 都是控制面事件，不进入聊天正文。只有自动 continuation divider 进入 transcript，并使用现有 system message 表达。

## UI

### Slash command

- `/goal` 仅在当前 Session capability supported 时出现在 slash menu。
- 选择后在输入框插入普通文本 `/goal `，不创建 Skill capsule，不立即请求服务端。
- 用户发送后走普通 queue；运行中默认排队，Next/Cancel/Steer 语义不变。
- objective 缺失时在发送前或服务端返回现有 inline error，不创建 Goal。

### Goal console

PC 使用左侧 `chat-edge-surface-stack`，顺序为 Recent Sessions、Goal、Plan、Limits；Goal 卡片与 Plan 共用 edge surface 的间距、折叠和 glass 视觉。移动端顺序为 Goal、Plan、composer。

控制台内容：

- 可换行 objective；
- status label；
- `tokensUsed / tokenBudget`，无限制显示 `Unlimited`；
- elapsed duration；
- edit、Pause/Resume、Clear 操作。

状态行为：

- `active`：显示 Pause；
- `paused`、`blocked`、`usageLimited`、`budgetLimited`：显示 Resume；
- `complete`：不显示 Resume；
- 所有状态都允许 edit 和 Clear；
- Clear 打开明确写出“当前 Turn 不会被中断”的二次确认；
- Stop 复用聊天输入区当前 Stop 入口；active Goal 时调用 `session.goal.stop`，否则仍调用现有 `session.cancel`。

Edit 使用一个小型表单同时修改 objective 与 budget。空 budget 表示无限制；objective 继续使用 1–4000 字符校验；保存时只发送发生变化的 patch。

## 流程

### 创建与连续执行

1. 用户选择 `/goal`，输入 objective 并发送；若 Session busy，消息进入普通 queue。
2. 队首调用 `session.send`；Hub 识别命令并记录原始 `prompt_request`。
3. Session 校验 capability 和现有 Goal，取得 `goal` ownership，调用 Agent set(active)。
4. Codex 启动原生 Goal Turn；adapter 流式转发 agent/thought/tool updates。
5. Turn 完成且 Goal 仍 active；Session 不结束 prompt。下一 Turn 启动时记录 `Goal continued`。
6. Codex 报告 complete 或其他终态；最后物理 Turn 完成后 Session 写 `prompt_done` 并释放，App 才 drain 下一条 queued prompt。

### Pause、Stop 与 Clear

1. Pause 更新 provider status 为 paused。
2. 若 Turn 正在运行，控制台立即显示 paused，但 Session 保持 running；Turn 完成后释放。
3. Stop 在 Pause 后 interrupt Turn，随后按同一完成边界释放。
4. Clear 经 Web 二次确认后删除 Goal；若 Turn 正在运行，等待完成后释放并隐藏控制台。

### Resume 与普通 Prompt 升级

1. 用户对 paused/blocked/limited Goal 点击 Resume。
2. 若 Session idle，取得 goal ownership 后 set(active)，Codex 启动自动 Turn。
3. 若普通 Prompt 正在运行，Session 先把 ownership 升级为 goal，再 set(active)。
4. 当前普通 Turn 的 result 不结束 recorder prompt；Codex 后续 continuation 继续流式进入同一个 Goal execution。

### Restore

1. Hub 启动扫描出持久化 active Goal，materialize 对应 Session。
2. Adapter 在 `thread/resume` 前完成通知绑定，然后 get Goal 校准。
3. active Goal 自动继续；恢复后的第一个 Turn记录 `Goal continued`。
4. paused/terminal Goal 只在 summary 中恢复控制台，不启动 Agent。

## 验收标准

- 只有支持 Goal 的 Session 显示 `/goal` 和 Goal 控制台；Codex 声明支持，其他 Agent 默认隐藏并由服务端拒绝。
- 选择 `/goal` 只插入 `/goal ` 文本，不创建 capsule 或立即请求；发送时使用现有 prompt queue。
- `/goal <objective>` 成为队首后只记录一次原始用户 bubble，命令正文不发送给模型。
- objective 校验为 1–4000 字符；默认 budget 为 unlimited/null；未完成 Goal 阻止新建，complete Goal 可直接替换。
- active Goal 跨原生 Turn 持续占有 Session，不在 continuation 间发布 idle，也不提前 drain queued prompt。
- 第二个及之后的自动 Turn前各有一个 `Goal continued` system divider，没有伪用户消息。
- 普通 queued message 默认等待；对当前 Goal Turn 点击 Steer 能通过现有 `session.steer` 成功注入。
- Pause 不打断当前 Turn，Turn 完成后停止并释放；Stop 等于 Pause + Interrupt；Clear 经确认后删除且不打断当前 Turn。
- Resume idle Session 立即启动；Resume 普通运行 Turn 原子升级 execution ownership，并在该 Turn 后自动继续。
- Objective/budget 编辑立即生效；Objective 的原生隐藏 Steer 不显示用户消息。
- status、token usage/budget、elapsed 和控制动作在 PC/mobile 控制台正确显示；PC 和 mobile 都位于 Plan 上方。
- active Goal 在 Session reopen、Hub restart 和 Codex reconnect 后自动恢复；paused/terminal 只恢复控制台。
- 普通 Fork 不继承 Goal。
- Registry method、Session summary、持久化和 Web 类型都保持 provider-neutral，Codex runtime IDs 不泄漏。
- Registry protocol version 仍为 `2.6`。

### 测试

- Go protocol/Registry 测试覆盖 capability、五个 method descriptors、project scope、patch omitted/null、response 和 version 不变。
- Agent interface 测试覆盖 supported/unsupported、Codex set/get/clear 参数与所有 status 映射。
- Codex adapter 测试覆盖 updated/cleared、active auto Turn、普通 Prompt中 Resume、objective hidden Steer、不依赖 `promptDone` 的 Steer、load 前绑定、reconnect 和跨 Thread 隔离。
- Session 测试覆盖命令识别与 raw bubble、重复创建、complete replacement、连续 Turn ownership、terminal 延迟释放、Pause、Stop、Clear、Resume upgrade、普通队列阻塞和 Steer。
- Recorder/store 测试覆盖 snapshot 持久化、summary、continuation divider、prompt_done 边界、Hub restart active restore、paused/terminal lazy restore 和 Fork 不继承。
- Web 测试覆盖 slash visibility/insert、普通 queue、console 状态与顺序、edit patch、Pause/Resume、Clear confirmation、Goal Stop、mobile/desktop placement 和 reconnect snapshot。
- 完成前运行相关 Jest、Web TypeScript 检查、Web production build、相关 Go package tests 和完整 `go test ./...`。

## 范围之外

- 为 Claude、Copilot、OpenCode、Kimi、Mimo、CodeBuddy、Flicker 等其他 provider 实现 Goal adapter。
- 对 unsupported Agent 用重复 Prompt、特殊 system prompt 或 cancel/re-prompt 模拟 Goal。
- 把普通 App prompt queue 迁移到 Hub 或在刷新/重启后恢复未执行 queued prompts。
- 改变 Codex 普通 Fork 行为或提供“Fork 并继承 Goal”入口。
- 在聊天正文记录每次 Pause、Resume、edit、Clear 的审计消息。
- 修改 Registry protocol version。
