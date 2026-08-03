> 由 scope skill 于 2026-08-03 生成

# 只读 Git 浏览器

## 目标

WheelMaker 曾提供顶层 Git 页面，重做 Workspace 后删除了页面但保留了 Registry Git 读取能力。本次不恢复顶层页面，而是把只读 Git 浏览整合进现有 Chat 工作区：右侧 Preview 负责提交历史和 Diff，左侧桌面浮窗负责当前分支与工作区改动，让用户不离开当前会话即可理解仓库状态和代码变化。

## 决策

- 首版只读，不提供 stage、commit、checkout、merge、push 等写操作。
- Preview 增加与 Files 并列的 Git 悬浮按钮；两个按钮共用同一抽屉位置并互斥展开，而且不受当前 Preview 标签类型限制。
- Git 历史默认查询当前分支，允许切换或多选本地、远端分支；历史分批加载，并可持续加载到所选分支历史末尾。
- 历史使用紧凑纵向时间线，不绘制真实分支/合并 DAG。提交行可展开修改文件和详情；点击文件在 Preview 中打开或复用专用 Git Diff 标签。
- 提交详情包含标题、作者、邮箱、完整时间、完整 SHA、当前筛选及可由现有数据确认的分支引用，以及文件数、增删行统计。不把“提交可从某分支到达”误写成提交唯一属于该分支。
- 左侧新增可折叠 Git 卡片，位于 Monitor 正上方。收起态显示当前分支和改动数量；展开态按 Staged、Unstaged、Untracked 分组列出文件，点击文件打开相应范围的 Diff。
- 移动端保留 Preview 中的历史和 Diff，不新增 Git 浮窗、独立页面或 Floating Nav 入口。
- Git 数据首次打开相关 UI 时按需加载；Hub 上报的 `gitRev` 或 `worktreeRev` 变化时只刷新受影响的数据，同时保留手动刷新，不定时轮询。
- 非 Git 项目隐藏 Git 卡片和 Preview Git 按钮；Git 项目暂时离线时保留入口并显示不可用或重试状态。
- 继续使用现有 `project.git.*` Registry 方法，不修改 protocol version，也不新增 Git 路由。

## 架构

功能由共享 Git 浏览状态、Preview Git 浏览界面、Git Diff 标签和桌面 Git 状态卡四部分组成。共享状态以 Project 为边界，负责 Git 可用性、分支、提交分页、已展开提交的文件、工作区状态、加载错误和 revision 失效；两个 UI 宿主只消费这一份状态，避免各自请求和刷新后出现不一致。

### 共享 Git 浏览状态

- 通过现有 `RegistryWorkspaceService` 调用 `project.git.rev`、`project.git.refs`、`project.git.log`、`project.git.commit.files`、`project.git.commit.fileDiff`、`project.git.status` 和 `project.git.workingTree.fileDiff`。
- 状态按 `projectId` 隔离；项目切换时恢复该项目本轮会话内的分支筛选、分页结果和展开状态，不把一个项目的数据带入另一个项目。
- 提交历史首批最多 50 条，后续显式加载下一批；到达末尾后停止请求。切换分支筛选会建立新的历史查询并取消或忽略旧请求结果。
- 提交文件仅在展开提交时加载并缓存；文件统计由该列表汇总。分支标签只展示当前 HEAD、所选 ref 的 tip 或服务现有数据能够确定的引用，不推测完整的分支包含关系。
- `gitRev` 变化使分支、历史和提交文件缓存失效；`worktreeRev` 变化只使工作区状态及工作区 Diff 失效。失效刷新仅在对应界面已加载或可见时执行。
- 手动刷新重新获取 revision，并据变化范围更新数据；错误保留已成功加载的数据，同时提供明确的重试入口。

### Preview Git 历史抽屉

- Preview 的侧抽屉模式从单一 Files 开关演进为 `closed / files / git`，Files 和 Git 按钮共享现有悬浮工具区及抽屉几何。
- Git 抽屉包含当前分支/分支筛选、刷新、工作区入口、提交时间线、加载更多及加载/空/错误状态。
- 提交行展开后显示提交详情、文件统计和修改文件。文件行显示状态、路径及增删数；二进制文件和被服务端截断的 Diff 必须显示明确状态。
- 点击提交文件或工作区文件后抽屉保持打开，右侧内容区切换到对应 Git Diff 标签；用户可通过 Git 按钮或抽屉外点击主动关闭。

### Git Diff 标签与渲染复用

- Preview Workbench 增加专用 `git-diff` 标签类型。标签源描述符区分 `commit {sha, path}` 与 `worktree {path, scope}`，同一 Project、来源和文件复用同一标签。
- Git Diff 标签参与现有 Preview 标签持久化；恢复时只恢复来源描述符和 UI 状态，内容在对应 Project 可用后按需重新读取。
- Git Diff 与 Prompt Done Diff 共享统一 Diff 展示组件、文件标题、增删行、高亮、空结果、二进制和截断状态；Prompt artifact 的加载与展开状态不与 Git 数据耦合。
- `gitdiff-parser` 继续通过现有 lazy module 加载，Git UI 不得把解析器重新带入 Chat 启动模块。
- revision 变化后，当前可见的工作区 Diff 自动重载；历史提交 Diff 以 SHA 为稳定内容，不因新的提交或工作区变化重载。

### 桌面 Git 状态卡

- 卡片复用 `ChatEdgeSurface` 的标题、折叠、材质和遮挡行为，插入现有左侧功能栈中 Plan 与 Monitor 之间；完整 Sessions 面板打开时遵循现有功能栈隐藏规则。
- 标题区提供分支、总改动数和刷新反馈；正文按 Staged、Unstaged、Untracked 分组，同一路径在不同 scope 中分别保留，确保点击后请求正确的 Diff。
- 卡片只在桌面宽屏渲染，首次出现时默认展开；折叠状态在当前页面生命周期内保留，不新增跨重启偏好。Git 数据仍按 Project 隔离。

## 流程

1. 用户选择 Project；界面先从 Project snapshot 判断在线状态和已知 Git 元数据。
2. Git 卡片或历史抽屉首次可见时，共享状态加载 revision、refs 和所需的 status/history 数据。
3. 用户展开提交时按 SHA 加载文件列表；选择文件后创建或激活 `git-diff` 标签，再按来源读取 commit 或 worktree Diff。
4. Hub 的 Project snapshot 出现新 `gitRev/worktreeRev` 后，共享状态按 revision 范围使缓存失效并刷新已加载界面。
5. 项目被确认不是 Git 仓库时移除入口；项目离线或请求暂时失败时保留 Git 项目的既有内容并展示重试状态。

## 验收标准

- Git 项目的 Preview 同时提供 Files 与 Git 两个互斥抽屉按钮；Git 抽屉可在文件、Prompt Diff、附件和空 Preview 状态下打开。
- 历史默认当前分支，支持本地/远端分支筛选、多选和分批加载至末尾；过期请求不能覆盖新筛选结果。
- 任一提交可展开实用详情和修改文件；统计与文件列表一致，分支信息不作无法由数据证明的归属推断。
- 提交文件和 Staged、Unstaged、Untracked 文件都能在 Preview 打开正确来源的 Diff，并稳定复用对应标签。
- Git Diff 视觉和行渲染复用 Prompt Done Diff 能力；二进制、空 Diff、截断、加载失败均有明确反馈。
- 桌面 Git 卡片位于 Monitor 上方，收起显示分支与总数，展开显示三个 scope 的工作区文件；同一路径的不同 scope 不会混淆。
- 移动端可以从 Preview 浏览 Git 历史和 Diff，但 Floating Nav 中没有新增 Git 入口，也不渲染桌面 Git 卡片。
- `gitRev` 与 `worktreeRev` 分别触发正确范围的刷新，无主动轮询；手动刷新和重试可用。
- 非 Git 项目不显示入口；离线 Git 项目保留入口与已加载内容，并清楚显示不可用状态。
- Chat 启动路径不静态加载 `gitdiff-parser`，现有 File Preview、Prompt Diff、Preview 标签持久化和桌面边缘卡片行为无回归。
- 没有修改 protocol version，也没有加入任何 Git 写操作。

### 测试

- 纯状态测试覆盖工作区文件分组、分支筛选、历史分页合并、Project 隔离、请求竞态、revision 失效和 Diff 标签复用键。
- 组件测试覆盖 Preview 双按钮/互斥抽屉、提交展开与详情、加载更多、错误/空/离线/非 Git 状态、桌面卡片顺序与折叠、移动端入口边界。
- 集成测试覆盖 commit/worktree 文件到 Git Diff 标签的请求参数、可见工作区 Diff 自动刷新，以及统一 Diff 渲染和 parser lazy-load 边界。
- 完成后运行相关前端测试、完整前端测试套件、TypeScript 检查和 Web build；本次不新增 Git 可执行文件级服务端测试，因为服务端路由与执行逻辑不变。

## 范围之外

- Stage、unstage、commit、amend、checkout、switch、merge、rebase、push、pull、fetch 等写入或仓库操作。
- 完整分支/合并 DAG、提交正文、父提交、GPG 签名与 blame。
- 移动端独立 Git 页面、Git 状态卡或 Floating Nav 项。
- 新的 Registry Git 方法、protocol version 变更和服务端 Git 执行链重写。
