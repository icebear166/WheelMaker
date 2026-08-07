> 由 scope skill 于 2026-07-12 生成

# Interactive Terminal

## 目标

WheelMaker 当前通过 ACP 支持 Agent 发起的命令执行，但没有供用户直接操作的交互式终端。新增一个 Windows 优先的 Terminal 功能：用户可从 Chat 标题栏打开 Terminal，在当前 Workspace 项目根目录创建真正的 PTY，通过任意已认证设备持续输入、查看和恢复终端。Hub 持有全部运行状态，Registry 只负责认证、路由和广播，网页保持无状态。

## 决策

- V1 是完整交互式 PTY，不是逐条提交命令的 command runner；必须支持控制键、交互程序、鼠标输入和 resize。
- Terminal 是独立功能，但入口位于 Chat 标题栏的 Preview 按钮左侧。
- PC 点击入口后，在 Chat 下方展开 Terminal 面板；Chat 与 Terminal 之间有可拖动的水平分隔条。右侧 Preview 可与 Terminal 同时打开。
- 移动端点击同一入口后打开全屏 Terminal surface；顶部是 terminal tabs，其余区域用于终端内容。Terminal 与 Preview 在移动端一次只显示一个全屏 surface。
- Terminal 内有独立 tabs 和 `+`。点击 `+` 时使用当前 Workspace 项目定位 Hub，并以项目根目录作为初始工作目录；创建后不随 Workspace 项目切换而改变归属或目录。
- Terminal 工作台展示当前账号可访问的所有 Hub、所有项目上尚未删除的 terminals，包括 running、exited 和 error 状态，并显示 Hub、项目、初始工作目录和运行状态。
- 只要客户端能通过 Registry 访问 Hub，就能使用该 Hub 的 Terminal；不增加 Terminal 开关、PIN、二次认证或独立权限。
- Windows 是 V1 唯一要求的平台。Shell 按 `pwsh.exe`、`powershell.exe`、`cmd.exe` 的顺序自动探测。
- Hub 是 terminal 会话的唯一状态真相。网页切换、刷新、Registry 断线和设备断线都不终止 PTY。
- Hub 仅与 Registry 临时断开时，已知 terminal 在现有页面中标记为 unavailable，不判定为 exited；刷新后的无状态页面等 Hub 重连后才能重新枚举这些 terminals。
- 不设置空闲超时。Terminal 只会因 Shell 退出、用户确认关闭、Hub 停止或不可恢复的 PTY 错误而结束。
- Shell 退出后保留 tab、最终画面和 exit code；用户可以删除该 tab，或从原始项目根目录重启同一个 tab。
- 任意设备都可查看和输入同一个 terminal。Hub 不为输入设置控制权，按到达顺序把输入写入 PTY；多设备同时输入可能交错，这是接受的行为。
- 每个 terminal 只有一个布局 owner。创建连接是初始布局 owner；只有布局 owner 的 resize 生效。其他设备必须显式点击“适应当前屏幕”取得新的布局 ownership。
- 布局 owner 只影响 resize，不影响查看或输入。创建和显式取得 ownership 时，Hub 向该请求返回新的私有 `resizeToken`；后续自动 resize 必须携带当前 token，新的 ownership 会立即使旧 token 失效。
- Hub 维护完整的 terminal screen、cursor、modes、normal/alternate buffer、尺寸和有限 scrollback。每个 terminal 固定保留最近 10,000 行 scrollback，更早行被淘汰。
- 重连必须精确恢复当前画面和最多 10,000 行 scrollback。Hub 重启后不恢复 PTY，也不恢复已结束的 terminal 列表。
- 隐藏 PC 面板、移动端返回 Chat 或切换 tab 不结束 terminal。关闭仍在运行的 tab 必须先确认；确认后终止 PTY 进程树并从所有设备移除。
- 移动端 V1 提供标准快捷键栏：`Esc`、`Tab`、`Ctrl`、`Alt`、方向键、`Ctrl+C`、`Ctrl+D` 和 Paste。`Ctrl`、`Alt` 可锁定一次并与下一个按键组合。
- 不新增 WebSocket 连接，也不在 V1 引入 binary WebSocket frame。现有 Registry `/ws` 继续只承载 JSON；terminal input/output bytes 使用 base64 放入单向 Registry event。
- 增量输出只使用 `runId + seq`：每次 PTY 启动生成新的 `runId`，每批 output event 的 `seq` 从 1 单调递增。客户端发现 run 变化或 sequence 断层时重新获取完整 snapshot，不请求补发缺失事件。
- 前端使用 `@xterm/xterm@6.0.0` 与同代 `@xterm/addon-fit`；Hub 固定使用 `github.com/gitpod-io/xterm-go@v0.0.0-20260602140638-d86eba88b616` 维护 headless 状态并生成 VT snapshot；PTY 层固定使用 `github.com/aymanbagabas/go-pty@v0.2.3`，Windows 实现落到 ConPTY。第三方实现都包在 WheelMaker 内部接口后面。
- Terminal 输入、输出和 snapshot 内容不得进入 Registry debug log、Hub log 或普通应用日志；日志只记录 terminal id、Hub、项目、状态、字节数、序号和错误摘要。

## 架构

```text
App Terminal UI / xterm.js
        <=> existing Registry /ws
            JSON request/response/event only
        <=> Registry Terminal Router
        <=> existing Hub Registry connection
        <=> Hub Terminal Manager
            |- xterm-go headless terminal state
            `- go-pty -> Windows ConPTY -> detected shell
```

### App

App 增加 Terminal controller、Registry terminal service、PC bottom panel 和 mobile full-screen surface。Controller 从 Hub 获取 terminal metadata 和 snapshot，解码 `terminal.output` 的 base64 data 后写入 xterm.js，并把 xterm.js 产生的用户输入编码为 base64 `terminal.input` event。App 只保存当前页面的展示状态；刷新后重新从 Hub 枚举和恢复 terminal。

### Registry

Registry 保持无 terminal 业务状态。它负责：

- 校验 client/hub 身份和 Hub scope。
- 把 JSON control request 转发到目标 Hub。
- 只允许 client 单向发送已注册的 `terminal.input` event，并转发到对应 Hub。
- 只允许 Hub 单向发送已注册的 `terminal.output` 和 `terminal.changed` events，并广播给所有可访问该 Hub 的 clients。
- 使用统一 writer loop 串行写 WebSocket：control response 和普通事件优先，terminal output 使用有界低优先级队列。
- terminal output 队列溢出时不阻塞 control plane，也不静默丢失后继续发送；Registry 关闭该慢客户端连接，使其通过现有重连流程重新取得 Hub snapshot。

Registry envelope 增加严格的单向事件路由规则。普通 client/hub 仍不能任意发送 `type=event`；只有上述 Terminal methods 按角色、Hub scope 和 project/hub routing 校验通过后才允许转发。Input/output payload 不进入 debug envelope log。

### Hub Terminal Manager

Terminal Manager 是 Hub 级组件，不属于 ACP `terminal/*`，也不属于某个 Chat Session。Manager 持有所有 `TerminalSession`：

- `terminalId`、`runId`、Hub、来源 project、initial cwd 和 shell。
- running/exited/error 状态、exit code 和创建/退出时间。
- PTY handle、input writer、output pump 和关闭流程。
- headless terminal、10,000 行 scrollback、当前 cols/rows。
- 当前私有 `resizeToken`。
- 当前 run 内单调递增的 output `seq`。

ConPTY output pump 不依赖 Registry 是否在线。短时间内的 PTY reads 先合并成一批；flush 时在同一临界区内更新 headless terminal 并递增 `seq`，然后发布一个 `terminal.output` event。网络发布失败不会停止 PTY，也不会阻止 headless state 和 `seq` 继续更新。

### Control 协议

Control plane 沿用 JSON Registry envelope：

- `terminal.list`：按 `hubId` 返回该 Hub 的 terminal metadata；App 对所有可见在线 Hub 并行请求并合并。
- `terminal.create`：使用 envelope 的 `projectId` 和 payload 中的初始 `cols/rows` 创建 terminal；Registry 根据 project 路由到 Hub，Hub 使用已注册项目根目录，忽略客户端提供的任意 cwd。成功响应包含 `terminalId`、`runId` 和初始 `resizeToken`。
- `terminal.get`：使用 `hubId + terminalId` 返回 metadata、`runId`、`snapshotSeq` 和 base64 编码的 serialized VT snapshot。
- `terminal.resize`：payload 包含 `cols/rows`。`claim=true` 表示显式取得 layout ownership，成功响应返回新的 `resizeToken`；普通自动 resize 必须携带当前 token。
- `terminal.close`：终止运行中的 PTY 或删除已退出 terminal；后端操作幂等。
- `terminal.restart`：仅允许 exited/error terminal；复用 `terminalId`，生成新 `runId`，清空旧 screen/sequence，并从 initial cwd 启动自动探测到的 Shell。
- `terminal.changed`：Hub 通过 Registry 广播 created、running、resized、exited、restarted、closed 和 error 状态变化。

`terminal.get` 在 Hub 内获取一致性快照：serialized VT 内容、`runId` 与 `snapshotSeq` 必须来自同一个受锁状态，不能返回画面与序号不匹配的结果。`resizeToken` 只出现在成功的 create/claim response 中，不进入 list、get、changed event 或日志。

### 增量事件协议

Terminal data plane 仍使用 Registry JSON envelope，但 input/output 是不带 request id、无需 response 的单向 event：

- `terminal.input`：App 到 Hub，payload 为 `{terminalId, runId, data}`，`data` 是原始 input bytes 的 base64；不要求 layout ownership。terminal 不存在、`runId` 与当前 run 不匹配、run 已结束或 base64 非法时 Hub 丢弃该 event，不执行部分输入。
- `terminal.output`：Hub 到所有 Apps，payload 为 `{terminalId, runId, seq, data}`，`data` 是本批 ConPTY output bytes 的 base64。

```json
{
  "type": "event",
  "method": "terminal.output",
  "hubId": "hub-a",
  "payload": {
    "terminalId": "term-1",
    "runId": "run-2",
    "seq": 42,
    "data": "base64..."
  }
}
```

客户端为当前已附着 terminal 维护 `expectedSeq`：

- event 的 `runId` 与当前 snapshot 不同：停止应用增量并调用 `terminal.get`。
- `seq == expectedSeq`：解码并写入 xterm.js，然后递增 `expectedSeq`。
- `seq < expectedSeq`：视为重复 event 并忽略。
- `seq > expectedSeq`：视为断层，停止应用增量并调用 `terminal.get`。

Hub 合并短时间内的小块输出并限制单个 JSON event 的解码后 data 大小。Registry 对 terminal output 使用有界队列；control plane 不因慢 terminal client 被无限阻塞。Input 不做断线缓存，发送失败时 App 禁用输入并等待重连，避免恢复后执行过期按键。Binary WebSocket frame 作为后续兼容优化时，只替换 input/output data 编码，不改变 control methods、`runId`、`seq` 或 snapshot 语义。

## 流程

### 初始化与创建

1. App 完成 Registry 连接并取得 project/hub snapshot。
2. App 对每个在线 Hub 调用 `terminal.list`，合并 running、exited 和 error records 为全局 terminal tabs。
3. 用户点击 `+`；App 使用当前 Workspace `projectId` 和当前 terminal 容器尺寸调用 `terminal.create`。
4. Hub 校验 project、解析根目录、自动探测 Shell、创建 ConPTY 与 headless terminal，并在 create response 中向请求页面返回初始 `resizeToken`。
5. 创建响应和 `terminal.changed` 事件使所有设备出现新 tab。

### 实时输入输出

1. xterm.js 将键盘、Paste、鼠标和移动快捷键转换为 input bytes。
2. App 通过 `terminal.input` event 发送 base64 data；Registry 根据 hub/terminal id 转发；Hub 完整解码后按到达顺序写入 PTY。
3. Hub 合并 ConPTY output，更新 headless state 和 `seq`，然后发送 `terminal.output` event。
4. Registry 把 output event 广播给所有允许访问该 Hub 的客户端；已附着客户端按 `runId + seq` 去重和检查连续性后写入 xterm.js。

### 重连与恢复

1. App 或 Registry 断线时，Hub 的 PTY 和 headless output pump 继续运行。
2. 已打开页面在 Hub 离线期间保留已知 tabs 并标记 unavailable；新加载页面不使用本地缓存伪造 terminal list。
3. App 重连后重新执行 `terminal.list`，打开 terminal 时发起 `terminal.get`。
4. 请求期间 App 暂存该 terminal 已收到的 output events。
5. App reset 本地 xterm.js，写入 snapshot，将 `expectedSeq` 设置为 `snapshotSeq + 1`；snapshot 完成解析后，只应用相同 `runId` 且从 `expectedSeq` 开始连续的暂存 events。
6. 暂存或实时 events 出现 run 变化或 sequence 断层时，丢弃待应用增量并重新调用 `terminal.get`。

### Resize 与关闭

- 当前 layout owner 的容器发生实际尺寸变化时调用 `terminal.resize`；后台 tab 不发送 resize。
- 非 owner 设备只按 Hub 当前 cols/rows 显示。用户点击“适应当前屏幕”后调用 `terminal.resize` 并设置 `claim=true`；成功后保存响应中的新 `resizeToken`，后续容器变化使用该 token resize。
- `resizeToken` 只保存在当前页面内存中。页面刷新后不会恢复 ownership，用户需要再次点击“适应当前屏幕”。
- 关闭 running terminal 时 App 先确认；确认后调用 `terminal.close`。关闭 exited terminal 不需要运行中确认。

## 验收标准

- PC Chat 标题栏在 Preview 左侧显示 Terminal 入口；点击后在 Chat 下方展开可拖动高度的 Terminal 面板，且右侧 Preview 可同时保持打开。
- 移动端同一入口打开全屏 Terminal surface，顶部可切换/关闭 tabs，正文占用剩余空间，并有标准快捷键栏。
- 点击 `+` 后，Hub 在当前 Workspace 项目根目录启动自动探测到的 Shell；客户端不能指定项目根目录之外的初始 cwd。
- App 能合并展示所有可访问在线 Hub 中尚未删除的 running、exited 和 error terminals；单个 Hub 离线不阻止其他 Hub 的 terminals 使用。
- 已打开页面在 Hub 与 Registry 临时断开时保留已知 tabs、标记 unavailable 并禁用输入；Hub 重连后通过 `terminal.list` 和 `terminal.get` 恢复。刷新后的无状态页面在 Hub 离线时不显示无法验证的缓存 tabs。
- PowerShell prompt、控制键、Paste、Unicode/IME、ANSI 颜色、vim/top 类 alternate-screen 程序和鼠标模式可正常工作。
- 切换 Chat、折叠 Terminal、刷新网页、Registry 重连和切换设备都不会终止 PTY。
- 任意两台设备可同时看到 output 并发送 input；Hub 不拒绝非 owner 的普通 input。
- 同一时刻只有 layout owner 的 resize 生效；其他设备显式获取后才能改变 cols/rows，旧 owner 后续 resize 被拒绝。
- 断线期间产生的 output 在重连 snapshot 中可见；恢复后的 screen、cursor、modes、normal/alternate buffer 与 Hub 状态一致。
- 每个 terminal 最多保留最近 10,000 行 scrollback；超过后只淘汰最旧 scrollback，不破坏当前 screen。
- snapshot 与增量之间无重复或缺口；`runId` 变化或 sequence 断层会触发 `terminal.get`，而不是静默显示错误画面。
- Terminal 无空闲超时。只有 Shell 退出、确认关闭、Hub 停止或 PTY 错误结束会话。
- 关闭 running terminal 必须确认；确认后对应 ConPTY 进程树结束，并在所有设备上移除。Shell 自行退出时 tab 保留 exit code 和最终画面。
- Hub 进程重启后 `terminal.list` 返回空列表；App 清除该 Hub 的旧 tabs，不把它们显示为可恢复或 exited records。
- 大量 terminal output 时，已排队的 Registry control response 和普通事件优先于后续 `terminal.output` events；慢客户端 terminal queue 溢出后该客户端连接被关闭，不能让 Hub output pump 或其他 clients 永久阻塞。
- Registry debug、Hub debug 和普通日志中不出现 terminal input、output、snapshot、命令内容或环境变量值。

### 测试

- Go protocol 测试覆盖 Terminal event method/role allowlist、payload schema、base64、解码后大小限制和非法输入完整丢弃。
- Registry 测试覆盖 client/hub 单向 event 校验、project/hub 路由、output 广播、writer priority、bounded queue 和慢客户端断开。
- Terminal Manager 使用 fake PTY 测试 create/list/get/input/output/exit/restart/close、无空闲回收、`runId`、`seq`、`resizeToken` 和并发输入。
- Headless state 测试覆盖颜色、光标移动、清屏、resize、Unicode、normal/alternate buffer、10,000 行淘汰和 serialized snapshot 恢复。
- 重连集成测试在 snapshot 请求期间并发产生 output，验证 snapshot sequence 与缓冲增量拼接后无重复、无缺口。
- App service/controller 测试覆盖多 Hub list 合并、base64 input/output、`runId + seq` 去重/断层、snapshot restore、断线禁用输入和重连恢复。
- App UI 测试覆盖标题栏入口顺序、PC bottom panel、拖动分隔条、Preview 共存、mobile full-screen、terminal tabs、标准快捷键栏和关闭确认。
- Windows smoke test 使用真实 ConPTY 和 `pwsh`，覆盖 prompt 输入、`Ctrl+C`、交互程序、resize、Shell exit、进程树关闭以及 `pwsh` 缺失时的 fallback。
- 高输出压力测试验证 Chat/Registry control 消息不会被 terminal output 队列饿死，慢客户端断开重连后通过 `terminal.get` 恢复正确画面。
- 测试日志捕获验证输入、输出、snapshot 和环境变量不会被记录。

## 范围之外

- macOS/Linux PTY 支持。
- Hub 重启、操作系统重启后的 terminal 进程与画面恢复。
- Binary WebSocket terminal frame、独立 Terminal WebSocket、直连 Hub、Port Relay 或 ttyd 架构；binary input/output 仅作为后续传输优化。
- 复用或改变 ACP `terminal/*` 的 Agent 命令执行语义。
- PC terminal 分屏、tab 拖拽排序和弹出独立窗口。
- Shell profile 选择、WSL/Git Bash 菜单和用户自定义启动命令。
- 自定义移动快捷键栏。
- 永久 transcript、完整生命周期输出归档、历史导出和输入审计。
- 可配置 scrollback；V1 固定为每个 terminal 10,000 行。
- 额外 Terminal PIN、二次认证或独立权限系统。
