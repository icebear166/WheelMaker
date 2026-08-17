> 由 scope skill 于 2026-08-17 生成
> 状态：已批准 2026-08-17

# Prompt 历史下拉宽度自适应标题区 + 桌面密度优化

## 目标

prompt 历史下拉（chatTitlePromptMenu）目前的宽度是固定 clamp（`min(430px, max(280px, 100vw-24px))`）：在 PC 大屏幕上只是标题区下方的一小块，在折叠屏竖屏（接近正方形的宽内屏）上同样被 430px 上限压成中间一块，prompt 预览大面积截断，看起来憋屈。本次把菜单宽度改为跟随标题区宽度（全端统一规则），并在桌面指针设备上收紧行密度；移动端触屏密度与全部交互保持现状。

## 决策基线

### 需求边界

- 宽度规则全端统一：菜单左边对齐标题区左缘、宽度等于标题区宽度，左右各留 8px 呼吸位。PC 上跟随窗口宽度；手机与折叠屏竖屏下标题区即全屏宽，菜单随之接近全屏宽，不再出现"中间一小块"。
- 桌面指针设备（鼠标/触控板）行高从 40px 收紧到 36px，行内边距同步收紧；触屏设备行高保持 40px 不变。
- 字号保持现状（预览 13px、header 11px），时间轴脊柱的轨道宽度、圆点尺寸、光环比例不做缩放。
- 明确不做：移动端不改为 bottom sheet 形态；菜单内容结构（`Prompts · N` header + 单行省略预览 + 时间轴）不重新设计；宽度不做拖拽调节；打开中的菜单不实时跟随窗口 resize（重开即取新值，与现状一致）。
- 兼容要求：键盘导航（方向键/Home/End/Esc）、打开时聚焦当前项、视口底边进度规则、进出场动画（useMenuExitFlag + sl-menu-in/out）、history 触发图标全部保持不变；左右 safe-area 内边距维持现状（现状未处理，本次不新增）。

### 技术决策

- **定位数据源从触发按钮改为标题栏元素**：`chatTitlePromptMenuStyle` 不再用 `chatTitlePromptButtonRef` 的按钮矩形计算，改为取触发按钮 `closest('.chat-title-bar')` 的元素矩形（桌面与移动端触发器都渲染在 `renderChatTitleBar` 的 `.chat-title-bar` 内）；找不到标题栏时回退到按钮矩形。`left = rect.left + 8`，`width = max(280, rect.width - 16)`。
- **宽度仍为 JS 单一来源**：CSS 的 `.chat-title-prompt-menu` 不写 `width`（保持上次收敛结果），只保留 `position: fixed`、`top` 与滚动约束；`top` 计算不变。
- **桌面密度用指针媒体查询**：`@media (hover: hover) and (pointer: fine)` 下覆盖行高（`min-height: 36px`）与行内左右 padding 收紧；媒体查询外（触屏）走现有密度规则，即除宽度规则统一外，触屏设备的行密度与样式不变。

## 设计视图

### 功能设计

用户点击标题栏 history 图标（桌面）或会话标题（移动端）打开 prompt 历史下拉。菜单贴着标题栏正下方展开，左边与标题区左缘对齐、宽度与标题区一致（左右各内缩 8px）：PC 窗口越宽菜单越宽，prompt 预览可完整显示更多字符；折叠屏竖屏下菜单接近全屏宽，不再缩成中间一块。

菜单内容与行为不变：`Prompts · N` header、时间轴脊柱（当前及之前 accent 填充、之后 muted、当前项圆点带光环）、单行省略预览、点击跳转并高亮、方向键/Home/End 导航、Esc 关闭回焦。桌面指针设备上每行更紧凑（36px），同样的菜单高度可多容纳约一条记录；触屏设备保持 40px 触摸目标。

### 技术设计

`chatTitlePromptMenuStyle`（WorkspaceApp.tsx）改为：从 `chatTitlePromptButtonRef.current?.closest('.chat-title-bar')` 取标题栏矩形（回退按钮矩形），返回 `{left: rect.left + 8, width: Math.max(280, rect.width - 16)}`；菜单 closed/不可用时返回 `undefined` 的现状不变，memo 依赖不变。

chat.css 中 `.chat-title-prompt-menu` 保持无 `width` 声明；新增一段 `@media (hover: hover) and (pointer: fine)` 规则，只覆盖 `.chat-title-prompt-menu-item` 的 `min-height` 与左右 `padding`；其余样式（轨道、圆点、字号、header）不进入媒体查询，全端共享。

### 预估改动面

- `app/web/src/app/WorkspaceApp.tsx`：`chatTitlePromptMenuStyle` 计算逻辑。
- `app/web/src/styles/chat.css`：新增桌面指针媒体查询密度规则。
- `app/__tests__/web-chat-ui.test.ts`：更新标题栏菜单相关契约断言（定位来源、媒体查询存在性、移动端样式不变）。
- wiki：不更新（无匹配的现有页面，小任务不新建）。

## 验收

- PC 宽窗口（如 1440px）打开菜单：菜单左缘 = 标题区左缘 + 8px，宽度 = 标题区宽度 - 16px；窄窗口重开后取新值。验证证据：Edge headless 桌面视口截图（暗/亮双主题）。
- 折叠屏竖屏/移动视口（如 700px 宽竖屏）：菜单宽度 ≈ 视口宽 - 16px，不再固定 430px；行高保持 40px。验证证据：Edge headless 移动视口截图 + CSS 规则断言。
- 桌面指针环境行高 36px：CSS 断言 `@media (hover: hover) and (pointer: fine)` 块内 `.chat-title-prompt-menu-item` 含 `min-height: 36px`；媒体查询外规则保持 40px。
- 交互回归：键盘导航、打开聚焦当前项、视口底边进度规则行为不变；相关测试套件（web-chat-ui、web-chat-prompt-history、web-chat-virtuoso-mount、web-menu-keyboard-nav）无新增失败。
- `npm run tsc:web` 无错误；`npm run build:web` 构建成功。
