> 摘要：本页维护 Codex App Server 在 WheelMaker 中的连接、provider 隔离、Turn 跟踪和可选 Session 能力映射。

# Codex

Codex provider 使用共享 App Server connection；WheelMaker 的稳定 Session ID 映射到 Codex runtime thread ID。Adapter 按 thread 分流通知，按 JSON-RPC request ID 匹配 response，并为每个绑定 Session 跟踪当前 active turn。

## Steer

WheelMaker `session.steer` 映射到 Codex `turn/steer`。请求使用当前 `expectedTurnId` 和稳定 `clientUserMessageId`；带匹配 client ID 的 `userMessage item/started` 是 transcript 顺序锚点。Goal 自动 Turn 也维护 active turn，因此不依赖普通 Prompt 的 `promptDone` channel 就能 Steer。

## Goal

WheelMaker Goal controller 映射到：

- `thread/goal/set`
- `thread/goal/get`
- `thread/goal/clear`
- `thread/goal/updated`
- `thread/goal/cleared`

Codex 原生 Goal status 直接映射为 WheelMaker 通用 status。`thread/goal/set` 必须保留 patch 字段的 omitted/null 区别，尤其是 `tokenBudget: null` 表示清除预算。

设置 active Goal 时：

- idle thread 自动启动隐藏 continuation；
- 普通 Turn 运行中会从当前 Turn 起切换为 Goal；
- active Turn 中修改 objective 会使用 Codex 隐藏 Steer，不形成可见用户消息；
- Pause 和 Clear 不 interrupt 当前 Turn；
- 普通 Fork 不复制 Goal。

`thread/resume` 可能立即继续 active Goal 并发出 Turn 通知，因此 load/reconnect 路径必须先建立 stable Session、runtime thread 和 event sink 的绑定，再调用 resume。App Server 失活时，Hub 先清除旧 runtime 的物理 Turn 状态，再建立新连接；恢复后用 `thread/goal/get` 校准 snapshot。

产品语义与验收见 [`../../scope/2026-07-26-session-goal.md`](../../scope/2026-07-26-session-goal.md)；通用能力边界见 [`session-capabilities.md`](session-capabilities.md)。

## DeepSeek Responses provider

`cx-deepseek` 是复用原生 Codex App Server bridge 的独立 provider，稳定 agent ID 为 `cx-deepseek`，App 展示名为 `cx.deepseek`。它使用 `codex app-server --listen stdio://` 与 DeepSeek Responses API 通信，继续复用现有 thread、turn、item、Steer、Goal、工具调用和 `model/list` 转换，不在 WheelMaker 内另建 Responses SSE 客户端。

该 provider 的 `CODEX_HOME` 固定为 `<stateDir>/.data/cx-deepseek`，并拥有独立 instance creator、runtime pool、catalog 和恢复源；原生 `codex` 仍使用用户自己的 Codex home。DeepSeek Key 复用 Hub `apiKeys.deepSeek`，仅作为子进程环境变量 `DEEPSEEK_API_KEY` 注入。provider 设置通过 `codex app-server -c key=value` 覆盖，不覆盖 App Server 自有的 `config.toml`。

模型元数据来自随 WheelMaker 版本发布、经过校验的 DeepSeek 官方 Codex catalog 资产。catalog 同时暴露 `deepseek-v4-flash` 与 `deepseek-v4-pro`，其中 Flash 保持默认模型，Pro 通过现有模型选择器按需启用；WheelMaker 不根据通用 `/models` 推导 Codex catalog，也不运行远程安装脚本。两个条目保留官方文本输入、function tools、freeform `apply_patch`、text `web_search`、`low` / `high` / `max` 推理档位、1M 上下文窗口和模型指令；图片与文件输入不在能力声明内。Codex CLI 最低版本为 `0.144.0`。

来源：[`../../scope/2026-07-31-cx-deepseek-codex-mode.md`](../../scope/2026-07-31-cx-deepseek-codex-mode.md)、[DeepSeek Responses API](https://api-docs.deepseek.com/guides/responses_api/)、[DeepSeek Codex 集成](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)。
