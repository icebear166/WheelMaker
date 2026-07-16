> 由 scope skill 于 2026-07-16 生成

# ZCode Agent ACP Bridge

## 目标

WheelMaker 已通过自研 ACP 协议接入 codex、claude、copilot、opencode、mimo、codebuddy、flicker 七种 agent，其中 codex 是唯一的「app-server 协议桥接成 ACP」形态（`codexappConn`）。本 spec 新增 `zcode` agent：ZCode（Z.ai 出品，跑 GLM-5.2）的桌面应用内置一个 stdio JSON-RPC 的 app-server 子命令（`zcode app-server`），协议已通过 wire 抓包 + 真实 API 调用完整逆向（见 [docs/zcode-app-server-acp-bridge.zh-CN.md](../../zcode-app-server-acp-bridge.zh-CN.md)）。目标是让 ZCode 作为一等公民 agent 接入，能力对齐 codex（聊天 / 配置同步 / session 列表与恢复 / 权限审批桥接 / runtime pool 复用）。

ZCode 与 codex 同属「app-server 桥接」类型，但有三处协议级差异必须处理：(1) `session/send` 纯异步（codex 的 `turn/start` 同步等 completed）；(2) 事件模型两层（`state.updated` patch + `session/event` 带 seq）；(3) 权限用 `interaction/requestPermission`（4 值 decision），message 结构是 `{info, parts}`。

## 决策

- **范围**：对齐 codex 完整能力——自定义 Conn + 翻译层 + runtime pool + config options 映射 + session 列表/恢复 + 权限桥接。图片输入、`session/rewind`、reasoning delta 的具体 kind 不在第一期（协议待测点，实现时顺手补）。
- **架构**：与 codex 同款，走「自定义 Conn + 翻译层」，**不能**用标准 `ownedConn`（ownedConn 假设对端是标准 JSON-RPC ACP，ZCode 不是）。新增 `zcodeapp_agent.go` / `zcodeapp_convert.go` / `zcodeapp_pool.go`，对照 codexapp 三件套。
- **凭证**：自动复用桌面版。`zcodeAppProvider.Launch()` 从 `~/.zcode/v2/config.json` 的 `provider["builtin:zai"].options.apiKey` 读 key，注入 `ZCODE_API_KEY` + `ZCODE_BASE_URL=https://api.z.ai/api/anthropic` + `ZCODE_MODEL=zai/glm-5.2` 三个环境变量。用户零配置（只要桌面版登录过即可）。不读 `~/.zcode/cli/config.json`，不改任何用户文件。
- **二进制发现**：固定路径探测 + 系统 node。Windows `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`；macOS `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`；Linux 类似（`~/.local/share/...` 或 `/opt/...`，需在实现时确认）。`node` 用 `exec.LookPath`。找不到 `zcode.cjs` 报错提示「请安装 ZCode 桌面版」。launch 命令固定为 `node <zcode.cjs> app-server --cwd <projectDir>`。
- **进程模型**：pool 复用，照搬 codex 的 runtime pool 设计（已验证 ZCode 单进程多 session 并发隔离正常）。按 `projectId` + launch fingerprint（`sha256(exe+args+env)`）共享一个 app-server 进程，引用计数回收，进程退出自动重建。pool 代码近乎照搬 `codexapp_pool.go`，runtime 层照搬 codex 的 runtime（RPC 配对 + 按 sessionId 路由事件 + initialize 单例）。
- **协议空白处理**：spec 落地前已补齐三个关键空白——权限闭环（reply allow → `permission.resolved` → 工具执行）、config options（无统一 set_config_option，用 `session/setMode`/`session/setModel`）、message parts 结构（text/step-start/tool/step-finish）。剩余次要空白（图片/rewind/reasoning kind）在实现对应翻译分支时抓包补。

## 架构

```text
client.Session
  -> agent.Instance                         // 现有 ACP 接口，零改动
    -> zcodeappConn                         // 实现 agent.Conn（5 方法）+ 扩展接口
      -> zcodeappRuntime                    // ZCode Protocol：RPC 配对 + 按 sessionId 路由事件 + initialize 单例
        -> zcodeappRuntimePool              // 按 projectId 复用 runtime（照搬 codexapp_pool.go）
          -> ACPProcess                     // 现有 JSONL stdio 子进程传输（复用，零改动）
            -> node <zcode.cjs> app-server
```

### 单元职责

- **`zcodeapp_agent.go`**（对照 `codexapp_agent.go`）：
  - `zcodeAppProvider`：`Launch()` 返回 `(nodeExe, ["<zcode.cjs>","app-server","--cwd",cwd], env, nil)`，env 含三个 `ZCODE_*`。二进制路径探测在 provider 内部完成。
  - `zcodeappConn`：实现 `agent.Conn`（Send/Notify/OnACPRequest/OnACPResponse/Close）。`Send` 是 ACP method → ZCode RPC 的翻译 switch。扩展接口：`Alive`/`BindSessionID`（与 codex 一致）；按需 `SessionStatusProvider`/`SessionCompactor`/`SessionArchiver`（见流程）。
  - `zcodeappRuntime` + pool：照搬 codex 的 runtime/pool，把 `threadId` 换成 `sessionId`。

- **`zcodeapp_convert.go`**（对照 `codexapp_convert.go`）：ZCode 协议的 JSON-RPC params/response 结构体（`zcodeSession`/`zcodeMessage`/`zcodeEvent`/`zcodeSettings` 等）+ ACP↔ZCode 字段映射 + config state（model/permission/thoughtLevel）。

- **`protocol/acp_const.go`**：`ACPProviderZCode ACPProvider = "zcode"` + 进 `acpProviders` 切片 + `ParseACPProvider` case。
- **`agent/factory.go`**：独占注册块（不走 candidates，因 creator 不同），`RegisterSessionActions(ZCode, {Status, Compact})`。
- **`agent_test.go`**：`fakeZcodeappTransport`（照抄 `fakeCodexappTransport`）+ `TestZCodeApp*`。

## 流程

### 聊天（session/prompt → session/send + 事件流合成）

ZCode `session/send` 立即返回 `{accepted:true, stateRevision}`，模型输出纯异步。桥接必须合成同步语义（对照 codex 的 `promptDone chan` 模式）：

1. ACP `session/prompt` → 桥接调 `session/send {sessionId, content}`，拿到 accepted。
2. 挂起 `Send`（`select` 在 `promptDone chan` 和 `ctx.Done()`）。
3. 订阅事件流，按 `sessionId` 路由到本 conn 的串行队列：
   - `model.streaming`（`kind=text_delta`）→ `agent_message_chunk`（`delta`）
   - `model.streaming`（reasoning kind，待补）→ `agent_thought_chunk`
   - `tool.updated`（scheduled）→ `tool_call pending`；（started）→ `tool_call_update in_progress`；（result）→ `tool_call_update completed/failed`
   - `session.titleUpdated` → `session_info_update.title`
4. `turn.completed`（`resultType=success`）→ 写 `promptDone`，`Send` resolve 返回 `stopReason=end_turn`。
5. `turn.failed` → resolve 返回 `refusal`/error。`session/stop` 主动取消 → `cancelled`。

> 关键不变量（与 codex 一致）：同一 session 内，`turn.completed` 只能在前序 `session/update` callback 完成后结束 prompt；事件必须按 `seq` 顺序处理。处理 `turn.completed` 比 send response 先到的乱序（缓冲 pending stop，对照 codex `pendingPromptStops`）。

### session 生命周期

| ACP | ZCode | 备注 |
|---|---|---|
| `session/new` | `session/create {workspace:{workspacePath,workspaceKey}, mode}` | ACP sessionId = ZCode sessionId；`mode` 映射 permission mode |
| `session/load` | `session/resume {sessionId}` | replay `messages[].parts`：text→message_chunk、tool→tool_call、step-finish.tokens→usage_update |
| `session/list` | `session/list` | 字段映射（sessionId/sessionKind/status/title/workspace/createdAt）|
| `session/cancel` | `session/stop {sessionId}` | 停止当前 turn |
| `session/request_permission` | `interaction/requestPermission`（server→client request）| 见下 |

### 权限（interaction/requestPermission → session/request_permission）

ZCode server 发带 `id`（形如 `server-N`）的 `interaction/requestPermission`，未应答时指数退避重发。桥接：
1. 收到 → 转 ACP `session/request_permission`（kind 按 toolName 映射：Bash→execute、Write/Edit/ApplyPatch→write、其余→other；`input` 按 toolName 解读为 command/path）。
2. ACP 审批结果 → 映射回 ZCode result：批准→`{decision:"allow", reason}`（可选 `permissionUpdates` 持久化）；拒绝→`{decision:"deny"}`；cancel→`{decision:"deny", reason:"cancelled"}`。
3. 回复后 server 发 `permission.resolved` 通知 + 工具继续执行（已实测闭环）。
4. 低风险命令（echo 等）build 模式自动放行，**不**触发 requestPermission——桥接无需处理。

### Config options（session/set_config_option → setMode/setModel 扇出）

ZCode 无统一 set_config_option。桥接把 ACP `session/set_config_option` 按 option id 扇出：
- `approval_preset`/permission → `session/setMode {sessionId, mode}`（ACP 值映射：auto/default→build、read_only→plan 等，需对齐官方语义）
- `model` → `session/setModel {sessionId, model:{providerId, modelId}}`
- 返回时把 ZCode `settings` 折算回完整 ACP config options 列表（不是 patch）。

## 验收标准

- 在装了 ZCode 桌面版且登录过的机器上，WheelMaker 能自动发现并注册 `zcode` agent（`factory.Names()` 含 `zcode`），无需用户配置任何文件或环境变量。
- 完整聊天闭环：发消息 → 收到流式 `agent_message_chunk` → `turn.completed` → ACP `session/prompt` 返回 `end_turn`。回复文本与 ZCode 桌面版一致。
- session 恢复：ACP `session/load` 能 replay 历史（文本 + 工具调用），replay 后继续对话上下文连续。
- 权限：build 模式下高风险命令（如 `rm -rf`）触发 ACP `session/request_permission`；用户批准后工具执行、turn 完成；用户拒绝则工具失败、turn 以失败收尾。低风险命令不弹审批。
- pool：同一项目的多个 zcode 会话共享一个 app-server 进程；关闭所有会话后进程退出；进程崩溃后会话进入可恢复的 suspended 态（对照 codex 行为）。
- 协议健壮性：`session/send` 的异步事件流正确合成同步语义；乱序的 `turn.completed` 不丢更新；进程退出时活动 prompt 以错误结束（不永久悬挂）。
- 不破坏现有 agent：claude/codex/copilot 等的注册、factory、session 流程零回归（现有 `agent_test.go` 全绿）。

### 测试

对照 codex 的 `fakeCodexappTransport` 模式，**全 mock app-server，不打真实子进程**：
- `fakeZcodeappTransport`：实现 ZCode runtime transport 接口，`emit()` 模拟 server 推送（`session/event`/`state.updated`/`interaction/requestPermission`），`nextSent()` 断言发出的 RPC。
- runtime 层：RPC id 配对、按 sessionId 路由事件、initialize 单例、pool 复用/回收/进程退出重建（照搬 codex 的 runtime/pool 测试）。
- prompt 异步合成：正常 completed、乱序 completed 缓冲、stale delta 过滤、cancel 清理、runtime 关闭完成活动 prompt。
- 翻译表：`model.streaming`→message_chunk、`tool.updated`→tool_call lifecycle、`interaction/requestPermission`→request_permission 双向、message parts replay。
- config：setMode/setModel 扇出 + settings 折算回 config options。
- launch：断言 `node <zcode.cjs> app-server` + 三个 `ZCODE_*` env，cwd 正确。
- 不测：真实 GLM 模型调用（用 verify-*.js 手动验证）、真实 ZCode 安装路径（mock 探测）。

## 范围之外

- ZCode 桌面版的 OAuth 登录流程（假设用户已在桌面版登录，桥接只复用其 apiKey）。
- 图片/附件输入（`session/send` content 非文本）——协议待测，第一期 text-only，遇到时补抓包。
- `session/rewind`（回退检查点）——`target` 结构待测，第一期不暴露 rewind 能力。
- reasoning delta 的具体 `model.streaming.kind`——待测，先按 text_delta 处理，确认后补 agent_thought_chunk 映射。
- thoughtLevel 的 set 方法（当前只读到 available/current，未发现 set）。
- ZCode 版本升级的协议兼容层（v0.15.2 为基线，协议无官方契约，后续升级需重新抓包回归）。
