> 摘要：本页维护 HTML 预览的 Registry POST 加载链路、脚本能力、sandbox/CSP 安全模型和来源边界。

# HTML Preview

## 用户行为

Workspace 对项目文件、项目外绝对路径文件和 Session 附件中的 `.html` / `.htm` 提供相同的渲染预览。内联 JavaScript 默认执行，不提供脚本开关；HTML 预览也不参与 Workspace 自定义源码搜索或源码行跳转。

HTML 预览面向简单文档，允许从任意绝对 HTTPS 地址加载第三方 JavaScript、CSS、字体、图片和媒体。`fetch`、XHR、WebSocket、Worker、子 frame、网络表单和相对 workspace 资源仍不受支持；`./styles.css`、`./app.js` 等相对资源不会映射到项目文件。预览不解析、注入或改写用户 HTML、CSS 和 JavaScript。

## 加载架构

Web 前端不把 HTML 放入 `srcDoc`，也不预读正文。`HtmlPreview` 使用隐藏 form，把类型化 source descriptor 和当前 Registry CSRF token 无状态 POST 到同一 base path 下的 `/ws/preview/`，响应直接加载进目标 sandbox iframe。descriptor 位于请求体，不进入 URL、浏览器历史或默认 Nginx access log。

Registry 校验 browser session、base path、Origin、Fetch Metadata、CSRF 和 descriptor schema 后，只能使用以下固定映射向拥有该项目的 Hub 请求正文：

| Preview source | Hub method |
| --- | --- |
| Project file | `project.fs.read` |
| External absolute file | `project.fs.external.read` |
| Session attachment | `session.attachment.read` |

Registry 不直接读取 Hub 文件系统，不允许调用方指定任意 method，不创建 preview session 或临时 token。该链路复用 Registry 的通用 Hub 请求转发能力，但不导入或调用 port relay 的认证、cookie、access code、login guard 和路由代码。Registry/Hub WebSocket 方法及 protocol version 保持不变。

HTML 正文只由 preview handler 读取一次。预览层不增加专用文件大小限制；现有 Registry transport 限制、Hub 读取错误和 HTTP timeout 继续构成实际运行边界。

## 安全模型

iframe 固定使用 `sandbox="allow-scripts"`，不增加 `allow-same-origin`、表单、popup、下载或顶层导航权限。Registry 响应同时发送带 `sandbox allow-scripts` 的专用 CSP，形成 iframe attribute 之外的纵深限制。

preview CSP 允许内联脚本、内联样式，以及任意 HTTPS 来源的脚本、样式、字体、图片和媒体；图片和媒体继续支持 `data:` / `blob:`，字体继续支持 `data:`。`fetch`、XHR、WebSocket、Worker、子 frame、对象、表单和 `unsafe-eval` 仍被阻止。主应用 CSP 不为预览放宽。

打开含第三方资源的 HTML 会向对应服务器暴露设备网络信息。第三方 JavaScript 可以读取完整预览正文，并可借允许的资源 URL 把内容发送出去；因此该能力只适合用户愿意信任其 HTML 和依赖来源的场景。sandbox 隔离范围不变，第三方代码仍不能读取主应用 DOM、Registry cookie、`localStorage` 或 Desktop native bridge。

opaque-origin 文档不能读取主应用 DOM、Registry cookie、`localStorage` 或 Desktop native bridge。导航 POST 仍携带 HttpOnly Registry session cookie；常规浏览器必须发送与 Registry 精确同源的 Origin。Android WebView 会把 sandbox iframe 的 opaque origin 序列化为 `Origin: null`，因此只有 preview endpoint 额外接受该值，并且仍要求有效 session、`Sec-Fetch-Site: same-origin`、`Sec-Fetch-Mode: navigate`、`Sec-Fetch-Dest: iframe` 和正确 CSRF token。该例外不放宽 Registry 的通用 browser write 校验。GET、顶层访问、跨站 form、缺少 Fetch Metadata 和认证失败都不能读取 HTML。

标准 sandbox 允许文档导航自己的 child navigable，CSP fetch directives 也不约束普通 `_self` navigation。本功能不支持或鼓励预览内外部导航，但不通过解析或改写 HTML/JavaScript 拦截该浏览器行为。它不能逃出 iframe；Desktop 导航策略还会阻止 base origin 之外的子框架目标。

成功响应使用 `text/html; charset=utf-8`，并发送 `no-store`、`no-referrer`、`nosniff` 和 `frame-ancestors 'self'`。不得发送 `X-Frame-Options: DENY`。失败响应使用不包含用户 HTML、绝对路径、token 或内部错误细节的固定无脚本错误页。

## 代理边界

公开路径是 `<basePath>/ws/preview/`。现有 Nginx `location /ws` 必须保持 prefix proxy，并透传 Registry 的 POST body 和响应头；遵循项目部署文档的正式环境无需新增 preview location。

webpack-dev-server 的现有 `/ws` proxy 同样承载 preview POST，但不能给该响应附加主应用 CSP 或 `X-Frame-Options: DENY`。其他开发静态响应继续使用主应用安全头。

Desktop 把同一 base origin 下的 preview URL 视为允许的子框架导航；native bridge 继续只接受 main frame，不为 preview 增加权限。

## 来源

- [HTML 预览 JavaScript 执行 spec](../../scope/2026-07-26-html-preview-js.md)
