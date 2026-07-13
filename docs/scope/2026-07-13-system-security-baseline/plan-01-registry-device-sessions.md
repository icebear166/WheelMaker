# Registry Device Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 7 天内存 Web Session 升级为同一 `/ws?auth=...` 入口下的 180 天滑动、可持久化、可列出和撤销的设备 Session，同时保持旧原生壳的过渡连接可用。

**Architecture:** Registry 从请求路径推导规范化 Base Path，把认证 HTTP 和 WebSocket 汇聚到同一个 `<base>/ws` handler。Session Cookie 原文只存在于浏览器和请求内存，磁盘只存 SHA-256 摘要及设备元数据；CSRF 由 Registry Token 和 Cookie 原文按域分离 HMAC 派生。Session 文件使用现有私有原子写入器，Token fingerprint 改变时先清空 Session 再接受浏览器请求。

**Tech Stack:** Go 1.26.x、`net/http`、Gorilla WebSocket、SHA-256/HMAC、JSON、现有 `shared.WriteConfigFile`、Go testing。

---

### Task 1: 建立 Base URL/Base Path 路由规则

**Files:**

- Create: `server/internal/security/base_url.go`
- Create: `server/internal/security/base_url_test.go`
- Create: `server/internal/registry/http_routes.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`

- [x] **Step 1: 写 HTTPS Base URL 和 Registry 路由失败测试**

测试表必须覆盖：

```go
tests := []struct {
	raw, normalized string
	ok              bool
}{
	{"https://example.com", "https://example.com/", true},
	{"https://example.com:8443/wheelmaker", "https://example.com:8443/wheelmaker/", true},
	{"https://127.0.0.1/app/", "https://127.0.0.1/app/", true},
	{"http://example.com/", "", false},
	{"https://user@example.com/", "", false},
	{"https://example.com/?x=1", "", false},
	{"https://example.com/#x", "", false},
}
```

另在 `server_test.go` 对 `POST /ws?auth=login`、`GET /wheelmaker/ws?auth=status` 和 `/wheelmaker/ws` Upgrade 写路由测试；`/auth/login`、`/wheelmaker/not-ws`、`/foo/ws/extra` 必须为 `404`。

- [x] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/security ./internal/registry -run 'TestNormalizeHTTPSBaseURL|TestRegistryBasePath|TestAuthRoutesUseWSPath' -v
```

Expected: FAIL，因为规范化函数和 suffix route 尚不存在，当前 handler 仍注册 `/auth/*`。

- [x] **Step 3: 实现规范化和单一 handler**

`NormalizeHTTPSBaseURL` 必须使用 `net/url` 解析、拒绝不安全字段并以目录 URL 返回；不得通过字符串前缀判断 hostname。

```go
func NormalizeHTTPSBaseURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, ErrInvalidHTTPSBaseURL
	}
	u.Path = path.Clean("/" + strings.TrimPrefix(u.EscapedPath(), "/"))
	if u.Path == "." || u.Path == "//" { u.Path = "/" }
	if !strings.HasSuffix(u.Path, "/") { u.Path += "/" }
	u.RawPath = ""
	return u, nil
}
```

`http_routes.go` 从严格的 `/<optional segments>/ws` 提取 Base Path：`/ws -> /`，`/wheelmaker/ws -> /wheelmaker/`。query 只允许 `login|status|logout`；无 `auth` 时才进入 WebSocket handler。不要注册新的 Nginx Location。

- [x] **Step 4: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/security ./internal/registry -run 'TestNormalizeHTTPSBaseURL|TestRegistryBasePath|TestAuthRoutesUseWSPath' -v
git add internal/security/base_url.go internal/security/base_url_test.go internal/registry/http_routes.go internal/registry/server.go internal/registry/server_test.go
git commit -m "feat: route registry auth through base websocket path"
```

Expected: PASS；提交只包含 Base URL/路由基础。

### Task 2: 将设备 Session 私有持久化

**Files:**

- Rewrite: `server/internal/registry/web_session.go`
- Create: `server/internal/registry/web_session_file.go`
- Modify: `server/internal/registry/web_session_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/cmd/wheelmaker/main.go`

- [x] **Step 1: 写持久化、滑动续期和 Token 轮换测试**

使用临时目录和可控 clock 验证：

- 创建后文件只含摘要，不含 Cookie 原文、共享 Token 或 CSRF 原文。
- 重建 store 后相同 Cookie 仍认证成功。
- 活跃后 `ExpiresAt = LastSeenAt + 180 days`，高频 touch 在 5 分钟内只合并一次磁盘写。
- 空闲 180 天失效。
- Session 超过 1024 时先删过期/撤销记录，再淘汰 `LastSeenAt` 最旧项。
- 文件超过 1 MiB、JSON 版本未知或权限修复失败时 fail closed。
- Token fingerprint 与文件不符时清空并原子写回，短自定义 Token 仍可使用。

持久记录固定为：

```go
type persistedDeviceSession struct {
	DeviceID    string    `json:"deviceId"`
	Digest      string    `json:"digest"`
	DeviceName  string    `json:"deviceName"`
	BasePath    string    `json:"basePath"`
	CreatedAt   time.Time `json:"createdAt"`
	LastSeenAt  time.Time `json:"lastSeenAt"`
	ExpiresAt   time.Time `json:"expiresAt"`
}
```

- [x] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/registry -run 'TestWebSession.*(Persist|Slide|Rotate|Capacity|Private|Corrupt)' -v
```

Expected: FAIL；当前 store 只有内存 map、7 天固定到期和明文 CSRF。

- [x] **Step 3: 实现摘要存储和派生 CSRF**

使用固定域分离字符串，避免同一 HMAC 被其他用途复用：

```go
func deriveSessionCSRF(registryToken, rawCookie string) string {
	mac := hmac.New(sha256.New, []byte(registryToken))
	_, _ = mac.Write([]byte("wheelmaker/registry-session-csrf/v1\x00"))
	_, _ = mac.Write([]byte(rawCookie))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func registryTokenFingerprint(token string) string {
	sum := sha256.Sum256([]byte("wheelmaker/registry-token/v1\x00" + token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
```

`web_session_file.go` 用 `io.LimitReader(file, 1<<20+1)` 限制读取，用 `shared.WriteConfigFile` 写版本化 JSON。禁止保存 raw Cookie 和 CSRF。Store 对外返回复制后的安全 DTO，不把内部 digest 暴露给协议层。

- [x] **Step 4: 接入 Registry state dir**

给 `registry.Config` 增加 `StateDir string`。`runRegistryServer` 和 `runRegistryWorker` 传入 WheelMaker `baseDir`，Registry 在开始监听前加载 `<StateDir>/registry-sessions.json`。加载或权限修复失败时 `Run` 返回错误，不启动弱化的空内存替代方案。

- [x] **Step 5: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/registry ./internal/shared ./cmd/wheelmaker -run 'TestWebSession|TestRunRegistry' -v
git add internal/registry/web_session.go internal/registry/web_session_file.go internal/registry/web_session_test.go internal/registry/server.go cmd/wheelmaker/main.go
git commit -m "feat: persist registry device sessions"
```

Expected: PASS；Session 文件走现有跨平台私有权限实现。

### Task 3: 完成 `/ws?auth=` 登录状态机

**Files:**

- Modify: `server/internal/security/loopback.go`
- Modify: `server/internal/security/loopback_test.go`
- Modify: `server/internal/registry/web_auth.go`
- Modify: `server/internal/registry/server_test.go`

- [x] **Step 1: 写请求来源和 Cookie 属性测试**

测试根路径和 `/wheelmaker/`：

- login body 大于 4 KiB、第二个 JSON 值、未知字段、空 Token 均拒绝。
- 写请求要求精确 `Origin`，`Sec-Fetch-Site` 只能为 `same-origin` 或受测试客户端明确省略，`Sec-Fetch-Mode` 不能为 `navigate`/`no-cors`。
- forwarded scheme 仅在直接对端 loopback 时可信。
- Cookie 为 host-only、`HttpOnly`、`Secure`、`SameSite=Strict`，Path 分别为 `/` 和 `/wheelmaker/`。
- status 返回 `authenticated`、派生 CSRF 和当前设备非敏感信息。
- logout 要求 CSRF 常量时间比较，撤销当前设备并使用相同 Path 清 Cookie。
- 所有响应含 `Cache-Control: no-store` 和 `Referrer-Policy: no-referrer`。

- [x] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/security ./internal/registry -run 'TestWebAuth|TestBrowserWrite|TestForwarded' -v
```

Expected: FAIL；当前路径固定、Cookie Path 为 `/`、Secure 取决于请求且 Fetch Metadata 未验证。

- [x] **Step 3: 实现认证处理**

Login payload 固定为：

```go
type webLoginPayload struct {
	Token      string `json:"token"`
	DeviceName string `json:"deviceName"`
}
```

设备名 trim 后限制 1–80 UTF-8 字符；空值使用 `Browser`。比较 Token 使用 `subtle.ConstantTimeCompare`，成功后立即把 payload Token 置空。`status` 不返回 Token fingerprint、digest 或内部 CSRF key。

- [x] **Step 4: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/security ./internal/registry -run 'TestWebAuth|TestBrowserWrite|TestForwarded' -v
git add internal/security/loopback.go internal/security/loopback_test.go internal/registry/web_auth.go internal/registry/server_test.go
git commit -m "feat: complete registry device login flow"
```

Expected: PASS；根路径用户仍只需现有 `/ws` 代理。

### Task 4: 增加设备列表和撤销协议

**Files:**

- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/protocol/registry.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Create: `app/__tests__/web-registry-device-session-protocol.test.ts`

- [x] **Step 1: 写 Go/TypeScript 协议契约测试**

固定方法名与 payload，禁止后续阶段各自发明名称：

```text
security.session.list
security.session.revoke       { deviceId }
security.session.revokeAll    {}
```

列表 DTO 只允许 `deviceId`、`deviceName`、`basePath`、`createdAt`、`lastSeenAt`、`expiresAt`、`current`。测试断言序列化结果不含 `token`、`cookie`、`digest`、`csrf`、`fingerprint`。

- [x] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/protocol ./internal/registry -run 'Test.*Session.*(Method|List|Revoke)' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-registry-device-session-protocol.test.ts
```

Expected: FAIL；方法、类型和 repository API 尚不存在。

- [x] **Step 3: 实现协议和 Registry handler**

只有完成 `connect.init` 的 `client` 可调用。撤销其他设备只删目标；撤销当前设备或 `revokeAll` 在响应写出后关闭对应已连接浏览器 peer。用 `connectionState.browserDeviceID` 关联在线连接，不把 Cookie 原文放入 state 或日志。

- [x] **Step 4: 实现 Web repository 方法**

```ts
listDeviceSessions(): Promise<RegistryDeviceSession[]>;
revokeDeviceSession(deviceId: string): Promise<void>;
revokeAllDeviceSessions(): Promise<void>;
```

Repository 只传 public `deviceId`，不得接受或返回 raw credential。

- [x] **Step 5: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/protocol ./internal/registry -run 'Test.*Session.*(Method|List|Revoke)' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-registry-device-session-protocol.test.ts
npm run tsc:web
Set-Location ..
git add server/internal/protocol server/internal/registry app/web/src/registry app/__tests__/web-registry-device-session-protocol.test.ts
git commit -m "feat: add registry device session management"
```

Expected: Go/TypeScript 契约一致且全部 PASS。

### Task 5: 验证兼容阶段并发布基础

- [x] **Step 1: 运行 Registry 全量测试和 race 检查**

Run:

```powershell
Set-Location server
go test ./internal/security ./internal/shared ./internal/protocol ./internal/registry ./cmd/wheelmaker
go test -race ./internal/registry
```

Expected: PASS；Windows 若 race 构建环境不可用，记录工具链错误，并在 Linux CI 必须执行该命令。

- [x] **Step 2: 明确保留过渡认证测试**

Run:

```powershell
Set-Location server
go test ./internal/registry -run 'TestWebSocketCrossOriginWithoutSessionUsesTokenAuthentication|TestWebSocket.*NoOrigin.*Token' -v
```

Expected: PASS。此处刻意不删除跨 Origin 原生壳 Token 路径；删除动作只允许在阶段 5 与 Web 同批完成。

- [x] **Step 3: 推送阶段提交**

Run:

```powershell
git status --short
git push origin HEAD
```

Expected: 工作树为空，阶段 1 的四个提交均已推送。
