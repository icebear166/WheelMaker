> 由 scope skill 于 2026-06-18 生成

# Chat Prompt Queue

## 目标

当前聊天在上一条 prompt 仍在回复时会阻止新的发送，用户只能等待或先 Stop。目标是在客户端加入内存态的多条 prompt 队列：用户可以在当前回复期间继续提交消息，消息按 FIFO 排队展示；当前 prompt 正常结束或被 Stop 取消完成后，队首消息自动作为下一条 prompt 发给服务端。

## 决策

- 队列支持多条消息，默认按 FIFO 顺序执行。
- Queued prompt 只保存在 App 客户端内存，不写入服务端 session history，不跨刷新、重启或多客户端同步。
- 当前 prompt 运行中提交的新消息不立即调用 `session.send`；只有轮到该 queued prompt 执行时才调用服务端发送。
- Queued prompt 显示在聊天流中，样式需要明确区别于已发送用户 prompt。
- 每条 queued prompt 可以单独取消；取消只移除该 queued prompt，不影响当前回复或其他 queued prompt。
- 每条 queued prompt 可以插队；插队语义是移动到队首，等待当前 prompt 正常结束或 Stop 取消完成后优先发送。
- Stop 只取消当前正在回复的 prompt，不清空 queued prompts。
- 当前 prompt 正常结束或取消完成后，客户端自动发送队首 queued prompt。

## 架构

App 在现有聊天运行态旁维护按 session runtime key 分组的内存 prompt queue。队列项保存发送所需的文本、content blocks、附件发送结果引用或可发送 block、创建时间和本地队列 id。聊天流渲染将现有服务端消息、pending prompt 和 queued prompts 合成展示；服务端仍只接收真正执行中的 `session.send`，不感知未执行队列。

## 流程

1. 用户在当前 session prompt running 时提交消息。
2. App 将提交内容转成可发送的 content blocks，创建 queued prompt 项并显示在当前聊天流尾部。
3. 用户可以取消某条 queued prompt，或将某条 queued prompt 移到队首。
4. 当前 prompt 以正常完成或 cancelled stop reason 结束后，App 自动取出队首 queued prompt 并调用现有 `session.send`。
5. 被发送的 queued prompt 离开队列，进入现有 pending prompt 和服务端正式 turn 流程。
6. 如果发送失败，该 prompt 按现有 pending/undelivered 机制呈现失败状态，不继续吞掉错误。

## 验收标准

- 当前回复中可以连续提交多条消息，聊天流显示多条 queued prompts，并保留提交顺序。
- Queued prompt 不会在排队时出现在服务端 session turns 中；只有开始执行后才产生正式 prompt turn。
- 点击某条 queued prompt 的取消操作会移除该条，其他 queued prompts 顺序不变，当前 prompt 不受影响。
- 点击某条 queued prompt 的插队操作会把该条移动到队首，不会立即 Stop 当前 prompt。
- 点击 Stop 后当前 prompt 被取消，queued prompts 保留；取消完成后队首 queued prompt 自动发送。
- 当前 prompt 正常完成后队首 queued prompt 自动发送。
- 刷新页面或重启 App 后未执行 queued prompts 不恢复。
- 队列只影响当前 session；不同 session 的 queued prompts 相互隔离。

### 测试

- 前端状态测试覆盖 enqueue、cancel queued prompt、move queued prompt to front、dequeue next prompt。
- 前端发送流程测试覆盖 running 时不调用 `session.send`、completion/cancel 后自动发送队首。
- UI/渲染测试覆盖 queued prompt 在聊天流中可见，并暴露取消和插队操作。
- 服务端不需要新增队列测试；现有 `session.send` 和 `session.cancel` 语义保持不变。

## 范围之外

- 不做服务端队列持久化。
- 不做跨客户端同步队列。
- 不做页面刷新后的 queued prompt 恢复。
- 不新增“立即打断当前回复并发送这条”的操作。
- 不改变 ACP `session/cancel` 协议语义。
