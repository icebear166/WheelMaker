> 由 scope skill 于 2026-08-10 生成
> 状态：已批准 2026-08-10

# 全局搜索 UX 迭代

## 目标

让搜索入口无需二次选择即可到达正确的搜索范围，并让聊天、全局会话和 Preview 搜索在滚动内容、代码块与 Markdown 渲染存在时仍清晰可见；搜索结果、命中高亮、状态反馈和进出场动效统一达到可辨识、可导航的体验。

## 决策基线

### 需求边界

- 桌面端使用平台主修饰键：Windows/Linux 为 `Ctrl`，macOS 为 `Cmd`。
- `Ctrl/Cmd + F` 在聊天区域打开当前会话搜索；当快捷键事件来自 Preview 且当前 Preview 支持文本搜索时，打开当前 Preview 搜索。
- 当快捷键事件来自 Preview、但当前 Preview 不支持文本搜索时，`Ctrl/Cmd + F` 回退打开当前会话搜索；Preview 工具栏搜索入口保持禁用态并表达不可用原因。
- `Ctrl/Cmd + Shift + F` 从任意工作区焦点打开 Sessions 侧栏的全局会话搜索，不再弹出搜索目标选择器。
- 全局会话搜索覆盖所有可见 Project 的活跃会话，不包含 Archived 会话；结果继续在 Sessions 侧栏中展示，不改为独立全局面板。
- 全局搜索框打开后立即聚焦；输入停止约 300ms 后自动执行搜索，不需要确认按钮或额外提交。Enter / Shift+Enter 只在已有结果间前后导航，Esc 关闭并取消当前搜索。
- Preview 工具栏的搜索按钮和搜索框继续保留；聊天标题栏和 Sessions 标题栏的搜索入口继续可用。
- 聊天、Preview 搜索框使用统一 Search HUD：脱离可滚动内容层，拥有独立层级和不透明面板；聊天 HUD 对齐 800px 对话列，Preview HUD 对齐 Preview 内容区域。代码块、Markdown、文件内容滚动和虚拟列表不得覆盖或冲掉搜索框。
- 搜索 HUD 使用明显的焦点边框、active 状态和结果计数；打开和关闭提供短促的滑入/淡入动效，并在 `prefers-reduced-motion` 下降级。
- 当前会话和 Preview 中，所有命中使用较弱的持续高亮，当前命中使用更强的高亮并自动滚动到视口；无结果、不可用和加载状态均有明确文本反馈。
- 全局结果按 Project 分组，结果行显示会话标题、标题命中高亮、命中来源（Title / Prompt）、命中 Turn 和时间；不要求显示匹配文本 snippet。点击结果后跳转到对应会话和命中 Turn。
- 保持现有大小写不敏感、字符串包含匹配和搜索内容边界：当前会话仍搜索用户 Prompt 与 assistant 回复文本，不纳入思考、Tool Call、计划和状态消息；不新增正则、全词或大小写开关。
- 移动端不新增键盘快捷键；现有触控搜索入口保持可用，Search HUD 在窄屏内自适应，不改变移动端导航语义。

### 技术决策

- 纯前端实现，`WorkspaceApp` 继续持有跨区域搜索路由和局部 UI 状态；不引入外部 store，不修改 Registry 协议版本或搜索响应格式。
- 全局快捷键使用工作区级 capture 监听，根据事件目标/当前焦点是否位于 Preview surface 推导路由，不持久化单独的 panel-focus 状态。搜索输入、已打开的搜索 HUD 和 Preview 内部控件必须避免重复处理同一快捷键。
- 删除旧的 Windows 搜索目标选择器接线；`Ctrl/Cmd + F` 与 `Ctrl/Cmd + Shift + F` 直接路由到既有的当前会话、全局会话或 Preview 搜索 controller。
- 全局会话搜索复用既有 `session.search` 的 per-Project 异步查询、轮询、取消和错误隔离；输入 debounce 后取消前一 search，再启动新 query。后端仍只返回既有的 source 与 turnIndex，UI 不依赖 snippet。
- Search HUD 的 DOM 结构必须位于滚动容器之外或由独立的 surface 层托管，使用现有 surface、border、shadow、motion 和 focus token；不得依赖提升 Markdown/code 内容层级来“压住”搜索框。
- 命中导航继续使用现有虚拟列表安全入口和 Preview 行定位机制，不通过查询屏幕外 DOM 来定位虚拟化聊天 turn。

## 设计视图

### 系统结构

工作区级快捷键路由器将快捷键映射为当前会话、全局会话或 Preview 搜索。当前会话和 Preview 使用各自的 Search HUD 与本地匹配/导航 controller；全局会话继续使用 Sessions 侧栏的异步搜索状态和结果 renderer。三类搜索共享 HUD 的视觉语言、状态层级和键盘关闭/导航约定，但不合并搜索数据源。

### 关键结构

- 搜索目标由快捷键上下文直接决定：

  `Ctrl/Cmd+F → Preview（可搜索且焦点在 Preview） | 当前会话（其他情况）`

  `Ctrl/Cmd+Shift+F → Sessions 全局搜索`

- 全局搜索状态继续按 Project 维护结果、完成状态和错误；查询变化通过 debounce 触发新的 searchId，旧 searchId 被取消。
- Search HUD 至少包含：搜索图标、输入框、结果计数/状态、上一命中、下一命中和关闭操作；控件在不可用或无匹配时表达 disabled / empty 状态。

### 关键流程

1. 用户按 `Ctrl/Cmd+F`；路由器检查事件是否来自 Preview 且当前文档可搜索。可搜索则打开并聚焦 Preview HUD，否则打开并聚焦当前会话 HUD。
2. 用户按 `Ctrl/Cmd+Shift+F`；路由器打开 Sessions 搜索 HUD，确保 Sessions 面板可见并聚焦输入框；输入变化经过 debounce 后启动全局查询。
3. 当前会话或 Preview 输入变化后立即计算匹配，激活首个命中并滚动；Enter / Shift+Enter 循环导航，Esc 关闭并清理 query/active state。
4. 全局查询按 Project 返回异步结果；侧栏持续表达搜索进度、结果数和项目级错误。用户点击结果后打开目标会话，导航到 turn，并结束或收起全局搜索状态。
5. 新会话、切换 Preview 文档、关闭搜索或切换工作区时清理不再适用的 query、active match、timer 和 pending request；旧请求不得覆盖新 query 的结果。

### 预估改动面

- `app/web/src/app/WorkspaceApp.tsx`：快捷键直达路由、Preview focus 判断、Search HUD 挂载位置、全局搜索 debounce/cancel 接线和结果状态呈现。
- `app/web/src/chat/search/`：移除旧目标选择器依赖，补充快捷键路由或匹配状态所需的纯函数测试；保留当前会话匹配边界。
- `app/web/src/preview/PreviewWorkbenchChrome.tsx`：保持并配合 Preview 搜索入口和 HUD 宿主层级。
- `app/web/src/styles/chat.css`、`app/web/src/styles/file.css` 及必要的 motion/focus token：统一 HUD 材质、层级、布局、active/empty 状态、进出场动画和 reduced-motion 降级。
- `app/__tests__/`：更新旧目标选择器与快捷键断言，补充快捷键上下文、Preview 不可搜索回退、debounce/cancel 和纯函数结果状态测试。
- wiki 目标：更新 `docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md`、`docs/wiki/frontend-interaction/workbench-chrome.md`、`docs/wiki/frontend-interaction/visual-language.md`，记录已确认的入口、范围、Preview 路由和 HUD 视觉约定。

## 验收

1. 聊天区域按 `Ctrl/Cmd+F` 时直接聚焦当前会话 Search HUD，不出现目标选择器；手动输入聊天搜索按钮仍可用。验证：快捷键路由测试与手动检查。
2. 可搜索 Preview 获得焦点时按 `Ctrl/Cmd+F` 直接聚焦 Preview Search HUD；不可搜索 Preview 获得焦点时回退当前会话，Preview 工具栏保持禁用并显示原因。验证：Preview 各 tab 类型的快捷键手动检查与路由测试。
3. 任意焦点按 `Ctrl/Cmd+Shift+F` 时直接打开 Sessions 侧栏搜索并聚焦；输入后自动查询，Enter 不需要作为提交确认，Esc 能取消进行中的查询。验证：异步状态测试、取消测试与手动检查。
4. 全局结果只包含所有可见 Project 的活跃会话，不包含 Archived；结果按 Project 分组并显示标题命中、source、Turn、时间和加载/错误/空结果状态。验证：结果状态单测和 Archived/多 Project 手动检查。
5. Search HUD 位于滚动内容之外，聊天代码块、Markdown、虚拟列表和 Preview 内容滚动时始终可见；HUD 的 active/focus、结果计数、上一项/下一项和关闭操作清晰可用。验证：桌面宽屏、Preview 打开、窄屏和手动滚动检查。
6. 当前会话与 Preview 的命中导航保持正确：所有命中有弱高亮，当前命中有强高亮并自动滚动；无结果、不可用、搜索中和项目错误均有明确表达。验证：现有搜索测试、Preview 行定位测试与手动检查。
7. 搜索打开/关闭动效使用现有 motion token，`prefers-reduced-motion: reduce` 下不产生位移动画；搜索路由不引入协议变更或外部 store。验证：静态检查、motion 样式测试和构建检查。
8. `npm test`、`npm run tsc:web`、`npm run build:web` 均通过，且不回归既有会话搜索、Preview 搜索、文件树搜索和移动端搜索入口。
