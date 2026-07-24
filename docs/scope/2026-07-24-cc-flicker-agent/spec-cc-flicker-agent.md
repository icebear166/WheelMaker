# cc-flicker：走 MyFlickerBridge 的 Claude-compatible Agent

> 由 scope skill 于 2026-07-24 生成

## 目标

WheelMaker 已有 4 个 Claude-compatible provider（`cc-deepseek` / `cc-glm` / `cc-kimi` / `cc-qwen`）：都启动同一个 `claude-agent-acp --hide-claude-auth`，靠注入不同的 `ANTHROPIC_*` 环境变量与隔离的 `CLAUDE_CONFIG_DIR`，把模型请求转发到各家 Anthropic-compatible endpoint。本项目新增第 5 个 `cc-flicker`，endpoint 指向**本地 MyFlickerBridge**（`http://127.0.0.1:17888`），从而在一个 agent 里复用 Claude Code 的工具/权限/Session 能力、同时用上 MyFlicker 上游的全家桶模型（Claude / GPT / GLM / Kimi / DeepSeek）。

与其它 `cc-*` 的**本质区别**在于：cc-flicker 连的是本地 bridge，而非公网付费 endpoint。`api_keys.flicker` 只是 bridge 的**本地门禁 token**（多数场景是占位符），真正的上游鉴权（MyFlicker device token / SSO）由 bridge 独立管理，WheelMaker 完全不接触上游凭证。这一差异决定了 key 的语义、默认值和填写约束。

## 决策

- **Q：接入方式？** A —— 照现有 `cc-*` 模式扩一个 profile，复用 `claude-agent-acp` + owned ACP process 链路，不新建框架、不实现 Anthropic Messages 适配。
- **Q：endpoint？** A —— 硬编码 `ANTHROPIC_BASE_URL=http://127.0.0.1:17888`（无尾斜杠，claude-agent-acp 自动拼 `/v1/messages`）。端口不做成可配置。
- **Q：鉴权用哪个变量、值是什么？** A —— 用 `ANTHROPIC_AUTH_TOKEN`（同 cc-glm），值取 `api_keys.flicker`。框架的 `claudeCompatibleLaunchEnvironment` 会把 `ANTHROPIC_API_KEY` 置空，正好满足 bridge「必须移除 ANTHROPIC_API_KEY，否则 Claude Code 走 anthropic.com OAuth」的要求。
- **Q：`api_keys.flicker` 填什么？** A —— 必须**逐字节等于** bridge 的 `MYFLICKER_BRIDGE_API_KEY`。bridge 校验用 `hmac.compare_digest` 精确比对，提供非空但不匹配的 token 会直接 401。默认场景 bridge 用占位符，用户就填 `00000000000000000000`；若 bridge 设了私有 key（共享机器或 `MYFLICKER_REQUIRE_PRIVATE_KEY=1`），则填相同私有值。
- **Q：注册条件？** A —— `claude-agent-acp` 可执行 **且** `api_keys.flicker` 非空时才注册，与现有 `cc-*` 完全一致。不在启动时联网验证 key，也不探测 bridge 是否在运行。
- **Q：暴露哪些模型、默认哪个？** A —— 白名单 8 个：`CLAUDE_OPUS_4_8`、`CLAUDE_4_6`、`GPT_5_6_SOL`、`GPT_5_6_TERRA`、`GPT_5_6_LUNA`、`KIMI_K3`、`GLM_5_2`、`DEEPSEEK_V4_PRO`；默认 `CLAUDE_OPUS_4_8`。通过 `enforceAvailableModels=true` 隐藏原生 Opus/Sonnet/Haiku。
- **Q：模型 ID 用什么形式？** A —— 直接用 MyFlicker 真实 `modelType`（如 `CLAUDE_OPUS_4_8`），不加 `CLAUDE-MYFLICKER-` 前缀。bridge `resolve_model_type` 接受裸 modelType；白名单走 settings.json 不经 CLI gateway discovery，因此**不注入** `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`。
- **Q：分级映射（防子任务回落 anthropic.com）？** A —— Opus / Fable → `CLAUDE_OPUS_4_8`；Sonnet / Haiku / Subagent → `CLAUDE_4_6`。
- **Q：上下文窗口 / auto-compact 参数？** A —— 不设 `CLAUDE_CODE_MAX_CONTEXT_TOKENS`，也不设 `AUTO_COMPACT_WINDOW`，沿用 Claude Code / bridge 默认策略。白名单模型上下文窗口混合（190K~450K），硬编码单一上限会误伤大窗口模型；token 计数与压缩交给默认行为，与其它 cc-* 保持一致。
- **Q：effort / thinking 档位？** A —— 不做特殊 normalize（`claudeCompatibleEffortValues` 对 cc-flicker 返回 nil，走通用 `configOptions` 链路）。bridge 对 effort 全档位宽容，且白名单里 KIMI_K3/GLM_5_2/DEEPSEEK_V4_PRO 不带 think。
- **Q：前端展示？** A —— 标签 `cc · flicker`，沿用 claude 家族色（variant 2），作为 Claude 主项的展开子项，与其它 `cc-*` 一致。
- **Q：limits 监控是否联动？** A —— 否。cc-flicker 走 bridge 门禁 token，与现有 MyFlicker 额度链路（读 `~/.myflicker/ai-token.json`）无关，不改 limits。

## 架构

复用现有 Claude-compatible 链路，仅新增一个 provider profile：

```text
App 选择 cc-flicker
      │ agentType = cc-flicker
      ▼
Hub-scoped ACPFactory（api_keys.flicker 非空 + claude-agent-acp 可用才注册）
      │ 注入 provider-specific env + 隔离 CLAUDE_CONFIG_DIR
      ▼
claude-agent-acp --hide-claude-auth（owned process）
      │ ANTHROPIC_BASE_URL=http://127.0.0.1:17888
      ▼
本地 MyFlickerBridge :17888  ──►  MyFlicker 上游（Claude/GPT/GLM/Kimi/DeepSeek）
```

新增 provider profile 的落地方式与现有 `cc-*` 一致：`claudeCompatibleFlickerProfile` 定义 `configDir` / `endpoint` / `authName` / `defaultModel` / `availableModels` / `settingsEnv`；`NewCCFlickerProvider(stateDir, apiKey)` 由 `claudeCompatibleLaunchEnvironment` 生成启动环境，`ensureClaudeCompatibleSettings` 把默认模型、白名单（`enforceAvailableModels=true`）和分级映射写进 `<stateDir>/.data/cc-flicker/settings.json`。Session 历史隔离在 `<stateDir>/.data/cc-flicker/projects`。

### 与 bridge 的鉴权契约（关键差异）

- bridge 侧 `bridge_api_key = MYFLICKER_BRIDGE_API_KEY or "00000000000000000000"`；`/v1/messages` 走 `_request_allowed(require_api_key=True)`，`hmac.compare_digest(provided, expected)` 精确比对。
- WheelMaker 一定注入非空 `ANTHROPIC_AUTH_TOKEN`，故 `api_keys.flicker` 必须与 bridge 门禁 key 逐字节一致，否则 401。
- 上游凭证不经 WheelMaker：bridge 自行管理 MyFlicker device token / SSO，本项目不读写任何上游 token。

## 流程

1. Hub 启动，读本地 `config.json`，若 `api_keys.flicker` 非空且 `claude-agent-acp` 可用，向 Hub-scoped Factory 注册 `cc-flicker`。
2. 用户选择 cc-flicker，Session 惰性拉起 owned `claude-agent-acp` 子进程，注入 endpoint / 门禁 token / 隔离目录 / 模型配置。
3. 完成 ACP `initialize` + `session/new`；claude-agent-acp 把模型请求发往本地 bridge 的 `/v1/messages`，bridge `resolve_model_type` 归一化后转上游。
4. 流式回复、工具调用、权限请求、模型切换（ACP `session/set_config_option`）走现有通用链路。
5. Session suspend / resume 以 agent ID `cc-flicker` 和 `<stateDir>/.data/cc-flicker/projects` 为边界，不与原生 claude 或其它 cc-* 跨界。

## 验收标准

- `config.json` 接受可选 `api_keys.flicker`，拒绝未知字段；`config.example.json` 含空值示例并注明「值须等于 bridge 的 MYFLICKER_BRIDGE_API_KEY，默认 00000000000000000000」。
- `claude-agent-acp` 缺失或 `api_keys.flicker` 为空时不注册 cc-flicker；两者齐备才注册。`PreferredName()` 不选 cc-flicker。
- cc-flicker 启动的 `claude-agent-acp` 环境含正确且互不污染的 `ANTHROPIC_BASE_URL=http://127.0.0.1:17888`、`ANTHROPIC_AUTH_TOKEN=<api_keys.flicker>`、置空的 `ANTHROPIC_API_KEY`、`CLAUDE_CONFIG_DIR=<stateDir>/.data/cc-flicker`。
- `<stateDir>/.data/cc-flicker/settings.json` 的 `model=CLAUDE_OPUS_4_8`、`availableModels` 为 8 个白名单、`enforceAvailableModels=true`、分级映射就位；不含 `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`，也不注入 `CLAUDE_CODE_MAX_CONTEXT_TOKENS` / `AUTO_COMPACT_WINDOW`。
- model option 只包含 8 个白名单和 Claude ACP 无法移除的 `Default`（解析到 CLAUDE_OPUS_4_8）；新 Session 默认 CLAUDE_OPUS_4_8。
- Session 历史扫描、load、持久化 agent ID 与 claude / 其它 cc-* 相互隔离，不跨目录可见。
- `api_keys.flicker` 不出现在 argv、日志、`ProjectInfo`、Registry snapshot、Session 存储、错误信息或 Web state。
- App 桌面端与移动端、New / Resume Session 均把 cc-flicker 展示为 Claude 展开子项，标签 `cc · flicker`；点击创建/恢复发送的 agentType 仍是 `cc-flicker`。
- 现有 claude / 原生 kimi / 其它 cc-* 的注册、默认优先级、模型配置与恢复不回归；不改 protocol version。

### 测试

- Go 单测：`ParseACPProvider("cc-flicker")`、`acpProviders` 稳定序、preset 字段、`NewCCFlickerProvider` 的 `Launch()` 环境精确值（用假 key 断言且断言假 key 不出现在 argv/错误）、factory 按 key×binary 可用性的注册矩阵、`config.go` 严格解析 flicker key、`redact` 对 `api_keys` 整体脱敏含 flicker、recovery 路径隔离（`<stateDir>/.data/cc-flicker/projects`）。
- Web 单测：agent 展示树把 cc-flicker 收进 Claude 子项、`agentDisplayLabel('cc-flicker')==='cc · flicker'`、桌面/移动 × New/Resume 四入口、Session 标签映射。
- 合并进现有 `agent_test.go` / `client_test.go` / `shared_test.go` / `hub_test.go` / `redact_test.go` 与 web 现有测试文件；跑 `go test ./...`、web Jest、`tsc:web`、`build:web`。
- 不测：真实 bridge / 上游 HTTP 往返；bridge 是否在运行的健康探测。

## 范围之外

- endpoint / 端口 / 默认模型 / 白名单的用户可配置化；自动跟随上游模型增减。
- 检测或拉起 MyFlickerBridge、校验其健康或 key 有效性。
- limits 监控联动、友好模型展示名（picker 显示原始 modelType id，与 cc-glm 一致）。
- 修改 `claude-agent-acp`、Claude Agent SDK、MyFlickerBridge 或 MyFlicker 上游实现。
- 跨 claude / cc-* provider 的 Session 导入、上下文迁移或共享 `~/.claude` 用户配置。
