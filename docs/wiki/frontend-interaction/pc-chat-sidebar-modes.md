> 摘要：本页维护 PC 端 Chat 的固定地址栏、浮动/滑出/pin 会话面板、左右功能卡片与 800px 对话列的布局规则、搜索入口和 Archived 视图约定。

# PC Chat 侧边栏模式

PC 端（宽屏 ≥900px）Chat 有浮动与 pin 两种会话面板模式。浮动态是默认值；pin 是跨重启的全局偏好，用户主动 pin/unpin 后恢复相应模式。移动端（<900px）不参与本页规则。

## 固定顶栏与会话面板标题栏

- **顶部地址栏**保留设置按钮、当前 Project 下拉与 hubs 下拉，搜索/archive 和会话栏展开按钮不在其中。PC 左段固定 360px，与浮动/滑出/固定会话面板共用 `--chat-session-panel-width`，内部按「设置 → 8px 间距 → Project → 弹性空白 → Hubs」排列；Hubs 右边缘与下方 Sessions 卡片右边缘对齐。中部只保留 prompt 历史入口与标题，并独占可伸缩空间，终端/预览操作固定在右侧。桌面 Shell 在 Session 与 Chat 内容上方只渲染一个顶栏实例；浮动、滑出和 pin 只替换其下方的会话面板，不移动、卸载或重新挂载顶栏。地址栏不读取 session 搜索展开状态：搜索只改变 Sessions 面板标题栏和列表内容。右侧 Preview 是顶栏所属主工作区的同级区域，继续使用自己的标题栏。移动端继续使用原有 Project 与 session 标题组合。
- **顶栏控件语言**：右段 search / terminal / preview 与中部 history 入口统一 28px ghost 按钮（`text-tertiary` 默认 → hover `--hover` 底 + `text-primary`），accent 仅出现于 active 态；Project 下拉与 Hubs 计数为 ghost 文本按钮，不使用 accent chip；中部 session 标题为 `text-primary` + 500 字重。顶栏弹窗族（项目切换、prompt 历史、Hubs、Desktop 扩展菜单）统一毛玻璃材质，统一 `sl-menu-in` / `sl-menu-exit` 进退场。
- **浮动卡片标题栏**统一由 `ChatEdgeSurfaceHeader` 提供，Sessions、Plan、Limits 都使用 36px 高度、左侧折叠按钮、11px uppercase 标题和右侧操作区。展开态使用向下 chevron，收起态使用向右 chevron；收起只隐藏正文。Plan 可以在收起标题栏中保留一行截断的当前步骤和进度。
- **Plan 进度表达**：Plan 标题栏在 `n/N` 文本旁显示 3px 分段进度轨，每步一段（完成=绿、进行中=琥珀 1.6s 脉动、待办=低透空槽）；>12 步降级为连续 accent 填充条（宽度 = 完成占比、前沿脉动）；`n/N` 文本常驻。步骤标记使用 Lucide 描边图标，进行中同步脉动。移动端 Plan pill 为毛玻璃材质，保持纯文本进度、不加轨。
- **Sessions 布局操作**固定在标题栏右侧，顺序是完整会话栏、Pin；完整会话栏使用 `layout-sidebar-left`，打开后切换为 `layout-sidebar-left-off`。浮动态在完整会话栏图标左侧固定显示 **Ctrl+1**，强化该图标与键盘快捷键的对应关系；滑出态与 pin 态不显示这项提示。滑出态把 archive 与 search 放在标题后的左侧操作区，关闭完整栏与 Pin 保持右侧位置；pin 态只保留右侧高亮 Pin。浮动态标题显示 **Recent Sessions**，滑出与 pin 态继续显示 **Sessions**。
- **会话工具栏可见性**：PC 与移动端的会话工具栏都常态显示，功能集合一致（来源：[`../../scope/2026-07-24-session-list-visual-upgrade/spec-session-list-visual-upgrade.md`](../../scope/2026-07-24-session-list-visual-upgrade/spec-session-list-visual-upgrade.md)；2026-07-24 复审后取消 PC 端常态隐藏方案）。

- **Sessions 搜索展开**：搜索框弹出时向左展开，左边缘与侧栏左边框对齐；搜索展开模式下 Sessions 标题文字与左侧对齐。

## 浮动态滑出会话导航

- 默认左侧悬浮列按 `Recent Sessions → Plan → Limits` 排列。布局预留宽度固定 360px，从聊天主区左缘起始，并与顶栏下缘保留 8px 垂直间距；列内统一保留 8px 左右 padding，因此三张可见卡片的宽度和左右边界一致。Recent 列表为空时仍保留 Recent Sessions 面板，保证完整会话导航始终有入口。
- 浮动态的 **RECENT SESSIONS** 标题栏和 Project 分组内容共用一张 8px 圆角卡片，内容区不再重复显示 **RECENT** 分区标题。外层会话面板提供唯一的边框与不透明背景，Recent Project 分组在该模式下移除重复的边框和圆角，避免出现大于卡片的方形底层。Recent、Plan 与 Monitor 三张浮窗卡片共用同一实心面板材质（8px 圆角、发丝边、`--shadow-floating`、顶部 1px 内高光）、标题栏和列内 padding。
- Recent 内容继续复用同一个 renderer：浮动态通过 presentation 选项隐藏桌面分区标题，只显示 Project 分组与 session 行；滑出和 pin 模式继续显示 **RECENT**、history 图标和轻微强调背景，内部再按 Project 分组；完整列表在 Recent 后直接进入普通 Project 卡片，不额外增加 Projects 标题。移动端保持原有 Recent 标题结构。
- 点「全部 session」滑出完整会话导航。滑出面板与 pin 态共用 `ChatSessionPanel` 框架、标题栏和滚动容器，宽度固定 360px，并以平直全高表面贴齐聊天主区左上角后动画滑入/滑出；面板背景仍覆盖全高，只在 Sessions 标题栏上方保留 8px 同背景空白，使标题和操作图标与默认悬浮卡保持同一纵向位置。打开期间整列 Sessions/Plan/Limits 保持挂载但隐藏并禁用交互，避免两个悬浮层重叠。
- 滑出面板常挂载，保留 scrollTop；鼠标移出后等待 2 秒再自动滑回，期间重新移入会取消关闭。搜索框聚焦、菜单打开、拖拽滚动条期间抑制自动关闭；用户主动关闭、Pin、切换页面或打开侧栏设置时立即关闭并清理计时器。
- **Ctrl+1** 按用户保存的 Pin 模式分流：保存为未 Pin 时只展开/收起滑出面板，不修改持久化偏好；保存为 Pin 时第一次临时 Unpin，第二次恢复 Pin。快捷键产生的临时覆盖不落盘，点击 Pin/Unpin 按钮仍是修改跨重启偏好的唯一入口；切换页面、打开设置或重启会清除临时覆盖并恢复保存模式。
- 桌面会话列表的基础左缩进为 11px；Recent 分组内的会话行同样在原有基础上增加 3px，保持浮动、滑出和 pin 三种模式的行对齐一致。

## Recent Sessions 选取与排序

Recent Sessions 的选取与排序规则跨 PC（浮动/滑出/pin）和移动端一致：先在所有可见 Project 的 session 中按「unread/running 优先、再按 `updatedAt` 降序」选出 top 8，然后按 Project 分组展示；同一 Project 内的 session 严格按 `updatedAt` 降序排列，unread/running 优先级不再影响组内顺序。`updatedAt` 的口径是"最后一次 prompt start/done"（见 [`../architecture/session-management-and-sync.md`](../architecture/session-management-and-sync.md)），流式中间 turn 不改变排序。chat 区域没有右键/长按弹出的会话切换菜单，Recent Sessions 列表是唯一的快速切换入口。

## pin 模式

pin 态把同构 Sessions 面板以 360px 固定宽度放进固定顶栏下方的左侧布局，不提供宽度拖拽；File/Git 等非 Chat 侧栏仍保留原有可调宽度。Sessions 标题栏位于固定顶栏下方，Pin 按钮保持强调色激活状态，完整会话导航使用余下空间独立滚动；顶部 Recent 内容保留强调分区，后面再接普通项目列表。浮动 Recent Sessions 面板隐藏。Plan 与 Limits 从左侧悬浮列移动到固定 Sessions 面板右侧的聊天主区左缘，上下堆叠、绝对定位，不参与聊天内容布局，并继续使用悬浮列统一的 8px 左右 padding，与固定顶栏下缘也保持与浮动态一致的 8px 顶部间距。pin/unpin 切换继续复用相同的 Recent 内容渲染与行布局，但浮动态直接以 **RECENT SESSIONS** 作为卡片标题并隐藏重复的分区标题，pin 态则保持 **SESSIONS → RECENT** 的平直全高侧栏。

## 800px 对话列连续对齐

对话列固定为 800px，不再提供 full 宽度档与设置项，旧持久化宽度值直接忽略。文字列使用连续的 margin 与宽度公式。主窗口 W = 窗口宽 − preview 宽 − pin 侧边栏宽（浮动态为 0），R 为悬浮列预留宽（360px 浮动列宽 + 0px edge gap + 12px 列间距），V = 100px 为悬浮卡片最小可见宽度。文字列随 W 连续变化、无跳变：

1. **居中段**：左 margin = (W − 800) / 2；
2. **左贴段**：居中会侵入 R 时，左 margin 保持 R，右 gutter 继续收缩；
3. **遮挡段**：右 gutter 收至最小值后，左 margin 侵入 R，文字列经 fade mask 遮挡悬浮列；
4. **压缩段**：浮窗只剩 V 可见时，左 margin 保持 V，对话列从 800px 开始随 W 压缩，不再继续遮挡浮窗。

pin 态与浮动态共用同一公式。Plan/Limits 在 pin 态是聊天主区内的悬浮层；空间不足时覆盖并淡出对话左缘，而不额外占用对话布局宽度。

## 右侧 Model efficiency 卡片

- Model efficiency 独立锚定在 Chat 主区右缘，宽度与左侧 Limits 卡片列一致，不加入 Recent Sessions、Plan、Limits 的左侧堆叠顺序。
- 卡片默认使用 Simple 矩阵，支持折叠、Detail、手动刷新和隐藏；其显示偏好独立于 Limits，标题栏和表面样式继续复用 edge surface 约定。
- Preview 打开时卡片跟随缩小后的 Chat 主区右缘，不自动隐藏、折叠或关闭 Preview。卡片与 800px 对话列相交时使用 `right` 方向的 edge-surface 几何淡出正文交界，卡片操作区保持可交互。
- Simple/Detail 内容和数据边界见 [`../features/model-efficiency.md`](../features/model-efficiency.md)。

## 搜索入口与 Archived 视图

- 搜索入口按区域归属：chat 标题栏搜索按钮打开当前会话搜索，Sessions 标题栏搜索按钮打开跨会话搜索，Preview chrome 搜索按钮打开文件内搜索；会话搜索条只覆盖 800px 对话列上方，不提供多目标切换器。
- Windows 上 Ctrl+F 为全局唯一入口：在聊天区居中弹出模态搜索选择器，列「当前会话 / 所有会话 / 文件预览」三个目标，↑/↓ 或 Tab/Shift+Tab 循环切换，Enter 进入对应搜索栏（目标未展开则自动展开，preview 无内容时目标禁用），Esc 关闭；各窗口不再单独监听 Ctrl+F。非 Windows 平台不拦截 Ctrl/Cmd+F，走系统或浏览器原生查找。
- Archived 列表视图在会话面板内完整可见，不被右侧悬浮列等任何层遮挡；归档会话行保持一条一行，标题与操作不折行、不错位。
