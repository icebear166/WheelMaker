> 摘要：本页维护 WheelMaker Skills Manager 2.0 的 Git/well-known Source、中央快照、Scope lock、Global 链接、Project 副本、操作和失败边界。

# Skills Management

> 设计来源：[Skills Manager 2.0 Native Management](../../scope/2026-08-18-skills-manager-2.0-native.md)、[Scope Update and Install](../../scope/2026-08-19-skills-scope-update-install.md)、[Well-Known Skill Sources](../../scope/2026-08-19-well-known-skill-sources.md)。

WheelMaker 以远端 Source 为 Skills 的一级管理对象。Source 可以是 Git repository，也可以是通过 well-known index 发布的 catalog。每个 Hub-global scope 和 Project scope 独立记录自己的 Source revision 与 managed skills；同一规范化 Source 的中央内容只维护一份，Global 通过链接使用，Project 通过复制获得可提交到项目 Git 的副本。

## 上游兼容基线

WheelMaker 迁移前固定依赖 `skills@1.5.18`。`npx` 只是 Node 包执行入口，核心行为来自 skills CLI；2.0 原生实现需要的语义，不再运行 Node、npm、npx 或该 CLI。

Source 分类和 well-known 发现固定以 `skills@1.5.18` 为兼容基线：

- GitHub/GitLab URL、GitLab tree URL、GitHub shorthand、Git SSH/SCP 地址，以及以 `.git` 结尾的 HTTP(S) 地址属于 Git。
- 其他 HTTP(S) 地址属于 well-known；`raw.githubusercontent.com` 按上游规则不作为 well-known Source。
- well-known 发现失败不回退 Git clone；自建 HTTP(S) Git 地址必须显式使用 `.git` 或可识别的 GitLab tree 形式。
- 支持 `/.well-known/agent-skills/index.json`、旧版 `/.well-known/skills/index.json`、legacy `files[]` 和 discovery 0.2.0 的 `skill-md` / `archive` + SHA-256 digest。
- find、use、init、本地路径、Git Tag/Commit/Skill 子路径和逻辑 ref 不属于 WheelMaker 2.0 范围。

参考上游 v1.5.18：

- [source-parser.ts](https://github.com/vercel-labs/skills/blob/v1.5.18/src/source-parser.ts)
- [add.ts](https://github.com/vercel-labs/skills/blob/v1.5.18/src/add.ts)
- [providers/wellknown.ts](https://github.com/vercel-labs/skills/blob/v1.5.18/src/providers/wellknown.ts)

## 管理范围

2.0 只管理 Codex 和 Claude：

- Global：`~/.agents/skills`、`~/.claude/skills`
- Project：`<project>/.agents/skills`、`<project>/.claude/skills`

OpenCode、Copilot、Mimo、CodeBuddy、Qoder 和其他 Provider 不参与 2.0 的安装、更新、卸载和归属判断。其他目录中的内容不主动删除。

## Source identity 与发现

### Git Source

Git source 保持现有规范化行为：等价 shorthand、HTTPS 和 SSH 地址共享 source key；key 由 host、repository path 和必要的 user/port 信息构成。中央 clone 跟随远端默认分支，不支持用户修改、额外 ref 或本地 source。

Git Skill 只从 clone 根目录的 `skills/` 子树递归发现：

~~~text
<clone>/skills/
├─ tdd/SKILL.md
└─ groups/deep/diagnose/SKILL.md
~~~

某目录出现 `SKILL.md` 后，该目录就是一个完整 Skill，其子目录不再拆分为独立 Skill。Repo 根 `SKILL.md`、`.agents/skills/`、`.claude/skills/` 和其他目录不参与 Git catalog 发现。

### Well-known Source

初次输入任意 HTTP(S) 入口时，按下列优先级尝试 index：

1. 输入 path 相对的 `agent-skills/index.json`
2. 站点根 `agent-skills/index.json`
3. 输入 path 相对的 `skills/index.json`
4. 站点根 `skills/index.json`

输入已持久化的 canonical index URL 时只读取该 index。初次成功发现后，Scope lock 持久化实际命中的 canonical index URL；以后不重新跑候选优先级，也不因站点新增更优 variant 静默迁移 identity。

well-known source key 覆盖规范化 scheme、host、port 和完整 index path，包括 `agent-skills` / `skills` variant。query、fragment 和 userinfo 不参与 identity，因为这类输入直接拒绝。不同入口命中同一 canonical index 时共享一份中央快照；HTTP/HTTPS、不同 path-relative catalog 和不同 variant 保持独立。

合法 catalog 按 index entry `name` 作为安装名，`SKILL.md` frontmatter 负责验证内容但不替换安装名。最终物化结果继续执行大小写不敏感的重复安装名检查。没有可发现 index 的独立 `SKILL.md` 或下载 URL 不作为单 Skill Source。

## 中央 Source store

中央目录位于 `~/.wheelmaker/skills/`：

~~~text
~/.wheelmaker/skills/
├─ .locks/
│  └─ <flat-source-key>.lock
├─ .skill-source-lock.json
└─ <flat-source-key>/
   ├─ .git/                    # 仅 Git source
   ├─ <wheelmaker-metadata>    # well-known source metadata
   └─ skills/
      └─ <install-name>/...
~~~

- 每个规范化 Source 只保留一份当前中央内容，不维护历史 snapshot。
- Git 使用 working clone，revision 是 commit；clone 不存在时按需 clone，存在时 fetch/prune 并 checkout 远端默认分支最新 commit。
- well-known 使用完整下载快照，revision 是对 canonical identity、接受的 index 内容和实际文件按稳定顺序计算的 SHA-256。
- well-known 先在 source store 同级 staging 完整物化、校验，再发布到稳定路径。发布失败恢复旧快照并清理临时内容。
- Source 目录不因 Scope 删除而自动删除；回收属于独立清理职责。
- 被动扫描和 reindex 只读 Scope lock、已有中央内容和安装目录，不访问网络。中央内容缺失时保留 Source 状态并提示通过需要内容的操作重新获取。

### Well-known 完整性和资源限制

只有完整 materialization 才能发布：

- legacy index 中任一 accepted Skill 的 `SKILL.md`、supporting file、声明或内容校验失败，整个 candidate 失败，不发布残缺快照。
- discovery 0.2.0 只接受精确 schema URI；非法 entry 按上游规则忽略，accepted entry 的 artifact、digest、frontmatter 或 archive 校验失败会使 candidate 失败。
- `skill-md` 只生成根 `SKILL.md`；archive 支持 ZIP、TAR.GZ/TGZ，必须包含根 `SKILL.md`。
- archive 拒绝加密文件、链接、绝对路径、反斜杠和 `.`/`..` 路径段。
- HTTP 操作使用调用方 context，并限制为 10 分钟 operation deadline、30 秒 response-header timeout、最多 5 次 redirect、最多 8 个并发下载。
- redirect 只允许 HTTP(S)，禁止 HTTPS 降级为 HTTP。跨 host artifact redirect 可以继续，但不携带认证 header，也不接受 userinfo。
- 所有读取和解包都流式施加上限：index 4 MiB、1000 entries、单个 `skill-md` 或 legacy file 32 MiB、压缩 artifact 64 MiB、单 archive 解包 50 MiB/1000 files、整个 catalog 512 MiB/10000 files。

## Scope lock

WheelMaker 继续使用 `.skill-source-lock.json` version 3，不增加 provider wire 字段。

Global：`~/.wheelmaker/skills/.skill-source-lock.json`

Project：`<project>/.skill-source-lock.json`

每个 Scope 有独立文件，互相不 Link，也不自动同步。Source 条目保持现有字段：

~~~json
{
  "version": 3,
  "sources": [
    {
      "source": "https://example.com/.well-known/skills/index.json",
      "sourceKey": "<canonical-source-key>",
      "branch": "",
      "commit": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "updatedAt": "2026-08-19T12:00:00Z",
      "managedSkills": ["skill-a"]
    }
  ]
}
~~~

`commit` 是兼容字段：Git 保存 commit，well-known 保存 64 位内容 revision；well-known 的 `branch` 为空。`managedSkills` 表示该 Source 在当前 Scope 拥有的安装项。旧 version 2 lock 到 version 3 的惰性迁移规则保持不变；旧 npx locks 只用于既有一次性迁移，不再双写。

## Source 操作

### Add

Add 对输入进行分类并获取最新中央内容。成功后只把 canonical Source 和当前 revision 写入当前 Scope，初始 `managedSkills` 为空；不自动安装、不预览，也不让用户在 Add 流程选择 Skill。具体安装由 Skill 行 Install 或 Source 行 Install all 触发。

Hub 和 Project 独立 Add、Update 和安装。同一 Source 的中央内容可以共享，但不会在两个 Scope 间自动添加、更新 lock 或改变 managed ownership。

### Update

Update 获取 Source 最新中央内容，只同步当前 Scope 的 managed Skills：

- 新发布 Skill 不自动安装。
- 上游删除的 managed Skill 自动清理。
- Global 链接直接看到中央内容；Project 更新其受管副本。
- 同一 Scope 内同名安装以最后一次明确安装为准；其他 external/unmanaged Skill 保留。

Source 行 Update 只处理当前 Source；Scope Update 按 lock 顺序逐个处理并汇总结果。一个 Scope 更新中央内容不自动改写其他 Scope 的 lock 或 Project 副本。

### Install 和 Install all

- Install 先获取一个最新 snapshot、同步该 Source 已受管 Skills，再安装所选项并更新 ownership。
- Source Install all 使用同一个最新 snapshot 安装当前 catalog 的全部 Skills。
- Scope Install all 为每个 Source 分别获取一次 snapshot；某个 Source 失败时不使用其旧内容继续安装，其他 Source 可以继续并汇总结果。
- 明确 Install 可以覆盖同名 unmanaged 目录；其他 unmanaged 内容不清理。
- Global 在两个 Agent 目录创建到中央 Skill 的目录链接：Windows 使用 Junction，Unix/macOS 使用目录 Symlink；链接失败不降级为复制。
- Project 向两个 Agent 目录复制完整 Skill，并与 `.skill-source-lock.json` 一起提交项目 Git；两个副本和 lock 构成 Scope 事务。

### Uninstall 和 Remove Source

Uninstall 只删除当前 Scope 的链接或副本并移除 managed ownership。Remove Source 删除该 Source 在当前 Scope 的 managed 安装和 lock 条目。两者离线可执行，都不删除中央 Git clone 或 well-known snapshot。

## UI 与传输兼容

Skills 页面保留 source-first ledger：

- Scope 工具栏提供 Update 和 Install all；Source 行提供 Update、Install all 和删除。
- Skill 行提供 Install、Uninstall 和详情，不提供 Skill 级 Update。
- 列表底部使用 `Add skill source`，输入接受 Git repository 或 well-known URL。
- Add 原地直接提交，不显示 Repo 检查、Skill 预览或选择步骤。
- well-known Source Add 成功后显示完整 catalog，但所有 Skills 初始为未安装。

Registry protocol version 保持不变。`inspectRepo`、`addRepo`、`updateRepo`、`removeRepo` 和响应 `repo` 等名称作为传输兼容字段继续使用；用户可见文案统一使用 Source。会写 lock、中央内容、Global 链接或 Project 副本的动作进入 Hub 单一异步 operation。

## 状态、事务和安全边界

- Scope lock 采用同目录临时文件、关闭后原子替换和磁盘版本比较；不创建 `.skill-source-lock.json.lock` sidecar。
- 每个中央 Source 的更新和发布受 source 文件锁保护。
- Git credential/SSH 环境只在进程内复用；HTTP userinfo、query 凭据、认证 header、响应正文和其他敏感内容不得写入 lock、state、operation、日志或错误。
- 下载、解析、digest、archive 校验或中央发布失败时，旧中央 snapshot、Scope 安装和 lock 全部保留。
- 中央发布成功后，若 Project 复制或 Scope lock 写入失败，中央 snapshot 保持新版，Project 回滚可回滚副本并保留旧 lock。Global 的稳定链接可能已经看到新版；operation/status 必须报告未对齐并允许重试。
- Git 中央 clone dirty/untracked 时拒绝 Update/Install，不 reset、clean 或 stash。
- 所有复制、链接、删除和 archive 输出路径都必须验证在既定目标根内。

## 测试边界

服务端使用本地 Git 和 HTTP fixtures 覆盖：

- Git/well-known 分类、canonical identity、candidate 顺序和无 Git fallback
- legacy、discovery 0.2.0、digest、ZIP/TAR.GZ、安全路径和资源预算
- 完整 staging/publish、旧 snapshot 保留以及发布前后两类失败边界
- Add 空 ownership、Update-only-managed、删除清理、明确覆盖和 Scope 批量操作
- Global 链接、Project 副本、lock v3/迁移、离线 Remove/Uninstall 和被动 reindex
- 多 Scope 独立更新、部分失败、状态未对齐和失败重试

Web 测试覆盖 `Add skill source`、通用输入、直接提交且无预览/选择、Source 操作、Skill 操作和 operation 状态。验证使用 Jest 和 TypeScript typecheck，不执行 Web build。
