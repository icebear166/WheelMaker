> 由 scope skill 于 2026-08-12 生成
> 状态：已批准 2026-08-12

# 全局上下文菜单手势统一

## 目标

将已有自定义上下文菜单的触发手势收敛为一套全局规则：鼠标右键与触摸/触控笔长按指向同一业务菜单，长按过程中不再同时触发浏览器文本选择或原生 callout，并让滚动、短按和嵌套按钮保持可预测；聊天正文、Preview 代码正文与 Terminal 等文本选择场景继续使用原有交互。

## 决策基线

### 需求边界

- 统一范围包括：聊天文件链接、Prompt 附件 chip、Artifact/Changed Files 文件行、Preview 文件树、Preview 文件搜索结果、Quick Open 文件结果、Preview 标签栏 Tab、普通项目 Session、Recent Session 和 Project 标题。
- 鼠标右键立即打开目标现有的自定义菜单；触摸或触控笔在任何布局和设备上长按均打开同一菜单。触发能力按输入设备判断，不按 viewport 或设备名称判断。
- 长按延迟保持 450ms。按下后任一轴移动超过现有 8px 阈值，本次长按永久取消并让位给滚动或拖动；移回起点不重新计时，下一次按下才可重新开始。
- 自定义菜单目标及其标签文本不可选择，并局部屏蔽浏览器原生长按 callout 和默认上下文菜单；该策略不得扩大到周边普通文本。
- 成功提交一次触摸/触控笔长按时发出一次 light haptic；鼠标右键不触发。宿主不支持振动时静默跳过，不显示错误或降级提示。
- 长按成功后只打开一次菜单，并只抑制该次按压产生的关联点击；短按继续执行原动作，滚动取消后不误开菜单或误执行点击。
- 菜单展示保持现状：文件、附件、文件树、文件搜索结果和 Preview Tab 使用按触发坐标定位的菜单；Session 与 Project 在移动布局使用 Sheet、宽屏布局使用 Popover。输入设备只决定触发方式，不改变当前布局对应的菜单宿主。
- Project 标题的菜单内容保持 Project Actions，只包含 `Resume session` 和 `Pin/Unpin`；`New session` 继续由现有 `+` 按钮承担。
- 嵌套操作按钮独占自己的手势。短按正常执行；长按既不打开父目标菜单，也不执行按钮动作。该规则覆盖 Session Unpin、Project Resume/Pin/New、Preview Tab Close 等目标内部操作。
- Session 菜单仅覆盖普通项目 Session 与 Recent Session。Session 搜索结果保持跳转入口，Archived 保持恢复入口，Draft 不增加菜单。
- 聊天正文、Preview 代码正文和 Terminal 文本继续可选择；Preview 选区 Copy 菜单、Terminal 选择/复制、语音按住和 Floating Nav 拖动等专用手势不接入此次统一入口。
- 不改变任何业务菜单的 action 集合、action dispatch、文件左键预览、Session 选择、Project 折叠、Tab 选择/关闭或列表滚动语义。

### 技术决策

- `useContextMenuGesture` 与目标绑定封装成为自定义上下文菜单手势的唯一状态所有者，统一负责鼠标 `contextmenu`、touch/pen 长按计时、8px 移动取消、生命周期清理、重复触发防护、关联点击抑制和长按成功反馈。
- Session 与 Project 删除各自维护的长按 timer、target 和 consume-click 状态，改为消费共享手势入口；现有 Session/Project 菜单状态继续负责菜单内容和 Sheet/Popover 展示，不迁入手势层。
- 共享入口必须区分正常目标与标记过的嵌套操作控件。嵌套控件使用同一按压生命周期判断长按，但只用于隔离父菜单及抑制长按后的按钮 action，不产生上下文菜单或 haptic。
- 浏览器默认行为通过目标局部的共享样式契约与事件取消共同收敛：样式契约覆盖 `user-select`、`-webkit-user-select` 和 `-webkit-touch-callout`，并以足够优先级覆盖聊天正文内部恢复文本选择的通配规则；事件层只在自定义菜单目标上取消 `contextmenu`，不设置页面级禁用。
- touch/pen 检测不在 `pointerdown`/`pointermove` 阶段阻止默认行为，以保留原生滚动；按压结束、取消、离开、超阈值移动、目标切换和组件卸载都必须清理计时与一次性抑制状态。
- 复用现有 light haptic 能力；手势层只在长按真正提交时调用一次。菜单回调失败或目标失效时不得遗留会吞掉后续无关点击的状态。
- 文件菜单模型、SessionMenu、Project Actions 和 Preview 选区/Terminal Copy 的既有职责不变；此次只统一到菜单之前的手势入口和浏览器默认行为。

## 设计视图

### 功能设计

用户在任一纳入范围的目标上右键时，系统阻止浏览器菜单并立即打开该目标原有的业务菜单。用户用触摸或触控笔按下时，目标进入待长按状态；450ms 内保持在 8px 阈值内则提交长按，发出一次轻触觉反馈、打开同一业务菜单并阻止随后关联点击。若用户先移动、抬起、取消或离开目标，则待长按状态结束，菜单不打开；移动超阈值后即使回到起点也不恢复计时。

目标文字自身不进入选择态，也不出现浏览器 callout。该限制只跟随明确的自定义菜单目标，目标旁的聊天正文、代码正文和终端内容仍可照常选取。Session、Project 与文件目标沿用各自当前的菜单内容和布局宿主，因此同一触屏宽屏设备可以通过长按打开宽屏 Popover，移动布局则仍打开 Sheet。

当按压起点位于目标内部的操作按钮时，父目标不参与。短按按钮执行原动作；持续达到长按时长后释放不会执行按钮，也不会弹父菜单。由滚动造成的移动仍优先取消按压判断。

### 技术设计

#### 整体方案

共享上下文菜单手势层接收业务目标和打开回调，输出可绑定到目标元素的统一事件处理器与样式契约。它维护单个 active press，记录 pointer ID、起点、目标和提交状态，并将事件归一为 `mouse contextmenu`、`touch/pen pending`、`committed` 或 `cancelled`。业务组件只把目标标识和现有菜单打开函数交给该层，不再自行组合 timer 与点击消费逻辑。

```text
Mouse contextmenu ───────────────────────────────┐
                                                ├─ shared gesture policy ── target + position ── existing menu owner
Touch/Pen pointerdown ── 450ms / 8px arbitration ┘
                              │
                              ├─ commit: one haptic + open + suppress associated click
                              ├─ move/up/cancel/leave: cancel and preserve scroll/tap
                              └─ nested action: isolate parent; short tap or suppress long hold
```

Session 与 Project 的菜单 owner 仍位于 Workspace/session-list 协作边界：共享手势只返回目标和坐标，owner 根据当前布局选择 Sheet 或 Popover，并继续使用既有 SessionMenu 或 Project Actions 内容。文件类入口继续把目标交给现有统一文件菜单模型。Preview 选区与 Terminal 保持独立事件链。

#### 关键结构

- **目标绑定：** 支持无目标值和带目标值两种绑定，所有绑定共享同一套 pointer/contextmenu 状态机。
- **active press：** 至少包含 pointer ID、起始坐标、业务目标、是否为嵌套操作和提交状态；一次 pointer 序列只能提交一次。
- **目标样式契约：** 明确标识不可选择、禁 callout 的自定义菜单区域；嵌套按钮可继承禁 callout，但必须有独立手势隔离标识。
- **展示适配：** 坐标型菜单使用按下起点或鼠标右键坐标；Session/Project owner 根据现有布局状态决定 Sheet/Popover，不从 pointer type 推断布局。

#### 实现流程

1. 业务目标绑定共享处理器和目标样式契约；带 target 的入口在按下或右键时固定本次目标，避免渲染更新造成串目标。
2. 鼠标 `contextmenu` 路径取消浏览器默认行为、清理同目标待定长按并立即提交一次业务打开；长按成功后产生的后续 `contextmenu` 不得再次打开。
3. touch/pen 主按键路径启动 450ms timer，但不阻止 pointer 默认行为。移动任一轴超过 8px、抬起、取消或离开时取消该 pointer 的 timer，且本次 pointer 序列不重新武装。
4. timer 到期时确认 pointer、目标和组件仍有效；普通目标触发一次 haptic 和菜单回调，并标记只吞掉关联点击。无效目标或回调无法打开菜单时完成清理，不影响后续点击。
5. 嵌套操作从按下起即隔离父目标。未达到时长的点击正常冒泡到自身 action；达到时长则仅标记抑制自身关联点击，不触发父菜单或 haptic。
6. Session/Project 入口迁移到共享状态机后删除旧 timer、pointer capture、target ref 和 consume-click 接口；菜单关闭和 action dispatch 继续沿用现有逻辑。
7. 组件卸载、目标切换或菜单被其他入口替换时执行统一清理，避免 timer、目标引用或点击抑制泄漏到下一次操作。

### 预估改动面

- `app/web/src/common/useContextMenuGesture.ts` 及测试：扩展共享状态机、反馈、重复触发和嵌套控件隔离。
- `app/web/src/app/WorkspaceApp.tsx` 与 `app/web/src/chat/sessionlist/`：迁移 Session/Project 手写长按入口，补齐 Project 右键，并保持现有菜单 owner 与布局适配。
- `app/web/src/chat/ChatTurnView.tsx`、`app/web/src/file/FileExplorerTree.tsx`、Preview/Quick Open 文件结果渲染和 `app/web/src/preview/PreviewWorkbenchChrome.tsx`：统一目标样式契约，补齐 Preview Tab Close 的手势隔离。
- `app/web/src/styles/`：增加或归并目标局部的 selection/callout 规则，并确保聊天正文的通配文本选择规则不覆盖菜单目标。
- 相关 Jest/React 测试覆盖共享 hook、文件入口、Session/Project、Preview Tab 和嵌套按钮；执行 Web TypeScript 与构建验证，并安排真实浏览器/WebView 手势检查。
- wiki 目标：新建 `docs/wiki/frontend-interaction/context-menu-gestures.md`，更新 `docs/wiki/frontend-interaction/frontend-interaction.md`、`docs/wiki/features/file-links.md` 与 `docs/wiki/frontend-interaction/session-list.md`。
- 不涉及 Registry protocol、服务端接口、持久化数据、迁移或发布配置。

## 验收

- 纳入范围的每类目标上，鼠标右键均阻止浏览器菜单并只打开一次对应业务菜单；组件测试覆盖目标与菜单回调映射。
- touch 与 pen 在任何 viewport 上保持 450ms 且未超过 8px 时，只打开一次与右键相同的菜单；共享 hook fake-timer 测试覆盖两种 pointer type 和宽/窄布局集成路径。
- touch/pen 长按成功只调用一次 light haptic，鼠标右键和嵌套按钮长按不调用；mock `navigator.vibrate` 验证支持与不支持宿主均无异常。
- 任一轴移动到 9px、pointer up、pointer cancel 或 pointer leave 都取消长按；移动后回到起点并等待也不打开菜单；状态机测试验证菜单、haptic 和点击均无误触发。
- 长按成功后的关联 click 与重复 `contextmenu` 被抑制，但下一次独立短按正常执行；连续手势测试证明抑制状态不泄漏到其他目标。
- Session 与 Recent Session 的右键/长按继续打开同一 SessionMenu；Project 右键/长按只提供 Resume 和 Pin/Unpin；移动布局为 Sheet、宽屏布局为 Popover；组件或集成测试覆盖四种组合。
- Session 搜索、Archived 和 Draft 不获得新菜单入口；现有跳转、恢复和 Draft 操作测试保持通过。
- Session Unpin、Project Resume/Pin/New、Preview Tab Close 短按执行一次；长按不执行 action 且不打开父菜单；逐个组件测试覆盖。
- 自定义菜单目标文字不可选且无原生 callout，而相邻聊天正文、Preview 代码正文和 Terminal 仍可选择并保留原 Copy 行为；样式契约测试结合 Android WebView、移动浏览器和桌面触屏设备人工验证。
- 文件预览、Session 选择、Project 折叠、Tab 选择/关闭和列表滚动的既有短按行为保持；相关现有 Jest 测试、Web TypeScript 检查与 Web 构建全部通过。
