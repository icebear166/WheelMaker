# WheelMaker 安全模型

最后复核：2026-07-13

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

## 后端密钥

DeepSeek、Volcengine ASR 和 MiMo TTS 等后端密钥采用 set-only backend secrets 接口。前端只能执行 set、replace、clear 和读取 `configured`/`updatedAt` 状态，协议没有读取明文的操作，诊断和日志也会递归脱敏。

密钥仍由 Registry 写入同一个 `~/.wheelmaker/config.json` 的 `secrets` 区域，因此不会引入第二套 Hub 配置格式。安全提升来自访问面收窄和私有原子文件权限，而不是把明文伪装成可逆编码。Registry 进程必须能读取这些值来调用第三方服务；能控制当前 OS 用户或管理员权限的攻击者仍在已知风险范围内。

## Relay 边界

Relay 使用 six-digit Relay access code 作为临时在线门禁，并配合来源失败速率、全局尝试速率、generation、短期认证 Cookie 和 code regeneration。generation 改变后，旧 code 和旧 Relay 认证状态失效；目标只允许 Hub 的 `127.0.0.1` 服务。

六位码适合人在场的临时分享，不是长期高熵凭据。暴露时间应尽量短，使用后立即关闭或重新生成 code，不应把 Relay 当成永久公网入口。

## Native Bridge

Desktop 和 Android 只内置专用启动配置页，业务 Web 从用户填写的 HTTPS Base URL 加载。Native Bridge 使用 origin-restricted WebMessage listener，不使用 `addJavascriptInterface`。启动动作只允许本地 bootstrap Origin；业务动作必须来自已配置的精确 Origin、主 frame 和 allowlist。

需要敏感原生能力的请求还必须携带近期用户手势，授权结果是 action-bound 的短期 capability：手势窗口为 5 秒，发放后的 capability 只在 1 秒内用于同一动作。切换服务器会清理旧站点状态。

## 项目路径和 Junction

路径规范化会拒绝词法层面的 `..` 越界，但 Windows Junction 和其他受支持的目录链接可以从已配置项目指向项目根之外。Junction trust semantics 是显式信任语义：配置项目根即表示同时信任该根内由当前 OS 用户维护的链接目标。不要在不受信任用户可写的项目中放置 Junction；需要硬隔离时使用独立 OS 账户或容器边界。

LocalHubRead 已 deleted/retired，listener、role、method 和 manager 都不应恢复。文件、Git 和会话数据统一经 Registry/Hub 授权链访问。

## 日志和安全报告

运行日志位于 `~/.wheelmaker/log/`。Registry 浏览器 Session 元数据位于 `~/.wheelmaker/registry-sessions.json`，配置和后端密钥位于 `~/.wheelmaker/config.json`。诊断导出会对敏感键递归脱敏，但分享前仍应人工检查。

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
