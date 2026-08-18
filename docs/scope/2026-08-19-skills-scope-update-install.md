> 由 scope skill 于 2026-08-19 生成
> 状态：已批准 2026-08-19

# Skills Manager Scope Update and Install

## 目标

统一 Skills Manager 中依赖 Git Repo 内容的最新版本获取逻辑，让单个仓库和当前 Scope 都能用一致的 Update、Install 流程；保留仓库级控制，同时增加 Scope 级批量入口，避免安装操作使用过期中央 clone。

## 决策基线

### 需求边界

- 当前 Scope 工具栏增加 `Update` 和 `Install all`，只作用于当前打开的 Global/Project Scope，不跨 Scope 或批量处理其他 Project。
- Repo/source 标题行继续保留 `Update`、`Install all` 和删除操作。
- Skill 行只保留下载和卸载，两个动作位于同一个操作列；不提供 Skill 级 Update。
- `Update` 更新目标 Repo，并同步当前 Scope 已经管理的 Skill；不因上游新增 Skill 自动加入当前 Scope。
- 单个下载和 `Install all` 都必须先把对应 Repo 更新到最新，再执行安装。Scope 级 `Install all` 对当前 Scope 的每个 Repo 执行同样流程。
- Global 按既有链接规则落地，Project 按既有复制规则落地；Global/Project 的 Scope lock 和安装结果继续独立维护。
- 上游删除的已管理 Skill继续按既有 Repo 更新规则自动清理；其他 external/unmanaged Skill 保留。
- Scope 批量操作遇到单个 Repo 失败时继续处理其他 Repo，最终汇总每个 Repo 的成功或失败；失败 Repo 不使用旧内容继续安装。
- Refresh 不再作为用户可见操作；fetch 和切换最新版本成为 Update/Install 的内部步骤。
- 卸载 Skill 和删除 Repo 不读取 Repo 内容，不要求先联网更新。
- 继续只使用 `.skill-source-lock.json` 作为 Scope 状态文件；不创建 `.skill-source-lock.json.lock`。中央 Repo 级 `.locks/<repo>.lock` 继续保留。
- 不恢复旧的嵌套或哈希 Repo 目录兼容逻辑，不改变 Registry protocol version。

### 技术决策

- 在中央 Repo store 中提供一个统一的 latest-repo 入口（实现可命名为 `ensureLatestRepo`），负责：确保 flat working clone 存在、获取远端最新内容、定位远端默认分支、切换到最新 checkout，并读取当前 commit、branch 和发现到的 Skill 列表。
- 所有依赖 Repo 内容的动作——添加/检查 Repo、Update、单个下载和 `Install all`——复用该入口；不同动作只负责后续的 Scope lock 更新、链接/复制和 managed skills 变更。
- “pull 到最新”沿用当前中央 clone 的确定性 Git 语义：获取远端并 checkout 默认分支最新提交，不在用户本地分支上执行不可控 merge；中央 clone dirty/untracked 时失败，不 reset、clean 或 stash。
- Repo latest 入口继续使用 Repo 级跨进程锁；Scope lock 的读改写继续使用现有原子写和版本检查机制，且不增加 sidecar 文件。
- Scope 级动作由服务端异步 operation 编排当前 Scope 的 source 列表，复用 Repo 级处理逻辑，按 source 产生 item result；前端只提交一次 Scope 操作，不自行循环发送多个 Repo 请求。
- 每个 Repo 的 Scope lock 和可回滚目标变更保持事务边界：Project 的复制失败时保留该 Repo 原有 Scope lock 与目标副本；Global 直接链接中央 clone，中央 checkout 更新后内容可能先于 Scope lock 写入可见，Scope lock 写入失败时不回滚中央 clone，而是报告失败并允许下次重试对齐。其他 Repo 可以独立完成。操作结束后重新生成 Skills catalog，反映成功写入的 commit、更新状态和安装状态。

## 设计视图

### 功能设计

Skill 管理界面仍保持 source-first 列表结构。Repo 标题行继续提供单 Repo 的 Update 和 Install all，Scope 工具栏提供当前 Scope 的批量 Update 和 Install all。Skill 列表行只显示下载和卸载操作，两个操作在同一列对齐。

Update 的职责是让 Repo 和当前 Scope 已管理 Skill 跟上最新 Repo 内容，但不把新发现的 Skill 自动纳入 Scope。Install 先更新 Repo，再安装选中的 Skill；Install all 先更新 Repo，再安装该 Repo 的全部发现 Skill。Scope 级 Install all 对 Scope 中每个 Repo 分别执行该流程。

批量操作按 Repo 独立展示结果。某个 Repo 的 Git、链接、复制或 lock 写入失败时，该 Repo 显示失败原因，其他 Repo 继续执行；最终 operation 可以呈现部分成功状态。失败 Repo 不会因为已有旧 checkout 而继续产生新的安装结果。

### 技术设计

#### 整体方案

```text
Scope/Repo UI action
        |
        v
Registry skill operation
        |
        v
Scope orchestrator (one current scope)
        |
        +--> latest-repo helper (clone/fetch/default checkout/read)
        |          |
        |          v
        |     central Repo + Repo lock
        |
        +--> reconcile managed skills
        |          |
        |          +--> Global links
        |          +--> Project copies
        |
        +--> atomic Scope lock update
        |
        +--> catalog reindex + per-Repo operation results
```

Repo 级动作和 Scope 级动作共享同一个 latest-repo 入口。Scope 级 Update 遍历当前 Scope lock 中的 Repo，只执行更新和已有 managed skills 同步；Scope 级 Install all 遍历同一列表，每个 Repo 在 latest checkout 上选择全部 Skill 后执行安装。单个下载使用同一入口，但只选择用户指定的 Skill。

卸载和删除 Repo 直接操作当前 Scope 的链接、副本和 lock，不进入 latest-repo 入口。中央 Repo 不因 Scope 删除而自动删除。

#### 关键结构

- latest-repo 入口返回可供后续流程使用的 checkout 快照，至少包含 source、sourceKey、branch、current commit 和发现到的 Skill 列表。
- `.skill-source-lock.json` 仍是当前 Scope 的 commit、更新时间和 managedSkills 权威来源；远端最新 commit 只通过中央 clone 的 fetched ref 临时比较，不写入 Scope lock。
- Scope operation 结果以 Repo/source 为粒度，能够表达 succeeded、failed 和 partial；错误包含具体 Repo，便于 UI 在批量操作后汇总展示。
- Project 的 Repo 更新与两个目标目录复制保持一个可回滚事务；Global 的链接操作失败时不降级为复制。

#### 实现流程

1. UI 从 Repo 标题行或当前 Scope 工具栏发起 Update、Install 或 Install all。
2. 服务端解析 target 和 source，读取当前 Scope lock，并为每个待处理 Repo 获取 Repo 级锁。
3. latest-repo 入口在 clone 缺失时 clone；否则获取远端、解析默认分支并切换最新 checkout，然后读取最新 Skill 目录。
4. Update 根据 Scope 中已有 managedSkills 生成同步计划；Global 更新链接可见内容，Project 更新对应副本，并在成功后写入新的 current commit。
5. Install 在同一个最新 checkout 上先完成已有 managedSkills 同步，再安装指定 Skill 或全部 Skill，更新 managedSkills 和 current commit。
6. 单个 Repo 失败时回滚该 Repo 可回滚的目标变更和 lock 写入；中央 clone 不回滚，记录 item result，继续处理其他 Repo。Global 如果已通过链接看到中央 clone 的新内容，失败状态由 operation 和后续 catalog 扫描暴露，下一次操作负责重新对齐 Scope lock。
7. 所有 Repo 处理完成后返回聚合 operation 状态；成功或部分成功后重新扫描 catalog，前端显示已写入的 commit、更新状态、安装状态和错误。

### 预估改动面

- `server/internal/hub/tools/`：抽取中央 Repo latest 入口，调整 Repo/Scope Update 与 Install 编排、operation item result 和 catalog 刷新；扩展现有 Go 测试覆盖 clone/fetch/checkout、批量成功与部分失败、Global 链接和 Project 复制事务。
- `app/web/src/registry/`：增加 Scope 级 skill operation 的 payload/repository 方法，保持现有 Repo 级 Update/Install all 调用。
- `app/web/src/app/ChatHubSkillManagement.tsx`、`ChatHubMenu.tsx`、`WorkspaceApp.tsx`：增加 Scope 工具栏动作，保留 Repo 标题行动作，收敛 Skill 行操作列；更新组件和 action 流程测试。
- `docs/wiki/features/skills-management.md`：同步统一 latest-repo、Scope 级 Update/Install all、安装先更新和批量失败汇总等稳定规则。

## 验收

- Repo 标题行仍显示 Update、Install all 和删除；Scope 工具栏显示 Update、Install all；Skill 行只显示下载、卸载且位于同一操作列。
- Repo 缺失时执行 Update、单个下载或 Install all 会 clone 最新 Repo；Repo 已存在时会获取远端并切到最新默认分支 checkout。
- Update 成功后，Scope lock 记录新的 current commit，Global 链接或 Project 已管理副本同步；新发现 Skill 不自动安装。
- 单个下载使用最新 checkout，只安装指定 Skill，并更新对应 Scope lock 的 managedSkills。
- Repo 级 Install all 和 Scope 级 Install all 都先更新 Repo，再安装全部发现 Skill；不会在旧 checkout 上安装。
- Scope 级 Update/Install all 一次处理当前 Scope 的全部 Repo；一个 Repo 失败后其他 Repo 继续，最终 operation 显示部分成功或失败明细。
- Repo 更新、复制、链接或 lock 写入失败时，失败 Repo 不使用旧 Repo 内容继续安装；Project 保留旧 Scope lock 和旧目标副本，Global 的中央 clone 不回滚，可能由现有链接先看到新内容，operation 必须报告失败并支持重试对齐。
- 上游删除的已管理 Skill 按既有规则清理，external/unmanaged Skill 不被删除；Global 链接失败不降级为复制。
- 卸载 Skill 和删除 Repo 不因无法联网而被 latest-repo 更新步骤阻塞。
- 用户界面不再提供 Refresh；代码不创建 `.skill-source-lock.json.lock`，中央 Repo `.locks` 仍正常工作。
- 现有迁移、路径、Scope lock 和 Registry protocol version 约束保持不变；Go 与 Web 相关测试通过。
