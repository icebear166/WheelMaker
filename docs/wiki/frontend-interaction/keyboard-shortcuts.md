> 摘要：本页维护 WheelMaker PC Workspace 快捷键的动作注册、平台语义、客户端覆盖、冲突处理与 Settings 编辑约定。

# Keyboard Shortcuts

WheelMaker 的受管理快捷键是应用获得焦点时生效的 Workspace 级能力，不是操作系统级全局热键。它只在 PC 宽屏布局启用；移动端与窄屏布局不注册这些操作，也不显示快捷键设置入口。

## 命令与默认绑定

快捷键命令注册表是动作身份、分组、文案、默认绑定和生效条件的唯一来源。第一版固定管理八个动作：

| 分组 | 动作 | 默认绑定 |
| --- | --- | --- |
| Navigation | Toggle Sessions | `Primary + 1` |
| Workbench | Toggle Preview | `Primary + 2` |
| Workbench | Toggle Terminal | `Primary + \`` |
| Workbench | Quick Open | `Primary + P` |
| Workbench | Next Preview Tab | `Primary + Tab` |
| Workbench | Previous Preview Tab | `Primary + Shift + Tab` |
| Search | Search Current Context | `Primary + F` |
| Search | Search Sessions | `Primary + Shift + F` |

`Primary` 在 Windows/Linux 上表示 `Ctrl`，在 macOS 上表示 `Cmd`。主键采用当前键盘布局产生的字符语义，不固定到 QWERTY 物理键位。每个动作最多一个单段组合；局部控件的 Enter、Escape、方向键，以及连续 chord 不属于该注册表。

## 生效边界

- Composer 与搜索输入框聚焦时快捷键仍然生效；输入法 composition、局部控件已消费事件和快捷键录制状态不会执行 Workspace 动作。
- Settings、确认框等应用模态界面打开时暂停受管理动作。Keyboard Shortcuts 页仍可在自己的录制控件中捕获候选组合。
- 单一 Workspace capture 路由器读取当前有效绑定，并调用既有 Sessions、Preview、Terminal、Quick Open、Preview tab 与搜索 controller；同一按键不能由多个独立监听器重复处理。
- Search Current Context 根据焦点位于 Chat 或可搜索 Preview 继续选择搜索目标；Search Sessions 继续打开 Sessions 搜索。
- 已匹配但当前不可执行的动作会拦截浏览器后续行为，并通过非模态、可访问反馈说明原因。

## 覆盖、冲突与持久化

客户端只持久化相对注册表默认值的覆盖：动作键缺失表示使用默认值，自定义绑定表示使用该组合，`null` 表示明确未绑定。设置为当前默认值或单项恢复默认会删除覆盖；全部恢复默认会清空覆盖映射。

覆盖只属于当前浏览器或 Desktop WebView，不跨设备、账号或 Hub 同步；清除本地数据与登出会一并清除覆盖并恢复默认。读取时忽略未知或损坏动作，禁止重复有效绑定，旧数据没有覆盖字段时自然得到全部默认值。

录制器禁止裸字母、裸数字、裸空格、仅修饰键和高风险的刷新、关闭、退出、开发者工具或系统切换组合。普通浏览器可能占用的组合可以保存，但显示环境警告；既有默认绑定始终作为兼容值保留。录制到已占用组合时，只有确认替换才会把新动作绑定并把旧动作设为未绑定，取消不会修改任一动作。

## Settings 与提示

PC Settings 的 `Application → Keyboard Shortcuts` 详情页按 Navigation、Workbench、Search 展示命令列表、键帽、生效条件、自定义数量和恢复入口。录制在当前行内完成，以实时键帽信号带表达按下状态；错误、警告与冲突都有可见文本和辅助技术状态反馈。

Sessions 标题栏不显示 `Ctrl+1` 或其他快捷键标签。其他保留快捷键提示的入口从当前有效绑定生成文案，动作未绑定时不显示默认绑定残影。

设计来源：[`2026-08-12-keyboard-shortcut-management.md`](../../scope/2026-08-12-keyboard-shortcut-management.md)
