# @openai/codex

> WheelMaker 角色：Codex ACP provider；启动入口为 `codex`。
>
> 研究方式：官方 GitHub release、tag 和提交；首次记录 0.144.1–0.147.0。

## 0.147.0

### 新增

- 支持可移植 Agent Plugins、跨本地/个人/工作区/远程目录的插件搜索。
- 支持持久化并手工排序 conversation sections、增量浏览长 transcript，以及 `--approve-for-me`。
- 支持导入 Cursor skills、同步导入的 Claude/Cursor 会话，并支持 MCP 2026-07-28 的分页发现、多轮请求和非阻塞启动。
- Amazon Bedrock 支持 cached web search 和远程 conversation compaction。

### 修改

- MCP SDK、Ratatui 和 V8 升级。
- 移除已弃用的 `codex exec --full-auto`，改用 `--sandbox workspace-write`。

### 修复

- 加强 secret/bearer token 脱敏、Windows 输入与路径处理、项目信任、managed authentication 和插件隔离。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 使用 `codex` ACP provider；当前 preset 不传 `--full-auto`，但要确认升级后 `codex` 默认启动、MCP 初始化、session resume 和插件/skill 发现仍正常，并覆盖 Windows sandbox 与项目信任提示。

## 0.146.1

### 修复

- 为具备 cyber 能力的模型采用更安全的 automatic-review 默认值，并在终端说明权限变化。

### WheelMaker integration

- 结论：需回归验证。
- 该变化会影响自动审批与安全策略；验证 WheelMaker 透传的权限配置、工具批准和拒绝原因，确认不改变普通 workspace-write 会话的预期行为。

## 0.146.0

### 新增

- 新会话命名、线程 pin、side conversation、分页历史、Agent Plugins、远程 Code Mode 和自定义 provider 的 web search。
- 支持更完整的 MCP 连接刷新、代理配置、skills 发现和 Amazon Bedrock 登录。

### 修复

- 修复代理覆盖、MCP/Apps 连接刷新、Windows sandbox、终端响应和中断/恢复期间的消息与审批状态。

### WheelMaker integration

- 结论：需回归验证。
- ACP provider 的主流程未要求新增启动参数，但 MCP、代理、skills 和 Windows 执行链均有变化；应验证 initialize、MCP auth、prompt、cancel、resume 以及 global npm binary 在重启后的可发现性。

## 0.145.0

### 新增

- 实验性分页 thread history、Cursor/Claude Code 设置和会话导入、Amazon Bedrock 登录、自定义 endpoint、音频输入/输出、多 agent V2 和可点击终端可视化链接。

### 修复

- 改进长会话增量渲染、MCP 启动/认证超时、Windows 执行与 sandbox、安装元数据解析和安全审批。

### 修改

- GPT-5.4 的内置选择迁移到 GPT-5.6 变体，并更新内置 ripgrep。

### WheelMaker integration

- 结论：需回归验证。
- 重点是长会话分页/恢复、MCP 启动超时、Windows hidden helper console 和 npm 安装后的 bundled runtime；验证 WheelMaker session recovery 不依赖旧 transcript 读取方式。

## 0.144.6

### 修改

- 刷新 GPT-5.6 Sol、Terra、Luna 的内置 instructions，并将对应 context window 修正为 272,000 tokens。

### WheelMaker integration

- 结论：需回归验证。
- 若 WheelMaker 使用 Codex 的模型目录或 context metadata，需检查模型展示、上下文上限和 compaction 判断；没有启动命令变更。

## 0.144.5

### 修复

- 加强危险命令检测，覆盖更多强制 `rm` 形式，并改善拒绝原因。

### WheelMaker integration

- 结论：需回归验证。
- 复测 WheelMaker 的工具审批、拒绝事件和 Windows/Unix shell 命令路径；不应把上游更严格的拒绝误报为 ACP transport failure。

## 0.144.4

### 修改

- 版本发布没有用户可见的合并变更。

### WheelMaker integration

- 结论：无需动作。
- 保持现有 `codex` ACP 启动和安装 smoke test 即可。

## 0.144.3

### 修改

- 版本发布仅更新版本号，没有合并用户可见变更。

### WheelMaker integration

- 结论：无需动作。
- 不需要调整 WheelMaker provider 或 npm 参数。

## 0.144.2

### 修复

- 恢复此前的 Guardian auto-review policy、请求格式和工具行为，回滚一次 prompting regression。

### WheelMaker integration

- 结论：需回归验证。
- 复测自动 review、工具审批和拒绝回传；WheelMaker 不应假设 Guardian 的提示文案或请求字段保持上一 patch 的形态。

## 0.144.1

### 修复

- 修复 GitHub release metadata 紧凑或乱序时 standalone install 失败。
- macOS 安装暴露 code-mode host，并在 companion host 不可用时回退到内置 runtime。

### WheelMaker integration

- 结论：需回归验证。
- 该版本涉及安装器和平台 runtime；升级后应验证 npm optional dependency、`codex` binary、ACP 启动和 code-mode fallback，尤其是 macOS 与 Windows。
