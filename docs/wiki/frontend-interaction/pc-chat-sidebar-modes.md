> 摘要：本页维护 PC 端 Chat 的固定地址栏、复用的浮动/滑出/pin 会话面板，以及 Plan/Limits 悬浮列与 800px 对话列的布局规则。

# PC Chat 侧边栏模式

PC 端（宽屏 ≥900px）Chat 有浮动与 pin 两种会话面板模式。浮动态是默认值；pin 是跨重启的全局偏好，用户主动 pin/unpin 后恢复相应模式。移动端（<900px）不参与本页规则。

## 固定顶栏与会话面板标题栏

- **顶部地址栏**保留设置按钮、当前 Project 下拉与 hubs 下拉，搜索/archive 和会话栏展开按钮不在其中。PC 左段固定 360px，与浮动/滑出/固定会话面板共用 `--chat-session-panel-width`，内部按「设置 → 8px 间距 → Project → 弹性空白 → Hubs」排列；Hubs 右边缘与下方 Sessions 卡片右边缘对齐。中部只保留 prompt 历史入口与标题，并独占可伸缩空间，终端/预览操作固定在右侧。桌面 Shell 在 Session 与 Chat 内容上方只渲染一个顶栏实例；浮动、滑出和 pin 只替换其下方的会话面板，不移动、卸载或重新挂载顶栏。地址栏不读取 session 搜索展开状态：搜索只改变 Sessions 面板标题栏和列表内容。右侧 Preview 是顶栏所属主工作区的同级区域，继续使用自己的标题栏。移动端继续使用原有 Project 与 session 标题组合。
- **浮动卡片标题栏**统一由 `ChatEdgeSurfaceHeader` 提供，Sessions、Plan、Limits 都使用 36px 高度、左侧折叠按钮、11px uppercase 标题和右侧操作区。展开态使用向下 chevron，收起态使用向右 chevron；收起只隐藏正文。Plan 可以在收起标题栏中保留一行截断的当前步骤和进度。
- **Sessions 布局操作**固定在标题栏右侧，顺序是完整会话栏、Pin；完整会话栏使用 `layout-sidebar-left`，打开后切换为 `layout-sidebar-left-off`。滑出态把 archive 与 search 放在标题后的左侧操作区，关闭完整栏与 Pin 保持右侧位置；pin 态只保留右侧高亮 Pin。浮动、滑出与 pin 态统一显示 **Sessions**。

## 浮动态滑出会话导航

- 默认左侧悬浮列按 `Sessions（Recent 内容）→ Plan → Limits` 排列。布局预留宽度固定 360px，从聊天主区左缘起始，并与顶栏下缘保留 8px 垂直间距；列内统一保留 8px 左右 padding，因此三张可见卡片的宽度和左右边界一致。Recent 列表为空时仍保留 Sessions 面板，保证完整会话导航始终有入口。
- 浮动态 Sessions 的标题栏和 Recent 内容共用一张 8px 圆角卡片。外层会话面板提供唯一的边框与不透明背景，Recent Project 分组在该模式下移除重复的边框和圆角，避免出现大于卡片的方形底层。Plan 与 Limits 使用相同的卡片圆角、背景、标题栏和列内 padding。
- Recent 在浮动、滑出和 pin 三种桌面模式继续直接复用 `renderRecentSessionsSection(false)`。分区统一显示 **RECENT**、history 图标和轻微强调背景，内部再按 Project 分组；完整列表在 Recent 后直接进入普通 Project 卡片，不额外增加 Projects 标题。移动端保持原有 Recent 标题结构。
- 点「全部 session」滑出完整会话导航。滑出面板与 pin 态共用 `ChatSessionPanel` 框架、标题栏和滚动容器，宽度固定 360px，并以平直全高表面贴齐聊天主区左上角后动画滑入/滑出；面板背景仍覆盖全高，只在 Sessions 标题栏上方保留 8px 同背景空白，使标题和操作图标与默认悬浮卡保持同一纵向位置。打开期间整列 Sessions/Plan/Limits 保持挂载但隐藏并禁用交互，避免两个悬浮层重叠。
- 滑出面板常挂载，保留 scrollTop；鼠标移出后等待 2 秒再自动滑回，期间重新移入会取消关闭。搜索框聚焦、菜单打开、拖拽滚动条期间抑制自动关闭；用户主动关闭、Pin、切换页面或打开侧栏设置时立即关闭并清理计时器。
- 桌面会话列表的基础左缩进为 11px；Recent 分组内的会话行同样在原有基础上增加 3px，保持浮动、滑出和 pin 三种模式的行对齐一致。

## pin 模式

pin 态把同构 Sessions 面板以 360px 固定宽度放进固定顶栏下方的左侧布局，不提供宽度拖拽；File/Git 等非 Chat 侧栏仍保留原有可调宽度。Sessions 标题栏位于固定顶栏下方，Pin 按钮保持强调色激活状态，完整会话导航使用余下空间独立滚动；顶部 Recent 内容保留强调分区，后面再接普通项目列表。浮动 Sessions 面板隐藏。Plan 与 Limits 从左侧悬浮列移动到固定 Sessions 面板右侧的聊天主区左缘，上下堆叠、绝对定位，不参与聊天内容布局，并继续使用悬浮列统一的 8px 左右 padding。pin/unpin 切换继续复用相同的 Recent 内容渲染与行布局，但浮动态将标题和 Recent 融合为单张卡片，pin 态则保持平直全高侧栏。

## 800px 对话列连续对齐

800px 视图模式下，文字列使用连续的 margin 与宽度公式。主窗口 W = 窗口宽 − preview 宽 − pin 侧边栏宽（浮动态为 0），R 为悬浮列预留宽（360px 浮动列宽 + 0px edge gap + 12px 列间距），V = 100px 为悬浮卡片最小可见宽度。文字列随 W 连续变化、无跳变：

1. **居中段**：左 margin = (W − 800) / 2；
2. **左贴段**：居中会侵入 R 时，左 margin 保持 R，右 gutter 继续收缩；
3. **遮挡段**：右 gutter 收至最小值后，左 margin 侵入 R，文字列经 fade mask 遮挡悬浮列；
4. **压缩段**：浮窗只剩 V 可见时，左 margin 保持 V，对话列从 800px 开始随 W 压缩，不再继续遮挡浮窗。

pin 态与浮动态共用同一公式。Plan/Limits 在 pin 态是聊天主区内的悬浮层；空间不足时覆盖并淡出对话左缘，而不额外占用对话布局宽度。
