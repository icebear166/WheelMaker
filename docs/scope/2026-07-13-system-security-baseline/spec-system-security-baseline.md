# WheelMaker 系统安全基线

> 由 scope skill 于 2026-07-13 生成

## 目标

WheelMaker 是由单个所有者管理、通过 Nginx 对外提供 HTTPS/WSS 访问的单用户系统。安全改造的目标是在保留一个共享 Registry Token、Hub/Registry loopback 部署、Relay 便捷入口和项目内 Junction 语义的前提下，消除默认凭据、浏览器长期持有密钥、多套 Web 资源与跨 Origin 认证、无界网络输入、非可信 Native Bridge、诊断泄密和在线口令爆破等风险。

本规格是全系统安全总规格，记录已经落地的基线、仍属过渡状态的实现和最终目标。实施必须在本规格批准后拆成可独立验证和回滚的分阶段计划，旧的 `docs/plans/2026-07-13-security-hardening-plan.md` 不再作为目标状态的依据。

安全边界覆盖网络窃听者、未授权网页来源、普通仓库或诊断数据读取者、在线爆破者、不可信 Android/EXE 页面、低权限本机用户以及畸形或超量网络输入。它不承诺抵抗已获得当前操作系统用户权限或管理员权限的恶意进程、调试器、已完全控制受信任页面的攻击者，或用户主动配置的弱自定义 Token；但系统仍须通过 CSP、最小权限和不持久化原始凭据降低这些场景的影响。

## 决策

- 系统只保留一个长期共享 `registry.token`。Token 持有者视为该单用户系统的管理员，不引入第二个长期管理员 Token、多用户账户、OIDC、通用 RBAC 或 mTLS。
- 新安装和自动轮换必须生成 32 字节、256-bit 的 Base64URL Token，随机源失败时 fail closed。自定义 Token 只要非空且不是公开旧默认值就继续接受，包括短值；系统不得按长度阻断或自动替换用户自定义值。
- Token 继续保存在 WheelMaker 后端 `config.json`，不拆成独立 Secret 文件。配置文件必须原子写入，并限制为当前操作系统用户和 SYSTEM 可访问。
- 普通浏览器不再配置独立 Registry/WebSocket 地址，而是始终连接当前页面 Base URL 下的同源 Registry。
- EXE 和 Android 不再内置完整 Workspace Web。首次启动只显示共用的极小 Bootstrap HTML，用户输入一个 HTTPS Base URL 后，客户端直接加载远程业务页面。
- Base URL 允许域名、IP、自定义端口和子路径，例如 `https://example.com/wheelmaker/`；拒绝非 HTTPS、userinfo、query 和 fragment。Base URL 必须规范化为以 `/` 结尾的目录 URL。
- Web、认证和 WebSocket 地址由一个 Base URL 派生。以上例为：Web 使用 `/wheelmaker/`，认证复用 `/wheelmaker/ws?auth=...`，WebSocket 使用 `wss://example.com/wheelmaker/ws`。
- 现有根路径部署继续使用 `/` 和 `/ws`，不得要求用户新增 Nginx 认证 Location。子路径部署由用户的反向代理将相应 Base Path 映射到 Web 和 Registry；WheelMaker 不要求认证专用代理规则。
- EXE/Android 只接受系统信任的有效 HTTPS 证书，不提供忽略证书错误、自签名例外或静默降级到 HTTP。
- Bootstrap 页面只拥有校验、保存、重置 Base URL 的配置 Bridge，不能调用语音、文件、通知、分享、更新等业务 Native Bridge。
- 业务 Native Bridge 只授权给用户当前配置的精确 HTTPS Origin、Base Path 和主 Frame。服务器地址变化后，旧 Origin 和路径立即失去权限。
- 修改 Base URL 时，客户端先尝试撤销旧服务器的当前设备 Session，再清除旧 Base URL 的 Cookie、缓存和站点数据；旧服务器不可达时仍须完成本地清理。
- 浏览器认证硬切换到服务端设备 Session。新版 Web 与 Registry 必须同批发布，新版 Web 启动即删除旧 Token 持久化，不保留浏览器 Token 回退。
- 设备 Session 使用 180 天滑动有效期，活跃时续期，Registry 重启后继续有效，并支持单设备撤销和全部撤销。
- 共享 Token 一旦轮换，所有设备 Session 立即失效，所有设备必须使用新 Token 重新登录。
- 设置中提供已登录设备列表，显示设备名称、创建时间和最后活动时间，并提供单设备撤销与全部撤销。
- Registry Token、DeepSeek API Key、火山语音 API Key、TTS API Key 等长期密钥统一由受保护后端配置保存。浏览器只能设置、替换、清除和查询“已配置”状态，任何接口不得返回密钥原文。
- `wheelmaker-monitor` 不再加固，而是完整删除。升级必须停止并移除遗留 Monitor 服务和二进制，同时清理配置、部署、UI、文档和协议引用。
- Relay 保留 6 位 Access Code 和当前跳转体验，但必须增加来源级与 Relay generation 级双层限速、常量时间比较、请求来源校验和防泄漏响应头。
- Android/EXE 删除完整内置 Web、Embedded/Remote/Auto 模式、资源抓取代理、缓存回退和旧版离线业务 UI。远程服务器不可达时只显示重试和修改地址入口。
- Git 历史中已经出现的真实凭据先清点和轮换；当前代码清理与 Gitleaks 防回归属于本轮范围。历史重写和 force-push 单独安排维护窗口，并在执行前再次审批。
- Go 工具链升级暂缓，不阻塞其他安全修复；已知 Go 风险必须记录在后续升级清单中。
- 项目根目录下的 Junction/符号链接目标视为用户配置项目范围的一部分，本规格不改变该语义。

## 当前基线

| 安全项 | 当前状态 | 目标处理 |
| --- | --- | --- |
| 安装 Token | 已完成：新安装生成 256-bit Token，空值和公开旧默认值迁移或拒绝 | 保持；自定义值不增加长度阻断 |
| Token 运行入口 | 已完成：Hub、Registry 拒绝空值和旧默认值；Registry 不再从命令行接收 Token | 保持 Hub/Registry fail-closed |
| `config.json` | 已完成：原子写入，Unix `0600`，Windows 当前用户与 SYSTEM Protected DACL | 所有后端密钥配置写入复用同一保护机制 |
| Listener | 已完成：Registry 和 Relay listener 强制 loopback；Monitor 已删除 | 保持其余 WheelMaker 后端强制 loopback |
| 代理头 | 已完成：仅 loopback 直接对端可提供可信 `X-Forwarded-Proto` 和 `X-Real-IP` | 保持并覆盖所有新增 HTTP 入口 |
| Origin 配置 | 已完成：用户可配置的 `allowedOrigins` 已删除 | 浏览器严格使用请求同源关系和配置 Base Path |
| Registry Web Session | 已完成：Base Path 绑定、180 天滑动持久化、设备管理、CSRF、登录限速和安全 Cookie 已落地 | 保持并在最终端到端门复验 |
| 浏览器凭据 | 已完成：旧 Token 持久化和浏览器 Token WebSocket 路径已硬删除 | 保持 Cookie-only 浏览器认证 |
| 跨 Origin WebSocket | 已完成：所有带 Origin 的连接只接受严格同源 Cookie；无 Origin Hub 继续使用 Token | 保持并在最终恶意 Origin 门复验 |
| LocalHubRead | 已完成：Listener、证明交换、协议角色、方法、前端管理器和 UI 全部删除 | 不恢复兼容路径 |
| Monitor | 已完成：源码、配置、协议、构建目标和遗留服务/二进制升级清理已硬删除 | 不恢复兼容路径 |
| Relay Cookie | 已完成：随机进程密钥 fail-closed、HMAC/generation/过期绑定、双层限速和来源校验已落地 | 保持并在最终 Relay 门复验 |
| Android WebView/APK | 部分完成：远程 HTTPS Bootstrap 壳已落地，完整 Workspace/appassets 回退已删除 | 阶段 7 完成 Bridge、权限、APK 和 release 签名纵深加固 |
| 诊断与仓库凭据 | 未完成 | 递归脱敏、轮换、Gitleaks；历史重写另行审批 |
| Git/DoS/Web 纵深防御 | 部分完成：Git revision、Relay、Registry 输入/队列/上传/日志资源边界已落地 | 阶段 7 完成 CSP、开发服务器和兼容依赖措施 |

## 架构

```text
Browser ───────────────────────────────────────────────┐
                                                       │ HTTPS / WSS
EXE / Android                                          │ one Base URL
  ├─ minimal local Bootstrap (server URL only)         │
  └─ remote Workspace Web ─────────────────────────────┤
                                                       ▼
                                                    Nginx
                                         <base>/       │ Workspace Web
                                         <base>/ws     │ Registry
                                                       ▼
                                              Registry (loopback)
                                               ├─ device sessions
                                               ├─ secret-status API
                                               ├─ Relay control
                                               └─ protocol routing
                                                       ▼
                                                    Hub(s)
```

### Base URL 与客户端壳

Bootstrap 是 EXE/Android 唯一内置 Web 资产，不包含 Workspace bundle、Service Worker 或业务缓存。Base URL 保存于平台私有配置：Android 使用应用私有存储，Desktop 使用当前用户专属文件权限和原子写入。Base URL 本身不是秘密。

客户端加载远程页面前必须规范化并验证 HTTPS URL。成功后 WebView 导航、业务 Bridge 消息和敏感权限请求同时受精确 Origin、规范化 Base Path、主 Frame 和操作 allowlist 约束。同 Origin 但 Base Path 外的页面不具备业务 Bridge 权限；外部链接交给系统浏览器。

### Registry 认证边界

Registry 的同一个 `<base>/ws` 代理入口同时承载：

- `POST <base>/ws?auth=login`：以共享 Token 换取设备 Session。
- `GET <base>/ws?auth=status`：返回是否已认证及非敏感会话状态。
- `POST <base>/ws?auth=logout`：撤销当前设备 Session。
- `GET` + WebSocket Upgrade：建立 Registry 协议连接。

设备列表、单设备撤销、全部撤销和后端密钥设置通过已认证的 Registry 协议方法完成，不增加新的 Nginx 路由。所有 HTTP 认证响应使用 `Cache-Control: no-store`；写操作要求严格同源、可信 Fetch Metadata 和 CSRF 证明。

最终 WebSocket 认证分流为：

- 请求带浏览器 `Origin`：Origin 必须与有效请求 scheme/host/port 完全一致，顶层业务页面必须处于配置 Base Path，且请求必须携带有效设备 Cookie；只允许 `client` 角色，`connect.init` 不得包含 Token。
- 请求不带浏览器 `Origin`：Hub 等非浏览器服务继续在 `connect.init` 中使用共享 Token。
- 任何跨 Origin 浏览器连接、带 Origin 的 Token 登录连接或 Cookie 角色提升请求都返回拒绝结果。

### 设备 Session 存储

Registry 使用 WheelMaker home 下独立的 `registry-sessions.json`。文件采用与 `config.json` 相同的私有权限、临时文件同步和原子替换规则。文件只保存 Session ID 摘要、创建时间、最后活动时间、到期时间、设备显示元数据、Token fingerprint/generation 和撤销状态，不保存 Cookie 原文或共享 Token。CSRF 证明必须可校验而无需持久化可复用的明文秘密。

Session Cookie 是 host-only、`HttpOnly`、`Secure`、`SameSite=Strict`，`Path` 等于规范化 Base Path。Registry 将活跃 Session 的到期时间滑动到最后活动后的 180 天，并合并高频活动写入，避免每个 WebSocket 消息都触发磁盘写。Session 数量和持久化文件大小必须有界；超过容量时先清理过期/已撤销项，再淘汰最久未使用项。

Session 文件记录当前共享 Token 的不可逆 fingerprint。Registry 启动或配置更新时发现 fingerprint 变化，必须在接受浏览器认证前撤销全部 Session。

### 后端密钥配置

所有长期第三方密钥只存在于受保护后端配置和需要使用它们的后端进程内存。配置 API 使用“写入但不可读回”模型：读取只返回布尔状态、非敏感标识和最后更新时间。浏览器或 Native Bridge 不得获得密钥原文；需要第三方密钥的语音、TTS 或统计调用由后端执行，而不是把密钥交给页面后直连第三方服务。

### Monitor 删除

删除 `server/cmd/wheelmaker-monitor`、`MonitorConfig`、默认端口 9631、部署产物、服务定义、UI 文案、测试和现行文档引用。部署升级执行一次性清理：Windows 删除遗留服务和二进制，Linux 删除遗留 user service 和二进制，macOS 删除遗留 LaunchAgent 和二进制，并从已有 `config.json` 移除 `monitor` 字段后再进行严格解析。用户 Nginx 中遗留的 `/monitor/` 路由可以失效存在，但 WheelMaker 文档不再要求或生成该路由。

### Relay Access Code

Access Code 保持 6 位。错误尝试同时消费每来源和当前 Relay generation 两个 token bucket：来源桶突发 5 次、generation 全局桶突发 20 次，均每 30 秒补充 1 次。超限返回 `429` 与 `Retry-After`。成功登录清理该来源失败状态；重新生成 Access Code 清理 generation 状态并使旧 Cookie 失效。

登录表单和 query code 入口汇聚到同一校验路径，使用常量时间比较。POST 登录要求精确 Origin；顶层 query code 导航只接受可信 Fetch Metadata。成功使用 URL code 后立即 `303` 到不含 code 的相对 URL。登录、跳转和错误响应统一使用 `Cache-Control: no-store` 与 `Referrer-Policy: no-referrer`，日志不得记录 Access Code 或完整 query。

### Android 与 Native Bridge

Android 禁止 cleartext、mixed content、任意 `file://` 访问、第三方 Cookie和应用备份。`content://` 只允许通过系统文件选择器产生的显式授权使用，页面不能任意枚举内容提供者。业务页面以配置的远程 HTTPS Base URL 运行，不再通过 appassets 代理 Workspace 资源。Native Bridge 使用来源受限的消息通道，不使用对任意已加载页面开放的全局 JavaScript interface。麦克风、文件、通知、分享和 APK 安装等敏感操作要求可信主 Frame；需要用户意图的操作还要求近期明确手势。

APK 更新只接受 HTTPS 下载，下载前要求非空 SHA-256 和声明大小，下载过程限制最大 200 MiB 并同步校验大小和摘要。安装前验证包名为 `com.wheelmaker.android`、版本高于当前版本、签名证书与当前安装一致。Release 构建缺少显式 keystore、alias 或密码时必须失败，禁止回退到 debug 签名。

### 纵深防御

- 所有用户可控 Git revision 在进入 Git 前拒绝空值、前导 `-`、NUL 和换行，并使用 `--end-of-options`；路径继续使用 `--` 分隔。
- Registry WebSocket 默认 envelope 上限 1 MiB，普通 JSON payload 上限 64 KiB，登录 body 上限 4 KiB，speech 二进制 chunk 上限 8 MiB。
- HTTP 服务设置 header/read/write/idle timeout；所有请求体在 decode 前限制大小。
- 每连接 request ID 去重窗口最多 1024 项；Session、限速来源、pending request、异步队列、日志文件数和上传目录总字节数均有容量和过期淘汰。
- Registry 调试 envelope、应用诊断、配置 DTO、日志和导出按敏感键递归脱敏；`connect.init`、认证 body、Cookie、Authorization、query code 和第三方密钥不得记录。
- 当前仓库和工作树加入 Gitleaks 扫描，CI 与 pre-commit 阻止新增可用凭据。发现已暴露凭据时先完成外部轮换，再清理当前代码；历史重写不由普通实施计划执行。
- 生产 Web 返回严格 CSP、`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff` 和禁止 framing 的响应头。CSP 的 script/connect/style 来源必须按实际依赖精确列举，不允许任意远程 script 或通配 host。
- Webpack 开发服务器只监听 loopback，并只接受 localhost/loopback Host。
- Web 和 Android 的可安全升级依赖更新到修复安全告警的兼容版本；需要破坏性大版本升级的依赖单独记录和审批。

## 流程

### 首次启动与登录

1. 普通浏览器直接访问部署 Base URL；EXE/Android 无配置时显示 Bootstrap。
2. Bootstrap 验证用户输入为可规范化的 HTTPS Base URL，使用系统 TLS 连接探测，成功后私有保存并导航到远程 Workspace。
3. Workspace 从当前页面 URL 推导 `<base>/ws`，先请求认证状态。
4. 未认证时显示 Token 登录表单。Token 只保留在当前提交动作内存中，通过 HTTPS POST 发送。
5. Registry 校验同源、Fetch Metadata、请求体上限、限速和 Token，创建持久化设备 Session并设置安全 Cookie。
6. 页面立即清空 Token 输入和内存引用，以无 Token 的 `connect.init` 建立同源 Cookie WebSocket。

### 后续启动与续期

1. 普通浏览器使用当前页面 Base URL；EXE/Android 使用已保存 Base URL 直接加载远程 Workspace。
2. 浏览器自动携带 host-only Cookie，认证状态成功后建立同源 WebSocket。
3. Registry更新最后活动时间，并按合并写策略滑动到期时间；Registry 重启从受保护 Session 文件恢复。
4. Session 空闲超过 180 天、被撤销、达到淘汰条件或 Token generation 改变时，认证失败并重新显示登录表单。

### 服务器地址切换

1. 用户从启动壳或受信任业务页面选择修改服务器。
2. 客户端尝试调用旧服务器退出当前设备，随后无条件清除旧 Base URL 的 Cookie、缓存和站点数据。
3. 客户端清除旧业务 Bridge 授权和保存的 Base URL，回到 Bootstrap。
4. 新 URL 通过 HTTPS 验证后保存；Native Bridge 仅向新 Origin/Base Path 开放。

### Token 与密钥轮换

1. 部署或用户更新共享 Token时，以原子方式写入受保护配置。
2. Registry 检测 Token fingerprint/generation 变化，在接受新浏览器请求前撤销并持久化全部设备 Session。
3. 用户以新 Token 重新登录各设备。
4. 第三方密钥更新接口只接收新值并返回状态；旧值不得出现在响应、日志或诊断中。

## 验收标准

- 两次全新安装生成不同的 256-bit Token；随机源失败不产生可运行的弱配置。
- 空 Token 和公开旧默认 Token 会迁移或被所有运行入口拒绝；短自定义 Token 可继续运行，不因长度被阻断或自动替换。
- `config.json`、Bootstrap 配置和 `registry-sessions.json` 使用当前用户专属权限及原子写入；非当前低权限用户不能读取。
- Registry、Hub相关本地 HTTP 服务和 Relay listener 只绑定 loopback；启动时配置为 wildcard、LAN 或公网地址会失败。
- 只有 loopback Nginx 提供的 forwarded headers 生效，外部伪造头不能改变 scheme 或客户端地址判断。
- 根路径和子路径部署都能从一个 Base URL 正确派生 Web、登录和 WebSocket 地址；现有根路径 Nginx 不需要新增认证路由。
- EXE/Android 安装包不包含完整 Workspace bundle，不启动 Desktop 9632 资源服务器，也不存在 appassets Workspace 代理、远程资源回退或 Embedded/Remote/Auto 业务模式。
- EXE/Android 首次启动只显示 Bootstrap；无效 URL、HTTP、证书错误、userinfo、query 或 fragment 被拒绝且不能绕过。
- 服务器不可达时客户端只提供重试和修改地址，不加载内置旧版 Workspace。
- 修改服务器地址后旧 Origin/Base Path 不能调用 Native Bridge，旧站点数据在本地被删除。
- 普通浏览器不再显示独立 Registry 地址设置，始终使用当前 Base URL 同源连接。
- Web 启动会删除旧 localStorage/IndexedDB Token；完成迁移后浏览器、Android 和 EXE 持久化中不存在共享 Token。
- 带浏览器 Origin 的 WebSocket 只有严格同源有效 Cookie可以连接；跨 Origin、Token-in-`connect.init`、hub/monitor 角色声明均被拒绝。
- 无 Origin 的 Hub 连接继续使用共享 Token，错误 Token 使用常量时间比较并被拒绝。
- 登录错误触发来源级和全局限速，超限返回 `429`/`Retry-After`；登录 body 超过 4 KiB 被拒绝。
- Session Cookie 为 host-only、`HttpOnly`、`Secure`、`SameSite=Strict`，Path 与 Base Path 一致。
- Registry 重启后设备 Session 仍有效；持续活跃 Session 滑动续期，空闲 180 天后失效。
- 单设备撤销只影响目标设备；全部撤销影响所有设备；共享 Token 轮换立即使全部 Session 失效。
- 设备列表不显示 Cookie、摘要、CSRF 或 Token，只显示设备名称和时间等非敏感元数据。
- DeepSeek、语音和 TTS 密钥不再保存在浏览器，不由任何状态、配置、日志或诊断 API 返回原文；相关第三方调用无需把长期密钥交给页面。
- `wheelmaker-monitor` 源码、构建目标、配置字段、服务、二进制、端口、UI 和现行文档引用全部删除；升级能够清理 Windows/Linux/macOS 遗留安装。
- Relay 正确 code 保持现有跳转体验；错误爆破触发来源和 generation 限速；重新生成 code 使旧 code、旧 Cookie 和旧失败状态失效。
- Android 不可信 Origin、Base Path 外页面、iframe 和无用户手势请求不能调用敏感 Native Bridge。
- Android 拒绝 HTTP/mixed content；错误大小、哈希、包名、版本或签名的 APK 不得启动安装器；release 构建不得使用 debug 签名。
- Git revision option 注入不能创建文件或改变 Git 参数解释；所有受影响 Git 方法有回归测试。
- 超限 WebSocket、JSON、speech、request ID、队列、日志和上传请求被可预测地拒绝或淘汰，不造成无界内存/磁盘增长。
- 生产 Web 安全头和 CSP 实际出现在 HTTP 响应中；恶意 frame、非允许 script 和非允许 connect 来源被阻止。
- Gitleaks 对当前仓库和新增提交无可用凭据告警；已发现真实凭据完成轮换。历史 force-push 不作为普通验收步骤。
- Go、Web、Android 全量测试，Web 类型检查/生产构建，Android lint，监听检查和根路径/子路径端到端认证测试全部通过。

### 测试

- Go 单元测试覆盖 Token 生成与迁移、ACL/原子写、loopback、可信代理、URL/Origin/Base Path、Session 持久化与滑动续期、撤销、Token generation、登录与 Relay 限速、Git 参数和资源上限。
- Web/Jest 测试覆盖 Base URL 派生、旧 Token 清理、Cookie 登录状态机、设备管理、后端密钥 set-only UI、诊断脱敏和安全头构建结果。
- Desktop 测试覆盖 Bootstrap URL 校验、私有保存、直接远程导航、无 9632 Listener、地址切换清理和业务 Bridge Origin/Base Path 拒绝。
- Android 单元测试和 lint 覆盖 URL 策略、导航与 Bridge 来源、WebView 设置、权限请求、站点数据清理、APK 校验和 release 签名失败路径。
- 端到端测试至少覆盖根路径与一个子路径部署、普通浏览器、EXE、Android、Registry 重启、Token 轮换、恶意 Origin、错误证书和 Nginx forwarded headers。
- 安全扫描包括 `gitleaks`、Web 生产/完整依赖审计和 Android 依赖检查。
- 不测试或承诺绕过管理员/当前用户权限、调试器、已完全控制受信任登录页面的攻击者、自签名证书或离线完整 Workspace 使用。

## 范围之外

- Go 工具链版本升级。
- Git 历史重写、远端 refs force-push 和 clone 协调；它们需要单独维护窗口和审批。
- 阻止项目内 Junction/符号链接访问其真实目标。
- 多用户账户、租户隔离、细粒度 RBAC、OIDC、mTLS 或多个长期管理员 Token。
- Relay 高熵永久分享链接、长密码或设备配对协议。
- 自签名证书、证书错误忽略开关和 HTTP 远程服务器。
- EXE/Android 离线完整 Workspace、完整内置 Web 或远程失败时的旧版业务回退。
- 自动修改用户现有 Nginx 配置；现有根路径部署不需新增规则，选择子路径的用户负责提供相应反向代理映射。
