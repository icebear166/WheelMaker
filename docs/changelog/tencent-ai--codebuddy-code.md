# @tencent-ai/codebuddy-code

> WheelMaker 角色：CodeBuddy ACP provider；启动命令为 `codebuddy --acp`。
>
> 研究方式：npm tarball 中的官方 `CHANGELOG.md`，并复核 package manifest、入口和运行时 bundle；首次记录 2.130.0–2.137.1。

## 2.137.1

### 修复

- 修复上下文压缩成功后长任务停在「思考中」而无法续跑。
- Shell 统一关闭交互式分页器和 `less` 历史，避免 `git diff` 等命令等待输入。
- 修复 macOS safe-delete 路径绕过程序黑名单，以及纯数字 skill 名导致新会话失败。

### WheelMaker integration

- 结论：需回归验证。
- CodeBuddy 的 ACP 子进程会执行 shell 和加载 skills；需覆盖长会话压缩恢复、`git diff`、危险命令拦截和数字 skill。包入口仍是 `codebuddy`，不需要调整安装命令。

## 2.137.0

### 新增

- 增加 `--brief`/`CODEBUDDY_BRIEF` 和 `SendUserMessage` 工具，并支持通过 `CODEBUDDY_CUSTOM_HEADERS` 为内置平台工具请求增加自定义 headers。

### 修改

- 内置插件市场改为 ZIP 分发，并增加 prompt 变量缓存日志。

### 修复

- 上下文超限会自动压缩并重试，压缩续跑不再短暂显示假完成；prompt-vars 文件成功读取后使用内存快照；sandbox 未就绪时子 Agent/Bash 不再永久等待。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 当前 ACP 启动不传 `--brief`，因此不应假设 `SendUserMessage` 自动可见；需验证默认 ACP stream、上下文压缩、sandbox readiness 和插件市场初始化。

## 2.136.0

### 新增

- 增加 `autoCompactWindow`、`--autocompact` 和 `/autocompact`，可控制自动压缩窗口。
- stdio 常驻 stream-json 的 `result` 增加 `modelUsage` 和上下文用量元数据。

### 修改

- 命令解析器改为纯 TypeScript，减少一次性会话的启动内存开销。

### 修复

- 修复 LSP/ripgrep 孤儿进程、Windows `SIGBREAK` 清理、MCP 动态连接重复枚举、stream-json 工具参数首片丢失和 Windows Git 补全。

### WheelMaker integration

- 结论：需回归验证。
- `codebuddy --acp` 的 stream-json/ACP 输出和子进程清理是直接接入边界；需验证 `modelUsage` 不破坏事件解码、取消能回收子进程，以及 `/autocompact` 默认值不覆盖 WheelMaker 配置。

## 2.135.0

### 新增

- 支持会话上下文窗口档位，并改进 Web UI 移动端历史和上下文继承分页。

### 修改

- 编辑器保存/自动保存、冷启动缓存和 Windows 子进程窗口行为改进。

### 修复

- 修复 ACP prepare 阶段 cancel 卡在 `cancelling`、自定义 Agent 模型继承、Web UI 控制操作排队、Windows workspace 历史和 ACP 控制通道稳定性问题。

### WheelMaker integration

- 结论：需回归验证。
- 重点测试 ACP cancel 后能否继续发送 prompt、模型切换后的 context threshold、Web UI/stdio 多客户端控制事件和 Windows 全局 binary 启动；入口保持 `codebuddy --acp`。

## 2.134.0

### 新增

- 增加恶意域名防护、托管 sandbox policy、429/5xx/408/409 自适应重试、会话 rewind、Artifact、首轮 MCP 连接状态、`session/steer`、后台会话和 WebSocket Monitor。

### 修改

- `--serve` 默认启用密码认证；`ShareLink`/`ShareLinkUnpublish` 重命名为 `Artifact`/`ArtifactControl`，并补充 stream-json 错误维度。

### 修复

- 修复冷启动、会话切换、消息队列、后台任务通知、压缩、登录、Windows/Linux sandbox、模型请求和 MCP 兼容性问题。

### WheelMaker integration

- 结论：需回归验证。
- ACP 首轮 MCP 状态、`session/steer`、重试与 `errors_info` 可能改变 WheelMaker 的事件映射；`--serve` 认证变化不适用于当前 ACP 启动，但应避免把 ACP 与 serve 模式混测。

## 2.133.1

### 修改

- 修复本地 CLI telemetry 缺少功能模块归属。

### WheelMaker integration

- 结论：无需动作。
- 变化不涉及 binary、ACP 参数或消息结构；保留现有启动检查即可。

## 2.133.0

### 新增

- 增加生成前 429/5xx/408/409 重试、stream-json `errors_info` 和 stdio 首个 prompt/request latency 观测。

### 修改

- 优化 stdio initialize/resume、MCP 首连、遥测归属和 MCP 连接诊断。

### 修复

- 修复畸形工具参数、`/model` 覆盖启动参数、TUI 字符集、Windows 闪窗、私有 CA、产品 endpoint 和启动取消。

### WheelMaker integration

- 结论：需回归验证。
- 这是 stream-json/ACP 接入敏感版本；需验证 error event 解码、initialize/resume 延迟、MCP 私有 CA、取消以及模型切换，不能只验证 CLI 能启动。

## 2.132.0

### 新增

- 增补 OTEL `gen_ai` 语义映射字段；`ShareLink` 支持 Markdown 和原地更新。

### 修复

- 企业 API key/custom endpoint 登录后恢复企业模型列表，兼容专家插件资源依赖，并修复本地助理卡住、Windows Bash 路径和长命令 sandbox。

### WheelMaker integration

- 结论：需回归验证。
- 若 WheelMaker 使用企业 endpoint 或自定义模型，需验证模型列表和 ACP model options；Windows 下需验证 Bash 路径和长命令，普通 session/安装入口不需要改动。

## 2.131.0

### 新增

- 增加 `skillOverrides`、`/skills` 可视化编辑、可变间隔 `/loop` 和将已有 linked worktree 附加给 `EnterWorktree`。

### 修复

- 修复同一流式事件工具调用丢失、切换模型后压缩阈值错误、子 Agent 模型继承、无参工具审批、预热认证生命周期和 hook 兼容问题。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 会使用 `.codebuddy/skills`；需验证 skillOverrides 不隐藏必须 skill，且 ACP stream 中思考与 tool call 同帧时不会丢失。linked worktree 变化不应改变 WheelMaker 自己的 worktree 管理。

## 2.130.0

### 新增

- 增加 Agent View、后台会话 attach、`/background`/`/fork-bg`、后台 worktree 隔离和会话 PR 关联。

### 修复

- Write/MultiEdit 覆盖已有文件前增加 Read 和并发修改保护，并修复预热进程的身份归属。

### WheelMaker integration

- 结论：需回归验证。
- CodeBuddy ACP 仍由 WheelMaker 以单个 `codebuddy --acp` 子进程启动；需验证 Agent View 不劫持 stdio ACP、后台 worktree 不改变工作目录，以及 global npm update 后 binary 可被 PATH 重新发现。
