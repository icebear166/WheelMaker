> 摘要：本页维护 Chat Composer 输入区的稳定规则：两行布局、stop 状态 pill、Enter 行为、触发菜单几何与弹层互斥/动画约定。

# Composer 输入区

> 来源：[`../../scope/2026-07-25-chat-composer-upgrade/spec-chat-composer-upgrade.md`](../../scope/2026-07-25-chat-composer-upgrade/spec-chat-composer-upgrade.md)

## 布局

- composer 为两行结构：输入行（Lexical 富文本输入 + 发送/语音 action column）与工具栏行（左侧触发按钮与状态区、右侧 config 区）。
- 运行中允许继续语音与排队发送，send 始终可用；stop 不占用 send 位置。

## Stop 状态 pill

- stop 只在运行中出现，位于工具栏左侧，形态为紧凑状态 pill：状态点 + `Responding` 文本 + 停止符，高度不超过工具栏行高。
- 状态点以弱脉冲表达"进行中"；取消中有明确态；非运行态经退场过渡消失。

## Enter 行为

- 桌面端不区分平台：Enter 发送、Shift+Enter 换行；触发菜单打开时 Enter 优先作用于菜单；输入法 composing 中 Enter 不发送。
- 移动端 Enter 行为由设置项（send / enter）决定。

## 触发菜单（/ 与 @）

- 两个菜单共享同一几何：宽度/内缩、圆角、padding、行高、max-height、active 态与空态样式一致；切换时只有内容变化。
- slash 菜单按 Commands / Skills 分组；菜单项显示名不带 `/` 前缀，选中插入后发送文本仍带 `/`。
- 快捷键提示统一在菜单 footer，kbd 样式；不使用顶部提示文本条。
- `@` 菜单行内预览按钮默认隐藏，hover / 键盘 active 行显示。

## 菜单互斥与动画

- composer 全部弹层（slash、file-mention、config 系、context usage、attachment tray）由统一 open-menu state 管理，任意时刻最多一个打开；不再用 `.chat-composer` 状态 class 手调 z-index。
- 弹层必须有进和退场动画（`sl-menu-in` / `sl-menu-exit` + menuExit hook 包装所有关闭路径），退场期间禁止交互，遵循 [visual-language.md](visual-language.md) 的弹层动效约定。
- placeholder 使用 Lexical 官方机制，不手写绝对定位坐标。
