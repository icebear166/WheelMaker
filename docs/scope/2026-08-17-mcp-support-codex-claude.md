# MCP 支持：Codex 与 Claude 系列

> 状态：已完成 scope，等待实现批准
>
> 日期：2026-08-17
>
> 本文只定义产品范围、行为和实现约束，不包含代码实现。

## 1. 背景

Hub 菜单已经预留 MCP 入口，但当前只显示固定数量 `0` 和本地空状态。服务端的 ACP DTO 已经能够表达 MCP server，Hub client 仍通过 `emptyMCPServers()` 发送空列表，Codex App Server 适配层也会拒绝非空 `MCPServers`。

本次目标是由 WheelMaker 统一管理 Hub 级 MCP 配置，首批让 Codex 和 Claude 系列能够使用本地 STDIO 以及远程 Streamable HTTP MCP server，并覆盖当前真实使用的 Neo4j MCP。

## 2. 已确认决策

| 主题 | 决策 |
| --- | --- |
| 配置范围 | Hub 全局；不做项目级、会话级覆盖 |
| 首批 Provider | Codex、Claude 系列 |
| 首批传输 | STDIO、Streamable HTTP；内部可预留 SSE，但首批不开放 |
| 凭据 | HubConfig 托管静态 env/header/bearer；前端脱敏；首批不做 OAuth |
| 配置落地 | WheelMaker 统一模型，由 Provider Adapter 分别 materialize |
| 原生配置 | 支持一次性导入 Codex/Claude 原生配置；导入后不持续同步、不修改原文件 |
| 生效时机 | 新会话或新建运行时生效；已有运行时保持不变；提供显式重启入口 |
| 故障策略 | 单个 server 失败不阻断聊天和其他 MCP |
| 状态反馈 | 展示运行时状态，不启动独立测试进程 |
| 工具权限 | 沿用 Codex/Claude 原生权限机制；首批不做工具级白名单 |

## 3. 用户可见范围

### 3.1 MCP 面板

Hub 菜单的 MCP 入口从空状态变为配置面板：

- 显示已配置的 MCP server 列表和启用数量。
- 支持新增、编辑、删除、启用/禁用。
- 支持一次性导入 Codex/Claude 原生配置，并在写入前展示导入预览和冲突。
- 每个 server 显示名称、传输类型、启用状态和最近运行状态。
- 不提供独立“测试连接”进程；状态来自真实 Agent runtime。
- 配置保存成功后提示“对新会话生效”；已有会话不被打断。
- 提供显式重启相关运行时的入口，但重启行为必须是用户主动触发。

MCP 数量应统计已配置的 server；禁用 server 仍保留在列表中并显示禁用状态。删除是显式操作，不能因为一次导入或连接失败自动删除配置。

### 3.2 配置表单

统一表单根据传输类型显示字段：

- 公共字段：`name`、`enabled`。
- STDIO：`command`、`args`、可选 `cwd`、`env`。
- Streamable HTTP：`url`、`headers`。
- Header/env 的单个值可以标记为 secret；secret 保存后只显示“已配置”，不回显原文。

表单必须支持保留未修改的 secret，以及显式清除 secret。普通字段可以回显，secret 不得进入前端快照、错误提示和普通日志。

## 4. 统一内部模型

HubConfig 增加独立的 MCP server 配置集合。建议使用稳定的内部 ID，名称在单个 Hub 内唯一；名称是展示名和 Provider materialization 的 MCP server name。

逻辑模型如下，实际 JSON 字段可以按现有 `hubconfig.Store` 风格落地：

```text
MCPServerConfig {
  id: string
  name: string
  enabled: bool
  transport: "stdio" | "http"

  command?: string
  args?: []string
  cwd?: string
  env?: map[string]ConfigValue

  url?: string
  headers?: map[string]ConfigValue

  createdAt: timestamp
  updatedAt: timestamp
  importedFrom?: "codex" | "claude"
}

ConfigValue {
  value: string
  secret: bool
}
```

约束：

- STDIO 必须有非空 `command`；HTTP 必须有合法的 `url`。
- STDIO 的 `command`、`args`、`cwd` 按进程参数处理，不经 shell 拼接或解释。
- 一个 server 只能选择一种传输类型；无关字段保存前清除或拒绝。
- `enabled=false` 的 server 不进入新 runtime 的 materialized 集合。
- 暂不提供 `required`、tool allow/deny、OAuth、SSE 等字段。
- 继续遵循 HubConfig 当前的配置大小和 secret 大小限制；超限时拒绝保存并返回可理解的错误。

HubConfig 的序列化快照只包含非敏感字段和 secret 的 configured/updatedAt 标记。运行状态不能写入持久化配置，应归入 HubState 或等价的运行态 section。

## 5. 配置 API 与状态 API

### 5.1 HubConfig

沿用现有 `hub.config.get` / `hub.config.update`，扩展 MCP section，不修改 Registry 协议版本 2.7。

建议动作：

- `add`：新增 server。
- `update`：修改普通字段或显式 set/clear secret 字段。
- `delete`：删除指定 server。
- `enable` / `disable`：切换启用状态。
- `import`：从受支持的原生配置源生成导入预览，确认后写入 HubConfig。

更新和导入必须经过后端校验；前端不能把未经校验的完整 MCP JSON 直接当作可执行配置保存。

### 5.2 HubState

运行状态由 Provider Adapter 上报并通过 HubState 暴露，至少支持：

- `disabled`
- `not_started`
- `starting`
- `connected`
- `failed`

状态至少包含 server ID、当前状态、最近错误摘要和更新时间。错误摘要必须经过敏感值清理，不能回显 password、token、Authorization header 或完整带凭据 URL。

没有活跃 runtime 时显示 `not_started`；禁用配置优先显示 `disabled`。失败只影响对应 server，不改变会话整体可用性。

## 6. 原生配置一次性导入

导入是显式、一次性的复制操作，不建立双向同步。

### 6.1 Codex

读取用户 Codex 配置中的 `mcp_servers.<name>` 条目，支持映射：

- local/STDIO command、args、cwd、env。
- Streamable HTTP URL、headers、Bearer 相关静态字段。
- 可识别 enabled/disabled 状态并转换为 HubConfig 的 `enabled`。

当前 Neo4j 配置应能导入为：

- STDIO command：用户本机 Neo4j venv 中的 `python.exe`。
- args：`-m neo4j_mcp_server`。
- env：`NEO4J_URI`、`NEO4J_USERNAME`、`NEO4J_DATABASE`、只读/遥测等普通变量，以及脱敏的 `NEO4J_PASSWORD`。

导入不能假设 command 是 `npx`；必须支持任意可执行文件路径和参数数组。

### 6.2 Claude

读取受支持的 Claude 用户级或项目级 MCP 配置，映射 STDIO 和 Streamable HTTP。SSE、OAuth、工具权限字段在首批中显示为“不支持”或被跳过，并在导入预览中明确说明原因，不能静默转换成错误配置。

同名冲突必须在预览中显式处理，不能自动覆盖已有 HubConfig。导入过程不写回 Claude 文件。

## 7. Provider Adapter 与运行时

### 7.1 共同规则

- Effective MCP 集合只包含当前 Hub 中 enabled 的 server。
- Adapter 负责把统一模型转换成 Provider 能理解的格式，并负责连接状态映射。
- Adapter 不改变用户原生 CLI 配置。
- MCP 连接失败按 server 隔离；Provider 仍可以启动并继续普通聊天。
- 新配置不能影响已经运行的 session/runtime。

### 7.2 Codex

当前 Codex App Server bridge 在 `session/new` 和 `session/load` 中拒绝非空 `MCPServers`，并且 initialize 结果未声明 HTTP MCP 能力。本次实现需要：

- 在 Codex runtime 启动阶段 materialize Hub 级 MCP 配置，而不是将配置变成按 session 的独立集合。
- 通过 runtime-owned 配置/启动覆盖传给 Codex；不得直接修改用户 `~/.codex/config.toml`。
- 在初始化结果中声明首批实际支持的 MCP transport；HTTP 为 true，SSE 保持 false。
- 移除当前“非空 MCP 一律拒绝”的 Phase 1 限制，并保持 ACP wire variant 的严格解码。
- 将 materialized MCP 配置纳入 Codex runtime pool 的 fingerprint。fingerprint 可以是稳定 hash，但不能把 secret 原文放入 key、日志或错误。
- 当前 fingerprint 只覆盖 executable/args；MCP env/header 变化必须能使新配置获得新的 runtime，旧 runtime 继续存活。

### 7.3 Claude 系列

- generic Claude ACP 通过 ACP `session/new` / `session/load` 接收统一 MCP server 列表。
- 已有 Claude-compatible provider 只在其底层 ACP 声明并支持相应 transport 时启用；不支持的 server 单独标为失败/不支持，不阻断聊天。
- 不将 HubConfig 写成 Claude 用户配置文件，也不改变现有 provider 的隔离 settings 目录策略。

### 7.4 Hub client

`emptyMCPServers()` 不再固定返回空集合；由 Session 创建/加载路径取得当前 Hub 的 effective MCP 配置，并传给对应 Agent Adapter。由于产品范围已确定为 Hub 全局，不能接受来自单个 session 的独立 MCP 覆盖。

## 8. 安全与可靠性

- HubConfig 文件继续使用现有安全原子写入和权限策略。
- secret 值只在 Hub 内部用于 materialization；sanitized snapshot、前端 state、错误、debug log、runtime fingerprint 均不得包含原文。
- HTTP Header 名称可展示，Header 值按 secret 标记处理；Bearer token 不应被拼接进可见 URL。
- STDIO 子进程继承最小必要环境，并追加 server 配置 env；不通过 shell 执行 command。
- 单个 MCP server 启动失败时，记录状态和脱敏错误，其他 server 与聊天流程继续。
- 运行中 MCP server 由 Provider/Agent runtime 管理；Hub 不另起一套独立测试进程。

## 9. 验收标准

### 配置与 UI

- MCP 菜单可显示、添加、编辑、启用、禁用、删除 server。
- secret 保存后不可回显；保留、清除和更新语义正确。
- 可从现有 Codex Neo4j 配置预览并一次性导入，导入后不修改原文件。
- 同名导入有明确冲突处理。
- 只保存无效 command、args、URL 或 transport 不匹配字段时，后端拒绝并返回可理解错误。

### Codex/Neo4j

- 新建 Codex runtime 能启动 Neo4j MCP 的 Python command、args 和 env。
- `NEO4J_PASSWORD` 不出现在 HubConfig snapshot、日志、状态错误和 runtime key 中。
- 新配置创建新 fingerprint/runtime；已有 runtime 不被强制重启。
- Codex initialize 声明实际支持的 MCP transport；普通聊天和 MCP tool call 均能继续走现有 ACP lifecycle。

### Claude/HTTP

- Claude STDIO 和 Streamable HTTP server 能按统一模型 materialize。
- HTTP headers/Bearer 静态凭据能工作且保持脱敏。
- 一个 server 失败时，其他 server 和普通会话仍可用。
- 面板能看到未启动、启动中、已连接、失败、已禁用状态。

### 回归

- 既有无 MCP 配置的 Codex、Claude 会话行为不变。
- Registry 协议版本保持 2.7。
- 既有 HubConfig API key、Flicker Bridge 和 DeepSeek 配置行为不变。
- 覆盖 store、import、provider adapter、runtime fingerprint、状态聚合和前端 MCP 面板测试。

## 10. 非目标

- 项目级或 session 级 MCP 配置。
- SSE、WebSocket、OAuth 和 ChatGPT session auth。
- MCP tool 级 allowlist/denylist 或 WheelMaker 自己的二次审批系统。
- 原生 Codex/Claude 配置的持续同步或写回。
- 配置保存时自动中断并重启所有活动 runtime。
- 独立 MCP 测试进程、跨设备同步 MCP secret。

## 11. 相关现状与参考

- Hub 菜单预留：[docs/wiki/frontend-interaction/hub-menu.md](../wiki/frontend-interaction/hub-menu.md)
- Codex 共享 runtime 边界：[docs/scope/2026-07-16-codex-shared-runtime.md](2026-07-16-codex-shared-runtime.md)
- ACP MCP wire model：[server/internal/protocol/acp.go](../../server/internal/protocol/acp.go)
- HubConfig store：[server/internal/hubconfig/store.go](../../server/internal/hubconfig/store.go)
- Codex adapter：[server/internal/hub/agent/codexapp_agent.go](../../server/internal/hub/agent/codexapp_agent.go)
- 官方参考：[Codex MCP](https://developers.openai.com/codex/mcp)、[Claude MCP](https://code.claude.com/docs/en/mcp)、[OpenCode MCP](https://opencode.ai/v2/docs/mcp-servers)
