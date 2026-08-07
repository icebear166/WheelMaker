> 由 scope skill 于 2026-07-30 生成

# Hub Menu Unified Layout

## 目标

重构 Hub 菜单的视觉呈现，使 PC 浮层与移动端全屏页共享同一套内部结构、尺寸和原地展开样式。当前界面混用了桌面紧凑行、移动端放大行、树形引导线、厚重分段框和松散明细列表，导致按钮不对齐、图标语义不一致、展开内容过长且层级混乱。本次只调整前端呈现和 MCP 占位入口，不改变现有 NPM、Skills、Project visibility、Project index、Hub 更新等业务行为或数据范围。

## 决策

- PC 保持浮层，移动端保持全屏容器；两端内部使用同一个 Hub 内容结构和同一组高度。
- 移动端页头只保留返回按钮。Skills 子内容返回 Hub 菜单，Hub 菜单返回原页面；Android 返回手势遵循相同层级。
- 每个 Hub 呈现为一个完整视觉分组：Hub 标题、Settings、Global、Projects 和展开明细属于同一表面。
- 移除 Hub 内容左侧的彩色长竖线。Hub 自定义色只保留为 Hub 名称旁的身份圆点。
- Hub、Settings、Global、Projects 主行以及行内功能按钮统一为 `40px` 高；PC 与移动端不再设置不同高度。
- 展开面板工具栏统一为 `36px` 高；NPM、Skills、visibility 和 index 明细行统一为单行 `32px` 高。
- Global 操作顺序固定为 NPM、MCP、Skills；Projects 操作顺序固定为 Visibility、Scan、Skills。Skills 始终位于最后。
- Global 与 Projects 都使用三列、等宽、相同结构的“图标 + 数量”按钮，不在按钮内显示名称或展开箭头。按钮通过 `title`、`aria-label` 和展开态背景传达语义。
- 图标统一为：
  - NPM：Lucide `package`
  - MCP：`octicon:mcp-24` 的 MCP 专用链结标志，归一到项目 `Icon` 组件的 `18px`、`currentColor` 视觉规格
  - Skills：复用当前页面已有的 `sparkles`
  - Visibility：Lucide `eye`
  - Scan：Lucide `scan-line`
- 数量始终占用固定位置并使用 tabular numerals。零值也显示，避免按钮内容跳动；现有各指标的计数语义保持不变。
- MCP 显示数量 `0`，可点击并在当前 Hub 内原地展开 `MCP servers` 空面板。空面板显示 `No MCP servers configured.`，不调用服务端、不提供伪造的新增或配置行为。
- 所有功能保持原地展开，PC 和移动端不新增子页面、抽屉或底部 sheet；现有展开/收起与互斥规则保持不变。
- 展开内容使用一块横跨 Hub 内容宽度的内嵌明细面板，包含紧凑工具栏、行列表以及就近错误/空状态。
- 明细统一为单行布局：名称靠左，状态或版本在名称之后，操作槽固定在最右。长名称截断，并通过 `title` 和可访问名称提供完整内容。
- NPM 版本显示规则：
  - 已安装且无更新：只显示当前版本。
  - 可更新：显示 `current → target`。
  - 未安装：显示 `Not installed · target`。
- NPM 行操作使用两个固定槽位。已安装且无更新只显示卸载；可更新显示更新和卸载；未安装只显示安装。不可执行图标不渲染，但保留空槽以维持对齐。
- Skills 和 Project index 行沿用同一套 32px 行、固定操作槽和隐藏不可用操作的规则，不把禁用图标作为装饰显示。
- Global 与 Projects 的三列操作区使用轻量分隔，不再呈现为高而厚的圆角输入框。图标尺寸、数字行盒和列起止位置必须一致。
- Hub 版本按钮默认透明，仅在 hover、focus 或 active 状态出现局部反馈。
- `Latest / Update all hubs` 位于全部 Hub 内容结束之后，参与正常文档流，不 sticky、不固定，也不插入展开内容与后续 Hub 之间。
- 视觉继续使用现有主题 token、IBM Plex Sans 和 JetBrains Mono；不新增渐变、发光、装饰性动画或新的颜色体系。

## 架构

`ChatHubMenu` 继续拥有一个共享的 Hub 内容树，PC 与移动端只由外层 host 决定浮层或全屏容器。`ChatHubBlock` 负责 Hub 视觉分组、三类主行和原地明细；Global 与 Projects 共用同一种三列 action cell。现有 NPM、Skills、visibility 和 index 明细组件保留业务回调，只统一工具栏、单行条目与操作槽样式。MCP 作为纯前端占位 detail 类型加入现有展开状态，不连接 Registry、Hub API 或协议层。

## 流程

1. 用户展开一个 Hub。
2. 用户点击 Settings，或点击 Global / Projects 中任一三列 action cell。
3. 现有功能按当前互斥规则在同一 Hub 内展开；MCP 展示本地空面板。
4. 展开区在 Hub 视觉分组内渲染紧凑工具栏和 32px 单行明细。
5. 用户执行更新、安装、卸载、扫描或查看详情时，继续调用现有回调；不可执行操作不显示图标。
6. 用户收起 action 或 Hub 后，页面恢复紧凑主行；Footer 始终跟随全部 Hub 内容。

## 验收标准

- PC 与移动端的 Hub、Settings、Global、Projects 和 action cell 高度一致，均为 40px。
- PC 与移动端的展开工具栏均为 36px，所有 NPM、Skills、visibility 和 index 明细行均为单行 32px。
- Global 精确按 NPM、MCP、Skills 排列；Projects 精确按 Visibility、Scan、Skills 排列。
- 两组 action cell 的外边缘、三列宽度、图标框和数字基线对齐。
- Global Skills 与 Project Skills 使用同一个 `sparkles` 图标。
- MCP 使用专用 MCP 图标、显示 `0`，点击后原地显示空面板，且不发起网络或 Registry 请求。
- Hub 内容不再显示彩色长竖线，Hub 自定义色仍通过名称旁圆点显示。
- 展开任何功能不会改变其触发行高度，也不会打开子页面、sheet 或抽屉。
- NPM 当前版本与目标版本相同时不重复显示；只有确有更新时显示版本箭头。
- 不可执行的 NPM、Skills 和 index 操作图标不可见，但其他行的操作列仍保持对齐。
- 长名称不会换行或改变行高，可通过 title/可访问名称读取完整内容。
- Footer 不使用 sticky 或 fixed 定位，并只出现在全部 Hub 内容之后。
- 移动端 Hub 页头只有返回按钮；系统返回手势与页面返回按钮具有相同层级行为。
- 现有 Hub 更新、NPM、Skills、Project visibility 和 Project index 数据范围与回调语义不变。

### 测试

- 扩展 `ChatHubMenu.test.tsx`：
  - 断言 Global / Projects 的顺序、图标、数量与无文本/无箭头结构。
  - 断言 MCP `0` 可展开本地空面板，且不触发现有业务回调。
  - 断言移动端只有返回按钮，并保持 Skills 子内容返回层级。
  - 覆盖 NPM 三种状态的版本文本和可见操作组合。
- 扩展 CSS/集成测试：
  - 锁定共享 40px 主行、36px 工具栏、32px 明细行。
  - 断言移动端媒体查询不再覆盖 Hub 内部高度。
  - 断言无 Hub 彩色长竖线、无 sticky Footer、无厚重 action 外框。
  - 断言隐藏操作保留固定槽位，名称使用单行截断。
- 运行 Hub 菜单聚焦测试、完整 Jest、`npm run tsc:web` 和 `npm run build:web`。
- 手动检查 PC 深色/浅色浮层与移动端深色/浅色全屏页，覆盖折叠、单项展开、长名称、空 MCP、零计数和长列表。

## 范围之外

- MCP 服务端接口、Registry 方法、配置、安装、连接测试或协议版本变更。
- 改变 NPM、Skills、Project visibility、Project index 或 Hub 更新的业务范围。
- 将移动端展开内容改成子页面、底部 sheet 或独立路由。
- 重构 Skills 详情卡片、确认弹窗或其他 Settings 页面。
- 新增动效、渐变、品牌配色或新的字体依赖。
