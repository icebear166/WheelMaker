> 由 scope skill 于 2026-07-26 生成

# Session Steer

## 目标

WheelMaker 已允许用户在当前 Prompt 运行期间继续提交消息，并把这些消息保存在 App 内存队列中；现有队列只能取消消息或将消息移动到队首，仍需等待当前 Prompt 结束后才能发送。本次增加通用 Session Steer 能力：支持该能力的 Agent 可以在不取消、不打断当前 Turn 的情况下，把指定 queued prompt 插入正在运行的 Turn。

Steer 保持 Registry、Session、队列和 UI provider-neutral，通过 Agent 可选能力接入具体实现；Codex App Server 是首个 provider。Codex Goal 依赖持续向运行中 Turn 提供指令，但不属于本 scope，待 Steer 完成后单独设计。

## 决策

- Steer 是通用、可选的 Agent Session 能力，不是 Codex Goal 的私有功能，也不加入标准 ACP 私有分支。
- Codex 是首个实现；其他 Agent 未实现时不模拟 cancel + re-prompt，也不向模型发送伪 Steer 命令。
- 当前 Prompt 运行中提交消息时，默认行为仍是加入现有 App 内存队列，不自动 Steer。
- Queued prompt 的操作顺序为 `Steer`、`Next`、`Cancel`，全部使用 icon-only 按钮，并提供同名 tooltip 和可访问名称：
  - `Steer` 使用 `corner-down-left` 图标。
  - `Next` 使用 `arrow-up-to-line` 图标，语义是移动到队首，不立即打断或发送。
  - `Cancel` 继续使用 `x` 图标和 danger 视觉。
- 只有 Agent 声明支持 Steer，且当前 Session 正在执行可 Steer 的普通 Prompt 时，queued prompt 才显示 Steer；不支持、空闲、Compact、Review 或其他不可 Steer 状态只显示 Next 和 Cancel。
- Steer 支持与普通 `session.send` 完全相同的当前内容能力，复用同一内容准备与 Codex UserInput 转换链路，包括文本、图片、附件、resource link 和现有 `@file`/Skill capsule 序列化行为；不额外承诺尚未被普通 Send 使用的 Codex 原生 Skill/Mention 语义。
- 同一活动 Turn 可以连续 Steer 多条 queued prompt。单个 Session 的 Steer 请求按用户点击顺序串行提交，每条独立确认和移除。
- 点击 Steer 后，目标队列项进入 `steering` 状态并禁止重复操作；其他 queued prompt 仍可发起 Steer，按既有请求顺序等待。
- Codex 接受 Steer 后，该消息从队列移除，并在当前 Prompt 的内部 Session turn 序列中形成一条正常用户消息；UI 使用普通用户消息样式，并显示轻量 `Steered` 标记。
- Steer 消息只有在 Codex 确认接受后才进入持久化 Session turn。Codex RPC response 是控制面确认，带匹配 `clientId` 的 `userMessage item/started` 是 transcript 的顺序锚点。
- 如果点击后原 Turn 恰好结束，Session 服务端原子地接管该消息，将其作为优先下一 Prompt 发送；不要求 Web 再发第二个 `session.send` 请求。
- 对非队首 queued prompt 触发上述 fallback 时，该消息越过其他 queued prompt，成为下一条普通 Prompt；其他 queued prompt 的相对顺序不变。
- 多个已提交的 Steer 在目标 Prompt 结束后需要 fallback 时，按 Steer 点击顺序成为 Session 优先 handoff，不能被前端自动 drain 或另一客户端的普通发送插入中间。
- fallback 消息最终只记录为新的 `prompt_request`，不同时记录为 `Steered` 用户 turn。
- Provider 不支持、当前 Turn 类型不可 Steer、网络错误或其他真实失败不会丢弃消息；目标项退出 `steering` 并保留在原队列位置，展示现有错误反馈。
- Registry protocol version 保持 `2.6`，本功能只做兼容性扩展。

## 架构

Steer 复用现有 Compact 的能力声明、Session summary、Registry 路由和 Agent 可选接口骨架，但不复用 Compact 的排他执行模型。Compact 是占用 `executionKind` 的独立操作；Steer 是运行中 Prompt 的 side-channel，必须能在 Prompt 持有 `promptMu` 时并发进入。

```text
Queued prompt action
  -> Registry session.steer
    -> Session steer side-channel
      -> optional Agent SessionSteerer
        -> Codex App Server turn/steer

Codex userMessage item/started(clientId)
  -> ordered provider-neutral steer acceptance
    -> active Session prompt update stream
      -> SessionRecorder user_message_chunk turn
        -> session.message / normal user rendering + Steered marker

turn ended before acceptance
  -> Session priority prompt handoff
    -> existing normal prompt lifecycle
      -> prompt_request ... prompt_done
```

### Capability

Agent factory 的 Session action support 增加 `Steer`。Codex 注册为支持，其他 provider 默认不支持。Session summary 延续现有通用 action 形状：

```json
{
  "sessionActions": {
    "steer": {
      "supported": true
    }
  }
}
```

`supported` 表示 provider 能力，不代表此刻存在活动 Turn。Web 还必须结合当前 Session 的运行状态、当前执行类型和 queued item 类型判断是否显示 Steer；服务端始终重新校验，是最终权威。

Queued `compact` 等非 Prompt 项不显示 Steer。请求发出与执行状态变化之间允许存在竞态，不能依靠 UI 可见性保证服务端前置条件。

### Registry contract

新增 project-scoped `session.steer`：

```json
{
  "sessionId": "stable-session-id",
  "clientMessageId": "stable-queued-message-id",
  "blocks": [
    {
      "type": "text",
      "text": "Use the existing parser instead"
    }
  ]
}
```

`clientMessageId` 在同一 Session 内稳定标识用户提交，既用于请求去重，也映射为 Codex `clientUserMessageId` 和 transcript 关联键。附件仍通过与 `session.send` 相同的内容准备和发送确认链路处理。

成功响应使用 provider-neutral outcome：

```json
{
  "ok": true,
  "accepted": true,
  "sessionId": "stable-session-id",
  "clientMessageId": "stable-queued-message-id",
  "outcome": "steered"
}
```

或：

```json
{
  "ok": true,
  "accepted": true,
  "sessionId": "stable-session-id",
  "clientMessageId": "stable-queued-message-id",
  "outcome": "sent"
}
```

- `steered` 表示 Agent 已接受输入，且关联的 Steered 内部 turn 已进入有序 Session 更新流。
- `sent` 表示目标 Turn 已结束，Session 已原子接管消息并将其交给优先普通 Prompt handoff；不表示新 Prompt 已完成。
- provider runtime thread ID、Codex turn ID 和原始 Codex payload 不暴露给 Web。
- 重复提交已被接管的 `clientMessageId` 必须返回已有 outcome，不得生成第二条 Steer 或 Prompt。

Unsupported、不可 Steer Turn、无效内容和真实 provider 错误使用明确错误；Web 只有在未收到 accepted outcome、也未收到匹配的已接受 Session 消息时才保留队列项供重试。

### Session side-channel and atomic fallback

Session 新增独立的 Steer 串行器。针对仍活动的 Turn 调用 provider side-channel 时，它不调用 `beginExecution`，也不尝试获取当前 Prompt 全程持有的 `promptMu`；只有 Turn 已结束且消息需要 fallback 为新的普通 Prompt 时，Session 才在当前 Prompt 的 handoff 边界接管下一次 Prompt 执行。每次请求开始时记录当前 Prompt generation，读取 Agent instance 和稳定 Session ID，然后调用 Agent 可选 `SessionSteerer`。

Agent 层新增与 `SessionCompactor` 相同风格的可选接口。接口接收 Session ID、稳定 client message ID 和已准备的 content blocks，返回 provider-neutral acceptance 结果；缺少接口时返回统一 unsupported 错误。Provider 私有 ID、请求类型和错误分类只存在于 adapter。

Session fallback 只用于“请求所针对的普通 Turn 已结束、且输入未被该 Turn 接受”的竞态。以下情况不转换为普通 Prompt：

- provider/Agent 不支持 Steer；
- 当前活动 Turn 明确为 Review、Compact 或其他不可 Steer 类型；
- 内容转换失败；
- 网络、进程、协议或无法确认是否接受的错误。

为了避免当前 Prompt 完成和前端队列自动 drain 之间的空窗，Session 需要在释放本次 Prompt 的执行态、发布可 drain 的 idle 状态之前处理已接管的优先 handoff。多个 handoff 按 Steer 请求顺序执行；Web 一旦收到 `accepted: true`，即移除对应本地 queued prompt，因为消息所有权已经转移给 Session。

优先 handoff 只服务于已发起 Steer 的 race fallback，不把整个既有 App prompt queue 迁移到 Hub，也不改变普通队列的内存与刷新语义。

### Codex mapping

Codex adapter 调用 App Server `turn/steer`：

```json
{
  "threadId": "runtime-thread-id",
  "expectedTurnId": "active-turn-id",
  "clientUserMessageId": "stable-queued-message-id",
  "input": []
}
```

- `expectedTurnId` 从当前普通 Prompt 的 active turn tracker 获取；不使用 `lastTurnID` 猜测。
- `input` 复用普通 Prompt 的 `codexappPromptToInputWithArtifacts` 转换结果。
- Codex 成功 response 返回当前 `turnId`，只表示该活动 Turn 接受了 Steer，不表示整个 Turn 已完成。
- Adapter 在发送请求前注册 pending tracker，避免快速 `userMessage item/started` 先于请求状态登记。
- Codex `userMessage` item 带有 `clientId` 和完整 UserInput content。Adapter 只处理匹配 pending Steer 的 client ID；普通 `turn/start` 的 userMessage 继续忽略，避免回显原 Prompt。
- 匹配的 `userMessage item/started` 作为 provider 接受和 transcript 排序锚点。它必须在与 agent message、thought、tool call 相同的 per-thread 通知顺序中进入 Session prompt update stream。
- RPC response 与 item notification 允许任意先后：response 先到时请求保持 `steering`，直到匹配 item 到达；item 先到时按通知顺序提交内部 turn，response 随后完成控制请求。
- Codex `activeTurnNotSteerable` 的 Review/Compact 错误归类为 unavailable，不触发普通 Prompt fallback。
- 目标 active turn 已结束或 `expectedTurnId` 已失效且没有替代的可接受 Turn 时，返回可供 Session 执行原子 fallback 的 typed inactive outcome。

同一个 Codex runtime 可以继续处理其他 Thread 的通知。JSON-RPC response 按 request ID 匹配，通知按 thread ID 分流；同一 Thread 内的消息按通知队列顺序处理，Steer 不阻塞 streaming updates。

### Internal Session turn

当前 active `sessionPromptState` 已允许在 `prompt_request` 与 `prompt_done` 之间追加任意多个全局 turn。成功 Steer 形成独立 `user_message_chunk`：

```json
{
  "method": "user_message_chunk",
  "param": {
    "contentBlocks": [
      {
        "type": "text",
        "text": "Use the existing parser instead"
      }
    ],
    "clientMessageId": "stable-queued-message-id",
    "steered": true
  }
}
```

Recorder 必须把一个 Steer 的所有 content blocks 投影为同一个内部 turn，不得把文本、图片和附件拆成多个用户行。现有只含 `text` 的 legacy `user_message_chunk` 继续兼容读取；新 UI 优先读取 `contentBlocks`。

Steered turn 获得新的 Session 全局 `turnIndex`，结束前一个仍开放的 agent text/thought turn；后续 agent/tool 更新继续获得更大的 turn index。它不创建新的 `prompt_request`，不结束当前 Prompt，也不改变最后 `prompt_done` 的 fork point 归属。

`clientMessageId` 用于 recorder 与 Web 去重。RPC response 丢失、重试或 session.message 先于命令 response 到达时，同一 client message 仍只能产生一个内部 turn。

### Web queue and rendering

现有 App 内存队列继续是 queued prompt 的唯一来源。队列项增加 `steering` 提交状态，但不迁移到服务端持久化队列。

Steer 点击流程：

1. 将目标 queued prompt 标记为 `steering`，使用原 queue ID 作为 `clientMessageId`。
2. 调用 `session.steer`；同一 Session 的调用按点击顺序串行。
3. 收到 `outcome: steered`，或先收到匹配 `clientMessageId` 的 Steered session message 后，移除目标项。
4. 收到 `outcome: sent` 后移除目标项；Session 后续通过正常 `prompt_request` 展示 fallback。
5. 收到真实错误时清除 `steering`，保留该项及其原相对位置，并使用现有错误 UI。

Steered history row 与普通用户 Prompt 使用相同的内容、图片和附件渲染，仅在用户消息元信息位置显示弱化的 `Steered` 文本标记。该标记不参与消息正文复制和搜索文本。

## 流程

### 正常 Steer

1. 普通 Prompt 正在运行，用户提交另一条消息；App 默认把它加入 queued prompts。
2. 用户点击该项的 Steer；App 标记 `steering` 并调用 `session.steer`。
3. Session 校验能力和当前 Prompt generation，通过独立 side-channel 调用 `SessionSteerer`。
4. Codex adapter 注册 client ID tracker，将 blocks 转为 UserInput，并调用 `turn/steer`。
5. Codex 发出匹配 client ID 的 `userMessage item/started`；adapter 在原生通知顺序中发出 Steer acceptance。
6. SessionRecorder 追加一个带完整 content blocks 和 `steered: true` 的 `user_message_chunk` turn，并通过现有 session.message 发布。
7. Codex RPC response 确认请求；Session 返回 `outcome: steered`。App 移除 queued item，当前 Turn 继续执行。

### Turn 结束竞态

1. 用户点击 Steer 后，目标普通 Turn 在 Codex 接受输入前结束。
2. Adapter 返回 typed inactive outcome，不生成 Steered turn。
3. Session 在当前 Prompt 生命周期结束与队列 idle/drain 之间接管该消息，放入优先 handoff。
4. 原 Prompt 正常写入 `prompt_done` 后，Session 立即通过现有 Prompt 流程发送该消息。
5. Registry 返回或最终确认 `outcome: sent`；App 移除原 queued item。
6. 消息只以新 Prompt 的 `prompt_request` 出现在历史中，其他 queued prompt 保持原顺序并在其后继续 drain。

### 不可 Steer 或真实失败

1. 服务端发现 provider unsupported、活动 Turn 为 Review/Compact、内容无效或 provider 调用失败。
2. Session 不接管消息，不写 Steered turn，也不启动普通 Prompt。
3. `session.steer` 返回明确错误；App 清除 `steering` 并保留 queued item。
4. 用户可以稍后重试 Steer、选择 Next 或 Cancel。

## 验收标准

- 当前普通 Prompt 运行中提交的新消息仍默认排队，不自动 Steer。
- 支持且当前可用时，每条 queued prompt 按顺序显示 icon-only Steer、Next、Cancel，并具有正确 tooltip、ARIA label、图标和 Cancel danger 状态。
- Agent 不支持、Session 空闲、当前执行 Compact/Review 或队列项不是 Prompt 时不显示 Steer。
- Next 只把目标项移动到队首；Cancel 只移除目标项；二者都不停止当前 Prompt。
- Steer 可以发送普通 Send 当前支持的文本、图片、附件、resource link、`@file` 和 Skill capsule 内容，不建立另一套内容转换。
- 同一活动 Turn 可以按点击顺序接受多条 Steer；每条只产生一个 Codex 请求和一个内部用户 turn。
- Prompt 运行期间 `session.steer` 不因 `promptMu` 或 `executionKind=prompt` 返回 busy，也不释放、取消或替换当前 Prompt。
- Codex 请求携带正确 thread ID、当前 active `expectedTurnId`、稳定 `clientUserMessageId` 和转换后的 UserInput。
- 只有匹配 pending client ID 的 Codex userMessage item 才生成 Steered history；普通 Prompt userMessage 不回显。
- RPC response 与 userMessage item 任意先后时，queued item、内部 turn 和成功结果均保持一致且不重复。
- Steered user message 与同一 Prompt 内继续到达的 agent/thought/tool turns 使用正确全局 turnIndex 顺序；其他内部 turn 可以在 Steer 期间继续接收。
- Steered history 持久化完整 content blocks、client message ID 和标记；刷新后图片、附件和文本仍按一个用户 turn 渲染，并显示轻量 Steered 标记。
- 目标 Turn 在点击后结束时，消息由 Session 原子变为下一条普通 Prompt；非队首选择越过其余队列项，其他项相对顺序不变。
- 多个 pending Steer race fallback 按点击顺序执行，不被前端自动 drain 或并发 session.send 插入。
- fallback 只生成普通 prompt_request，不残留 Steered turn，也不重复附件发送确认。
- unsupported、Review/Compact、转换失败和真实 provider 错误保留 queued item，且允许重试、Next 或 Cancel。
- 同一 client message 的 response 丢失或重试不会生成重复 Steer、重复 Prompt 或重复内部 turn。
- Registry protocol version 仍为 `2.6`。

### 测试

- Go protocol/Registry 测试覆盖 `session.steer` descriptor、project scope、payload/response、client 权限、Session action capability 和 protocol version 不变。
- Agent optional-interface 测试覆盖支持与 unsupported provider、并发 Prompt 下调用、每 Session 串行和 typed inactive/unavailable/error 分类。
- Codex adapter 测试覆盖 active turn 捕获、`turn/steer` 参数、所有现有 Send content 转换、成功 response、快速 userMessage notification、response/notification 反序、client ID 过滤、多次 Steer、Review/Compact unavailable、Turn 结束和进程退出。
- Session 测试覆盖 Steer 不获取 prompt execution lock、正常 acceptance、单次所有权转移、非队首 fallback、多个 fallback 顺序、前端 drain 竞态、另一 session.send 竞态和真实错误不接管消息。
- SessionRecorder 测试覆盖 active prompt 中插入 user_message_chunk、前后 agent/tool turnIndex 顺序、一个消息的多 content blocks、Steered 标记、client ID 去重、持久化读回和 legacy text-only 兼容。
- Web queue 状态测试覆盖 steering、连续 Steer 串行、成功移除、匹配 session.message 先到时移除、sent fallback、失败复位、Next、Cancel 和 session 隔离。
- Web UI 测试覆盖三个 icon 的顺序、tooltip/ARIA、能力与运行态隐藏、pending 状态、普通用户样式、Steered 标记及图片/附件渲染。
- 集成测试覆盖真实或高保真 Codex App Server：运行中 Turn 接受 Steer 后继续回复；Turn 完成竞态自动 fallback；Review/Compact 不显示或拒绝 Steer；其他 Thread 的通知不串线。
- 完成前运行相关 Jest、Web TypeScript 检查、Web production build、相关 Go package tests 和完整 `go test ./...`。

## 范围之外

- Codex Goal 的创建、持久化、自动续跑、暂停、恢复或 Hub 重启恢复；Goal 在后续独立 scope 中设计。
- Claude、Copilot、OpenCode、Kimi、Mimo、CodeBuddy、Flicker 等其他 provider 的 Steer adapter。
- 对不支持 Steer 的 Agent 使用 cancel + re-prompt、特殊 Prompt 文本或其他模拟方案。
- 将普通 queued prompts 迁移为 Hub 持久化队列，或在刷新、App/Hub 重启后恢复未执行队列。
- 多客户端普通 prompt queue 的全局 FIFO 或跨客户端队列同步。
- 对 Review、手动 Compact 或其他 Codex non-steerable turn 强行插入输入。
- 扩展普通 Send 尚未支持的 Codex 原生 Skill/Mention input 语义。
- 修改 Registry protocol version。
