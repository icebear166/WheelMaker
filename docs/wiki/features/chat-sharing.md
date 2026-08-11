> 摘要：本页维护聊天回答与完整会话的统一 Share 菜单、内容快照、文档渲染和跨平台交付边界。

# Chat sharing

WheelMaker 在每条可分享的完成回答旁保留独立 Copy，并用一个 Share
入口统一图片、HTML 文件和公开 URL。Desktop 使用锚定按钮的浮动菜单，
窄屏使用 bottom sheet；两个宿主都直接展示 **Current response** 与
**Full session** 两组动作，不增加二级菜单。

## Content snapshots

选择具体动作时，App 立即冻结来源内容、Session 标题、快照时间、主题和
Markdown/代码展示设置。后续完成的新回答、标题或主题变更不会修改已打开的
Public Share 弹窗所持有的快照。

- Current response 与既有 Copy 规则一致，只包含所点击终止 turn 对应的助手
  回答正文，不包含用户提问、thought、tool、plan 或完成状态。
- Full session 由已终止的用户/助手范围组成。流式尾部与控制面 turn 不进入
  分享稿；失败、取消或中断的范围保留已有输出并显示对应状态。
- `session/gap`、孤立 turn 和无法解析的范围静默跳过，其余范围仍按顺序输出。
- 已完整加载的 archived/read-only Session 继续提供相同的 Copy 与 Share 入口，
  并从该归档预览所持有的 raw turns 构建快照。
- 用户图片和文件附件只显示可得文件名；缺名时显示通用附件标签。分享稿不
  嵌入附件数据、缩略图、本地 URI、下载地址或文件正文。助手 Markdown 中的
  图片继续采用既有 HTML 导出解析与警告规则。

## Shared document rendering

图片、HTML 文件和公开 URL 消费同一个不可变聊天分享模型与 React 文档
renderer。完整会话文档显示 Session 标题、快照时间以及 User/Assistant 分段，
不包含 Workspace chrome；当前回答保持单篇 Markdown 文档版式。Markdown
sanitization、代码高亮、公式、Mermaid 与图片 readiness 复用现有导出能力。

PNG 始终是一个不截断、不拆页的文件。renderer 在捕获前选择 `1x..2x` 中
最高的安全 pixel ratio；位图任一边不得超过 16,384 px，总像素不得超过
16,000,000。即使 `1x` 仍超限时不调用图片捕获或平台交付，并提示改用 HTML
或公开 URL。

HTML 使用可编辑文件名确认并输出单个 standalone document。普通浏览器下载
PNG/HTML，Windows Desktop 将图片或 HTML 文件放入系统剪贴板，Android 调起
系统分享面板；原生 bridge 继续只处理单图片或单 HTML 文件。

## Public URL

公开 URL 动作先冻结回答或会话来源，再复用现有 Public Share 弹窗编辑标题、
选择有效期并确认创建。Share 服务关闭时弹窗仍展示配置状态，但创建禁用；
本地图片和 HTML 输出不依赖 Share 服务。聊天公开链接和项目文档链接共享管理
页、不可变 HTML、过期与停止规则。详细存储和匿名访问边界见
[`public-sharing.md`](public-sharing.md)。

来源设计与验收基线见
[`docs/scope/2026-08-11-chat-sharing.md`](../../scope/2026-08-11-chat-sharing.md)。
