> 摘要：本页维护 WheelMaker Hub 全局 MCP 配置、Codex/Claude 适配、导入预览、secret 处理和运行态边界。

# MCP 管理

来源：[Codex Claude MCP scope](../../scope/2026-08-17-mcp-support-codex-claude.md)。

## 配置模型

MCP 是 Hub 级全局配置，持久化在 Hub 的 `db/hub-config.json`，不写回 Codex 或 Claude 的原生配置文件。首批支持：

- STDIO：command、args、cwd、environment variables；
- Streamable HTTP：URL、HTTP headers；
- 静态 env/header 值和受支持的环境变量引用，可逐项标记为 secret；
- Hub 菜单中的新增、编辑、删除、启用/禁用和配置数量统计。

HubConfig 对前端只返回非 secret 普通值与 secret 的 configured/更新时间元数据。编辑已配置 secret 时输入框保持空白，空白提交会保留原值；显式移除才清除该项。

## 导入

MCP detail 支持一次性导入 Codex TOML 和 Claude JSON。文件先发送到 Hub 做解析预览，预览只返回脱敏服务器摘要、冲突名称和不支持项；同名冲突或首批不支持的 SSE/WebSocket 条目不能直接确认。导入成功后条目标记 `importedFrom`，不会反向修改原生文件，也不建立 live sync。

当前 Neo4j MCP 配置可直接导入：`python.exe` / `-m neo4j_mcp_server`、工作目录和 `NEO4J_*` 环境变量会被保留，密码只作为 Hub 内部 secret 保存。Codex 的 `bearer_token_env_var`、`env_vars` 和 `env_http_headers` 会保留环境变量引用；Claude 中完整值形如 `${VAR}` 的 env/header 引用也会保留。无法用统一模型表达的复合模板（例如 `Bearer ${TOKEN}`）以及首批不支持的 OAuth、工具权限、超时等字段会在预览中明确列为 issue，不会静默丢弃其语义。批量导入采用一次性写入，任一条目校验失败时不会留下部分结果。

## Runtime 与 provider

启用项才进入 ACP `session/new`、`session/load` 和 fork/load 路径；禁用项只保留在配置列表。Hub 会依据 Agent initialize 返回的 MCP capability 过滤不支持的 HTTP/SSE transport，并将其标为 failed；带 MCP 的 `session/new` / `session/load` 尝试发生任意 provider 错误时，会用非 nil 空 MCP 数组重试；运行时读取 MCP 配置失败也会记录 warning 并按空 MCP 集合继续。因此过滤、配置读取或单项 MCP 启动失败都不阻塞会话创建、加载或普通聊天。普通 Claude ACP provider 收到过滤后的规范化 MCP 参数；Codex 在新 app-server launch 时 materialize 原生 `mcp_servers.*` 覆盖，并把 secret 放在子进程环境中。MCP 配置纳入 Codex launch fingerprint，避免复用错误的旧 runtime。

保存配置会重建未来 runtime 的 provider creator，但不会强制改写已存在的 Session。Hub 菜单提供显式 Restart 入口，使运行中的托管 runtime 重新加载最新 MCP 配置。

`mcp` HubState section 是短暂运行态，不属于 HubConfig。每个服务器可处于 `disabled`、`not_started`、`starting`、`connected` 或 `failed`；`connected` 表示 provider 接受了本次 runtime/session 配置，不是 Hub 自己执行的独立健康探针。单项失败是非阻塞状态，错误发布前会脱敏 credential-bearing URL、Bearer token、password/token assignment 和已知 secret。

Codex 的 materialization 使用原生 `config.toml` 的 `-c` 分层覆盖语义：用户原生配置不会被清空，未被 Hub materialize 的原生 MCP 条目继续有效；同名配置按 Codex 的原生合并/覆盖规则处理。Hub 不回写 `config.toml`，也不把“Hub 配置集合”解释成对原生配置的独占替换。

首批不包含 SSE、WebSocket、OAuth 动态授权、原生配置 live sync 或 Hub 级工具 allowlist；工具权限继续由 provider 原生 ACP/CLI 处理。
