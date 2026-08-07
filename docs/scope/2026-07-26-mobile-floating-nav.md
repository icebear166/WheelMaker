# Mobile Floating Nav 重构

> 由 scope skill 于 2026-07-26 生成

## 目标

移动端专属的 floating control stack 当前由两个独立控件组成（PortRelay 气泡 + gesture-nav pill），存在圆圈堆叠观感差、常态 0.6 透明度导致"看不到"、codicon 图标违反视觉语言约定、展开几何可出屏、长按阈值三套并存、Relay frame 打开时无法拖拽等问题。本轮在保留现有基本结构（边缘停靠、tap 展开流程、拖拽换边/调位置）的前提下重构 gesture-nav 为"常态单图标按钮 + 展开磨砂菜单卡"形态，将 Relay 入口彻底合入菜单卡，顺带做 session 列表小迭代（density 统一 + 项目长按补 Resume 入口）。

## 决策

- **Q：本轮范围？** A：gesture-nav/浮控栈为主线 + session 列表小迭代。其余审查发现（UsageDialog 动画、zoom guard、haptics 等）留后续轮次。
- **Q：tap 展开连带滑出 session 抽屉、收起语义不对称（A1）是否修？** A：实际表现无问题，按有意设计保留，本轮不动。
- **Q：Relay 合入形态？** A：彻底合并。删除独立 relay 气泡，Relay 成为展开菜单卡的一项：tap 用当前 active target 打开/收起 relay frame；存在多个 target 时 tap 先弹 bottom-sheet 选 target。200ms 长按 target 菜单随之废弃。
- **Q：控件视觉形态？** A：菜单卡形态。常态 = 单个圆角矩形按钮，显示当前所在表面的 Lucide 图标 + 未读点；展开 = 一张整体圆角矩形菜单卡包裹全部目的地图标位，消灭独立圆圈堆叠。当前项高亮，Relay 位带 target 状态呈现。
- **Q：展开菜单卡带文字标签吗？** A：不带，纯图标列。
- **Q：材质？** A：分两档。常态按钮 = 轻透明（低不透明度，透出下方内容，不过多遮挡文字），但图标本身对比度拉满、任何背景上可辨识；去掉 idle 0.6 降透明。展开菜单卡 = 重磨砂（沿用现在的高度模糊效果）。
- **Q：基本结构变吗？** A：不变。保留左右边缘停靠、上下拖拽、换边 hysteresis、位置持久化（side + yRatio）。
- **Q：长按阈值？** A：收敛统一。拖拽长按 1000ms → 450ms，与 session/项目长按一致；relay 200ms 随气泡删除消失。
- **Q：按下后移动 ≥12px 取消 tap 时？** A：同步取消长按定时器，手势不再中途突然转入拖拽。
- **Q：图标体系？** A：gesture-nav 全部 codicon → Lucide（Preview 不再用 sidebar 图标，选表意准确的图标）；Relay 相关 chrome（frame surface 的返回/关闭/外链/target 状态）一并迁 Lucide。
- **Q：session 列表小迭代内容？** A：① 移动端 density 从 compact 统一为 PC 的 relaxed；② 清理无 CSS 规则的 `mobile-session-row` 等 5 个死 class；③ 项目长按 bottom-sheet 的 actions 阶段补 "Resume session" 入口，复用已有 sheet resume 流程（选 agent → 拉可恢复会话 → import）。
- **Q：拖拽性能与代码健康？** A：拖拽过程不再每帧 dispatch 全局 store，改本地 state/ref，拖拽结束才持久化；顺带清理死代码（`pressing` 死字段、冷却幽灵分支、遗留 localStorage key、双写 suppress ref）。

## 架构

- **`MobileFloatingNav` 组件**（新，`app/web/src/shell/layouts/mobile/`）：从 WorkspaceApp.tsx 的内联 JSX 抽出，承载常态按钮、展开菜单卡、拖拽 rails/backdrop。Props 接收当前表面、各目的地 active 状态、未读指示、relay target 信息及回调。
- **手势状态机**（`gestureNavigation.ts` 重写）：phase 改判别联合（`idle | pressing | expanded | dragging`），阈值常量统一出口；按下移动取消 tap 与长按定时器联动。
- **Relay 入口**：菜单卡 Relay 位复用 portRelay 既有状态（targets、activeTarget、frame open）；多 target 选择复用 mobile bottom-sheet 语言（与项目 sheet 同风格），不再新造弹层。
- **样式**：`shell.css` 浮动控制段重写，几何不再硬编码 210px/-81px；菜单卡高度由内容决定并计入停靠 bounds（`floatingControls.ts` 的 bounds 计算增加展开高度参数）。动效时长/曲线统一走 `--motion-*`/`--ease-*` token，补 `prefers-reduced-motion` 降级。
- **session 列表**：`sessionListDensity.ts` 移动端返回值改 relaxed；`SessionRow`/`ProjectSection` 删除死 class；项目 sheet actions 阶段增加 Resume 项（`WorkspaceApp.tsx` 渲染处分支）。

## 流程

- **tap 常态按钮** → 展开菜单卡 + 滑出 session 抽屉（现状保留）；再 tap 当前项 → 菜单卡与抽屉同时收起；点抽屉 overlay → 抽屉关、菜单卡级联收起；Escape / 点卡外 → 只收菜单卡、抽屉保持（A1 现状保留）。
- **tap 菜单卡目的地** → 切换到对应表面（Chat/Preview/Terminal/Monitor/Settings 行为不变）；Relay 位：单 target 直接 toggle frame，多 target 弹 target 选择 sheet，选定后打开 frame。
- **长按 450ms** → 进入拖拽：垂直 clamp 到 bounds（含展开高度余量），横向过中线 ±24px hysteresis 换边；抬起后持久化 side + yRatio 并设点击冷却。
- **按下移动 ≥12px** → 取消 tap 且取消长按定时器，手势 neutral 结束。
- **项目长按（session 列表）** → bottom-sheet actions 阶段：Pin/Unpin、Resume session；Resume → agent 选择 → 可恢复会话列表 → import。

## 验收标准

- 常态按钮轻透明、透出下方内容，图标在任何背景上清晰可辨；无 idle 降透明逻辑。
- 展开菜单卡为一张整体圆角矩形卡片，纯图标列含 Chat/Preview/Terminal/Relay/Monitor/Settings 六位，当前项高亮，Relay 位呈现 active target 状态；无独立圆圈、无 codicon。
- 控件拖到停靠范围最顶部时，展开菜单卡完整可见、所有项可点，不伸出安全区。
- Relay 无独立气泡；frame 打开期间控件整体仍可拖拽换边/调位置。
- 多 target 时 tap Relay 位弹出 target 选择 bottom-sheet；单 target 直接 toggle frame；无 target 时 Relay 位有明确的不可用呈现。
- tap / 长按拖拽 / 项目与会话长按阈值统一为 450ms；按下移动 ≥12px 后不再进入拖拽。
- 拖拽 pointermove 期间不触发全局 workspace store dispatch；持久化只发生在拖拽结束。
- 浮控相关动效时长/曲线均引用 motion token；`prefers-reduced-motion` 下展开/收起/拖拽反馈有降级。
- 移动端 session 列表行高与 PC relaxed 一致；`mobile-session-row` 等 5 个死 class 从 JSX 移除。
- 项目长按 sheet 出现 "Resume session"，可完成 agent 选择 → 列表 → import 全流程；无可恢复会话时显示空态。
- PC 端布局与行为零变化。

### 测试

- 测：`floatingControls.ts` bounds 计算（含展开高度参数）、`gestureNavigation.ts` 阈值与取消联动、菜单卡项渲染与 active/未读/target 状态、项目 sheet Resume 入口渲染与流程回调。合并进现有相邻 `*.test.tsx` 文件或同目录新测试文件。
- 不测：材质观感、模糊强度、动效曲线等视觉效果（手动验证）；iOS/Android 真机手势差异。

## 范围之外

- tap 展开与 session 抽屉的耦合及收起语义（按有意设计保留）。
- MobileUsageDialog 进退场动画、mobile sheet 退场方向与 overlay 退场、sheet 动画双写清理。
- `mobileViewportZoomGuard` 安装范围、safe-area 写法统一、断点体系。
- haptics 体系、stop pill 触控目标与 armed 反馈、各处 <32px 触控目标。
- `--status-error` / `--focus-border` / `--button-primary-text` 等缺失 token 补定义。
- session 长按菜单 bottom-sheet 化、行内可见 more 入口（长按可发现性）。
- Reload 确认、PC 端任何改动。
