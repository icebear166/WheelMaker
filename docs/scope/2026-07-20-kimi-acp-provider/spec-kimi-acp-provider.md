# Kimi ACP Provider 接入

> 由 scope skill 于 2026-07-20 生成

## 目标

WheelMaker 当前支持 codex / claude / copilot / opencode / mimo / codebuddy / flicker 七种 ACP agent。本地已安装官方 Kimi Code CLI（`kimi`），其 `kimi acp` 子命令以 stdio JSON-RPC 提供完整 ACP server 能力（initialize / authenticate / session/new / load / resume / prompt / cancel / list / set_model 等）。目标是把 kimi 作为第八种标准 ACP provider 接入 WheelMaker，并把 kimi cli 本地凭证纳入既有 Kimi limits 监控。

## 决策

- **Q: 接入范围？** A —— 标准 ACP provider 接入，复用 mimo/codebuddy 模式；WheelMaker 不处理登录，用户自行 `kimi login`。
- **Q: 二进制解析策略？** A —— 只走现有 `ResolveACPBinary`（PATH + 内置 `bin/<platform>/`），不增加额外搜索目录机制；缺失时报官方一键安装命令提示。
- **Q: Skills 目录？** 安装目标仍只有 `.agents/skills`（沿用现状，skills CLI 负责安装，不经 WheelMaker 目录选择）；扫描目录覆盖 kimi 专有目录：Project = `.agents/skills` + `.kimi-code/skills`，User = `~/.agents/skills` + `~/.kimi-code/skills`。
- **Q: limits 是否联动？** B —— 是。读取 kimi cli 本地凭证 `~/.kimi-code/credentials/kimi-code.json`，与现有 OpenCode 凭证源并存为两个账户。
- **Q: 凭证刷新策略？** A —— 只读 `access_token` 并按 `expires_at` 判断有效性；过期则该账户显示不可用，等 kimi cli 下次运行自行刷新。WheelMaker 不实现 OAuth refresh、不写凭证文件。
- **Q: npm 工具更新列表？** 不加入 `runtimeNPMPackages`——npm 上的 `kimi-code` 包是无关第三方项目，官方分发走原生安装器。

## 架构

复用现有 provider 链路：`AgentFactory → acpProvider(preset) → ACPProcess(kimi acp) → acp.Conn`。改动点：

- `server/internal/protocol/acp_const.go`：新增 `ACPProviderKimi = "kimi"`，注册进 `acpProviders` 与 `ParseACPProvider`。
- `server/internal/hub/agent/acp_provider.go`：新增 `KimiACPProviderPreset`（`BinaryName: "kimi"`, `Args: ["acp"]`, skills 目录按决策）与 `NewKimiProvider()`；`InstallHint` 留空，`MissingPathErrTemplate` 指向官方安装命令（`irm https://code.kimi.com/kimi-code/install.ps1 | iex` / `curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash`）。
- `server/internal/hub/agent/factory.go`：注册 kimi provider。
- `server/internal/hub/usage/`：`KimiScanner` 从单凭证改为多凭证源（每源一个 Account）；新增 kimi-code 凭证读取器，解析 `~/.kimi-code/credentials/kimi-code.json`（尊重 `KIMI_CODE_HOME` 覆盖），仅当 `access_token` 非空且 `expires_at` 未过期时生成账户（LocalID `kimi-code`，Label `Kimi Code`）。
- `app/web/src/app/WorkspaceApp.tsx`：`AGENT_TAG_VARIANT_INDEX` 补 `kimi` 项。

## 流程

Agent 会话：App 选择 kimi → Hub `ensureInstance` 惰性拉起 `kimi acp` 子进程 → 标准 ACP initialize/session/prompt 流。

Limits：usage 采集时，Kimi 的扫描器依次装配各凭证源（OpenCode `auth.json` 的 `kimi-for-coding` key、kimi-code 凭证文件的未过期 `access_token`），各自请求 `https://api.kimi.com/coding/v1/usages`（Bearer），解析同一响应格式为各 Account 的 Limits。

## 验收标准

- 配置 agent 为 `kimi` 后，会话能完成 initialize → session/new → prompt → 流式输出的完整回合；`session/load` 可恢复 kimi 侧历史会话。
- PATH 无 `kimi` 时，报错信息含官方安装命令提示。
- WheelMaker 安装的 skill 出现在 `.agents/skills` 且 kimi 会话可用；`.kimi-code/skills`、`~/.kimi-code/skills` 下的既有 skill 被扫描列出。
- kimi cli 已登录且 token 未过期时，Limits 页 Kimi 下出现 "Kimi Code" 账户并显示用量；token 过期或凭证文件缺失时该账户显示不可用，不影响 OpenCode 账户。
- WheelMaker 任何路径都不写入 `~/.kimi-code/credentials/`。
- `go test ./...` 通过；测试合并进现有 `agent_test.go` / usage 包现有测试文件。

### 测试

- 测：preset 字段（binary/args/skills 目录）、`ParseACPProvider("kimi")`、factory 注册、kimi-code 凭证文件解析（有效/过期/缺文件/坏 JSON/`KIMI_CODE_HOME` 覆盖）、scanner 多账户装配。
- 不测：真实 `kimi acp` 子进程端到端、真实 usages HTTP 请求（沿用现有 mock 方式）。

## 范围之外

- WheelMaker 内触发 `kimi login` / device-code 授权流程（`kimi acp --login`）。
- OAuth refresh_token 刷新与凭证文件写回。
- kimi 特有 UI（模型/思考档位选择走 ACP `configOptions` 现有通用链路，不做定制）。
- npm 包安装/更新管理。
