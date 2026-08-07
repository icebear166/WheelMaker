# Chat 布局与搜索 UX 迭代（9 点）

> 由 scope skill 于 2026-07-20 生成

## 目标

对 PC 端 chat 界面做一轮布局与搜索 UX 迭代。当前状态：chat 视图宽度存在 `full` / `fixed-800` 两档配置与设置项；会话搜索（Ctrl+F）直接打开覆盖 chat 主区全宽的搜索条并带三向切换器；pin 会话面板时右侧悬浮列缺少顶部 padding；Archived 列表视图被其他层遮挡且归档行布局混乱、不再一条一行；session 搜索框展开方向与 Sessions 标题对齐不符合预期。目标：对话列固定 800px 并彻底移除宽度配置；搜索入口收敛为"每个区域自己的搜索按钮 + Windows 全局 Ctrl+F 模态选择器"；修复 pin 悬浮列、归档视图、session 搜索展开与标题对齐等布局缺陷。

## 决策

- **Q: full width 配置如何处理？** A: 完全删除，不做兼容。`chatViewWidth.ts`（类型/选项/normalize，含 `fixed-560` 旧值迁移）、`WorkspacePersistence` 的 `chatViewWidth` 持久化 key、设置页对应选项全部移除；桌面宽屏固定 800px；旧持久化值不再被读取、自然失效。
- **Q: CHAT 搜索条宽度？** A: 只覆盖 800px 对话列上方，随列居中，不再覆盖 chat 主区全宽。
- **Q: 搜索条切换器？** A: 删除三向切换器。每个区域有自己的搜索入口：chat 标题栏搜索按钮（已有）、sessions 搜索按钮（已有）、preview 若无搜索按钮则在 preview chrome 补一个。
- **Q: Ctrl+F 新行为的平台范围？** A: 仅 Windows。移除全局 keydown 与各窗口（workbench）局部 Ctrl+F 监听；Windows 上全局监听 Ctrl+F，在聊天区居中弹出模态窗，列三个搜索目标（当前会话 / 所有会话 / 文件预览），↑/↓ 或 Tab/Shift+Tab 循环切换，Enter 进入对应目标搜索栏（目标未展开则自动展开），Esc 关闭。非 Windows（Mac/Linux/浏览器/移动端）不拦截 Ctrl/Cmd+F，走系统或浏览器原生查找。
- **Q: 模态窗目标不可用时？** A: 文件预览目标在无 preview 内容时禁用（与旧切换器 `disabled={!chatPreviewOpen}` 一致）；选中 Enter 时：当前会话直接开搜索条；所有会话打开 session 搜索输入并聚焦；文件预览未展开则先展开 preview 再开其搜索栏。
- **Q: 点 3 被遮挡的对象？** A: Archived 列表视图（与点 9 同一界面）。预期 archivedMode 下右侧 edge 悬浮列等遮挡层让位或修正叠放层级。
- **Q: pin 态右侧悬浮框指什么？** A: 右侧 edge 悬浮列（最近会话 / Plan / Limits，`.chat-edge-surface-stack`）。pin 会话面板时（`beside-pinned-session-panel`）补与顶部一致的 padding。
- **Q: session 搜索框与 Sessions 标题？** A: 搜索框弹出时向左展开，左边缘与 sidebar 左边框对齐；Sessions 标题在展开模式下文字与左侧对齐。

## 架构

纯前端变更（`app/web`），不动协议与服务端。涉及单元：

- **布局层**：`WorkspaceApp.tsx` 的 `chatMainClassName` 等宽度判断（硬编码 fixed-800）、`chat.css` 的 fixed-800 与 `.chat-edge-surface-stack` 样式。
- **删除对象**：`chat/chatViewWidth.ts`、`WorkspacePersistence.ts` 的 `chatViewWidth` key、`settings/SettingsRootContent.tsx` 对应选项。
- **会话搜索**：`chat/search/useChatSearchController.ts`（不动核心逻辑）与 `WorkspaceApp.tsx` 的 `chatSearchBar` JSX（限宽 800px、删切换器）。
- **搜索入口与模态选择器**：chat 标题栏按钮 / sessions 按钮（已有）+ preview chrome 按钮（缺则补）+ 新增 Windows Ctrl+F 模态选择器（局部 state 持有于 WorkspaceApp；目标循环与可用性判断抽纯函数，如 `chat/search/searchTargetPicker.ts`，便于 Jest 单测）。
- **session header**：session 搜索框展开方向与 Sessions 标题对齐（JSX + CSS）。
- **归档视图**：`renderArchivedSessionRows` 的 markup 与 archived CSS（遮挡层级 + 一条一行布局）。

## 流程

Windows 上 Ctrl+F → 全局 keydown（capture 阶段）拦截 → 打开模态选择器 → ↑/↓/Tab/Shift+Tab 循环移动选中目标 → Enter：关闭模态并打开目标搜索（当前会话 `openChatSearch`；所有会话 `setSessionSearchOpen(true)` 并聚焦；文件预览未展开则先 `toggleChatPreviewFromTitle()` 再 `openPreviewSearch()`，无 preview 内容时目标禁用不可选）→ Esc 关闭模态，不产生副作用。

## 验收标准

- 桌面宽屏 chat 对话列恒为 800px；设置页无视图宽度选项；代码中无 `chatViewWidth` / `ChatViewWidth` 残留引用；旧持久化值被忽略。
- pin 会话面板时，右侧悬浮列与顶部保持一致的 padding。
- Archived 列表视图完整可见、不被任何层遮挡；归档会话行一条一行，标题与操作按钮不折行、不错位；loading / error 态布局不塌。
- session 搜索框弹出时向左展开，左边缘与 sidebar 左边框对齐；Sessions 标题在展开模式下文字左对齐。
- CHAT 搜索条仅覆盖 800px 对话列上方，随列居中。
- 搜索条内无切换器；chat / sessions / preview 各自的搜索按钮均可用。
- Windows：任意焦点状态下 Ctrl+F 弹模态；三目标循环切换正常；Enter 打开对应搜索栏并自动展开目标；Esc 关闭；原各窗口 Ctrl+F 监听已移除。非 Windows：Ctrl/Cmd+F 不被拦截。
- 现有搜索行为不回退：无匹配显示 "No results"、输入即跳首个命中、切会话自动关闭。

### 测试

- 纯函数走 Jest（node 环境）：模态目标循环与禁用逻辑（新增 `searchTargetPicker` 纯函数测试）；更新既有 Ctrl+F 路由断言（`web-chat-file-peek-viewer.test.ts` 等）为模态逻辑；删除/更新视图宽度设置相关测试（如 `web-chat-view-width-settings.test.ts`）。
- UI 接线与布局靠 `npm run tsc:web` + `npm run build:web` + 手动验证兜底；不新增 React 组件测试设施。
- 布局类条目（2/3/4/5/9）以手动验收为准。

## 范围之外

- 移动端布局与搜索行为变更。
- 非 Windows 平台快捷键统一（如 macOS Cmd 系列）。
- 搜索功能增强（正则 / 全词 / 大小写开关），仍不支持。
- 重新引入 800px 以外的宽度档位。
- 模态框视觉体系重设计（复用现有 surface / 按钮 token 即可）。
