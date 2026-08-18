# @github/copilot

> WheelMaker 角色：Copilot ACP provider；启动命令为 `copilot --acp --stdio`。
>
> 研究方式：官方 GitHub release；首次记录 1.0.71–1.0.80。

## 1.0.80

### 修改

- 更新模型配置。

### WheelMaker integration

- 结论：需回归验证。
- 当前没有记录到启动参数变化；仍需验证 `--acp --stdio` initialize、模型列表、prompt 流和 session resume，确认新模型配置不会让 WheelMaker 选择到不可用模型。

## 1.0.79

### 新增

- 支持 enterprise allow-auto-only policy、`worktreeBaseRef`、Agent Plugins extensions、kimi-k3、`--plan` 与 `--mode autopilot` 组合，以及并发 Sessions。
- sandbox 支持 Windows Dev Drive、更多 HTTPS credential host 和网络访问恢复；新增有效 sandbox policy 展示。

### 修改

- sandbox 认证设置从 `sandbox.gitAuth`/`sandbox.ghAuth` 改为 `sandbox.auth.git`/`sandbox.auth.gh`，旧 key 不迁移。
- `allowDevToolCaches` 重命名为 `allowDevToolAccess`，旧 key 不再读取；prompt pinning 默认关闭，`/model` 默认变为 session-scoped。

### 修复

- 改进 session history 重试、长 transcript 滚动、MCP/sandbox 启动失败反馈和 teleported subagent navigation。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 不生成上述 settings key，但 ACP 会受 sandbox、model scope、MCP 和 session history 影响；必须用干净配置验证初始化、resume、MCP 启动和 `--plan`/autopilot，不要依赖旧 sandbox key 的兼容迁移。

## 1.0.78

### 新增

- 工具耗时展示、first-party plugin 自动更新、实验性 `/new-worktree`、browser OAuth 默认流程、`allowDevToolCaches`、`/permissions` 和 ACP `closeSession`。
- 支持 ACP prompt result/live `usage_update` token usage，以及托管 settings cache fallback。

### 修复

- 改进 sandbox bypass、`/rewind`、MCP OAuth refresh、长 transcript resume、session 切换、hook 和 extension prompt 稳定性。

### WheelMaker integration

- 结论：需回归验证。
- ACP usage/update、closeSession 和 MCP OAuth 是 WheelMaker 直接可见的 transport 行为；覆盖 session 关闭、重新连接、usage 展示、插件加载和无 TTY 的 browser/device login。

## 1.0.77

### 新增

- unconditional autopilot approval、编辑器回答 ask_user、browser OAuth login，并支持 macOS/Windows MDM sandbox policy。
- 允许省略 reasoning effort，由服务端选择默认值。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 的 `copilot --acp --stdio` 不要求新增参数；重点测试无 TTY/headless login、reasoning effort 缺省值、托管 sandbox 和 autopilot 的权限边界。

## 1.0.76

### 新增

- `/plugins` 增加 plugin、instruction、agent、LSP server 和 hook 的 enable/disable 控制，并支持 grok-4.5。

### 修改

- sandbox denied paths 支持相对路径和 symlink 条目；session resume 恢复 autopilot/plan mode；自动下载更新后提示 `/restart`。

### WheelMaker integration

- 结论：需回归验证。
- provider 启动方式不变，但 skill/plugin/LSP/hook 和 sandbox 变化会影响 `.agents/skills` 的加载与工具权限；验证一次新安装和一次重启恢复。

## 1.0.75

### 新增

- 增加 Claude Opus 5 模型支持。

### WheelMaker integration

- 结论：无需动作。
- 仅增加模型配置；保留现有 ACP 启动 smoke test，并确认模型选择不会覆盖 WheelMaker 的用户配置。

## 1.0.74

### 新增

- 支持 Open Plugin Spec v1 manifest、`mcp.json`、Gemini 3.6 Flash 和首次启动 sandbox opt-in。

### 修复

- 改进 IDE 重连、subagent timeline、`/mcp add/edit` 中 `=` 字符保留和远程 session 上传重试。

### WheelMaker integration

- 结论：需回归验证。
- ACP 和 MCP 的重连行为是直接接入边界；测试 `/mcp` 配置、包含 `=` 的 secret、IDE/stdio 重连以及默认 sandbox 选择。

## 1.0.73

### 修复

- 修复 Anthropic subagent 在配置 additional directories 时停止工作的问题。
- 自定义 agent instruction 中的相对链接改为相对于 agent 文件解析。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 会加载项目/用户 skills 和 agent；验证 additional directories、skill 相对链接以及 ACP 启动后的 subagent 访问权限。

## 1.0.72

### 新增

- `agentStop` 连续阻塞达到上限后结束 turn，并增加 `stop_hook_active`；支持 sandbox 内 git/gh authentication。

### 修改

- 生命周期和 subagent hook 使用当前 session directory；切换 sandbox 只重启本地 MCP server；跨仓库切换不继承 command approval。

### WheelMaker integration

- 结论：需回归验证。
- 重点覆盖 hook 阻塞、`/cd` 后工作目录、MCP server 生命周期和 repo 间权限隔离；无 npm 安装或 binary 名称变化。

## 1.0.71

### 新增

- `copilot -p --autopilot` 遵守 `COPILOT_TASK_WAIT_TIMEOUT_SECONDS`；支持 voice device、canvas、插件 marketplace、持久化 sidebar sessions 和更多 MCP/tool 配置。

### 修复

- 改善 LSP sandbox、plan mode workspace mutation 防护、settings 校验、session resume 和后台 git 进程退出。

### WheelMaker integration

- 结论：需回归验证。
- 需验证非交互 `-p` 的超时、ACP session resume、MCP 配置持久化和退出时子进程清理；当前 WheelMaker 的启动参数仍保持 `--acp --stdio`。
