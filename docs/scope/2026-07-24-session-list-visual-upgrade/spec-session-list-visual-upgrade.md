> 由 scope skill 于 2026-07-24 生成

# Session 列表视觉/交互升级

## 目标

当前 session 列表（含工具栏、Recent Sessions、项目分组、session 行、弹出菜单族）视觉上仍是 VS Code 工具感：codicons 图标字体、卡片套卡片的弱层级、动效零散且部分瞬切、行内动作全量常驻造成视觉噪音；移动端与 PC 端样式各自拼接，密度设置在移动端失效。上一轮优化只解决了"整齐"（桌面/移动结构统一、项目行 header 化），未触及视觉质感、动效体系、图标体系和交互收敛。

本轮目标：把 session 列表全链路升级为**精致深色工具风**（Linear/Raycast 一档的质感），移动端与 PC 端**视觉语言完全一致**，仅交互手段和密度按平台分化，操作更便捷（高频动作直达、低频动作收敛）。

## 决策

- **范围是什么？** → 全部 session 列表形态：移动端抽屉、PC 固定侧栏、PC 浮动 Recent 面板、PC Slide-out 面板、顶部工具栏，以及弹出菜单族（右键/长按上下文菜单、"+" agent 选择菜单、Resume 菜单）。
- **列表全量展示是痛点吗？** → 不是。信息架构不重组，session/项目仍全量展示；本轮是视觉与交互品质升级。
- **设计风格方向？** → 精致深色工具风（Linear/Raycast 参照）。底色（surface 色系）不动；边框、强调色、状态色、agent pill 配色等其余颜色重调，统一收敛进 tokens.css。
- **层级结构问题是什么？** → 层次不够而非盒子太重：项目行之间无法一眼区分，找不到目标项目。二级结构（一级：Recent/项目分组；二级：session 行）保留。
- **层级怎么强化？** → 项目分组行加强字重/字号对比 + hub 色色彩锚点（folder 图标或色条跟随已有 `--hub-accent`，不为单项目配色）；session 行弱化（缩进、次级色、更小字号）；**行高基本不涨，一屏 session 密度不降**；Recent 分区头与项目分区气质区分。
- **图标体系？** → 废弃 codicons，换 Lucide 风格细线性 SVG，按需引入（tree-shaking，无图标字体）；agent 不配图，文字 pill 重做精致样式；运行/完成/失败状态点保留但视觉收敛。
- **动效范围？** → 微交互全套：面板折叠/展开过渡、行 hover/按压/选中过渡、列表项首屏进入、弹层进**和退**场动画统一、呼吸点收敛；全部走统一时长/曲线 token，reduced-motion 兜底；不做布局级 FLIP 动效。
- **行内动作可见性？** → "+"（新建 session）两端常驻；其余动作 PC 端 hover/focus-within 淡入、移动端收进长按菜单（PC 右键菜单亦可）；pin 角标常驻且可直接点击 unpin。
- **菜单族怎么改？** → 视觉与结构都重做：允许重排、分组、每项配 Lucide 图标、agent pill 精致化；功能项不增删；进退场动画与全局面板统一。
- **工具栏形态？** → 移动端保持常驻工具栏；PC 端常态隐藏、可展开。
- **密度？** → PC relaxed / 移动端 compact，density token 两端接通（修复移动端 ChatSessionNav 不传 density 的失效问题）。
- **代码组织？** → 原地改造为主 + 部分迁移：抽 `chat/sessionlist/` 独立组件（SessionRow、ProjectCard、RowActions、Lucide 图标封装、菜单基础件等），并把 session 列表相关 render 逻辑闭环迁出 WorkspaceApp.tsx；不扩大战果、不重构 WorkspaceApp.tsx 其他部分。

## 架构

改造集中在 `app/web/src`：

- **新增 `chat/sessionlist/` 模块**：承接从 WorkspaceApp.tsx 迁出的 session 列表渲染闭环——SessionRow、ProjectCard（项目分组行 + 卡）、RecentSection、RowActions、SessionListMenu（菜单基础件）、Lucide 图标封装（`Icon` 组件 + 按需 SVG 注册表）。桌面/移动共用同一套组件与 class，仅用 `data-session-list-density` 区分密度。
- **WorkspaceApp.tsx**：只保留数据装配与回调注入，render 闭包替换为对上述组件的调用。
- **样式**：chat.css 中 session 列表相关段落重写，新颜色/动效统一走 tokens.css；Lucide 替换 codicon 涉及的所有引用点（含工具栏、菜单、面板头部）。

## 验收标准

- 移动端抽屉与 PC 三种面板中的 session 行、项目分组行、菜单视觉完全一致（同组件渲染），仅密度与动作可见性交互不同。
- 项目分组行可一眼区分：与 session 行有明确的强-弱对比，且带 hub 色锚点；列表行高与现状相比不显著增加（一屏 session 数量不减少）。
- "+" 两端常驻可见；其余行内动作 PC hover/focus-within 可见、移动端默认不可见（长按菜单可达）；pin 角标常驻且点击可 unpin。
- PC 工具栏常态隐藏、可展开；移动端工具栏常驻。
- session 列表范围内（列表、工具栏、菜单族、面板头部）不再引用 codicon，全部替换为 Lucide SVG；其余界面（设置、终端、Preview 等）的 codicon 替换与字体移除不在本轮。
- 面板折叠/展开、菜单进出场有过渡动画；reduced-motion 下动画降级为瞬切或淡入。
- 移动端 compact / PC relaxed 密度实际生效。
- 菜单族结构重排后功能项与现状一一对应，无增删。

### 测试

- 现有 session 列表相关测试（`ChatRecentSessionsSurface.test.tsx`、WorkspaceApp 相关渲染测试）随组件迁移更新断言，保持行为覆盖（排序、pin、长按/右键菜单、归档折叠、搜索）。
- 新增 `chat/sessionlist/` 组件的渲染测试：动作可见性策略（density/平台 data 属性输出）、pin 角标 unpin 回调、菜单项完整性。
- 不测：纯视觉样式（颜色、阴影、动效时长）的像素级断言；reduced-motion 行为只做 CSS 层验证。

## 范围之外

- 信息架构重组（渐进披露、折叠优先、时间流拍平均不做）。
- 底色/surface 色系变更、亮色主题重设计。
- 布局级 FLIP 动效、stagger 超过首屏的编排。
- agent 专属图标、单项目配色。
- 菜单功能项的新增/删除。
- WorkspaceApp.tsx 中 session 列表以外部分的重构。
- session 列表以外的界面（聊天区、设置页等）的视觉升级——但 tokens.css 的新增 token 设计需考虑后续可复用。
