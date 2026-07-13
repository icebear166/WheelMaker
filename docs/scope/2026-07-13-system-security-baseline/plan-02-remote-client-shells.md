# Remote Desktop and Android Client Shells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Windows EXE 和 Android APK 改为只内置共用 Bootstrap、保存一个 HTTPS Base URL 并直接加载远程 Workspace，删除完整内置 Web、9632 资源服务、appassets Workspace 代理和 Embedded/Remote/Auto 回退。

**Architecture:** 唯一 Bootstrap 源文件由 Desktop 直接 embed，Android 发布脚本复制同一文件。平台原生层负责 HTTPS URL 校验、系统 TLS 探测、私有持久化、站点数据清理和导航；Bootstrap Bridge 仅在本地启动页启用，业务 Bridge 只在当前配置的精确 Origin/Base Path 主 Frame 启用。远程不可达时回到 Bootstrap 错误态，不加载旧 Workspace。

**Tech Stack:** Go、WebView2、PowerShell publish scripts、Kotlin、AndroidX WebKit/WebViewAssetLoader、SharedPreferences、JUnit、Gradle。

---

### Task 1: 建立两端共用的最小 Bootstrap 协议

**Files:**

- Create: `server/cmd/wheelmaker-desktop/bootstrap/index.html`
- Create: `server/cmd/wheelmaker-desktop/bootstrap.go`
- Create: `server/cmd/wheelmaker-desktop/base_url.go`
- Modify: `server/cmd/wheelmaker-desktop/app_test.go`
- Modify: `scripts/publish_android.ps1`
- Modify: `scripts/test_publish_android_ps1.ps1`

- [ ] **Step 1: 写 Bootstrap 资产和 URL 契约测试**

测试内置 HTML：

- 只能包含 URL 输入、保存、重试、修改地址和错误显示。
- 只调用 `window.wheelMakerBootstrap.getState()`、`saveBaseUrl(value)`、`retry()`、`reset()`。
- 不含 Registry Token、语音、文件、通知、分享、更新、Service Worker 或远程脚本。
- CSP 为 `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`。
- HTML 总大小不超过 24 KiB。

Desktop URL 测试覆盖域名、IP、端口、子路径与拒绝项，并复用 `security.NormalizeHTTPSBaseURL`，不得维护另一套宽松规则。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./cmd/wheelmaker-desktop -run 'TestBootstrap|TestDesktopBaseURL' -v
Set-Location ..
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test_publish_android_ps1.ps1
```

Expected: FAIL；Bootstrap 文件和复制规则不存在，Android 发布仍构建完整 Web root。

- [ ] **Step 3: 编写单文件 Bootstrap**

Bootstrap 只依赖平台注入对象，提交动作示例：

```js
form.addEventListener('submit', async event => {
  event.preventDefault();
  submit.disabled = true;
  const result = await window.wheelMakerBootstrap.saveBaseUrl(input.value);
  if (!result.ok) error.textContent = result.error;
  submit.disabled = false;
});
```

禁止在 HTML 自己保存 localStorage；Base URL 必须交给平台私有 store。

- [ ] **Step 4: 改 Android 发布脚本只复制 Bootstrap**

`publish_android.ps1` 不再运行 `npm run build:web`，而是把 canonical HTML 复制到外部 Android build root 的 `app/src/main/assets/bootstrap/index.html`。测试必须断言脚本不再引用 `WHEELMAKER_WEB_TARGET`、`WebRoot` 或 Workspace bundle。

- [ ] **Step 5: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./cmd/wheelmaker-desktop -run 'TestBootstrap|TestDesktopBaseURL' -v
Set-Location ..
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test_publish_android_ps1.ps1
git add server/cmd/wheelmaker-desktop/bootstrap server/cmd/wheelmaker-desktop/bootstrap.go server/cmd/wheelmaker-desktop/base_url.go server/cmd/wheelmaker-desktop/app_test.go scripts/publish_android.ps1 scripts/test_publish_android_ps1.ps1
git commit -m "feat: add shared native bootstrap shell"
```

Expected: PASS；仓库只有一份 Bootstrap HTML 源。

### Task 2: Desktop 删除资源服务器和 Web source 模式

**Files:**

- Delete: `server/cmd/wheelmaker-desktop/assets.go`
- Delete: `server/cmd/wheelmaker-desktop/server.go`
- Delete: `server/cmd/wheelmaker-desktop/web_source.go`
- Delete: `server/cmd/wheelmaker-desktop/webroot/.gitkeep`
- Rewrite: `server/cmd/wheelmaker-desktop/app.go`
- Rewrite: `server/cmd/wheelmaker-desktop/main.go`
- Create: `server/cmd/wheelmaker-desktop/base_url_store.go`
- Modify: `server/cmd/wheelmaker-desktop/app_test.go`
- Modify: `scripts/publish_desktop.ps1`
- Modify: `scripts/test_publish_desktop_ps1.ps1`

- [ ] **Step 1: 用目标行为替换旧 source/fallback 测试**

删除断言 `embedded|remote|auto`、远程 asset fetch 和 `127.0.0.1:9632` 的测试，新增：

- 无配置时 launcher 接收 Bootstrap HTML，而不是 HTTP URL。
- 已保存且 TLS 探测成功时直接导航规范化 Base URL。
- DNS、TLS、证书或非 2xx/3xx 探测失败时显示 Bootstrap 错误态和已保存 URL。
- 配置文件为 `~/.wheelmaker/desktop/config.json`，只含 `baseUrl`，写入原子且权限私有。
- 搜索 package 源码不存在 `ListenAndServe`、`:9632`、`webSourcePreference`、`RemoteWebURL`。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./cmd/wheelmaker-desktop -run 'TestDesktop(Remote|Bootstrap|BaseURL|Config|NoAssetServer)' -v
```

Expected: FAIL；当前 `run()` embed 完整 webroot 并启动 9632 server。

- [ ] **Step 3: 实现最小 Desktop runtime**

配置结构固定为：

```go
type desktopConfig struct {
	BaseURL string `json:"baseUrl,omitempty"`
}
```

复用 `shared.WriteConfigFile`；目录用当前用户私有权限。探测客户端使用系统证书池、3 秒总 timeout、禁止 HTTP downgrade redirect，并限制最多 5 次 HTTPS redirect。不要加入 `InsecureSkipVerify` 或证书忽略开关。

- [ ] **Step 4: 简化 Desktop 发布**

删除 `publish_desktop.ps1` 的 npm install/Web build/virtual webroot overlay 流程。发布报告改为 `webMode = remote-only`、`embeddedAsset = bootstrap/index.html`，并验证最终 EXE 字符串中没有历史 bundle 文件名。

- [ ] **Step 5: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./cmd/wheelmaker-desktop
Set-Location ..
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test_publish_desktop_ps1.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish_desktop.ps1 -WhatIf
git add server/cmd/wheelmaker-desktop scripts/publish_desktop.ps1 scripts/test_publish_desktop_ps1.ps1
git commit -m "refactor: make desktop a remote-only shell"
```

Expected: PASS；WhatIf 不构建 Workspace Web，不创建 9632 资源根。

### Task 3: Desktop 限制 Bridge、导航和站点数据

**Files:**

- Rewrite: `server/cmd/wheelmaker-desktop/desktop_bridge.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows.go`
- Create: `server/cmd/wheelmaker-desktop/webview_policy.go`
- Create: `server/cmd/wheelmaker-desktop/webview_profile_windows.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows_test.go`
- Create: `server/cmd/wheelmaker-desktop/webview_policy_test.go`

- [ ] **Step 1: 写 Bridge 状态机和导航策略测试**

状态机只有两种授权：

```go
type desktopPageMode uint8
const (
	desktopBootstrapPage desktopPageMode = iota
	desktopTrustedRemotePage
)
```

测试要求：Bootstrap 只允许 get/save/retry/reset；远程业务页只允许窗口控制和 `requestServerChange`；旧 Origin、同 Origin 但 Base Path 外、iframe、`javascript:`/`data:`/`file:`、证书错误页均不能调用业务 Bridge。外部 HTTPS 链接交系统浏览器，WebView 顶层不离开 Base Path。

- [ ] **Step 2: 写服务器切换清理测试**

使用 fake profile 验证切换顺序：

```text
POST old <base>/ws?auth=logout (best effort with CSRF)
clear cookies/cache/storage/service workers for old profile
clear old Bridge authorization
atomically clear saved Base URL
show Bootstrap
```

即使 logout 返回错误，后四步仍必须发生。

- [ ] **Step 3: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./cmd/wheelmaker-desktop -run 'TestDesktop(Bridge|Navigation|ServerSwitch|SiteData)' -v
```

Expected: FAIL；当前全局 Bind 在所有页面注入 web source/调试控制，且无 native 导航/清理策略。

- [ ] **Step 4: 实现 native-side enforcement**

不要只靠注入 JavaScript 隐藏 binding。为 WebView2 接入 NavigationStarting/FrameNavigationStarting 和 Profile/CookieManager 清理；每个 native callback 先读取 native 保存的 page mode、top-level navigation epoch 和精确 URL policy，再执行操作。Bootstrap 保存成功前先 TLS probe，成功后切换 mode 并导航。

若 `go-webview2` 公共接口不暴露所需事件，在本 package 增加最小 Windows COM adapter；不要 fork 整个依赖，也不要让页面自报 Origin 作为信任依据。

- [ ] **Step 5: 运行 Windows 测试并提交**

Run:

```powershell
Set-Location server
go test ./cmd/wheelmaker-desktop
go test ./cmd/wheelmaker-desktop -run 'TestDesktop(Bridge|Navigation|ServerSwitch|SiteData)' -count=20
git add cmd/wheelmaker-desktop
git commit -m "fix: isolate desktop navigation and bootstrap bridge"
```

Expected: PASS；重复测试不出现授权 epoch 竞态。

### Task 4: Android 删除 Workspace 代理和 source 模式

**Files:**

- Delete: `mobile/android/app/src/main/java/com/wheelmaker/android/WebSourceModels.kt`
- Delete: `mobile/android/app/src/main/java/com/wheelmaker/android/WebSourceRuntime.kt`
- Delete: `mobile/android/app/src/test/java/com/wheelmaker/android/WebSourceRuntimeTest.kt`
- Rewrite: `mobile/android/app/src/main/java/com/wheelmaker/android/StableOriginWebViewClient.kt`
- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/BaseUrlPolicy.kt`
- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/BaseUrlStore.kt`
- Create: `mobile/android/app/src/test/java/com/wheelmaker/android/BaseUrlPolicyTest.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/StableOriginPathTest.kt`

- [ ] **Step 1: 写 Android URL、导航和包资产测试**

覆盖与 Go 相同的 URL 表；另断言：

- `https://appassets.androidplatform.net/assets/bootstrap/index.html` 只加载本地 Bootstrap。
- 业务页面直接 `loadUrl(configuredBaseUrl)`，不通过 `shouldInterceptRequest` fetch/代理远端资源。
- 配置远程页面只允许精确 Origin + Base Path 顶层导航；外链使用 `ACTION_VIEW`。
- APK assets 中只能有 Bootstrap，不能出现 `bundle.*.js`、Workspace CSS、manifest 或 service worker。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location mobile\android
.\gradlew.bat test --tests '*BaseUrlPolicyTest' --tests '*StableOriginPathTest'
```

Expected: FAIL；当前 appassets client 仍代理 Workspace，source runtime 仍支持 auto/embedded/remote。

- [ ] **Step 3: 实现私有 Base URL 和直接导航**

`BaseUrlStore` 使用 `MODE_PRIVATE` SharedPreferences，仅保存规范化 Base URL。TLS 探测使用 OkHttp 系统 trust manager，拒绝降级 redirect。远端错误显示 Bootstrap 的 retry/change 状态；不得加载缓存中的旧业务 HTML。

- [ ] **Step 4: 运行测试并提交**

Run:

```powershell
Set-Location mobile\android
.\gradlew.bat test --tests '*BaseUrlPolicyTest' --tests '*StableOriginPathTest'
Set-Location ..\..
git add mobile/android
git commit -m "refactor: make android a remote-only shell"
```

Expected: PASS；source 模式类和测试已删除。

### Task 5: Android 使用来源受限的消息通道

**Files:**

- Rewrite: `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`
- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/TrustedWebMessagePolicy.kt`
- Create: `mobile/android/app/src/test/java/com/wheelmaker/android/TrustedWebMessagePolicyTest.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidPortRelaySiteDataRuntime.kt`
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/MainActivityPortRelayCookieTest.kt`

- [ ] **Step 1: 写 Bootstrap/业务消息 allowlist 测试**

消息统一为：

```json
{"requestId":"uuid","action":"bootstrap.saveBaseUrl","payload":{"baseUrl":"https://example.com/app/"},"userGestureAt":0}
```

Bootstrap listener 只接受 appassets bootstrap origin 的四个配置 action；业务 listener 只接受配置的精确 HTTPS Origin，并在 native 侧同时验证当前顶层 URL 位于 Base Path、`isMainFrame`、action allowlist。敏感 action 的手势时间必须在当前 elapsed realtime 的 5 秒内。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location mobile\android
.\gradlew.bat test --tests '*TrustedWebMessagePolicyTest' --tests '*MainActivityPortRelayCookieTest'
```

Expected: FAIL；当前 `addJavascriptInterface` 对任意已加载页面暴露对象。

- [ ] **Step 3: 改用 WebViewCompat 消息 listener**

删除 `addJavascriptInterface`。使用两个独立 listener 名称和 origin rules；服务器切换时先 `removeWebMessageListener`，再清 Cookie、`WebStorage.deleteAllData()`、cache 和 service worker 数据，最后为新 Base URL 注册业务 listener。旧 server logout 是 best effort，但本地清理无条件执行。

- [ ] **Step 4: 运行 Android 测试和 lint 并提交**

Run:

```powershell
Set-Location mobile\android
.\gradlew.bat test lint
Set-Location ..\..
git add mobile/android/app/src
git commit -m "fix: constrain android native bridge origins"
```

Expected: PASS；源码搜索不到 `addJavascriptInterface`。

### Task 6: 验证并发布原生壳兼容阶段

- [ ] **Step 1: 验证发布脚本和产物内容**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test_publish_desktop_ps1.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test_publish_android_ps1.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish_desktop.ps1 -WhatIf
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish_android.ps1 -WhatIf
rg -n "9632|webSourcePreference|actualSource|Embedded|Remote|Auto|addJavascriptInterface" server/cmd/wheelmaker-desktop mobile/android scripts/publish_desktop.ps1 scripts/publish_android.ps1
```

Expected: 测试/预检 PASS；最后 `rg` 无业务 source/9632/全局 bridge 命中（测试说明文字除外也应删除）。

- [ ] **Step 2: 验证 Registry 过渡兼容仍存在**

Run:

```powershell
Set-Location server
go test ./internal/registry -run 'TestWebSocketCrossOriginWithoutSessionUsesTokenAuthentication' -v
```

Expected: PASS。先发布新 Desktop/APK，观察至少一个发布周期；此阶段不得提前执行浏览器硬切换提交。

- [ ] **Step 3: 推送阶段提交**

Run:

```powershell
git status --short
git push origin HEAD
```

Expected: 工作树为空，阶段提交已推送。
