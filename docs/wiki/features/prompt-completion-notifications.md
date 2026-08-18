> 摘要：本页维护 Prompt 完成通知的统一内容模型、同会话替换语义、点击跳转行为和三端（PWA / APK / exe）呈现约定。

# Prompt 完成通知

Prompt 完成通知在 agent 结束一轮 prompt 时提醒用户，覆盖 PWA（浏览器/WebView 外的 PWA 场景）、APK（Android 原生）和 exe（Windows Desktop）三端。功能开关在设置页 Notifications，各端 provider 由 `createNotificationProvider` 按 android → desktop → pwa → unsupported 顺序选择。

## 触发边界

- 仅在收到 `prompt_done` 事件，且页面不可见或用户正在查看其他会话时弹出；当前可见会话不打扰。
- completed / cancelled / interrupted / failed 四种结束状态都弹；视觉归三类：成功（绿）、失败（红）、停止（灰，cancelled 与 interrupted 共用）。
- 同一 turn 只弹一次（客户端内存去重）。

## 统一内容模型（IM 式）

- 标题 = 会话标题（空标题回落 sessionId），承担"来源"区分，不放状态文案。
- 正文 = agent 最后一条回复的预览文本；预览为空时回落状态短语（如 "Prompt cancelled"）。
- 状态差异由图标/颜色承担：PWA 正文加符号前缀（✓ / ✗ / ■），APK 用 `setColor` 染色，exe Toast 正文同样加符号前缀（✓ / ✗ / ■，与 PWA 一致）。
- 预览数据由 Hub 唯一生产：Session 累积当前 turn 的 assistant 文本，在 `prompt_done` param 的 `replyPreview` 字段下发（折叠空白、去 markdown 标记、保留尾部约 160 字符；failed 时兜底 error message）。`replyPreview` 是可选增量字段，旧客户端忽略，不构成协议版本变更。

## 同会话替换

替换键统一为 `projectId:sessionId`：同一会话最多保留一条通知，新完成事件替换旧通知内容并重新提醒。PWA 用 `tag` + `renotify`，APK 用固定通知 ID 原地更新，exe 用 WinRT `Tag = projectId:sessionId` 原生替换并重新弹出。

## 点击行为

三端一致：聚焦应用窗口并跳转到通知对应的会话。落地链路：

- PWA：service worker `notificationclick` 按 origin 匹配已有窗口客户端，存在则 focus + `postMessage`（`WM_NOTIFICATION_NAVIGATE`）无刷新跳转，不存在则 `openWindow` 深链 URL。
- APK：PendingIntent 回 MainActivity，经 `wmProjectId`/`wmSessionId` 深链导航。
- exe：Toast 的 `launch` 属性携带 `projectId`/`sessionId`，点击（横幅或操作中心历史条目）触发进程内 COM 激活器（`INotificationActivationCallback`），回调经 `PostMessage` 中转回 UI 线程后还原并聚焦主窗口，Eval 派发 `wheelmaker:desktop-notification-click` 事件完成跳转；应用未运行时由 Windows 经 `LocalServer32` 拉起进程后走同一回调。

三端跳转在 web 侧共用同一运行时入口，与启动时 `wmProjectId`/`wmSessionId` URL 深链消费同一套落点逻辑。

## 平台呈现约定

- **PWA**：service worker `showNotification`；图标与 badge 使用 PNG 位图（Chromium 桌面通知不支持 SVG），正文带状态符号前缀。
- **APK**：`NotificationCompat`，渠道 `chat_prompt_completion`；smallIcon 为透明底单色 `ic_notification`（状态栏按 alpha 掩码渲染，不可用不透明底启动图标）；Android 13+ 走运行时权限申请。
- **exe**：真 WinRT 系统 Toast（ToastGeneric，无大头像），header 的图标与应用名来自启动时的 HKCU 自注册（`AppUserModelId\WheelMaker.Desktop` 的 DisplayName / IconUri / CustomActivator + CLSID `LocalServer32`，全部 HKCU 无需管理员，不依赖安装脚本；IconUri 指向释放到 `~/.wheelmaker/desktop/` 的内嵌图标 PNG）；dev 构建与正式构建共用同一 AUMID/CLSID，注册表指向最后运行的 exe（last-run-wins）；发送走手写 WinRT 互操作（`RoGetActivationFactory` + `XmlDocument.LoadXml` + `put_Tag`），无第三方依赖；不经过 WebView2 通知管道（其权限请求在无宿主处理时被静默拒绝，且 toast 点击不回传），因此不需要系统通知授权，desktop provider 权限恒为 granted。托盘图标常驻但与通知解耦：单击还原并聚焦主窗口，无右键菜单，关窗即退出的生命周期不变。

来源：`docs/scope/2026-08-17-prompt-completion-notifications.md`；exe 端 WinRT Toast 与托盘图标约定见 `docs/scope/2026-08-18-desktop-winrt-toast-notifications.md`。
