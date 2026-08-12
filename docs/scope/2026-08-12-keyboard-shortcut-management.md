> 由 scope skill 于 2026-08-12 生成
> 状态：已批准 2026-08-12

# 快捷键管理

## 目标

把散落在 Workspace 中、只能靠记忆或局部提示发现的键盘操作收敛为一套可查看、可修改且行为一致的应用内快捷键系统，让 PC 用户能在 Settings 中理解当前绑定、即时重绑并获得明确的冲突、环境限制与不可用反馈，同时保持现有操作习惯作为默认值。

## 决策基线

### 需求边界

- 快捷键是 WheelMaker 获得焦点时生效的应用内全局能力，不注册操作系统级全局热键；覆盖 Windows、Linux 与 macOS 的宽屏 PC Workspace，窄屏/移动布局停用受管理快捷键并隐藏设置入口。
- 第一版管理以下八个 Workspace 动作，局部控件的 Enter、Escape、方向键等不纳入：

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

- `Primary` 是平台主修饰键：Windows/Linux 显示并匹配 `Ctrl`，macOS 显示并匹配 `Cmd`。普通键按当前键盘布局产生的字符语义记录与匹配，不按 QWERTY 物理键位固定。
- 每个动作最多保存一个单段组合。允许带修饰键的组合以及 `F1`–`F12` 等非文本功能键；禁止仅修饰键、裸字母、裸数字和裸空格，不支持 `Ctrl+K` 后再按 `Ctrl+F` 一类连续序列。
- 用户可以修改、清除或恢复单项默认绑定；合法且无待处理冲突的修改立即生效并持久化。页面提供经确认后执行的“全部恢复默认”。
- 同一完整组合只能绑定一个动作。录制到已占用组合时显示占用动作，用户只能选择替换原绑定或取消；替换后原动作明确变为未绑定。
- 核心禁用清单阻止保存操作系统切换/安全序列、页面或窗口关闭、页面刷新、开发者工具等高风险组合；其他可能被浏览器抢占的组合允许保存，但必须显示环境警告。现有默认绑定作为兼容例外保留，即使特定平台或浏览器无法把该组合交给页面，也只标记限制而不自动改写默认值。
- Composer、搜索框等文本输入聚焦时，受管理快捷键仍可触发；输入法组合中、快捷键录制中以及局部控件已明确消费的事件不触发 Workspace 动作。
- Settings、确认框等应用模态界面打开时暂停全部受管理快捷键。Keyboard Shortcuts 页的录制控件仍接收录制输入，但不会同时执行对应 Workspace 动作。
- 快捷键匹配成功但动作在当前上下文不可执行时，应用拦截该事件并通过短暂、非模态且可被辅助技术感知的反馈说明原因，例如 Preview 未打开时提示先打开 Preview；不得把按键继续交给浏览器形成第二种行为。
- PC Settings 根页在现有内容之前新增 `Application` 分组及 `Keyboard Shortcuts` 详情入口；该分组在窄屏布局不渲染。若详情页打开期间切换到窄屏布局，退出该详情并回到不含该入口的 Settings 根页。
- Keyboard Shortcuts 详情页使用按 Navigation、Workbench、Search 分组的高密度命令列表。顶部显示命令总数、自定义数量和“全部恢复默认”；每行显示动作名称、简短说明、生效条件和当前键帽组合，并提供录制、清除与恢复默认操作。
- 录制状态以当前行内的实时键帽信号带作为页面唯一强化视觉，逐步呈现已按下的修饰键与主键；Escape 取消本次录制，取消或校验失败均保留旧绑定。页面沿用 WheelMaker Settings 的既有字体、颜色、surface、focus 与 motion token，不制作完整虚拟键盘图，不引入新的视觉体系。
- 移除 Sessions 标题栏旁现有的可见 `Ctrl+1` 提示，不用动态绑定或其他提示替换该位置。其余既有快捷键 tooltip 等提示统一读取当前有效绑定；对应动作未绑定时隐藏快捷键提示，不得继续展示默认值。
- 自定义绑定只保存在当前浏览器或 Desktop WebView 的客户端 Workspace 数据中，不跨设备、账号或 Hub 同步。现有“清除本地数据/登出”语义继续清除这些覆盖项并恢复默认绑定。
- 不新增服务端接口、Desktop 原生桥接、协议字段或 protocol version；不提供多重备用绑定、导入/导出、移动端键盘支持或完整键盘示意图。

### 技术决策

- 建立一个前端快捷键命令注册表，作为八个动作的 ID、分组、用户文案、默认绑定、环境警告元数据和生效条件的唯一来源。React 层为注册表动作提供执行 handler 与当前 availability，展示、匹配、冲突检查和提示不得各自维护硬编码组合。
- 绑定使用规范化的逻辑结构保存：修饰键集合包含抽象的 `primary`，主键使用基于 `KeyboardEvent.key` 规范化后的字符/功能键标识；字母统一大小写、修饰键集合顺序不影响等价性，匹配要求修饰键集合与主键完全一致。平台适配层负责把 `primary` 转换为实际 `Ctrl`/`Meta` 并生成用户可见键帽。
- 用单一 Workspace 键盘路由器接管现有布局、Quick Open、Preview tab 与搜索快捷键监听。事件优先级固定为“录制器 → 局部控件 → Workspace 路由器”；路由器统一检查宽屏、composition、`defaultPrevented`、模态暂停、绑定匹配和 availability，再决定执行、说明不可用或忽略，避免同一按键被多个 effect 重复处理。
- Search Current Context 保留当前基于事件目标/焦点在 Chat 与可搜索 Preview 之间路由的语义；Search Sessions 保留打开 Sessions 搜索的语义。其余动作复用现有 Sessions、Preview、Terminal、Quick Open 与 Preview tab controller，不重新定义这些功能自身的开关、Pin 或搜索状态机。
- 高风险禁用清单与“可能被浏览器占用”警告清单由纯函数集中维护并按平台评估。禁用清单至少覆盖页面刷新、关闭标签/窗口、退出应用、开发者工具与应用/系统切换类组合；默认绑定通过显式兼容来源绕过“禁止保存”校验，但不绕过环境警告。
- 冲突检查基于所有动作的当前有效绑定。替换操作以一次状态变更同时写入新动作的自定义绑定和旧动作的明确空绑定，任何中间渲染都不得出现两个动作同时有效；取消则不改变状态。
- 在 `WorkspacePersistence` 的客户端全局状态中新增快捷键覆盖映射：动作键缺失表示使用注册表默认值，自定义结构表示使用用户绑定，`null` 表示明确未绑定。自定义值与当前默认值相同时删除该覆盖；“全部恢复默认”清空整张覆盖映射。
- 持久化读取执行边界校验：未知动作忽略，非法、损坏或重复覆盖不得进入有效绑定；归一化结果必须确定且无冲突，并尽可能保留未受影响动作的默认值，无法无冲突恢复的动作保持未绑定。旧客户端数据没有该字段时自然使用全部默认值，不引入数据库或协议迁移版本。
- 修改先更新内存中的有效绑定并走现有 `WorkspaceStore` 持久化队列，因此当前页面与所有提示立即同步；持久化失败沿用现有 storage error 通道报告，不写入部分或不可解析的快捷键结构，重新加载时回到最后成功保存的状态。
- Keyboard Shortcuts 作为仅宽屏可到达的 Settings detail 接入现有 Settings 路由与 shell。详情组件只消费注册表快照、录制/修改回调和反馈状态，不拥有 Workspace 动作 handler；Settings 根页、详情页标题、返回行为和窄屏切换继续使用现有 Settings 导航职责。
- 录制、冲突、禁用、警告和不可用反馈都必须有可见文本与适当的 `aria-live`/可访问名称；键帽不是唯一语义载体。录制状态保持清晰的 focus ring，动效只使用既有短促 motion token，并在 `prefers-reduced-motion` 下移除位移而保留状态变化。

## 设计视图

### 系统结构

命令注册表定义“有哪些动作及默认绑定”，持久化覆盖映射定义“当前客户端改了什么”，二者合成无冲突的有效绑定快照。Settings 详情页读取该快照并提交录制意图；Workspace 键盘路由器读取同一快照，根据当前 UI 上下文选择 handler 或不可用原因。所有现有快捷键提示也读取同一快照，因此配置、实际触发与界面文案只有一个事实来源。

### 关键结构

- **命令定义**：稳定 action ID、分组、名称、说明、默认逻辑绑定、生效条件与环境限制说明。
- **绑定覆盖**：`action ID → 自定义逻辑绑定 | null`；缺失项不复制默认值，便于未来调整默认绑定时区分用户选择与产品默认。
- **有效快照**：注册表默认值与已校验覆盖合成的 collision-free 映射，向路由器、Settings 页面及 tooltip 提供查询和格式化能力。
- **执行上下文**：宽屏与平台信息、模态/录制状态、焦点目标，以及每个动作的 handler 和 availability reason；不把 React controller 存入持久化层或静态注册表。
- **录制状态**：仅保存当前 action、候选组合、校验结果和待替换 action；退出录制即清理，不持久化半成品。

### 关键流程

1. 启动时读取客户端快捷键覆盖，校验并与注册表默认值合成有效快照；旧数据直接得到八项默认绑定，损坏或未知项不会破坏整个快捷键系统。
2. 宽屏 Workspace 收到键盘事件后，单一路由器按优先级检查输入法、局部消费、模态/录制状态和完整组合匹配。匹配且可用则拦截并执行；匹配但不可用则拦截并发布原因；没有匹配则不干预事件。
3. 用户从 PC Settings 的 Application 分组进入 Keyboard Shortcuts，按分组浏览动作与当前键帽。点击绑定进入行内录制；Escape 取消，其他候选先经过基础合法性、高风险与环境限制、重复绑定校验。
4. 合法且无冲突的候选立即成为自定义覆盖；有环境限制时带警告保存；有冲突时等待“替换原绑定”或取消，替换确认后新旧两项原子更新。清除写入 `null`，单项恢复删除该 action 的覆盖。
5. 修改后的有效快照立即驱动 Workspace 路由、Settings 键帽和剩余 tooltip。全部恢复默认经确认后清空覆盖；清除本地数据或登出后也回到注册表默认值。

### 预估改动面

- `app/web/src/app/`：扩展或重组现有 `workspaceShortcuts`，建立命令注册表、逻辑绑定规范化/匹配/冲突与环境校验，并把 `WorkspaceApp` 中分散的布局、Preview 与搜索监听接到单一路由和既有动作 handler。
- `app/web/src/settings/`：新增 Keyboard Shortcuts 详情组件，扩展 Settings detail 导航与 bundle；在宽屏根页新增 Application 分组，并处理窄屏不可达与返回行为。
- `app/web/src/workspace/WorkspacePersistence.ts` 及 `WorkspaceStore` 接线：新增并校验客户端全局快捷键覆盖映射，保持旧数据默认兼容和清除本地数据语义。
- `app/web/src/styles/settings.css` 及必要的共享 tooltip/feedback 样式：实现分组命令列表、键帽、行内录制信号带、冲突/警告/不可用状态、focus 和 reduced-motion，沿用既有 token。
- 现有 Sessions 与搜索入口：删除 Sessions 标题栏的内联 `Ctrl+1`，让保留的快捷键 tooltip 从有效快照生成，未绑定时不显示。
- `app/__tests__/` 与相关组件测试：覆盖注册表默认值、平台映射、字符语义、规范化、匹配、禁用/警告、冲突替换、持久化兼容、路由优先级、不可用反馈、Settings 响应式入口和录制交互；更新依赖旧硬编码快捷键或 `Ctrl+1` 标签的断言。
- wiki 目标：新建 `docs/wiki/frontend-interaction/keyboard-shortcuts.md`，记录稳定动作模型、匹配/冲突/持久化与平台边界；更新 `docs/wiki/frontend-interaction/app-menu.md`，把 PC Settings 的 Application 分组和移动端差异纳入现行入口约定。

## 验收

1. Windows/Linux/macOS 宽屏 PC Settings 根页首先显示 Application 分组及 Keyboard Shortcuts 入口；进入后看到按 Navigation、Workbench、Search 分组的八个动作、平台正确的默认键帽、命令总数、自定义数量和全部恢复入口。切换到窄屏后该分组与详情不可达，移动触控入口不受影响。验证：Settings 导航/响应式组件测试与宽窄屏手动检查。
2. 没有自定义数据的 Windows/Linux 使用 `Ctrl` 默认绑定，macOS 使用 `Cmd` 默认绑定；八项动作保持现有 Sessions、Preview、Terminal、Quick Open、Preview tab 与搜索语义。验证：平台参数化注册表/路由测试及三类平台手动或浏览器仿真检查。
3. 点击任一键帽可进入具有清晰焦点和辅助文本的行内录制；修饰键与主键实时显示，Escape 取消并保留旧值，合法组合无需页面级 Save 即立即生效。输入框聚焦时新绑定仍可触发，输入法组合和局部已消费事件不会误触发。验证：录制组件交互测试、事件优先级单测与 Composer/搜索框手动检查。
4. 裸字母、裸数字、裸空格、仅修饰键、连续序列和核心高风险组合不能保存，并显示具体原因；普通浏览器保留组合与无法可靠捕获的默认组合显示环境警告而不被静默改写。验证：校验纯函数参数化测试与录制错误/警告 UI 测试。
5. 录制已占用组合时不会产生重复有效绑定，页面准确指出占用动作；取消保持两项原值，确认替换后新动作获得绑定、旧动作变为未绑定且两者提示同步更新。验证：冲突状态/原子替换单测与组件交互测试。
6. 清除单项后该动作不再触发且相关 tooltip 隐藏；单项恢复回到当前平台默认；全部恢复经确认后清空所有覆盖。刷新或重启客户端后自定义与明确未绑定状态保留，旧版/损坏/未知数据产生确定、无冲突的安全结果，清除本地数据或登出恢复默认。验证：WorkspacePersistence 兼容/清洗/往返测试和刷新手动检查。
7. Settings、确认框或其他应用模态界面打开时，受管理 Workspace 快捷键全部暂停；Keyboard Shortcuts 的录制输入不会执行背景动作。关闭模态后路由恢复。验证：模态 gating 路由测试与 Settings/确认框手动检查。
8. 匹配动作当前不可用时，应用阻止浏览器后续行为并显示短暂、可访问且能指导下一步的原因；可用时只执行一次，不因旧 effect 与新路由并存而重复。验证：availability/dispatch 单测、`preventDefault` 断言与 Preview 未打开场景手动检查。
9. Sessions 标题栏不再显示 `Ctrl+1` 或任何替代快捷键；其余现有快捷键 tooltip 始终展示当前有效绑定，清除后不展示默认残影。验证：对应组件渲染测试、旧字符串断言更新与手动检查。
10. 实现不触及服务端、Desktop 原生热键或 protocol version；快捷键页在深浅主题、键盘操作和 `prefers-reduced-motion` 下保持可用。`npm test`、`npm run tsc:web` 与 `npm run build:web` 均通过，diff 中不存在非预期的 Go/协议改动。验证：前端完整验证、diff 审查与手动可访问性检查。
