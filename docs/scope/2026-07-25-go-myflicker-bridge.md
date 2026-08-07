> 由 scope skill 于 2026-07-25 生成

# Go MyFlicker Bridge

## 目标

将 `E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge` 中现有 Python 本地代理完整迁移为可在 Windows x64 运行的 Go 可执行文件。迁移目标是协议和运行行为兼容，而不是把客户端配置工具一并复制：新程序只作为本地代理运行，供后续 WheelMaker 启动和 Claude/Codex 等客户端连接。本轮只交付独立测试用的源码和 exe，不改动 WheelMaker 集成代码，也不提交任何变更。

## 决策

- 代理范围为完整迁移，而不是 WheelMaker 最小接口：保留本地 API key、MyFlicker 登录态与 SSO、模型目录、上游 AES-GCM/HMAC 请求处理、OpenAI Chat/Responses、Anthropic Messages、流式转发、工具调用、图像与文本附件、重试/降级、用量/余额日志，以及官方 Codex Responses 的透明转发。
- 所有代理实现放在 `E:\_Code\kuaishou-misc-tools\tools\MyFlickerBridge\myflicker_bridge.go` 一个 Go 源文件中。`go.mod` 与 `go.sum` 仅作为构建元数据；为了支持 Codex 的 zstd 请求体和读取 MyFlicker SQLite 登录态，允许使用 `klauspost/compress/zstd` 与 CGo-free 的 `modernc.org/sqlite`，交付的 exe 不依赖外部运行时。
- 本轮只支持和验证 Windows x64。产物为同目录下的 `myflicker_bridge.exe`。
- 保持现有环境变量和默认地址兼容：默认监听 `127.0.0.1:17888`，继续读取 `MYFLICKER_BRIDGE_API_KEY`、`MYFLICKER_SECURITY_KEY_B64`、`MYFLICKER_TOKEN` 及其他现有 `MYFLICKER_*` 变量，并继续自动发现 MyFlicker 本地登录态与安装信息。
- 后续 WheelMaker 集成时，`api_keys.flicker` 的值定义为本地 bridge API key：启动 bridge 时传为 `MYFLICKER_BRIDGE_API_KEY`，启动 `cc-flicker` Claude 子进程时传为 `ANTHROPIC_AUTH_TOKEN`。本轮不实现这项集成。
- 移除全部客户端配置写入功能：不迁移 Claude、Codex、CC Switch 或 Claude Code Router 的配置、数据库、模型目录写入及关联启动器。代理自身的 `.cache` 认证/模型缓存和日志仍可写入，这是运行时状态而非客户端配置。
- 可执行文件包含内置离线自检入口，避免增加第二个 Go 源文件。验收还包含真实 MyFlicker 与官方 Codex 的最小连通性测试，用户已授权消耗必要额度。

## 架构

单个 Go `main` 包承载配置解析、Windows 本机状态发现、认证与模型目录、上游 HTTP/SSE 客户端、协议转换、HTTP handler、日志和内置自检。它在 loopback 地址上提供与 Python bridge 相同的本地服务边界；代理缓存放在工具目录的 `.cache` 下。除 zstd 解压和 CGo-free SQLite 驱动外，构建使用 Go 标准库。

### 本地 HTTP 边界

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`
- `POST /v1/messages/count_tokens`
- `GET /_myflicker/auth`
- `POST /_myflicker/auth/refresh`

每个需要鉴权的接口保持 loopback 来源检查与 Bearer/x-api-key 验证；远程监听仍必须显式允许并使用私有 bridge key。

### 上游边界

Flicker 请求继续使用 device token、模型目录、security config、加签和加密规则，优先调用 v3/duet 路径，并在无可见输出或明确的兼容错误时按现有规则降级到 legacy 路径。`/v1/responses` 对精确匹配的官方 Codex model 保持原始 HTTP 状态、headers 和 SSE 字节透明转发，不落回 Flicker。

## 流程

```text
Local OpenAI / Anthropic / Codex client
        |
        v
myflicker_bridge.exe (127.0.0.1:17888)
  - origin + API key guard
  - request protocol normalization
  - device auth / model catalog / security rules
  - request signing and optional AES-GCM encryption
        |
        +--> MyFlicker chat SSE -> protocol-specific streaming response
        |
        +--> official Codex Responses -> byte-for-byte transparent relay
```

启动时先恢复或刷新 device auth，再加载模型目录；只有认证成功才监听服务。请求期间 token 失效会按现有一次刷新重试规则恢复。Flicker 响应持续转换为目标协议的 SSE 或 JSON，完成后异步记录可选的用量和额度信息。

## 验收标准

- `go build` 在当前 Windows x64 环境生成 `myflicker_bridge.exe`，运行时不需要 Python、`cryptography` 或 `zstandard`。
- 代理实现只包含一个 Go 源文件；不出现用于写入 Claude、Codex、CC Switch、CCR 配置或启动这些客户端的代码路径。
- 所列本地 HTTP 接口均可用，并保持原 Python bridge 的请求鉴权、错误语义、模型别名与协议转换行为。
- OpenAI Chat、Responses 和 Anthropic Messages 均支持非流式与流式响应；工具调用、thinking/reasoning、图像、文本附件和 token counting 不因迁移丢失。
- Flicker 上游请求保持认证、模型校验、security config、AES-GCM/HMAC、busy 重试、fallback 和额度耗尽处理。
- 官方 Codex `/v1/responses` 分流继续是透明代理，能处理 zstd 压缩请求体。
- 默认仅监听 loopback；非 loopback 监听在缺失显式允许变量或私有 key 时拒绝启动。
- 不修改 WheelMaker 源码或配置，不提交 Git 变更。

### 测试

- 在 exe 内执行离线自检，使用本地 mock 覆盖参数解析、认证缓存、模型别名、协议转换、SSE、加密/签名、busy/fallback、zstd、官方 Codex 转发和配置写入缺失。
- 启动 exe 后检查 `/health`、`/v1/models` 与 `/v1/messages/count_tokens` 的本地连通性和 API key 拒绝行为。
- 在当前可用 MyFlicker 登录态下对 OpenAI Chat、Anthropic Messages、Responses 发送最小真实请求，并检查流式结束、模型路由和响应内容。
- 在当前可用官方 Codex 认证下发送一个最小 `/v1/responses` 请求，确认 zstd 解码与透明转发。
- 不测试 macOS/Linux 行为，也不测试 WheelMaker 拉起、重启或关闭该 exe 的生命周期；这些属于后续集成范围。

## 范围之外

- 将 Go bridge 纳入 WheelMaker 构建、发布、配置或进程生命周期。
- 修改 `api_keys.flicker` 的数据模型或 WheelMaker 现有 `cc-flicker` provider。
- 迁移或保留任何 Claude、Codex、CC Switch、Claude Code Router 配置写入命令、脚本或 UI。
- macOS、Linux 产物及兼容性验证。
- 提交、推送或创建发布产物以外的版本控制操作。
