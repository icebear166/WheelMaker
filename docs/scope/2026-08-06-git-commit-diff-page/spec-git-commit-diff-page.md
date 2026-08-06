# 整提交 diff 单页

> 由 scope skill 于 2026-08-06 生成

## 目标

Git 提交文件目前在 Preview 中按"一个文件一个 `git-diff` tab"打开，翻看一个提交要在多个 tab 间切换。本次把 commit diff 改为 prompt-diff 同款形态：一个 tab 展示整个提交的全部文件 diff（`UnifiedDiffPreview` 已支持多文件单页），git 抽屉里点击文件只是打开/激活该提交的 tab 并滚动定位到对应文件区块，不再新开 tab。

## 决策

- **Q：取数方式？** A：新增 registry 方法 `project.git.commit.diff`，一次请求返回整个提交的 diff；用户已明确同意改协议。不做多请求并发 fan-out。该方法是路由表纯增量注册，不变更 protocol version，无兼容性影响（app 与 server 同版本发布，旧 app 不调用该方法）。
- **Q：服务端返回结构？** A：返回 `git show --no-color --unified=N <sha>`（不带路径过滤）的原始输出 `{sha, diff}`；逐文件拆分在客户端用现有 `splitUnifiedDiffFileBlocks` 完成（提交头非 `diff --git` 开头，天然被跳过）。文件的 status/+/- 元数据复用已加载的 `commitFilesBySha[sha]`，按 path 合并。
- **Q：覆盖范围？** A：只改 commit；worktree（staged/unstaged/untracked）文件维持单文件 tab。
- **Q：旧的单文件 commit tab？** A：完全替换。tab id 从 `git-diff:commit:<sha>:<path>` 变为 `git-diff:commit:<sha>`，同一提交只有一个 tab。
- **Q：点击文件行为？** A：打开/激活该提交的 tab、设 `activeFilePath`、滚动到对应 `data-preview-diff-path` 区块；git 抽屉保持打开（既有 drawer 语义）。

## 架构

- **Server**：`registry_methods.go` 注册 `project.git.commit.diff`（`RegistryRouteProjectForward`，同 commit.files）；`reporter.go` 新增 `replyGitCommitDiff`，仿 `replyGitCommitFileDiff` 但无 path 过滤，payload `{sha, contextLines?}`，响应 `{sha, diff}`；复用 `validateGitRevision` 等现有校验。
- **App 数据层**：`registryMethods.ts` 加常量；`RegistryWorkspaceService` 加 `readProjectGitCommitDiff(projectId, sha)`。
- **App 状态层**（`previewWorkbenchState.ts`）：`GitDiffPreviewTab` 的 commit 分支改为 `files: GitDiffPreviewFile[]` + `activeFilePath`（worktree 分支保持单文件）；连带 `previewTabId`、`mergeTab`、`createTab`、tooltip/标题、`resolvePreviewDesktopFilePath`（按 `activeFilePath` 取当前文件）、snapshot 序列化/恢复（对齐 prompt-diff 先例）。文本约定：tab 标题用提交标题（commit title，缺失回退短 sha），tooltip 用完整 sha + 文件数，workbench 头部标题用 `Git diff · <短sha> · N files`。
- **渲染**：`UnifiedDiffPreview` 不变；git-diff 分支从 `files={[tab.file]}` 改为按 commit/worktree 分支传参。
- **加载与跳转**（WorkspaceApp）：commit tab 加载走 `readProjectGitCommitDiff` → 拆分 → 合并元数据；`openGitDiffPreview` 的 commit 分支打开/激活 tab 并设 `activeFilePath`，渲染后滚动到对应文件区块（仿 prompt-diff 搜索跳转的锚点查询）。

## 流程

git 抽屉点击 commit 文件 → `openGitDiffPreview(projectId, {kind:'commit', sha, path}, meta)` → `openPreviewTab` 幂等打开 `git-diff:commit:<sha>` tab 并设 `activeFilePath=path` → 加载 effect 调 `project.git.commit.diff` → 客户端拆分为逐文件块、与 `commitFilesBySha` 元数据合并填充 `files[]` → `UnifiedDiffPreview` 单页渲染 → effect 滚动到 `activeFilePath` 对应区块。再次点击同提交其他文件：tab 已存在 → 仅更新 `activeFilePath` 并滚动。

## 验收标准

- 点击 commit 的任意文件：同一提交只出现一个 tab，tab 标题为提交标题、头部标题为 `Git diff · <短sha> · N files`；再次点击同提交其他文件不新开 tab，而是定位到对应文件区块。
- 整提交所有文件按序单页展示，文件头可折叠/展开，展示 status、+/- 统计；二进制块显示既有提示。
- diff 加载中/失败有既有 loading/error 态；失败重试不重复开 tab。
- tab 关闭后重开、页面刷新从 snapshot 恢复后，按需重新拉取整提交 diff。
- 预览内搜索覆盖整提交全部文件的 diff 内容。
- tab 右键菜单/复制路径等按 `activeFilePath` 对应当前文件生效。
- worktree 文件点击行为不变（仍单文件 tab）；桌面 Git 状态卡行为不变。
- Server：`project.git.commit.diff` 正常返回整提交输出；sha 注入校验用例通过；方法注册清单测试更新。

### 测试

- Server：在现有 `hub_test.go`/`registry_methods_test.go` 内追加——新方法注册清单、sha 注入防护、正常响应结构（沿用现有表驱动模式）。
- App：`previewWorkbenchState` 单测覆盖新 tab id/merge/snapshot；`WorkspaceApp` 相关源码断言同步更新；`splitUnifiedDiffFileBlocks` 已有测试直接复用。
- 不测：滚动定位的像素级行为与视觉，人工验收。

## 范围之外

- worktree 汇总 tab（staged/unstaged/untracked 合并展示）。
- 大提交 diff 的服务端截断/分页（与现状一致不截断，后续再优化）。
- `project.git.diff`（base/head 区间 diff）与 worktree fileDiff 的方法改动。
- protocol version 变更（本方法为纯增量注册）。
