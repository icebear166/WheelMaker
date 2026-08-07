> 由 scope skill 于 2026-07-25 生成

# Chat Composer 输入区升级

## 目标

composer 输入区是 chat 界面最后一块未按 wiki 视觉语言（`docs/wiki/frontend-interaction/visual-language.md`）精修的区域：codicon 图标残留密集、frame 与弹层材质偏离规范、色彩硬编码、全部弹层无进退场动画、stop 按钮位置与语义不当、Enter 发送行为按平台分叉（桌面非 Windows 浏览器 Enter 无法发送）。本轮从交互、表现、动效三个维度迭代 composer 全区，并顺带清除 chat 模块的全部 codicon 残留。

## 决策

- **范围是 composer 输入区**，不是聊天消息区排版，也不是模态弹窗（AppDialogs）。
- **结构策略是收敛 + 局部结构调整**：不重新设计整体布局，只修明确的结构问题（stop 形态、菜单互斥、placeholder）。
- **stop 不能替代 send**：运行中允许语音与排队发送，send 必须始终可用。stop 位置保持在 toolbar 左侧，形态升级为紧凑状态 pill（状态点 + `Responding` 文本 + 停止符），高度受控不挤压底部空间；原有呼吸动画的表达意图（进行中）由状态点的弱脉冲继承，动效短促克制。
- **桌面端 Enter 全平台发送**：删除 `isWindowsPlatform` 分叉，桌面 Enter 发送 / Shift+Enter 换行；移动端现有 enter 行为设置项不变。
- **图标范围是整个 chat 模块**：composer、消息区（ChatTurnView / ChatToolCallGroup）、permission 弹窗、scroll-bottom 按钮、菜单项图标的 codicon 全部替换为 Lucide 细线性 SVG（tree-shaking 按需引入）；slash 菜单项图标（`chatSessionActions.ts` 硬编码的 4 个 codicon）建立到 Lucide 的映射。
- **slash 菜单加 Commands / Skills 分组头**；菜单项显示名去掉 `/` 前缀（分组头已承担语义），内部 name 与插入逻辑保持带 `/` 不变。
- **`/` 与 `@` 菜单几何统一**：同一宽度/内缩、圆角、padding、行高、max-height、active 态与空态样式；快捷键提示从英文文本条改为菜单 footer 的 kbd 样式；`@` 菜单行内预览按钮默认隐藏，hover/active 行才显示。
- **菜单互斥收口**：slash / file-mention / config 系 / context usage / attachment tray 的开关收进统一 open-menu state，替代散落在各 onClick 里的手动互斥与 `.chat-composer` 上的 z-index class 手调。
- **材质与色彩按 wiki 规范收敛**：frame 8px 圆角 / `--shadow-floating` / 顶部 1px 内高光；slash 与 file-mention 菜单的双份材质定义（chat.css 3731 段与 5290 段、file.css 1057 段）合并为瞬态弹层单一配方；skill capsule 的 `#79c0ff`/`#1f6feb`、stop 动画的硬编码 rgba 全部进 tokens 或复用 `--state-danger`。
- **composer 全部弹层补进退场动画**：接 `sl-menu-in` / `sl-menu-exit` 与 menuExit hook（对齐 session list 既有模式），退场期间禁止交互，结束后才卸载。

## 架构

- **渲染层**：`WorkspaceApp.tsx` composer 段（frame、附件列表、输入行、toolbar、各弹层）+ `ChatRichComposer.tsx`（Lexical 编辑器、capsule token）。
- **样式层**：`chat.css` composer 段（3475+ 与 5720+ 补丁段收敛为一处）、`file.css` file-mention 段；派生色与新增状态色进 `tokens.css`，时长/曲线走 `--motion-*` / `--ease-*`。
- **菜单状态**：统一 open-menu 枚举 state（同一时间最多一个弹层打开），z-index 由弹层自身层级管理，不再依赖 `.chat-composer` 的状态 class。
- **动画**：复用 `chat/sessionlist/menuExit.ts` 的 `useMenuExitFlag` / `useMenuExitState` 包装所有弹层关闭路径（外点、Esc、toggle、互斥关闭）。
- **placeholder**：改用 Lexical 官方 placeholder 机制，删除手写绝对定位（left 8px / top 5px）。

## 验收标准

- chat 模块源码（`app/web/src/chat/**`、WorkspaceApp composer 段）不再出现 `codicon-`（rg 验证）；替换图标为 Lucide 细线性风格。
- composer frame 与弹层材质符合 visual-language 规范：8px 圆角、`--shadow-floating`、顶部内高光；slash 与 file-mention 菜单只有一份材质定义。
- 无新增硬编码 hex / rgba 颜色；skill capsule 与 stop 动画色走 tokens 或 `--state-danger`。
- stop 状态 pill：仅运行中出现于 toolbar 左侧，高度不超过 toolbar 行高；点击触发取消；取消中（cancelling）有明确态；非运行态带退场过渡消失。
- 桌面端（Windows / macOS / Linux UA）Enter 发送、Shift+Enter 换行；slash / file-mention 菜单打开时 Enter 仍优先作用于菜单项；输入法 composing 中 Enter 不发送。
- 移动端 enter 设置项（send / enter）行为不变。
- composer 所有弹层（slash、file-mention、core-config、config-value、context-usage、attachment tray）有进、退场动画；退场期间不可交互；`prefers-reduced-motion` 下退化为无动画。
- 任意时刻最多一个 composer 弹层打开；打开一个自动关闭其他；Esc / 外点 / 再次点击触发按钮都能经退场动画关闭。
- slash 菜单显示 Commands / Skills 分组头与无 `/` 前缀的项名；选中插入后发送文本仍带 `/`。
- `/` 与 `@` 菜单几何一致：同宽度/内缩、圆角、padding、行高、max-height、active 态与空态样式；两菜单底部均有 kbd 样式快捷键提示，原英文提示文本条移除。
- `@` 菜单行内 preview 按钮默认不显示，hover / 键盘 active 行显示；Right 键预览行为不变。
- drag-over 态显示提示文案（如 "Drop files to attach"）。
- placeholder 样式不再包含手写定位坐标，跟随输入框排版。
- VoiceRecordingBar 与 toolbar 切换有微过渡、无布局跳变；附件列表增删、capsule 选中态有微过渡；全部提供 `prefers-reduced-motion` 降级。
- `prefers-reduced-transparency` 下弹层回充实心材质。

### 测试

- **测什么**：菜单互斥 state（单开、切换、Esc/外点/toggle 关闭都先退场再卸载）；Enter 行为矩阵（桌面各 UA × 菜单开关 × composing）；slash 菜单分组渲染与显示名去前缀、插入文本仍带 `/`；stop pill 的显隐条件与取消回调；placeholder 显隐。
- **不测什么**：纯视觉取值（圆角、阴影、颜色 token）、Lucide 图标选型、动画时长曲线本身。
- **切入点**：app 现有 jest（`__tests__/` 与各 `*.test.tsx`），优先合并进现有测试文件，仅在明显无承载文件时新增。

## 范围之外

- 消息区排版重设计（bubble、markdown、turn 布局）；ChatTurnView / ChatToolCallGroup 本轮只换图标。
- chat 模块以外的 codicon 残留（settings、shell、terminal、file、debug 等）。
- AppDialogs 模态弹窗（确认 / 重命名 / 会话状态）的视觉迭代。
- 工具栏信息架构重做（入口合并、config 区重组）。
- 协议变更；语音输入功能本身的行为变更。
