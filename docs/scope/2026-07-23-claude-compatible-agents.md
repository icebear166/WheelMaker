# Claude-compatible GLM / Kimi Agents

> 由 scope skill 于 2026-07-23 生成

## 目标

WheelMaker 已通过 `claude-agent-acp` 接入原生 Claude，并另有官方 Kimi Code CLI 的原生 `kimi` ACP provider。本项目新增 `cc-glm` 和 `cc-kimi` 两个 agent：继续使用 Claude Agent SDK/Claude Code 的工具、权限和 Session 能力，但把模型请求分别转发到 Z.AI 与 Kimi Code 的 Anthropic-compatible endpoint。用户只需在每个 Hub 的 `config.json` 配置对应 API Key；endpoint、Claude 环境变量、模型白名单、默认模型、状态目录和 Session 恢复均由 WheelMaker 托管。

## 决策

- Key 归每个 Hub 本地所有，不由 Registry 托管，不经过网页配置，也不下发给其他 Hub。
- Hub 配置增加顶层 `apiKeys`：`apiKeys.zai` 和 `apiKeys.kimi`。不按 agent 重复嵌套配置，不增加 endpoint 或 model 字段。
- 配置只在 Hub 启动时加载；修改 `config.json` 后重启 Hub 生效，不实现配置热加载。
- `claude-agent-acp` 可执行文件存在且对应 Key 非空时才注册 `cc-glm` 或 `cc-kimi`。不在启动时联网验证 Key。
- 两个 provider 都启动 `claude-agent-acp --hide-claude-auth`，不直接运行交互式 `claude` CLI，不实现 Anthropic Messages 协议适配。
- provider 状态根分别为 `<stateDir>/.data/cc-glm` 和 `<stateDir>/.data/cc-kimi`，并通过 `CLAUDE_CONFIG_DIR` 注入。默认 `stateDir` 为 `~/.wheelmaker`。
- 原生 Claude 的 `~/.claude`、GLM 和 Kimi 三套用户配置与历史互不共享。项目内 `CLAUDE.md`、`.claude/settings.json`、local settings 和项目 Skills 继续由 Claude SDK 按项目目录加载。
- `cc-kimi` 暴露 `k3[1m]`、`k3`、`kimi-for-coding`、`kimi-for-coding-highspeed`，默认 `k3[1m]`。
- `cc-glm` 暴露 `glm-5.2[1m]`、`glm-5.2`、`glm-4.7`、`glm-4.5-air`，默认 `glm-5.2[1m]`。
- 模型列表只覆盖 Kimi Code 与 Z.AI 官方 Claude Code/Coding Plan 文档明确支持的模型；上游新增模型由后续 WheelMaker 版本更新，不使用通用 API 的全量模型列表。
- 通过 Claude ACP 的 `availableModels` 隐藏原生 Opus、Sonnet、Haiku 等模型条目。Claude ACP 强制保留的 `Default` 允许存在，但必须解析到对应 provider 的默认模型。
- Claude 的 Opus、Sonnet、Haiku、Fable 和 Subagent 默认映射全部指向对应上游模型，避免内部子任务回落到 Anthropic endpoint。
- 桌面端和移动端的 New Session、Resume Session 都把 `claude` 渲染为可直接点击的主项，并在相邻独立展开按钮下显示可用的 `GLM`、`Kimi` 子项。
- 内部 agent ID 保持 `claude`、`cc-glm`、`cc-kimi`；Session 标签显示 `CC · GLM`、`CC · Kimi`。现有原生 `kimi` provider 保持独立。
- GLM、Kimi、原生 Claude 的上游 Session 不跨 provider 导入、切换或恢复。
- 已确认的长期文档目标是更新 `docs/wiki/protocols/acp.md`、`docs/wiki/architecture/server-runtime.md` 和 `docs/security.md`；spec 批准后再同步。

## 架构

```text
App agent choice
      │  agentType = cc-glm / cc-kimi
      ▼
Registry ── session.* ──► owning Hub
                              │
                              ▼
                    Hub-scoped ACPFactory
                              │ provider-specific env
                              ▼
                    claude-agent-acp (owned)
                              │ Claude Agent SDK
                    ┌─────────┴─────────┐
                    ▼                   ▼
            Z.AI Anthropic API   Kimi Code API
```

### Hub 配置与 Factory

`shared.AppConfig` 增加严格解码的 `APIKeys` 配置：

```json
{
  "apiKeys": {
    "kimi": "...",
    "zai": "..."
  }
}
```

Factory 从进程级全局探测改为 Hub 级实例。Hub 使用同一个实例完成 provider 注册、项目 `agents` 上报和各 `client.Client` 的 Session 创建，确保每个 Hub 只使用自己的配置与 Key。现有内置 provider 的探测和优先级保持不变；`cc-glm`、`cc-kimi` 不成为默认首选 agent。

### Claude-compatible Provider

新增运行时 provider 类型，复用既有 binary 解析和 owned ACP process 链路。`Launch()` 只返回 executable、固定参数和进程环境；不得把 Key放入参数、错误、provider 名称或日志。

`cc-kimi` 至少注入：

```text
CLAUDE_CONFIG_DIR=<stateDir>/.data/cc-kimi
ANTHROPIC_BASE_URL=https://api.kimi.com/coding/
ANTHROPIC_API_KEY=<apiKeys.kimi>
ANTHROPIC_MODEL=k3[1m]
ANTHROPIC_DEFAULT_FABLE_MODEL=k3[1m]
ANTHROPIC_DEFAULT_OPUS_MODEL=k3[1m]
ANTHROPIC_DEFAULT_SONNET_MODEL=k3[1m]
ANTHROPIC_DEFAULT_HAIKU_MODEL=k3[1m]
CLAUDE_CODE_SUBAGENT_MODEL=k3[1m]
CLAUDE_CODE_EFFORT_LEVEL=high
CLAUDE_CODE_AUTO_COMPACT_WINDOW=1048576
CLAUDE_CODE_MAX_CONTEXT_TOKENS=1048576
```

`cc-glm` 至少注入：

```text
CLAUDE_CONFIG_DIR=<stateDir>/.data/cc-glm
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
ANTHROPIC_AUTH_TOKEN=<apiKeys.zai>
ANTHROPIC_MODEL=glm-5.2[1m]
ANTHROPIC_DEFAULT_FABLE_MODEL=glm-5.2[1m]
ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.2[1m]
ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.2[1m]
ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-4.5-air
CLAUDE_CODE_SUBAGENT_MODEL=glm-5.2[1m]
CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000
CLAUDE_CODE_MAX_CONTEXT_TOKENS=1000000
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
API_TIMEOUT_MS=3000000
```

每个 provider 还通过 `CLAUDE_MODEL_CONFIG` 注入已确认的 `availableModels` 白名单。ACP 返回的 model `configOption` 继续走 WheelMaker 现有通用 Session 配置路径，切换模型时使用 ACP `session/set_config_option`，不新增 provider 私有前端协议。

### Session 与恢复

两个 provider 沿用 `NewOwnedProviderConn`：每个 Active WheelMaker Session 独占一个 `claude-agent-acp` 进程。Session 持久化继续使用 agent ID 作为恢复边界。Claude recovery source 参数化为 agent ID 和 projects 路径：

```text
claude   → ~/.claude/projects
cc-glm   → <stateDir>/.data/cc-glm/projects
cc-kimi  → <stateDir>/.data/cc-kimi/projects
```

Resume Session 只扫描当前所选 agent 的目录。Hub 重启关闭运行中的 ACP 进程；WheelMaker 恢复 Session 时以持久化 agent ID 重新启动对应 provider，并用原上游 Session ID 执行 load。

### App 展示

Hub 与 Registry 继续交换平铺的 agent ID 列表，协议不增加分组结构。App 把可用列表投影为展示树：Claude 主项直接选择 `claude`，相邻展开按钮只控制 `cc-glm`、`cc-kimi` 子项。子项是否出现严格取决于 `project.agents`，不根据前端本地 Key 状态猜测。

## 流程

1. Hub 启动，严格读取本地 `config.json`，构建 Hub-scoped Factory。
2. Factory 先探测既有 providers，再根据 `claude-agent-acp` 和每个 Key 的存在性条件注册 `cc-glm`、`cc-kimi`。
3. Hub 把平铺的可用 agent 列表上报 Registry；App 将 Claude 相关项渲染成主项加展开子项。
4. 用户选择子项后，Session 使用对应 agent ID 创建 owned ACP process；provider 把 endpoint、Key、模型和隔离目录放入子进程环境。
5. WheelMaker 与 adapter 完成 ACP `initialize` 和 `session/new`/`session/load`；adapter 再通过 Claude Agent SDK 请求指定上游。
6. 流式回复、工具调用、权限请求、模型切换和取消继续走现有 ACP 通用链路。
7. Session suspend/restore 保留 agent ID 和上游 Session ID，只访问对应隔离目录。

## 验收标准

- `config.json` 接受可选 `apiKeys.kimi`、`apiKeys.zai`，拒绝未知字段，示例配置只包含空值或无凭据示例。
- 缺少 `claude-agent-acp` 时两个新 agent 都不注册；只配置一个 Key 时只注册对应 agent；两个 Key 都配置时注册两个 agent。
- Key 修改只在 Hub 重启后生效；不存在运行时配置监听器。
- `cc-glm`、`cc-kimi` 启动同一个 `claude-agent-acp` binary，但具有正确且互不污染的 endpoint、auth 变量、模型和 `CLAUDE_CONFIG_DIR`。
- Key 不出现在 argv、Hub/ACP 日志、Registry project snapshot、Session 存储、错误信息或 Web state。
- 两个 agent 的 model option 只包含其官方白名单和 Claude ACP 无法移除的 `Default`；新 Session 默认分别使用 `glm-5.2[1m]`、`k3[1m]`。
- 选择没有套餐权益的 Kimi 模型时，保留上游错误，不自动静默切换到其他模型。
- Claude 主项可直接创建/恢复原生 Claude Session；独立展开按钮只展示当前 Hub 实际上报的 GLM、Kimi 子项。
- 桌面端与移动端、New Session 与 Resume Session 的分组和选择行为一致；Session 标签显示 `CC · GLM`、`CC · Kimi`。
- 三个 Claude-family agent 的历史扫描路径、Session load 和持久化 agent ID 相互隔离；不能从一个 provider 的 Resume 入口看到另一个 provider 的历史。
- 现有 `claude`、原生 `kimi` 和其他 provider 的注册、默认优先级、模型配置与恢复行为不回归。

### 测试

- Go 单元测试覆盖配置严格解析、Key 字段、provider env、binary/Key 可用性组合、Hub-scoped Factory 注入、provider 名称解析和稳定排序。
- Go 单元测试使用假 Key，断言环境变量精确值，同时断言错误和脱敏输出不包含假 Key。
- Go 单元测试覆盖 Claude recovery source 的三个隔离 projects 路径、agent ID 投影和跨目录不可见。
- Web 单元测试覆盖 agent 展示树、Claude 主按钮与展开按钮的独立点击、缺少一个子 agent、桌面/移动和 New/Resume 四种入口、Session 标签映射。
- 运行相关 Go package tests、Web Jest tests、`go test ./...` 和 App 类型检查/构建门禁。
- 不在自动测试中调用真实 Kimi/Z.AI API，不保存真实 Key，不对套餐 entitlement 错误做网络集成测试。

## 范围之外

- 网页设置、Registry secret store、Key 下发、Key 在线校验和配置热加载。
- endpoint、默认模型或模型白名单的用户配置。
- 自动调用上游模型列表接口；自动跟随上游新增或下线模型。
- 跨 Claude/GLM/Kimi 的 Session 导入、上下文迁移或共享用户级 `~/.claude` 配置。
- 替换或移除现有原生 `kimi` ACP provider。
- 修改 `claude-agent-acp`、Claude Agent SDK 或 Kimi/Z.AI 上游实现。
