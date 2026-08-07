> 由 scope skill 于 2026-07-26 生成

# HTML 预览 JavaScript 执行

## 目标

当前 Workspace 使用 `srcDoc` 把 HTML 内容加载进 `sandbox="allow-scripts"` iframe。WheelMaker Desktop 会拦截 WebView2 的 `about:srcdoc` 子框架导航，导致预览白屏；浏览器中的 `srcDoc` 又会继承主应用 `script-src 'self'` CSP，导致内联脚本无法执行。本次改动把 HTML 文档改由 Registry HTTP 响应承载，让项目文件、项目外文件和 Session 附件中的自包含 `.html` / `.htm` 文档在浏览器、Desktop 和 Android 中默认执行内联 JavaScript，同时保持主应用 CSP、opaque-origin sandbox、Registry/Hub 协议版本和 port relay 边界不变。

## 决策

1. **脚本默认开启**：HTML 预览固定使用 `sandbox="allow-scripts"`，不增加脚本开关，也不增加 `allow-same-origin`。
2. **严格单文件能力**：允许内联 JavaScript、内联 CSS，以及 `data:` / `blob:` 图片、字体和媒体；禁止第三方/相对脚本、外部子资源、`fetch`、XHR、WebSocket、Worker、子 frame、对象和表单提交。不代理或改写相对资源，第三方依赖必须打包进 HTML。
3. **沿用 Registry 浏览器认证**：预览请求使用现有 host-only、`HttpOnly`、`Secure`、`SameSite=Strict` Registry session cookie 和 CSRF token。预览模块不导入、不调用、不复用 port relay 的 access code、login guard、cookie 或路由代码。
4. **使用无状态 iframe POST**：前端通过隐藏 form 向 `<basePath>/ws/preview/` 的目标 iframe 提交 source descriptor 和 CSRF token。descriptor 不进入 URL、浏览器历史或默认 Nginx access log；Registry 不创建预览 session 或临时 token。
5. **复用现有 `/ws` 反代入口**：`/ws/preview/` 是独立 Registry HTTP handler，但共享现有 Nginx `/ws` 前缀反代。正式部署不新增或修改 Nginx location。
6. **Registry 只转发，不直接读文件**：项目文件、项目外文件和 Session 附件分别映射到现有 `project.fs.read`、`project.fs.external.read` 和 `session.attachment.read` Hub 请求。Registry 不使用 `os.ReadFile` 读取预览来源。
7. **不扩展协议**：不新增 Registry/Hub WebSocket 方法，不修改 protocol version；HTTP preview handler 调用 Registry 内部的通用、可取消 Hub 请求转发能力。
8. **每个预览只读取一次正文**：HTML tab 不再先通过前端文件/附件读取接口加载源码，iframe POST 触发唯一一次正文读取。HTML 不参与 Workspace 自定义源码搜索或源码行跳转。
9. **不新增 HTML 大小上限**：预览层不设置专用文件大小限制；现有 Registry WebSocket 单消息限制、Hub 读取失败和 HTTP server 超时仍然生效，并显示固定错误页。
10. **三类现有来源全部支持**：项目内文件、项目外绝对路径文件和 Session 附件中的 HTML 都进入同一安全模型。

## 架构

### Web `HtmlPreview`

`HtmlPreview` 不再接收或设置 `srcDoc`。组件接收类型化 source descriptor、Registry CSRF token 和基于当前 `<base>` 推导的 preview endpoint，创建名称稳定且不可由 descriptor 控制的 sandbox iframe，并用隐藏 form 把 descriptor POST 到该 iframe。descriptor 变化或 tab 重新加载时重新提交；组件卸载后不保留预览状态。

iframe 固定设置：

```tsx
<iframe
  sandbox="allow-scripts"
  referrerPolicy="no-referrer"
  title="HTML preview"
/>
```

前端不向 sandbox 增加 `allow-same-origin`、`allow-forms`、`allow-popups`、下载或顶层导航权限。opaque-origin 文档不能读取主应用 DOM、Registry cookie、`localStorage` 或 native bridge。Desktop native bridge 继续只接受 main frame 调用。

标准 iframe sandbox 仍允许文档导航自己的 child navigable；CSP fetch directives 也不约束普通 `_self` navigation。因此本功能不支持或鼓励预览内的外部导航，但不承诺在普通浏览器中阻止简单 HTML 主动设置自身 `location` 或用户点击链接。该导航不能逃出 iframe，Desktop 现有子框架导航策略还会阻止 base origin 之外的目标。实现不通过解析、改写或注入脚本来拦截此行为。

### Preview HTTP handler

Registry 在根路径部署时接受 `POST /ws/preview/`，在子路径部署时接受 `POST <basePath>/ws/preview/`。该路由与相同 base path 下的 `/ws` 认证 cookie 对齐。规范 preview path 上的其他 method 返回 `405` 并设置 `Allow: POST`；尾部路径、任何 query 参数和非规范路径返回 `404`。这些请求不得回退到 WebSocket handler。

请求使用 `application/x-www-form-urlencoded`，允许合法的 media type 参数，body 上限为 64 KiB。不支持的 media type 返回 `415`，超限返回 `413`，字段/schema 错误返回 `400`。handler 拒绝未知字段、重复字段、空公共字段和不符合来源 schema 的组合。公共字段为：

- `source`：`project-file`、`external-file` 或 `session-attachment`
- `projectId`
- `csrfToken`

来源字段为：

- `project-file`：`path`，文件扩展名必须不区分大小写地等于 `.html` 或 `.htm`
- `external-file`：`path`，必须是现有 external read 方法接受的绝对路径，文件扩展名必须不区分大小写地等于 `.html` 或 `.htm`
- `session-attachment`：`sessionId`，以及 `attachmentId` / `uri` 中恰好一个；Hub 返回结果必须是非二进制 HTML

handler 在读取任何来源前依次验证：

1. Registry browser session 对当前 base path 有效。
2. `Origin` 与可信 scheme、Host 和 port 完全相同。
3. `Sec-Fetch-Site` 为 `same-origin`。
4. `Sec-Fetch-Mode` 为 `navigate`。
5. `Sec-Fetch-Dest` 为 `iframe`。
6. form 中 CSRF token 与 session token 常量时间相等。

该校验使用 preview 专用函数；现有 `BrowserWriteRequestAllowed` 会拒绝 `navigate`，不能直接复用。缺少 Fetch Metadata 的请求也拒绝，不为旧浏览器降级。

### Registry → Hub 转发

handler 把通过 schema 校验的 descriptor 映射为固定方法和 payload，然后使用 `request.Context()` 驱动的 Registry 内部转发函数等待目标 Hub 响应。HTTP 客户端断开、server timeout 或 Hub timeout 时必须清理 pending request。调用方不能在 descriptor 中指定任意 Registry method。

转发结果只在满足以下条件时作为预览正文返回：

- Hub 返回成功 response。
- 内容为文本而非二进制或 base64 文件。
- 项目/外部文件路径是 `.html` / `.htm`；附件响应 MIME type 去除参数后不区分大小写地等于 `text/html`。
- 内容可以作为 UTF-8 字符串返回。

Registry 不注入 `<base>`、脚本、样式、错误标记或 source-map 信息，也不改写用户 HTML。

### 响应策略

成功响应使用 `Content-Type: text/html; charset=utf-8`、`Content-Disposition: inline`，并至少发送：

```text
Cache-Control: no-store
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; frame-ancestors 'self'; sandbox allow-scripts
```

不得发送 `X-Frame-Options: DENY`，不得允许 `'unsafe-eval'`。响应头 CSP 中的 `sandbox allow-scripts` 是 iframe attribute 之外的纵深防护，即使错误地发生顶层导航，文档仍被强制放入 opaque origin。

认证失败、来源无效、Hub 离线、超时、文件不存在、二进制内容、非 HTML 附件和传输限制错误均返回固定的静态错误 HTML。无有效 session 返回 `401`；Origin、Fetch Metadata 或 CSRF 校验失败返回 `403`；来源 schema 错误返回 `400`；文件不存在返回 `404`；二进制或非 HTML 内容返回 `415`；Hub 离线返回 `503`；Hub timeout 返回 `504`；其他 Hub/transport failure 返回 `502`。错误页不包含用户 HTML、绝对路径、token 或内部 error details，使用更严格的无脚本 CSP，并同样设置 `no-store`、`no-referrer`、`nosniff` 和 `frame-ancestors 'self'`。

### 代理与主应用安全头

正式部署继续使用现有 `location /ws` 前缀反代；POST body 和 Registry 响应头由该 location 原样传递。`INSTALL.md` 和 `docs/nginx-security.md` 需要明确该 location 不能改成只匹配 `/ws` 的 exact location，也不能为 preview 响应增加/继承 `X-Frame-Options: DENY` 或覆盖 upstream CSP。遵循当前文档拓扑的部署不需要新增或修改 location；偏离该拓扑的部署必须自行恢复这些代理语义。

webpack-dev-server 已用 `/ws` 前缀代理 Registry，因此不新增 proxy target。其全局 header middleware 当前会在 proxy 前设置主应用 CSP 和 `X-Frame-Options: DENY`；开发配置必须按 request path 排除 `/ws/preview/` 的这两个 header，让 Registry preview 响应的专用 CSP 生效。主应用页面和其他静态资源继续获得原有严格 header。

## 流程

1. Workspace 识别项目文件、项目外文件或 Session 附件为 HTML。
2. Workspace 获取必要的 tab metadata，但不读取 HTML 正文；`HtmlPreview` 得到 source descriptor、endpoint 和当前 CSRF token。
3. 隐藏 form 向 sandbox iframe POST descriptor。
4. Registry 校验规范路由、browser session、同源 Fetch Metadata、CSRF 和 descriptor schema。
5. Registry 根据固定 source 类型向拥有 `projectId` 的 Hub 转发现有 read 方法。
6. Hub 沿用现有路径边界和附件解析逻辑读取一次正文。
7. Registry 校验文本/HTML 响应，附加 preview 专用安全头并原样返回 HTML。
8. iframe 在 opaque origin 中执行内联 JavaScript；主应用不能访问 iframe DOM，iframe 也不能访问主应用凭据、外部子资源或网络 API。

## 验收标准

- Browser、WheelMaker Desktop 和 Android 中的项目 `.html` / `.htm` 预览不再白屏，内联脚本默认执行。
- 项目外 `.html` / `.htm` 文件和 HTML Session 附件使用相同预览行为。
- iframe 及响应 CSP 都只放开脚本，不放开 same-origin、表单、popup、下载或顶层导航能力。
- 内联 CSS、内联脚本和允许的 `data:` / `blob:` 资源正常工作。
- 外部脚本、外部图片/样式/字体/媒体、`fetch`、XHR、WebSocket、Worker、子 frame、对象和表单均被阻止。
- 普通浏览器中的预览文档仍可能导航自己的 iframe；该平台例外不被描述成受 CSP 阻止，也不会获得顶层导航、popup、主应用 origin 或 bridge 能力。
- 预览脚本不能读取主应用 DOM、cookie、`localStorage` 或 Desktop native bridge。
- 顶层访问、跨站 form、无 session、错误 base path、错误 CSRF、缺失或不匹配 Fetch Metadata 的请求不能读取 HTML。
- preview 请求没有 source query；默认 Nginx access log 不记录 descriptor、绝对路径或 CSRF。
- 项目/外部路径继续由现有 Hub 方法执行路径校验；Registry 不直接读取 Hub 文件系统。
- HTML 正文只通过 preview handler 读取一次，前端不再为 HTML tab 预取 content。
- HTML tab 不再生成 Workspace 源码搜索结果，也不尝试按源码行访问 iframe DOM。
- 预览层不新增大小限制；超过既有 transport/runtime 边界时显示固定错误页。
- 主应用生产 CSP、webpack 静态页面 CSP 和 `web-security-policy` 的 `'unsafe-inline'` / `'unsafe-eval'` 防护保持不变。
- production Nginx 不新增 location；现有 `/ws` prefix location 同时承载 WebSocket、认证请求和 preview POST。
- `INSTALL.md` 和 `docs/nginx-security.md` 记录 `/ws/preview/` 对 prefix proxy、upstream CSP 和无 XFO 覆盖的要求。
- Registry/Hub protocol version 不变，port relay 模块没有被 preview 模块导入或调用。
- Markdown、图片、代码、diff 和非 HTML 附件预览行为不变。

### 测试

- Go route 测试覆盖根路径和子路径、method/path/query/content-type/body schema、64 KiB descriptor 限制及 WebSocket handler 隔离。
- Go 安全测试覆盖 session/base-path、Origin、全部 Fetch Metadata 字段、CSRF、跨站请求和顶层导航拒绝。
- Go 转发测试覆盖三类 source 到固定现有方法的映射、Hub offline/disconnect/timeout、request context 取消和 pending request 清理。
- Go 响应测试覆盖文本 HTML、二进制/非 HTML 拒绝、UTF-8、成功/错误安全头、无用户路径或内部错误泄露。
- Web 组件测试覆盖隐藏 form POST、稳定 iframe target、descriptor 更新重提交流程、精确 sandbox/referrer policy，以及不存在 `srcDoc` / `allow-same-origin`。
- Workspace 测试覆盖三类 HTML source descriptor，并确认 HTML 不再触发正文预读、源码搜索和源码行跳转；其他预览类型继续使用原读取链路。
- webpack 测试覆盖 `/ws/preview/` 不附加主应用 CSP/XFO，同时普通页面仍发送完整安全头。
- Desktop policy 测试确认同一 base origin 下的 `/ws/preview/` 子框架导航允许，非 base origin 子框架和 native bridge 子框架调用仍然拒绝。
- 运行相关 Go package tests、App 定向测试、`npm run tsc:web`，并在实现完成后运行完整 server/app 回归测试。

## 范围之外

- 相对 workspace 资源解析、静态资源代理、HTML/CSS URL 重写或 `<base>` 注入
- 第三方/相对脚本、外部子资源、CDN、API、WebSocket 或跨 origin 数据访问能力
- 解析或改写 HTML/JavaScript 以拦截 child navigable 自身的链接或 `location` 导航
- HTML 预览脚本开关、预览/source toggle 或权限持久化
- `allow-same-origin`、localStorage、主应用 DOM 访问或 iframe/native bridge 通信
- HTML 源码搜索、源码行跳转或 preview DOM 定位
- preview 专用文件大小限制或 Registry 全局传输限制调整
- 独立 preview domain、独立公网 listener 或新增 Nginx location
- port relay 代码、认证、cookie、access code、login guard 或路由复用
- Registry/Hub WebSocket 新方法或 protocol version 变更
- 主应用 CSP 放宽
