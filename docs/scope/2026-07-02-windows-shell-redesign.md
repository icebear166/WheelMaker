> 由 scope skill 于 2026-07-02 生成

# Windows Shell Redesign

## 目标

Windows 桌面版需要从当前的“横向标题栏 + 左侧 activity bar”布局，调整为更接近无框窗口的工作区体验：取消现有横向标题栏，取消最左侧 activity bar，让 Chat 会话列表和主对话区直接从窗口顶部与左边缘开始。默认进入 Chat，File/Git 在 Windows 桌面版不再作为可见入口展示。右上角仍使用 Web 侧绘制的窗口控制按钮，并在最小化按钮旁增加下拉菜单承载来源与设置入口。

## 决策

- Windows 桌面版不保留左侧窄栏；WheelMaker 图标不再占用左侧 activity bar 位置，改为右上角下拉按钮的图标，下拉按钮位于最小化按钮左侧。
- 取消现有横向 `DesktopTitleBar` 的标题、来源展示与占位高度；Chat 主区和右侧预览 Sidebar 的标题栏直接顶到窗口顶部。
- 右上角最小化、最大化、关闭按钮保持当前 Web 绘制方式和当前位置；新增下拉按钮位于最小化按钮旁。
- 下拉菜单第一项为“显示来源”；点击后展开来源子面板，展示当前标题栏里已有的来源状态、刷新入口，以及 remote/embedded 切换。
- 下拉菜单包含“设置”；点击后打开设置并替换左侧 Chat 会话列表区域，右侧主对话区继续保持当前 Chat 内容。
- Windows 桌面版默认显示 Chat。File/Git 的桌面可见入口隐藏；不在本次需求中删除其底层代码或服务能力。
- 移动端不纳入本次改造；桌面设置栏复用现有移动端设置页的列表与详情视觉风格。

## 架构

本次改造集中在 Workspace Web UI 的桌面 shell 层。桌面 shell 负责无标题栏布局、右上角窗口控制簇和内容区域排布；WorkspaceApp 负责决定当前左侧内容是 Chat 会话列表还是 Settings；来源切换继续复用现有 desktop web source 状态与 bridge 能力；设置内容继续复用现有 SettingsSurface、SettingsRootContent 与 SettingsDetailShell。

## 流程

Windows 桌面启动后进入 Chat，shell 不再渲染横向标题栏和 activity bar。右上角控制簇始终可见并处理窗口最小化、最大化、关闭和下拉菜单。用户点击下拉菜单的“显示来源”后，在同一菜单内展开来源控制；用户点击“设置”后，WorkspaceApp 将左侧 Chat 会话列表替换为设置列表或设置详情，主 Chat 对话区不切换。关闭设置后恢复 Chat 会话列表。

## 验收标准

- Windows 桌面宽屏布局中不显示横向标题栏，也不显示最左侧 activity bar。
- Chat 会话列表、Chat 主区、右侧预览 Sidebar 的顶部不再被桌面标题栏下压。
- 右上角窗口按钮保持当前功能：最小化、最大化/还原、关闭。
- 右上角新增下拉按钮；菜单包含“显示来源”和“设置”。
- “显示来源”展开后能看到当前来源状态，并能触发现有刷新与 remote/embedded 切换能力。
- 点击“设置”后，设置界面替换左侧 Chat 会话列表；主对话区保持当前 Chat 会话内容。
- Windows 桌面版不显示 Chat/File/Git activity 图标，默认可见 surface 为 Chat。
- 移动端布局与移动端设置入口行为不因本次改造改变。

### 测试

- 增加或更新桌面 shell 结构测试，覆盖标题栏移除、activity bar 移除、右上角控制簇存在。
- 增加或更新 WorkspaceApp 源结构测试，覆盖 Windows 桌面设置替换左侧 Chat 会话列表，而不是替换主对话区。
- 增加或更新 desktop title/menu 测试，覆盖下拉菜单、“显示来源”子面板、刷新与来源切换调用。
- 运行现有 Web UI 相关测试，至少覆盖 desktop shell、settings、chat UI 与 responsive shell 相关测试。

## 范围之外

- 不删除 File/Git 的底层功能、状态、组件或服务代码。
- 不改移动端 shell、移动端浮动控制和移动端设置历史行为。
- 不重新设计设置项内容，只复用现有设置内容与移动端视觉样式。
- 不改变 Windows 原生窗口 bridge 的 API 语义。
