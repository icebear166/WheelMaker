> 摘要：本页维护 Project、Recent 与移动端 Session 列表的排序、菜单、pin/mark 状态、层级呈现、动作可见性和生命周期交互约定。

# Session 列表交互

> 来源：[`../../scope/2026-07-22-pin-session.md`](../../scope/2026-07-22-pin-session.md)、[`../../scope/2026-07-24-session-list-visual-upgrade.md`](../../scope/2026-07-24-session-list-visual-upgrade.md)、[`../../scope/2026-07-26-mobile-floating-nav.md`](../../scope/2026-07-26-mobile-floating-nav.md)、[`../../scope/2026-07-26-session-color-mark.md`](../../scope/2026-07-26-session-color-mark.md)、[`../../scope/2026-08-12-unified-context-menu-gestures.md`](../../scope/2026-08-12-unified-context-menu-gestures.md)

本页用于持续记录 Session 列表层面的稳定交互。对话内容、Turn 展示和侧边栏容器布局分别由其他前端交互页面维护；图标、动效和配色等视觉语言约定见 [`visual-language.md`](visual-language.md)。

## 层级呈现

- 列表保留二级结构：一级是 Recent 分区与 Project 分组，二级是具体 session 行；不做信息架构重组，项目与 session 保持全量展示。
- 一级分组行强、二级 session 行弱：分组行靠字重/字号对比和 hub 色色彩锚点（跟随 `--hub-accent`，不为单项目配色）强化辨识度；session 行缩进并使用次级色。
- 层级强化不得显著增加行高，一屏 session 数量不减少。
- 密度两端统一 relaxed：移动端曾用 compact，因行高过低不利于触控已取消，density token 两端同档生效。

## 行内动作可见性

- 「+」（新建 session）在 PC 与移动端都常驻可见，保证快速直达。
- 项目/会话行的其余动作：PC 端 hover 或 focus-within 行时淡入；移动端收进长按菜单（PC 也可经右键菜单到达）。
- pin 角标常驻显示，点击直接 unpin（见「Pin 展示与取消」）。

## 菜单族

- 右键/长按上下文菜单、「+」agent 选择菜单、Resume 菜单共享同一套视觉与结构语言（分组、每项配图标、统一进退场动画）；菜单结构允许随视觉升级重排，但功能项不增删。

## 列表表面

- Project 活跃 Session 列表是完整列表，负责 project 内的 pin 置顶排序。
- Recent 复用活跃 Session 行的 pin、mark 状态与操作，但仍按自身候选选择和 project 分组规则排序；pin 或 mark 都不强制 Session 进入 Recent。
- 草稿 Session 尚无 Hub session identity，不参与 pin 或 mark。
- 归档列表是独立的只读历史入口，不显示 pin 或 mark 操作。

## 排序

Project 活跃 Session 列表先分为 pinned 与 unpinned 两组，pinned 组显示在前。两组内部都按 `updatedAt` 倒序，不记录 pin 时间，不提供手动拖拽或自定义顺序。

## 操作入口

- 普通项目 Session 与 Recent Session 通过鼠标右键或 touch/pen 长按打开同一 Session 菜单；搜索结果保持跳转入口，Archived 保持恢复入口，Draft 不提供该菜单。
- Project 标题通过右键或长按打开 Project Actions，其中仅包含 Resume session 和 Pin/Unpin；New Session 继续由常驻 `+` 承担。
- Session/Project 的延迟、移动取消、haptic、嵌套按钮和浏览器默认行为遵循 [`context-menu-gestures.md`](context-menu-gestures.md)。长按本身不直接切换 pin。
- 运行中的 Session 仍可 pin/unpin；只有该 Session 的 pin 请求进行中才禁用重复提交。

## Pin 展示与取消

未 pin Session 的尾部时间区域显示相对更新时间。Pinned Session 在同一位置显示带可访问名称的 pin 按钮；点击只取消 pin，不选择或打开 Session。

Recent 中出现同一个 pinned Session 时显示相同 pin 状态和 Pin/Unpin 菜单，但 Recent 自身的选择与排序保持不变。

## Mark 展示与操作

Mark 是独立于 Pin 的单色视觉标记，不具备置顶、排序、筛选或分组语义。任意活跃 Session（包括未 pin 和运行中的 Session）最多设置一个 Mark，固定颜色为红、黄、绿、蓝。

Session 操作菜单在 Pin/Unpin 下方显示 Mark 色板：四个颜色选项是等尺寸圆形色块，清除选项使用同尺寸圆形按钮和禁止图标。色板按钮带可访问名称与选中状态；选择或清除后关闭菜单。行内颜色只负责展示，不提供直接操作入口。

有 Mark 时，Session 行最右侧覆盖绘制一条细圆角竖标；已 pin 行中竖标位于 pin 图标右侧，未 pin 行中位于相同的外侧边缘。竖标不参与 flex 布局，不减少标题、agent、时间或 pin 控件的可用宽度。项目列表和 Recent 显示并修改同一 Mark。

## 共享与生命周期

Pin 状态由 Hub 持久化，并由连接同一 Hub 的客户端共享。发起 pin/unpin 的客户端使用请求响应立即更新；其他客户端不接收实时 pin 事件，在刷新或重新进入 project 时同步。

Session reload 或 turn cursor reset 保留 pin。归档或删除 Session 会清除 pin；恢复归档 Session 后默认未 pin。请求失败时列表保留请求前状态并使用现有错误入口提示。

Mark 使用相同的 Hub 持久化与同步边界，但其状态与 Pin 相互独立。Session reload、turn cursor reset 和 recorder 重建保留 Mark；归档或删除清除 Mark，恢复后默认无 Mark。Mark 请求失败时不改变本地颜色。
