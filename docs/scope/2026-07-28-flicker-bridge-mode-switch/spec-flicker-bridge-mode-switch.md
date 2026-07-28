> 由 scope skill 于 2026-07-28 生成

# Flicker Bridge V1/V2 Hub 一键切换

## 目标

将 WheelMaker 当前内置并由 Hub 管理的 Go Flicker Bridge 定义为 V1，将 `E:\_Code\kuaishou-misc-tools\docs\scope\2026-07-28-myflicker-wanqing-go-proxy\spec-myflicker-wanqing-go-proxy.md` 定义的 MyFlicker AI SDK/Wanqing 单文件旁路定义为 V2。在现有 Hub 菜单的 “Flicker Bridge” 状态行增加 V1/V2 一键切换，两个版本复用当前 `cc-flicker` endpoint；V1 继续校验本地 key，V2 则完全采用 MyFlicker CLI 自身的登录上下文访问万擎，不校验或使用该 key。选择由实际 Hub 持久化，运行中切换自动重启目标版本，失败时自动恢复原版本。

本项目同时建立通用的 Hub 前端配置存储 `~/.wheelmaker/db/hub-config.json`。V1/V2 mode 是首个配置 section；后续由前端修改、属于具体 Hub 而非 Registry 入口机的持久化配置统一扩展到该文件。

## 决策

- 当前 `server/internal/flickerbridge` 和隐藏入口 `--flicker-bridge` 保持为 V1，不改变其代理行为和兼容入口。
- V2 经核心 spec 验证后，以单独的 `server/internal/flickerbridge/v2.go` 文件集成进现有 `flickerbridge` 包，并通过新的隐藏入口 `--flicker-bridge-v2` 和 `flickerbridge.RunV2` 运行。V1 的 `flicker_bridge.go`、`Run` 入口和运行状态不复用 V2 私有实现。发布产物不依赖外部代理 MJS；V2 仍依赖目标 Hub 机器上的 Node 和兼容版 npm `@myflicker/cli`。
- V1/V2 都监听 `127.0.0.1:17999`。V1 继续把 `api_keys.flicker` 作为本地门禁 key；V2 不读取、不校验该 key，收到 Claude Code 为兼容 V1 而发送的认证 header 时直接忽略。`cc-flicker` 的 `ANTHROPIC_BASE_URL`、agent ID、`CLAUDE_CONFIG_DIR` 和 endpoint 不变。
- `api_keys.flicker` 仍是 Hub 启用 V1/V2 manager 和注册 `cc-flicker` 的产品门槛；缺失时 V2 也不可启动。该门槛不构成 V2 的运行时凭证。
- V2 启动时只通过 npm `@myflicker/cli` 的 `login → setContext → wanqingPlugin` 链路建立真实登录上下文。MyFlicker 凭证只保留在 Node worker 内，不传给 Claude Code、Hub model store 或 Registry。
- 现有 Hub manager 从单版本生命周期管理扩展为模式感知管理；同一时刻只允许一个版本占用 17999。
- 已有安装、缺失 `hub-config.json` 或缺失 `flickerBridge.mode` 时默认 V1。
- 模式选择持久化到实际 Hub 机器的 `~/.wheelmaker/db/hub-config.json`，不写浏览器 LocalStorage、Registry 入口机的 `server-data.json` 或人工维护的 `config.json`。
- 运行状态下点击目标模式：停止当前版本、启动目标版本、等待健康检查，成功后才持久化新模式。
- 目标版本启动、健康检查或配置持久化失败时执行 F1：停止目标版本、重新启动原版本、保持原持久化选择，并向 UI 返回切换失败原因。
- Stopped 或无存活进程的 Failed 状态下点击目标模式执行 S1：只持久化选择，保持 Stopped；之后 Start 才启动所选版本。
- Starting、Stopping、Restarting 或 mode switch action 进行中时禁止再次切换。
- Hub 启动时读取持久化 mode 并启动所选版本。若持久化 V2 无法启动，按 F1 启动 V1；V1 恢复健康后把持久化 mode 回滚为 V1，并保留可展示的失败原因。
- 采用 C1 模型兼容：V2 接受自己的 canonical ID、aliases，以及能由 `epModelName` 唯一对应的 V1 Bridge model ID；兼容映射成功后不主动终止现有 `cc-flicker` Session。
- 切换成功后复用现有 on-ready 链路刷新共享 Flicker 模型目录。目标模式不存在当前 Session 所选模型时，该 Session 的下一次请求返回明确的 model unavailable，不静默切换模型。
- Hub State/Registry 变化是向现有 `flickerBridge` section 增加字段和 action，不修改 Registry protocol version。
- Wiki 在 spec 批准后更新 `docs/wiki/protocols/acp.md` 与 `docs/wiki/architecture/server-runtime.md`。

## 架构

```text
Hub menu
  │ flickerBridge/switchMode {mode:v1|v2}
  ▼
Registry Hub State route
  ▼
flickerBridgeManager
  ├─ hubconfig.Store ──► ~/.wheelmaker/db/hub-config.json
  ├─ V1: current wheelmaker.exe --flicker-bridge
  └─ V2: current wheelmaker.exe --flicker-bridge-v2
             │
             └─ node -e ──► npm @myflicker/cli AI SDK provider

Both modes: http://127.0.0.1:17999
cc-flicker endpoint remains unchanged

V1 auth: api_keys.flicker local gate
V2 auth: @myflicker/cli login context only; local auth headers are ignored
```

### 通用 Hub config store

新增独立的 Hub config 存储模块，文件 schema 初始为：

```json
{
  "version": 1,
  "flickerBridge": {
    "mode": "v1"
  }
}
```

- 路径由 Hub 的 `stateDir` 解析为 `<stateDir>/db/hub-config.json`，每台 Hub 独立。
- store 是该文件的唯一读写所有者，负责进程内互斥、schema/version 校验、64 KiB 文件上限、私有权限和原子替换。
- 缺失文件返回默认配置且不创建文件；第一次成功修改时才落盘。
- 写入采用同目录临时文件、flush/关闭和 rename；Unix 权限为 `0600`，Windows 使用现有 private config writer 的 ACL 规则。
- section 更新只修改目标字段，保留其他 section、已识别的未来字段及未被本版本管理的数据，避免 Flicker 操作覆盖后续 Hub 配置。
- `flickerBridge.mode` 只接受 `v1` 或 `v2`。未知 mode 返回校验错误，不改文件。
- 已存在但无法解析、超限或权限错误的文件不得被自动覆盖。Hub 可用内存默认 V1启动并在状态中报告 config error，但所有前端持久化 action 均失败，直到文件被修复。
- 文件不保存 API key、MyFlicker token、PID、endpoint、临时 action 或运行状态。
- 前端不能提交整份文档或任意 JSON patch；每个配置字段必须由 Hub 后端的窄 action 校验后更新。

### 模式感知 Bridge manager

manager 保存 selected mode 与 running mode 两个概念：

- `mode`：`hub-config.json` 中已提交的选择。
- `runningMode`：当前拥有 manager 捕获 PID 的实际进程版本；停止时为空。

状态至少包含：

```json
{
  "configured": true,
  "supported": true,
  "state": "running",
  "mode": "v1",
  "runningMode": "v1",
  "availableModes": ["v1", "v2"],
  "endpoint": "http://127.0.0.1:17999",
  "port": 17999,
  "pid": 123
}
```

- `availableModes` 只包含通过本地静态前置检查的模式。V1 沿用 Windows x64 支持边界；V2 还须能解析 Node、npm package、精确支持版本和 bundle anchor。
- manager 仍以非空 `api_keys.flicker` 作为两个模式共同的产品启用门槛；V2 子进程和 HTTP handler 不得把该值作为鉴权输入。
- UI 始终展示 V1/V2 两个 segment；不在 `availableModes` 中的目标禁用，并从非敏感 mode error 获取说明。
- 静态状态刷新不得触发登录、打开浏览器或真实 Wanqing 请求；真实鉴权在 V2 Start 中完成。
- Start/Stop/Restart 仍作用于 selected mode。Restart 不改变 mode。
- 所有进程停止和回滚只操作 manager 自己捕获的 PID；不得结束非 manager 所有的 17999 listener。
- V1 继续使用现有健康接口。V2 必须提供兼容的 `/_myflicker/health`，也可保留自身 `/health`。
- mode switch action 串行执行。一个 switch 未完成时，Start/Stop/Restart 和第二个 switch 返回 busy。

### V2 模型 ID 兼容

V2 启动后从 `wanqing.models` 建立只读索引：

- canonical ID；
- MyFlicker aliases；
- 非空 `epModelName`；
- V1 已公开的 `CLAUDE-MYFLICKER-<epModelName>` 形式。

请求模型按以上顺序解析为唯一 canonical ID。多个模型命中同一兼容 ID 时该 ID 不注册，并记录不含凭据的冲突诊断；不得任意选择。V2 `/v1/models` 仍以 V2 当前可用模型目录为准，兼容 ID 主要用于让切换前已存在的 Session 可以继续请求。

C1 只承诺能由当前 V2 元数据唯一对应的 ID。V1 独有模型、V2 隐藏/黑名单模型以及目标模式已移除的模型不做伪造。

Hub 在 bridge 健康后从当前 `/v1/models` 刷新共享模型目录，并在每次启动 `cc-flicker` 时同时写入 Claude 配置的 `models` 和 `availableModels`。前者保留展示元数据，后者是当前 `claude-agent-acp` 生成 ACP `model` config option 的实际输入；`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` 继续保留。目录必须来自当前运行模式，不在 WheelMaker 中写死，因此 V2 切换成功后 CC 能看到 V2 的动态模型 ID。

V2 的 Anthropic Messages 转换同时接受顶层 `system` 和 Claude Code 可能放入 `messages[].role="system"` 的系统内容。MyFlicker 基础 prompt 在合并后只出现一次，额外系统内容按原顺序保留；系统消息不得作为 user/assistant turn 发送给 AI SDK。

### Hub 菜单

在现有 “Flicker Bridge” 行内增加紧凑的 V1/V2 segmented control：

- 两个按钮使用 `aria-pressed` 表达选中状态，并共享可访问名称 “Flicker Bridge mode”。
- 选中态显示 persisted `mode`，实际 `runningMode` 的 segment 使用运行高亮。正常 Running/Stopped 状态不再在按钮之间显示说明文案；失败原因仍使用现有 `aria-live="polite"` 区域。
- action 进行中禁用 V1/V2、Start/Stop/Restart，避免并发动作。
- Running 时点击另一模式直接执行 switch，不弹确认框。
- Stopped 时点击另一模式只持久化选择，状态仍为 Stopped。
- F1 回滚完成后恢复原 segment 选中态，并在现有 `aria-live="polite"` 区域显示目标版本失败原因。
- 不新增页面、modal 或独立设置入口。

## 流程

### 运行中切换

1. UI 调用 `flickerBridge` section 的 `switchMode` action，参数为 `{mode:"v2"}`。
2. Hub 校验 mode、当前 action、可用性和 manager 对进程的所有权。
3. manager 记录原 selected/running mode，停止原进程。
4. manager 以相同 host、port 启动目标隐藏入口并等待健康检查；仅 V1 接收本地门禁 key，V2 在 Node worker 内建立 MyFlicker 登录上下文。
5. 目标健康后，store 原子提交 `flickerBridge.mode`。
6. manager 发布包含新 mode/runningMode 的 `hub.state.updated`，刷新共享模型目录。
7. 若第 4 或第 5 步失败，停止目标进程，重新启动并健康检查原版本；持久化选择保持不变，发布原模式状态和 switch error。

如果原版本回滚也失败，状态为 Failed，`mode` 仍是原持久化选择，`runningMode` 为空，并同时保留目标失败与回滚失败的摘要。

### 停止态切换

1. UI 调用同一 `switchMode` action。
2. Hub 验证目标 mode 和可用性。
3. store 原子提交 mode。
4. manager 更新 selected mode 并发布 Stopped 状态，不启动进程。

### Hub 启动

1. Hub 加载 `hub-config.json`；缺失时选择 V1。
2. 配置了 `api_keys.flicker` 时，manager 启动 selected mode。
3. selected mode 为 V2且启动失败时，尝试启动 V1。
4. V1 回滚健康后持久化 V1，并发布带 V2失败原因的 running 状态；V1 也失败则发布 Failed。

## 验收标准

- 当前 V1 代理代码、`--flicker-bridge` 入口和 17999 endpoint 保持兼容。
- V2 通过独立隐藏入口运行；发布的 WheelMaker 不需要外部代理 MJS，但目标 Hub 必须安装兼容 Node 与 npm MyFlicker。
- 现有 `cc-flicker` provider 不修改 endpoint、agent ID 或配置目录。为兼容 V1，Claude Code 可继续发送当前本地 key；V2 必须忽略该 header，且不得将其用于万擎请求。
- V2 的 `/v1/models`、`/v1/messages` 与 `/v1/messages/count_tokens` 均不校验 V1 fake key；V2 只绑定 loopback，真实上游认证完全来自 MyFlicker CLI 登录上下文。
- `api_keys.flicker` 缺失时 V2 仍不可由 Hub 启动；配置存在只表示产品已启用，不表示 V2 使用该值鉴权。
- 缺失 `hub-config.json` 的升级用户自动使用 V1，且仅查看状态不会创建文件。
- 第一次成功切换生成 `<stateDir>/db/hub-config.json`；更新 mode 不删除其他配置 section。
- V1/V2 在同一时刻最多一个 manager-owned listener；切换、回滚和关闭后不遗留目标子进程或 Node worker。
- Running 状态切换成功后 endpoint 不变、PID 变化、mode/runningMode 一致，并刷新模型目录。
- 刷新后的动态模型 ID 同时进入 `models` 与 `availableModels`；真实 `claude-agent-acp session/new` 的 `model` config option 至少包含当前 bridge 的非 Claude 模型。
- Running 状态切换失败时自动恢复原版本；持久化 mode 和 UI 选中态保持原值，并显示失败原因。
- Stopped 状态切换只更新 mode，不产生 bridge 或 Node 进程。
- Hub 重启后启动上次成功持久化的模式；持久化 V2 启动失败时按 F1 回滚并提交 V1。
- V2 能解析唯一匹配的 V1 `epModelName`/公开前缀模型 ID，不静默替换不存在或冲突的模型。
- 已有 `cc-flicker` Session 不因模式切换被主动删除或重建；不兼容模型在下一次请求返回明确错误。
- Hub State payload 和 UI 中不出现本地 key、MyFlicker token、签名或完整 worker错误输出。
- Registry protocol version 不变；旧 Web 客户端忽略新增状态字段后仍可使用 Start/Stop/Restart。

### 测试

- 扩展现有 Hub bridge manager 测试，使用注入的 process、health、mode availability 和 config store，覆盖：
  - 缺失配置默认 V1；
  - running V1 → V2 成功切换；
  - Stopped 下只提交 mode；
  - 目标 start/health/persist 失败分别触发 F1；
  - 目标失败且原版本回滚失败；
  - switch 与其他 lifecycle action 互斥；
  - 只结束 manager-owned PID；
  - Hub 启动读取 V2及启动失败回滚 V1。
- 为通用 Hub config store 测试：
  - 缺失文件默认值；
  - 首次写入、私有权限和原子替换；
  - section 合并与未知数据保留；
  - 非法 mode、未知 schema version、超限、损坏 JSON 和权限错误不覆盖原文件；
  - 并发更新不丢 section。
- 扩展 command dispatcher 测试，证明 `--flicker-bridge` 仍进入 V1，`--flicker-bridge-v2` 只进入 V2，普通 Hub/Registry/guardian 路径不受影响。
- 扩展 Hub State 测试，覆盖 `switchMode` 参数校验、新状态字段、事件发布和敏感值排除。
- 扩展现有 Web Flicker Bridge menu 测试，覆盖：
  - mode/runningMode/availableModes normalize；
  - V1/V2选中和禁用态；
  - Running/Stopped 点击语义；
  - busy 时所有动作禁用；
  - F1 后恢复原选中态并展示错误；
  - unrelated Hub event 不改变其他 Hub mode。
- V2 包测试 canonical/alias/`epModelName`/V1前缀解析、冲突拒绝和模型不可用错误。
- V2 HTTP 测试证明无本地认证 header 也能读取模型、计数和发送消息，并证明 worker 初始化调用 MyFlicker `login` 后才对外就绪；测试不得把真实 MyFlicker 凭证写入响应、日志或 Hub 状态。
- V2 request conversion 测试覆盖 `messages[].role="system"`，证明额外系统内容保留且 MyFlicker 基础 prompt 只合并一次。
- Claude-compatible settings 测试证明共享模型目录同时生成动态 `models` 和 `availableModels`，空目录会删除两者的陈旧值；真实 ACP smoke test 展开 `session/new.configOptions[id=model]` 并确认动态非 Claude ID 可见。
- Hub 测试证明缺失 `api_keys.flicker` 时 V2 仍被产品门槛禁用，同时 V2 launch spec 不再注入 `MYFLICKER_WANQING_PROXY_KEY`。
- Windows x64 集成测试依次启动 V1、切到 V2、切回 V1，确认全程 endpoint 为 17999、各阶段 health/models 正确，最终无遗留子进程。
- 使用真实 Claude Code 做 C1 smoke test：V1 建立 `cc-flicker` Session，切换 V2 后以可映射模型继续一轮文本或工具请求；测试不得主动删除该 Session。

## 范围之外

- 不保证 V1/V2 模型目录完全相同，也不为目标模式不存在的模型建立错误映射。
- 不在切换前等待正在进行的推理请求自然排空；运行中切换会终止当前 bridge，进行中的请求可能失败，但 Session 本身不被删除。
- 不在 Hub config 中保存 Registry 侧 Server 配置、第三方密钥、运行状态或 Session 数据。
- 不提供任意 Hub config JSON 编辑器；本项目只开放经过校验的 `flickerBridge.mode` action。
- 不把 Hub config 跨 Hub 同步；每台 Hub 拥有自己的文件和选择。
- 不修改 Registry protocol version，不新增页面或移动端专用交互。
