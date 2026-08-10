> 由 scope skill 于 2026-08-09 生成

# File Downloads

## 目标

WheelMaker 已能预览项目文件、项目外文件和 Session 附件，也为聊天文件链接、Changed Files 与 Preview 文件提供了部分右键动作，但还不能把这些由 Hub 管理的文件统一下载到当前操作设备。本次新增跨浏览器、WheelMaker Desktop 和 Android 的 `Download` 动作：鼠标设备通过右键、触屏设备通过长按打开共享文件菜单，文件由 Hub 经 Registry 流式传输给当前设备的系统下载器，不把完整文件缓存在 Hub、Registry 或 Web UI 内存中，也不设置业务大小上限。

## 决策

- 下载目标是当前操作设备，不是文件所属 Hub 主机。
- 覆盖现存的项目文件、项目外普通文件、可解析的 Session 附件、Changed Files 中未删除的文件、普通 file preview/tab，以及 Preview 文件树和搜索结果。普通 HTTP(S) 链接不由 WheelMaker 接管。
- 鼠标设备使用右键，Android 和其他触屏设备使用长按；两种手势打开同一套文件动作菜单。已有左键预览、打开、复制、导出和 tab 操作保持不变。
- 共享文件菜单新增 `Download`。Desktop 现有的 `Copy file`、`Open with VS Code` 和 `Show in File Explorer` 继续保留，语义不变。
- 浏览器遵循自身下载设置；Desktop 使用 WebView2 原生下载界面；Android 使用系统 DownloadManager 和下载通知。默认保存到平台 Downloads 位置，保留源文件名，重名由平台处理。
- 进度与取消由平台原生下载界面负责。WheelMaker 只报告下载请求能否成功交给平台；不新增应用内下载面板、历史或重试 UI。
- 下载采用流式分块传输，不设置业务大小上限。单个文件不得在 Hub、Registry 或前端被完整读入内存或整体 Base64 编码。
- 每次动作创建一个短时、不可猜测、绑定当前 Web session 且只对应一个下载任务的 URL。URL 不包含真实路径；一次 GET 开始后即被消费，不能用于第二次下载。
- 不支持 HTTP Range、断点续传或跨重启恢复。连接中断、Hub 离线或读取失败后，用户重新发起下载。
- 下载开始时只接受现存普通文件或有效附件。源文件在流式读取期间发生变化时终止响应，不能静默生成混合内容。
- 下载能力作为 Registry 2.7 的增量方法加入，不修改 protocol version，也不改变现有 preview、文件读取和附件读取方法的契约。

## 架构

Web UI 将所有可下载入口归一为三种源描述：项目文件、项目外文件和 Session 附件。已认证 WebSocket 请求先向 Registry 申请下载任务；Registry 以当前 Web session、CSRF 防护、目标项目和源描述为边界生成短时 capability URL。下载 GET 必须同时携带创建任务的同一有效 Web session，token 本身不是匿名下载凭证。该 URL 由浏览器或 Desktop 直接打开，Android 则通过受信任 native bridge 交给 DownloadManager。Registry 在唯一 GET 到达时向项目所属 Hub 打开只读传输，顺序拉取有界分块并写入同一个 HTTP 响应；完成、失败、客户端断开或 context 取消时都关闭 Hub 传输并释放 Registry 任务。

Registry 与 Hub 增加下载专用的打开、顺序读取和关闭能力，不能复用会整文件读取并编码的 `project.fs.read`、`project.fs.external.read` 或 `session.attachment.read`。Hub 在打开阶段完成现有项目路径、外部绝对路径或附件标识解析，验证目标是普通文件，固定文件名、大小、MIME 类型和用于检测传输期间变化的文件元数据。Registry 返回 `Content-Disposition: attachment`、`Content-Length`、安全的 MIME 与禁止缓存的响应头，不接受 Range 请求。

Android native bridge 只允许可信 WheelMaker 页面在明确用户手势后提交同源 Registry capability URL；native 侧必须再次校验 scheme、origin 和下载路径，只为精确同源 Registry 请求复制当前 Web session cookie，再交给 DownloadManager。浏览器下载不获得 Hub 地址或主机文件路径，Desktop bridge 也不直接读取远端 Hub 文件。

## 流程

1. 用户在可下载文件上右键或长按并选择 `Download`。
2. Web UI 根据入口构造项目文件、项目外文件或 Session 附件源描述，通过当前已认证 Registry 连接申请下载。
3. Registry 校验 Web session、CSRF、项目路由、源字段和任务配额，返回短时单任务 URL；准备失败时 UI 显示错误且不启动系统下载器。
4. 浏览器或 Desktop 携带当前 session cookie 导航到该 URL；Android native bridge 把通过同源校验的 URL和精确同源 session cookie 交给 DownloadManager。
5. Registry 原子消费任务并请求 Hub 打开源文件。Hub 验证目标、打开只读句柄并返回安全文件名、大小和 MIME 元数据。
6. Registry 写入下载响应头，循环向 Hub 请求下一个有界分块，解码单个传输分块后立即写入 HTTP 响应并释放该分块。
7. 到达声明大小后，Registry 关闭 Hub 传输并使任务失效。客户端断开、读取错误、源变化或 Hub 断连时立即关闭传输；平台下载器把任务标记为失败。

## 验收标准

- 项目内文件、项目外普通文件和可解析 Session 附件都能下载到当前浏览器、Desktop 或 Android 设备，内容与 Hub 源文件逐字节一致。
- 聊天文件链接、未删除的 Changed Files 行、普通 file preview/tab、Preview 文件树/搜索结果和已发送附件均提供 `Download`；右键与长按菜单使用同一动作模型。
- 已删除 Changed Files、目录、缺失文件、无法解析的附件和只存在当前设备草稿中的未发送附件不提供可成功执行的远端下载。
- 普通 HTTP(S) 链接、Relay 链接、diff/历史快照等非当前普通文件资源不被下载菜单接管。
- 文件以源 basename 或附件原始名称下载；名称经过响应头安全编码，不能注入额外 header 或路径。缺失名称时使用稳定的安全 fallback。
- 浏览器使用浏览器下载管理器，Desktop 使用 WebView2 下载 UI，Android 使用系统 DownloadManager；平台 UI 能显示进度并取消当前传输。
- 多个用户动作可创建相互独立的系统下载任务；每个 capability 只绑定一个源、一个 Web session 和一个下载任务。
- capability URL 具有足够熵、绑定创建任务的 Web session、短时失效且不暴露文件路径；缺少或不匹配 session、未认证的准备请求、错误 CSRF、错误 origin、过期 token、重复 GET、篡改源字段和 Android 非可信页面调用均被拒绝。
- Registry 下载响应禁止缓存，使用 `Content-Disposition: attachment` 和准确 `Content-Length`，声明不支持 Range；Range、续传和第二次 GET 不会返回文件内容。
- 大文件传输按有界分块工作；自动化测试能证明读取跨越多个分块，且实现中不存在整文件 `os.ReadFile`、整文件 Base64 或前端 Blob 聚合链路。
- 客户端取消、Hub 离线、源文件传输期间变化和中途读取失败都会终止响应并释放 Hub 文件句柄及 Registry 任务，不遗留可复用 token 或传输状态。
- 旧客户端继续使用现有 preview/read 能力；不修改 Registry protocol version。新客户端连接不支持下载增量方法的旧 Hub 时显示明确不可用错误，不回退到整文件读取。

### 测试

- Web 单元/组件测试覆盖源描述归一化、菜单动作顺序、右键与长按、已删除/无效来源隐藏、准备失败提示，以及浏览器/Desktop/Android 三条启动路径。
- Registry Go 测试覆盖准备鉴权、CSRF、token 熵与过期、原子消费、重复请求、Range 拒绝、响应头、分块转发、客户端取消和 Hub 错误清理。
- Hub Go 测试用跨多个分块的项目文件、外部文件和 Session 附件覆盖打开、顺序读取、EOF、关闭、普通文件校验、路径边界、源变化和断开清理。
- Desktop Go 测试覆盖 WebView2 下载行为仍受可信页面与导航策略约束；Android JVM 测试覆盖用户手势、同源 URL 校验、DownloadManager 请求、文件名/MIME 传递和拒绝不可信调用。
- 手动 smoke test 分别在主流浏览器、WheelMaker Desktop 和 Android 验证默认 Downloads、重名处理、原生进度、取消、小文件、大文件和失败提示。自动化测试不验证操作系统最终采用的重名文件名。

## 范围之外

- 任意 HTTP(S) URL 下载、网页抓取或远端 URL 代理。
- 目录打包下载、多选批量打包或历史 Git blob/diff 内容导出。
- HTTP Range、断点续传、失败自动重试和跨应用重启恢复。
- WheelMaker 内部下载中心、下载历史、自定义保存目录或下载前重命名。
- 修改现有文件 preview 大小确认、附件 preview、Markdown HTML 导出或 Desktop `Copy file` 的行为。
