# Turn 流式降频与 Thinking / Tool Call 展示优化

> 由 scope skill 于 2026-07-19 生成

## 目标

当前 Hub 会把连续 thinking chunk 合并为同一个 turn，但每收到一个 chunk 都通过 Registry 重新发送包含全部累计文本的 turn。长 thinking 会因此反复传输越来越大的完整快照。与此同时，Web 端虽然已有 thinking 折叠能力和完全隐藏 tool call 的设置，但进行中/已完成状态表达不清晰，连续工具调用也缺少可展开的聚合展示。本次改动要在不修改协议版本、不丢失最终内容的前提下，降低 thinking 实时更新频率，并把 thinking 与 tool call 调整为适合虚拟滚动的固定高度折叠项。

## 决策

- thinking 首个 chunk 立即发送；同一 thinking turn 的后续实时快照最多每 60 秒发送一次。
- 降频只作用于 Registry `session.message` 实时发布。内存中的 chunk 合并和 prompt 完成时的最终持久化保持完整。
- thinking 结束、切换到任何其他 turn、取消或 prompt 完成时，立即发布最新完整快照并标记为 `finished`，不等待剩余降频窗口。
- 非 thinking turn 保持当前实时发送行为；不同 session 的 thinking 降频状态彼此独立。
- thinking 默认折叠。进行中显示动态图标和 `Thinking`；用户主动展开后可以看到已收到的完整内容及后续更新，更新不得自动折回。
- thinking 完成后，折叠标题显示正文首个非空行的单行预览；展开后显示完整正文。
- thinking 折叠态始终保持固定单行高度。流式更新、完成状态切换、预览内容变化和文本截断都不能改变虚拟列表项的折叠高度。
- thinking 去掉蓝色背景、蓝色边框等强调色，改为中性、轻量的文本式折叠行。
- 移除全局 `Hide Tool Calls` 设置及其持久化读写。旧持久化值不再影响展示，也不要求迁移或修改协议。
- 同一 prompt 内连续相邻的 `tool_call` turn 聚合为一个虚拟列表项；任意非 tool turn 都会结束当前分组。单个 tool call 也使用相同的分组样式。
- tool call 分组默认折叠，折叠态固定单行高度，标题显示 `Call 1 tool · <last call>` 或 `Call X tools · <last call>`。数量、最后调用标题和状态可以更新，但行高不变。
- 折叠标题始终保留最后一个调用，不因分组完成而移除。长标题单行省略，并提供查看完整标题的原生提示。
- tool call 分组的状态图标取最后一个调用的状态：运行中使用轻量旋转动画，成功和失败使用明确但克制的状态表达。
- 展开后逐行显示组内全部工具的状态、标题或命令，以及已有的简短类型。用户展开后，同组继续新增或更新工具时保持展开。
- tool call 分组以首个 tool turn 为稳定锚点；追加同组调用时不能因 key 变化而丢失展开状态。
- 搜索或按 turnIndex 跳转命中组内任一 tool turn 时，定位到该聚合项。切换 session 后不保留展开状态。
- 本次只展示现有 turn 中的工具标题/命令、类型和状态，不新增工具参数、stdout、diff 或其他 tool result 传输。

## 架构

Hub 的 `SessionRecorder` 继续负责合并完整 thinking turn，并在实时发布边界增加按 session 隔离的 thinking 发布调度状态。该状态只决定何时把最新完整快照交给 Registry，不成为内容真相来源；prompt state 与最终 turn 持久化仍是权威数据。

Web 端继续以 raw turns 作为源数据，在 display index 层把连续 tool turns 投影成一个带 turnIndex 范围的聚合项。thinking turn 仍对应单个 display item。渲染层分别维护 thinking 和 tool group 的局部展开状态，并让固定折叠高度与 display index 的高度估算保持一致；展开后的动态高度交给虚拟滚动组件重新测量。

## 流程

### Thinking 实时发送

1. Hub 收到 thinking 首个 chunk，合并到 prompt state，并立即发布当前完整 turn。
2. 同一 turn 的后续 chunk 继续立即合并到内存，但在 60 秒窗口内只更新待发布的最新快照。
3. 降频窗口允许再次发送且存在未发布变化时，发布一次最新完整快照；没有变化时不重复发送。
4. 收到非 thinking turn、取消或 prompt 完成时，先把 thinking 的最新完整内容作为 `finished:true` 立即发布，再处理后续 turn。
5. prompt 完成时仍将完整 turns 持久化，实时发布次数不影响最终存储内容。

### Thinking 展示

1. Web 收到 `finished:false` 的 thinking turn，以固定高度折叠行显示动态图标和 `Thinking`。
2. 用户展开时，在同一项内展示当前完整正文；后续降频快照替换正文但保持展开。
3. Web 收到最终 `finished:true` 快照后停止动画；折叠标题切换为首个非空行预览，固定高度不变。

### Tool call 聚合展示

1. display index 顺序扫描当前 session 的 raw turns，把相邻 `tool_call` 收集为一个 group item，并记录组内 source indexes 与 turnIndex 范围。
2. 折叠渲染只展示数量、最后一个调用的标题和状态，使用固定高度。
3. 展开渲染读取组内全部 raw turns，逐行展示。组内 turn 更新或追加时沿用首个 turn 派生的稳定 key。
4. 遇到任何非 tool turn 后创建新的 tool group；历史会话、实时会话与归档预览使用相同规则。

## 验收标准

- thinking 首个 chunk 会立即产生 Registry 事件。
- thinking 持续高频更新时，同一 session 的中间完整快照发布间隔不短于 60 秒，并且每次发送的是当时最新的完整累计文本。
- 没有新内容时不会为了满足周期而重复发布相同 thinking 快照。
- thinking 被其他 turn 打断、取消或 prompt 完成时，最新完整文本会立即以 `finished:true` 发布，且事件顺序早于后续 turn 或 `prompt_done`。
- 最终读取和持久化得到的 thinking 内容与全部输入 chunk 拼接结果一致，降频不会造成内容缺失。
- 一个 session 的 thinking 降频不会阻塞或延迟另一个 session，也不会改变非 thinking turn 的实时性。
- 流式 thinking 默认折叠并显示 `Thinking` 与动画；主动展开后能查看最新已接收内容且不会自动折回。
- thinking 完成后停止动画，折叠标题显示首个非空行预览，展开内容保持完整。
- thinking 在所有折叠状态下高度一致，长预览被单行省略；样式中不存在蓝色背景或蓝色强调边框。
- `Hide Tool Calls` 不再出现在设置界面，新旧用户都能看到默认折叠的 tool call 分组；历史持久化值不会继续隐藏工具。
- 相邻 tool call 正确聚合，任意非 tool turn 正确切断分组；单个 tool call 显示为 `Call 1 tool`。
- tool group 折叠标题始终包含工具数量与最后一个调用，状态变化、标题变化和新增调用不会改变折叠高度。
- 展开 tool group 能按 turn 顺序显示全部工具；组内实时更新不会关闭已展开的分组。
- 跳转到组内任一 tool turn 都能定位到对应聚合项。
- 历史会话、实时会话和归档预览的 thinking 与 tool group 行为一致。

### 测试

- 在现有 Go `*_test.go` 中使用可控时钟或等价调度切入点，覆盖首包、60 秒窗口、最新快照合并、无变化不发送、边界立即 flush、多 session 隔离、取消和 prompt 完成顺序，以及最终持久化完整性。
- 在现有 Web 测试中覆盖 display index 的 tool 分组、稳定 key、turnIndex 范围与跳转映射、thinking/tool 折叠高度估算、`finished` 状态展示和设置移除。
- 使用组件测试覆盖主动展开、流式更新不折回、tool group 追加不丢展开状态、状态图标和单行标题。
- 使用样式/结构测试验证固定折叠高度、单行省略和蓝色强调样式已移除。
- 不测试或实现工具完整参数、执行输出、diff 查看器以及协议版本升级。

## 范围之外

- Registry 或 ACP protocol version 变更。
- 把 turn 完整快照协议改为增量 delta 协议。
- 对普通 assistant message、plan 或其他 turn 类型降频。
- 工具参数、stdout、stderr、diff 或其他 tool result 的新增采集与展示。
- 跨 session 持久化 thinking 或 tool group 的展开状态。
