# Diagnostics, Web, and Android Defense-in-Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一递归脱敏所有日志/诊断/导出，完成 Android WebView、敏感权限、APK 更新和 release 签名加固，并收紧 Web CSP、开发服务器、安全响应头模板及兼容依赖。

**Architecture:** Go 与 TypeScript 各自只有一个递归 redactor，所有诊断入口在序列化前调用。Android 以阶段 2 的精确 Origin/Base Path policy 为唯一信任源，WebView/permission/update 都复用它。Web 页面内 CSP 立即生效；真实 HTTP header 由新安装 Nginx 模板和部署验收检查，既有静态 Nginx 不由应用自动修改。

**Tech Stack:** Go、TypeScript/Jest、React、webpack-dev-server、CSP、Kotlin/AndroidX WebKit、PackageManager、Gradle signing、npm audit。

---

### Task 1: 建立 Go/TypeScript 递归敏感信息脱敏器

**Files:**

- Create: `server/internal/security/redact.go`
- Create: `server/internal/security/redact_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/speech_service.go`
- Modify: `server/internal/hub/agent/acp_log.go`
- Modify: `server/internal/hub/reporter.go`
- Create: `app/web/src/debug/redaction.ts`
- Create: `app/__tests__/web-diagnostic-redaction.test.ts`
- Modify: `app/web/src/debug/registryDebug.ts`
- Modify: `app/web/src/debug/appDiagnostics.ts`
- Modify: `app/web/src/debug/workspaceDiagnostics.ts`
- Modify: `app/web/src/debug/nativeWebDiagnostics.ts`

- [ ] **Step 1: 写递归和混淆 key 测试**

Key 比较去掉 `-_.` 并 lower-case，至少覆盖：`token`、`registryToken`、`apiKey`、`api_key`、`appSecret`、`authorization`、`cookie`、`setCookie`、`csrf`、`accessCode`、`nonce`、`password`、`credential`、`secret`。嵌套 map/array、错误 details、循环对象（TS）、深度 > 16、节点 > 10,000 都必须安全终止。

固定输出为 `[redacted]`，不保留长度、首尾字符或 hash。允许 `tokenCount`、`inputTokens`、`outputTokens`、`accessCodeGeneration` 等明确统计 allowlist，避免把计数误删。

- [ ] **Step 2: 写入口不可旁路测试**

把同一 secret 放入 `connect.init`、speech、TTS、DeepSeek、ACP params、error details、native diagnostics、config DTO，断言 debug buffer/export/log sink 中均无原文。认证 body、Cookie、Authorization 和 query code 整体不记录。

- [ ] **Step 3: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/security ./internal/registry ./internal/hub ./internal/hub/agent -run 'Test.*Redact' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-diagnostic-redaction.test.ts __tests__/web-registry-debug-records.test.ts
```

Expected: FAIL；当前 redaction 分散且 key 集合不完整。

- [ ] **Step 4: 实现并接入唯一 redactor**

Go redactor 接收 `any` 并返回深拷贝，禁止原地修改业务 payload。TypeScript 使用 `WeakSet<object>` 处理循环。日志 metadata 可保留 method/requestId/role/status，但不保留 raw envelope。

- [ ] **Step 5: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/security ./internal/registry ./internal/hub ./internal/hub/agent -run 'Test.*Redact' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-diagnostic-redaction.test.ts __tests__/web-registry-debug-records.test.ts
npm run tsc:web
Set-Location ..
git add server/internal/security/redact.go server/internal/security/redact_test.go server/internal/registry server/internal/hub app/web/src/debug app/__tests__/web-diagnostic-redaction.test.ts app/__tests__/web-registry-debug-records.test.ts
git commit -m "fix: recursively redact diagnostic secrets"
```

Expected: PASS；原文不进入 sink。

### Task 2: 收紧 Android WebView 和敏感权限入口

**Files:**

- Modify: `mobile/android/app/src/main/AndroidManifest.xml`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/StableOriginWebViewClient.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidSpeechRuntime.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidImageShareRuntime.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidNotificationRuntime.kt`
- Create: `mobile/android/app/src/test/java/com/wheelmaker/android/SecureWebViewPolicyTest.kt`
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/MainActivityFileChooserTest.kt`

- [ ] **Step 1: 写 WebView 设置失败测试**

断言 cleartext、mixed content、第三方 Cookie、文件访问和生产调试全部关闭：

```kotlin
settings.allowFileAccess = false
settings.allowContentAccess = false
settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
settings.javaScriptCanOpenWindowsAutomatically = false
CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
```

Manifest 必须 `android:usesCleartextTraffic="false"`、`android:allowBackup="false"`、`android:fullBackupContent="false"`（或等价 data extraction rules 排除全部）。

- [ ] **Step 2: 写权限/文件入口测试**

麦克风、通知、分享、文件选择只接受 trusted main frame；需要用户意图的 action 要求 5 秒内手势。文件 chooser 只使用系统 `ACTION_OPEN_DOCUMENT` 返回的显式 `content://` URI 和临时/持久授权；页面不能传任意 content URI 给 native 打开。外部 navigation 不继承 Bridge。

- [ ] **Step 3: 运行测试并确认失败**

Run:

```powershell
Set-Location mobile\android
.\gradlew.bat test --tests '*SecureWebViewPolicyTest' --tests '*MainActivityFileChooserTest' --tests '*TrustedWebMessagePolicyTest'
```

Expected: FAIL；当前测试甚至要求 file/content access 为 true，Manifest 允许 cleartext/backup。

- [ ] **Step 4: 实现设置和统一 permission gate**

删除旧 permissive test，不做兼容开关。每个 runtime 只接收已经由 `TrustedWebMessagePolicy.authorize` 生成的短寿命 capability，不再自己相信页面 URL 字符串。

- [ ] **Step 5: 运行测试/lint 并提交**

Run:

```powershell
Set-Location mobile\android
.\gradlew.bat test lint
Set-Location ..\..
git add mobile/android/app/src
git commit -m "fix: harden android webview permissions"
```

Expected: PASS；lint 无 cleartext/backup/WebView bridge 安全错误。

### Task 3: 验证 APK 大小、摘要、身份、版本和签名

**Files:**

- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidApkUpdateRuntime.kt`
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidApkUpdateRuntimeTest.kt`
- Modify: `mobile/android/app/src/main/res/xml/apk_update_paths.xml`

- [ ] **Step 1: 写完整拒绝矩阵**

下载请求必须是 HTTPS，metadata 必须有 64 hex SHA-256、正整数 declared size 且 `<= 200 MiB`。流式下载同时计算 bytes/hash，Content-Length（若存在）、declared size、实际 size 任一不符删除临时文件。安装前 PackageManager archive info 必须满足：package `com.wheelmaker.android`、versionCode 大于当前、signing certificate SHA-256 集合与当前安装完全一致。

测试 HTTP、redirect-to-HTTP、缺 hash/size、201 MiB、短/长 body、hash mismatch、错误 package、同/低版本、debug/不同签名都不能启动 installer intent。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location mobile\android
.\gradlew.bat test --tests '*AndroidApkUpdateRuntimeTest'
```

Expected: FAIL；当前校验矩阵不完整。

- [ ] **Step 3: 实现流式验证和 archive identity gate**

临时文件必须在 app cache 的专用 update 目录，权限私有；校验完成后才通过 FileProvider 暴露。失败/cancel/安装 intent 返回后清理过期文件。不要仅相信服务器的 package/version metadata。

- [ ] **Step 4: 运行测试并提交**

Run:

```powershell
Set-Location mobile\android
.\gradlew.bat test --tests '*AndroidApkUpdateRuntimeTest'
Set-Location ..\..
git add mobile/android/app/src/main/java/com/wheelmaker/android/AndroidApkUpdateRuntime.kt mobile/android/app/src/test/java/com/wheelmaker/android/AndroidApkUpdateRuntimeTest.kt mobile/android/app/src/main/res/xml/apk_update_paths.xml
git commit -m "fix: verify android update package identity"
```

Expected: PASS；错误包没有 installer side effect。

### Task 4: Release 构建禁止 debug 签名回退

**Files:**

- Modify: `mobile/android/app/build.gradle.kts`
- Create: `mobile/android/release-signing.properties.example`
- Create: `scripts/test_android_release_signing.ps1`
- Modify: `scripts/publish_android.ps1`
- Modify: `scripts/test_publish_android_ps1.ps1`
- Modify: `INSTALL.md`

- [ ] **Step 1: 写缺失配置失败测试**

测试 release task 缺任一 `WHEELMAKER_ANDROID_KEYSTORE`、`WHEELMAKER_ANDROID_STORE_PASSWORD`、`WHEELMAKER_ANDROID_KEY_ALIAS`、`WHEELMAKER_ANDROID_KEY_PASSWORD` 时非零退出，并且 build script 不含 `signingConfigs.getByName("debug")`。Debug/test task 无需 release secret。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test_android_release_signing.ps1
```

Expected: FAIL；当前 release 明确使用 debug signing。

- [ ] **Step 3: 实现显式 release signing**

只在 release graph 被请求时解析环境变量和 keystore；路径必须存在，alias 必须可加载。密码不写 properties example、publish report、命令行或日志。`publish_android.ps1` 只报告 keystore filename/signing cert SHA-256，不报告 secret。

- [ ] **Step 4: 运行测试并提交**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test_android_release_signing.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test_publish_android_ps1.ps1
git add mobile/android/app/build.gradle.kts mobile/android/release-signing.properties.example scripts/test_android_release_signing.ps1 scripts/publish_android.ps1 scripts/test_publish_android_ps1.ps1 INSTALL.md
git commit -m "fix: require android release signing key"
```

Expected: PASS；无配置 release fail closed。

### Task 5: Web CSP、开发服务器和静态部署安全头

**Files:**

- Modify: `app/web/public/index.html`
- Modify: `app/web/webpack.config.js`
- Create: `app/__tests__/web-security-policy.test.ts`
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `docs/nginx-security.md`

- [ ] **Step 1: 写页面和 dev server policy 测试**

CSP 至少为：

```text
default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none';
script-src 'self'; connect-src 'self' wss:; img-src 'self' data: blob:;
style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:;
worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests
```

根据生产 build 实际功能缩小而不是加入 wildcard remote host。测试 index 有 `referrer=no-referrer`；webpack devServer host 为 `127.0.0.1`，allowedHosts 只含 loopback names，headers 包含 CSP/nosniff/frame deny/referrer。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location app
npm test -- --runInBand __tests__/web-security-policy.test.ts
```

Expected: FAIL；当前 dev server 监听 0.0.0.0 且 allowedHosts=all。

- [ ] **Step 3: 实现页面 policy 和 dev headers**

如果 webpack/React 需要 inline runtime，优先关闭 inline 产物；只保留 CSS `unsafe-inline`，不得加入 script `unsafe-inline`/`unsafe-eval` 到生产 CSP。开发环境如 HMR 确需 eval，使用 dev-only response header，不写入 production HTML。

- [ ] **Step 4: 更新新安装 Nginx 模板**

所有静态 location 都加入：

```nginx
add_header Content-Security-Policy "<与构建验证一致的 policy>" always;
add_header Referrer-Policy "no-referrer" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
```

不新增 auth location，不自动编辑用户文件。文档明确：既有静态 Nginx 不加这些 header 时，meta CSP/Referrer 仍有部分保护，但不能通过完整 HTTP header 验收。

- [ ] **Step 5: 运行测试/build 并提交**

Run:

```powershell
Set-Location app
npm test -- --runInBand __tests__/web-security-policy.test.ts
npm run tsc:web
npm run build:web
Set-Location ..
git add app/web/public/index.html app/web/webpack.config.js app/__tests__/web-security-policy.test.ts README.md INSTALL.md docs/nginx-security.md
git commit -m "fix: enforce web security policies"
```

Expected: PASS；生产 HTML 不依赖远程 script。

### Task 6: 修复当前兼容依赖告警并记录破坏性项

**Files:**

- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Modify: `mobile/android/app/build.gradle.kts`
- Create: `docs/security-dependency-deferred.md`

- [ ] **Step 1: 保存执行时审计基线**

Run:

```powershell
Set-Location app
npm audit --json | Set-Content -Encoding utf8 ..\docs\security-npm-audit-before.json
npm audit --omit=dev --json | Set-Content -Encoding utf8 ..\docs\security-npm-prod-audit-before.json
Set-Location ..\mobile\android
.\gradlew.bat dependencies > ..\..\docs\security-android-dependencies-before.txt
```

Expected: 当前已知 Web 审计包含 Monaco/DOMPurify 生产链及 webpack-dev-server/ws 等开发链；命令因 findings 可返回非零，但 JSON/依赖树必须成功生成且不得包含环境 secret。

- [ ] **Step 2: 先做无破坏性 lock/override 修复**

在 `overrides` 固定当前 advisory 的最小修复版本：`dompurify: 3.4.11`、`ws: 8.21.0`、`uuid: 11.1.1`、`qs: 6.15.2`、`shell-quote: 1.8.4`、`http-proxy-middleware: 2.0.10`、`js-yaml: 3.15.0`、`launch-editor: 2.14.1`。把 direct `@babel/core` 固定到 `7.29.1`、`webpack-dev-server` 固定到 `5.2.7`。运行 `npm install --package-lock-only`，禁止 `npm audit fix --force`。

若 peer/运行测试证明 override 不兼容，撤销该单项并在 deferred 文档记录 advisory、受影响路径、现有缓解和需要批准的最小 direct major；不能用 failing override 假装修复。

- [ ] **Step 3: 更新 Android 同 major/minor 兼容版本**

只更新 AndroidX/OkHttp/Kotlin/Gradle plugin 的兼容非破坏版本，并运行 Gradle test/lint。任何要求 minSdk/target 行为变化或 major migration 的项写入 deferred，不在本 Task 强升。

- [ ] **Step 4: 运行审计和功能门**

Run:

```powershell
Set-Location app
npm install --package-lock-only
npm audit --omit=dev
npm audit
npm test -- --runInBand
npm run tsc:web
npm run build:web
Set-Location ..\mobile\android
.\gradlew.bat test lint
```

Expected: production audit 无 moderate/high/critical；完整 audit 无 high/critical。只因必须跨 major 的 low/moderate 可留在 `docs/security-dependency-deferred.md`，且每项有 advisory、依赖链和后续审批条件。

- [ ] **Step 5: 删除原始审计快照中的不必要噪声并提交**

保留摘要到 deferred 文档，删除两个大型 JSON 和 dependency tree 临时文件，不把 node_modules/Gradle cache 加入 Git。

Run:

```powershell
Remove-Item -LiteralPath docs\security-npm-audit-before.json,docs\security-npm-prod-audit-before.json,docs\security-android-dependencies-before.txt -ErrorAction SilentlyContinue
git add app/package.json app/package-lock.json mobile/android/app/build.gradle.kts docs/security-dependency-deferred.md
git commit -m "fix: update compatible security dependencies"
```

Expected: 提交只有 manifest/lock/deferred 文档。

### Task 7: 执行纵深防御验收

- [ ] **Step 1: 运行全量门**

Run:

```powershell
Set-Location server
go test ./...
Set-Location ..\app
npm test -- --runInBand
npm run tsc:web
npm run build:web:release
Set-Location ..\mobile\android
.\gradlew.bat test lint
```

Expected: PASS。

- [ ] **Step 2: 检查 Android 禁止项**

Run:

```powershell
rg -n 'addJavascriptInterface|MIXED_CONTENT_ALWAYS_ALLOW|allowFileAccess = true|allowContentAccess = true|usesCleartextTraffic="true"|allowBackup="true"|signingConfigs\.getByName\("debug"\)|InsecureSkipVerify' mobile/android server/cmd/wheelmaker-desktop
```

Expected: 无输出。

- [ ] **Step 3: 在 staging 检查真实安全头**

Run（先设置已部署 staging URL；不使用生产 Token）：

```powershell
$base = $env:WHEELMAKER_STAGING_BASE_URL
if ([string]::IsNullOrWhiteSpace($base)) { throw 'WHEELMAKER_STAGING_BASE_URL is required' }
$headers = Invoke-WebRequest -Method Head -Uri $base
$headers.Headers['Content-Security-Policy']
$headers.Headers['Referrer-Policy']
$headers.Headers['X-Content-Type-Options']
$headers.Headers['X-Frame-Options']
```

Expected: 分别得到已测试 CSP、`no-referrer`、`nosniff`、`DENY`。若既有 Nginx 未手动加入 header，此门明确失败；应用不能绕过该部署限制。

- [ ] **Step 4: 推送阶段提交**

Run:

```powershell
git status --short
git push origin HEAD
```

Expected: 工作树为空，阶段 7 已推送。
