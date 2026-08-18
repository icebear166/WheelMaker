# @anthropic-ai/claude-code

> WheelMaker 角色：Claude CLI runtime；包提供 `claude` 入口。它与 `@agentclientprotocol/claude-agent-acp` 是两个独立 npm 包。
>
> 研究方式：npm tarball 相邻版本 diff；包内没有用户可读 release changelog。首次记录 2.1.224–2.1.234（npm 可获得的稳定版本，跳过不存在的 2.1.230）。

## 2.1.234

### 新增

- `sdk-tools.d.ts` 增加 Artifact assets 的 upload/list/read/delete 类型和异步 dispatch 字段。

### 修改

- package manifest 与各平台 optional dependency 更新到 2.1.234；`claude` bin wrapper、`install.cjs` 和 `claude.exe` wrapper 入口保持不变。

### WheelMaker integration

- 结论：需回归验证。
- 入口名没有变化，但平台 runtime 通过 optional dependency 更新；需验证当前 OS 的 `claude` global binary、postinstall、版本输出和 CLI 子进程启动。不要把 Claude CLI 的 SDK 类型变化当成 ACP adapter 已自动升级。

## 2.1.233

### 修改

- manifest 与平台 optional dependency 版本更新；tarball 中 wrapper、install 脚本和 `sdk-tools.d.ts` 未见新增接口。

### WheelMaker integration

- 结论：无需动作。
- 未见 WheelMaker 使用的 binary/入口变化；保留全局安装和 `claude --version` smoke test。

## 2.1.232

### 修改

- manifest 与平台 optional dependency 版本更新；可见 wrapper 和 SDK 类型未变化。

### WheelMaker integration

- 结论：无需动作。
- 不需要调整 npm 安装或启动参数；升级后确认平台 optional package 安装成功即可。

## 2.1.231

### 修改

- manifest 与平台 optional dependency 版本更新；可见 wrapper 和 SDK 类型未变化。

### WheelMaker integration

- 结论：无需动作。
- `claude` bin 和 Node `>=22.0.0` engine 保持不变，继续执行安装后版本检查。

## 2.1.229

### 新增

- `sdk-tools.d.ts` 增加 `ReadNotifications` tool 类型，用于读取带来源、时间和剩余数量的通知队列。

### 修改

- manifest 与平台 optional dependency 版本更新。

### WheelMaker integration

- 结论：需回归验证。
- CLI 新增工具可能改变可见 tool catalog 或权限提示；WheelMaker 仍通过独立 ACP adapter 接入，需确认 Claude CLI 直接运行和本地配置目录不被新通知能力阻塞。

## 2.1.228

### 新增

- SDK 类型增加 thinking token 用量字段，并补充 Artifact 标题约束说明。

### 修改

- manifest 与平台 optional dependency 版本更新。

### WheelMaker integration

- 结论：需回归验证。
- 需验证 CLI usage 输出和 Artifact 相关工具类型；这些变化不等于 `claude-agent-acp` 的 ACP usage contract 变化，两个包应分别回归。

## 2.1.227

### 新增

- `sdk-tools.d.ts` 增加 `ProposeGoalInput/Output`、goal run 查询字段和后台任务结束行为说明。

### 修改

- Artifact 发布类型的说明更细化，manifest 与平台 optional dependency 更新。

### WheelMaker integration

- 结论：需回归验证。
- Claude CLI 的 goal/后台任务能力可能影响 CLI tool catalog；WheelMaker 的 Claude ACP goal capability 仍由 adapter 决定，不能直接假设该 SDK 类型会被 ACP 暴露。

## 2.1.226

### 修改

- manifest 与平台 optional dependency 版本更新；tarball 中 `claude` wrapper、安装脚本、平台 wrapper 和 SDK 类型未见结构变化。

### WheelMaker integration

- 结论：无需动作。
- 入口、Node engine 和包布局保持稳定；继续验证 Windows optional package 和 global npm bin。

## 2.1.225

### 新增

- SDK tool action 类型增加 `create_webhook_trigger`。

### 修改

- manifest 与平台 optional dependency 版本更新。

### WheelMaker integration

- 结论：需回归验证。
- 新工具只影响 Claude CLI 的 tool catalog；对 WheelMaker 的 ACP adapter 需验证工具权限和 session initialize 不受影响，npm binary 不需改名。

## 2.1.224

### 修改

- 作为本次 tarball diff 的基线：包提供 `claude` bin、`install.cjs`、平台 optional dependency 和 Node `>=22.0.0` engine。

### WheelMaker integration

- 结论：需回归验证。
- 首次记录版本需在当前 Node 22 环境确认 global install、platform package、`claude` PATH 发现和配置目录隔离；Claude ACP adapter 需单独安装 `@agentclientprotocol/claude-agent-acp`。
