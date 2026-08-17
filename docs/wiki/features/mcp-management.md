> 摘要：本页维护 WheelMaker Hub 全局 MCP 配置、Codex/Claude 适配、导入预览、secret 处理和运行态边界。

# MCP 管理

来源：[Codex Claude MCP scope](../../scope/2026-08-17-mcp-support-codex-claude.md)。

## 配置模型

MCP 是 Hub 级全局配置，持久化在 Hub 的 `db/hub-config.json`，不写回 Codex 或 Claude 的原生配置文件。首批支持：

- STDIO：command、args、cwd、environment variables；
- Streamable HTTP：URL、HTTP headers；
- 静态 env/header 值，可逐项标记为 secret；
- Hub 菜单中的新增、编辑、删除、启用/禁用和配置数量统计。

HubConfig 对前端只返回非 secret 普通值与 secret 的 configured/更新时间元数据。编辑已配置 secret 时输入框保持空白，空白提交会保留原值；显式移除才清除该项。

## 导入

MCP detail 支持一次性导入 Codex TOML 和 Claude JSON。文件先发送到 Hub 做解析预览，预览只返回脱敏服务器摘要、冲突名称和不支持项；同名冲突或首批不支持的 SSE/WebSocket 条目不能直接确认。导入成功后条目标记 `importedFrom`，不会反向修改原生文件，也不建立 live sync。

当前 Neo4j MCP 配置可直接导入：`python.exe` / `-m neo4j_mcp_server`、工作目录和 `NEO4J_*` 环境变量会被保留，密码只作为 Hub 内部 secret 保存。

## Runtime 与 provider

启用项才进入 ACP `session/new`、`session/load` 和 fork/load 路径；禁用项只保留在配置列表。普通 Claude ACP provider 直接收到规范化的 STDIO/HTTP MCP 参数；Codex 在新 app-server launch 时 materialize 原生 `mcp_servers.*` 覆盖，并把 secret 放在子进程环境中。MCP 配置纳入 Codex launch fingerprint，避免复用错误的旧 runtime。

保存配置会重建未来 runtime 的 provider creator，但不会强制改写已存在的 Session。Hub 菜单提供显式 Restart 入口，使运行中的托管 runtime 重新加载最新 MCP 配置。

`mcp` HubState section 是短暂运行态，不属于 HubConfig。每个服务器可处于 `disabled`、`not_started`、`starting`、`connected` 或 `failed`；单项失败是非阻塞状态，错误发布前会脱敏 credential-bearing URL、Bearer token、password/token assignment 和已知 secret。

首批不包含 SSE、WebSocket、OAuth 动态授权、原生配置 live sync 或 Hub 级工具 allowlist；工具权限继续由 provider 原生 ACP/CLI 处理。
