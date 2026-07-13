# Relay, Git, and Resource Boundary Defense Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 Relay 6 位码体验的前提下补齐在线爆破防护，并对 Git revision、Registry 网络输入、并发 map/queue、日志和上传目录建立可测试的硬上限。

**Architecture:** Relay 登录表单和 URL code 汇聚到同一个常量时间校验器，错误同时消费 source/generation token bucket。Git 所有用户 revision 先经过统一 validator，再以 `--end-of-options` 进入命令。Registry 先限制 wire frame，再按 method 限制 envelope/payload；所有长寿命集合使用固定容量和过期/最久未使用淘汰。

**Tech Stack:** Go、`crypto/subtle`、token bucket、`net/http`、Gorilla WebSocket、Git CLI、bounded ring/LRU、Go race tests。

---

### Task 1: Relay Access Code 双层限速和随机源 fail-closed

**Files:**

- Create: `server/internal/portrelay/login_guard.go`
- Create: `server/internal/portrelay/login_guard_test.go`
- Modify: `server/internal/portrelay/types.go`
- Modify: `server/internal/portrelay/auth.go`
- Modify: `server/internal/portrelay/listener.go`
- Modify: `server/internal/portrelay/listener_test.go`
- Modify: `server/internal/registry/server.go`

- [x] **Step 1: 写精确 token bucket 测试**

用 fake clock 固定规则：source burst 5、generation burst 20、两者每 30 秒 refill 1。一次错误必须同时消费两个桶；任一为空返回 `429` 和向上取整的 `Retry-After`。成功清除该 source；regenerate/enable 新 generation 清除全局及 source 状态。Source map 上限 4096，超过后淘汰最久未活动项；1 小时未活动项可清理。

- [x] **Step 2: 写随机源失败测试**

Controller secret、relay ID、nonce 任一随机读取失败都返回 error，不能使用时间戳 fallback，也不能启动 listener。把 random reader 注入测试，不替换全局 `crypto/rand.Reader`。

- [x] **Step 3: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/portrelay -run 'TestLoginGuard|TestControllerRandomFailure' -v
```

Expected: FAIL；guard 不存在，`NewController` 当前会用 UnixNano 生成弱 secret。

- [x] **Step 4: 实现 guard 和 error-returning constructor**

`NewController` 改为 `func NewController(cfg ControllerConfig) (*Controller, error)`；Registry 必须向上传递初始化错误。比较器对 6 字节候选执行常量时间比较：

```go
func accessCodeEqual(candidate, expected string) bool {
	var left, right [6]byte
	copy(left[:], []byte(candidate))
	copy(right[:], []byte(expected))
	validLength := subtle.ConstantTimeEq(int32(len(candidate)), 6)
	return validLength&subtle.ConstantTimeCompare(left[:], right[:]) == 1
}
```

登录 POST、URL code 和 clear-site-data 的 code 参数必须调用同一个 `authorizeAccessCode`，禁止分支各自直接 `==`。

- [x] **Step 5: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/portrelay ./internal/registry -run 'Test(LoginGuard|ControllerRandom|Relay)' -v
git add internal/portrelay internal/registry/server.go
git commit -m "fix: rate limit relay access codes"
```

Expected: PASS；随机源失败 fail closed。

### Task 2: Relay 校验请求来源并阻止 code 泄漏

**Files:**

- Modify: `server/internal/portrelay/auth.go`
- Modify: `server/internal/portrelay/listener.go`
- Modify: `server/internal/portrelay/listener_test.go`

- [x] **Step 1: 写 Origin/Fetch Metadata 表测试**

- POST login：要求 `Origin` 与可信请求 scheme/host/port 完全一致；cross-origin/missing Origin 拒绝 403。
- 顶层 URL code：只接受 `GET` + `Sec-Fetch-Mode: navigate` + `Sec-Fetch-Dest: document` + `Sec-Fetch-Site: none|same-origin`；iframe/cors/no-cors/cross-site 拒绝。
- 只有直接对端为 loopback 时才读取 `X-Forwarded-Proto`/`X-Real-IP`；外部伪造头不改变 origin/source。
- 成功 code 立刻 `303` 到不含 `__wm_relay_code` 的相对 URL。
- login/code/error/429/redirect 都含 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`；日志不含 code 或完整 query。

- [x] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/portrelay -run 'TestRelay.*(Origin|Fetch|Headers|StripsCode|Forwarded)' -v
```

Expected: FAIL；当前 POST/URL code 无来源校验且 forwarded proto 无 peer 限制。

- [x] **Step 3: 实现统一 header middleware**

在 Relay internal handler 最外层先设置 no-store/no-referrer；source 地址复用 `security.ClientIP` 的可信 proxy 规则。不要限制被 relay 的业务站点自身响应缓存，只限制 `__wheelmaker` 门禁响应和带 code 的 redirect。

- [x] **Step 4: 加入 listener HTTP timeouts**

```go
srv := &http.Server{
	Handler:           handler,
	ReadHeaderTimeout: 5 * time.Second,
	ReadTimeout:       15 * time.Second,
	WriteTimeout:      30 * time.Second,
	IdleTimeout:       60 * time.Second,
}
```

WebSocket/tunnel 的长连接在 Upgrade 后不受 HTTP WriteTimeout 误杀。

- [x] **Step 5: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/portrelay
git add internal/portrelay
git commit -m "fix: validate relay login request origins"
```

Expected: PASS；正常浏览器 code 打开仍一次跳转成功。

### Task 3: 修复所有 Git revision option injection

**Files:**

- Create: `server/internal/hub/git_args.go`
- Create: `server/internal/hub/git_args_test.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`

- [x] **Step 1: 写恶意 revision 回归测试**

覆盖 `ref`、`refs[]`、`sha`、`base`、`head`：空、前导 `-`、NUL、CR/LF、超过 1024 bytes 均 invalid argument。至少用临时 Git repo 验证 `--output=<temp>`、`--help`、`-c...` 不能创建文件或改变参数解析。合法 `HEAD`、SHA、`origin/main`、tag 和 `base..head` 继续成功。

- [x] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/hub -run 'TestGitRevision|TestReporterGit.*Option' -v
```

Expected: FAIL；当前多个方法直接把用户 revision 传给 Git。

- [x] **Step 3: 实现统一 validator 和参数 builder**

```go
func validateGitRevision(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 1024 || strings.HasPrefix(value, "-") || strings.ContainsAny(value, "\x00\r\n") {
		return "", errInvalidGitRevision
	}
	return value, nil
}
```

每条含 revision 的命令在 options 后、revision 前放 `--end-of-options`；path 继续在独立 `--` 后。先分别校验 base/head，再构造 range。Git 输出得到的 tag 再作为参数使用时也走相同 builder。

- [x] **Step 4: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/hub -run 'TestGit|TestReporterGit' -v
git add internal/hub/git_args.go internal/hub/git_args_test.go internal/hub/reporter.go internal/hub/hub_test.go
git commit -m "fix: isolate user git revision arguments"
```

Expected: PASS；恶意 option 无副作用。

### Task 4: Registry 限制 wire frame、JSON 和 speech 输入

**Files:**

- Create: `server/internal/registry/input_limits.go`
- Create: `server/internal/registry/input_limits_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`
- Modify: `server/internal/registry/speech_service.go`
- Modify: `server/internal/registry/speech_test.go`

- [x] **Step 1: 写边界值测试**

固定上限：普通 JSON payload 64 KiB、普通 envelope 1 MiB、speech chunk payload 8 MiB、wire message 8 MiB + 64 KiB framing allowance。测试 limit-1/limit/limit+1，超限返回稳定 `payload_too_large` 后关闭或丢弃，不分配第二份无界 buffer。

登录 4 KiB 已在阶段 1 覆盖，本 Task 加 second JSON/trailing garbage 和 Content-Length 欺骗测试。

- [x] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/registry -run 'Test(InputLimit|WebSocket.*TooLarge|Speech.*TooLarge)' -v
```

Expected: FAIL；当前 websocket `ReadJSON` 没有全局 read limit，普通 payload 无 64 KiB 门。

- [x] **Step 3: 实现单次受限 decode**

WebSocket 先 `SetReadLimit(maxWireMessageBytes)`，用 `ReadMessage` 得到受限 frame，再 decode envelope header/RawMessage；只有 method 为 `speech.chunk` 才允许大 payload。不要先 unmarshal 到 `map[string]any` 再检查长度。

- [x] **Step 4: 给 Registry HTTP server 设置 timeout**

`ReadHeaderTimeout=5s`、`ReadTimeout=15s`、`WriteTimeout=30s`、`IdleTimeout=60s`。Upgrade 后的 WebSocket 使用现有 ping/idle 规则，不依赖 HTTP timeout。

- [x] **Step 5: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/registry -run 'Test(InputLimit|WebSocket|Speech|WebAuth)' -v
git add internal/registry/input_limits.go internal/registry/input_limits_test.go internal/registry/server.go internal/registry/server_test.go internal/registry/speech_service.go internal/registry/speech_test.go
git commit -m "fix: bound registry network input"
```

Expected: PASS；超限行为确定且无 panic。

### Task 5: 有界 request/pending/queue 和磁盘上传

**Files:**

- Create: `server/internal/registry/request_id_window.go`
- Create: `server/internal/registry/request_id_window_test.go`
- Create: `server/internal/registry/upload_quota.go`
- Create: `server/internal/registry/upload_quota_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`
- Modify: `server/internal/shared/logger.go`
- Modify: `server/internal/shared/shared_test.go`

- [ ] **Step 1: 写容量和淘汰测试**

固定：每连接 seen request ID 1024 ring；pending forward 1024；每 queue 64（terminal 现有 128）；debug uploads 最多 128 文件且目录总计 64 MiB；单文件仍 512 KiB；daily log archive 最多当前 + 7 个。达到 pending/queue 上限返回 `busy`，不能 block reader goroutine 或创建额外 goroutine。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/registry ./internal/shared -run 'Test(RequestIDWindow|PendingLimit|QueueLimit|UploadQuota|LogRetention)' -v
```

Expected: FAIL；seen request ID 和 pending map 可无界增长，upload 目录无总量淘汰。

- [ ] **Step 3: 实现 ring/LRU 和上传 quota**

Request ID ring 在覆盖旧 ID 时同步从 set 删除。Upload 写入临时私有文件，sync/close 后 rename；写前/后都执行 quota，按 mtime 删除最旧 regular file，拒绝 symlink/reparse point 和目录项。所有删除目标先 resolve 并验证仍在 LogDir 内。

- [ ] **Step 4: 运行 race/压力测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/registry ./internal/shared
go test -race ./internal/registry -run 'Test(RequestIDWindow|PendingLimit|QueueLimit|UploadQuota)' -count=10
Set-Location ..
git add server/internal/registry server/internal/shared
git commit -m "fix: bound registry memory and upload retention"
```

Expected: PASS；Windows 本机 race 不可用时由 Linux CI 执行同命令。

### Task 6: 执行资源防护验收

- [ ] **Step 1: 运行受影响全量测试**

Run:

```powershell
Set-Location server
go test ./internal/portrelay ./internal/hub ./internal/registry ./internal/shared ./...
```

Expected: PASS。

- [ ] **Step 2: 运行结构门**

Run:

```powershell
rg -n 'AccessCode|accessCode' server/internal/portrelay --glob '*.go'
rg -n 'runGit\(root.*(p\.SHA|p\.Base|p\.Head|ref)' server/internal/hub/reporter.go
```

Expected: 第一条所有比较点都汇聚到统一 authorizer，日志不打印 code；第二条无直接未验证参数命中。

- [ ] **Step 3: 推送阶段提交**

Run:

```powershell
git status --short
git push origin HEAD
```

Expected: 工作树为空，阶段 6 已推送。
