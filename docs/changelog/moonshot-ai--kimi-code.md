# @moonshot-ai/kimi-code

> WheelMaker 角色：Kimi Code ACP provider；启动命令为 `kimi acp`。
>
> 研究方式：官方 GitHub release、tag 和提交；首次记录 0.29.2–0.36.1。

## 0.36.1

### 修改

- Web assistant reply 时间改为显示消息时间；slash command 和 `@` 文件菜单增加匹配高亮、滚动淡出和可拖动滚动条。
- Web background Bash 面板支持按状态过滤并显示命令/输出；静态资源增加 content-hash 缓存。

### 修复

- `/init` 可随 turn 一起取消；修复自托管 OpenAI-compatible endpoint 的 tool call id 重编号导致的审批卡住和历史混乱。
- 修复 CJK URL、窄终端 banner、MCP OAuth 取消、Windows drive root/UNC watcher 和大 session export。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 使用 `kimi acp`；应覆盖 initialize、第二次 approval/tool call、取消、MCP OAuth、Windows 工作区和 session resume，确认 UI 修复没有改变 ACP 进程输出。

## 0.36.0

### 新增

- 增加实验性全屏 TUI（`KIMI_CODE_TUI_FULL_SCREEN=1`）和 secondary model pool 实验配置。
- 支持 LaTeX 公式渲染，并在 OAuth 后刷新活动 MCP 连接。

### 修改

- Workspace trust prompt 展示 MCP launch target；`@moonshot-ai/kimi-code-sdk` 的 `gatedMcpServers` 改为结构化记录。

### 修复

- 修复 retry 中 Ctrl+C、strict OpenAI-compatible provider 后续请求 400、插件根目录 CHANGELOG 被误识别为 skill，以及不可信 workspace 的 bare executable 风险。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 不默认打开全屏或 secondary-model 实验，但 ACP 的 MCP trust、OAuth refresh、取消和 provider error 变化需回归；Node engine 需要满足 22.19+。

## 0.35.0

### 新增

- `/tasks` 显示后台 subagent 实时进度；Web 图片/视频结果支持全屏预览和缩放。
- 自动识别需要 OAuth 的 MCP server，并改进大 session 的 `/sessions` 分页。

### 修复

- 修复 compaction 后 token count、启动时大 search index 卡顿、Windows 缺少 Git 时静默退出、subagent tool 配置跨 session 泄漏和 steering 时序问题。
- Windows footer git status 改为绝对路径解析，修复一处 binary planting 风险。

### WheelMaker integration

- 结论：需回归验证。
- 重点验证后台 task 通知、MCP OAuth、长会话 compaction、Windows Git 依赖和 `kimi -p` 等非交互退出行为；当前 ACP 参数不变。

## 0.34.0

### 新增

- 长时间 idle 的 session 恢复或再次提交时显示 cache expiry 提醒。
- Windows 支持内置 Kimi Computer Use，并增加 Web session failure card 与 flat session list。

### 修复

- 保留 server restart 前 turn 的 completed/cancelled/failed 状态；修复 session picker、模型 picker、`kimi -p` 等待后台任务和 MCP server 移除后的 live session 行为。
- Windows 修复 UTF-16 文件、Computer Use 安装和含空格路径；恢复失败的 session 可一键 resume。

### WheelMaker integration

- 结论：需回归验证。
- ACP session resume、MCP server 生命周期、后台任务收尾和 Windows 工作区都是 WheelMaker 的接入边界；需验证重启后失败状态、MCP 移除、新 session 生效规则。

## 0.33.0

### 新增

- CLI 的 TUI、`kimi -p`、`kimi acp`、`kimi export` 和 `kimi provider` 默认切换到 agent-core-v2，可用 `KIMI_CODE_LEGACY_FLAG=1` 回退。
- 增加 Computer Use/WebBridge 内置插件、custom provider 和 workspace trust prompt；`/fork` 保持当前 session 继续运行。

### 修复

- 修复 MCP OAuth 动态回调、session 状态恢复、`kimi -p` 后台任务等待、Web UI model picker 和插件安装状态；支持 Windows Computer Use。

### WheelMaker integration

- 结论：需回归验证。
- 这是默认 engine 变化；WheelMaker 必须用真实 `kimi acp` 验证 initialize、session/new、tool call、MCP 启动、cancel 和退出，并确认不需要设置 legacy flag。

## 0.32.0

### 新增

- 增加 TurnStarted/UserPromptQueued/TaskStarted/SessionHeartbeat hooks，并增强 SessionStart/SessionEnd payload。
- models.dev 不可达时使用内置 catalog snapshot；增加 `[token_counting]` 配置和 token strategy。

### 修改

- `loop_control.max_retries_per_step`/`max_steps_per_run` 重命名为 `max_attempts_per_step`/`max_steps_per_turn`；旧环境变量保留但会告警。
- v1 message history 改由 server layer 提供，`/api/v1` contract 保持不变；移除旧 snapshot reader/timeout/cache 环境变量。

### 修复

- 修复 OpenAI-compatible tool call id 含冒号、context window 显示为 0 和超大 compaction 重试问题。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 启动 `kimi acp` 时需检查 config 旧键、env 旧键、hook event、token usage 和 MCP/API v1 兼容；如果部署依赖旧 loop/snapshot 配置，应在升级前迁移。

## 0.31.1

### 修复

- 修复 kimi web 首次建立 session 时模型 catalog 短暂为空、Esc 中断丢失 partial output、代码块行号和 TUI 重绘。
- 修复新 session 的 `@` 文件 mention、thinking level、权限颜色和 markdown renderer 布局。

### WheelMaker integration

- 结论：需回归验证。
- 重点是 provider catalog 初始化、取消后续写入和首个 prompt 的模型/effort 状态；`kimi acp` 命令和 npm binary 未变化。

## 0.31.0

### 新增

- 插件可贡献 custom agents、agent system prompt、Markdown-defined custom agents，并增加 `/secondary_model`。

### 修复

- 修复 request headers、TaskOutput 阻塞、session picker 缺失和缓存 session metadata；TaskOutput 改为立即返回快照。

### WheelMaker integration

- 结论：需回归验证。
- ACP tool progress 和后台任务通知依赖 TaskOutput 行为；验证 background task、custom agent/skill 加载、headers 透传和新 session picker。

## 0.30.0

### 新增

- 增加 `[status_line]` 可配置 footer status line。

### 修复

- 重复无效工具调用达到阈值后停止，额度耗尽快速失败，官方插件显示 quota/update 提示，并移除内置 server file upload 50 MB 限制。
- 修复 Web code block 行号和其他 UI 问题。

### WheelMaker integration

- 结论：需回归验证。
- ACP 侧重点是无效工具调用终止、额度错误返回和插件/后台任务收尾；没有 binary 或启动参数变化。

## 0.29.2

### 新增

- experimental engine 将 agent/session runtime state 放入对应 scope container，并支持 deferred user-tool schema。

### 修复

- 修复 goal 在 turn step limit 后继续运行、goal 运行期间消息 steering、HTTP 复制文本和 `/undo` 恢复 conversation/plan/task 状态。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 的 ACP session/steering/plan 状态受影响；首次记录版本需验证 `kimi acp` 的 goal、undo、steer、tool schema 和 session 生命周期。
