> 摘要：本页维护 WheelMaker 前端视觉语言的稳定约定：设计风格定位、图标体系、动效原则、色彩收敛规则与 agent 标识呈现。

# 视觉语言

> 来源：[`../../scope/2026-07-24-session-list-visual-upgrade/spec-session-list-visual-upgrade.md`](../../scope/2026-07-24-session-list-visual-upgrade/spec-session-list-visual-upgrade.md)、[`../../scope/2026-07-24-floating-chrome-visual-upgrade/spec-floating-chrome-visual-upgrade.md`](../../scope/2026-07-24-floating-chrome-visual-upgrade/spec-floating-chrome-visual-upgrade.md)、[`../../scope/2026-07-24-topbar-menu-unification/spec-topbar-menu-unification.md`](../../scope/2026-07-24-topbar-menu-unification/spec-topbar-menu-unification.md)

本页记录跨页面生效的视觉语言约定。具体界面的布局与交互规则由各前端交互页面维护。

## 设计风格定位

- 整体风格为**精致深色工具风**（Linear/Raycast 一档）：深色为底、细腻的半透明边框、克制的强调色、短促干脆的微交互动效。
- 移动端与 PC 端**视觉语言完全一致**：同一套组件、图标、配色与动效风格；仅交互手段（hover/长按/右键）和密度（relaxed/compact）按平台分化。

## 材质双轨

- 常驻浮窗（Recent / Plan / Monitor 等长期可见浮层）使用**实心面板**：`surface-panel 88%`/`raised` 底 + `border-subtle 80%` 发丝边 + 统一 8px 圆角 + `--shadow-floating` + 顶部 1px 内高光。
- 瞬态弹窗（菜单、下拉等短暂停留弹层）使用**烟熏半实底**：`surface-overlay 88%` + 弱 `blur(12px) saturate(1.1)` + `border-faint` + `--shadow-overlay` + 8px 圆角 + 4px padding；它不是高透毛玻璃。`prefers-reduced-transparency` 下回充实心。
- aside 类结构不重复承载边框/背景/阴影，材质只由最外单层表达，避免双重边框。

## 图标体系

- 图标统一使用 **Lucide 风格细线性 SVG**，按需引入（tree-shaking），不使用图标字体；codicons 已废弃，新增界面不得再引入 `codicon-*`。
- agent 不配置专属图标，统一使用文字 pill 标识；pill 样式走精致化设计。
- 运行/完成/失败等会话状态使用 CSS 状态点（非图标），视觉保持收敛。

## 控件语言

- accent 只给"开启中"：图标按钮默认 `text-tertiary`，hover `--hover` 底 + `text-primary`，active/开启态才使用 `accent-soft-bg`。
- 顶栏与浮窗标题栏的图标按钮统一 ghost 语言；Project、Hubs 等文本入口同样按 ghost 文本按钮处理，不使用 accent chip。
- 顶栏文本入口中，当前 Project 名称是主信息，使用 `text-primary` 与明确字重；其 chevron 和计数等提示才使用次级色。
- 应用级入口优先使用紧凑、非徽标化的产品标记，而不是孤立的通用齿轮。它打开操作菜单，不以装饰性大图标占据顶栏。

## 悬浮提示（Tooltip）

- hover 提示统一走共享 Tooltip 体系（`web/src/common/Tooltip` 全局单例 + 元素上的 `data-tooltip` 属性，定位基于 `@floating-ui/react`），禁止新增原生 `title=` 提示；`iframe title` 等 a11y 名称属性不属于提示，不在此列。
- tooltip 只给有信息增量的场景：icon-only 且含义不自明按钮的操作说明、截断文本的全文、附加信息（完整时间戳、路径、包名、错误详情、快捷键、术语解释）。禁止为完全可见文字纯复读，禁止为不言自明控件（窗口控制、× 关闭、垃圾桶删除、纸飞机发送、回形针附件、放大镜搜索、⋯ 更多菜单）添加；内容本身可通过展开/点击看到全貌的（思考块、工具组摘要、diff 文件行、附件 chip、折叠触发器）同样不加；可访问性名称永远由 `aria-label` 承担，不因删除 tooltip 而移除。
- 样式是瞬态弹层的轻量变体：`surface-overlay` 烟熏半实底 + 弱 blur + `border-faint` + `--shadow-overlay` + 6px 圆角 + 11px 文字；进退场动效走 `--motion-*` / `--ease-*` tokens 并提供 `prefers-reduced-motion` 降级。
- 仅 hover 指针设备激活，移动端不启用；hover 短延迟显示防划过闪烁，键盘 focus 立即显示、Esc/blur 关闭；tooltip 只承担视觉提示，可访问性名称仍由元素自身 `aria-label` 表达。

## 动效原则

- 动效以**微交互**为主：快、短、不易察觉；面板折叠/展开、行 hover/按压/选中、列表项进入、弹层进出场统一编排。
- 弹层/菜单必须有进**和退**场动画，禁止只进不出；进退场统一 `sl-menu-in` / `sl-menu-exit`。boolean state 弹窗通过 menuExit 布尔变体 hook 包装所有关闭路径（外点、Esc、toggle），退场动画期间禁止交互，结束后才卸载。
- 时长与曲线统一走 tokens（`--motion-*` / `--ease-*`），禁止组件内自定义零散时长。
- 所有动画提供 `prefers-reduced-motion` 降级。
- 不做布局级 FLIP 动效。

## 色彩收敛

- 底色（surface 色系）保持稳定；边框、强调色、状态色、agent pill 配色统一收敛进 `tokens.css`，派生色优先使用 `color-mix`。
- 状态色只使用 `--state-warning` / `--state-danger` 等已定义 token；禁止引用未定义变量并靠 `var(--x, #hex)` fallback 兜底，避免双色值并存。
- 色彩锚点规则：项目/hub 分组使用已有 `--hub-accent` 作为色彩锚点，不为单个项目单独配色。

## 层级呈现原则

- 列表类界面二级结构的层级靠**字重/字号对比、色彩锚点、缩进**表达，不靠卡片套卡片。
- 一级分组行强、二级行弱；强化层级不得显著增加行高（一屏信息密度不降低）。
- Hub 等可展开分组以小色点、名称和 chevron 表达一级层级，二级项目通过缩进表达；禁止以整条彩色侧轨或独立检查器式外壳强化分组。
- Monitor 类数据密集浮窗的字号刻度：数据 11px tabular-nums、标签 10px、分区头 11px/650；展示型大数字（如 IQ score）单独使用 display 尺寸。

## 设置界面

- Settings 根页与 Update / Skills / Port Relay 三个详情页共用一套统一 kit：`set-card` / `set-btn`（ghost 默认，`--primary` / `--danger` / `--icon` 变体）/ `set-status`（CSS 状态点 + 标签）/ `set-disclosure` / `set-field` / `set-kv`；kit 置于 `web/src/styles/settings.css` 末尾，权威生效。
- 详情页不再使用 `codicon-*`；图标统一走共享 Lucide 组件 `web/src/common/Icon`（`SessionIcon` 已改为其薄再导出）。
- hub / skill / relay / 包的健康度统一用 `set-status` 状态点表达，不用图标；hub 分组沿用 `--hub-accent` 小色点 + 名称，不使用整条彩色侧轨。
- 机器标识符（hub id、版本、端口、access code、计数）走 mono + `tabular-nums`。设置面板圆角就地取 8px，不修改全局 `--radius-panel`。

