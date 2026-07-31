> 摘要：本页维护移动端 Floating Nav（边缘停靠快捷导航控件）的形态、材质、手势阈值、Relay 合并入口与动效约定。

# Mobile Floating Nav

> 来源：[`../../scope/2026-07-26-mobile-floating-nav/spec-mobile-floating-nav.md`](../../scope/2026-07-26-mobile-floating-nav/spec-mobile-floating-nav.md)

本页记录移动端 floating control 的稳定约定。视觉语言（材质配方、图标体系、动效 token）的总则见 [`visual-language.md`](visual-language.md)；session 列表侧的长按菜单见 [`session-list.md`](session-list.md)。

## 形态

- 移动端只有一个边缘停靠的浮控控件：常态是单个圆角矩形图标按钮，显示当前所在表面的 Lucide 图标 + 未读点；tap 展开为一张整体圆角矩形菜单卡，纯图标列（无文字标签），当前项高亮。
- 菜单卡目的地：Chat / Preview / Terminal / Relay / Monitor / Settings；Relay 位呈现 active target 状态。- 基本结构稳定：左右边缘停靠、垂直拖拽调位置、横向过中线 ±24px hysteresis 换边、side 与 yRatio 持久化，这些不随视觉迭代改变。

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

## 动效

- 展开/收起/拖拽反馈的时长与曲线统一引用 `--motion-*`/`--ease-*` token，禁止散装毫秒值；`prefers-reduced-motion` 下必须有降级。

## 有意保留

- tap 展开连带滑出 session 抽屉是有意设计；选目的地 / Escape 只收起菜单卡、不关抽屉，再 tap 当前项才同时收起，语义不对称属现状保留。
