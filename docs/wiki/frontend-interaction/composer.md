> 摘要：本页维护 Chat Composer 输入区的稳定规则：布局、Session Queue、运行中附件、stop、Enter、触发菜单与弹层约定。

# Composer 输入区

> 来源：[`../../scope/2026-07-25-chat-composer-upgrade/spec-chat-composer-upgrade.md`](../../scope/2026-07-25-chat-composer-upgrade/spec-chat-composer-upgrade.md)
>
> Session Queue 来源：[`../../scope/2026-07-31-server-owned-session-queue/spec-server-owned-session-queue.md`](../../scope/2026-07-31-server-owned-session-queue/spec-server-owned-session-queue.md)

## 布局

- composer 为两行结构：输入行（Lexical 富文本输入 + 发送/语音 action column）与工具栏行（左侧触发按钮与状态区、右侧 config 区）。
- 运行中允许继续语音与排队发送，send 始终可用；stop 不占用 send 位置。

## Session Queue 与附件

- Hub `Session` 是 queue 的唯一所有者和调度者。App 只保存 `session.read`、`session.updated` 或操作响应中的 queue projection，不自行 dequeue、drain 或跨 runtime key 移动 item。
- App 对不同 queue generation 整体替换；同 generation 只接受更高 revision。`session.list` 的 queue 摘要只服务于列表展示，打开 Session 后以完整 snapshot 为准。
- 运行中仍允许选择附件。点击发送时先完成现有附件上传并取得服务端 blocks，再以 `session.queue/enqueue` 提交 prompt；上传失败时不创建 queue item。
- Queue UI 展示 queued、running、cancelling、steering 与 failed 状态，并按服务端 snapshot 能力提供 cancel、prioritize、steer 或 retry。Active compact 的 `cancelSupported:false` 必须禁用取消。
- Active item 失败后 queue 暂停并保留后续 waiting items；用户 retry 原 item，或 cancel failed item 后恢复后续调度。
- Waiting/failed item 被取消时不即时删除已上传附件；Session archive/delete 的既有目录清理统一回收。

## Stop 状态 pill

- stop 只在运行中出现，位于工具栏左侧，形态为紧凑状态 pill：状态点 + `Responding` 文本 + 停止符，高度不超过工具栏行高。
- 状态点以弱脉冲表达"进行中"；取消中有明确态；非运行态经退场过渡消失。

## Enter 行为

- 桌面端不区分平台：Enter 发送、Shift+Enter 换行；触发菜单打开时 Enter 优先作用于菜单；输入法 composing 中 Enter 不发送。
- 移动端 Enter 行为由设置项（send / enter）决定。

## 触发菜单（/ 与 @）

- 两个菜单共享同一几何：宽度/内缩、圆角、padding、行高、max-height、active 态与空态样式一致；切换时只有内容变化。
- 桌面端触发菜单采用紧凑高密度布局：菜单高度上限约 420px，并受动态视口高度约束；条目行高为 30–32px，常规视口应能同时浏览约 10–12 项。
- slash 菜单按 Commands / Skills 分组；菜单项显示名不带 `/` 前缀，选中插入后发送文本仍带 `/`。
- Skill 条目在图标和名称后紧接一行浅色 description；description 左对齐、占据剩余行宽并在行尾截断。没有 description 时不显示通用占位文案。
- Agent Session action 可以贡献 slash entry。Goal supported 时 `/goal` 选择后只插入普通文本 `/goal `，不创建 Skill capsule、不立即调用控制 API；发送时仍走既有 Goal action 路径，不作为 prompt/compact queue item。详细语义见 [`../agents/session-capabilities.md`](../agents/session-capabilities.md)。
- 快捷键提示统一在菜单 footer，kbd 样式；不使用顶部提示文本条。
- `@` 菜单行内预览按钮默认隐藏，hover / 键盘 active 行显示。

## 菜单互斥与动画

- composer 全部弹层（slash、file-mention、config 系、context usage、attachment tray）由统一 open-menu state 管理，任意时刻最多一个打开；不再用 `.chat-composer` 状态 class 手调 z-index。
- 弹层必须有进和退场动画（`sl-menu-in` / `sl-menu-exit` + menuExit hook 包装所有关闭路径），退场期间禁止交互，遵循 [visual-language.md](visual-language.md) 的弹层动效约定。
- placeholder 使用 Lexical 官方机制，不手写绝对定位坐标。
