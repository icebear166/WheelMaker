# Handoff: 当前会话搜索（Ctrl+F）

> 生成于 2026-07-20。接手 agent 请先读 spec 与 plan，本文只给状态与注意事项，不重复已写下的设计。

## 一句话状态

需求已 scope 完毕、spec 与实施 plan 均已写好并通过自审，**但 0% 实施**——代码一行未动。下一步是为该功能建 branch 后用 `executing-plans` 逐 task 执行 plan。

## 工件（都是本会话产出，尚未 commit）

- Spec：`docs/scope/2026-07-16-current-session-search/spec-current-session-search.md`
- Plan：`docs/scope/2026-07-16-current-session-search/plan-current-session-search.md`

两个文件都经过自审。设计的全部决策、验收标准、范围边界在 spec；逐步代码在 plan。**接手时先读这两个文件**，不要重新 scope。

## 任务是什么

给 Workspace Web UI（`app/web/src/`）加"在当前会话窗口按 Ctrl+F 搜索会话正文"的纯前端功能。会话列表是虚拟化的（react-virtuoso），右侧 preview 面板已有"文件内搜索"是直接范本。三个核心决策（详见 spec）：

1. **高亮混合**：命中走 turn 级（复用 `chatVirtuosoListRef.scrollToTurnIndex` + `chat-turn-search-highlight`），激活 turn 在可见纯文本上 best-effort 字符级高亮，markdown 内部降级。
2. **Ctrl+F 统一进当前会话搜索**，取代旧的"preview 开着就给 preview"路由；不引入焦点追踪。搜索条上带切换器显式跳到「所有会话 / 文件预览」。
3. **只搜正文**（`prompt_request` / `user_message_chunk` / `agent_message_chunk`），不含思考 / 工具调用。

## 下一步（按顺序）

1. **解决 branch 卫生**（见下方"坑 #1"）——先做，否则会把无关改动混进来。
2. 把 spec + plan 两个文档 commit 到新 branch。
3. 调用 `executing-plans` skill 执行 `plan-current-session-search.md`，逐 task 推进、每个 task 走完它自己的 commit。
4. 全部 task 完成后按项目 `CLAUDE.md` 的 **Completion Gate** 收尾（`git add -A` → `commit` → `push origin <branch>`）。

## 坑 / 注意事项

1. **当前 branch 不对。** 现在停在 `feat/prebuilt-release-deployment`，与本功能无关；且工作树有一处无关的未提交改动 `scripts/release/cli.test.mjs`。直接 `git add -A` 会把 spec/plan 文档和这个无关改动一起带上。建议为 chat 搜索新建 branch（如 `feat/chat-session-search`），并把 `scripts/release/cli.test.mjs` 留在原处。建 branch 前先和用户确认 branch 名。

2. **spec/plan 文档当前未纳入版本控制**（属于上面的同一问题）。它们是工作树里的新文件，别误删。

3. **`WorkspaceApp.tsx` 是 21,860 行的巨型文件**，plan 里的行号是**写时锚点**，执行时若行号漂移要靠给出的上下文代码片段定位（plan 里每个 Modify 步骤都带了 `old_string` 级别的上下文）。文件路径是 `app/web/src/app/WorkspaceApp.tsx`（注意 `web/src/` 下还嵌了一层 `app/`）。

4. **虚拟化导航**：会话列表屏幕外的 turn 没有 DOM。命中导航必须走 `chatVirtuosoListRef.scrollToTurnIndex(i, 'smooth')`（它按 displayIndex 索引滚，虚拟化安全），**不要**用 DOM 查询。plan Task 3/5 已据此设计。

5. **命名冲突**：`SessionSearch*` 这个前缀已被"跨会话标题搜索"占用（`app/web/src/chat/session/sessionSearchState.ts` + WorkspaceApp 里 `sessionSearchOpen` 等一堆 state）。新功能统一用 `chatSearch` 前缀，别撞。

6. **纯函数走 Jest，UI 接线靠 typecheck + build + 手动**。仓库的测试都是 node 环境下的纯函数单测（见 `app/__tests__/web-*.test.ts`），没有 React 组件测试设施。plan Task 2 对 `chatSearchState.ts` 做 TDD；Task 3-5 的 UI 接线用 `npm run tsc:web` + `npm run build:web` + 手动验证兜底，不要硬造组件测试（YAGNI）。

## 验证命令（都在 `app/` 目录跑）

- 测试：`cd app && npm test`
- 类型检查：`cd app && npm run tsc:web`（配置 `app/web/tsconfig.web.json`）
- 生产构建：`cd app && npm run build:web`
- 开发服务器（手动验证用）：`cd app && npm run web`

## 范围之外（spec 明确排除，别在实施时偷偷加）

正则 / 全词 / 大小写开关；把 agent 思考或 tool_call 纳入搜索；字符级高亮在 markdown 内部的完美覆盖（允许降级）；引入焦点路由 / panel-focus 状态追踪；改造现有跨会话搜索或 preview search 本身（只做切换器接入）；引入外部 store。
