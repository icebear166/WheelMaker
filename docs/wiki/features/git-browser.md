> 摘要：本页维护 Workspace 只读 Git 浏览器的 Preview 历史、Diff 标签、桌面状态卡、数据刷新与能力边界。

# Git 浏览器

## 产品边界

Workspace 的 Git 能力是只读浏览器，不恢复旧的顶层 Git 页面，也不提供 stage、commit、checkout、merge、push 等仓库写操作。右侧 Preview 承载提交历史和 Diff；左侧桌面功能栈中的 Git 卡片承载当前分支与工作区改动。

移动端可以在 Preview 中浏览历史和 Diff，但没有独立 Git 页面、Git 状态卡或 Floating Nav 入口。非 Git 项目不显示 Git 入口；已知 Git 项目离线时保留入口和已加载内容，并显示不可用或重试状态。

## Preview 历史与 Diff

Preview 的 Files 与 Git 悬浮按钮共享侧抽屉位置并互斥展开。Git 抽屉不依赖当前 Preview 标签类型：空 Preview、文件、Prompt Diff 和附件状态下都可以打开。

历史默认当前分支，允许筛选或多选本地、远端分支，并以最多 50 条为一批持续加载到末尾。历史使用紧凑纵向时间线，不绘制完整 Git DAG。提交摘要行显示作者、短 SHA 与相对时间：邮箱与绝对时间通过 hover tooltip 呈现，短 SHA 后紧跟复制完整 SHA 的内联按钮。提交展开后显示文件统计和修改文件；HEAD 标记只出现在分支选择器中，且只表达现有数据能够证明的 HEAD 或 ref tip，不推断提交唯一属于某个分支。

文件行（工作区与提交文件共用）与文件树共享行视觉：seti 文件图标、不显示 status 字母列；布局优先保证文件名完整显示，父目录路径先收缩省略，增删统计固定。

提交文件在 Preview 中打开整提交单页 tab：tab 以提交为粒度（`git-diff:commit:<sha>`），一页展示该提交全部文件的 diff，点击抽屉中的文件只是打开/激活该提交的 tab 并滚动定位到对应文件区块，不再按文件新开 tab。工作区文件仍按单文件 tab 打开。来源描述符区分 commit 的 `{sha, path}` 与 worktree 的 `{path, scope}`；标签参与现有 Preview 持久化，但只持久化来源和 UI 状态，正文在 Project 可用后按需读取。

Git Diff 与 Prompt Done Diff 共用统一展示能力，包括增删行、语法高亮、空结果、二进制和截断状态。`gitdiff-parser` 继续按需加载，不进入 Chat 启动模块。

## 桌面状态卡

桌面 Git 卡片复用 `ChatEdgeSurface`，位于左侧功能栈的 Plan 与 Monitor 之间，并遵循完整 Sessions 面板打开时隐藏功能栈的既有规则。卡片首次出现时默认展开；折叠状态只在当前页面生命周期内保留。

收起态显示当前分支和工作区改动总数。展开态按 Staged、Unstaged、Untracked 分组；同一路径的不同 scope 是不同条目，点击后必须读取对应 scope 的 Diff。卡片与 Preview 历史消费同一份按 Project 隔离的 Git 浏览状态。

## 数据与刷新

Git 浏览器复用现有 `project.git.*` Registry 方法，不新增 Git 路由，不修改 protocol version。分支、历史、提交文件、工作区状态和 Diff 都在相关界面首次可见时按需加载，不主动轮询。

共享状态以 `projectId` 隔离。`gitRev` 变化会使分支、历史和提交文件缓存失效；`worktreeRev` 变化只使工作区状态及工作区 Diff 失效。当前可见的工作区 Diff 随 revision 更新，SHA 已固定的历史提交 Diff 不受后续仓库变化影响。手动刷新重新读取 revision 并按变化范围更新；请求失败时保留已成功加载的数据并提供重试。

## 来源

- [只读 Git 浏览器 spec](../../scope/2026-08-03-git-browser/spec-git-browser.md)
