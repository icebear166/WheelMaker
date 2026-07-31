> 由 scope skill 于 2026-07-31 生成

# 移动端全局 Surface 导航与 Workbench Chrome 统一

## 目标

移动端 Floating Nav 当前只在 Chat 主界面可用，并会被 Preview、Terminal 等全屏 Surface 的层级或显式样式隐藏；用户进入这些 Surface 后无法继续使用同一套快捷导航。与此同时，Preview 与 Terminal 的 Chrome 结构和视觉层级不一致：Preview 使用“标题工具栏 + 标签栏”，Terminal 则把返回、标签和操作混在单行。本轮将 Floating Nav 提升为移动端应用级 Surface Switcher，并统一 Preview、Terminal 的 Workbench Chrome；PC 端不引入 Floating Nav，但同步采用统一后的 Terminal Chrome。

## 决策

- **Q：Floating Nav 在哪些界面显示？** A：在移动端 Chat、Preview、Terminal、Relay、Monitor、Settings 六个主 Surface 中常驻；确认弹窗、菜单、底部 Sheet 等临时模态层可覆盖或暂时隐藏它。PC 端不显示 Floating Nav。
- **Q：收起与展开形态？** A：收起时显示当前 Surface 图标；点击后展开固定顺序、固定位置的纯图标窄栏。展开顺序沿用 `Preview → Terminal → Relay → Monitor → Settings → Chat`，只高亮当前 Surface，不随当前界面重排，也不增加文字标签。
- **Q：点击当前 Surface 项的语义？** A：点击收起按钮用于展开菜单；菜单已展开时点击当前 Surface 项只收起菜单，不执行返回。返回 Chat 通过选择 Chat 项完成。
- **Q：Chat 的 Session 抽屉耦合是否保留？** A：仅在 Chat 保留。Chat 中点击收起按钮同时展开导航菜单并打开 Session 抽屉；其他 Surface 中点击只展开导航菜单。切离 Chat 时关闭 Session 抽屉。
- **Q：位置是否跨 Surface 共享？** A：共享同一个停靠侧、垂直位置、拖拽状态和持久化值。它是应用级控件，不为每个 Surface 单独记忆位置。
- **Q：切换 Surface 是否保留现场？** A：保留 Preview 标签、当前 Terminal、滚动位置、Workbench 全屏状态等工作现场；切换时只关闭临时菜单、Sheet 和弹层。
- **Q：Preview 数量如何显示？** A：Preview 标签数量继续显示在 Floating Nav 的 Preview 项；收起状态恰好位于 Preview 时也显示数量。没有标签时不显示徽标。
- **Q：Terminal Chrome 的统一范围？** A：PC 与移动端一起改为和 Preview 一致的两层结构：第一层标题工具栏，第二层标签栏。移动端返回按钮直接返回 Chat；PC 端关闭按钮收起 Terminal 面板。
- **Q：Terminal 标题与标签显示什么？** A：标题显示当前 Terminal 的项目名，项目名缺失时显示 Terminal ID，无 Terminal 时显示 `Terminal`；完整 Hub、初始路径放入 tooltip。标签仅显示状态点、名称和真实 button 关闭控件，不再常驻显示 Hub 文本。
- **Q：Terminal 操作如何分层？** A：新建与 `Fit to screen` 在标题工具栏常驻；`Restart` 在当前 Terminal 非 running 时放入更多菜单。标签关闭继续属于对应标签。
- **Q：移动端返回按钮是否保留？** A：Preview、Terminal 的标题工具栏均保留返回按钮，并直接返回 Chat；Floating Nav 同时提供跨 Surface 导航，两者并存。
- **Q：移动端 Workbench 全屏如何工作？** A：Preview、Terminal 均在右下角显示同款浮动全屏按钮。该全屏是 Workbench 内部 Chrome 模式，不调用浏览器 Fullscreen API；开启后隐藏标题工具栏与标签栏，关闭后恢复。Terminal 底部快捷键栏始终保留，Floating Nav 在全屏状态下仍可见可用。
- **Q：全屏按钮与 Floating Nav 如何避让？** A：Preview 的按钮沿用右下角位置；Terminal 的按钮位于底部快捷键栏上方。Floating Nav 的停靠边界与拖拽落点必须避开当前 Surface 的全屏按钮占用区域。

## 架构

- **应用级 Surface 导航层**：`ResponsiveShell` 提供独立的移动端应用控制层，承载 `MobileFloatingNav`。该层高于六个主 Surface，低于确认弹窗、菜单、Sheet 等临时模态层；删除 Preview 对 Floating Nav 的显式隐藏，并避免仅靠继续抬高零散 z-index 修补。
- **Surface 协调器**：`WorkspaceApp` 继续拥有 Surface 打开状态和切换回调，统一保证一次只呈现一个主 Surface、切换时关闭临时 UI，并把 Preview、Terminal 的选中项、滚动位置和全屏状态保留在跨 Surface 生命周期的状态所有者中。
- **Floating Nav 模型与视图**：`mobileFloatingNavModel.ts` 维护固定目的地、当前 Surface 解析和几何常量；`MobileFloatingNav.tsx` 只负责收起/展开呈现、active 状态、Preview 数量与选择回调。Chat 专属的 Session 抽屉联动留在协调器，不进入通用视图组件。
- **共享 Workbench Chrome**：从 Preview、Terminal 的重复结构中抽出共享 Chrome primitive，负责标题工具栏、标签栏、平台化 leading action、工具栏 actions、移动端全屏状态和可访问语义。`PreviewWorkbenchChrome` 保留文件树、搜索、Preview actions 与内容；`TerminalWorkbench` 保留 Terminal 数据、xterm 内容和移动端快捷键栏。
- **避让几何**：Floating Nav bounds 计算接收当前主 Surface 的保留区域。右侧停靠时避开全屏按钮矩形，左侧停靠不引入无关空隙；安全区、键盘偏移、展开菜单高度和既有拖拽 hysteresis 继续生效。

## 流程

1. 应用根据 Relay、Settings、Monitor、Terminal、Preview、Chat 的既有优先级解析当前移动端 Surface，并把对应图标交给收起状态的 Floating Nav。
2. 用户在 Chat 点击收起按钮：展开固定菜单并打开 Session 抽屉；用户在其他 Surface 点击：只展开固定菜单。
3. 用户选择非当前目的地：先关闭导航菜单和临时 UI，再切换唯一可见的主 Surface；原 Surface 的工作状态保留。选择 Chat 时关闭上层 Surface 并返回聊天。
4. 用户选择当前目的地：只收起导航菜单；若当前为 Chat，同时关闭由该次导航展开联动的 Session 抽屉。
5. 用户长按拖拽 Floating Nav：沿既有手势状态机调整侧边和高度；结束时按安全区、键盘、菜单展开高度与全屏按钮保留区域 clamp，并持久化全局位置。
6. 用户点击 Preview 或 Terminal 的全屏按钮：切换该 Workbench 的受控全屏状态；隐藏或恢复两层 Chrome。Terminal 内容区随之获得或释放高度，底部快捷键栏不变。
7. 用户点击移动端 Workbench 返回按钮：直接返回 Chat；PC Terminal 的关闭按钮只收起桌面底部 Terminal 面板。

## 验收标准

- 移动端六个主 Surface 均能看到并操作同一个 Floating Nav；临时模态层的层级高于它。
- Floating Nav 收起时显示当前 Surface，展开时六个图标顺序固定且当前项高亮；切换 Surface 不改变菜单排列。
- Chat 中展开 Floating Nav 继续联动 Session 抽屉；Preview、Terminal、Relay、Monitor、Settings 中不打开 Session 抽屉。
- 选择 Chat 能从任一主 Surface 返回；选择其他入口能直接切换，并保留离开 Surface 的标签、选中项、滚动位置和全屏状态。
- Floating Nav 在所有 Surface 共享位置，拖拽、换边、键盘避让、安全区约束与位置持久化保持有效。
- Preview 标签数量显示在 Preview 导航项；零标签无徽标，收起状态为 Preview 时数量仍可见。
- Preview 与 Terminal 使用一致的两层 Workbench Chrome 结构、尺寸层级、图标按钮语言和可访问语义。
- Terminal 标题、紧凑标签、tooltip、新建、Fit、Restart、标签关闭均符合已确认的层级；无 Terminal 时仍可直接新建。
- 移动端 Preview、Terminal 返回按钮均可直接返回 Chat；PC Terminal 关闭按钮可收起桌面面板。
- 移动端 Preview、Terminal 的全屏按钮均可实际隐藏和恢复两层 Chrome；Terminal 全屏时底部快捷键栏不消失。
- Workbench 全屏期间 Floating Nav 仍可操作；Floating Nav 在左右停靠、收起、展开和拖拽结束后均不遮挡全屏按钮。
- PC Terminal 完成 Chrome 统一后，面板 resize、Terminal 选择、输入、关闭、新建、Fit、Restart 行为无回归；PC 端不出现 Floating Nav。
- 所有图标按钮具备准确的 `aria-label`、pressed/selected/expanded 状态；标签关闭使用原生 button，不使用嵌套的模拟按钮。

### 测试

- 测 `mobileFloatingNavModel.ts` 的当前 Surface 解析、固定顺序和避让 bounds；测 `MobileFloatingNav` 的收起图标、固定展开项、active 状态、Preview 数量与选择回调。
- 测 `WorkspaceApp`/移动端壳层的六 Surface 常驻 wiring、Chat 专属抽屉联动、非 Chat 不联动、Surface 互斥切换和状态保持。
- 测共享 Workbench Chrome 在 desktop/mobile、normal/full-screen 下的标题栏、标签栏、leading action、工具栏 actions 和无障碍属性。
- 测 Terminal 的标题 fallback、紧凑标签、真实关闭按钮、新建、Fit、条件 Restart 菜单，以及移动端全屏时快捷键栏继续存在。
- 回归测 Preview tabs、文件树、搜索、actions、全屏与返回；回归测 Terminal xterm 挂载、resize claim、输入和桌面面板 resize。
- 手动验证左右停靠、上下极限位置、软键盘弹出、Preview/Terminal 全屏、全屏按钮避让及窄屏标题截断；不以快照测试判断材质观感。

## 范围之外

- PC 端 Floating Nav 或 PC 主 Surface 导航重构。
- 改变六个 Floating Nav 目的地、固定顺序、纯图标形态或增加文字标签。
- 重做 Chat Session 抽屉本身、移动端返回栈或系统 Back 键策略。
- 改变 Preview 文件加载、HTML Preview、Relay、Monitor、Settings 的业务数据流。
- 改变 Terminal Registry 协议、xterm 输入/输出协议、resize ownership 或底部快捷键集合。
- 调用浏览器或原生系统 Fullscreen API；本轮全屏仅控制 Workbench Chrome。
- 修改 protocol version。
