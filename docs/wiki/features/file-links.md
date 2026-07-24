> 摘要：本页维护聊天文件链接的路径解析、项目外预览、右键菜单、Desktop 文件动作和 Markdown HTML 导出边界。

# File Links

> 来源：[`docs/scope/2026-07-24-external-file-links/spec-external-file-links.md`](../../scope/2026-07-24-external-file-links/spec-external-file-links.md)

> Markdown HTML 导出来源：[`docs/scope/2026-07-24-markdown-html-export/spec-markdown-html-export.md`](../../scope/2026-07-24-markdown-html-export/spec-markdown-html-export.md)

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

右键点击已识别的聊天文件链接会打开文件菜单：

- 项目内文件显示 `Copy relative path` 和 `Copy absolute path`。
- 项目外文件只显示 `Copy absolute path`，不显示相对路径动作。
- 复制结果只包含路径，不包含行号。

点击空白处、按 Escape、选择动作、滚动或调整窗口尺寸会关闭菜单。普通网页链接、Relay 链接和无法识别的 URI 不受文件菜单接管。现有 preview 文件菜单及其动作继续保留。

## Desktop 文件动作

`Open with VS Code` 和 `Show in File Explorer` 只在 WheelMaker Desktop 中显示；点击 preview 和复制路径在各端一致。

Desktop 使用可信页面授权保护的绝对文件 bridge。Bridge 只接受绝对路径，确认目标是现存普通文件后，启动固定的 VS Code 或 Windows File Explorer 进程。项目内和项目外链接均使用该动作；普通浏览器不获得启动本机程序的能力。

## Markdown HTML 导出

项目 Markdown 文件可以从 preview 工作台的更多操作菜单导出为独立 HTML；聊天中已识别的项目 Markdown 文件链接也在右键菜单提供相同动作。非 Markdown 文件和项目外文件不提供该导出动作。

导出网页内嵌核心排版、代码高亮和项目内相对图片，并跟随系统浅/深色主题。项目图片只能在项目根目录内按来源文件目录解析；远程图片尽力内嵌，失败时保留原 URL 并向用户提示。原始 Markdown HTML 经过安全清理，脚本、事件属性与危险 URL 不得进入导出页面。

交付方式由运行环境决定：Desktop 把受控临时 `.html` 文件放入系统剪贴板，粘贴应得到文件而非源码文本；Android 通过系统分享面板交付临时文件；浏览器和 PWA 下载该文件。文件导出将 `.md` 后缀替换为 `.html`，回复导出使用带 turn 序号和时间戳的文件名。

## 兼容性

外部文件方法是 Registry 2.6 的增量能力，不修改 protocol version，也不改变现有项目文件方法的路径校验。新 App 连接旧 Hub 时，项目内文件维持原行为，项目外文件明确提示 Hub 不支持外部文件预览，不回退到项目文件方法。
