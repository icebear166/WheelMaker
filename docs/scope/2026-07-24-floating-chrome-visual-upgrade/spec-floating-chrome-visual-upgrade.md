> 由 scope skill 于 2026-07-24 生成

# 浮窗与顶栏视觉统一(Floating Chrome Visual Upgrade)

## 目标

上一轮(session-list-visual-upgrade)把 session 列表全链路升级为精致深色工具风,并沉淀了视觉语言约定(Lucide 图标、弹层进退场、色彩收敛、层级表达);浮窗(Recent / Plan / Monitor)与顶栏未被覆盖,仍是旧语言:三张浮窗卡片材质各自为政(Recent 有阴影、Monitor 无阴影、Plan 带蓝色描边、圆角 8/10 混用、aside+glass 双重边框);顶栏 search / terminal / preview / history 四个按钮三套颜色,Project 下拉与 Hubs 计数是 accent chip;顶栏弹窗族(项目切换、prompt 历史、Hubs、Desktop 扩展)样式与 session 菜单脱节且直挂直卸无动画,违反 wiki"弹层必须有进和退场"约定;Monitor 内容区(Limits / IQ)字号失控(8-10px 微字)、`--status-warning` / `--status-danger` / `--surface-root` 失效变量导致状态色双色值并存、卡片套卡片。

本轮目标:浮窗与顶栏(含弹窗族、Monitor 内容区)全面接入既有视觉语言——统一、简洁、有质感;移动端与 PC 视觉语言一致,仅密度与交互手段按平台分化;顺带把范围内残留的 codicon 清零。

## 决策

- **范围是什么?** → ① 浮窗:Plan、Monitor(桌面浮层 + 移动端形态:移动 Plan pill、移动 Monitor 弹窗);② 顶栏:PC 与移动端顶栏 + 全部弹出窗口(项目切换、prompt 历史、Hubs、Desktop 扩展菜单);③ Monitor 内容区:Limits(compact / detail)与 IQ(simple / detail)的样式、风格、字体。结构、数据、功能项不增删。
- **材质系统?** → 双轨。常驻浮窗 = 实心面板(`surface-panel 88%/raised` 底 + `border-subtle 80%` 发丝边 + 统一 8px 圆角(wiki 既定,Monitor 的 10px 收齐)+ 统一 `--shadow-floating` + 顶部 1px 内高光);瞬态弹窗 = 毛玻璃(复用 session 菜单配方:`surface-overlay 88%` + `blur(12px) saturate(1.1)` + `border-faint` + `shadow-overlay` + 4px padding)。换回毛玻璃后,既有 `prefers-reduced-transparency` 兜底 media query(已覆盖这些选择器)自动重新生效。
- **控件语言?** → accent 只给"开启中"。顶栏右段 search / terminal / preview 与中部 history 入口统一 28px ghost(`text-tertiary` 默认 → hover `--hover` 底 + `text-primary`;active = `accent-soft-bg`);左侧设置按钮同语言(30px 尺寸不动);Project 下拉与 Hubs 计数按钮去 accent chip 改 ghost 文本按钮;中部 session 标题提为 `text-primary` + 500 字重;Monitor tabs 统一为发丝边分段控件(透明轨、选中 `accent-soft-bg` + accent 文字、去内 ring),动作按钮 22px ghost。
- **弹窗进退场做到什么程度?** → 进 + 退场一次做到位(用户拍板):4 个弹窗统一 `sl-menu-in` / `sl-menu-exit`,给 boolean state 加 `menuExit.ts` 布尔变体 hook,所有关闭路径(外点、Esc、toggle)走包装后的 setter;退场期间 `pointer-events: none`。
- **Plan 进度表达?** → 分段进度轨 + 状态脉动(用户拍板,含降级规则):标题栏 `2/5` 旁加 3px 分段轨,每步一段(完成=绿、进行中=琥珀 1.6s 脉动、待办=低透中性"空槽");>12 步退化为连续填充条(宽度 = completedCount/totalCount,纯 accent 填充,前沿脉动);文本分数常驻;步骤标记换 Lucide 描边图标且进行中同步脉动;移动端 pill 保持纯文本不加轨。
- **Limits 色彩?** → 正常态 rail 保持 accent(用户拍板:灰色太像禁用),改为纯 `--accent-primary` 不混 `text-primary`(修复两主题色偏相反);警告/危险接 `--state-warning` / `--state-danger`(消除双色值),tone 行 label 同步染色。行内层级:Provider/账号名 = text-primary 650(行锚点);数据值 = text-primary 11px tabular-nums;标签/后缀/空态 = text-tertiary 10px;hub pill = text-tertiary 10px mono 只留发丝边。
- **Monitor 内容字号刻度?** → 数据 11px tabular-nums、标签 10px、分区头 11px/650;IQ score 保留 display 尺寸(clamp 18-20px)收敛为 700 / -0.02em;hub pill 8→10px;IQ detail 表格 9→10px mono;删除冗余 `'IBM Plex Sans'` 显式声明(= 基字体),JetBrains Mono 只留纯数据位。
- **卡片套卡片?** → Limits detail 的 account-card 拍平为 hairline 分隔分区(标题行 + 额度行),行高不降;IQ Simple 保留家族色锚点与分区卡片(wiki 既定展示约定)但三件套收敛为单层:去 inset 3px 色条、tint 边降为 `family-color 30%` 发丝边、底色降为 3%,家族色主要体现在模型名与 score 文字色;IQ detail 的 family 卡拍平为 hairline 分组(h3 + 表格)。
- **IQ 加载/空态?** → loading 换与内容同形的骨架条(3 组 rail 占位,opacity 呼吸);error 保留 Retry;Limits 空态文案保持(被动数据)。
- **图标体系?** → 本轮范围内 codicon 清零 → Lucide(SessionIcon 注册表新增 arrowRight / circle / eyeOff / layoutGrid / terminal / panelRight / history / listChecks,better-icons 已校验),覆盖 Plan 步骤标记、Monitor 三动作(hide/detail/refresh)、移动端 Monitor 弹窗 refresh/close、顶栏 history/search/terminal/panelRight、Project 按钮 chevron、菜单 + 号。Monitor 刷新旋转改用 `sl-icon-spin`(删除 usage-spin 与 codicon spinning)。
- **动效?** → 菜单 sl-menu-in/out;Plan 列表展开 sl-list-in;脉动 1.6s;全部走 motion token;reduced-motion 全降级;不新增布局级动画。
- **代码组织?** → 原地改造:chat.css / usage.css / modelEfficiency.css / shell.css / terminal.css 相关段落重写;组件改动限 ChatPlanSurface、MonitorSurface、MobileUsageDialog、WorkspaceApp(顶栏段 + 4 弹窗 state 接 hook)、DesktopTitleBar(扩展菜单);不重构 WorkspaceApp 其他部分,不新增模块目录。

## 架构

改造集中在 `app/web/src`:

- **`chat/sessionlist/SessionIcon.tsx`**:注册表新增 8 个 Lucide 字形(唯一图标入口,沿用既有 stroke 1.5 / 24 viewBox 封装)。
- **`chat/sessionlist/menuExit.ts`**:新增 boolean state 变体 hook(如 `useMenuExitFlag`),供 WorkspaceApp 三个 boolean 弹窗与 DesktopTitleBar 扩展菜单复用;退场时序与 `useMenuExit` 一致(100ms,`sl-menu-exit`,reduced-motion 直卸)。
- **组件原地改造**:`ChatPlanSurface`(标记/进度轨/移动端 pill 图标)、`MonitorSurface`(动作图标 + tabs 结构不变)、`MobileUsageDialog`(动作图标)、`WorkspaceApp`(顶栏按钮图标、4 弹窗进退场接线)、`DesktopTitleBar`(扩展菜单进退场 + 材质)。
- **样式**:
  - `chat.css` — 浮窗三卡材质统一(去掉 aside 边框/背景/阴影,glass 单层承载)、共享 header 控件、Plan(列表/标记/进度轨/移动 pill)、顶栏按钮统一块、面包屑与 Project 按钮、两个 title 菜单材质与条目;
  - `usage.css` — function surface 圆角收齐、Monitor tabs / 动作、Limits compact / detail 内容、移动弹窗;
  - `modelEfficiency.css` — IQ simple / detail 内容、骨架条;
  - `shell.css` — `chat-menu-icon-button` ghost 化、Desktop 扩展菜单材质与进退场;
  - `terminal.css` — 删除独立 `.chat-terminal-toggle`(并入 chat.css 统一块);
  - 新增颜色一律走 `tokens.css` 既有 token 派生(color-mix),不引入新色值。

## 验收标准

- 桌面 Recent / Plan / Monitor 三卡视觉一致:同一 8px 圆角、发丝边、实心面板、`--shadow-floating`、顶部内高光、36px 共享标题栏;aside 无残留边框/背景/阴影;Monitor 有阴影。
- 顶栏(PC 与移动)所有图标按钮同一 ghost 语言,accent 仅出现于 active 态;Project / Hubs 为 ghost 文本按钮;session 标题 text-primary 500。
- 4 个顶栏弹窗 + Desktop 扩展菜单统一毛玻璃材质,进场 `sl-menu-in`、退场 `sl-menu-exit`(100ms 后卸载,退场期禁交互);reduced-motion 下直挂直卸;reduced-transparency 下回充实心。
- Plan 标题栏显示分段进度轨(完成/进行/待办三色,进行中脉动)且 `n/N` 文本常驻;>12 步显示连续填充条;步骤标记为 Lucide 图标;移动端 pill 为毛玻璃材质、纯文本进度。
- Monitor:Limits 行层级可辨(名称锚点 / 数据 / 弱化标签),正常态 rail 纯 accent、tone 态接 `--state-*` 且 label 同步;detail 无卡片套卡片;IQ Simple 家族色单层化、score 18-20px/700/-0.02em;IQ detail hairline 分组;loading 为同形骨架条;字号刻度落地(数据 11 / 标签 10 / pill 10 / detail 表格 10)。
- 本轮范围(浮窗、顶栏、弹窗族、Monitor 内容)无 `codicon` 引用;其余界面(设置、终端、Preview、composer 区)codicon 替换不在本轮。
- 全部动画走 motion token 且有 reduced-motion 降级;亮色主题经 token 派生不破(不单独重设计)。
- 布局几何不变:浮窗宽度/位置、顶栏高度与分区、弹窗锚定逻辑、移动端安全区。

### 测试

- 更新锁定旧样式的 CSS 断言:`web-chat-ui.test.ts`(顶栏按钮/菜单)、`web-chat-session-panel-layout.test.tsx`(卡片圆角/玻璃)、`web-usage-feature-surface.test.tsx`(Monitor tabs / 移动弹窗)、`web-chat-plan-surface.test.tsx`(若涉及);遵循上一轮原则——不新增像素级样式断言,保持几何/结构断言。
- 更新组件断言:`MobileUsageDialog` 刷新 spinning → `sl-icon-spin`;`ChatPlanSurface` 标记 svg 化;菜单进退场 hook 的行为测试(关闭后延迟卸载、reduced-motion 直卸、重复关闭不重复计时)。
- 行为覆盖不动:菜单功能项、刷新/折叠/隐藏回调、tabs 切换。
- 不测:像素级颜色/阴影值、亮色主题视觉。

## 范围之外

- composer 区及其弹层(chat-config / core-config 菜单、context usage popover、slash / 文件提及菜单)。
- 设置页、终端、Preview、File/Git 等其余界面;亮色主题重设计。
- Hubs 弹层内容结构(hub 树、颜色选择器)、Monitor 数据层与刷新逻辑、Plan 数据提取。
- 浮窗宽度/位置几何、顶栏高度、800px 对话列公式、协议与 protocol version。
- tokens.css 新增色值(仅派生);新模块目录与 WorkspaceApp 其他部分重构。
