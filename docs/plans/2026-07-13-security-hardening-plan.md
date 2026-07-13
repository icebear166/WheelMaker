# WheelMaker Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持单用户、一个共享 Token、后端 loopback 监听、Nginx 公网入口和 Relay 易用性的前提下，移除默认 Token，防止 Token 被持久化到浏览器、Android、日志、诊断导出和公开 Git 历史，并修复其余已确认的高价值安全缺陷。

**Architecture:** 保留现有单一 `registry.token` 和 Hub 运行方式，但部署时为每个安装生成独立的 256-bit Token，并将整个 `config.json` 设为当前用户专属权限。浏览器通过 Nginx 的同源 HTTPS 登录页提交 Token 一次，Registry 验证后签发服务端会话和 HttpOnly/Secure/SameSite=Strict Cookie；后续 HTTP 与 WebSocket 不再由 JavaScript 保存或发送 Token。Registry、Monitor 和 Relay 继续只监听 loopback，Nginx 是唯一公网入口，并负责 TLS、WebSocket 代理和第一层限速。

**Tech Stack:** Go 1.26.x（本计划不升级 Go）、Gorilla WebSocket、React/TypeScript/Jest、Android Kotlin/WebView、Gradle。

---

## 已锁定的安全决策

1. **只保留一个长期共享 Token。** Hub、Registry、Monitor 和用户登录使用同一个 `registry.token`；不增加第二个 Web Token、设备 Token、OIDC、完整 RBAC、mTLS 或多租户密钥系统。Token 持有者视为该单用户系统的管理员。
2. **Cookie 不是第二个长期 Token。** 浏览器登录时通过 HTTPS 提交共享 Token 一次，成功后只持有随机、可过期、可撤销的 HttpOnly Session Cookie。Token 不写入 localStorage、IndexedDB、Android DOM Storage 或诊断数据。
3. **Loopback 是硬性不变量，不只是默认值。** Registry、Monitor、Desktop 资源服务、Hub 本地读取端点和 Relay 必须拒绝 `0.0.0.0`、`::` 及解析后不是 loopback 的主机。
4. **Nginx 是公网入口。** 后端看到的 `RemoteAddr` 可能始终是 loopback，不能据此认定浏览器已授权。登录、Session 和 WebSocket 必须校验 Nginx 暴露的公网 Host/Origin；只有请求确实来自 loopback 代理时才读取 `X-Forwarded-Proto` 和 `X-Real-IP`。
5. **Junction 行为被接受。** 项目根目录下的 Junction/符号链接可访问其实际目标，视为用户配置项目范围的一部分；本计划不改变 `safeJoin` 的该项语义，只在安全文档中记录信任边界。
6. **Go 升级暂缓。** 审计中 Go 标准库漏洞项保持在后续升级清单，本计划不改 `go.mod` 的 Go 版本，也不以此阻塞其他修复。
7. **Relay 不做架构重写。** 保留 query code 自动登录、Cookie、端口隧道和 6 位码。只补足门禁所必需的在线防护。
8. **“外界无法获得”按明确威胁边界验收。** 网络窃听者、未授权网页来源、Android 非可信页面、日志/诊断消费者和仓库访问者不能获得 Token。Token 在登录瞬间仍会经过受信任页面和 HTTPS 请求；已控制该页面的 XSS、相同操作系统用户、管理员、调试器或已控制本机的恶意进程仍可能获得它，这不可能由单 Token 登录模型彻底阻止。

## Access Code 可靠性结论

当前实现的登录后 Cookie 使用随机进程密钥和 HMAC-SHA256，并绑定 `relayID`、Access Code generation 和过期时间，伪造难度足够；Access Code 更新也会使旧 Cookie 失效。这一部分可靠。

当前 6 位 Access Code 只有约 20 bit 熵，且登录与 URL code 路径均无失败限速，因此：

- Relay 仅在 loopback、没有代理或隧道暴露时，它只能算防误访问门禁，不能抵抗恶意本机进程。
- Relay 经隧道或代理可被外部请求到时，当前实现不是可靠安全边界，攻击者可在线遍历 100 万种组合。
- 保留 6 位体验后，加入 Origin/Fetch Metadata 校验、每来源和每 Relay generation 的速率限制、失败退避、常量时间比较、`no-store`/`no-referrer` 后，可作为本系统的交互门禁。它仍不是可长期公开的高熵 API Key。

本计划采用以下固定策略：每来源允许突发 5 次失败并以每 30 秒 1 次补充；每个 Relay generation 全局允许突发 20 次失败并以每 30 秒 1 次补充；超限返回 `429` 和 `Retry-After`，成功登录清除该来源失败状态，重新生成 Access Code 清除整个 generation 的失败状态。来源优先使用可信隧道提供的客户端标识，否则使用 `RemoteAddr`；当所有请求只能看到 loopback 地址时，全局桶仍然有效。

## 文件结构

### Token、配置权限与本机边界

- Create: `server/internal/security/token.go` — 生成 256-bit Base64URL Token、拒绝空值和旧默认值。
- Create: `server/internal/security/token_test.go` — 随机性、长度、旧默认值和随机源失败测试。
- Create: `server/internal/shared/config_permissions_unix.go` — Unix `config.json` 的 `0600` 权限检查与修复。
- Create: `server/internal/shared/config_permissions_windows.go` — Windows 当前用户与 SYSTEM 专用 DACL。
- Modify: `server/internal/shared/shared_test.go` — 配置权限、Token 验证与失败路径测试。
- Create: `server/internal/security/loopback.go` — 统一监听地址、Host 和浏览器 Origin 校验。
- Create: `server/internal/security/loopback_test.go` — IPv4/IPv6 loopback 与拒绝非 loopback 测试。
- Modify: `server/internal/shared/config.go` — 保留单一 `registry.token`，浏览器来源由请求同源关系自动验证，不增加用户配置项。
- Modify: `server/cmd/wheelmaker-deploy/main.go` — 首次安装生成随机 Token，升级时替换旧默认值并收紧配置权限。
- Modify: `server/cmd/wheelmaker-deploy/main_test.go` — 验证不同安装 Token 不同、旧默认值被替换、现有自定义 Token 保持不变。
- Modify: `server/cmd/wheelmaker/main.go` — Registry/Hub 启动时必须加载有效 Token 并强制 loopback。
- Modify: `server/config.example.json` — 删除可用默认 Token，以空值提示部署生成，并展示公网 Origin allowlist。

### 浏览器 Session、Nginx 与泄漏面

- Create: `server/internal/registry/web_session.go` — Token 登录、随机服务端 Session、Cookie 和登录限速。
- Create: `server/internal/registry/web_session_test.go` — 登录、过期、撤销、Cookie flags、Origin 与限速测试。
- Modify: `server/internal/registry/server.go` — 增加登录/登出/状态端点，WebSocket 接受浏览器 Session 或原生 Token。
- Modify: `server/internal/registry/server_test.go` — 恶意 Origin、空 Token、自选角色、伪造 Cookie 和 Nginx 转发头回归测试。
- Modify: `app/web/src/registry/RegistryClient.ts` — 浏览器连接依赖同源 Session Cookie，不再把 Token 放入 `connect.init`。
- Modify: `app/web/src/app/WorkspaceApp.tsx` — Token 登录表单只在请求期间持有输入值，成功后清空。
- Modify: `app/web/src/workspace/WorkspacePersistence.ts` — 删除 Token 持久化并清理旧 localStorage key。
- Create: `app/__tests__/web-registry-session-auth.test.ts` — 验证登录、Cookie Session 和 Token 不持久化。
- Modify: `app/__tests__/web-chat-selection-persistence.test.ts` — 验证升级时删除旧 Token，不再保存新 Token。
- Modify: `server/cmd/wheelmaker-monitor/monitor.go` — 对外配置 DTO 永远不包含 Token 或密钥内容。
- Modify: `server/cmd/wheelmaker-monitor/auth.go` — 复用同一 Token 登录与安全 Session Cookie 规则。
- Modify: `server/cmd/wheelmaker-monitor/monitor_test.go` — 配置脱敏和本机会话测试。
- Create: `docs/nginx-security.md` — 同源 HTTPS、WebSocket、forwarded header 与登录限速配置要求。

### Relay

- Create: `server/internal/portrelay/login_guard.go` — 双层 token bucket 和失败状态清理。
- Create: `server/internal/portrelay/login_guard_test.go` — 限速、恢复、generation 隔离测试。
- Modify: `server/internal/portrelay/auth.go` — 常量时间 Access Code 比较和 Cookie 安全头。
- Modify: `server/internal/portrelay/listener.go` — 对 login 与 URL code 共用门禁，并校验请求来源。
- Modify: `server/internal/portrelay/listener_test.go` — 暴力尝试、恶意 Origin、Cookie 失效和正常体验回归测试。

### Android

- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/TrustedWebOriginPolicy.kt` — 唯一可信来源判定。
- Create: `mobile/android/app/src/test/java/com/wheelmaker/android/TrustedWebOriginPolicyTest.kt` — appassets、HTTPS allowlist 与拒绝 HTTP/子域欺骗测试。
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt` — 安全 WebView 设置和受来源约束的 native bridge。
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/StableOriginWebViewClient.kt` — 非可信导航交给系统浏览器。
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidApkUpdateRuntime.kt` — 下载大小、哈希、包名、版本和签名验证。
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidApkUpdateRuntimeTest.kt` — APK 拒绝与接受条件测试。
- Modify: `mobile/android/app/src/main/AndroidManifest.xml` — 禁止 cleartext 和备份。
- Modify: `mobile/android/app/build.gradle.kts` — 移除 release debug 签名，要求显式 release keystore。

### 其余纵深防御

- Modify: `server/internal/hub/reporter.go` — Git ref/SHA 参数终止与校验、递归诊断脱敏。
- Modify: `server/internal/hub/hub_test.go` — Git option injection 回归测试。
- Modify: `server/internal/registry/server.go` — WebSocket 大小限制、HTTP 超时、有界 request ID 缓存。
- Modify: `server/internal/registry/server_test.go` — 超限和资源回收测试。
- Modify: `app/web/src/debug/registryDebug.ts` — 按敏感键递归脱敏所有 envelope。
- Modify: `app/web/src/debug/appDiagnostics.ts` — 扩展敏感字段集合。
- Modify: `app/web/public/index.html` — CSP、Referrer Policy 和基础安全头等价 meta。
- Modify: `app/web/webpack.config.js` — 开发服务器仅 loopback 且限制 Host。
- Modify: `app/package.json`, `app/package-lock.json` — 修复可安全升级的 Web 生产依赖告警。
- Create: `docs/security.md` — 记录单用户、loopback、Junction、Relay 和 Android 信任边界。

---

### Task 1: 生成随机 Token 并安全写入 config.json

- [ ] **Step 1: 写随机 Token 和安装隔离测试**

在 `server/internal/security/token_test.go` 测试 `NewRegistryToken`：结果为 32 bytes 的 Base64URL 编码、两次生成不同、随机源失败直接返回错误。修改 `server/cmd/wheelmaker-deploy/main_test.go`，创建两个安装目录并断言其中的 `registry.token` 不同且均不是 `wheelmaker-local-token`。

```go
func TestNewRegistryTokenCreatesIndependentValues(t *testing.T) {
	first, err := NewRegistryToken(rand.Reader)
	if err != nil { t.Fatal(err) }
	second, err := NewRegistryToken(rand.Reader)
	if err != nil { t.Fatal(err) }
	if len(first) != 43 || len(second) != 43 || first == second {
		t.Fatalf("invalid generated tokens: len=%d/%d equal=%v", len(first), len(second), first == second)
	}
}
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd server; go test ./internal/security ./cmd/wheelmaker-deploy -run 'TestNewRegistryToken|TestEnsureConfig' -v`

Expected: FAIL，因为 `NewRegistryToken` 尚未定义，部署仍写固定 Token。

- [ ] **Step 3: 实现 Token 生成器**

`token.go` 使用 `io.ReadFull(crypto/rand.Reader, raw)` 生成 32 bytes 并以 `base64.RawURLEncoding` 编码。随机源失败必须向上传递，禁止 UUID、时间戳或固定字符串降级。

```go
func NewRegistryToken(source io.Reader) (string, error) {
	raw := make([]byte, 32)
	if _, err := io.ReadFull(source, raw); err != nil {
		return "", fmt.Errorf("generate registry token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
```

- [ ] **Step 4: 部署时写入随机 Token**

`ensureConfig` 首次安装调用 `security.NewRegistryToken(rand.Reader)`，把结果写入现有 `registry.token`。生成失败时部署停止，不创建半成品配置。

- [ ] **Step 5: 运行测试并提交**

Run: `cd server; go test ./internal/security ./cmd/wheelmaker-deploy -v`

Expected: PASS。

```bash
git add server/internal/security server/cmd/wheelmaker-deploy
git commit -m "fix: generate unique registry tokens"
```

### Task 2: 保护 config.json、迁移旧默认值并 fail closed

- [ ] **Step 1: 写迁移和权限测试**

覆盖四种情况：旧默认值自动替换为空间独立的新 Token；空 Token 自动替换；已有自定义 Token 原样保留；缺少 Token 的手工配置在运行时被拒绝。Unix 断言 `config.json` 为 `0600`；Windows 测试 DACL 不向普通 Users 组授予读取权限。

```go
if migrated.Registry.Token == "" || migrated.Registry.Token == "wheelmaker-local-token" {
	t.Fatalf("legacy token was not rotated: %q", migrated.Registry.Token)
}
if custom.Registry.Token != "user-supplied-random-token" {
	t.Fatalf("custom token changed during migration: %q", custom.Registry.Token)
}
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd server; go test ./cmd/wheelmaker-deploy ./cmd/wheelmaker ./internal/shared -run 'Token|ConfigPermission|RegistryConfig' -v`

Expected: FAIL，现有配置为 `0644`，Registry standalone 仍允许空 Token。

- [ ] **Step 3: 原子写入并收紧配置权限**

Unix 以 `0600` 创建并修复 `config.json`；Windows 使用 `golang.org/x/sys/windows` 写入仅当前用户和 SYSTEM full control 的 protected DACL。配置改写使用同目录临时文件、`Sync` 和 atomic rename；权限设置失败时部署失败。

- [ ] **Step 4: 保持 Hub 存储和构造方式不变**

继续由 `shared.LoadConfig` 填充 `cfg.Registry.Token`，Hub、Registry 和 Monitor 的运行时调用链不新增 Secret 文件或第二种长期 Token。只在进程启动边界调用：

```go
func ValidateRegistryToken(token string) error {
	if token == "" || token == "wheelmaker-local-token" {
		return errors.New("registry.token must be a generated non-default value")
	}
	return nil
}
```

部署迁移负责替换旧默认值；直接运行服务遇到空值或旧默认值必须 fail closed。

- [ ] **Step 5: 修改示例与 standalone 默认值**

`server/config.example.json` 使用空字符串表示“必须由部署生成或由用户设置”，不能包含可工作的默认值。`wheelmaker --registry-server` 默认地址改为 `127.0.0.1:9630`，不再从 `--registry-token` 进程参数接收敏感值；它和 worker 模式一样通过 `--dir` 加载受保护的 `config.json`，并在监听前验证 Token。

- [ ] **Step 6: 运行测试并提交**

Run: `cd server; go test ./cmd/wheelmaker-deploy ./cmd/wheelmaker ./internal/shared ./internal/hub -v`

Expected: PASS，Hub 数据库与协议测试保持不变。

```bash
git add server/config.example.json server/internal/shared server/cmd/wheelmaker server/cmd/wheelmaker-deploy
git commit -m "fix: protect registry token configuration"
```

### Task 3: 强制 loopback 后端并建立 Nginx 信任边界

- [ ] **Step 1: 写监听地址、Origin 和代理头表驱动测试**

接受 `127.0.0.1:9630`、`localhost:9630`、`[::1]:9630`；拒绝 `:9630`、`0.0.0.0:9630`、`[::]:9630`、LAN IP 和公网域名。Origin 只接受配置中精确的公网 scheme/host/port，不接受子域、userinfo 或字符串后缀。只有 `RemoteAddr` 为 loopback 时才读取 `X-Forwarded-Proto` 和 `X-Real-IP`。

- [ ] **Step 2: 实现统一 loopback 和 trusted proxy 校验器**

```go
func RequireLoopbackAddress(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil { return fmt.Errorf("invalid listen address %q: %w", addr, err) }
	if strings.EqualFold(host, "localhost") { return nil }
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() { return fmt.Errorf("listen host must be loopback: %q", host) }
	return nil
}

func IsTrustedProxyRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	return err == nil && net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback()
}
```

- [ ] **Step 3: 接入监听入口和 WebSocket Origin**

Registry、Monitor 和所有可配置 listener 在 `net.Listen` 前调用 `RequireLoopbackAddress`。移除 Registry `CheckOrigin: true`，浏览器 WebSocket 的 `Origin` 必须与可信请求 scheme、Host 和端口严格同源；无 Origin 的 Hub/Monitor 原生连接继续通过 `connect.init` Token 验证。

- [ ] **Step 4: 固定 Nginx 同源入口规则**

`docs/nginx-security.md` 规定页面、登录 API 和 Registry WebSocket 使用同一公网 origin，例如：

```nginx
limit_req_zone $binary_remote_addr zone=wheelmaker_login:10m rate=2r/m;

location = /registry/auth/login {
    limit_req zone=wheelmaker_login burst=5 nodelay;
    proxy_pass http://127.0.0.1:9630/auth/login;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
}

location /registry/ {
    proxy_pass http://127.0.0.1:9630/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

公网只开放 Nginx 的 HTTPS 端口；后端端口不绑定外网。登录 location 增加 Nginx `limit_req`，应用层仍保留独立限速。

- [ ] **Step 5: 增加恶意网页和伪造代理头测试**

`Origin: https://attacker.example` 即使携带有效 Cookie 也应在 WebSocket 握手时得到 403。非 loopback `RemoteAddr` 提供 `X-Forwarded-Proto: https` 或伪造 `X-Real-IP` 时必须忽略这些 header。

- [ ] **Step 6: 运行测试并提交**

Run: `cd server; go test ./internal/security ./internal/registry ./cmd/wheelmaker-monitor ./internal/portrelay -v`

Expected: PASS。

```bash
git add server/internal/security server/internal/registry server/internal/portrelay server/cmd/wheelmaker-monitor docs/nginx-security.md
git commit -m "fix: enforce loopback behind trusted nginx"
```

### Task 4: Token 登录后改用 HttpOnly Session Cookie

- [ ] **Step 1: 写 Session 状态机和 Cookie 测试**

Session ID 和 CSRF token 都使用独立的 32-byte 随机值，Registry 内存中保存 Session ID 的 SHA-256 摘要、CSRF token、创建时间、最后访问时间和 7 天绝对过期时间。测试登录成功、错误 Token、过期、登出撤销、服务重启失效、伪造 Cookie、CSRF 错误、最多 1024 个 Session 及最旧项淘汰。公网/Nginx Cookie 必须为 host-only、`HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/`；只有 Host 与 RemoteAddr 都是 loopback 的直接本地 HTTP 开发请求可省略 `Secure`。

- [ ] **Step 2: 实现服务端 Session store**

```go
type webSession struct {
	Digest     [32]byte
	CSRFToken  string
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  time.Time
}

type webSessionStore struct {
	mu       sync.Mutex
	sessions map[[32]byte]webSession
}

func (s *webSessionStore) Authenticate(raw string, now time.Time) (webSession, bool) {
	digest := sha256.Sum256([]byte(raw))
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[digest]
	if !ok || !now.Before(session.ExpiresAt) {
		delete(s.sessions, digest)
		return webSession{}, false
	}
	session.LastSeenAt = now
	s.sessions[digest] = session
	return session, true
}
```

- [ ] **Step 3: 实现登录、状态和登出端点**

`POST /auth/login` 使用 `http.MaxBytesReader(..., 4096)`，从 JSON body 读取共享 Token，以 `subtle.ConstantTimeCompare` 与 `cfg.Token` 比较。成功后创建 Session Cookie 并清除失败计数，响应返回内存使用的 CSRF token；失败响应统一为 401，不说明 Token 是否存在。`GET /auth/status` 对有效 Session 返回 authenticated bool 和 CSRF token；`POST /auth/logout` 从 store 删除 Session 并过期 Cookie。所有响应设置 `Cache-Control: no-store`。Cookie 的 `Secure` 判断只接受真实 TLS 或来自可信 loopback Nginx 的 `X-Forwarded-Proto: https`。

- [ ] **Step 4: 增加登录限速和 CSRF/Origin 约束**

每真实来源允许突发 5 次失败、每 30 秒补充 1 次；全局允许突发 20 次失败、每 30 秒补充 1 次。真实来源只从可信 loopback Nginx 的 `X-Real-IP` 获取。登录、登出和所有写操作校验精确 Origin；Cookie Session 的写操作继续要求 CSRF header。

- [ ] **Step 5: 区分浏览器 Session 与原生 Token 连接**

`/ws` 在 upgrade 前检查 Session Cookie。通过 Session 的连接只能声明 `client` 角色，`connect.init.payload.token` 必须为空；Hub/Monitor 的无 Cookie 原生连接继续提交同一个 `registry.token`，其现有协议和 Hub 存储方式不变。

- [ ] **Step 6: 修改 Web 登录和持久化**

`WorkspaceApp` 把用户输入的 Token 直接提交到同源 `/registry/auth/login`，请求完成后清空 React state。`RegistryClient` 连接同源 `wss://<public-host>/registry/ws`，由浏览器自动带 Cookie，不再在 `connect.init` 发送 Token。启动时执行：

```ts
window.localStorage.removeItem('wheelmaker.workspace.token');
```

删除 `LOCAL_TOKEN_KEY` 的读取、写入和诊断导出；地址仍可持久化。Android WebView 复用同一登录页面和 HttpOnly Cookie。

- [ ] **Step 7: 修改 Monitor 配置输出**

`GetConfigForDisplay` 从强类型配置构造 DTO，明确把 `registry.token` 替换为 `[redacted]`；禁止 `/api/config` 和 overview 直接返回 `config.json` 原文。Monitor 登录继续验证同一个 Token，但采用与 Registry 相同的 Cookie flags、Origin 和限速规则。

- [ ] **Step 8: 运行 Web 与 Go 测试**

Run: `cd app; npm test -- --runInBand web-registry-session-auth web-chat-selection-persistence`

Expected: PASS。

Run: `cd app; npm run tsc:web`

Expected: exit 0。

Run: `cd server; go test ./internal/registry ./cmd/wheelmaker-monitor ./internal/hub -v`

Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add server/internal/registry server/cmd/wheelmaker-monitor app/web/src/app app/web/src/registry app/web/src/workspace app/__tests__
git commit -m "feat: authenticate browsers with secure sessions"
```

### Task 5: 清除 Token 的日志、诊断和历史泄漏面

- [ ] **Step 1: 写递归脱敏测试**

测试对象同时包含 `token`、`accessToken`、`authorization`、`apiKey`、`appSecret`、`tenantKey`、`cookie`，并放入多层 object/array；断言值全部变为 `[redacted]`，普通字段保持不变。

- [ ] **Step 2: 实现统一敏感键策略**

Go 和 TypeScript 都用大小写不敏感的规范化键集合，不再按少数 method 特判。二进制字段仍标记长度，不写原文。Registry `connect.init` 无论 debug 开关如何都不得记录 credential payload。

```ts
const SENSITIVE_KEYS = /^(token|accessToken|refreshToken|authorization|apiKey|appSecret|tenantKey|cookie)$/i;
```

- [ ] **Step 3: 删除诊断导出中的本地 Token 与 API 密钥**

修改 Workspace dump、Monitor config/overview、Registry debug panel 和上传日志，使导出数据中不出现有效 Token、Session ID、DeepSeek key、飞书 secret 或 Cookie。`deepseekApiKey`、speech API key 等第三方凭据也从 IndexedDB/localStorage schema 移除，只保存在当前页面内存；需要长期保存时放入同样受用户专属权限保护的后端配置，Web API 只返回“已配置”状态。

- [ ] **Step 4: 轮换已公开凭据**

先轮换 `wheelmaker_diag_out.log` 历史中出现过的所有真实 Token、tenant key、app secret 和第三方 API key。轮换完成后才执行历史清理；公开历史即使删除也不能恢复旧凭据的保密性。

- [ ] **Step 5: 清理 Git 历史并加防回归扫描**

在获得仓库维护者明确的 force-push 窗口后，用 `git filter-repo` 删除诊断日志和敏感字段提交，force-push 所有受影响 refs，并通知所有 clone 重新获取。CI 与 pre-commit 增加 Gitleaks，基线不得包含可用凭据。

- [ ] **Step 6: 验证与提交代码侧防护**

Run: `gitleaks git --redact --no-banner .`

Expected: 0 个未允许告警。

Run: `cd app; npm test -- --runInBand web-debug-upload-service web-registry-debug-records`

Expected: PASS。

```bash
git add app/web/src/debug app/web/src/workspace app/__tests__ server/internal/hub server/internal/registry server/cmd/wheelmaker-monitor .gitleaks.toml
git commit -m "fix: redact credentials from diagnostics"
```

### Task 6: 加固 Relay Access Code，不改变主要体验

- [ ] **Step 1: 写门禁限速测试**

同一来源连续 5 次错误后，第 6 次返回 429；推进 fake clock 后恢复；不同来源仍受 generation 全局桶约束；正确码登录获得 Cookie；重新生成码后旧 Cookie、旧失败状态和旧码均失效。

- [ ] **Step 2: 实现双层 token bucket**

`loginGuard.Allow(source, generation, now)` 同时消费来源桶与 generation 桶。Map 条目带最后访问时间，每 10 分钟清理 30 分钟未使用项，最大保留 2048 来源，超过时淘汰最旧项，避免限速器自身成为内存 DoS。

同时删除 `NewController` 中 crypto/rand 失败时使用时间戳密钥的降级路径；随机源失败时 Relay 进入 error 状态并拒绝 enable，不能生成可预测 Cookie 签名密钥。

- [ ] **Step 3: 登录与 URL code 使用同一校验路径**

将 `handleLogin` 和 `handleURLAccessCode` 汇聚到单一函数：先校验 method、body 上限、Origin/`Sec-Fetch-Site`，再检查限速，最后用常量时间比较 Access Code。错误响应不区分“码错误”和“Relay 不存在”。

```go
func accessCodeMatches(got, want string) bool {
	if len(got) != len(want) || len(want) != 6 { return false }
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}
```

- [ ] **Step 4: 保留易用性并减少 URL 泄漏**

正确 query code 仍设置 Cookie 并立即 303 到去掉 code 的 URL。登录、重定向和错误响应统一设置 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`。日志只记 generation、结果和限速原因，不记 Access Code 或完整 query。

- [ ] **Step 5: 运行测试并提交**

Run: `cd server; go test ./internal/portrelay -v`

Expected: PASS。

```bash
git add server/internal/portrelay
git commit -m "fix: rate limit relay access code authentication"
```

### Task 7: Android WebView 与 native bridge 隔离

- [ ] **Step 1: 写可信来源策略测试**

只接受 `https://appassets.androidplatform.net` 和用户明确配置的精确 HTTPS origin；拒绝 HTTP、scheme 变化、端口变化、`trusted.example.attacker.test`、`trusted.example@attacker.test` 和 iframe 非主文档消息。

- [ ] **Step 2: 收紧 WebView 设置**

在 `MainActivity.configureWebView` 设置：

```kotlin
settings.allowFileAccess = false
settings.allowContentAccess = false
settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
settings.mediaPlaybackRequiresUserGesture = true
CookieManager.getInstance().setAcceptThirdPartyCookies(target, false)
```

Manifest 设置 `android:usesCleartextTraffic="false"`、`android:allowBackup="false"`。远程 Web source 只接受 HTTPS。

- [ ] **Step 3: 替换无来源约束的 JavaScript interface**

移除全局 `addJavascriptInterface("WheelMakerAndroidNative")`。使用 AndroidX WebKit `WebViewCompat.addWebMessageListener`，allowed origin rules 来自 `TrustedWebOriginPolicy`；消息包含操作名和 request ID，native 侧逐项 allowlist。语音、文件选择、APK 安装、通知和分享要求主 frame、当前可信 origin，敏感操作还要求近期用户手势。

- [ ] **Step 4: 限制导航和权限请求**

不可信 HTTP(S) 链接交给系统浏览器，不在有 native 能力的 WebView 中加载。麦克风权限只对当前可信主 frame 的明确请求授权；页面切换到非可信来源时取消 pending 权限和 native 会话。

- [ ] **Step 5: 运行 Android 单元测试**

Run: `cd mobile/android; ./gradlew.bat testDebugUnitTest`

Expected: BUILD SUCCESSFUL。

- [ ] **Step 6: Commit**

```bash
git add mobile/android/app/src/main mobile/android/app/src/test
git commit -m "fix: isolate Android native bridge by origin"
```

### Task 8: Android APK 更新与 release 签名

- [ ] **Step 1: 写更新包拒绝测试**

覆盖：缺少 SHA-256、哈希错误、超过 200 MiB、包名不是 `com.wheelmaker.android`、签名证书不匹配、版本不高于当前、下载 URL 不是 HTTPS。每种情况都不得启动 package installer。

- [ ] **Step 2: 下载时强制大小和哈希**

服务端元数据必须提供非空 SHA-256 和 byte size。下载同时计数和计算摘要，超过声明值或 200 MiB 立即删除临时文件；摘要使用常量时间比较。

- [ ] **Step 3: 安装前验证 APK 身份**

通过 `PackageManager.getPackageArchiveInfo` 读取 archive packageName、versionCode 和 signing certificate digest；要求包名固定、versionCode 更高、签名 digest 与当前已安装 App 相同。任何读取失败均 fail closed。

- [ ] **Step 4: 移除 release debug 签名**

`build.gradle.kts` 从 Gradle property/environment 读取 keystore 路径、alias 和密码；执行 `assembleRelease` 时缺少任一值必须明确失败，不回退到 debug keystore。敏感值不写入仓库。

- [ ] **Step 5: 验证并提交**

Run: `cd mobile/android; ./gradlew.bat testDebugUnitTest lintDebug`

Expected: BUILD SUCCESSFUL。

在提供临时测试 keystore 的 CI job 中运行：`./gradlew.bat assembleRelease`

Expected: release APK 使用指定证书，`apksigner verify --print-certs` 成功。

```bash
git add mobile/android/app/build.gradle.kts mobile/android/app/src/main/java/com/wheelmaker/android/AndroidApkUpdateRuntime.kt mobile/android/app/src/test/java/com/wheelmaker/android/AndroidApkUpdateRuntimeTest.kt
git commit -m "fix: verify Android updates and release signing"
```

### Task 9: 修复 Git option injection

- [ ] **Step 1: 写恶意 ref 回归测试**

对 `git.log` 提交 `--output=owned.txt`，断言请求返回 `INVALID_ARGUMENT` 且项目目录中没有 `owned.txt`。对 SHA 参数提交以 `-` 开头的值也必须拒绝。

- [ ] **Step 2: 实现 ref/SHA 解析与参数终止**

允许 `HEAD`、完整 40/64 hex object ID 和由 `git check-ref-format --branch` 验证的 ref；所有 revision 参数前插入 `--end-of-options`，路径参数继续放在 `--` 后。错误消息不回显未经处理的完整攻击字符串。

```go
func rejectGitOption(value string) error {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "-") || strings.ContainsAny(value, "\x00\r\n") {
		return errors.New("invalid git revision")
	}
	return nil
}
```

- [ ] **Step 3: 覆盖所有用户可控 revision 调用**

检查 `git.log`、commit files、commit diff、range diff 和更新检查路径；每个 revision 都在进入 `runGit` 前校验。保留文件路径的 `--` 分隔。

- [ ] **Step 4: 运行测试并提交**

Run: `cd server; go test ./internal/hub -run 'Test.*Git' -v`

Expected: PASS，且恶意文件不存在。

```bash
git add server/internal/hub/reporter.go server/internal/hub/hub_test.go
git commit -m "fix: reject git revision option injection"
```

### Task 10: 资源限制与服务抗 DoS

- [ ] **Step 1: 写超限测试**

覆盖超过 1 MiB 的 Registry envelope、超过 64 KiB 的普通 JSON payload、超过 4 KiB 的登录 body、超过 8 MiB 的 speech chunk、超过 1024 个 request ID、慢 header 和超过上传配额的 debug 文件。

- [ ] **Step 2: 设置 WebSocket 与 HTTP 限制**

升级后立即 `ws.SetReadLimit(1 << 20)`；speech 二进制采用独立 8 MiB 上限。HTTP server 设置 header/read/write/idle timeout，所有 JSON decoder 前使用 `http.MaxBytesReader`。

- [ ] **Step 3: 将 request ID 集合改为有界窗口**

用固定容量 1024 的 FIFO+set 替换永久增长的 `seenRequestIDs`；移除最旧 ID 时同步从 set 删除。Web Session、限速来源和 pending request 同样设置容量与过期清理。

- [ ] **Step 4: 限制日志和上传存储**

单文件保持现有大小限制，同时增加文件总数、目录总字节数和最旧文件淘汰；文件名由服务端生成，不接受路径片段。上传和登录 body 在 decode 前限制。

- [ ] **Step 5: 运行全量 Go 测试并提交**

Run: `cd server; go test ./...`

Expected: 全部 package PASS。

```bash
git add server/internal/registry server/internal/portrelay server/cmd/wheelmaker-monitor
git commit -m "fix: bound registry and HTTP resource usage"
```

### Task 11: Web CSP、开发服务器和依赖修复

- [ ] **Step 1: 添加 CSP 构建测试**

断言生产 HTML 含 `default-src 'self'`、`object-src 'none'`、`base-uri 'self'`、`frame-ancestors 'none'`，并仅为当前实际连接需求开放 `connect-src`。如果 Mermaid/KaTeX 需要 style 例外，使用构建期 nonce 或精确 hash，不开放任意远程 script。

- [ ] **Step 2: 修改生产 HTML 与开发服务器**

`webpack.config.js` 的 dev server 改为 `127.0.0.1`，`allowedHosts` 只包含 `localhost` 和 `127.0.0.1`。生产页面设置 `Referrer-Policy: no-referrer`、`X-Content-Type-Options` 等价策略和严格 CSP。

- [ ] **Step 3: 更新可独立修复的生产与开发依赖**

先更新 DOMPurify 所在直接/传递链和 Monaco 相关安全补丁，再修复开发依赖中的 `shell-quote`、`ws` 等高/严重告警，保持 Go 版本不变。每一组依赖单独执行测试和构建；无法无破坏更新的 Monaco 低危项记录精确依赖链和升级阻塞原因，不使用宽泛 audit ignore。

- [ ] **Step 4: 验证 Web**

Run: `cd app; npm audit --omit=dev`

Expected: 不再包含已修复的 moderate/high/critical 生产告警。

Run: `cd app; npm audit`

Expected: 开发依赖中不再存在 high/critical 告警。

Run: `cd app; npm test -- --runInBand; npm run tsc:web; npm run build:web`

Expected: Jest PASS、TypeScript exit 0、Webpack build success。

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/package-lock.json app/web/public/index.html app/web/webpack.config.js app/__tests__
git commit -m "fix: harden web delivery and dependencies"
```

### Task 12: 固化安全模型、验收和发布

- [ ] **Step 1: 编写 `docs/security.md`**

文档明确：单用户模型、一个共享 Token、Token 登录后换 HttpOnly Session Cookie、Nginx 公网边界、Android bridge 来源、所有后端服务 loopback、Relay 6 位码的适用边界、Junction 被视为项目范围延伸、Go 升级暂缓。

- [ ] **Step 2: 执行 Token 验收**

验证两次全新安装的 `registry.token` 不同；旧 `wheelmaker-local-token` 自动轮换；空 Token 服务拒绝启动；非当前操作系统用户不能读取 `config.json`；Token 可以存在于受保护配置中，但不得出现在进程参数、localStorage、IndexedDB、Monitor API、日志和诊断导出。登录后浏览器只持有 HttpOnly Cookie，登出、过期或 Registry 重启后 Session 不能复用。

- [ ] **Step 3: 执行网络验收**

用 `Get-NetTCPConnection`/`ss -ltnp` 确认所有 WheelMaker listener 只绑定 `127.0.0.1` 或 `::1`。经 Nginx 从恶意 Origin 发起登录、HTTP 写操作或 WebSocket 均得到 403；allowlisted 公网 Origin 使用共享 Token 登录后获得安全 Cookie 并连接成功；Cookie Session 不能声明 hub/monitor 角色，浏览器也不能继续用 `connect.init.payload.token` 绕过 Session。

- [ ] **Step 4: 执行 Relay 与 Android 验收**

Relay 正确 code 维持当前跳转体验，错误爆破触发 429，regenerate 使旧 Cookie 失效。Android 不可信页面不能调用 native 能力，HTTP/mixed content 被拒绝，错误签名或无哈希 APK 不触发安装器。

- [ ] **Step 5: 执行最终验证**

Run: `cd server; go test ./...`

Run: `cd app; npm test -- --runInBand; npm run tsc:web; npm run build:web; npm audit --omit=dev`

Run: `cd mobile/android; ./gradlew.bat testDebugUnitTest lintDebug`

Run: `gitleaks dir --redact --no-banner .`

Expected: 所有测试、类型检查和构建成功；生产依赖没有未处置的高/严重告警；Gitleaks 没有可用凭据告警。

- [ ] **Step 6: Commit documentation**

```bash
git add docs/security.md
git commit -m "docs: define WheelMaker security boundaries"
```

## 发布顺序与回滚边界

1. 先发布 Task 1–3，使新安装无默认 Token、旧默认值完成轮换、`config.json` 权限收紧，并确保后端 loopback 与 Nginx 信任边界正确。
2. 再同时发布 Task 4–5 的 Registry 与 Web，避免旧 Web 仍依赖已删除的持久 Token。允许一个版本的兼容迁移只负责删除旧 localStorage 值，不继续使用该值认证。
3. Task 6 Relay 可独立发布，出现问题时只回滚限速参数，不回滚常量时间比较、Origin 校验或安全响应头。
4. Task 7–8 Android 作为单独 APK 发布；release keystore 未配置时发布流水线必须停止。
5. Task 9–11 可分别发布。Task 10 的大小阈值通过常量集中定义，若真实业务消息触及阈值，只调整经过测试的上限，不移除上限。
6. 最后轮换已暴露凭据、执行 Git 历史清理并运行 Task 12 全部验收。历史重写需要单独维护窗口，不与普通应用发布混在同一回滚操作中。

## 明确暂缓项

- 不升级 Go；保留独立依赖升级事项，后续升级到覆盖审计漏洞修复的 Go patch 版本。
- 不阻止项目内 Junction/符号链接访问实际目标。
- 不引入多用户账户、云端身份、OIDC、mTLS 或通用 RBAC。
- 不把 Relay 6 位 Access Code 改成长密码；如果未来 Relay 长期直接暴露公网，再单独引入 128-bit share link 或设备配对凭据。
