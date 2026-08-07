# Preview 文件/Git 抽屉与工具条优化

> 由 scope skill 于 2026-08-06 生成

## 目标

Preview workbench 的文件/git 展开入口目前是两枚浮在内容区右上角的圆形 FAB，drawer 从 preview 内部左缘滑出、覆盖 preview 内容，文件搜索框浮在 FAB 旁。本次优化覆盖 PC 与移动端：把展开按钮重做为统一风格的悬浮竖排工具条；PC 端 drawer 改为在 preview 左侧**外部**打开（覆盖 chat 列、不占用 preview 空间的抽屉形态）；文件搜索框收进 files drawer 面板顶部；对文件树与 git 面板做一轮共享的行视觉精修。移动端 drawer 维持内部打开，仅统一按钮与面板视觉。

## 决策

- **Q：「点击文件时不会自动打开」指什么？** A：指 drawer 不自动**关闭**。点 drawer 内文件后文件在 preview 打开、drawer 保持打开；仅点击 drawer 外区域 / Esc / 再点当前激活的工具按钮才关闭。
- **Q：常驻工具条形态？** A：PC 端为 preview **内侧左缘**的悬浮竖排工具条，浮在 preview 内容之上、不占布局宽度；不做 docked rail，也不悬浮到 chat 侧。
- **Q：移动端按钮？** A：位置保持右上角浮动不变，按钮样式与 PC 统一为同一套新设计。
- **Q：文件搜索框位置？** A：收进 files drawer 面板顶部（含「定位当前文件」按钮）；git drawer 无搜索，直接显示内容。双端一致。
- **Q：git 目录树做到什么程度？** A：git 保持平铺结构，不做树形化；只做视觉精修。
- **Q：视觉精修范围？** A：全面一轮——文件树加缩进参考线、目录/文件行层级区分、行高间距微调、hover/选中/当前预览文件高亮统一；git 面板共享同一套行视觉（组标题、状态徽标、父目录文本弱化、+/- 统计排版）；双端一致。
- **PC drawer 形态**：从 preview 左缘向外（chat 方向）滑出，高度跟随 preview 面板，宽度约 360px，带投影，与工具条视觉连成一体；不挤压、不遮挡 preview 内容。

## 架构

- `PreviewWorkbenchChrome` 仍是工具条与 drawer 的宿主组件，持有外点关闭 / Esc 关闭逻辑，通过 `mode`（desktop/mobile）分流工具条位置与 drawer 定位。
- **外置 drawer 的渲染约束**：`.chat-preview-pane` 为 `overflow: hidden`，PC 外置 drawer 不能靠在 aside 内部负偏移实现，需在不被裁剪的层级渲染（外层容器或 portal），右缘对齐 preview 面板左缘；preview resize 时 drawer 跟随。具体挂载方案由 plan 决定。
- 搜索框从工具条区迁入 files drawer 面板顶部，搜索状态与「定位当前文件」逻辑不变，只换挂载点。
- 行视觉体系落在 `file.css` / `git.css`：文件树（`FileExplorerTree` 与搜索结果树）和 git 面板（`GitHistoryPanel` 行）共享一套行样式约定；不引入硬编码颜色，沿用主题变量。

## 流程

PC 打开 drawer：点击工具条按钮 → `drawerMode` 置为 files/git → drawer 从 preview 左缘外滑出（覆盖 chat 列）→ 点击树内文件打开 preview tab，drawer 保持 → 点击 drawer 外任意区域 / Esc / 再点激活按钮 → `drawerMode` 置 closed。点击另一工具按钮原地切换 drawer 内容。移动端流程与现状一致，仅视觉更新。

## 验收标准

- PC：工具条常驻 preview 内侧左缘，位置不随 drawer 开关移动，不占 preview 布局宽度；preview 左缘 resize 把手仍可正常拖拽。
- PC：drawer 在 preview 左侧外部打开，覆盖 chat 列且不遮挡 preview 内容；preview 尺寸不因 drawer 开关变化；preview resize 时 drawer 跟随其左缘。
- PC：drawer 打开时点击树内文件，文件在 preview 打开且 drawer 保持打开；点击 chat 区域或 preview 内容区域 drawer 关闭；Esc 关闭；点击当前激活工具按钮关闭；点击另一工具按钮原地切换内容。
- 移动端：按钮在右上角、drawer 内部打开，交互与现状一致；按钮样式与 PC 统一。
- files drawer 顶部显示搜索框与定位按钮，输入过滤树；搜索框为空时按 Esc 关闭 drawer（保持现状语义）；git drawer 无搜索框。
- 文件树：缩进参考线可见、目录/文件层级可辨、当前预览文件高亮、hover/选中态清晰；搜索结果树共享同一视觉。
- git 面板：组标题、状态徽标、父目录文本弱化、+/- 统计排版完成精修，行视觉与文件树一致；结构仍为平铺。
- preview 关闭时不出现工具条/drawer；git 不可用时不渲染 git 按钮（现状语义）；drawer 开关状态不做持久化。
- 移动端 port-relay 刷新 FAB、preview 内容搜索栏、actions 菜单行为不受影响。

### 测试

- 测：drawer 开关语义（外点关闭、Esc、按钮切换、点文件不关闭）与搜索框迁入后的键盘行为（清空/关闭），挂在 `PreviewWorkbenchChrome` 组件测试上；现有 git/preview 相关测试保持通过。
- 不测：纯视觉项（参考线、间距、颜色、投影）不做快照测试，靠人工验收。

## 范围之外

- git 文件列表树形化（目录聚合折叠）。
- Terminal workbench（无 drawer）。
- drawer 宽度自定义/拖拽、drawer 开关状态持久化。
- chat 会话侧栏与 Mobile Floating Nav 的改动。
- 文件树数据源、目录加载与 git 数据逻辑改动。
