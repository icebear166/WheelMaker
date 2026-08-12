> 摘要：本页维护 WheelMaker 以 Git source 为一级对象的 Skills 目录、刷新、安装状态合成和安全操作边界。

# Skills Management

> 来源：[`Skill Source Management spec`](../../scope/2026-08-12-skill-source-management.md)。

WheelMaker 按 Hub-global 和每个 Project scope 分别管理 Skills。页面的一级对象是远端 Git source；每个 source 始终代表一个规范化仓库、一个可修改 ref，以及最近一次成功刷新得到的完整 skill 目录。无法唯一归属到 source 的本地安装归入 `Unmanaged Skills`。

## Source 目录

WheelMaker 使用独立的 version 1 `.skill-source-lock.json` 保存远端目录快照，不向上游 `.skill-lock.json` 或 `skills-lock.json` 添加字段：

- Hub-global：默认 `~/.agents/.skill-source-lock.json`；设置 `XDG_STATE_HOME` 时使用 `$XDG_STATE_HOME/skills/.skill-source-lock.json`。
- Project：`<project>/.skill-source-lock.json`，可随项目 Git 共享。

每个 source 保存创建后不可原地修改的安装地址、用于同 scope 去重的 `sourceKey`、逻辑 ref、固定的 `resolvedCommit`、最后成功刷新时间和完整 `skillList`。每个目录项保存仓库内 `SKILL.md` 路径和整个 skill 目录的确定性 SHA-256；source lock 不保存本机安装状态或本地 hash。

同一 scope 的同一规范化仓库只能有一个 source。更换仓库需要新增 source 并删除旧 source；修改 ref 必须先成功解析候选快照并展示目录 diff，确认后再原子替换。HTTP(S) 地址不得包含 userinfo、token query 或其他内嵌凭据；认证只复用 Hub 进程可用的 Git credential 或 SSH 环境。

## 刷新与展示

页面打开只读取已保存目录和本机安装状态，不访问远端。`Refresh` 会在临时 Git checkout 中把 ref 解析为完整 commit，发现全部有效 skill 并计算目录 hash；只有完整解析、校验和 hash 都成功后，才以 compare-and-swap 原子替换该 source 的快照。

刷新失败保留上次成功目录并显示 `Stale` 与错误。Stale 快照不能用于 Install、Update 或远端删除推断。刷新成功后：

- 新出现的远端项成为未安装 skill。
- 本地仍安装但目录中已不存在的项成为 `Removed upstream`。
- 本地内容与远端 hash 相同为 `Up to date`；任一预期副本缺失或内容不同则可更新。

每个 scope 独立保存客户端本地的 `Show uninstalled skills` 开关，默认关闭。关闭只隐藏普通未安装项；已安装、冲突、Removed upstream、错误和 Pending removal 始终可见。该偏好不写入 source lock，也不随 Project Git 共享。

## 安装状态与冲突

上游原生 lock 和 agent-visible 目录是本机安装事实的所有者。WheelMaker 扫描时实时计算整个本地 skill 目录的 hash，不持久化安装基线，也不判断差异来自本地修改、远端修改还是两者同时发生。

同一 scope 内，一个名称只要同时出现在多个 sources，或与 unmanaged 本地 skill 同名，所有对应 source 行都进入大小写不敏感的冲突状态。冲突行不允许安装、更新、覆盖或逐项卸载；source 级删除仍可用来解除 source-source 冲突。

只有上游原生 lock 而没有 source lock 时，首次 Skills 扫描会幂等迁移可唯一规范化的远端来源，且不改变已安装内容。多地址、多 ref 或不可验证来源不会被猜测归属：歧义项显示 `Needs resolution`，本地目录、`node_modules` 等来源保持 unmanaged。

## 显式操作

裸 Git 地址只创建并刷新 source，不自动安装。直接 skill 地址或包含 `--skill` 的受支持输入会合并到相同 source，并在确认中单独列出将安装的明确名称；不存在、冲突或 ref 不一致时不执行隐式部分安装。

Install、Update 和 Update All 在执行前强制刷新并展示基于新 commit 的预览。确认后，安装适配器使用该 `resolvedCommit`、固定 agents、scope、Project `--copy` 和 `-y` 调用固定版本的上游 `skills` CLI。Update 的确认始终说明会覆盖当前本地目录。

Update All 只处理已经安装、远端仍存在、hash 不同且无冲突的项；不会安装新增项，也不会卸载 Removed upstream。批量操作顺序执行并 best-effort 汇总成功、失败、跳过和冲突，不回滚已经成功的项。Removed upstream 只有用户显式 Uninstall 才会删除。

删除 source 前必须列出并确认其拥有的本地安装。所有卸载成功后才移除 source；失败时保留 source 和逐项结果以便重试。Project source 从 Git 外部删除时不会自动修改本机安装：仍有本地安装的机器显示 `Pending removal`，确认后才执行 best-effort 卸载。

所有会写 source lock、上游 lock 或 agent 目录的动作都进入当前 Hub 唯一的 Skills 异步 operation 生命周期。普通页面 scan 是同步只读操作；Registry protocol version 保持不变。
