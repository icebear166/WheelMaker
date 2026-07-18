> 由 scope skill 于 2026-07-18 生成

# Windows Local Dev 与 Desktop Dev Mode

## 目标

为 Windows 开发者提供一键本地开发流程：从当前源码构建 Hub、Web 与 Desktop，使用本机的正式运行数据调试完整应用，尤其支持 Web 样式调试。Desktop 在保留单一产品形态的前提下提供 Windows 扩展入口和 Local Dev 页面，不向浏览器、Android 或其他平台开放本机构建或进程控制能力。

## 决策

- 仅支持 Windows；不扩展 Android、iOS、macOS 或 Linux 的开发入口。
- 源码脚本负责从当前仓库构建开发产物；Desktop 不扫描、记录或管理任意源码目录，除非用户在 Local Dev 页面明确配置。
- 开发产物位于 `~/.wheelmaker/dev/bin/` 和 `~/.wheelmaker/dev/web/`；Hub 二进制名为 `wheelmaker.exe`。
- Dev Hub/Registry 复用 `~/.wheelmaker` 的正式配置、数据库、登录态和服务端设置。
- 正式与 Dev Hub/Registry 必须互斥，避免同时监听 `9630` 或并发访问同一 SQLite 数据。
- Desktop 保持一个产品形态，不发布独立的 Dev Desktop 包；Windows 正式 Desktop 也展示扩展入口。
- Desktop 顶栏的 Windows 扩展按钮与现有 Web 控件保持同一视觉风格。它打开 Web 风格浮层菜单，菜单中的 Dev Mode 进入 Local Dev 页面。
- Local Dev 页面配置源码根目录，并通过 Windows 原生校验确认目录包含 `server/go.mod`、`app/package.json` 与 `scripts/`。开发配置单独保存在 `~/.wheelmaker/dev/dev-config.json`，不写入正式 `config.json`。
- Local Dev 页面首版提供源码目录配置、Dev 运行状态，以及 Build、Start、Stop、Restart、打开开发目录和进入/退出 Local Dev 等操作。
- 正式页面只能请求进入 Local Dev；任何进入、构建、路径保存或进程控制均由 Windows 原生端独立校验和确认。Dev 运行时功能只对已进入 Dev Mode 的 `127.0.0.1` 顶层页面开放；页面不能传递任意命令字符串。
- 为支持 Web 热更新，Dev Mode 可受限地使用本地回环 HTTP；正式 Desktop 继续 HTTPS-only。
- 浏览器和非 Windows 平台不提供这些桥接绑定。篡改前端 JavaScript 最多伪造 UI，不能执行本地开发操作。
- 开发构建复用源码仓库 `.release-work/cache/` 中的 `webpack`、`go-build` 和 `go-mod` 缓存；不读取或写入 `.release-work/tmp`、`.release-out`，也不使用 Gradle 缓存。
- Dev 构建与正式 release 使用同一构建锁，避免同时修改源码树、Desktop 图标资源或共享缓存。

## 架构

源码仓库中的 Windows 开发脚本是编排入口。它取得共享构建锁，复用 release 编译缓存，将 Web 与二进制写入 `~/.wheelmaker/dev`，并管理 Dev Hub/Registry 与正式运行时的互斥。单一 Desktop EXE 在 Windows WebView 中注入受限扩展桥；React 顶栏据此显示 Windows 扩展按钮和 Local Dev 页面。原生层保存开发配置、验证源码路径、执行固定的受控构建/生命周期操作，并按当前受信任页面和 Dev Mode 状态授权。

## 流程

```text
源码脚本
  -> 获取 release/dev 共享构建锁
  -> 复用 .release-work/cache/{webpack,go-build,go-mod}
  -> 写入 ~/.wheelmaker/dev/{bin,web}
  -> 与正式 Hub/Registry 互斥切换
  -> 本地 Web 开发服务 + Hub/Registry 可供 Desktop 连接

Windows Desktop 扩展按钮
  -> Web 风格菜单
  -> Dev Mode
  -> Windows 原生确认与授权
  -> Local Dev 页面（仅本地回环受信任页面）
```

## 验收标准

- 从 Windows 源码目录运行一个开发入口，能够构建并启动本地 Web、Hub、Registry 与 Desktop 调试环境。
- Dev 产物写入 `~/.wheelmaker/dev/bin/wheelmaker.exe` 与 `~/.wheelmaker/dev/web/`，不覆盖正式发布产物。
- Dev Hub/Registry 使用正式 `~/.wheelmaker` 运行数据，且正式与 Dev 运行时不能同时访问 `9630` 或同一数据库。
- Dev 与 release 均不能在共享构建锁已被另一方持有时并行执行危险的源码构建步骤。
- Local Dev 页面可在 Desktop 中配置、验证和持久化源码目录；无效目录不会保存或执行构建。
- Windows Desktop 显示视觉一致的扩展按钮和 Dev Mode 菜单；浏览器与非 Windows 原生壳不显示或不能使用该功能。
- 正式远程页面不能静默执行 Local Dev 的构建、启动、停止或路径修改；Dev 原生操作仅在授权的 Windows Dev Mode 和本地回环页面可用。
- `http://127.0.0.1` 仅在 Dev Mode 被接受，正式 Desktop 仍拒绝非 HTTPS 远程地址。
- Dev Web 调整样式后能在 Desktop 本地开发页面刷新或热更新显示。

### 测试

- 为脚本/构建编排新增或扩展 Node 测试，覆盖输出路径、缓存环境、构建锁和正式/Dev 互斥。
- 为 Desktop Go 测试覆盖 Dev Mode 授权、回环 HTTP 限制、来源限制与源码目录验证。
- 为 Web 测试覆盖 Windows 扩展按钮、菜单、Local Dev 页面在无 Desktop 桥时的隐藏和不可调用性。
- 运行相关 Node、Go、Web 类型检查与构建验证；在 Windows 上进行 Desktop 手动冒烟验证。

## 范围之外

- 为非 Windows 平台增加 Local Dev、原生扩展菜单或本地构建能力。
- 改动正式发布的版本策略、协议版本、Android 构建与 Gradle 缓存。
- 重用 release 的临时目录、最终发布目录或让 Desktop 执行网页传入的任意命令。
