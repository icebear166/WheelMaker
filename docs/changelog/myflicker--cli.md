# @myflicker/cli

> WheelMaker 角色：MyFlicker ACP provider 和 V2 Wanqing bridge；启动入口为 `myflicker acp`，V2 使用包内 `dist/cli.mjs`。
>
> 研究方式：WheelMaker 指定的私有 registry `https://npm.corp.kuaishou.com` 的 npm tarball 与随包 `CHANGELOG.md`；首次记录 0.3.7–0.3.16。
>
> 接入基线：当前 WheelMaker V2 bridge 的 bundle contract 只登记 0.3.16；历史版本即使能安装，也不能直接作为 V2 bridge runtime。

## 0.3.16

### 新增

- `AskUserQuestion` 增加 `instructions` 字段；增加 GLM-5.3 和 DeepSeek-V4-Pro-0813 模型，并修复 DeepSeek-V4-Flash 别名。

### 修改

- 语音输入默认关闭，改用 `/voice` 或设置开启；移除 Ctrl+X 切换语音模式，并增加产品/版本可观测字段。
- gpt-5.2 的 context 限制为 400k、output 限制为 64k。

### WheelMaker integration

- 结论：需回归验证。
- 这是当前 V2 bundle contract 唯一支持的版本；升级后必须运行 V2 probe/self-test、模型目录、`myflicker` binary、`myflicker acp` 和 `/v1/messages` 代理检查。语音默认值不应改变 ACP bridge 的认证和模型请求。

## 0.3.15

### 新增

- 增加 `/plan`，思考预览默认开启；SDK 导出更多 Tool/Config/HookResult 类型；工具支持自定义 UI renderer 和 `modelMiddleware` hook。

### 修改

- ACP 恢复已有 session 时不再回放全部历史；ESC 中断保留已生成内容；Bedrock 无权限模型错误自动重试；Windows 非 ASCII 命令输出修复。

### 修复

- 修复流式结束后供应商追加错误导致的误重试、嵌套 subagent 显式工具启动和 thinking signature 恢复。

### WheelMaker integration

- 结论：暂不建议升级。
- 该版本不在 WheelMaker V2 `v2BundleContracts` 白名单中；即使 ACP/bridge 行为看起来兼容，probe 会拒绝它。需要使用 V2 时升级到 0.3.16，并重新执行 native capture 和模型目录回归。

## 0.3.14

### 新增

- 增加 `/pkg` 包插件、`/agents` subagent 管理、sdk-server JSON-RPC over stdio 和 ACP 动态 MCP 保留。
- 增加 claude-opus-5、DeepSeek V4 Flash 0731、Qwen 3.8 Max、Gemini 3.6 Flash 等模型支持。

### 修改

- 自动识别 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`，并改进大文件 diff、危险路径删除检测和插件市场恢复。

### 修复

- 修复 subagent 部分结果丢失、Windows Git Bash 路径、vendor binary 权限、过载重试和权限绕过问题。

### WheelMaker integration

- 结论：暂不建议升级。
- 0.3.14 不在当前 V2 bundle contract；历史 ACP/代理行为不能替代 0.3.16 的 native reference capture。私有 registry、`myflicker` binary 和 V2 bridge 均应以 0.3.16 为准。

## 0.3.13

### 新增

- ACP 命令支持图片资源链接；会话 JSONL 持久化入口点和版本元数据；增加 `--agent` 参数。

### 修改

- RTK token 优化默认关闭；增强 context overflow 识别和发送前检查；Windows shell 类型会进入模型上下文。

### 修复

- 修复 tool_use 历史链接、subagent shell session 注册、后台任务 loading 和插件 auto-ensure 指纹。

### WheelMaker integration

- 结论：暂不建议升级。
- V2 bridge 只接受 0.3.16；本版本的 ACP 图片/元数据变化不应直接带入 V2。若验证历史 CLI，需额外覆盖 JSONL resume、context overflow 和 subagent。

## 0.3.12

### 新增

- ACP 增加 Default/Plan/Brainstorm/AutoEdit/Auto 工作模式、context usage 展示和 `/branch`。
- 增加 `$PLUGIN_ROOT` hook 占位符、文件检查点以及 tokenverse 新模型。

### 修改

- 简化 compaction retry，并修复大 session 历史查看的截断策略。

### 修复

- 修复推理模型多轮 `Item not found`、插件版本检测、压缩后的文件上下文和会话间模型切换。

### WheelMaker integration

- 结论：暂不建议升级。
- 该版本不是 V2 支持版本；不要仅凭 ACP 工作模式或模型能力新增就替换当前 0.3.16。V2 应继续使用私有 registry 发布的受支持 bundle。

## 0.3.11

### 新增

- 增加 Kimi K3 模型、Zed 模型选择/思考等级、子 agent `maxTurns` 和本地插件更新提示。

### 修改

- Claude 工具定义进入 prompt cache；ACP 解析 Zed 添加的文件；插件启动同步和 Hook/Bash 进度显示改进。

### 修复

- 修复 invalid encrypted content 自动重试、plan/rewrite 状态、审批模式溯源和子 agent 进度干扰主界面。

### WheelMaker integration

- 结论：暂不建议升级。
- 当前 V2 bridge 不接受 0.3.11；若只运行原生 CLI/ACP，仍需单独验证 Kimi model catalog、Zed config 和 session resume，不能把历史行为当作 V2 contract。

## 0.3.10

### 新增

- 增加 KAT-Coder-Pro V2.5 和 Codex provider；attachment token 估算更准确。

### WheelMaker integration

- 结论：暂不建议升级。
- 版本不在 V2 bundle contract；Codex provider 也不改变 WheelMaker 当前独立的 `@openai/codex` 跟踪项。V2 部署使用 0.3.16。

## 0.3.9

### 新增

- 增加 `enablePlanMode`、规则文件总开关、remote-skill 命令和更详细的 usage dashboard。

### 修改

- fetch 默认使用 reader；取消交互会话隐含 50 轮上限；长工具结果保留原文。

### 修复

- 修复多工具轮次计数、并行工具状态、插件市场恢复和模型可用状态展示。

### WheelMaker integration

- 结论：暂不建议升级。
- V2 bridge 不支持此版本；这些 plan/skill/工具行为只能作为历史记录，当前安装、V2 probe 和 native bridge 均应回到 0.3.16。

## 0.3.8

### 新增

- 增加运行中消息 steer/queue 配置、workflow 日志和持久化 `add-dir`。

### 修改

- compaction 后恢复文件状态缓存，限制长会话 subagent 进度累积，并改进 MCP 启动参数处理。

### 修复

- 修复 Bash 权限通配绕过、macOS 大小写不敏感路径、插件 staging 清理和 rewind 翻页。

### WheelMaker integration

- 结论：暂不建议升级。
- 该历史版本不满足当前 V2 bridge 的受支持 bundle contract；如需比较 ACP steer/queue 行为，应使用隔离测试，不改变生产私有 registry 版本。

## 0.3.7

### 新增

- 增加 envProxy、workflow 日志、自动 context compact 和可配置历史消息显示数量；增加 Claude/Gemini 模型支持。

### 修改

- 流式思考限制在终端可视行数内，压缩后保留最近用户上下文。

### 修复

- 修复 Transcript 子 agent 日志、Skill 大小写、空多选提交、会话结束状态和图片文件历史重建。

### WheelMaker integration

- 结论：暂不建议升级。
- 版本不在 V2 bridge 支持表；当前 WheelMaker 的 MyFlicker V2 运行时必须以 0.3.16 的 `dist/cli.mjs` contract 和私有 registry 包为准。
