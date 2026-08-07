> 由 scope skill 于 2026-07-31 生成

# cx.deepseek Codex Responses Provider

## 目标

在现有 `cc-*` provider 之外增加一个独立的 Codex 模式，以 DeepSeek 为首个样例。该模式通过原生 `codex app-server` 连接 DeepSeek Responses API，复用现有 ACP 会话、工具、Steer、Goal 和模型配置链路；DeepSeek 的 API key 继续复用 Hub 已有的 `deepSeek` 配置，并使用独立的 Codex home、配置、模型目录和会话状态。原生 `codex` 与现有 CC provider 的行为保持不变。

## 决策

- 后端稳定 agent ID 为 `cx-deepseek`，前端展示名为 `cx.deepseek`。它们属于同一个 provider，不新增通用的 `cx` agent。
- 进程使用 `codex app-server --listen stdio://`，不在 WheelMaker 中直接实现 DeepSeek Responses SSE 或另写一套 Codex 会话协议。现有 Codex app-server ACP bridge 负责线程、turn、item、工具和状态转换。
- DeepSeek API key 读取已有 Hub `apiKeys.deepSeek`；启动 `cx-deepseek` 子进程时通过 `DEEPSEEK_API_KEY` 注入，仅存在于进程环境，不写入 `config.toml`、`models.json`、日志、Session 或 Registry。Codex provider 使用 `env_key = DEEPSEEK_API_KEY`、`requires_openai_auth = false` 和 `supports_websockets = false`。
- `CODEX_HOME` 固定为 `<stateDir>/.data/cx-deepseek`。默认 Windows 路径为 `%USERPROFILE%\\.wheelmaker\\.data\\cx-deepseek`；自定义 `--dir` 时跟随实际 `stateDir`。
- 模型元数据采用 DeepSeek 官方 Codex 文档提供的 `models.json`，不根据通用 `GET /models` 响应推导。WheelMaker 内置版本化的官方 catalog 资产，并在 provider 启动前将当前支持的条目原子写入独立 home；Go 业务代码不为具体模型增加分支。
- 首版只物化并暴露官方当前确认支持 Responses/Codex 的 `deepseek-v4-flash` 条目。通用 `/models` 同时返回尚未支持 Responses 的模型，且不携带 Codex 所需的完整元数据，因此首版不在启动路径调用 `/models`，也不把它作为前端模型来源。
- catalog 沿用官方条目的完整元数据：文本输入、function tools、freeform `apply_patch`、text `web_search`、`low/high/max` 推理档位（默认 `high`）、1M 上下文和官方模型指令；不声明图片或文件输入。
- 新模型只有在 DeepSeek 官方确认支持 Responses/Codex，并提供对应 Codex catalog 元数据后，才随后续 WheelMaker catalog 资产更新进入 `cx-deepseek`；不下载、执行或解析远程安装脚本。
- catalog 在同一 Hub 进程内通过 provider 级 singleflight/锁完成验证与原子落盘，避免多个项目 runtime 并发写同一个 home。资产无效或写入失败时保留最后一次有效文件并返回明确启动错误，不影响其他 provider。
- `cx-deepseek` 不自动替换项目默认 agent；用户通过现有 agent 选择器显式选择。原生 `codex` 继续使用用户自己的 Codex home。
- `cx-deepseek` 的胶囊、圆点和选择器标记使用与 `codex` 相同的颜色槽 `wide-session-agent-0`。
- `cx-deepseek` 的 Session 恢复仅扫描自己的 `CODEX_HOME`，禁止从原生 `codex` 或 `cc-deepseek` 导入历史。它使用独立的 instance creator/runtime pool，不能与原生 `codex` 共享进程；现有 pool fingerprint 无需为此扩展全局结构。
- `cx-deepseek` 要求 Codex CLI `>= 0.144.0`，与 DeepSeek 官方 catalog 的 `minimal_client_version` 一致。版本过低或无法解析时不注册该 provider，并给出可诊断原因。
- 不修改 protocol version；新增 provider 必须完整加入 ACP provider 常量、解析列表、factory 注册、恢复 source、前端 agent label/tag 和对应测试。

官方参考：

- [DeepSeek Responses API](https://api-docs.deepseek.com/guides/responses_api/)
- [DeepSeek Codex Integration](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)
- [Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)

## 架构

```text
Hub apiKeys.deepSeek
        |
        v
ACP factory
  ├─ codex          ──► existing CODEX_HOME / runtime pool
  ├─ cc-deepseek    ──► existing Claude-compatible directory
  └─ cx-deepseek    ──► <stateDir>/.data/cx-deepseek
                              ├─ config.toml          (app-server-owned state)
                              ├─ models.json          (bundled official catalog asset)
                              └─ Codex app-server state
                                      |
                                      v
                           codex app-server --listen stdio://
                                      |
                                      v
                              ACP bridge / WheelMaker
```

### Provider bootstrap

`cx-deepseek` 包含一层轻量 bootstrap：创建隔离 home、校验内置的官方 catalog 资产，并在 provider 级锁内原子写入 `models.json`。WheelMaker 不创建或覆盖整个 `config.toml`；`model`、`model_provider`、`model_catalog_json` 和 `[model_providers.deepseek]` 字段均通过 `codex app-server -c key=value` 启动参数覆盖。provider 使用 `base_url = https://api.deepseek.com/`、`wire_api = responses` 和 `env_key = DEEPSEEK_API_KEY`。bootstrap 不得持久化 API key。

### App-server runtime

该 provider 复用原生 `codex` 使用的 Codex app-server bridge，但使用隔离的 `CODEX_HOME`、provider 专属 `-c` 覆盖项和独立 runtime pool。现有 `thread/start`、`thread/resume`、`turn/start`、`turn/steer`、`model/list` 与 ACP 事件转换继续共享。原生 `codex` 保持现有 home 和 pool identity。

### Recovery and frontend

恢复源将 `cx-deepseek` 映射到 `<stateDir>/.data/cx-deepseek`，且不扫描 `~/.codex` 或任何 CC 项目目录。前端在 protocol/session 操作中保留原始值 `cx-deepseek`，展示名映射为 `cx.deepseek`，tag variant 映射到 Codex 使用的 variant 0。

## 流程

1. Hub loads the existing DeepSeek key and builds the configured ACP factory.
2. When the DeepSeek key is configured and Codex CLI `>= 0.144.0` is available, the factory exposes `cx-deepseek` in addition to the existing providers.
3. Creating the first `cx-deepseek` session bootstraps `<stateDir>/.data/cx-deepseek` and materializes the bundled official Flash catalog under a provider-level lock; it does not fetch `/models` or write the API key.
4. The factory launches `codex app-server --listen stdio://` with `CODEX_HOME` pointing to the isolated directory, `DEEPSEEK_API_KEY` set in the child environment, and provider/catalog settings supplied through `-c` overrides.
5. The existing Codex app-server connection translates ACP session and turn requests. Upstream requests use `deepseek-v4-flash` and the Responses wire API.
6. `model/list` returns the loaded official catalog through the existing ACP conversion. The current frontend model/effort menu consumes it without a provider-specific model list or UI component.
7. A later WheelMaker release can update the bundled catalog after DeepSeek officially adds Responses/Codex support for another model. Existing native Codex and CC sessions remain untouched.

## 验收标准

- With a configured DeepSeek key and Codex CLI `>= 0.144.0`, the hub reports `cx-deepseek`; without the key or with an unsupported Codex version, it does not register the provider and exposes a diagnosable reason.
- The UI shows the provider as exactly `cx.deepseek`, while session and protocol payloads use `cx-deepseek`.
- The `cx.deepseek` tag and capsule use the same `wide-session-agent-0` accent as `codex`.
- The provider launches native `codex app-server --listen stdio://` with `wire_api = responses`, the DeepSeek base URL, isolated `CODEX_HOME`, process-only `DEEPSEEK_API_KEY`, and provider settings supplied through `-c` overrides.
- The generated home is `<stateDir>/.data/cx-deepseek`; native `~/.codex` and all `cc-*` directories are neither read nor written by this provider.
- WheelMaker does not overwrite app-server-owned `config.toml` sections such as project trust; provider-specific model configuration comes from launch overrides.
- The model selector is driven by the bundled DeepSeek official Codex catalog and initially exposes only `deepseek-v4-flash`; `deepseek-v4-pro` is not selectable while official Responses/Codex support is absent.
- The loaded catalog advertises function tools, freeform `apply_patch`, text `web_search`, text-only input, the official context window and `low/high/max` effort options with default `high`.
- An invalid catalog asset or failed atomic write preserves the last valid file, produces an explicit provider startup error, and leaves other providers available. If no prior valid catalog exists, startup fails without leaving a partial file.
- Concurrent first sessions across projects perform one catalog bootstrap and cannot produce partial or conflicting `models.json`/launch state.
- The API key does not occur in generated files, logs, session state, registry payloads, or debug output.
- Native `codex` and `cc-deepseek` continue to use their existing directories, runtime pools, recovery sources, labels, colors, and behavior.
- Sessions created under `cx-deepseek` recover only from its own Codex home and cannot be imported by another provider.
- Existing model/effort configuration UI continues to work from `model/list`; no separate `cx` settings surface is introduced.
- No protocol version change is made.

### 测试

- Go unit tests cover provider constants/registration, Codex version parsing, bundled catalog validation/materialization, environment redaction, atomic-write fallback, bootstrap singleflight, independent provider pools, and recovery-source selection using temporary directories.
- Go integration-shaped tests assert the app-server launch argv, `-c` overrides, and environment without requiring a real DeepSeek key or network call. Tests also verify that existing `config.toml` content is not overwritten.
- Frontend tests cover `cx-deepseek` choice availability, the `cx.deepseek` label, raw agent ID preservation, and Codex color variant mapping.
- Run the relevant server Go tests and frontend unit tests in the feature worktree; an optional manual smoke test may use a configured DeepSeek key and installed Codex CLI.
- Do not make live API access or a real API key a required CI test.

## 范围之外

- 在 WheelMaker 内直接实现 DeepSeek Responses HTTP/SSE 客户端或绕过 Codex app-server。
- 修改原生 `codex` provider、用户的 `~/.codex`、现有 `cc-deepseek` 或其他 CC provider 的目录和配置。
- 新增 DeepSeek 专属 API key 字段、独立登录流程或前端凭据编辑器。
- 通过通用 `/models` 动态生成 Codex catalog，或为每个新 DeepSeek 模型添加 Go 业务代码分支。
- 运行时下载、执行或解析 DeepSeek 官方安装脚本；catalog metadata 仅随经过审查的 WheelMaker 资产更新。
- 图片、文件输入和未被 DeepSeek Responses API 文档声明的模型能力。
- 将 `cx-deepseek` 自动设为项目默认 agent，或改变已有项目/Session 的 provider。
- 运行中的 app-server 无重启热加载模型目录，或在 DeepSeek 尚未发布 Responses/Codex 支持时提前暴露 `deepseek-v4-pro`。
- 修改 ACP/protocol version，或实现其他非 DeepSeek 的 `cx-*` provider。
