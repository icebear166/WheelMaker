> 摘要：本页维护 Desktop Preview companion window 的 Web、Go 宿主、窗口几何与生命周期边界。

# Desktop Companion Window

## 责任边界

Desktop companion window 是 Preview 的第二个顶层 WebView2 窗口，用于双屏和独立任务栏场景。它不是第二个 Workspace，也不创建自己的 Chat、RegistryWorkspaceService、WorkspaceController 或 server session。

- 主 Web App 是 Preview 状态和数据权威，继续拥有 tabs、当前内容、Files/Git drawer、pin、搜索、滚动与 Chat 来源动作。
- companion 只挂载 Preview-only host 和共享 Preview view，负责把主窗口状态渲染出来，并将用户操作作为 intent 回传。
- 主窗口与 companion 通过带版本的 typed app-local channel 同步 ready、state、intent 和 host lifecycle；该 channel 不属于 Registry/server protocol，也不改变 Registry protocol version。
- Go Desktop 只负责创建/销毁 WebView2、任务栏项、focus/minimize、系统关闭通知和窗口 bounds，不承载 Preview 业务状态。

## 生命周期

1. 主窗口点击 Float Preview 后请求 Go 创建 companion。
2. companion 导航到受信任 base path 下的专用 `/preview-window` route，ready 后接收当前 Preview state。
3. detach 期间主窗口隐藏 Preview renderer，Chat 扩展填充原区域；companion 是唯一可见 Preview renderer。
4. 主窗口中的文件链接、Changed Files、Quick Open、Git 和标题栏 Preview 动作继续由主控制器处理，然后同步 state 并聚焦 companion。
5. companion 的 Dock 操作或系统关闭按钮通知主窗口恢复 inline Preview；tabs、drawer、搜索和滚动现场不因宿主切换丢失。

应用重启不恢复 detached 状态；Preview 从主窗口折叠启动。companion 的位置和尺寸可以记忆，但几何记忆不代表恢复浮动状态。

## 窗口几何

首次打开优先放在第二块显示器；没有第二块显示器时放在主窗口附近。后续打开复用已保存的 bounds。显示器移除或 bounds 完全不可见时，宿主将窗口移回当前可见屏幕 work area。

companion 使用普通顶层窗口，因此拥有独立任务栏项、Alt+Tab 条目和最小化状态。浏览器 PC 与 Android 不创建该窗口；移动端 Preview drawer 继续使用内部布局。

## 来源

- [`docs/scope/2026-08-17-preview-docking-and-desktop-floating-window.md`](../../scope/2026-08-17-preview-docking-and-desktop-floating-window.md)
