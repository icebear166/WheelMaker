> 由 scope skill 于 2026-07-16 生成

# Codex Project Shared Runtime

## 目标

WheelMaker 当前每个 Codex 会话各自启动一个 `codex app-server` 进程。实测五个 app-server 进程合计约 904 MB 工作集、483 MB 私有内存；创建会话还会重复进程级初始化。改造为同一 WheelMaker 项目的 Codex 会话共享一个 app-server runtime，以明显降低重复进程内存，同时保持会话、配置、事件、权限和故障状态严格隔离。

## 决策

- Runtime pool 的主键是 `projectId`。
- pool 元数据保存并校验 `cwd` 与非敏感的 Codex 启动配置指纹；任一值变化时，旧 runtime 不可复用，必须创建新 runtime。
- `cwd` 是 Codex 进程启动工作目录；`projectId` 是 WheelMaker 的会话、持久化和 Registry 归属，两者不视为同一概念。
- 模型、推理强度、审批预设、sandbox、活跃 turn、pending approval、prompt/compact 状态和回调全部是会话私有状态，不能进入共享 runtime 状态。
- 所有来自 app-server 的通知与服务端请求必须按 `threadId` 路由到唯一的会话 conn；未知或已注销的 thread 必须 fail closed，不得回退到其他会话。
- 一个项目 runtime 意外退出时，只影响该项目下的已加载 Codex 会话；这些会话进入可恢复的 suspended 状态，各自正在执行的操作以自己的错误结束。
- 关闭或删除一个会话只能注销该会话 conn；只有项目 runtime 的最后一个引用关闭或 Hub 停止时，才能关闭 app-server 进程。
- Codex MCP 启动配置属于 runtime 级配置。同一项目的共享会话使用同一套 MCP 启动配置；WheelMaker 当前 Phase 1 不提供每会话 MCP 配置。

## 架构

```text
projectId runtime pool
  └─ Codex runtime (one app-server process, one initialize handshake)
       ├─ session A codexappConn (thread A, config A, callbacks A)
       ├─ session B codexappConn (thread B, config B, callbacks B)
       └─ threadId → conn router and per-thread event queues
```

`codexappRuntime` 保留 JSON-RPC request/response matching、thread 路由和 per-thread queue。新增的 project runtime pool 负责 runtime 的创建、进程级 initialize singleflight、引用计数、启动配置校验、异常退出处理和 Hub 停止时的关闭。

每个 `codexappConn` 仍持有自己的 `cwd`、ACP session ID、runtime thread ID、`codexappConfigState`、active turn、pending prompt/compact 状态及 ACP callbacks。它在 `thread/start`、`thread/resume` 和 `turn/start` 时注入自己的模型、推理、审批和 sandbox 设置。

## 流程

1. 创建或恢复 Codex Session 时，Agent factory 以 `projectId` 查找 runtime pool。
2. 若不存在可复用 runtime，或保存的 `cwd` / 启动配置指纹不匹配，创建一个新的 app-server runtime；否则增加引用并创建新的 conn。
3. 每个 app-server runtime 只执行一次 `initialize` 与 `initialized` handshake；并发获取 conn 的会话等待同一个结果。
4. Session 创建或恢复后，conn 将自己的 `threadId` 注册到 runtime。后续通知和权限请求仅由该映射投递给对应 conn。
5. 会话配置变更只更新该 conn 的配置状态；后续该会话的 thread/turn 请求携带其有效配置。
6. 删除、归档卸载或 Session 实例释放时，conn 注销 thread 路由并释放 runtime 引用；仍有其他引用时 runtime 继续服务。
7. runtime 意外停止时，pool 标记该项目 runtime 不可用，通知所有受影响 conn 完成各自进行中的操作并进入 suspended；下一次会话操作按现有恢复路径创建新的 runtime 并恢复对应 thread。

## 验收标准

- 同一项目的多个 Codex 会话只启动一个 `codex app-server` 进程。
- 不同项目、不同 `cwd` 或不同启动配置指纹的会话绝不复用同一 runtime。
- 两个会话并发 prompt 时，agent message、reasoning、tool、plan、approval、cancel、compact 和 prompt completion 只到达其原始 session。
- 会话 A 修改模型、推理强度或审批预设后，会话 B 的后续 `thread/start`、`thread/resume`、`turn/start` 参数保持 B 自己的配置。
- 删除或关闭会话 A 后，会话 B 能继续 prompt、cancel、compact 和 receive updates；最后一个会话关闭后 app-server 才退出。
- runtime 进程退出后，受影响会话不会把失败、更新或权限请求投递给其他会话；下一次会话操作能按既有持久化 thread ID 恢复。
- Registry、Session Recorder、前端协议和协议版本保持不变。
- 与当前每会话一进程相比，五个空闲 Codex 会话的共享运行时工作集与私有内存明显更低；测试基准记录实际数值。

### 测试

- 在 `server/internal/hub/agent/agent_test.go` 中覆盖 runtime pool 的单例创建、metadata 不匹配重建、进程级 initialize singleflight 和引用计数关闭。
- 用 fake runtime 建立至少两个 conn，验证每类 thread 事件、server request、并发 prompt completion 和未知 thread 都不会串线。
- 验证两个 conn 使用不同模型、推理和审批预设时，发往 app-server 的 request 参数保持隔离。
- 验证删除一个 conn、关闭最后一个 conn、runtime 意外停止和后续恢复的状态变化。
- 保留并扩展现有 `TestCodexAppRuntimeRoutesNotificationsByThread`，将其作为隔离回归测试入口。
- 增加受控的基准或诊断测试，记录单 runtime 多空 thread 与多 runtime 单 thread 的内存/进程数量；不把固定机器数值作为断言。

## 范围之外

- 不改变 Registry 协议版本、前端请求格式或 Session Recorder 数据格式。
- 不实现每会话独立 MCP server 集合；这需要单独的 MCP materialization 设计。
- 不承诺共享 runtime 消除每个 `thread/start` 的 Codex/MCP 网络等待；该问题通过 WheelMaker 的 MCP 启动配置隔离单独处理。
- 不跨项目共享 app-server 进程。
