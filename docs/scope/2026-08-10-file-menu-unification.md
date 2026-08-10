> 由 scope skill 于 2026-08-10 生成
> 状态：已批准 2026-08-10

# 文件菜单与 Preview 入口统一

## 目标

将 Workspace 中所有文件相关的上下文菜单统一为一个按目标、平台和入口场景生成菜单模型的入口，统一菜单项文案、分组、可见条件和 action dispatch；同时调整 Preview 的跨端入口：PC 只通过 Preview 文件标题/Tab 右键打开菜单，移动端保留右上角 `...` 和文件标题长按，两者打开同一菜单。

## 决策

- 文件菜单模型按 `surface`、目标类型和平台生成，不由各调用方分别维护 JSX 或手工传递 `can*` 布尔值。
- `surface` 支持文件目标菜单、Preview Tab 菜单和文本选区菜单；文本选区只返回 `Copy`，保持与文件动作语义分离。
- 文件动作按以下分组返回，空分组隐藏，分隔线只由实际非空分组生成；默认不显示分组标题：
  - `open`：`Preview`、`Open in VS Code`、`Show in Explorer`
  - `transfer-share-export`：`Download`、`Copy file`、`Share MD/HTML`、`Export as HTML`
  - `path`：`Copy relative path`、`Copy absolute path`
- Preview Tab 可在文件分组之外返回 `Refresh` 等 Tab 专属动作；Relay Tab 的 `Open relay page in browser` 保持为 Tab 专属动作，不进入文件动作目录。
- action ID 与文案分离。Desktop 的 HTML 导出仍可实际把 `.html` 文件放入剪贴板，但跨端统一显示 `Export as HTML`；成功反馈说明实际交付方式。
- `Share MD/HTML` 只对支持的项目内 Markdown/HTML 文件显示；外部文件、附件、Diff 和历史快照不显示。
- 当前普通文件、项目外文件和可解析 Session 附件可以按既有能力显示 Download；Prompt Diff、Git Diff 和历史快照不显示普通文件的 Download、Copy file、Share 或 HTML Export。
- Desktop 只有在受支持的 Desktop bridge 能力存在时显示 VS Code、Explorer 和 `Copy file`；浏览器与 Android 沿用现有 Web/native 交付路径。
- PC Preview 移除右上角 `...` 操作入口；右键被定位的 Preview Tab/文件标题打开统一菜单。
- 移动端保留右上角 `...`，点击时以当前 Preview Tab 为目标打开与长按文件标题完全相同的菜单；长按入口继续保留。
- 普通文件入口继续支持聊天文件链接、已发送附件、Changed Files 单文件行、Preview 文件树、Preview 文件搜索结果和 Quick Open 文件搜索结果；左键行为不改变。

## 架构

新增统一的菜单模型生成边界，输入目标的语义信息、当前 surface 和运行平台，输出分组后的菜单项：

```text
ContextMenuOptions
  ├─ surface: file | preview-tab | selection
  ├─ target: project-file | external-file | attachment | changed-file | preview-tab
  ├─ platform: desktop | browser | android
  └─ state/capabilities: availability, deleted, markdown, bridge and download support
          │
          ▼
ContextMenuModel { groups: MenuGroup[] }
          │
          ├─ shared context-menu renderer
          └─ shared action dispatcher
```

目标输入使用项目文件、项目外文件、Session 附件、Changed File、普通 Preview Tab 和 Diff/历史 Tab 等语义类型。模型内部根据目标和平台计算 action 可见性、禁用状态、短文案和图标；调用方只负责传递目标上下文与处理统一 action ID。

`ChatFileLinkContextMenu` 与 Preview Tab 的手工 action JSX 改为消费同一模型。菜单容器统一处理定位、首项聚焦、键盘方向导航、Escape、外部点击、滚动、窗口尺寸变化和退出动画。文本选区菜单可以使用同一容器，但只返回自己的 `Copy` action。

Preview Chrome 在 Desktop 不再渲染右上角 actions button；Tab 右键保留为菜单入口。Mobile 继续渲染 actions button，并将其目标和返回模型与当前 Tab 长按路径统一。

## 流程

1. 文件链接、文件树、附件、Changed File 或 Quick Open/Preview 搜索结果触发文件目标菜单；Preview Tab 右键、移动端 `...` 或长按触发 Preview Tab 菜单。
2. 入口将目标归一化为统一的 `ContextMenuOptions`，不在展示组件中判断平台能力。
3. 菜单模型按固定分组顺序生成可见 action，过滤空分组并交给统一菜单容器渲染。
4. 用户选择 action 后，统一 dispatcher 按 action ID 调用现有预览、下载、Desktop bridge、HTML 导出、公共分享或路径复制流程。
5. 菜单关闭条件、左键打开 Preview、Changed File 左键打开 Diff、Tab 选择/关闭行为保持现有语义。

## 验收标准

- 所有文件相关入口使用统一菜单模型；不再由聊天文件菜单和 Preview Tab 菜单分别维护 action 列表。
- 菜单分组固定为打开、传出/分享/导出、路径；空分组和多余分隔线不会渲染。
- 所有菜单项使用确认后的短文案，`Share MD/HTML` 与 `Export as HTML` 在 Desktop、浏览器和 Android 之间语义一致。
- Desktop Preview 右上角 `...` 不渲染；右键 Preview Tab/文件标题可以打开对应菜单。
- Mobile Preview 右上角 `...`、文件标题长按打开相同的菜单模型和 action 集合。
- 文件目标菜单按项目内、项目外、附件、Changed File、平台能力和文件状态正确隐藏不适用 action。
- Diff/历史快照不显示普通文件的 Download、Copy file、Share 和 HTML Export。
- Desktop 的 VS Code、Explorer 和文件剪贴板动作继续受现有 bridge 能力和路径边界保护。
- 文件下载、HTML 导出、公共分享、预览、路径复制和 Tab Refresh 的既有业务行为保持不变。
- 菜单继续支持首项聚焦、键盘导航、Escape、外部点击、滚动、窗口尺寸变化和现有退出动画。
- 聊天文件链接、Changed File、附件、文件树、搜索结果和 Quick Open 的左键行为不改变。

### 测试

- 菜单模型单元测试覆盖目标类型、平台、文件状态、action 顺序、分组、空分组过滤、短文案和图标 ID。
- 共享菜单渲染测试覆盖 Desktop、浏览器、Android、项目内/外文件、附件、Changed File 和 Markdown/HTML 条件。
- Preview Chrome 测试覆盖 Desktop 无 actions button、Desktop Tab 右键、Mobile actions button、Mobile 长按以及两者得到相同 action 集合。
- Preview Tab 测试覆盖普通文件、附件、Diff/历史和 Relay Tab 的 action 边界。
- 保留并更新现有文件下载、HTML 导出、公共分享、路径复制、Desktop bridge、键盘导航和菜单关闭测试。
- 运行相关 Jest、TypeScript 检查和 Web 构建验证；不改变 Registry protocol version，不新增服务端协议。

## 范围之外

- 不改变文件左键预览、Changed File 左键 Diff、Tab 选择/关闭和文件树展开行为。
- 不为目录、Git Status/History 文件行或普通终端文本新增文件动作菜单。
- 不把文本选区 Copy、Session 菜单、Terminal Copy 或 Relay 专属动作改造成普通文件 action。
- 不新增文件编辑、删除、重命名、移动、多选或批量操作。
- 不改变 Download、HTML 导出、公共分享和 Desktop 文件 bridge 的底层协议及安全边界。
- 不修改 Registry protocol version。
