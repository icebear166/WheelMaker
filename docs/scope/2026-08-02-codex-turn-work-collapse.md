> 由 scope skill 于 2026-08-02 生成

# Codex Turn 工作内容折叠

## 目标

WheelMaker 当前在 prompt 完成后继续平铺展示运行期间的 Commentary、Thinking 和 Tool Call。目标是让 `codex` 与 `cx-deepseek` 在运行期间保持现有展示不变；收到 `prompt_done` 后，把最终回答之前的工作内容自动收进一条可展开的顶部折叠栏。最终回答、Diff Artifact、失败信息、重试/Fork/复制/导出等 prompt 完成操作继续显示在折叠栏外。

## 决策

- 仅作用于 Agent Type `codex` 与 `cx-deepseek`；其他 ACP Agent 保持当前展示。
- prompt 运行期间不显示外层折叠栏，Commentary、Thinking、Tool Call 的内容、顺序、局部折叠和流式状态保持当前行为。
- 收到 `prompt_done` 后自动折叠该 prompt 的工作内容。成功、失败、取消和中断都执行折叠。
- 外层折叠状态不持久化。首次完成、切换 Session、重新载入历史后都默认折叠；用户可在当前渲染生命周期内展开/收起。
- 展开后保留现有内容渲染：Commentary 仍是 Markdown，Thinking 仍有自身的单项折叠，连续 Tool Call 仍按现有分组展示。唯一新增元素是内容顶部的外层折叠栏。
- 最终回答不进入折叠区；`prompt_done` 的底部分隔行、模型名、耗时、状态、错误文本、Artifact 和操作按钮也不进入折叠区。
- 顶部折叠栏和底部 `By <model> · <duration>` 同时显示耗时，不删除底部耗时。
- 顶部文案：成功 `Worked for <duration>`；失败 `Failed after <duration>`；取消或中断 `Stopped after <duration>`。时间缺失或非法时只显示 `Worked`、`Failed` 或 `Stopped`，不伪造耗时。
- 折叠栏使用与 Thinking/Tool Group 相同的 28px 中性文本行、Chevron 和现有字体/颜色 Token；不新增强调背景、品牌色、边框卡片或额外动画。
- 搜索、turnIndex 跳转、复制、TTS、Markdown/HTML 导出继续以原始 turns 为数据源；折叠只改变 Display Index。
- Registry Protocol 与 ACP `protocolVersion` 均不升级。

## ACP `_meta` 扩展

使用 ACP 官方 `_meta` 扩展点，不新增顶层 `phase` 字段：

```json
{
  "sessionUpdate": "agent_message_chunk",
  "content": {
    "type": "text",
    "text": "正在检查代码……"
  },
  "_meta": {
    "wm": {
      "messagePhase": "commentary"
    }
  }
}
```

`_meta.wm.messagePhase` 允许值：

```text
commentary
final_answer
```

WheelMaker 的 ACP `SessionUpdate` 以原始 JSON 对象接收并传递完整 `_meta`。进入现有 Session Turn 持久化路径的 update 把完整 `_meta` 写入对应 `param._meta`；不只保存 `wm`，也不删除未知根字段。WheelMaker 只解释 `wm.messagePhase`，未知 metadata 对折叠逻辑无语义影响。

Codex App Server 的 `item/started` / replay `ThreadItem` 带 `item.id` 与 `phase`，但 `item/agentMessage/delta` 只有 `itemId` 与 `delta`。`codexAppProvider` 因此维护当前 turn 的 `(turnId, itemId) -> phase` 映射，把 phase 写入每个对应 delta 的 ACP `_meta`；`item/completed`、turn 完成、取消和 runtime 失败时清理映射。`codex` 与 `cx-deepseek` 共用该适配路径。

## 持久化与消息边界

Session Recorder 完整保存 `_meta`：

```json
{
  "method": "agent_message_chunk",
  "param": {
    "text": "检查完成。",
    "_meta": {
      "wm": {
        "messagePhase": "commentary"
      },
      "thirdParty": {
        "trace": "opaque"
      }
    }
  }
}
```

流式文本只在 method 与完整 `_meta` 都相同时合并。phase 或其他 metadata 改变时，Recorder 完成上一条文本 turn，再创建新 turn，确保 Commentary 与 Final Answer 可独立分类且 metadata 不被覆盖。

工具、计划和用户消息等已有 turn projection 在后续 update 未携带 `_meta` 时保留该 turn 先前的 `_meta`；携带新 `_meta` 时以新的完整对象替换。只改变 metadata 保存，不改变现有内容/状态合并规则。

## 完成后分组

Display Index 按 prompt request 到对应 `prompt_done` 建立完成范围：

1. `prompt_request` / 非 steered `user_message_chunk` 仍独立显示。
2. 若存在显式 `final_answer`，第一条 `final_answer` 及其后的最终回答内容留在折叠区外；之前的 turns 组成工作区。
3. 若没有显式 `final_answer`，最后一条没有 phase 的 assistant message 视为旧历史最终回答；其前内容组成工作区。
4. 若最后一条 assistant message 明确是 `commentary`，则该 prompt 没有最终回答；`prompt_done` 前内容全部进入工作区。这覆盖失败、取消和中断场景。
5. 没有工作内容时不创建空折叠栏。

工作区内部复用完成前已生成的 Display Items，因此 Thinking、Tool Group、Permission/Session 辅助行的顺序和现有渲染不变。折叠项保存完整 sourceIndexes 与 turnIndex 范围，搜索和跳转命中内部任一 turn 时定位到该折叠项。

Recorder 因 phase 边界产生相邻文本 turns 时，运行中的 Display Index 临时把相邻 Commentary + Final Answer 合成为一个可见 assistant item，文本直接拼接，保持当前运行视图没有新增间距。`prompt_done` 到达后改用完成分组：Commentary 进入工作区，Final Answer 独立显示。

## 验收标准

- `codex`、`cx-deepseek` 运行时与当前 UI 一致，不出现外层折叠栏或 phase 造成的额外文本间距。
- 成功完成后默认显示 `Worked for …`；点击展开后，原 Commentary、Thinking、Tool Call 按原顺序和原组件显示，最终回答与底部完成行始终在外。
- 失败显示 `Failed after …`；取消和中断显示 `Stopped after …`。错误文本和 Retry 保持在外。
- 展开状态不跨 Session、归档预览或页面重载保存。
- 顶部与底部都显示同一耗时；缺失时间不显示虚构时长。
- 新历史按 `_meta.wm.messagePhase` 分类；旧历史没有 phase 时，最后一条 assistant message 作为最终回答。
- ACP `_meta` 未知字段能通过 Session Recorder 完整写入/读回；metadata 改变不会被错误并入同一文本 turn。
- `codexAppProvider` 的实时 delta 和 Session Load replay 都携带正确 phase；未知/null phase 不生成 `wm.messagePhase`。
- 其他 Agent Type、复制、TTS、导出、搜索、Artifact、Fork、工具局部折叠和 Thinking 局部折叠无行为回归。
- 不修改 Registry Protocol 或 ACP protocolVersion。

### 测试

- Go Protocol：`_meta` JSON round-trip、`wm.messagePhase` 识别与未知值忽略。
- Go Codex Adapter：`item/started -> delta` phase 关联、commentary/final_answer、清理、replay 和 `cx-deepseek` 共用路径。
- Go Recorder：完整 `_meta` 持久化、相同 metadata 文本合并、不同 metadata 文本分段、旧无 metadata 行为、非文本 turn metadata 保留。
- Web Display Index：运行中相邻 phase 文本合并、成功/失败/取消分组、显式 final、旧历史 fallback、无 final、其他 Agent 不分组、turnIndex/search 范围。
- Web Component：默认折叠、点击展开/收起、三种文案、缺失时长、展开后复用 Thought/Tool 渲染。
- 运行相关 Go 测试、Web Jest、TypeScript typecheck 和 Web build。

## 范围之外

- 把 message phase 提交为 ACP 标准字段。
- 为非 Codex Agent 推断或生成 phase。
- 持久化外层展开状态。
- 删除底部模型/耗时行。
- 改写现有 Thinking 或 Tool Group 的内部交互。
- 改变聊天原始 turns、复制、导出或搜索索引的数据模型。
