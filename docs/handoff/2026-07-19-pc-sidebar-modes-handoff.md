# Handoff: PC 侧边栏模式迭代（浮动态默认 + 同构会话面板）

> 2026-07-19 生成。面向接手 agent：继续 PC Chat 侧边栏/会话面板的验收后迭代。

## 当前状态

- 两轮迭代均已完成并合并到 `main`（远端已推送）：
  - v1 合并 `454b4a01`：浮动态默认、全局会话标题栏、滑出层、800px 连续对齐。
  - v2 合并 `b5bb2ade`（验收反馈修订）：设置+hub 顶部条两态常驻（shell 层浮动）、滑出面板与 pin 面板完全同构、滑入/滑出动画、全局栏去除「Recent Sessions」字样并置顶不随滚动。
- 最新构建已输出到 `~/.wheelmaker/web`（webpack 成功）。用户上次反馈「好像没变」，已提示重启应用/强刷；**等待用户重启后验收确认**，可能有新一轮修订。
- 分支 `feat/pc-sidebar-modes` 与 `feat/pc-sidebar-modes-v2` 均已删除。

## 关键参考（不要重复内容，直接读）

- spec：`docs/scope/2026-07-19-pc-sidebar-modes/spec-pc-sidebar-modes.md`（v1 决策；v2 修订见下，spec 未回填，以 wiki 为准）
- plan：`docs/scope/2026-07-19-pc-sidebar-modes/plan-pc-sidebar-modes.md`（10 个 Task，已全执行）
- wiki（当前行为的事实来源）：`docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md`

## 架构要点（代码锚点）

- `app/web/src/chat/ChatSessionGlobalBar.tsx`：会话面板标题栏组件，`title` 可选（PC 端不传），props 控制按钮矩阵（全部session/pin/trailing=搜索+archive）。
- `app/web/src/shell/ResponsiveShell.tsx`：`desktopTopBar` prop，渲染在 `.desktop-shell` 内（position:relative），浮于左上，两态常驻。
- `app/web/src/app/WorkspaceApp.tsx`：
  - `desktopTopBar` 节点定义在 `desktopWindowControls` 附近（≈21956 行），条件 `isWide && tab==='chat' && !sidebarSettingsOpen`。
  - pin 态侧边栏头部 = `chat-sidebar-top-spacer` + `ChatSessionGlobalBar`（在 `.sidebar-scroll` 之外，renderSidebar 内）。
  - 滑出层 JSX 在 chat-edge-surface-stack 之后：常挂载 + `.open` class 驱动 `translateX` 动画（180ms），pointerLeave 触发 `requestClose`（抑制逻辑见下）。
  - `renderRecentSessionsSection`：桌面端无分组头部；移动端保留原行（移动端完全未动）。
  - `renderWideProjectSessionNav(options?: { includeRecent?: boolean })`：滑出层与 pin 侧边栏共用（滑出层传默认值含 recent）。
- `app/web/src/chat/session/sessionNavSlideOutState.ts`：滑出 open/scrollTop 状态机 + 关闭抑制（搜索聚焦/菜单打开/指针按下）。
- `app/web/src/chat/layout/fixedChatAlignment.ts`：800px 三段连续 margin 纯函数；CSS 镜像在 `chat.css` 的 `.chat-view-width-fixed-800-edge-surfaces`（旧 `-pinned-recent` 类已删除）。
- 浮动面板堆栈：`.chat-edge-surface-stack` 两态都渲染（`isWide && tab==='chat'`），浮动态加 `below-top-bar`（top:56px 避开顶部条）。

## 验证命令（工作目录 `app/`）

- `npx jest`：基线 1051 通过 / **2 个既有失败**（`__tests__/web-settings-navigation.test.ts`、`__tests__/web-chat-turn-rendering.test.ts`，干净树上同样失败，与本工作无关，未修）。
- `npm run tsc:web`：0 error（tsconfig `types` 已补 `"jest"`，修复了原有 26 个基线错误）。
- `npm run build:web`：成功，产物到 `~/.wheelmaker/web`。

## 注意事项

- `app/__tests__/` 有大量**源码字符串断言**的回归测试：改 `WorkspaceApp.tsx` 结构/类名后必须同步更新这些测试（本轮已多次同步，模式：先跑 jest 看 FAIL，再改断言）。
- Completion Gate（CLAUDE.md）：最终交付前 `git add -A && git commit && git push origin <branch>`。
- 工作流：用户习惯「特性分支实现 → 用户验收 → 合 main 删分支」。
- 待办风险项：plan Task 9 Step 4 的浏览器冒烟 checklist 从未人工执行完；若用户报 UI 问题，优先怀疑 `chat-top-title-overlay` 宽度（360px）在窄侧边栏（320px）下的溢出、以及滑出层与 plan/Limits 面板的层级关系。
