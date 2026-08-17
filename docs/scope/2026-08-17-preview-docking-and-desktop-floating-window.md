> 由 scope skill 于 2026-08-17 生成
> 状态：已批准 2026-08-17

# Preview 固定抽屉与 Desktop 浮动窗口

## 目标

迭代 Preview 区的桌面交互：文件/Git 抽屉被 pin 后固定在 Preview 内部，不再长期覆盖 Chat；同时在 PC Desktop EXE 上支持把整个 Preview 浮动为独立窗口，以便双屏使用。浮动窗口与主窗口只保留一个可见 Preview 渲染实例，并完整保留 Preview 工作现场。

浏览器 PC 不增加弹窗/浮动能力，Android 不在本次范围内；移动端继续使用现有的 Preview 内部抽屉行为。

## 已确认决策

### PC 抽屉布局

- 未 pin 时保持现有 Desktop 临时抽屉：抽屉位于 Preview 左侧外部，覆盖 Chat 列，不挤占 Preview 内容宽度。
- pin 后抽屉转为 Preview 内部左侧分栏，Preview 内容移动到右侧；Chat 不再被抽屉遮挡。
- pin 是显式的布局状态。关闭抽屉、重新打开抽屉、在 Files/Git 之间切换、切换文件或分支都不清除 pin；只有显式 Unpin 才恢复外部临时抽屉。
- pin 不跨应用重启持久化；应用重启后按未 pin 状态启动。
- 移动端维持现有内部抽屉布局与交互，不因本次 PC docking 改变。

### Desktop 浮动窗口

- 仅 Desktop EXE 支持浮动；浏览器 PC 与 Android 不显示浮动入口。
- Preview 工具栏增加显式 Float Preview 操作；pin 与浮动相互独立，pin 不会自动触发浮动。
- 浮动窗口是正常的顶层 companion window，拥有独立任务栏项，可独立 Alt+Tab、最小化和获得焦点。
- 浮动是 detach，而不是复制：主窗口隐藏 Preview 并让 Chat 占满可用区域，浮动窗口成为唯一可见 Preview 渲染者。
- 主窗口中的 Preview 入口在 detach 期间变为 Bring Preview to front/focus，只负责唤醒和聚焦浮动窗口，不在主窗口重新渲染第二份 Preview。
- 浮动窗口提供显式 Dock 操作；用户点击系统关闭按钮时自动 dock 回主窗口并显示 Preview。
- dock 或系统关闭浮动窗口时，必须保留 tabs、当前 tab、抽屉模式与 pin、Preview 搜索状态、搜索定位和滚动位置。

### 浮动窗口几何与重启

- 首次浮动时优先放置到第二块显示器；没有第二块显示器时放置在主窗口附近。
- 后续打开复用已记忆的位置与尺寸；如果显示器被拔除或边界失效，则将窗口重新放入当前可见屏幕。
- 浮动 detached 状态不在应用重启后自动恢复。重启后 Preview 从主窗口启动为折叠状态；仅保留窗口位置与尺寸记忆。

### Chat 来源的 Preview 动作

在 Preview 已浮动时，以下主窗口动作必须路由到浮动 Preview，并唤醒/聚焦浮动窗口，而不是更新一个隐藏的主窗口 Preview：

- 聊天中的文件链接；
- Changed Files；
- Quick Open 与 Preview 文件搜索结果；
- Git 文件、提交或分支相关入口；
- Chat 标题栏中会打开或切换 Preview 的动作。

## 架构

### Web 层：共享 Preview 视图，主窗口拥有状态

不要在 companion window 中加载完整 `WorkspaceApp`，也不要复制一套 Registry、Chat 或 Workspace 初始化。将当前 Preview 的 JSX、交互和样式抽取为共享的 `PreviewWorkbenchView`，由两个宿主复用：

```text
PreviewController / Preview state and data authority
              │
              ├── InlinePreviewHost
              │       └── PreviewWorkbenchView
              │
              └── DetachedPreviewHost ⇄ typed app-local channel
                      └── PreviewWorkbenchView
```

- 主 Web App 保持 Preview 状态与数据权威，包括 tabs、当前内容、Files/Git drawer、pin、搜索和需要恢复的工作现场。
- companion 只挂载 Preview-only host 与共享 `PreviewWorkbenchView`，作为渲染客户端和用户意图发送端，不建立第二套 `WorkspaceController`、`RegistryWorkspaceService` 或 Chat。
- 主窗口与 companion 通过有类型的应用内消息通道同步状态和动作。可使用 `BroadcastChannel` 或等价的 Web-side local channel；这不是 Registry/server protocol，不修改 Registry protocol version。
- 通道至少需要覆盖：companion ready/handshake、当前 Preview snapshot 或增量状态、打开/激活 Preview 目标、聚焦/唤醒、drawer/pin/search/scroll 状态同步、Dock 请求和 detach 状态变更。用户操作以 intent 回传主控制器，由主控制器更新权威状态后再广播结果。
- 主窗口即使不渲染 InlinePreviewHost，也继续持有 PreviewController，以保证 dock、主窗口来源动作和 companion 关闭时能够无缝恢复。
- 桌面浏览器安全边界不通过 query/hash 传递 companion 模式；使用专用 Preview-only 路径/入口，避免现有 Localhost 路径策略拒绝 query/hash 的约束。

### Desktop 宿主：Go 只管理原生窗口生命周期

Desktop Go 宿主负责创建和销毁第二个 WebView2 顶层窗口，以及原生窗口能力：

- 创建 companion WebView2 并导航到专用 Preview-only 入口；
- 记录窗口句柄、显示器位置、尺寸和可见性；
- Bring to front、focus、minimize、close/dock；
- 保存和校验窗口 bounds；
- 处理系统关闭事件并通知 Web 层完成 dock；
- 保持独立任务栏项。

Go 不接管 Preview 业务状态、不复制 Registry 调用、不定义跨窗口业务协议。Web 层消息通道负责主窗口与 companion 的 Preview 状态/动作同步，Go bridge 只提供原生窗口生命周期与几何操作。

### 视图宿主切换

```text
Inline + unpinned drawer
  ├─ pin       → Inline + internal drawer split
  ├─ Float     → Detached companion + main Chat-only
  └─ Unpin     → Inline + external temporary drawer

Detached companion
  ├─ main Preview button → focus/bring companion to front
  ├─ companion Dock      → Inline Preview restored
  ├─ system window close → automatic Dock
  └─ Chat Preview action → send intent + focus companion
```

Detach/dock 只切换宿主，不创建或销毁 Preview 业务 tab；切换期间的工作现场由 PreviewController 和 typed channel 保持。

## 现有代码落点

实现阶段重点整理以下已有边界，避免继续扩大 `WorkspaceApp` 中的 Preview 专属闭包：

- `app/web/src/app/WorkspaceApp.tsx`：拆出 Preview controller/host、detach 状态和 Chat 来源动作路由。
- `app/web/src/preview/previewWorkbenchState.ts`：补齐 pin 的 sticky 生命周期、detach/attach 运行时状态与 snapshot 恢复边界。
- `app/web/src/preview/PreviewWorkbenchChrome.tsx`：统一 inline、detached 两种宿主的 toolbar action、pin、Dock/Float 和 focus 语义。
- `app/web/src/styles/file.css`：增加 pinned internal split；保留 unpinned external overlay 与 mobile internal drawer 样式。
- `app/web/src/main.tsx` 及 Desktop 入口：支持专用 Preview-only host，不启动完整 Workspace。
- `app/web/src/platform/desktop/desktopRuntime.ts`：补充 companion window 的创建、聚焦、Dock/close、bounds 能力边界。
- `server/cmd/wheelmaker-desktop/webview_windows.go`、`desktop_bridge.go`、`webview_profile_windows.go`：实现第二个 WebView2 顶层窗口的生命周期、系统关闭和窗口几何管理。

## 用户流程

### 固定 Files/Git 抽屉

1. 用户在 Desktop Preview 打开 Files 或 Git drawer，默认仍是外部临时层。
2. 用户点击 pin，drawer 在 Preview 内部变为左侧分栏，Preview 内容位于右侧，Chat 不被覆盖。
3. 用户关闭并重新打开 drawer，或在 Files/Git 间切换，drawer 仍按 internal split 打开。
4. 用户点击 Unpin 后，下一次打开恢复为 Preview 外部临时层。

### 浮动 Preview

1. 用户在 Desktop Preview 工具栏点击 Float Preview。
2. 主窗口将 Preview 宿主切换为 detached，Chat 扩展填满原 Preview 区；Go 创建或复用 companion 顶层窗口。
3. companion ready 后，主窗口发送当前 Preview snapshot，companion 渲染唯一可见 Preview。
4. 用户从 Chat 或主窗口入口打开文件、Changed Files、Quick Open 或 Git 目标时，主控制器更新 Preview 状态并让 companion 聚焦到目标。
5. 用户点击 companion 的 Dock，或点击系统关闭按钮，主窗口恢复 InlinePreviewHost，companion 关闭，当前 Preview 工作现场保持不变。

### 应用重启

1. 应用启动不恢复 detached 状态，也不创建 companion window。
2. 主窗口启动后 Preview 处于折叠状态；已有 tabs 等 snapshot 仍按现有恢复能力保留，待用户重新打开 Preview 时显示。
3. 下一次 Float 使用记忆的窗口几何；几何不可见时按当前显示器重新定位。

## 验收标准

- Desktop 未 pin 的 Files/Git drawer 保持现有外部临时覆盖行为；pin 后 drawer 完全位于 Preview 内部，Chat 不被覆盖，Preview 内容可用宽度正确分栏。
- pin 在关闭/重开 drawer、Files/Git 切换、文件或分支切换期间保持；显式 Unpin 后恢复外部临时层；pin 不跨重启恢复。
- Desktop 工具栏可显式 Float Preview；浏览器 PC 与 Android 不出现该入口，移动端既有内部 drawer 行为不改变。
- 浮动窗口是独立顶层窗口并拥有独立任务栏项，可独立 Alt+Tab、最小化和聚焦；同一时刻不存在两个可见 Preview renderer。
- 浮动后主窗口只显示 Chat；主窗口 Preview 入口可 Bring to front/focus，不能在主窗口生成隐藏或重复 Preview。
- companion 的 Dock 和系统关闭按钮都能自动恢复主窗口 Preview；恢复后 tabs、当前 tab、drawer/pin、搜索状态、搜索定位和滚动位置不丢失。
- Chat 文件链接、Changed Files、Quick Open、文件搜索、Git 入口和 Chat 标题栏 Preview 动作在浮动期间都会更新浮动 Preview 并聚焦它。
- 首次浮动优先落到第二显示器；无第二显示器时靠近主窗口；后续复用几何；显示器移除后窗口会回到可见屏幕。
- 应用重启不自动恢复 detached companion，Preview 从主窗口折叠启动；窗口位置/尺寸记忆仍可用。
- companion 只加载 Preview-only host，不重复初始化完整 Workspace、Chat、Registry 或 server session；不修改 Registry protocol version。

### 测试

- `previewWorkbenchState`：pin sticky 生命周期、显式 Unpin、drawer reopen、Files/Git 切换、detach/attach 与重启边界。
- Preview host/view：inline 与 detached 使用同一共享视图；pinned internal split、unpinned external overlay、mobile unchanged；Float、Bring to front、Dock action 的可见性和语义。
- Web channel：handshake、snapshot/状态同步、intent 回传、Chat 来源动作路由、companion 断开/重连、Dock 后无重复 renderer。
- Preview 工作现场：tabs、当前 tab、drawer/pin、搜索 query/active result、滚动位置在 detach/dock 和 companion 系统关闭后保持。
- Desktop Go/WebView2：companion 创建/复用/销毁、系统关闭通知、独立窗口 focus/minimize、任务栏窗口、第二显示器定位、bounds 持久化与失效 bounds 修正。
- 手工验收：单屏、双屏、拔除第二屏、最小化主窗口/companion、Alt+Tab、主窗口来源动作和应用重启。

## 范围之外

- 浏览器 PC 的 `window.open`/独立浏览器 popup 浮动 Preview。
- Android 的独立窗口或系统多窗口适配。
- 同时打开多个 companion Preview 窗口。
- 应用重启后自动恢复 detached 状态。
- companion 自己建立完整 Workspace、Chat、Registry 数据层或独立 server session。
- 新增或修改 Registry/server protocol，以及 protocol version 变更。
- 改变 Preview 内容类型、文件/Git 数据语义、Chat 与 Preview 原有打开动作的业务含义。

## Wiki 沉淀

- 更新 `docs/wiki/frontend-interaction/workbench-chrome.md`：补充 PC pinned internal split、unpinned external drawer、detached host、Dock/Float 和移动端边界。
- 新建 `docs/wiki/architecture/desktop-companion-window.md`：记录 Desktop WebView2 companion window、Web-side typed channel、Go 原生窗口职责与重启/几何策略。
