> 摘要：本页维护 Thinking、连续 Tool Call 与 Codex 已完成工作在虚拟聊天列表中的折叠、聚合、状态和固定高度规则。

# Chat Turn 展示

> 来源：[`../../scope/2026-07-19-turn-streaming-and-tool-groups.md`](../../scope/2026-07-19-turn-streaming-and-tool-groups.md)
>
> 来源：[`../../scope/2026-08-02-codex-turn-work-collapse.md`](../../scope/2026-08-02-codex-turn-work-collapse.md)

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

## Completed Work

- 新实时 Session 只在 `sessionFeatures.messageLifecycle.version=1` 时启用；旧 WMT2 缺少该字段时，仅为历史 `codex` 与 `cx-deepseek` 保留展示回退。prompt 运行期间保持原有流式界面。
- message phase 通过 ACP 官方扩展点 `_meta.wm.messagePhase` 传递；同一 `messageId` 的 item completed 标记通过 `_meta.wm.messageComplete=true` 权威完成原消息。Session Recorder 完整保存并深合并 `_meta`，phase 只识别 `commentary` 与 `final_answer`。
- prompt 完成后，final answer 之前的 commentary、thinking、tool call 等工作自动收进 28px 中性单行。成功、失败、停止分别显示 `Worked for …`、`Failed after …`、`Stopped after …`。
- final answer 与 `prompt_done` 的耗时、错误、产物、复制、重试等现有内容保持在折叠组外。顶部和底部都显示耗时。
- 旧历史没有 phase 时，`prompt_done` 前最后一条 assistant message 视为 final answer；此前工作折叠。若最后一条明确为 commentary，则没有 final answer。
- 展开后复用原有 turn 与 tool group 组件及顺序，只新增顶部折叠栏。展开状态仅属于当前渲染生命周期；重载或切换 session 后默认折叠。

## Completed Work 与 Changed Files

- Completed Work 使用中性、轻量的单行折叠栏：显示耗时标签和右向 chevron，使用底部分隔线与后续回答内容建立层级；点击后展开原有工作内容。
- Prompt 完成产生 Changed Files 时，列表默认只展示前 3 个文件；剩余文件通过 `Show N more files` 操作展开，再次操作可收起。文件行仍可单独打开对应 diff，摘要操作仍打开完整 diff。
- 聊天 Markdown 的 blockquote 使用左侧竖线、低对比度底色、内边距和轻微圆角表达引用层级，不改变 Markdown 源文本或复制内容。

## 搜索与折叠工作组

> 来源：当前产品确认（2026-08-12）

- Chat 搜索继续统计折叠工作组内部的可搜索 assistant 正文，不因当前折叠状态减少结果。
- 当前选中的搜索结果位于折叠工作组内时，自动展开该工作组，然后再滚动到结果并应用当前匹配高亮。
- 结果切换到另一个折叠工作组时，只自动展开新的当前结果所在组；未选中的工作组保持原有折叠状态。
- 搜索关闭后，当前搜索过程中为最后一个结果自动展开的工作组保持展开；重载或切换 Session 后仍按默认折叠状态开始。

协议与持久化边界见 [`../../scope/2026-08-02-acp-extension-boundary-v27.md`](../../scope/2026-08-02-acp-extension-boundary-v27.md)。
