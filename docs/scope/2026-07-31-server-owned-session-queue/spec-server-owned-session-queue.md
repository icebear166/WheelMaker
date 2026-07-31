> 由 scope skill 于 2026-07-31 生成

# Server-Owned Session Queue

## 目标

当前 App 在浏览器内存中维护按 Session 分组的 prompt/compact FIFO，Hub 不知道尚未执行的 item。页面刷新、客户端断线或多客户端同时操作时，queue 会丢失、停滞或出现所有权竞争；运行中附件入口也因客户端 queue 限制而不可用。本次把 queue 的唯一所有权和调度迁到 Hub 的 `Session` 内存状态，由 Hub 在没有 App 在线时继续执行，并由 App 通过 Session 投影展示和操作 queue。

## 决策

- Queue 是 Hub `Session` 的内存状态，不写入 SQLite、SessionRecorder 或 turn history；Hub 重启后允许丢失。
- Queue 非空时，Session 不得被闲置回收；所有 App 断开后 Hub 仍继续调度，直到 queue 为空。
- Prompt 与 compact 共用一个 FIFO。Goal、status、fork 等 Session action 不进入 queue；其他正在运行的 Session execution 会阻止 queue 启动下一项。
- Queue snapshot 包含 `generation`、单调递增的 `revision`、`activeItem` 和 `waitingItems`。reload 或 Hub 重启产生新的 generation，App 只在同一 generation 内比较 revision。
- Live item 状态仅包括 `queued`、`running`、`cancelling` 和 `steering`。`completed`、`cancelled`、`failed`、`steered` 形成正式 turn/operation 后都从 live queue 移除。
- 客户端为每个 item 生成 Session 内唯一的 `itemId`。Hub 将它同时用于 enqueue 幂等、queue 操作、Steer 和 transcript 归因；同 ID 同 payload 返回原结果，同 ID 不同 payload 返回冲突。幂等记录保留到 queue reload、Session archive/delete 或 Hub 重启。
- 使用统一的 `session.queue` request method，action 仅包含 `enqueue`、`cancel`、`prioritize`、`steer`。
- `enqueue` 接受 prompt 或 compact union。Hub 立即返回更新后的 Session/queue snapshot，并异步调度；不等待 item 执行完成。
- 移除 `session.send`、`session.compact`、`session.cancel`、`session.steer`，不保留旧接口兼容。
- Registry Protocol 版本字符串保持 `2.6`；Registry、Hub、App 必须同步发布。版本握手不会识别混用的新旧组件，混用时允许直接出现 method 或 payload shape 错误。
- `session.read` 保持 turn 增量读取职责，但其现有 `session` 信息增加完整 queue snapshot；不新增 `session.queue.read`。
- Queue 的 enqueue、排序和状态变化复用 `session.updated` 推送完整 Session/queue snapshot；操作响应也返回最新 snapshot。`session.list` 只返回 queue generation/revision、active kind 和 waiting count 摘要，不返回 item blocks。
- Hub 按接收顺序串行执行所有 queue mutation，并在每次可观察变化后递增 revision、发布 `session.updated`。
- Active item 正常完成、取消或失败后都移出 queue 并自动执行下一项。失败 prompt 的错误由正式 failed turn 表达；从该 turn 重试会用新的 itemId 重新 enqueue。
- Waiting prompt/compact 均可 `cancel` 或 `prioritize`。Prioritize 只移动到 waiting 队首，不中断 active item。
- Active prompt 的 `cancel` 先进入 cancelling，调用 Agent `SessionCancel` 并取消本地 prompt context；收到正式 cancelled 结果后移除并继续。Active compact 不支持取消，snapshot 暴露 `cancelSupported: false`，请求返回 `unsupported`。
- `steer` 仅适用于 waiting prompt。Provider 接受后，item 保持 steering，直到带相同 item ID 的 transcript 确认后移除；若已经错过可 steer 时机，该 item 成为最高优先级的下一条 prompt；Provider 明确不支持或调用失败时，item 恢复原位置和 queued 状态。
- `session.reload` 仅在没有 active execution 时允许，并直接清空 waiting queue 和幂等状态、创建新的 queue generation。
- Session archive/delete 在没有 active execution 时直接清空 queue，不额外确认；有 active execution 时继续按现有规则拒绝。
- 不为 queue 增加 item 数、Session 内存或 Hub 总内存业务限制；仍受现有 Registry 16 MiB 单条 WebSocket 消息传输边界约束。
- Queue 不接管附件文件清理。Waiting item 被 cancel 或 Hub 重启遗留的未发送附件保留到 Session archive/delete 时由现有目录清理流程删除。
- Composer 在运行中允许选择附件。点击发送时先完成现有附件上传并取得服务端 block，再 enqueue prompt；上传失败时不创建 queue item。

## 架构

```text
Registry client(s)
  | session.queue actions
  | session.read / session.updated
  v
Hub Client (per Project)
  └─ Session (per sessionId)
      ├─ execution / prompt / steer / goal state
      └─ queue state
          ├─ generation + revision
          ├─ active item
          ├─ waiting FIFO
          └─ idempotency outcomes
```

Hub `Session` 是 queue 的唯一写入者和调度者。Registry 只按现有 project/session 路由转发 request 与 `session.updated`，不保存 queue。App 删除本地 `chatQueuedPromptsByKey` 调度职责，仅持有最后收到的 Session queue projection，并用 generation/revision 拒绝过期投影。

Queue scheduler 必须从 prompt 和 compact 执行链得到明确的成功、取消或失败结果，再原子完成 active item 并继续调度。现有 steer fallback 优先队列并入 Session queue 调度，避免同时存在两套 prompt waiting 所有者。

## 流程

### Enqueue 与执行

1. App 序列化 composer；如有附件，先完成附件上传。
2. App 调用 `session.queue` 的 `enqueue` action，提交 `itemId` 和 prompt blocks 或 compact item。
3. Hub 校验 Session、item union、附件引用和 itemId 幂等性，将 item 加入 waiting FIFO并发布 `session.updated`。
4. 若 Session 没有其他 execution 且没有 active item，Hub 原子地把队首提升为 running，并在后台执行。
5. 正常完成、取消或失败时，Hub 都先写入正式 turn/operation，再移除 active item 并继续队首。

### 同步与重连

1. App 首次选择 Session 或重连时，沿现有 `session.read` 得到 turns、Session 信息和完整 queue snapshot。
2. 后续 mutation 和执行转换通过现有 `session.updated` 推送新 snapshot。
3. App 接收不同 generation 时整体替换 queue；同 generation 下只接受更高 revision。
4. 操作超时后，App 可以用同一 itemId 重试 enqueue；Hub 返回原结果而不创建重复 item。

### Steer

1. App 对 waiting prompt 发送 `steer(itemId)`。
2. Hub 原子标记 steering，并尝试 Provider steer。
3. Provider 接受时，Hub 等待 transcript 中相同 itemId 后完成该 item。
4. Provider 已结束当前可 steer turn 时，Hub 把该 item 移到 waiting 队首。
5. 不支持或失败时，Hub 恢复原位置并推送错误后的 queue snapshot。

## 验收标准

- Queue 的唯一可变状态位于 Hub Session；App 不再负责 dequeue、自动 drain 或跨 runtime key 移动 queue。
- 同一 Session 的 prompt 与 compact 严格按统一 FIFO 调度；prioritize、steer fallback 和并发 mutation 不产生重复执行。
- App 全部断开时 queue 继续执行；重连后 `session.read` 恢复当前 active/waiting 投影。
- Hub 重启后 queue 为空；历史 turns 和 Session SQLite 数据保持可读。
- Queue 非空时 Session 不会被闲置回收；queue 清空后恢复现有 suspend/persist 行为。
- Active item 失败后形成正式 failed turn、立即出队并继续下一项；失败 turn 的 retry 以新 itemId 重新 enqueue。
- Active prompt 可取消并产生正式 cancelled turn；active compact cancel 返回 unsupported。
- Waiting item cancel/prioritize 和 prompt steer 均由 Hub 原子执行，并通过 `session.updated` 同步到多个 App 客户端。
- 重复 enqueue 相同 itemId 和 payload 不会重复执行；相同 ID、不同 payload 返回冲突。
- `session.reload`、archive/delete 按已确认语义清空 queue；active execution 期间仍被拒绝。
- 运行中 Composer 可选择附件；发送时附件先上传，成功后 prompt 才进入 Hub queue。
- `session.read` 返回完整 queue，`session.list` 返回 queue 摘要，`session.updated` 推送完整 queue；不存在 queue read/polling 接口。
- Registry、Hub、App 只使用新的 `session.queue`，旧 send/compact/cancel/steer method 不再注册或调用；协议版本常量仍为 `2.6`。
- 不引入 queue 持久化、业务容量限制或 queue 专属附件清理。

### 测试

- Hub queue 状态测试覆盖统一 FIFO、并发 enqueue 幂等、ID 冲突、prioritize、waiting cancel、失败出队后继续、revision/generation 和无人在线时持续 drain。
- Hub execution 测试覆盖 prompt/compact 成功与失败结果、prompt cancelling、active compact unsupported、steer transcript 确认和 steer fallback 顺序。
- Session 生命周期测试覆盖非空 queue 阻止 eviction、Hub 重启不恢复、reload 清空、archive/delete 清空及 active execution 拒绝。
- Protocol/Registry 测试覆盖 `session.queue` action union 与路由、旧 method 移除、`session.read`/`session.list`/`session.updated` queue 投影，以及协议版本仍为 2.6。
- App 状态与集成测试覆盖仅消费服务端 snapshot、generation/revision 去旧、操作响应与 event 汇合、运行中附件入口、附件上传先于 enqueue、queued/steering/cancelling UI 操作，以及 failed turn 重新 enqueue。
- 不测试旧接口兼容、queue 跨 Hub 重启恢复、queue 容量限制或 item 取消时附件删除。

## 范围之外

- Queue 写入 SQLite、SessionRecorder、turn history 或 Registry。
- Hub 重启后的 queue 恢复。
- Registry Protocol 版本升级及旧 App/Hub 兼容。
- Queue 数量、payload、Session 或 Hub 内存业务限制。
- Queue 专属 read/event method。
- Queue item 取消时立即删除附件。
- Active compact 强制取消。
- 既有 Session 切换 Agent。
