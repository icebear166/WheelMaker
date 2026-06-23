> 由 scope skill 于 2026-06-23 生成

# Chat File Preview Workbench

## 目标

当前聊天右侧弹窗的文件预览一次只能承载一个文件，切换来源时容易覆盖上下文；PC 上也缺少在右侧弹窗内直接浏览项目文件树并切换文件的入口。本次要把右侧弹窗中的文件预览扩展成独立的文件预览工作台：支持按 project 分区的文件 tabs、右侧弹窗自己的 project 选择器，以及 PC 内部悬浮可收起文件树。现有 workspace project 切换 UI 是否废弃不纳入本次。

## 决策

- 右侧弹窗只对文件预览增加多 tab。附件预览、prompt diff、port relay 仍保持现有单实例预览逻辑，不进入文件 tabs。
- 同一路径文件再次打开时复用已有 tab；新的行号会更新该 tab 的目标行、滚动定位和高亮，并激活该 tab。
- 切换聊天会话不清空右侧文件 tabs。
- 右侧弹窗增加自己的 project 选择器，不依赖文件页或 Git 页里的 workspace project 选择 UI。
- 右侧文件 tabs 按 project 分区保留。切换右侧 project 后显示该 project 的文件树和 tabs；切回 project 时恢复该 project 的 tabs。
- 右侧 project 选择器只显示当前可见项目列表，复用聊天侧边栏的隐藏项目偏好。
- 从聊天内容中打开文件时，右侧弹窗自动切到该文件所属 project，并激活或新增对应文件 tab。
- 如果聊天文件来源没有携带明确 projectId，则使用当前选中聊天会话的 projectId；仍无法确定时使用右侧工作台当前 active project。
- 当可见项目列表变化且右侧 active project 不再可见时，优先切到当前选中聊天会话的可见 project；否则切到第一个可见 project。
- PC 上右侧弹窗顶部增加文件树按钮。点击后在右侧弹窗内部浮出文件树面板，不挤压文件预览内容；再次点击收起。
- 右侧悬浮文件树的目录展开状态复用现有文件 tab/文件页的目录展开状态。
- 在右侧悬浮文件树点击文件时，在当前右侧 project 下打开或复用 tab，并保持文件树面板打开。
- 每个文件 tab 可关闭。关闭 active tab 后切到邻近 tab；最后一个 tab 关闭后右侧弹窗保留空态，不自动关闭。
- 非文件预览打开时临时占用右侧弹窗区域，但不清空文件 tabs；回到文件预览时已打开的文件 tabs 仍保留。

## 架构

右侧弹窗引入一个独立的文件预览工作台状态，按 projectId 组织：

- `activeProjectId`：右侧工作台当前选择的 project。
- `tabsByProjectId`：每个 project 下的打开文件 tab 列表。
- `activeTabByProjectId`：每个 project 当前激活的文件 tab。
- `treeOpen`：PC 内部悬浮文件树是否展开。

文件 tab 保存路径、目标行、加载状态、文件信息、内容、错误和必要的滚动/高亮状态。文件读取仍通过现有 project-scoped 文件 API 完成，底层 `projectId` 继续作为数据边界；本次不重构全局 project 模型。

## 流程

从聊天打开文件时，系统根据该文件来源解析 projectId。若来源没有明确 projectId，则使用当前选中聊天会话的 projectId；仍无法确定时使用右侧工作台当前 active project。确定 project 后，系统切换右侧工作台的 active project，再在该 project 的 tabs 中按路径查找。存在同路径 tab 时更新目标行并激活；不存在时新增 tab、启动文件读取并激活。文件读取完成后只更新对应 project 和 path 的 tab，避免异步返回覆盖当前其它 tab。

用户在右侧 project 选择器切换 project 时，右侧文件树和 tab strip 切换到对应 project 的状态。该操作不改变现有文件页/Git 页的 workspace project 选择。

PC 用户点击右侧文件树按钮后，文件树作为右侧弹窗内部浮层出现。树使用当前右侧 active project 的目录数据和现有目录展开状态。点击文件会打开或复用当前右侧 active project 下的 tab，文件树保持展开。

附件预览、prompt diff、port relay 打开时继续使用现有单实例预览路径，视觉上替换右侧内容；文件工作台状态保持在内存中。

## 验收标准

- 在聊天中连续打开多个文件后，右侧弹窗显示文件 tabs，并能点击 tab 切换内容。
- 同一 project 下同一路径文件不会创建重复 tab；再次打开会激活已有 tab，并按新的行号定位和高亮。
- 切换聊天会话后，右侧文件 tabs 仍保留。
- 右侧 project 选择器只包含当前可见项目；隐藏项目不出现在选择器里。
- 当前右侧 project 被隐藏或移除后，右侧工作台会切到当前聊天会话的可见 project；没有可用会话 project 时切到第一个可见 project。
- 切换右侧 project 时，tabs 和文件树内容随 project 切换；切回 project 能恢复该 project 已打开的 tabs。
- 从聊天里打开另一个 project 的文件时，右侧 project 自动切换到文件所属 project。
- PC 上文件树按钮能打开和收起内部悬浮文件树；展开时不压缩文件预览区域。
- PC 悬浮文件树点击文件会打开或复用 tab，并保持文件树展开。
- 关闭 active tab 后会切到邻近 tab；关闭最后一个 tab 后显示右侧文件工作台空态，不关闭整个右侧弹窗。
- 右侧文件工作台空态仍显示 project 选择器和 PC 文件树按钮。
- 打开附件、prompt diff 或 port relay 不会创建文件 tab，也不会清空已有文件 tabs。

### 测试

- 覆盖右侧文件 tabs 的新增、复用、关闭、active tab 邻近切换和空态。
- 覆盖 tabs 按 project 分区、右侧 project 切换恢复状态、可见项目过滤。
- 覆盖聊天文件打开时自动切换 project，并按 projectId/path 更新对应 tab，避免异步读文件串台。
- 覆盖 PC 悬浮文件树按钮、文件点击保留浮层、复用目录展开状态的 UI 结构。
- 覆盖非文件预览不进入文件 tabs，且不清空文件工作台状态。

## 范围之外

- 不废弃或重构现有 workspace project 切换 UI。
- 不移除底层 projectId 数据边界和 project-scoped 文件/聊天 API。
- 不把附件预览、prompt diff、port relay 纳入文件 tabs。
- 不做跨页面刷新后的文件 tabs 持久化。
- 不新增独立可拖动浮窗。
