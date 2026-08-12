> 摘要：本页维护 WheelMaker 自定义上下文菜单的鼠标右键、触摸与触控笔长按、浏览器默认行为和手势仲裁约定。

# 上下文菜单手势

> 来源：[`../../scope/2026-08-12-unified-context-menu-gestures.md`](../../scope/2026-08-12-unified-context-menu-gestures.md)

本页定义打开业务上下文菜单之前的共享手势规则。具体菜单项、平台能力和 action dispatch 仍由文件、Session、Project 等功能页面维护；文本选区 Copy、Terminal 复制和其他业务手势不属于此规则。

## 适用目标

共享规则覆盖已有自定义上下文菜单的非文本目标：聊天文件链接、已发送附件、Artifact/Changed Files 文件行、Preview 文件树与搜索结果、Quick Open 文件结果、Preview 标签栏 Tab、普通项目 Session、Recent Session 和 Project 标题。

Session 搜索结果、Archived、Draft 不因本规则获得菜单。聊天正文、Preview 代码正文和 Terminal 文本保持可选择；Preview 选区 Copy、Terminal 选择/复制、语音按住与 Floating Nav 拖动继续使用各自独立手势。

## 触发与展示

- 鼠标右键立即打开目标的现有业务菜单；触摸或触控笔长按打开同一菜单。触发能力按本次 pointer 类型判断，不按 viewport、设备名称或操作系统判断。
- 长按延迟为 450ms。按下后任一轴移动超过 8px，本次长按永久取消并让位给滚动或拖动；移回起点不恢复计时，下一次按下才重新开始。
- 右键和长按一次只能提交一个菜单。长按提交后，浏览器随后合成的 `contextmenu` 与 click 不得重复打开菜单或执行目标短按 action；下一次独立操作不受影响。
- 成功提交 touch/pen 长按时发出一次 light haptic；鼠标右键不发出。宿主不支持振动时静默跳过。
- 输入设备只决定如何触发，不决定菜单宿主。文件类与 Preview Tab 菜单继续按触发坐标定位；Session 和 Project 在移动布局使用 Sheet，在宽屏布局使用 Popover。

## 浏览器默认行为

自定义菜单目标及其标签文本必须局部禁用文本选择和 WebKit 长按 callout，并接管目标上的浏览器默认上下文菜单。该禁用只跟随明确标记的业务目标，不能扩大到相邻聊天正文、代码正文、Terminal 或整个页面。

touch/pen 待长按阶段不阻止 pointer 默认行为，以保留原生滚动。pointer up、cancel、leave、超阈值移动、目标切换或组件卸载都要结束待定手势并清理一次性抑制状态。

## 嵌套操作

目标内部或相邻操作位中的独立按钮拥有自己的手势，例如 Session Unpin、Project Resume/Pin/New 和 Preview Tab Close：

- 短按只执行按钮自身 action。
- 长按不执行按钮 action，不打开父目标菜单，也不发出 haptic。
- 滚动造成的超阈值移动继续优先取消长按判断。

## 职责边界

共享 Web 手势入口统一维护 timer、移动阈值、pointer 生命周期、目标快照、重复触发防护、关联 click 抑制、light haptic 和目标局部的 selection/callout 样式契约。业务 owner 仍负责目标归一化、菜单项、Sheet/Popover 状态、定位和 action dispatch。
