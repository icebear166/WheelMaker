> 摘要：本页维护移动端全局 Floating Nav 的 Surface 切换、边缘停靠、形态材质、手势、避让与 Relay 入口约定。

# Mobile Floating Nav

> 来源：[`../../scope/2026-07-26-mobile-floating-nav/spec-mobile-floating-nav.md`](../../scope/2026-07-26-mobile-floating-nav/spec-mobile-floating-nav.md)、[`../../scope/2026-07-31-mobile-surface-navigation/spec-mobile-surface-navigation.md`](../../scope/2026-07-31-mobile-surface-navigation/spec-mobile-surface-navigation.md)

本页记录移动端 floating control 的稳定约定。视觉语言（材质配方、图标体系、动效 token）的总则见 [`visual-language.md`](visual-language.md)；session 列表侧的长按菜单见 [`session-list.md`](session-list.md)。

## 形态

- 移动端只有一个边缘停靠的浮控控件：常态是单个圆角矩形图标按钮，显示当前所在表面的 Lucide 图标 + 未读点；tap 展开为一张整体圆角矩形菜单卡，纯图标列（无文字标签），当前项高亮。
- 菜单卡目的地按 `Preview → Terminal → Relay → Monitor → Settings → Chat` 固定排列；当前 Surface 只改变高亮，不改变顺序。Relay 位呈现 active target 状态，Preview 位呈现非零标签数量；收起状态为 Preview 时也显示数量。
- 基本结构稳定：左右边缘停靠、垂直拖拽调位置、横向过中线 ±24px hysteresis 换边、side 与 yRatio 持久化，这些不随视觉迭代改变。

## 全局 Surface 导航

- Floating Nav 是移动端应用级 Surface Switcher，在 Chat、Preview、Terminal、Relay、Monitor、Settings 六个主 Surface 中常驻；PC 端不显示。
- 收起按钮显示当前 Surface。tap 收起按钮展开固定菜单；菜单展开后 tap 当前项只收起菜单，选择其他项切换 Surface，选择 Chat 返回聊天。
- 六个 Surface 共享同一份停靠侧、垂直位置和拖拽状态。切换 Surface 保留 Preview 标签、当前 Terminal、滚动位置和 Workbench 全屏状态，只关闭临时菜单、Sheet 与弹层。
- Floating Nav 所在应用控制层高于主 Surface、低于确认弹窗、菜单和 Sheet 等临时模态层；不得由单个主 Surface 私自隐藏或卸载。
- Chat 保留既有 Session 抽屉联动：在 Chat tap 收起按钮会同时展开菜单并打开抽屉；其他 Surface 只展开菜单。切离 Chat 时关闭抽屉。

## 材质

- 分档明确：常态按钮轻透明（透出下方内容、不过多遮挡文字），但图标对比度必须在任何背景上可辨识；不做 idle 降透明。
- 展开菜单卡用重磨砂材质（标准 overlay 配方的强模糊档），与常态形成清晰档位差。

## Relay 入口

- Relay 无独立气泡，彻底并入菜单卡且**常驻可见**：frame 打开时 tap 关闭 frame；relay 已启用且有 target 时单 target 直接打开 frame、多 target 先弹 bottom-sheet 选 target（复用项目 sheet 的菜单语言）；未启用或无 target 时 tap 打开独立 Port Relay 页面（app menu 一级入口承载，不再进入 Settings）。
- Relay 位用 CSS 状态点呈现 frame 开关状态；frame 打不开时整位降不透明度，不做禁用。
- Relay frame 打开期间浮控整体保持可拖拽，不卸载。

## 手势阈值

- tap、长按拖拽、session/项目长按共用 450ms 一档；不再存在 200ms / 1000ms 的私有阈值。
- 按下后移动 ≥12px 取消 tap 的同时取消长按定时器，手势 neutral 结束，不中途转入拖拽。
- 拖拽过程状态走本地 ref/state，不每帧写全局 store；持久化只发生在拖拽结束。

## 展开几何

- 展开菜单卡的高度计入停靠 bounds：控件拖到允许范围最顶部时菜单卡仍完整可见、全部项可点，不伸出安全区。
- 顶部余量只在软键盘关闭时预留；键盘打开时可停靠区间被压缩，继续预留会把控件推走，此时取消余量。
- 菜单卡高度由内容决定，不写死像素几何。
- Preview、Terminal 的移动端全屏按钮占用右下角保留区域；Floating Nav 停靠右侧时，收起、展开和拖拽落点均需避开该区域。左侧停靠不为右侧按钮预留无关空隙。

## 动效

- 展开/收起/拖拽反馈的时长与曲线统一引用 `--motion-*`/`--ease-*` token，禁止散装毫秒值；`prefers-reduced-motion` 下必须有降级。

## 有意保留

- Chat 内 tap 展开连带滑出 Session 抽屉是有意设计；该联动不扩展到其他 Surface。
