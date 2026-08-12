> 摘要：本页维护文件入口的路径解析、项目外预览、右键与长按共享菜单、跨设备流式下载、Desktop 文件动作与文件剪贴板，以及 Markdown HTML 导出边界。

# File Links

> 来源：[`docs/scope/2026-07-24-external-file-links.md`](../../scope/2026-07-24-external-file-links.md)

> Markdown HTML 导出来源：[`docs/scope/2026-07-24-markdown-html-export.md`](../../scope/2026-07-24-markdown-html-export.md)

> 共享文件菜单来源：[`docs/scope/2026-07-28-file-context-menu-actions.md`](../../scope/2026-07-28-file-context-menu-actions.md)

> 文件下载来源：[`docs/scope/2026-08-09-file-downloads.md`](../../scope/2026-08-09-file-downloads.md)

> 上下文菜单手势来源：[`docs/scope/2026-08-12-unified-context-menu-gestures.md`](../../scope/2026-08-12-unified-context-menu-gestures.md)

## 本地文件识别

聊天文件链接支持项目内相对路径、规范化后逃出项目根目录的相对路径、Windows 盘符或 UNC 绝对路径、POSIX 绝对路径、`file://` URI 和 `vscode://file` URI。链接中的行号后缀或锚点用于 preview 跳转，不属于复制路径的结果。其他 URI scheme 继续作为普通链接处理。

文件引用分为两类：

- `project`：规范化后位于聊天所属项目根目录内。
- `external`：绝对路径，或规范化后位于聊天所属项目根目录外。

文件所属项目始终取自当前聊天，而不是全局当前项目或 preview 当前 tab。

## Preview 读取边界

项目文件继续通过 `project.fs.info` / `project.fs.read` 读取，保留现有缓存、目录树、索引和恢复行为。

项目外文件通过独立的 `project.fs.external.info` / `project.fs.external.read` 只读方法，从聊天项目所在 Hub 主机读取。已认证客户端可以读取该 Hub 主机上的任意本地文件；这是明确的信任边界。外部方法只接受宿主机绝对路径，不支持目录浏览、搜索、索引、同步或写入。

外部文件不使用 `knownHash`，不写入文件或目录持久化 cache。当前页面可以在已打开的 preview tab 状态中暂存读取结果。大文件确认、二进制判断、错误展示和行号跳转复用普通文件 preview 行为。

## 文件链接菜单

鼠标右键点击或 touch/pen 长按已识别的文件目标会打开同一套共享文件菜单。入口包括聊天文件链接、已发送附件、Changed Files 中未删除的单个文件行、普通 file preview/tab，以及 Preview 文件树、Preview 文件搜索结果和 Quick Open 文件结果。Changed file 左键继续打开 diff，`Changed N files` 汇总按钮不接管文件菜单。长按延迟、移动取消、haptic、合成事件抑制、目标局部禁选中与嵌套按钮规则统一遵循 [`../frontend-interaction/context-menu-gestures.md`](../frontend-interaction/context-menu-gestures.md)。

菜单第一项固定为 `Preview file`，用于打开普通 file preview tab；有效的当前普通文件或可解析的已发送附件随后显示 `Download`。文件已删除或读取失败时，预览 tab 使用现有错误状态说明原因。项目内文件显示 `Copy relative path` 和 `Copy absolute path`；项目外文件只显示 `Copy absolute path`。复制结果只包含路径，不包含链接中的行号。

Desktop 菜单按打开、文件复制、路径复制分为三组，不显示分组标题：

1. `Preview file`
2. `Download`
3. `Open with VS Code`
4. `Show in File Explorer`
5. `Copy file`
6. `Copy file as HTML`（仅项目内 Markdown）
7. `Copy relative path`（仅项目内文件）
8. `Copy absolute path`

两个文件复制动作和路径复制动作之间使用轻量分隔线；不可用动作隐藏后不保留多余分隔线。浏览器与 Android 不显示 `Copy file`，项目内 Markdown 使用 `Export as HTML`。

点击空白处、按 Escape、选择动作、滚动或调整窗口尺寸会关闭菜单。普通网页链接、Relay 链接和无法识别的 URI 不受文件菜单接管。现有 preview 文件菜单及其动作继续保留。

菜单使用现有线性图标体系和主题 token。浅色主题使用较低浓度阴影并保持清晰边界；深浅主题中的图标、分隔线、hover 和 focus-visible 状态都必须清晰。

## 文件下载

下载目标始终是当前操作设备，不是文件所在的 Hub 主机。Web UI 只提交三种受管理来源：项目内当前普通文件、Hub 主机上的项目外绝对路径普通文件，以及能由 `sessionId` 配合 `attachmentId` 或受控 `file://` URI 解析的已发送 Session 附件。目录、已删除 Changed file、无法解析的附件、仅存在当前设备草稿中的附件、diff/历史快照、Relay 链接和任意 HTTP(S) URL 不进入下载链路。

已认证 WebSocket 客户端通过 `file.download.prepare` 向 Registry 申请任务。请求包含当前 Web session 的 CSRF token、项目 ID 和一个源描述；Registry 先让项目所属 Hub 验证来源，再创建短时、高熵、只对应一个来源和一个下载任务的 capability URL。URL 固定为 Registry 的 `<base-path>/ws/download/<token>`，复用现有 `/ws*` Registry 入口，不要求 Gateway 增加单独下载路由；URL 不包含 Hub 地址或主机文件路径。下载 GET 还必须携带创建任务时的同一有效 Web session；token 本身不是匿名凭证，首次有效 GET 原子消费任务，后续 GET 不能再次读取内容。

Registry 通过下载专用的 Hub `open`、顺序 `read` 和 `close` 方法传输内容。Hub 打开只读文件句柄，固定源文件名、大小、MIME 和文件身份；每次只读取一个有界分块，并在读取期间验证文件身份、大小和修改时间未变化。Registry 解码单个传输分块后立即写入同一个 HTTP 响应，不把完整文件读入 Hub、Registry 或 Web UI 内存，也不复用会整文件读取的 preview/read 方法。完成、客户端取消、Hub 断线、读取错误或源变化都会关闭句柄并使任务失效。

响应使用准确的 `Content-Length`、安全编码的 `Content-Disposition: attachment`、受控 MIME、`Cache-Control: no-store` 和 `Accept-Ranges: none`。不支持 Range、断点续传、失败自动重试或跨重启恢复；失败后由用户重新执行 `Download`。文件名采用源 basename 或附件原始名称，缺失或不安全时使用稳定 fallback；保存位置、重名处理、进度和取消由平台原生下载界面负责。

- 浏览器通过同源 capability URL 交给浏览器下载管理器。
- WheelMaker Desktop 通过同一 URL 交给 WebView2 原生下载界面，不新增读取 Hub 文件的 Desktop bridge。
- Android Web UI 先在用户动作中保留一次 `file.download` grant，再将 prepare 返回的 URL 交给受信任 native bridge。Native 端重新验证 HTTPS scheme、Registry 精确 origin、base path 和 `/ws/download/<token>` 结构，只复制该同源 URL 的当前 Web session cookie，然后交给系统 `DownloadManager` 与 Downloads 目录。下载准备或原生启动失败时，连接态界面显示 toast；Android 只记录原生 action 和分类原因，不记录异常正文、Cookie、URL 或 capability token。

这些方法是 Registry 2.7 的增量能力，不修改 protocol version，也不改变现有 preview、附件读取或 Desktop `Copy file`。新客户端连接不支持下载方法的旧 Hub 时显示明确的不可用错误，不回退到整文件读取或 Base64 聚合。

## Desktop 文件动作

`Open with VS Code`、`Show in File Explorer` 和 `Copy file` 只在 WheelMaker Desktop 中显示；点击 preview 和复制路径在各端一致。

Desktop 使用可信页面授权保护的绝对文件 bridge。Bridge 只接受绝对路径，确认目标是现存普通文件后，启动固定的 VS Code 或 Windows File Explorer 进程。项目内和项目外链接均使用该动作；普通浏览器不获得启动本机程序的能力。

`Copy file` 把 Desktop 主机上现存的普通文件作为 Windows 文件对象放入系统剪贴板，不复制文本内容。该动作沿用 VS Code / Explorer 的 Desktop 主机路径边界，不下载或同步远端 Hub 文件；目录、缺失路径、非绝对路径和未授权调用必须被拒绝。明确标记为已删除的 Changed file 不显示文件复制动作。

## Markdown HTML 导出

项目 Markdown 文件可以从 preview 工作台的更多操作菜单导出为独立 HTML；聊天中已识别的项目 Markdown 文件链接和 Changed file 右键菜单也提供相同能力。非 Markdown 文件、项目外文件和明确标记为已删除的 Changed file 不提供该动作。

导出网页内嵌核心排版、代码高亮和项目内相对图片，并跟随系统浅/深色主题。项目图片只能在项目根目录内按来源文件目录解析；远程图片尽力内嵌，失败时保留原 URL 并向用户提示。原始 Markdown HTML 经过安全清理，脚本、事件属性与危险 URL 不得进入导出页面。

交付方式由运行环境决定：Desktop 右键菜单使用 `Copy file as HTML`，把受控临时 `.html` 文件放入系统剪贴板，粘贴应得到文件而非源码文本；Android、浏览器和 PWA 继续使用 `Export as HTML`，分别通过系统分享面板或下载交付文件。文件导出不打断用户，将源 Markdown 文件名的 `.md` 后缀替换为 `.html`。回复导出先显示文件名输入框，名称主体默认使用用户本地时间的 `YYYY-MM-DD_HH-mm-ss` 格式，`.html` 后缀由界面固定附加；自定义名称只对本次导出生效。

## 兼容性

外部文件方法最初作为 Registry 2.6 的增量能力加入，当时未单独修改 protocol version，也不改变现有项目文件方法的路径校验。当前 Registry 2.7 继续保留该契约；项目外文件不回退到项目文件方法。
