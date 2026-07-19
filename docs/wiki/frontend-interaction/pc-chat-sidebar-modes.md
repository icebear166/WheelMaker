> 摘要：本页维护 PC 端 Chat 的固定地址栏、复用的浮动/滑出/pin 会话面板，以及 Plan/Limits 悬浮列与 800px 对话列的布局规则。

# PC Chat 侧边栏模式

PC 端（宽屏 ≥900px）Chat 有浮动与 pin 两种会话面板模式。浮动态是默认值；pin 是跨重启的全局偏好，用户主动 pin/unpin 后恢复相应模式。移动端（<900px）不参与本页规则。

## 固定顶栏与会话面板标题栏

- **顶部地址栏**只保留设置按钮与 hubs 下拉，搜索/archive 和会话栏展开按钮不在其中。桌面 Shell 在 Session 与 Chat 内容上方只渲染一个顶栏实例；pin/unpin 只替换其下方的会话面板，不移动、卸载或重新挂载顶栏。左段固定 360px，与浮动/滑出/固定会话面板共用 `--chat-session-panel-width`；中部 prompt 标题独占可伸缩空间，终端/预览操作固定在右侧。地址栏不读取 session 搜索展开状态：搜索只改变 Sessions 面板标题栏和列表内容。右侧 Preview 是顶栏所属主工作区的同级区域，继续使用自己的标题栏。
- **会话面板标题栏**由共享 `ChatSessionPanel` 提供，位于内容滚动区之外。浮动、滑出与 pin 态统一显示 **Sessions**，pin 控件始终占第一个操作槽位；浮动态额外提供完整列表展开按钮，滑出态与 pin 态提供各自可用的搜索和 archive 操作。

## 浮动态滑出会话导航

- 默认左侧悬浮列按 `Sessions（Recent 内容）→ Plan → Limits` 排列。布局预留宽度固定 360px，并从聊天主区左缘和顶栏下缘 `0px` 起始；列内统一保留 8px 左右 padding，因此三张可见卡片的宽度和左右边界一致。Recent 列表为空时仍保留 Sessions 面板，保证完整会话导航始终有入口。
- 浮动态 Sessions 的标题栏和 Recent 内容共用一张 8px 圆角卡片。外层会话面板提供唯一的边框与不透明背景，Recent Project 分组在该模式下移除重复的边框、背景和圆角，避免出现大于卡片的方形底层。Plan 与 Limits 使用相同的卡片圆角、边框、背景和列内 padding。
- 浮动态与 pin 态继续直接复用 `renderRecentSessionsSection(false)`，确保项目标题、会话行、选中态和操作缩进一致；只有浮动态通过作用域样式把 Recent Project 分组融入外层卡片，pin 态仍保留完整侧栏中的 Project 卡片结构。
- 点「全部 session」滑出完整会话导航。滑出面板与 pin 态共用 `ChatSessionPanel` 框架、标题栏和滚动容器，宽度固定 360px，并以平直全高表面贴齐聊天主区左上角后动画滑入/滑出；打开期间整列 Sessions/Plan/Limits 保持挂载但隐藏并禁用交互，避免两个悬浮层重叠。
- 滑出面板常挂载，保留 scrollTop；鼠标移出自动滑回，但搜索框聚焦、菜单打开、拖拽滚动条期间抑制滑回。
- 桌面会话列表的基础左缩进为 11px；Recent 分组内的会话行同样在原有基础上增加 3px，保持浮动、滑出和 pin 三种模式的行对齐一致。

## pin 模式

pin 态把同构 Sessions 面板以 360px 固定宽度放进固定顶栏下方的左侧布局，不提供宽度拖拽；File/Git 等非 Chat 侧栏仍保留原有可调宽度。Sessions 标题栏位于固定顶栏下方，完整会话导航使用余下空间独立滚动；顶部 Recent 内容保留 Project 卡片，后面再接完整项目列表。浮动 Sessions 面板隐藏。Plan 与 Limits 从左侧悬浮列移动到固定 Sessions 面板右侧的聊天主区左缘，上下堆叠、绝对定位，不参与聊天内容布局，并继续使用悬浮列统一的 8px 左右 padding。pin/unpin 切换继续复用相同的 Recent 内容渲染与行布局，但浮动态将标题和 Recent 融合为单张卡片，pin 态则保持平直全高侧栏。

## 800px 对话列连续对齐

800px 视图模式下，文字列使用现有的连续左 margin 公式。主窗口 W = 窗口宽 − preview 宽 − pin 侧边栏宽（浮动态为 0），R 为悬浮列预留宽（360px 浮动列宽 + 0px edge gap + 12px 列间距）。文字列左 margin 随 W 连续分段变化、无跳变：

1. **居中段**：左 margin = (W − 800) / 2；
2. **左贴段**：居中会侵入 R 时，左 margin 保持 R，右 gutter 继续收缩；
3. **遮挡段**：右 gutter 收至最小值后，左 margin 侵入 R，文字列经 fade mask 遮挡悬浮列。

pin 态与浮动态共用同一公式。Plan/Limits 在 pin 态是聊天主区内的悬浮层；空间不足时覆盖并淡出对话左缘，而不额外占用对话布局宽度。
