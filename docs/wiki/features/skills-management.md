> 摘要：本页维护 WheelMaker Skills Manager 2.0 的 Git Repo 中央维护、Scope lock、Global 链接、Project 副本、Repo 级更新和迁移边界。

# Skills Management

> 设计 spec：[Skills Manager 2.0 Native Management](../../scope/2026-08-18-skills-manager-2.0-native.md)。

WheelMaker 以远端 Git Repo 为 Skills 的一级管理对象。每个 Hub-global scope 和 Project scope 独立记录自己的 Repo commit 与 managed skills；中央 Repo clone 只维护一份，Global 通过链接使用，Project 通过复制获得可提交到项目 Git 的副本。

## 上游 npx skills 功能推断

WheelMaker 当前固定依赖过 skills@1.5.18。npx 只是 Node 包执行入口，核心能力来自 skills CLI；2.0 保留需要的行为语义，但不再运行 Node、npm、npx 或该 CLI。

参考上游 v1.5.18：

- [源码目录](https://github.com/vercel-labs/skills/tree/v1.5.18/src)
- [add.ts](https://raw.githubusercontent.com/vercel-labs/skills/v1.5.18/src/add.ts)
- [installer.ts](https://raw.githubusercontent.com/vercel-labs/skills/v1.5.18/src/installer.ts)
- [list.ts](https://raw.githubusercontent.com/vercel-labs/skills/v1.5.18/src/list.ts)
- [remove.ts](https://raw.githubusercontent.com/vercel-labs/skills/v1.5.18/src/remove.ts)
- [update.ts](https://raw.githubusercontent.com/vercel-labs/skills/v1.5.18/src/update.ts)

### 上游能力

- add 从 GitHub shorthand、GitHub/GitLab URL、普通 Git URL、本地路径和部分带路径的来源解析 source。
- Repo 中通过 SKILL.md frontmatter 发现 skill；安装器支持 symlink 和 copy。
- Global 安装通常维护用户级 .skill-lock.json；Project 安装维护 skills-lock.json。
- list --json 扫描已安装目录并输出 Skill、路径、scope 和 agent 信息。
- update 根据 source、skill path 和目录 hash 判断远端变化，部分公开 GitHub source 使用 Trees API。
- remove 处理多个 Agent 目录，并在仍有其他 Agent 使用时保留 canonical 副本。
- find、use、init 等命令不属于 WheelMaker 2.0 范围。

### WheelMaker 当前实际使用

当前实现是混合架构：

- source 解析、Git checkout、目录发现、source catalog、详情读取和安全路径检查由 WheelMaker 自己实现。
- 扫描、安装和部分更新仍通过固定版本的 skills CLI。
- 卸载已经由 WheelMaker 直接删除目录和原生 lock 条目。
- HubState 已经拥有 Skills section、异步 operation、source 状态和 Project scope。

2.0 将保留现有 HubState 和 source-first 信息架构，把 CLI 依赖替换为 native Git/filesystem manager。

## 管理范围

2.0 只管理 Codex 和 Claude：

- Global：~/.agents/skills、~/.claude/skills
- Project：<project>/.agents/skills、<project>/.claude/skills

OpenCode、Copilot、Mimo、CodeBuddy、Qoder 和其他 Provider 不参与 2.0 的安装、更新、卸载和归属判断。其他目录中的内容不主动删除。

## 中央 Repo store

中央目录位于：

~~~text
~/.wheelmaker/skills/
├─ .skill-source-lock.json
└─ <source-key>/
   ├─ .git/
   └─ skills/
~~~

- 每个规范化 Git source 只保留一份 working clone。
- 不维护 snapshots 或额外 checkout 层。
- Repo 默认跟随远端默认分支。
- 中央 clone 不因 Scope 删除而自动删除；后续如需回收，使用独立清理动作。
- source URL 统一规范化为 sourceKey，避免 shorthand、HTTPS 和 SSH 别名造成重复 clone；sourceKey 由 host、仓库路径和 port 构成，默认 SSH 用户 `git` 不参与区分，非默认用户或端口参与区分。
- clone 的 origin 使用第一次成功 clone 的地址；后续等价地址复用同一 working clone。
- 中央 clone 是 WheelMaker 管理的工作目录，不支持保留用户修改；中央目录不因 Scope 操作自动删除。

## Repo Skill 发现边界

Repo 发现只扫描 clone 根目录下的 skills/ 子树：

~~~text
<clone>/skills/
├─ tdd/SKILL.md
└─ groups/deep/diagnose/SKILL.md
~~~

skills/ 内可以递归任意深度；某个目录自身出现 SKILL.md 后，该目录就是一个完整 Skill，子目录不再拆分为独立 Skill。以下位置不参与 Repo Skill 发现：

- Repo 根目录的 SKILL.md
- .agents/skills/
- .claude/skills/
- 任意其他自定义目录

本规则只针对 Git Repo 的可安装 Skill 发现。本机已安装 Skill 仍只从 Global 的 .agents/skills、.claude/skills 和 Project 对应目录扫描。

## Scope lock

WheelMaker 继续使用现有 .skill-source-lock.json，不新建 skill.json。

Global：

~~~text
~/.wheelmaker/skills/.skill-source-lock.json
~~~

Project：

~~~text
<project>/.skill-source-lock.json
~~~

Project 文件随项目 Git 版本管理。每个 Scope 有独立文件，互相不 Link，也不自动同步。

当前版本只记录 source、当前 commit、更新时间、可选 branch 和该 Repo 在 Scope 中维护的 Skill：

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

文件不记录远端最新 commit、本地修改 hash 或 npx lock 字段。远端最新 SHA 由中央 clone 的 fetched remote ref 临时比较得到。

旧的 skills-lock.json 和 .skill-lock.json 只用于一次性迁移。迁移后保留文件，但 2.0 不再读取或双写。

现有 version 2 source lock 直接原地升级为 version 3：source、sourceKey、resolvedCommit 和 refreshedAt 映射到新字段；远端目录 skillList 与内容 hash 不再作为当前状态字段，managedSkills 根据当前 Scope 的受管安装重建。

迁移是惰性的：任何读写 `.skill-source-lock.json` 时，先把旧位置内容迁移到 canonical 位置；迁移成功后只读写 canonical 文件。旧 `skillList` 仅作为迁移目录的候选集合，并与当前目标目录的实际存在项取交集；旧文件没有记录但当前已安装的项全部视为 external，旧文件记录但当前不存在的项不自动安装。迁移失败时 canonical lock 和目标目录保持不变，且迁移可重复执行。

## Repo 操作

### Refresh

Refresh 只执行 git fetch，不改变中央 working tree，也不改变任何 Scope 的安装内容或 commit。

页面用 Scope lock 的 commit 和中央 Repo 的最新远端 SHA 比较，显示是否有更新。远端 SHA 不写入 .skill-source-lock.json；重启后需要通过 Repo 的 fetch 状态重新判断。

如果本机没有中央 clone，被动扫描或重建索引不联网；Refresh、Repo 检查、Update、Install 和 Install all 才会按需 clone 默认分支最新版本。中央 clone 缺失时不会回放旧 commit。

### Update

Update 先更新中央 Repo，再更新当前 Scope：

- Global 不复制文件，链接直接看到中央 Repo 的新内容。
- Project 复制该 Scope 已维护的 Skill。
- 上游新增 Skill 不自动加入 managedSkills。
- 上游已经删除的 managed skill 自动删除。
- 同一个 Scope 内同名安装以最后一次安装为准。
- 其他外部 Skill 保留。
- Update 和 Install 遇到中央 clone dirty/untracked 时直接失败，不 reset、clean 或 stash；Refresh 仍可只 fetch。

同名 Repo 不进入旧的冲突封锁流程；新的安装覆盖目标目录并更新该 Skill 的 source 归属。source 不再提供该 Skill 时，当前 Scope 在 Repo 更新中报告 missing 并按已确认的自动删除规则清理。

Hub 和 Project 的 Scope 独立执行。某个 Project 更新中央 clone 后，Global 链接可能立即看到新内容；其他 Project 的副本和 lock 不自动改变，直到各自执行流程。

### Install

- Install 安装 Repo 中选择的 Skill，并写入当前 Scope 的 managedSkills。
- Install all 显式安装该 Repo 当前发现的全部 Skill。
- 若当前 Scope lock 的 commit 落后于中央 working tree，Install/Install all 先把当前 Scope 已管理 Skills 同步到中央当前 commit，再安装所选项，保证一次操作不混用两个 Repo commit；Install 本身不触发 fetch/checkout。
- Global 在 `.agents/skills` 和 `.claude/skills` 下创建目录链接：Windows 使用 Junction，Unix/macOS 使用目录 Symlink。任一链接失败都直接报错，不降级为复制。
- Project 在两个目标目录复制完整 Skill 目录；复制内容和 .skill-source-lock.json 一起提交到项目 Git。
- Project 两个目标目录的复制是一个事务；任一目标失败时回滚两个目标，Scope lock 不更新，中央 clone 不回滚。

### Uninstall 和删除 Repo

- Uninstall 只删除当前 Scope 的链接或副本，并从 managedSkills 移除。
- 删除 Repo 只移除当前 Scope 的 source、链接和 Project 副本。
- 中央 clone 永不自动删除。
- 上游删除项在 Repo Update 时自动清理，不维护本地修改状态。

## UI 交互

保留当前 source-first ledger 和 Skill 列表展示，不进行大范围布局重排。

- Repo/source 是更新、刷新和删除的操作单位。
- Skill 行保留安装、卸载和详情，不提供 Skill 级更新。
- 列表底部增加一整行 Add Git repository。
- 点击后在当前列表内原地展开 Git 输入、Repo 检查和 Skill 预览。
- 不通过加号打开新页面。
- Repo 行提供 Refresh、Update、Install all 和删除操作。
- Skill 行继续显示安装状态、外部项和异常信息。

## 服务端 action

保留 cmd.skills 作为传输入口，但重新设计 action，不再依赖 CLI 时代的 preview/apply action：

- reindex
- inspectRepo
- addRepo
- refreshRepo
- updateRepo
- install
- installAll
- uninstall
- removeRepo
- detail
- operation

普通 scan 只读；会写 source lock、中央 clone、Global 链接或 Project 副本的动作进入 Hub 单一异步 operation。Registry protocol version 保持不变。

## 状态、失败与安全边界

- Scope lock 写入采用同目录临时文件、关闭后原子替换，并检查磁盘版本，避免并发写覆盖；整个读改写过程还受 Scope 跨进程文件锁保护。
- 每个中央 Repo 的 fetch、checkout 和目录更新受 source 文件锁保护。
- Git 认证只复用 Hub 进程可用的 credential/SSH 环境，凭据不写入 lock、state、operation 或日志。
- Git fetch、checkout、复制或链接失败时保留旧 Scope lock，返回可重试错误。
- Project 复制失败不会伪造新 commit；中央 Repo 可以保持已更新状态，Scope 下次单独重试。
- 已存在的 Skill 目录允许被新的 managed 安装覆盖；不属于 WheelMaker 管理的其他 Skill 不主动清理。
- 所有复制、链接和删除路径必须验证仍在 .agents/skills、.claude/skills 或中央 Repo 目录内。

## 测试边界

服务端测试使用本地 Git fixture 覆盖：

- clone、fetch-only、默认分支 checkout 和 commit 比较
- Global 链接、Project 复制和链接失败
- Repo 级更新、新增不自动安装、删除自动清理
- 同名覆盖和外部 Skill 保留
- Scope lock v3、旧 lock 一次性迁移、原子写和并发冲突
- 多 Scope 独立更新和失败重试

Web 测试覆盖底部添加 Repo 行、inline 输入、Repo 级操作、Skill 行无更新按钮和 operation 状态。
