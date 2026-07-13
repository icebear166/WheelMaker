# Browser Cookie Authentication Hard-Cut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 普通浏览器、Desktop 远程页和 Android 远程页全部从当前页面 Base URL 使用 Cookie 设备 Session，彻底删除页面 Token/独立 Registry 地址，并让 Registry 拒绝所有带 Origin 的 Token WebSocket。

**Architecture:** Web 从 `document.baseURI` 派生同路径 `/ws?auth=` 和 `wss .../ws`，登录 Token 只存在于一次 fetch 的局部变量。Repository 连接不再接收 token。Registry 在 Upgrade 前按 Origin 分流：有 Origin 必须严格同源且有有效 Cookie；无 Origin 才进入 Hub/后端 Token `connect.init`。Web 与这个 Registry 行为以一个提交、一个发布批次切换。

**Tech Stack:** React/TypeScript、Fetch credentials、browser WebSocket Cookie、Jest、Go/Gorilla WebSocket、Registry device sessions、webpack public path。

---

### Task 1: 建立同一 Base URL 的 Web 认证客户端（尚不切换连接）

**Files:**

- Create: `app/web/src/registry/registryBaseUrl.ts`
- Create: `app/web/src/registry/RegistryWebAuthClient.ts`
- Create: `app/__tests__/web-registry-base-url.test.ts`
- Create: `app/__tests__/web-registry-auth-client.test.ts`
- Modify: `app/web/webpack.config.js`
- Modify: `app/web/public/index.html`

- [x] **Step 1: 写根路径/子路径 URL 派生测试**

固定派生结果：

```ts
deriveRegistryEndpoints('https://wheelmaker.top/')
// authURL: https://wheelmaker.top/ws
// wsURL:   wss://wheelmaker.top/ws
// basePath: /

deriveRegistryEndpoints('https://example.com:8443/wheelmaker/')
// authURL: https://example.com:8443/wheelmaker/ws
// wsURL:   wss://example.com:8443/wheelmaker/ws
// basePath: /wheelmaker/
```

拒绝 HTTP（测试环境可显式注入 localhost exception，但生产 build 不允许）、userinfo/query/fragment 和非目录 URL。测试 `authURL.searchParams.set('auth', action)`，禁止字符串拼接 query。

- [x] **Step 2: 写 auth client 请求测试**

使用 fake fetch 断言 status/login/logout 都 `credentials: 'same-origin'`、`cache: 'no-store'`；写请求带 `Origin` 由浏览器控制、应用只设置 JSON/CSRF header。Login 局部 token 在 fetch resolve/reject 后清空，不写 debug sink。

- [x] **Step 3: 运行测试并确认失败**

Run:

```powershell
Set-Location app
npm test -- --runInBand __tests__/web-registry-base-url.test.ts __tests__/web-registry-auth-client.test.ts
```

Expected: FAIL；endpoint/auth client 尚不存在。

- [x] **Step 4: 实现 helper 和子路径 asset 支持**

webpack production `output.publicPath` 使用 `'auto'`，HTML 保持相对部署可用。不要硬编码 `wheelmaker.top` 或任何用户域名。Auth client API：

```ts
status(): Promise<RegistryAuthStatus>;
login(token: string, deviceName: string): Promise<RegistryAuthStatus>;
logout(csrfToken: string): Promise<void>;
```

- [x] **Step 5: 运行测试并提交**

Run:

```powershell
Set-Location app
npm test -- --runInBand __tests__/web-registry-base-url.test.ts __tests__/web-registry-auth-client.test.ts
npm run tsc:web
Set-Location ..
git add app/web/src/registry/registryBaseUrl.ts app/web/src/registry/RegistryWebAuthClient.ts app/__tests__/web-registry-base-url.test.ts app/__tests__/web-registry-auth-client.test.ts app/web/webpack.config.js app/web/public/index.html
git commit -m "feat: derive browser registry auth from page base"
```

Expected: PASS；此提交尚未改变现有连接调用，旧客户端不受影响。

### Task 2: 增加登录和设备管理 UI（仍保留旧连接参数）

**Files:**

- Create: `app/web/src/registry/RegistryAuthController.ts`
- Create: `app/web/src/settings/DeviceSessionsSettingsDetail.tsx`
- Modify: `app/web/src/settings/SettingsBundle.ts`
- Modify: `app/web/src/settings/settingsNavigation.ts`
- Modify: `app/web/src/settings/SettingsRootContent.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Create: `app/__tests__/web-registry-login-ui.test.ts`
- Create: `app/__tests__/web-device-session-settings.test.ts`

- [x] **Step 1: 写登录状态机测试**

状态固定为 `checking | unauthenticated | logging-in | authenticated | error`。启动先 status；401/unauthenticated 显示 Token + device name；成功立即把 input state 设空，再连接 Registry。网络错误提供 retry，不把用户输入写 localStorage/IndexedDB/diagnostics。

- [x] **Step 2: 写设备管理 UI 测试**

列表显示 deviceName/createdAt/lastSeenAt/current；单项 Revoke 带确认；Revoke all 二次确认。撤销当前设备后回到 unauthenticated。DOM、React props 和 snapshot 不含 digest/cookie/csrf/token。

- [x] **Step 3: 运行测试并确认失败**

Run:

```powershell
Set-Location app
npm test -- --runInBand __tests__/web-registry-login-ui.test.ts __tests__/web-device-session-settings.test.ts
```

Expected: FAIL；controller 和 settings detail 尚不存在。

- [x] **Step 4: 实现 UI 并提交**

登录 controller 只依赖 Task 1 auth client；设备页面只依赖阶段 1 repository 方法。不得在设置中再增加 Session TTL、Cookie 内容或第二个 Token 配置。

Run:

```powershell
Set-Location app
npm test -- --runInBand __tests__/web-registry-login-ui.test.ts __tests__/web-device-session-settings.test.ts
npm run tsc:web
Set-Location ..
git add app/web/src/registry/RegistryAuthController.ts app/web/src/settings app/web/src/app/WorkspaceApp.tsx app/__tests__/web-registry-login-ui.test.ts app/__tests__/web-device-session-settings.test.ts
git commit -m "feat: add registry login and device settings"
```

Expected: PASS；仍未删除旧 WebSocket 参数。

### Task 3: 准备旧浏览器凭据清理测试

**Files:**

- Modify: `app/__tests__/web-chat-selection-persistence.test.ts`
- Modify: `app/__tests__/web-clear-local-cache-settings.test.ts`
- Modify: `app/__tests__/web-workspace-persistence-reset-policy.test.ts`
- Create: `app/__tests__/web-browser-credential-hard-cut.test.ts`

- [ ] **Step 1: 写清理和结构失败测试**

测试必须先于生产改动，并断言：

- 启动第一步删除 `wheelmaker.workspace.token`，不读取它用于自动登录。
- IndexedDB/global state 中旧 `token`、`deepseekApiKey`、speech/TTS key 被删除；非敏感偏好保留。
- `WorkspaceGlobalState` 不再定义 `token`/`deepseekApiKey`。
- `WorkspaceController.connect`、`RegistryWorkspaceService.connect`、`RegistryRepository.initialize` 不再接收 token。
- `connect.init` payload 不包含 token。
- Connection 设置不显示独立 Registry address 或 Token；普通浏览器总用 current Base URL。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location app
npm test -- --runInBand __tests__/web-browser-credential-hard-cut.test.ts __tests__/web-chat-selection-persistence.test.ts __tests__/web-clear-local-cache-settings.test.ts __tests__/web-workspace-persistence-reset-policy.test.ts
```

Expected: FAIL；当前类型、localStorage 和 connect chain 仍携带 Token。

不要在此 Task 修改生产代码或提交；这些测试与下一 Task 的 Registry 测试一起进入硬切换提交。

### Task 4: 执行 Web + Registry 原子硬切换

**Files:**

- Modify: `app/web/src/workspace/WorkspacePersistence.ts`
- Modify: `app/web/src/workspace/WorkspaceStore.ts`
- Modify: `app/web/src/workspace/WorkspaceController.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryClient.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/settings/ConnectionStatusSettingsDetail.tsx`
- Modify: `app/web/src/settings/connectionStatus.ts`
- Delete: `app/web/src/platform/desktop/webSource.ts`
- Delete: `app/web/src/platform/native/webSource.ts`
- Modify/Delete: related `app/__tests__/web-desktop-web-source.test.ts`
- Modify/Delete: related `app/__tests__/web-native-web-source.test.ts`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`
- Modify: `docs/nginx-security.md`

- [ ] **Step 1: 先写 Registry 最终分流测试**

替换过渡测试 `TestWebSocketCrossOriginWithoutSessionUsesTokenAuthentication`，最终矩阵：

| Origin | Cookie | connect.init token/role | 结果 |
| --- | --- | --- | --- |
| same-origin | valid | no token, client | accept |
| same-origin | missing/invalid | any | HTTP 401 before Upgrade |
| cross-origin | any | any | HTTP 403 before Upgrade |
| present | valid | token present | protocol forbidden + close |
| present | valid | hub/unknown role | protocol forbidden + close |
| absent | none | valid token, hub/client backend role | accept |
| absent | none | empty/wrong token | forbidden + close |

根路径、子路径、可信 loopback forwarded HTTPS、外部伪造 forwarded header 都要覆盖。

- [ ] **Step 2: 实现 Web 凭据硬删除**

在任何 status/connect 之前执行一次 legacy scrub。删除 Token/address state 和持久 key，而不是把它们保留为空字符串。连接链固定为：

```ts
await authController.requireSession();
const {wsURL} = deriveRegistryEndpoints(document.baseURI);
await workspaceService.connect(wsURL); // no token parameter
```

`RegistryRepository.initialize` 的 `connect.init` 只发送 clientName/clientVersion/protocolVersion/role=client。WebSocket 构造器依靠浏览器自动发送同源 Cookie。

- [ ] **Step 3: 实现 Registry 最终分流**

在 Upgrade 前读取 Origin。存在 Origin 时必须：请求 Origin 与可信 scheme/host/port 精确一致、Cookie Session 有效且 Session BasePath 等于当前 `/.../ws` 提取的 Base Path。升级后的 `connect.init` 强制 client/no-token。不存在 Origin 时忽略 Cookie，继续常量时间 Token 验证。

不要保留 appassets、localhost、Desktop、Android allowlist；新版壳的业务页已经是远程同源。

- [ ] **Step 4: 更新 Nginx 说明但不新增路由**

`docs/nginx-security.md` 只展示现有 `location /ws`；说明 query 会原样转发，因此 login/status/logout 和 Upgrade 共用该 location。删除旧 `/auth/login` 专用 location。根路径用户无需修改路由；子路径用户映射 `<base>/ws`。

- [ ] **Step 5: 运行硬切换定向测试**

Run:

```powershell
Set-Location server
go test ./internal/registry -run 'TestWebSocket|TestWebAuth|TestAuthRoutesUseWSPath' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-browser-credential-hard-cut.test.ts __tests__/web-registry-login-ui.test.ts __tests__/web-registry-base-url.test.ts __tests__/web-chat-selection-persistence.test.ts __tests__/web-clear-local-cache-settings.test.ts __tests__/web-workspace-persistence-reset-policy.test.ts
npm run tsc:web
```

Expected: PASS；旧跨 Origin Token 测试已删除而不是跳过。

- [ ] **Step 6: 以一个提交落下双方改动**

Run:

```powershell
git add server/internal/registry docs/nginx-security.md app/web/src app/__tests__
git commit -m "feat: hard cut browser registry auth to cookie sessions"
```

Expected: 单一提交同时包含 Web 无 Token 连接和 Registry strict Origin/Cookie；不得拆成两个可单独发布的提交。

### Task 5: 验证同批发布和重启体验

- [ ] **Step 1: 运行全量测试与生产构建**

Run:

```powershell
Set-Location server
go test ./...
Set-Location ..\app
npm test -- --runInBand
npm run tsc:web
npm run build:web:release
```

Expected: PASS；release 资源从子路径加载规则正确。

- [ ] **Step 2: 运行源码泄漏门**

Run:

```powershell
rg -n 'LOCAL_TOKEN_KEY|wheelmaker\.workspace\.token|token: normalizedToken|connect\(wsUrl: string, token|initialize\(wsUrl,.*token|WebSocketCrossOriginWithoutSessionUsesToken' app/web/src server/internal/registry
```

Expected: 无输出。

- [ ] **Step 3: 用 Registry 重启测试证明无需每周重登**

Run:

```powershell
Set-Location server
go test ./internal/registry -run 'TestWebSession.*(Restart|Slide|180|TokenRotation)' -v
```

Expected: Session 跨重启有效、活跃续期为 180 天、Token 轮换立即失效。

- [ ] **Step 4: 生成同一提交的发布产物并推送**

Run:

```powershell
$expected = git rev-parse HEAD
Write-Output "release commit: $expected"
git status --short
git push origin HEAD
```

Expected: 工作树为空。Web、Registry、Desktop、Android 发布流水线都记录相同 `$expected`；若任一产物失败，整批不发布。
