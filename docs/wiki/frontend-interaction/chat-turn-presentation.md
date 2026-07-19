> 摘要：本页维护 Thinking 与连续 Tool Call 在虚拟聊天列表中的折叠、聚合、状态和固定高度规则。

# Chat Turn 展示

> 来源：[`../../scope/2026-07-19-turn-streaming-and-tool-groups/spec-turn-streaming-and-tool-groups.md`](../../scope/2026-07-19-turn-streaming-and-tool-groups/spec-turn-streaming-and-tool-groups.md)

Chat 对话以 raw turns 为源数据，Display Index 负责生成适合 `react-virtuoso` 的轻量显示项。Thinking 对应单个显示项；同一 prompt 内相邻的 `tool_call` turns 聚合为一个显示项，任意非 tool turn 都会切断工具分组。

## Thinking

- 默认折叠，所有折叠状态使用相同的固定单行高度。
- `finished=false` 时显示动态图标和 `Thinking`。用户主动展开后可以查看当前完整内容，后续流式快照不得自动折回。
- `finished=true` 后停止动画，折叠标题显示正文首个非空行的单行预览；完整正文只在展开态显示。
- 标题和预览必须单行省略，流式内容、完成状态和预览变化不能改变折叠高度。
- 使用中性、轻量的文本式样式，不使用蓝色背景或蓝色强调边框。

## Tool Call 分组

- 不提供完全隐藏 tool call 的全局设置；新旧会话都默认显示折叠分组。
- 单个 tool call 也作为一个分组。折叠标题固定为 `Call 1 tool · <last call>` 或 `Call X tools · <last call>`。
- 折叠态始终保留最后一个调用的标题或命令；数量、标题、状态和组内新增调用都不能改变固定单行高度。
- 状态图标取最后一个调用的状态：运行中使用轻量旋转动画，成功和失败使用克制但可区分的状态表达。
- 展开后按 turn 顺序显示组内全部调用的状态、标题或命令和已有简短类型。组内更新或追加调用不能关闭用户已经展开的分组。
- 分组 key 以首个 tool turn 为稳定锚点。搜索或 turnIndex 跳转命中组内任一 turn 时，都定位到该聚合显示项。
- 展开状态只属于当前渲染生命周期，切换 session 后不持久化。

这些规则只组织现有 turn 中的工具标题/命令、类型和状态，不引入工具参数、stdout、diff 或其他 tool result 协议。
