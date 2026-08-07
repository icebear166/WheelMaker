# HTML 预览 JS 执行 — Handoff

> 由 handoff skill 于 2026-07-26 生成。承接「Desktop HTML 预览白屏 + JS 不跑」的 debug → scope 流程。

## 一句话现状

诊断完成、方案基本收敛到「server 预览端点（A 方案）」，但 **scope 流程卡在出口前**：还有 1 个待决项（认证方案）没拿到用户确认，spec 未写、生产代码未动。**接手第一件事：找用户确认认证 A/B + 走落 spec。**

## 问题根因（已查证，两个独立 bug）

### 1. Desktop 白屏
- `HtmlPreview` 用 `<iframe sandbox="allow-scripts" srcDoc={content}>`（[markdownPreview.tsx:440-441](app/web/src/code/markdownPreview.tsx)）
- WebView2 对 srcDoc iframe 触发 `about:srcdoc` 子框架导航
- [webview_profile_windows.go:300-304 handleNavigation](server/cmd/wheelmaker-desktop/webview_profile_windows.go)：子框架非 allow 一律 `desktopCancelNavigation`
- [webview_policy.go:142-149 DecideNavigation](server/cmd/wheelmaker-desktop/webview_policy.go)：`about:` 非 https → block
- 结果：iframe 加载被取消 → 白屏。浏览器无此策略所以正常；只有 HTML 预览受影响（图片/markdown/代码不走 iframe）。

### 2. JS 不跑（即使修了白屏）
- srcDoc iframe 继承父 CSP（[public/index.html:7](app/web/public/index.html) `script-src 'self'` 无 `'unsafe-inline'`），inline `<script>` 被拦
- 已 WebSearch 确认：[W3C webappsec-csp #700](https://github.com/w3c/webappsec-csp/issues/700)、[csplite #188](https://csplite.com/csp/test188/)、[MDN srcdoc](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/srcdoc) —— 父 CSP 覆盖 srcDoc，无法局部放宽
- [web-security-policy.test.ts:29-30](app/__tests__/web-security-policy.test.ts) 硬性禁止 `'unsafe-inline'`/`'unsafe-eval'` → 不能靠放宽全局 CSP 解决

## 已确认的决策

- **走 A 方案**：server 加预览端点，iframe 改 `src=URL`，局部 CSP 放开脚本。否决 B（全局 unsafe-inline）——Desktop 有 native bridge 能 `exec.Command`（[local_dev_windows.go:33](server/cmd/wheelmaker-desktop/local_dev_windows.go)、[desktop_file_actions_windows.go:31](server/cmd/wheelmaker-desktop/desktop_file_actions_windows.go)、[desktop_update_windows.go:14](server/cmd/wheelmaker-desktop/desktop_update_windows.go)），XSS 可链式升级到 RCE / 凭据窃取（registry token）。
- **单文件预览**：用户确认只预览自包含单 HTML，不加资源代理（spec non-goal #1 维持）。相对路径资源、localStorage 不支持，用户接受。
- **JS 默认开、不要 toggle**：当前 HtmlPreview 已硬编码 `allow-scripts`，符合预期，不用加 toggle UI（原 spec 的 scriptsEnabled toggle 不实现）。
- **无状态 GET**：多预览 / 关闭 / cache 全交给 HTTP 头，无会话状态。
- **`sandbox="allow-scripts"` 不加 `allow-same-origin`**：隔离不可信 HTML，不碰主 app 凭据。
- **不要复用 relay**（用户硬约束）：预览是独立模块、独立认证、独立路由，**不 import** port relay 的 access code / login_guard / cookie 那套。
- **端点挂 registry 主 https server**（`127.0.0.1:9630`），路径 `/__wheelmaker/preview/`（注意：maker，非 manager；与 relay 同前缀但不同模块）。
- **desktop 导航白名单不用改**：previewUrl 经 nginx 反代后是 release origin 子路径，[contains()](server/cmd/wheelmaker-desktop/webview_policy.go) 放行。
- **nginx 要改**：加 `location /__wheelmaker/preview/` 反代到 9630。关键——该 location **不能套 nginx 默认严格 CSP**（[nginx-security.md:43](docs/nginx-security.md)），要透传 registry 设的预览专用宽松 CSP（不加 `add_header Content-Security-Policy`、透传 upstream）。牵连 [nginx-security.md](docs/nginx-security.md) 文档 + [web-security-policy.test.ts:52-62](app/__tests__/web-security-policy.test.ts) 部署文档断言更新。
- **性能无实质影响**：预览 = 一次性 GET（HMAC 验签 + 现有 fs.read + 返回），无状态、远轻于 port relay 的持续隧道。需加单文件大小上限。

## 待决项（接手先解决）

1. **认证方案**（scope 上一题，用户未答）：
   - **A（推荐）**：签名 URL（HMAC + 短期过期，几分钟）。web 端向 registry 要签名 URL → iframe 加载 → registry 预览端点验签 + 读文件。无状态、不碰 relay 代码。
   - **B**：专用预览 token（registry 发短期 token，query 传，registry 校验）。比 A 多一层状态。
   - 推荐 A。需用户拍板。
2. **scope 出口**：落 spec（推荐，跨三层 + 安全）还是不落 spec 直接 plan。推荐落 `docs/scope/2026-07-26-html-preview-js.md`，批准后调 writing-plans。
3. **wiki 目标**：建议新建 `docs/wiki/features/html-preview.md`（预览端点架构、CSP/sandbox 安全模型、能力边界）。待用户确认。

## 关键代码索引

- 预览组件：[markdownPreview.tsx HtmlPreview](app/web/src/code/markdownPreview.tsx)（422-446）；滚动辅助 `scrollHtmlPreviewFrameToLine`（279-304）
- 调用点：[WorkspaceApp.tsx ChatFilePeekViewer:2194](app/web/src/app/WorkspaceApp.tsx)、[ChatAttachmentPreviewViewer:2350](app/web/src/app/WorkspaceApp.tsx)、[renderPreviewWorkbenchTabBody:19911](app/web/src/app/WorkspaceApp.tsx)（工作台 file tab 复用 ChatFilePeekViewer）
- 文件读取：[registryMethods.ts:21](app/web/src/registry/registryMethods.ts)（`ProjectFSRead = 'project.fs.read'`）、[RegistryRepository.ts:958 readFile](app/web/src/registry/RegistryRepository.ts)
- Desktop 导航白名单：[webview_policy.go](server/cmd/wheelmaker-desktop/webview_policy.go)、[webview_profile_windows.go handleNavigation:293](server/cmd/wheelmaker-desktop/webview_profile_windows.go)、测试 [webview_policy_test.go TestDesktopNavigationPolicy:263](server/cmd/wheelmaker-desktop/webview_policy_test.go)
- port relay（**参考架构，不复用代码**）：[server/internal/portrelay/](server/internal/portrelay/)（listener.go 起**独立公网 listener**、不走 nginx；types.go 路由常量；auth.go / login_guard.go 认证）
- nginx：[nginx-security.md](docs/nginx-security.md)（只反代 `/ws` 到 `127.0.0.1:9630`，静态资源自服）
- CSP：[public/index.html:7](app/web/public/index.html)、[bootstrap/index.html:6](server/cmd/wheelmaker-desktop/bootstrap/index.html)、[web-security-policy.test.ts](app/__tests__/web-security-policy.test.ts)
- 原 spec（**部分过时**，漏算 CSP 继承 + 实现偏离了 spec）：[docs/superpowers/specs/2026-05-26-html-preview-mode-design.md](docs/superpowers/specs/2026-05-26-html-preview-mode-design.md)

## 用户的硬约束（别踩）

- **不要复用 port relay** 的代码 / 认证
- 单文件，不加资源代理
- 不要 toggle，JS 默认开
- 主 app CSP 不能动（有测试守卫）
- 改 Go 服务端前读 [server/CLAUDE.md](server/CLAUDE.md)；改 Web UI 读 [app/CLAUDE.md](app/CLAUDE.md)
- 协议版本未经同意不得改（[CLAUDE.md 全局约定](CLAUDE.md)）
- 需求澄清 / 方案讨论只用文字，不用可视化工具
- 完成前走 Completion Gate（`git add -A` → commit → `git push origin <branch>`）

## 工作树状态

会话开始时 git status 显示有与预览**无关**的未提交改动（`app/web/webpack.config.js`、`scripts/deploy/*`、`scripts/release/*`、`server/internal/releaseserver/*`）。动手前先 `git status` 确认当前状态，避免混入无关改动。

## 下一步建议

1. 向用户确认认证 A/B + scope 出口（落 spec）
2. 落 spec，内容至少覆盖：路由协议、签名 / 认证细节、预览文档 CSP 具体值、路径遍历防护、错误页、nginx location 写法 + CSP 透传、desktop 不改的论证、单文件大小上限
3. 调 writing-plans 出 plan
4. TDD 实施（先给 `DecideNavigation` 对 `about:srcdoc` 的回归测试兜底，即便走 A 方案 srcDoc 路径不再用，导航白名单的子框架行为也值得固化）
