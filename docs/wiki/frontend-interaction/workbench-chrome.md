> 摘要：本页维护 Preview 与 Terminal Workbench 的共享 Chrome、标题标签层级、平台操作和移动端全屏约定。

# Workbench Chrome

> 来源：[`../../scope/2026-07-31-mobile-surface-navigation/spec-mobile-surface-navigation.md`](../../scope/2026-07-31-mobile-surface-navigation/spec-mobile-surface-navigation.md)

Preview 与 Terminal 是内容不同、Chrome 语言一致的 Workbench。两者共享“标题工具栏 + 标签栏”两层结构、尺寸层级、图标按钮样式和无障碍语义；文件树、搜索、xterm、Terminal 快捷键栏等能力仍由各自功能模块拥有。

## 两层结构

- 第一层标题工具栏由 leading action、当前内容标题和页面级 actions 组成。
- 第二层只承载可切换、可关闭的标签。标签关闭必须使用原生 button，不在 tab button 内嵌套模拟按钮。
- 移动端 leading action 是直接返回 Chat 的返回按钮；PC Terminal 使用收起桌面 Terminal 面板的关闭按钮。移动端 Floating Nav 与返回按钮并存，分别承担全局切换和一步返回。

## Terminal 呈现

- 标题优先显示当前 Terminal 的项目名，缺失时显示 Terminal ID；没有 Terminal 时显示 `Terminal`。完整 Hub 和初始路径放入 tooltip。
- 标签保持紧凑，只显示状态点、名称和关闭按钮，不常驻显示 Hub 文本。
- 新建与 `Fit to screen` 是标题工具栏常驻操作；当前 Terminal 非 running 时，`Restart` 放入更多菜单。无 Terminal 时仍可直接新建。
- PC 与移动端共享上述 Chrome 组织；xterm 输入输出、resize ownership、桌面面板 resize 和移动端快捷键栏不因 Chrome 统一改变。

## 移动端 Workbench 全屏

- Preview、Terminal 都在右下角提供同款浮动全屏按钮。这里的全屏只隐藏或恢复 Workbench 的标题工具栏与标签栏，不调用浏览器或原生 Fullscreen API。
- Terminal 全屏时底部快捷键栏继续显示；Floating Nav 在 Preview、Terminal 全屏时继续可见、可操作。
- Preview 的全屏按钮位于安全区上方；Terminal 的按钮还需位于底部快捷键栏上方。该按钮区域同时作为右侧 Floating Nav 的避让区域。
- 全屏状态属于 Workbench 工作现场，切换到其他 Surface 后再返回时应恢复，不因主 Surface 暂时不可见而重置。

## 状态与可访问性

- 切换主 Surface 时保留当前标签、选中项、滚动位置和全屏状态，只关闭临时菜单、Sheet 与弹层。
- 图标按钮必须有准确的 `aria-label`；切换型控件同步表达 pressed/selected/expanded 状态；标题和标签在窄屏下截断，完整上下文由 tooltip 提供。
