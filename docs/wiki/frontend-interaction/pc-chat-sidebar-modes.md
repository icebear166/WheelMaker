> 摘要：本页维护 PC 端 Chat 的固定地址栏、复用的浮动/滑出/pin 会话面板，以及 Plan/Limits 悬浮列与 800px 对话列的布局规则。

# PC Chat 侧边栏模式

PC 端（宽屏 ≥900px）Chat 有浮动与 pin 两种会话面板模式。浮动态是默认值；pin 是跨重启的全局偏好，用户主动 pin/unpin 后恢复相应模式。移动端（<900px）不参与本页规则。

## 两条常驻标题栏

- **顶部地址栏**只保留设置按钮与 hubs 下拉，搜索/archive 不在其中。它在浮动与 pin 两态都常驻、与会话列表状态无关：作为浮动元素固定在 desktop shell 左上角（不占布局宽度），渲染在 shell 层（`desktopTopBar`），不属于浮动面板堆栈。
- **会话面板标题栏**由共享 `ChatSessionPanel` 提供，位于内容滚动区之外。浮动态显示 **Recent Sessions**；滑出态与 pin 态显示 **Sessions**。控制按钮复用同一套全局栏：浮动态提供展开和 pin，滑出态与 pin 态提供 pin、搜索和 archive。

## 浮动态滑出会话导航

- 默认左侧悬浮列按 `Recent Sessions → Plan → Limits` 排列。Recent 列表为空时仍保留 Recent Sessions 面板，保证完整会话导航始终有入口。
- 点「全部 session」滑出完整会话导航。滑出面板与 pin 态共用 `ChatSessionPanel` 框架、标题栏和滚动容器，宽度固定 360px，从左侧动画滑入/滑出，并覆盖整列 Recent/Plan/Limits 悬浮层。
- 滑出面板常挂载，保留 scrollTop；鼠标移出自动滑回，但搜索框聚焦、菜单打开、拖拽滚动条期间抑制滑回。

## pin 模式

pin 态把同构 Sessions 面板固定进左侧布局：标题栏置顶、完整会话导航在其下方的独立滚动区；recent 分组不显示分组头部。Recent 悬浮面板隐藏。Plan 与 Limits 从左侧悬浮列移动到固定 Sessions 面板右侧的聊天主区左缘，上下堆叠、绝对定位，不参与聊天内容布局。

## 800px 对话列连续对齐

800px 视图模式下，文字列使用现有的连续左 margin 公式。主窗口 W = 窗口宽 − preview 宽 − pin 侧边栏宽（浮动态为 0），R 为悬浮列预留宽（浮动列宽 + edge-gap）。文字列左 margin 随 W 连续分段变化、无跳变：

1. **居中段**：左 margin = (W − 800) / 2；
2. **左贴段**：居中会侵入 R 时，左 margin 保持 R，右 gutter 继续收缩；
3. **遮挡段**：右 gutter 收至最小值后，左 margin 侵入 R，文字列经 fade mask 遮挡悬浮列。

pin 态与浮动态共用同一公式。Plan/Limits 在 pin 态是聊天主区内的悬浮层；空间不足时覆盖并淡出对话左缘，而不额外占用对话布局宽度。
