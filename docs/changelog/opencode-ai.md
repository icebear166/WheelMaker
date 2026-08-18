# opencode-ai

> WheelMaker 角色：OpenCode ACP provider；启动命令为 `opencode acp`。
>
> 研究方式：公开仓库 `anomalyco/opencode` 的官方 release/tag；首次记录 1.18.9–1.18.18。

## 1.18.18

### 修复

- 正确为官方 Moonshot/Kimi provider 选择 Kimi system prompt。
- 修复 xAI 模型的 xhigh reasoning effort。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker 的 OpenCode provider 依赖模型发现和 `opencode acp`；需验证 Kimi/xAI 模型选择、reasoning 配置和 ACP initialize，不需要调整 npm binary。

## 1.18.17

### 修复

- session compaction 保留完整的最近 turns，并改善小模型摘要。
- 增加 MERGE Gateway reasoning variants、限制自动重试并加入 jitter，修正 DeepSeek V4 Flash 和 Muse 模型的 provider/system prompt。
- GitHub Copilot 宣布支持 PDF vision 时启用 PDF attachment；桌面端更新中文术语和默认模型选择。

### WheelMaker integration

- 结论：需回归验证。
- compaction、retry 和 provider model mapping 会影响 ACP 长会话；覆盖连续 prompt、压缩恢复、retry 上限和 Kimi/Copilot 模型启动。

## 1.18.16

### 修改

- 忽略未知顶层 config 字段，不再因额外字段导致配置解析失败。
- Home 打开的 project 注册到应用项目列表；桌面项目菜单支持右键。

### 修复

- project picker 不支持搜索时回退到本地目录匹配，并修复 macOS 窗口、中文 token 术语等桌面问题。

### WheelMaker integration

- 结论：无需动作。
- 配置兼容性变宽，未见 `opencode acp` 启动合同变化；保留一次配置加载和 ACP smoke test。

## 1.18.15

### 修改

- message/revert/fork 按真实时间顺序处理，不再依赖 message ID 顺序。
- 重复 compaction 保留较早的 tool-call history；桌面端增加完整 session transcript JSON 导出。

### 修复

- 清理截断文件、blob attachment、session timeline 和 persisted activity time 的排序问题。

### WheelMaker integration

- 结论：需回归验证。
- WheelMaker session recovery 和 ACP transcript 依赖消息顺序；需验证 resume、fork、revert、compaction 后工具结果不重复且顺序稳定。

## 1.18.14

### 修改

- xAI 登录简化为适合 headless/remote 的 device-code 流程。
- ACP usage totals 纳入 cache writes。

### 修复

- 保留 structured mid-stream provider errors、重试更多 transient provider/network errors、等待 ACP queued updates 后再结束 turn。
- remote workspace 不再传 host directory，5xx 日志包含 upstream body。

### WheelMaker integration

- 结论：需回归验证。
- ACP turn 收尾、usage、remote workspace 和错误重试都是接入边界；覆盖 stream 结束、缓存用量、代理错误和非本地工作目录。

## 1.18.13

### 新增

- GitHub pull request review context 增加 PR number 和 URL；桌面端增加 RTL、locale-aware plural 和更多语言支持。

### WheelMaker integration

- 结论：无需动作。
- 变化主要在桌面 UI 与 PR review context；`opencode acp` 的启动和消息协议没有记录到变化。

## 1.18.12

### 修复

- 修复 Azure GPT-5.5+ 在启用 reasoning 时 completion 失败。
- 桌面端修复大图片/attachment composer lag、project search、stale assistant errors 和 v2 legacy config 读取。

### WheelMaker integration

- 结论：需回归验证。
- 若 WheelMaker 使用 Azure provider 或 reasoning effort，需验证模型请求和 ACP error mapping；其他桌面修复无需接入调整。

## 1.18.11

### 修复

- 修复 MCP SSE 在 server error 后进入 reconnect loop，以及 interleaved/custom reasoning fields 的 provider model config。
- 桌面端修复外链、session tab、directory picker、file tree 和 debug gutter。

### WheelMaker integration

- 结论：需回归验证。
- MCP SSE 重连和 reasoning 字段直接影响 `opencode acp`；覆盖 MCP error/reconnect、工具列表恢复和 reasoning 输出。

## 1.18.10

### 新增

- 自动发现 Modal models。

### 修复

- 修复保存的 tabs、model variant selector 和 custom agent picker。

### WheelMaker integration

- 结论：无需动作。
- 仅在使用 Modal/custom agent 时需要回归模型发现；npm 包仍提供 `opencode` binary 并通过 `acp` 子命令启动。

## 1.18.9

### 修复

- 恢复与旧 MCP SDK client 的兼容性。
- 修复桌面 Solid cleanup crash 和 Home session loading；增加可选 V2 desktop sidecar。

### WheelMaker integration

- 结论：需回归验证。
- 重点是旧 MCP client 的连接、工具枚举和 ACP session 建立；不需要启用 desktop sidecar，也不改变 WheelMaker 的启动参数。
