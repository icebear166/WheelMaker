> 由 scope skill 于 2026-06-24 生成

# Unified Preview Workbench

## 目标

当前右侧预览窗口由多套入口和状态拼接而成：文件预览已有 tab workbench，prompt diff、附件和 Port Relay 仍以临时覆盖或独立 placement 的方式打开，导致不同入口有时不共享同一个右侧窗口。目标是把右侧窗口统一成一个按 project 分区的 workbench，所有可预览内容都作为带类型的 tab 打开，并让 PC 右侧 pane 与移动端全屏 overlay 共享同一套状态。

## 决策

- 右侧窗口统一为 workbench，所有内容都是 tab，每个 tab 有明确 `type`。
- 本次 tab 类型包含 `file`、`prompt-diff`、`attachment`、`port-relay`。
- 不接管 Git 页面原来的 diff 逻辑；本次 `diff` 只指 chat 的 `prompt_done` 里点击打开的 prompt diff。
- 同 project 内同一资源只保留一个 tab；重复打开同一 file、prompt diff、attachment 或 Port Relay 资源时，切换到既有 tab 并刷新必要参数。
- workbench 按 project 分区；顶部 project 胶囊切换当前 project 后，只显示该 project 的 tabs。
- 从外部入口打开某个 project 的内容时，workbench 自动切到该 project。
- project 选择器不再使用普通 select，改成参考左侧 chat 区的蓝色胶囊按钮，点击后出现 project 下拉。
- 顶部布局为 close/back、project 胶囊、active tab title、通用操作按钮；project 胶囊右侧紧接 title。
- tab 条中每个 tab 前面显示 type icon，用于区分 file、diff、attachment、Port Relay。
- 文件树入口不放在顶部 toolbar；PC 端在正文区域右上角显示悬浮按钮，点击后文件树向左展开。
- 文件树只在 PC 显示，移动端不显示文件树按钮。
- PC 使用右侧 pane，移动端使用全屏 overlay；两端共享同一套 workbench tabs、active tab 和 project 状态。
- Port Relay 全部统一进入 workbench，包括 chat localhost 链接、设置页入口、浮动按钮入口，不再走独立 main placement。

## 架构

引入统一的 preview workbench 状态层，替代现在文件、prompt diff、attachment、Port Relay 在右侧窗口中的优先级覆盖关系。状态按 project 保存 tabs 与 active tab，每个 tab 保存自己的 type、resource key、title、loading/error 状态和渲染所需 payload。现有文件预览 state 可以迁移为 `file` tab 的 payload；prompt diff、attachment 和 Port Relay 入口改为调用统一的 open-tab API。

### Tab 类型

- `file`：保存 projectId、path、targetLine、content、file info、load request id。
- `prompt-diff`：保存 projectId、sessionId、artifactId、title、diff files、expanded file state、load request id。
- `attachment`：保存 projectId、sessionId、turn/message block identity、title、kind、preview src/meta、load request id。
- `port-relay`：保存 projectId、target hub/port、frame path、resolved frame URL、reload key。

### Workbench Chrome

Workbench chrome 负责统一渲染 close/back、project pill、active title、tab strip、正文容器和 PC 文件树浮层。具体内容 renderer 按 active tab 的 type 分派，不再通过 prompt diff、attachment、Port Relay 的独立优先级决定当前展示内容。

## 流程

- 打开文件：入口解析 projectId 与 path，调用统一 open-tab；同 project 同 path 复用 `file` tab，并按新 targetLine 更新高亮和滚动目标。
- 打开 prompt diff：`prompt_done` artifact 按 projectId、sessionId、artifactId 复用 `prompt-diff` tab，加载或刷新 diff 内容后激活该 tab。
- 打开附件：附件预览入口按 projectId、sessionId 和 block identity 复用 `attachment` tab，加载或刷新预览内容后激活该 tab。
- 打开 Port Relay：所有 Port Relay 打开入口解析 target 与 frame path，按 projectId、hubId、targetPort、framePath 复用 `port-relay` tab，设置 iframe URL 并激活该 tab。
- 切换 project：只切换 workbench 的 active project；tab strip 与 active tab 切到该 project 的状态。若该 project 没有 tabs，保持右侧窗口打开并显示空态。
- 关闭 tab：关闭当前 active tab 时选择邻近 tab；关闭最后一个 tab 后保留右侧窗口空态。

## 验收标准

- 文件、prompt diff、附件、Port Relay 都通过同一个右侧 workbench 打开，并显示在统一 tab 条中。
- 同 project 同资源重复打开不会新增重复 tab。
- 切换 chat 会话不会清空右侧 workbench tabs。
- 顶部 project 控件是胶囊样式，下拉只显示可见 projects，切换后只显示所选 project 的 tabs。
- active tab title 位于 project 胶囊右侧，文件路径不再作为文件树图标放在顶部工具栏。
- 每个 tab 前都有 type icon。
- PC 端文件树按钮悬浮在正文右上角，点击后向左展开；移动端不显示该按钮。
- Port Relay 从 chat localhost 链接、设置页入口、浮动按钮入口打开时，都进入统一 workbench tab。
- 旧 Git 页面及其 diff 选择、加载、渲染逻辑保持原行为。
- 移动端仍以全屏 overlay 展示 workbench，但 tabs、project、active tab 与 PC 使用同一套状态模型。

### 测试

- 覆盖统一 workbench state：按 project 分区、同资源复用、关闭 active tab、关闭最后 tab、跨 project 切换。
- 覆盖入口结构测试：file、prompt diff、attachment、Port Relay 都调用统一 open-tab API。
- 覆盖 Git 边界测试：Git 页面仍保留原 diff state 与渲染路径，不接入 workbench。
- 覆盖 UI 结构测试：project pill、tab type icon、正文悬浮文件树按钮、移动端隐藏文件树按钮。
- 覆盖 Port Relay 结构测试：main placement 不再作为打开目标，所有打开入口进入 workbench。

## 范围之外

- 不移除 Git 主 tab，也不改变 Git changed-file diff 的业务逻辑。
- 不移除移动端 Port Relay 浮动按钮；本次只改变它的打开目标。
- 不做 workbench tabs 的刷新后持久化。
- 不做 tab 拖拽排序、跨 project 移动 tab 或多窗口拆分。
- 不清理历史 workspace project 残留概念。
