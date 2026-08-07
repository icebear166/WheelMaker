> 由 scope skill 于 2026-07-30 生成

# Unified WheelMaker App Menu

## 目标

统一 EXE、APK 与浏览器/PWA 中 WheelMaker 图标的含义：点击图标始终打开应用级菜单，用户可从同一入口进入 Settings、快速切换整体明暗主题、打开 Release Publishing，并在原生客户端中查看当前版本和直接更新。当前 EXE 菜单与移动端直接进入 Settings 的行为不一致，Android APK 更新、整体主题切换与发布操作也仍占用 Settings；本改动将这些应用级动作收口到菜单，同时保留现有 Hub/Web 更新页和代码主题设置。

## 决策

- 所有端点击 WheelMaker 图标都打开锚定于图标的下拉菜单，不再有直接进入 Settings 的端差异。
- 主菜单项固定依次为 `Settings`、`Theme`、`Update`；`Update` 只在 APK/EXE 原生环境出现。
- 菜单使用等高单行、左侧图标与名称、右侧状态的统一结构，不为 Update 单独使用双行样式。
- `Settings` 点击后关闭菜单并进入 Settings 首页。
- `Theme` 点击后立即在应用整体 Light/Dark 间切换并沿用现有持久化；右侧显示当前主题，即当前为 Dark 时显示月亮图标与 `Dark`，当前为 Light 时显示太阳图标与 `Light`。
- `Update` 右侧在有新版时显示 `当前版本 → 最新版本` 并显示更新红点；最新版显示 `当前版本 · Current`。
- 每次菜单从关闭变为打开时检查客户端更新。检查中禁用 Update；最新版时保持禁用；检查失败时右侧显示 `Retry`，点击仅重新检查。
- 有新版时点击 Update 立即调用 APK 或 EXE 现有自动更新流程，不再跳转到 Settings 页面。
- 三个主项目之后使用分隔线；所有端都显示 `Release publishing`，点击后打开独立发布页面。
- EXE 的 `Dev Mode` 继续保留并位于 `Release publishing` 下方；不支持该能力时不显示。
- 浏览器/PWA 的主项目只显示 `Settings` 和 `Theme`，不显示禁用或指向 Hub/Web 更新页的 Update；分隔线后仍显示 `Release publishing`。
- 从 Settings 首页移除 Android APK 更新卡片和 `Appearance → Dark Mode`。Appearance 没有其他项目后整个分区消失。
- 从 `Settings → Debug` 移除 `Release publishing`，并从 Settings detail 导航类型中删除该项。
- Release Publishing 复用现有 Publishing source、Version release 与 Temporary Web 内容，但成为独立应用页面，不显示为 Settings 子页。Desktop 关闭或返回该页面后回到 Chat；移动端顶部返回键和系统返回键也回到 Chat。
- `Code Display → Code Theme` 保留；它控制代码块配色，不属于应用整体明暗主题。
- Settings 的 Update peer 页面及其中 Hub/Web、Agent package 更新能力保持不变。

## 架构

App/Web 提供一个共享的 WheelMaker App Menu 交互模型和菜单内容，桌面宽屏与移动布局复用相同的主项目、状态与键盘/关闭行为。App shell 独立持有 Release Publishing 页面的开关与返回行为；发布表单、持久化和 Registry 调用继续复用现有实现，不再经过 Settings detail 状态。平台探测选择更新适配器：

- Desktop 适配器通过现有 Desktop bridge 获取本地 EXE 信息、读取 stable Desktop 指针并调用现有脚本更新入口。
- Android 适配器通过现有 native RPC 获取安装包信息、读取 stable APK 指针并调用现有下载/校验/安装入口。
- Browser/PWA 不创建更新适配器，也不发起客户端更新检查。

Desktop 本地信息需要补充可展示的发布版本。正式发布构建把发布版本写入 EXE，并由 `getDesktopUpdateInfo` 返回；开发模式不展示 Update。若迁移期间旧 EXE 没有版本元数据，菜单明确显示 `Unknown → 最新版本`，仍允许更新，不能把最新版本误报为当前版本。

更新状态在菜单层归一为 `checking`、`current`、`available`、`failed`、`updating`，展示层不重复实现平台判断。Android 原生进度事件继续驱动下载与打开安装器状态；Desktop 继续由原生桥启动更新脚本并关闭当前窗口。

## 流程

1. 用户点击 WheelMaker 图标，菜单打开并聚焦首个菜单项。
2. 原生端同时开始一次无缓存更新检查：并行获取本地版本/摘要和公共 stable 指针，再以已验证摘要判断是否有新版。
3. 检查结果更新 Update 的右侧文字、禁用状态和红点；菜单关闭后完成的结果可以缓存，下一次打开仍会重新检查。
4. 用户点击可用更新后，菜单进入 `updating` 并禁止重复触发：
   - APK 下载并校验现有发布包，然后打开系统安装器。
   - EXE 启动现有更新脚本并退出 Desktop，让脚本完成替换；更新完成后仍由用户手动重新打开 Desktop。
5. 检查失败时保留菜单，Update 显示 `Retry`；重试不触发安装。
6. 用户点击 Release Publishing 后关闭菜单并进入独立发布页；返回操作关闭该页并回到 Chat。

## 验收标准

- EXE、APK、移动 Web 和桌面浏览器点击 WheelMaker 图标都打开菜单。
- 各端菜单前两项严格为 Settings、Theme；APK/EXE 第三项为 Update，浏览器/PWA 不出现 Update。
- 主项目后存在分隔线；所有端都在分隔线后显示 Release Publishing，支持时 Dev Mode 紧随其后。
- Theme 右侧文字和图标始终显示当前主题，点击后立即切换、持久化并更新当前状态。
- APK/EXE 每次打开菜单都重新检查 stable 发布状态。
- 有更新时 Update 显示本地到最新版本、红点且可点击；点击只触发一次对应平台更新。
- 最新版时 Update 显示当前版本与 Current 且不可点击。
- 检查中 Update 不可点击；检查失败后显示 Retry，点击可重新检查。
- 旧 Desktop 未提供版本元数据时显示 Unknown，不伪造当前版本，且仍可更新到最新版本。
- EXE 的 Dev Mode 位于分隔线后，其原有进入、面板和不可用时隐藏行为不变。
- Release Publishing 从所有端菜单打开独立页面；Desktop 页面返回 Chat，移动端顶部返回和系统返回均回到 Chat。
- Settings 首页不再包含 Android APK 更新卡片、应用 Dark Mode/Appearance 分区或 Release Publishing 入口；Settings detail 类型也不再包含 Release Publishing。
- Code Theme、Settings Update peer、Hub/Web 更新和 Agent package 更新行为不变。
- 菜单支持 Escape、点击外部关闭、上下方向键导航、焦点回到触发按钮；菜单项在窄屏不溢出。

### 测试

- App/Web 单元测试覆盖共享菜单项目顺序、平台可见性、Theme 当前状态与切换、Release Publishing 打开/返回、菜单开关触发检查，以及所有更新状态到文案/禁用/红点的映射。
- Desktop 测试覆盖发布版本注入和 bridge 返回值、摘要比较、旧 EXE 无版本回退、更新单次触发及现有 Dev Mode 行为。
- Android/Web 桥测试覆盖本地版本显示、stable 比较、安装单次触发、原生状态事件和检查失败重试。
- Settings 结构测试确认 APK 卡片、Dark Mode 和 Release Publishing 已移除，Code Theme 与现有 Update peer 仍存在。
- 运行相关 App Jest、Go Desktop 测试、发布构建脚本测试；不执行正式发布或真实客户端安装。

## 范围之外

- 不改变 stable 发布格式、发布服务器地址或 Registry protocol version。
- 不修改 Hub/Web 自更新或 Agent package 更新。
- 除删除 Release Publishing detail 外，不重构其他 Settings 导航模型。
- 不增加自动后台更新、定时检查或无用户点击的安装。
- 不重做 APK 下载校验、Android 安装权限流程、EXE 更新脚本或 Dev Mode 功能。
