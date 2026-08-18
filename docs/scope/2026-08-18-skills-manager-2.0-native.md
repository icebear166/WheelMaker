> 摘要：本 spec 定义 WheelMaker Skills Manager 2.0 的 native Git Repo 管理、Scope lock、Global 链接、Project 副本、Repo 级更新和服务端 action 重构。

> 状态：已批准 2026-08-18

# Skills Manager 2.0 Native Management

## 背景

当前 Skills 管理器是混合实现：

- WheelMaker 自己负责 source 解析、Git checkout、目录发现、source catalog、详情读取和安全路径检查。
- 扫描、安装和部分更新仍依赖固定版本 skills@1.5.18。
- skills CLI 缺失时服务端检查 Node 22、尝试 npm 全局安装，并回退到 npx。
- 卸载和部分状态合成已经由 WheelMaker 直接处理。

本次迭代的目标是完全移除 Node/npm/npx/skills CLI 运行时依赖，以 WheelMaker 自己的 Git 和 filesystem manager 作为唯一管理实现，同时保留当前 source-first UI 和 HubState 集成。

## 已确认范围

### 功能范围

- 只管理 Codex 和 Claude。
- 只管理 Global 的 ~/.agents/skills、~/.claude/skills，以及 Project 的 <project>/.agents/skills、<project>/.claude/skills。
- OpenCode、Copilot、Mimo、CodeBuddy、Qoder 及其他 Provider 不纳入 2.0。
- 只支持远端 Git Repo，默认跟随远端默认分支。
- 不支持 Tag、Commit、Local path、Skill 子路径或逻辑 ref。
- Repo Skill 发现只扫描 clone 根目录下的 skills/ 子树；不扫描 Repo 根目录、.agents/skills、.claude/skills 或其他自定义目录。
- Repo 是刷新、更新和删除的一级对象。
- Skill 仍可选择安装，但不支持 Skill 级更新。
- Refresh、Update、Install 和 Install all 都是当前 Scope 的独立操作；一个 Scope 不自动触发其他 Scope 的 operation。

### 文件与存储

中央目录：

~~~text
~/.wheelmaker/skills/
├─ .skill-source-lock.json
└─ <source-key>/
   ├─ .git/
   └─ skills/
~~~

- 每个 Git source 只保留一份 working clone。
- 不维护 snapshot、worktree 或版本目录。
- 中央 clone 不自动删除。
- Global 使用中央 clone 中 Skill 目录的链接。
- Project 从中央 clone 复制 Skill 目录。
- Project 的 Skill 副本和 .skill-source-lock.json 纳入项目 Git。
- 中央 clone 是 WheelMaker 管理的工作副本；不支持用户在其中维护修改。

### Scope lock

继续更新现有 .skill-source-lock.json，不创建新的 skill.json。

Global：

~~~text
~/.wheelmaker/skills/.skill-source-lock.json
~~~

Project：

~~~text
<project>/.skill-source-lock.json
~~~

建议 schema：

~~~json
{
  "version": 3,
  "sources": [
    {
      "source": "https://github.com/example/skills",
      "sourceKey": "example-skills",
      "branch": "main",
      "commit": "abc123",
      "updatedAt": "2026-08-18T12:00:00Z",
      "managedSkills": ["skill-a", "skill-b"]
    }
  ]
}
~~~

字段规则：

- source：规范化 Git 地址。
- sourceKey：用于 source 去重和中央 clone 定位。
- branch：可选，记录探测到的默认分支名。
- commit：当前 Scope 使用的 Repo commit。
- updatedAt：当前 Scope 最近一次成功更新时间。
- managedSkills：当前 Scope 从该 Repo 管理的 Skill 名称。
- 不记录远端最新 commit。
- 不记录本地修改 hash。
- 不保存凭据。

`sourceKey` 按 `host + repository path + port` 归一化：HTTPS、SSH 和 GitHub shorthand 的同一 Repo 复用 clone；默认 SSH 用户 `git` 不参与判断，非默认 SSH 用户或不同端口视为不同 Repo。`source` 保留规范化地址，中央 clone 的 origin 使用首次成功 clone 的地址。

旧的 `skills-lock.json` 和 `.skill-lock.json` 不再作为 2.0 归属来源；文件可以保留，但不再读取或双写。只有旧 `.skill-source-lock.json` 中明确记录的 Skill 才能迁移为 managed，其他已安装内容均视为 external。

当前已经存在的 version 2 `.skill-source-lock.json` 在第一次涉及它的读写操作时迁移为 version 3：保留 source 和 sourceKey，将 resolvedCommit 映射为 commit，将 refreshedAt 映射为 updatedAt。对旧 `skillList`，只有同时出现在旧列表和当前目标目录的 Skill 才进入 managedSkills；旧 Lock 未记录但当前已安装的 Skill 视为 external，旧列表记录但当前未安装的 Skill 保持未安装，不自动新增。不从旧 native lock 单独推断归属。

## Repo 生命周期

### 添加 Repo

1. 规范化输入并生成 sourceKey。
2. 在中央目录检查已有 clone。
3. 不存在时执行一次 Git clone。
4. 读取默认分支并检查 Repo 的 skills/ 目录。
5. 发现全部有效 Skill。
6. 将 Repo 写入当前 Scope 的 .skill-source-lock.json，初始 managedSkills 可以为空。

添加 Repo 不自动安装 Skill。

如果 Project 的 Scope lock 已经记录该 Repo，但当前机器没有中央 clone，被动读取或 reindex 不联网；Refresh、inspectRepo、Update、Install 和 Install all 等需要 Repo 的操作中惰性 clone 默认分支最新版本。clone 不按旧 Scope commit 回放；现有 Project 副本和 Lock 在 clone 失败时保持不变。

Repo 的发现规则固定为：skills/ 内递归查找 SKILL.md；某个目录自身存在 SKILL.md 后，该目录作为完整 Skill 根目录，其子目录不再作为独立 Skill。Repo 根目录或其他目录中的 SKILL.md 不参与发现。

### Refresh

1. 对中央 clone 执行 git fetch。
2. 不切换 working tree。
3. 读取远端默认分支当前 SHA。
4. 用 Scope lock 的 commit 和该 SHA 比较。
5. 返回是否可更新。

远端最新 SHA 只作为运行结果或内存状态使用，不写入 Scope lock。

### Update

1. 先 fetch 中央 Repo。
2. 将中央 working clone 切到默认分支最新 commit。
3. 根据当前 Scope 的 managedSkills 生成更新计划。
4. Global 重新确认两个目录的链接，不执行复制。
5. Project 重新复制当前 Scope 已维护的 Skill。
6. 对上游已删除的 managed skill 执行自动删除。
7. 不自动加入上游新增 Skill。
8. 更新当前 Scope 的 commit 和 updatedAt。

Scope 独立运行，不协调其他 Hub/Project 的 lock 或副本。由于 Global 链接直接指向中央 clone，任意 Scope 更新中央 clone 后，Global 可能立即显示新内容；其他 Scope 仍按照自己的 lock 和流程处理。

中央 clone 存在未提交修改或未跟踪文件时，Update 直接失败，不执行 reset、clean 或 stash，也不把 dirty 状态写入 Lock。Refresh 只执行 fetch、不切换 working tree，可以在 dirty clone 上读取远端状态。

### Install

- install 安装选中的 Skill，并追加到当前 source 的 managedSkills。
- installAll 安装当前 Repo 发现的全部 Skill。
- 如果当前 Scope 的 commit 与中央 clone 当前 checkout commit 不同，Install / Install all 先将当前 Scope 所有已管理 Skill 同步到中央 clone 当前 commit，再安装本次选择的 Skill，并将 Lock commit 更新为该 commit；因此不会产生同一 Repo 的混合 commit。
- 如果当前 Scope 尚无该 source 的 commit，直接以中央 clone 当前 commit 安装并写入 Lock。
- Install 不自行 fetch 或 checkout；中央 clone 当前内容由 Add Repo、Refresh、Update 或其他 Scope 的操作决定。
- Global 在 .agents/skills 和 .claude/skills 下创建链接。
- Project 在两个目录分别复制。
- 已存在的同名 managed 安装直接覆盖。
- 明确 Install 同名覆盖时，目标路径上的 external Skill 直接被覆盖，并在当前 Scope 归入该 source 的 managedSkills；除这个明确覆盖路径外，其他 external Skill 不被清理。
- 链接创建失败直接报错，不降级复制。

Project 或 Global 的双目录写入必须全有或全无：先准备两个目标目录，任一链接、复制、替换或删除失败则回滚本次 Scope 文件变化，Lock 不更新；中央 clone 不回滚。失败 operation 返回错误，用户可以重试。

多 Repo 同名 Skill 不进入旧的冲突封锁流程，最后一次安装更新 source 归属；Repo 更新发现该 Skill 缺失时返回 missing 并按自动删除规则处理。

### Uninstall / Remove Repo

- uninstall 删除当前 Scope 的链接或副本，并从 managedSkills 移除。
- removeRepo 删除当前 Scope 的 Repo 使用记录和安装内容。
- 中央 clone 保留，即使没有 Scope 使用。
- 删除 Repo 不影响其他 Scope。
- 同名 Skill 的最后一次成功安装拥有当前 Scope 的归属；旧 source 的 managedSkills 同步移除该名称，避免旧 Repo 的 Remove 或 Update 删除当前生效的安装。

## 服务端架构

### Source Store

新增或重构一个 native Source Store，负责：

- source URL 规范化和 sourceKey。
- 中央 clone 目录定位。
- Git clone、fetch、默认分支探测、checkout。
- 每 source 的并发锁。
- Repo Skill 发现。
- source lock 的读写和迁移。

Global 的 Link 实现按平台选择目录 Junction（Windows）或目录 Symlink（Unix/macOS）；两者创建失败都直接返回错误，不降级为复制。中央 clone 检测到 dirty 时，Source Store 不得替换或清理用户文件。

现有 skill_source_resolver.go 的 Git 和目录发现逻辑可以复用，但从临时 checkout 改为中央 working clone；现有 skill_sources.go 继续作为 .skill-source-lock.json 的现有入口。

### Scope Manager

Scope Manager 负责：

- 读取 Hub 或 Project 的 .skill-source-lock.json。
- 对当前 Scope 的 Repo 做 refresh/update/install/uninstall。
- 计算 managedSkills。
- 将 Global 链接或 Project 副本与 central clone 对齐。
- 更新 Scope lock。
- 在失败时保留旧 Scope commit。
- Install 在中央 checkout commit 变化时，先将当前 Scope 的全部 managedSkills 对齐到该 commit，再加入本次选择的 Skill。
- 对双目录目标使用 Scope 级事务；任一目标失败时回滚本次目标变化，Lock 不更新。

Global 和 Project 是不同的 Scope target；不能共享 Scope lock。

### 状态扫描

2.0 不再读取 skills-lock.json 或 .skill-lock.json 作为事实来源。状态来自：

1. Scope .skill-source-lock.json。
2. 中央 Repo 当前工作树。
3. .agents/skills 和 .claude/skills 的直接文件扫描。
4. 当前 Scope 的链接/复制结果。

只有 Scope lock 中记录的 source 和 managedSkills 才是 managed state 的归属事实；目录扫描只用于检查结果和发现 external，不会把未记录的 Skill 自动接管。其他 Agent 目录只保留为外部环境，不进入 managed state。

## cmd.skills action

保留 Hub 内部 `cmd.skills` tools adapter，重新设计 action；客户端继续通过 HubState 调用，不恢复公开 Registry `cmd.skills` 方法：

| Action | 作用 |
|---|---|
| reindex | 扫描当前 Scope 的 lock、链接/副本和外部 Skill |
| inspectRepo | clone/fetch 并返回 Repo、commit、branch、Skill 目录 |
| addRepo | 将 Repo 加入当前 Scope |
| refreshRepo | fetch 并返回远端 SHA/更新状态 |
| updateRepo | 更新中央 Repo 并更新当前 Scope |
| install | 安装选中的 Skill |
| installAll | 安装 Repo 内全部 Skill |
| uninstall | 卸载当前 Scope 的 Skill |
| removeRepo | 删除当前 Scope 的 Repo 使用记录和安装内容 |
| detail | 读取 Skill Markdown 和 supporting files |
| operation | 查询异步 operation 状态 |

删除现有 CLI 时代的 previewSource、previewInstall、previewUpdate、previewDeleteSource、applyPreview、listSource 语义。inspectRepo 只返回当前 Repo 的检查结果、Skill 目录和选择所需数据；写操作直接执行，不恢复旧的 preview/apply action。

保留 HubState skills section 和每 Hub 单一写 operation。Registry protocol version 不变。

## 失败、并发和安全

### Scope lock 写入

- 每个 Scope 对 Lock 文件使用跨进程文件锁，覆盖完整的 read-modify-write 生命周期。
- 同目录临时文件。
- flush/close 后原子替换。
- 写入前检查磁盘 revision；即使 revision 未变化，也不能绕过 Scope 文件锁。
- 发现并发修改时放弃本次写入并返回可重试错误。

### Central Repo 并发

- 每个 source 使用文件锁。
- 同一 source 不允许并发 fetch/checkout。
- Scope operation 可独立排队。

### Project 复制失败

中央 clone 可以已经更新，Global 链接也可能已经显示新内容；失败 Project 回滚本次两个目标目录的文件变化并保留旧 commit，operation 返回错误，后续可单独重试。由于本方案不维护 snapshots，不做中央 Repo 回滚。

### Git 与路径安全

- HTTP(S) source 不允许 userinfo、token query 或嵌入凭据。
- SSH source 复用 Hub 进程现有 SSH 环境。
- 凭据不写入 lock、HubState、operation 或日志。
- 所有链接、复制和删除路径必须确认仍在受管根目录中。
- 外部 Skill 不主动删除。
- Install 明确覆盖同名 external 时不做备份；未被该次 Install 明确覆盖的 external 路径保持不变。

## UI 改动边界

- 保持当前 source-first ledger 和 Skill 列表。
- Repo 行保留 Refresh、Update、删除，并增加 Install all。
- Skill 行保留安装、卸载、详情，删除 Skill Update。
- 列表底部新增整行 Add Git repository。
- 点击后原地展开 Git 输入、检查和 Skill 选择。
- 不通过加号打开新页面。

## 迁移

迁移是按需触发的，不在启动或被动 reindex 时主动接管全部安装：

1. 当任何读写操作触及旧位置的 `.skill-source-lock.json` 时，先读取该文件并迁移到 2.0 的 canonical Lock 位置；Project 仍写回项目根，Global 写入 `~/.wheelmaker/skills/.skill-source-lock.json`。
2. 只有旧 `.skill-source-lock.json` 明确记录的 source、sourceKey、commit，以及“旧 skillList 与当前目标目录的交集”进入迁移结果；当前已安装但不在旧 Lock 中的内容全部保持 external，旧列表中未安装的 Skill 不自动新增。
3. version 2 映射为 version 3，丢弃 snapshot-only 的 skillList、目录 hash 和其他旧字段；skillList 只作为上述迁移交集的输入，不读取 `skills-lock.json` 或 `.skill-lock.json` 来补全归属。
4. Global 迁移涉及的 Repo 按需 clone 中央 working clone 最新默认分支，并将已记录的 managed Skill 原子转换为中央链接；Project 保持复制模型，后续 Scope 操作按当前 commit 对齐。
5. 迁移成功后保留旧 Lock 文件，但不再读取或双写；旧 native lock 文件同样保留但不再读取。
6. 迁移、链接或 Lock 写入失败时，不更新 canonical Lock，不留下半完成的双目录目标变化；中央 clone 不回滚。

迁移必须幂等；重复触发不会重复 clone、重复安装或产生新的 Git diff。迁移不会自动删除未记录的 external Skill。

## 实施改动面

### Server

- server/internal/hub/tools/skill_sources.go
- server/internal/hub/tools/skill_source_resolver.go
- server/internal/hub/tools/skill_source_catalog.go
- server/internal/hub/tools/skills.go
- server/internal/hub/tools/manager.go
- server/internal/hub/skills_state.go
- server/internal/hub/hub_state_adapters.go
- server/internal/hub/reporter.go
- server/internal/hub/agent/skills.go

需要删除 CLI runner、Node/npm/npx 检查和原生 CLI 参数构造，保留 HubState、operation 和安全目录扫描能力。

### Web

- Registry Skill types/service/repository。
- Skills management view、source ledger、scope action handler。
- 移除 CLI 输入解析和 Skill 行级 Update action。
- 增加 Repo inline add、Refresh、Update、Install all 状态。

### Tests

- Go：本地 Git fixture、fetch/update、链接、复制、lock 迁移、Scope 独立、删除和失败重试。
- Web：底部添加行、inline 输入、Repo action、无 Skill Update、状态和 operation。
- 不依赖真实公网 Git 或开发者真实 Skill 目录。

## 验收标准

- 没有 Node/npm/npx/skills CLI 依赖。
- Global 的 managed Skill 只使用 .agents/skills 和 .claude/skills 链接，external 内容可以保留。
- Project 的 managed Skill 只使用两个目标目录的复制内容，external 内容可以保留。
- .skill-source-lock.json 是唯一 2.0 Scope 状态文件。
- Refresh 不改变当前 commit。
- Update 按 Repo 更新，不提供 Skill 级更新。
- Install / Install all 发现中央 checkout commit 与 Scope commit 不同时，先同步当前 Scope 的全部 managedSkills，再安装并更新 Lock commit。
- Project 新增 Skill 不自动安装。
- 上游删除 Skill 自动删除。
- 同名安装最后一次覆盖。
- 未被明确同名 Install 覆盖的 external Skill 保留；明确同名 Install 可以直接覆盖目标 external。
- 链接失败提示用户且不复制降级。
- Windows Global 使用目录 Junction，Unix/macOS 使用目录 Symlink。
- 双目录操作任一失败都会回滚本次目标变化，Lock 不更新。
- 中央 clone dirty 时 Update / Install 失败，不自动 reset、clean 或 stash。
- 缺失中央 clone 只在需要 Repo 的操作中惰性 clone 最新默认分支。
- 旧 `.skill-source-lock.json` 按需迁移；旧 `skills-lock.json` / `.skill-lock.json` 不参与 managed 归属。
- Project Skill 文件和 lock 可以提交到 Git。
- Hub/Project 更新互不触发对方 Scope operation。
- Registry protocol version 不变。
- 相关 Go tests、Web tests、TypeScript typecheck 和 Web build 通过。
