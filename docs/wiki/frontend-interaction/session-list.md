> 摘要：本页维护 Project、Recent 与移动端 Session 列表的排序、菜单、pin 状态和生命周期交互约定。

# Session 列表交互

> 来源：[`../../scope/2026-07-22-pin-session/spec-pin-session.md`](../../scope/2026-07-22-pin-session/spec-pin-session.md)

本页用于持续记录 Session 列表层面的稳定交互。对话内容、Turn 展示和侧边栏容器布局分别由其他前端交互页面维护。

## 列表表面

- Project 活跃 Session 列表是完整列表，负责 project 内的 pin 置顶排序。
- Recent 复用活跃 Session 行的状态与操作，但仍按自身候选选择和 project 分组规则排序；pin 不强制 Session 进入 Recent。
- 草稿 Session 尚无 Hub session identity，不参与 pin。
- 归档列表是独立的只读历史入口，不显示 pin 操作。

## 排序

Project 活跃 Session 列表先分为 pinned 与 unpinned 两组，pinned 组显示在前。两组内部都按 `updatedAt` 倒序，不记录 pin 时间，不提供手动拖拽或自定义顺序。

## 操作入口

- 桌面端 Session 通过右键菜单或行尾更多菜单执行 Pin/Unpin、Rename、Archive、Reload 和 Delete 等操作。
- 移动端 Project 与 Session 统一通过长按打开各自操作菜单，再选择 Pin/Unpin；长按本身不直接切换 pin。
- 运行中的 Session 仍可 pin/unpin；只有该 Session 的 pin 请求进行中才禁用重复提交。

## Pin 展示与取消

未 pin Session 的尾部时间区域显示相对更新时间。Pinned Session 在同一位置显示带可访问名称的 pin 按钮；点击只取消 pin，不选择或打开 Session。

Recent 中出现同一个 pinned Session 时显示相同 pin 状态和 Pin/Unpin 菜单，但 Recent 自身的选择与排序保持不变。

## 共享与生命周期

Pin 状态由 Hub 持久化，并由连接同一 Hub 的客户端共享。发起 pin/unpin 的客户端使用请求响应立即更新；其他客户端不接收实时 pin 事件，在刷新或重新进入 project 时同步。

Session reload 或 turn cursor reset 保留 pin。归档或删除 Session 会清除 pin；恢复归档 Session 后默认未 pin。请求失败时列表保留请求前状态并使用现有错误入口提示。
