> 摘要：本页维护 Preview 与 Terminal Workbench 的共享 Chrome、标题标签层级、平台操作、文件/Git 抽屉和移动端全屏约定。

# Workbench Chrome

> 来源：[`../../scope/2026-07-31-mobile-surface-navigation.md`](../../scope/2026-07-31-mobile-surface-navigation.md)、[`../../scope/2026-08-06-preview-drawer-toolbar.md`](../../scope/2026-08-06-preview-drawer-toolbar.md)、[`../../scope/2026-08-10-global-search-ux-iteration.md`](../../scope/2026-08-10-global-search-ux-iteration.md)

Preview 与 Terminal 是内容不同、Chrome 语言一致的 Workbench。两者共享“标题工具栏 + 标签栏”两层结构、尺寸层级、图标按钮样式和无障碍语义；文件树、搜索、xterm、Terminal 快捷键栏等能力仍由各自功能模块拥有。

## 两层结构

- 第一层标题工具栏由 leading action、当前内容标题和页面级 actions 组成。
- 第二层只承载可切换、可关闭的标签。标签关闭必须使用原生 button，不在 tab button 内嵌套模拟按钮。
- 移动端 leading action 是直接返回 Chat 的返回按钮；PC Terminal 使用收起桌面 Terminal 面板的关闭按钮。移动端 Floating Nav 与返回按钮并存，分别承担全局切换和一步返回。
- Preview 的搜索按钮属于 Preview chrome；Preview 获得焦点时，`Ctrl/Cmd+F` 直接打开当前 Preview 搜索，当前内容不支持文本搜索时回退到当前会话搜索。Preview 搜索 HUD 位于内容滚动层之上，但不覆盖工具栏、标签和 drawer 工具；搜索条保持自己的焦点、结果计数、上一项/下一项和关闭操作。

## Preview 标签行

- PC 端标签支持右键定点菜单：内容与标题工具栏的 actions 菜单一致（同一生成器按 tab 参数化），作用于被右键的标签、不切换激活标签；移动端不提供该菜单。
- 标签行溢出（`scrollWidth > clientWidth`）时右端出现"更多标签"按钮，双端一致；点击弹出全部打开标签的列表，激活行高亮、点行切换并收起、行右关闭按钮逐行关闭且列表保持打开；标签行本身保留横向滚动。
- 激活标签的背景与内容区表面衔接并带顶部 accent 指示；非激活标签弱化、hover 提亮；标签间使用短分割线而非全高边框；关闭按钮在非激活标签上 hover 显现（移动端常驻），激活标签常驻。
- 悬浮工具条与内容搜索条互不遮挡：PC 工具条在左则搜索条让出左侧，移动端工具条在右则让出右侧。

## Preview 文件/Git 抽屉

- 文件树与 Git 历史通过竖排 drawer 工具条进入：PC 端工具条悬浮在 Preview 内侧左缘，移动端位于右上角；双端共用同一套按钮样式，激活态与 drawer 内容对应。
- PC 端 drawer 在 Preview 左侧外部打开，覆盖 chat 列、不占用 Preview 空间，Preview resize 时跟随其左缘；移动端 drawer 仍在 Preview 内部左缘滑出。
- drawer 是临时层：点击树内文件不关闭 drawer；点击 drawer 外区域、Esc 或再点激活按钮关闭；点击另一工具按钮原地切换内容。
- 文件搜索框固定在 files drawer 面板顶部（含定位当前文件）；Git drawer 无搜索。
- files 与 Git drawer 的顶部工具栏共享同一套高度、间距、分隔线和控件层级：文件搜索与 Git 分支选择占据主控件区域，定位、刷新和 pin 使用同尺寸 ghost 图标按钮。
- pin 保持 Lucide 线性图标；开启态通过 accent 颜色与柔和背景表达，不把图标填充为实心轮廓。
- 打开 files drawer 时仅 PC 端自动聚焦文件搜索；移动端保持当前焦点，用户点击搜索框后再唤起输入法。
- 文件树（含搜索结果树）与 Git 面板共享一套行视觉：缩进参考线、目录/文件层级区分、hover/选中/当前预览文件高亮；Git 文件保持平铺结构，不做树形化。

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
