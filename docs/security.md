# WheelMaker 安全模型

最后复核：2026-07-14

本文描述当前实现的安全边界和日常操作。已知但尚未消除的风险见 [security-known-risks.md](security-known-risks.md)，Nginx 响应头配置见 [nginx-security.md](nginx-security.md)。

## 适用范围

WheelMaker 是 single-user / single-token 系统：一个受信任的操作系统用户管理一个 Registry，所有受信任 Hub 共用同一个 Registry Token。它不提供多租户身份、用户级授权或互不信任 Hub 之间的隔离。只有自己控制的机器和项目才能加入同一 Registry。

浏览器不是共享 Token 的长期持有者。用户在 HTTPS 登录页提交 Token 后，Registry 返回浏览器设备 Session Cookie；后续 HTTP 和 WebSocket 连接只使用 Cookie。Cookie 为 `HttpOnly`、`Secure`、`SameSite=Strict`，并绑定当前 Base URL 的路径。WebSocket URL、query、subprotocol 和 `connect.init` 都不携带 Token。

## Registry Token

全新安装缺少配置时，部署程序从操作系统加密随机源读取 32 bytes，自动生成 256-bit Base64URL Token。每次安装独立生成，不存在可用的默认 Token；随机源失败时部署失败关闭。公开的旧默认值和空值会被拒绝。

系统接受 short custom Token，以保留单用户部署的兼容性，但短值会显著降低抗猜测能力。除非有既有外部密钥管理要求，应保留自动生成值。Token 位于 `~/.wheelmaker/config.json` 的 `registry.token`；配置通过私有权限的原子写保存。不要把它复制到 Git、聊天、诊断包、命令行参数或 Nginx 配置。

受信任 Hub 仍使用共享 Token 建立连接。这在单用户模型中是有意设计：它简化了部署，但任一 Hub 泄漏都要求轮换整个 Registry Token。

## 浏览器 Session 和 device revocation

浏览器 Cookie 的有效期是 180-day sliding session：成功使用会把服务端过期时间向后滑动。Registry 在 `~/.wheelmaker/registry-sessions.json` 中只持久化 Cookie 摘要、设备元数据、Base Path 和过期时间，因此正常重启不会要求重新输入 Token，也不会保存可复用 Cookie 明文。

设备管理支持 device revocation：可以只撤销一个浏览器设备，也可以撤销全部设备。退出登录会撤销当前 Cookie。Registry Token 轮换会改变 Session 文件中的 Token fingerprint，下一次加载时清空所有旧浏览器 Session；所有 Hub 也必须改用新 Token。

## 网络、Nginx 和 Base URL

Registry HTTP listener 只允许 loopback 地址。远程浏览器、Desktop、Android 和 Worker 统一通过 Nginx 的 HTTPS/WSS 入口访问；Nginx 再代理到 `http://127.0.0.1:9630`。服务端只信任来自 loopback 代理的 forwarded headers，外部客户端伪造的 `X-Forwarded-*` 不构成信任依据。

Base URL 是完整 HTTPS 目录地址，可以是根路径 `https://host/`，也可以是子路径 `https://host/wheelmaker/`。登录、状态、设备管理、Cookie Path 和 WebSocket endpoint 都从页面 Base URL 推导。不同用户可以使用各自的域名和路径，客户端不锁定固定 Origin。远程证书必须通过系统信任链验证。

公开入口应部署 CSP、`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff` 和防 iframe 响应头。HTML meta 策略只能作为补充，不能替代 Nginx 对所有静态响应设置的 header。

## Server 配置和后端密钥

DeepSeek、Volcengine ASR 和 MiMo TTS 统一在设置页的 `Server` 分组配置，Key 是否存在直接决定功能是否可用，不再维护独立的 enable 开关。普通前端接口采用 set-only backend secrets 模型：只能 set、replace、clear 和读取 `configured`/`updatedAt`，不能读回明文。Key 不进入 React state、浏览器存储或 Hub `config.json`；诊断和日志在记录协议响应前递归脱敏。

Server 配置由 Registry 入口机写入 `~/.wheelmaker/db/server-data.json`。这是运行时必须读取的明文 JSON，不是加密保险箱；安全边界来自仅当前 OS 用户可访问的 private file permissions、原子替换写入和受限协议。备份该文件等同于备份所有第三方 Key，必须使用同等级的访问控制，不得上传 Git、诊断包或普通云盘。能控制当前 OS 用户或管理员权限的攻击者仍在已知风险范围内。

Android direct speech（直连语音）是唯一的明文读取例外。APK 先通过 HTTPS 页面和浏览器 Session Cookie 接入 Registry；只有声明为 `wheelmaker-android` 的已认证 client 才能读取 Volcengine ASR 的 Key、版本和模型，不能读取 DeepSeek 或 TTS Key。这个 client-name gate 可以被自制客户端伪装，本项目在 single-user、所有客户端均受信任的边界内明确接受（accepted）该风险，不能把它当成多租户授权。

Key 由 Web 通过受限 Native Bridge 交给 Android，只保存在 APK 进程内存，不写 SharedPreferences、数据库或文件。相同版本不会重复获取；Key 变化、服务器切换、退出登录、服务端变为未配置、认证失败或进程死亡会触发清理/重新同步。Android 随后直连 Volcengine firehose endpoint 并把 transcript 返回页面，不把 PCM 音频发给 Registry。Web 和 Desktop 不取得第三方 Key，语音识别与 TTS 仍由服务端 provider 调用。

旧客户端配置不会迁移到 Server Data（old clients are not migrated; mandatory reconfiguration）。升级后必须使用新 Web/Desktop/APK，并在 `Server` 分组重新配置 Key。Registry 只承担认证、协议路由和适配；持久化与 provider 实现分别集中在独立的 `serverdata`、`speech`、`tts` 包，避免把业务实现散落进 Registry 主流程。

## Relay 边界

Relay 使用 six-digit Relay access code 作为临时在线门禁，并配合来源失败速率、全局尝试速率、generation、短期认证 Cookie 和 code regeneration。generation 改变后，旧 code 和旧 Relay 认证状态失效；目标只允许 Hub 的 `127.0.0.1` 服务。

六位码适合人在场的临时分享，不是长期高熵凭据。暴露时间应尽量短，使用后立即关闭或重新生成 code，不应把 Relay 当成永久公网入口。

## Native Bridge

Desktop 和 Android 只内置专用启动配置页，业务 Web 从用户填写的 HTTPS Base URL 加载。Native Bridge 使用 origin-restricted WebMessage listener，不使用 `addJavascriptInterface`。启动动作只允许本地 bootstrap Origin；业务动作必须来自已配置的精确 Origin、主 frame 和 allowlist。

需要用户主动触发的敏感原生能力必须由 Android 在受信任顶层页面上记录真实 `ACTION_DOWN`，页面提交的时间戳不作为用户在场证明。手势最长保留 5 秒且只能消费一次；来源校验通过后发放的 native capability 只在 1 秒内用于同一动作。图片渲染和语音连接可能在点击后执行较长的异步准备，因此会在点击时换取随机的 action-bound、single-use 授权，授权最长保留 60 秒，不能跨动作复用。

Android 响应图片使用 begin/chunk/commit 协议传输：每个解码块最大 128 KiB，总图片最大 16 MiB，块索引必须连续，提交时实际字节数必须与声明一致；取消、过期或切换服务器都会删除半成品。Android 语音凭据同步不要求新的点击手势，但只对已配置的业务 Origin 和明确的语音 allowlist 开放，本地 bootstrap 页不能调用。切换服务器会同时清理旧站点状态、内存语音凭据、用户手势、延期授权、图片传输和原生诊断缓存。

## 项目路径和 Junction

路径规范化会拒绝词法层面的 `..` 越界，但 Windows Junction 和其他受支持的目录链接可以从已配置项目指向项目根之外。Junction trust semantics 是显式信任语义：配置项目根即表示同时信任该根内由当前 OS 用户维护的链接目标。不要在不受信任用户可写的项目中放置 Junction；需要硬隔离时使用独立 OS 账户或容器边界。

LocalHubRead 已 deleted/retired，listener、role、method 和 manager 都不应恢复。文件、Git 和会话数据统一经 Registry/Hub 授权链访问。

## 日志和安全报告

运行日志位于 `~/.wheelmaker/log/`。Registry 浏览器 Session 元数据位于 `~/.wheelmaker/registry-sessions.json`，Hub/Registry 配置位于 `~/.wheelmaker/config.json`，Server 配置和后端密钥位于 `~/.wheelmaker/db/server-data.json`。诊断导出会对敏感键递归脱敏，但分享前仍应人工检查。

Gitleaks 私有报告位于 Git 工作树外的 `$HOME/.wheelmaker/security-reports/wheelmaker/`。报告不得提交；仓库只记录脱敏 fingerprint、位置、分类和处置状态。当前响应记录见 [security-credential-response.md](security-credential-response.md)。

## Credential rotation

Registry Token 或后端凭据疑似泄漏时：

1. 在受保护的本地配置或 CI/provider secret store 中生成新值，不在终端输出、Git、聊天或报告中复制。
2. 更新 Registry 和所有受信任 Hub，重启服务并确认它们只用新值连接。
3. 对 Registry Token 执行全部 device revocation，验证旧 Cookie 和旧 Hub Token 都失败。
4. 在 provider 侧吊销旧值并验证不可再用；只改仓库内容不能代替吊销。
5. 运行 Gitleaks current-tree/staged gate 和一键安全验收，仅记录脱敏 evidence。

## Vulnerability report

安全问题应私下报告给仓库 owner/maintainer，不要先创建包含细节的公开 issue。报告应包含受影响版本或 commit、最小复现、影响范围和不含真实凭据的日志；Token、Cookie、Authorization header、第三方 API key、签名材料和可复用 URL 一律不要附在公开渠道。维护者完成接收确认和修复协调后，再决定是否发布脱敏公告。
