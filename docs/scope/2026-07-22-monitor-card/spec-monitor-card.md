> 由 scope skill 于 2026-07-22 生成

# Monitor card

## 目标

将桌面端独立的 Limits 与 Model efficiency 卡片合并为一张更紧凑的 `Monitor` 卡片，通过 `Limits` 和 `IQ` 两个 Tab 切换内容。合并只统一展示容器、标题栏交互和显示偏好；Limits 继续使用 HubState，IQ 继续由 Workspace Web 直接读取 CodexRadar，两条数据链路互不依赖。

## 决策

- 桌面只保留一个 `Show Monitor` 设置和一张 `Monitor` 卡片。持久化数据已有新键时以新键为准；缺少新键时，原 `showLimitsMonitor` 或 `showModelEfficiency` 任一为 true，新的 Monitor 即为显示。迁移后只写新键，旧键仅作为兼容读取来源。
- 标题栏在同一行依次容纳折叠入口、`Monitor` 标题、`Limits / IQ` Tab，以及共享的隐藏、Simple/Detail 和刷新按钮；不增加独立 Tab 行。
- 每次创建桌面卡片或打开窄屏弹层都默认选择 `Limits`，Tab 选择不持久化。
- 桌面 Simple/Detail 为 Monitor 级状态，两个 Tab 共用；切换 Tab 不改变模式，初始为 Simple。窄屏不显示模式按钮，两个 Tab 固定使用 Detail。
- 共享刷新按钮同时触发 Limits 与 IQ 刷新。任一数据源刷新时图标旋转，仅当两边都在刷新时禁用；若只有一边正在刷新，点击仍会刷新空闲一边，繁忙一边由原 store 去重。各数据源继续自行保留快照并独立呈现错误，单侧失败不遮蔽另一侧内容。
- 折叠、隐藏作用于整张桌面 Monitor 卡片。折叠后仍显示 Tab 和共享按钮；切换 Tab 不自动展开。
- `Show Monitor` 和标题栏隐藏只控制桌面卡片。窄屏快捷入口始终可用。
- 所有用户入口统一命名为 `Monitor`，两个 Tab 固定命名为 `Limits` 和 `IQ`。
- 移除 CodexRadar 标题栏来源图标，以及桌面和窄屏底部的更新时间/来源状态栏。桌面刷新按钮 tooltip 同时包含 Limits 与 IQ 的最近更新时间；窄屏不另行展示更新时间。

## 架构

新增统一的 Monitor 展示容器，持有 `activeTab`、`collapsed` 和桌面 `detail` 状态，并渲染一套共享标题栏。Limits 与 IQ 只提供可复用的 Simple/Detail 正文，不再各自拥有桌面标题栏、折叠状态或隐藏入口。Workspace 仍负责注入两份快照和两套刷新函数；统一容器只编排展示与操作，不合并 store，也不改变数据类型。

桌面 Workspace 只挂载一个 Monitor surface。窄屏弹层复用相同 Tab 命名和两类 Detail 正文，但保持移动端全屏布局与始终可用的快捷入口。

## 流程

1. Workspace 根据新的 `showMonitor` 偏好决定是否挂载桌面 Monitor。
2. Monitor 初始选择 Limits，并按共享 Simple/Detail 状态渲染对应正文。
3. 用户切换 Tab 时只切换正文；折叠状态、模式和两份数据快照保持不变。
4. 用户点击刷新时，Monitor 同时调用 Limits 和 IQ 的刷新入口；结果分别回写原有 store，并只影响各自 Tab 的状态展示。
5. 用户隐藏 Monitor 时仅关闭桌面显示，可从 `Settings > Chat` 的 `Show Monitor` 恢复；窄屏入口不受影响。

## 验收标准

- 桌面 Chat edge stack 中不再同时出现 Limits 与 Model efficiency 两张卡片，只出现一张标题为 `Monitor` 的卡片。
- `Limits / IQ` Tab 与标题和操作按钮处于同一标题行；默认选中 Limits，重新创建卡片后仍默认 Limits。
- Simple/Detail 按钮切换 Monitor 的共享模式；切换 Tab 后模式不变，两类正文均提供对应模式。
- 刷新按钮一次操作会触发两条刷新链路；任一链路失败时，另一 Tab 的已有或新数据仍可查看。
- 折叠后标题栏仍可切换 Tab、切换模式、刷新和隐藏，切 Tab 不展开正文。
- Settings 仅显示一个 `Show Monitor` 开关；已有用户升级后，只要原任一监控卡片处于开启状态，Monitor 就默认显示。
- 隐藏桌面 Monitor 后，窄屏快捷入口仍存在；窄屏入口、弹层标题和可访问名称均使用 `Monitor`。
- 窄屏打开默认 Limits，两个 Tab 均直接显示 Detail；弹层不显示 Simple/Detail 按钮和底部状态栏。
- Monitor 标题栏不显示 CodexRadar 来源图标，桌面和窄屏均不新增更新时间/来源占位行。
- Limits 的 HubState 所有权、10 分钟调度和跨 Hub 手动刷新不变；IQ 的前端直连、页面内存快照和手动刷新边界不变。

### 测试

- 组件测试覆盖桌面默认 Tab、Tab 切换、共享模式、折叠后操作、双刷新和统一隐藏。
- 集成测试覆盖 Workspace 单卡片挂载、设置项与旧偏好迁移、窄屏入口命名和始终可用行为。
- 窄屏测试覆盖默认 Limits、固定 Detail、双 Tab 切换、共享刷新和无底部状态栏。
- 现有 Limits 数据归并、IQ 候选选择和两套 store 测试继续作为数据行为回归；不新增端到端网络测试。

## 范围之外

- 不合并 Limits 与 IQ 的 store、快照、刷新周期或错误模型。
- 不修改 Hub、Registry、ACP 或协议版本。
- 不增加自动刷新、历史趋势、持久化 IQ 数据或当前模型关联。
- 不新增第三个 Monitor Tab，也不重设计 Limits 或 IQ 正文指标。
