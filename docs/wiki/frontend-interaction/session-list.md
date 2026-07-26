> 摘要：本页维护 Project、Recent 与移动端 Session 列表的排序、菜单、pin 状态、层级呈现、动作可见性和生命周期交互约定。

# Session 列表交互

> 来源：[`../../scope/2026-07-22-pin-session/spec-pin-session.md`](../../scope/2026-07-22-pin-session/spec-pin-session.md)、[`../../scope/2026-07-24-session-list-visual-upgrade/spec-session-list-visual-upgrade.md`](../../scope/2026-07-24-session-list-visual-upgrade/spec-session-list-visual-upgrade.md)、[`../../scope/2026-07-26-mobile-floating-nav/spec-mobile-floating-nav.md`](../../scope/2026-07-26-mobile-floating-nav/spec-mobile-floating-nav.md)

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
- Recent 复用活跃 Session 行的状态与操作，但仍按自身候选选择和 project 分组规则排序；pin 不强制 Session 进入 Recent。
- 草稿 Session 尚无 Hub session identity，不参与 pin。
- 归档列表是独立的只读历史入口，不显示 pin 操作。

## 排序

Project 活跃 Session 列表先分为 pinned 与 unpinned 两组，pinned 组显示在前。两组内部都按 `updatedAt` 倒序，不记录 pin 时间，不提供手动拖拽或自定义顺序。

## 操作入口

- 桌面端 Session 通过右键菜单或行尾更多菜单执行 Pin/Unpin、Rename、Archive、Reload 和 Delete 等操作。
- 移动端 Project 与 Session 统一通过长按打开各自操作菜单，再选择 Pin/Unpin；长按本身不直接切换 pin。Project 长按 sheet 同时提供 "Resume session" 入口（选 agent → 可恢复会话列表 → import）。
- 运行中的 Session 仍可 pin/unpin；只有该 Session 的 pin 请求进行中才禁用重复提交。

## Pin 展示与取消

未 pin Session 的尾部时间区域显示相对更新时间。Pinned Session 在同一位置显示带可访问名称的 pin 按钮；点击只取消 pin，不选择或打开 Session。

Recent 中出现同一个 pinned Session 时显示相同 pin 状态和 Pin/Unpin 菜单，但 Recent 自身的选择与排序保持不变。

## 共享与生命周期

Pin 状态由 Hub 持久化，并由连接同一 Hub 的客户端共享。发起 pin/unpin 的客户端使用请求响应立即更新；其他客户端不接收实时 pin 事件，在刷新或重新进入 project 时同步。

Session reload 或 turn cursor reset 保留 pin。归档或删除 Session 会清除 pin；恢复归档 Session 后默认未 pin。请求失败时列表保留请求前状态并使用现有错误入口提示。
