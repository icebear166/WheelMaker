> 由 scope skill 于 2026-08-19 生成
> 状态：已批准 2026-08-19

# Skills Manager Well-Known Sources

## 目标

在不恢复 Node、npm、npx 或 `skills` CLI 运行时依赖的前提下，让 Skills Manager 2.0 原生支持 `skills@1.5.18` 的 well-known Skill 发布源，修复 HTTP Skill 地址被错误补成 `.git` 后执行 clone 的兼容性回归，并把 Git Repo 与 well-known catalog 统一纳入现有 Source、Scope lock、Global 链接和 Project 复制流程。

## 决策基线

### 需求边界

- 现有已规范化 Git source 和明确 Git 输入的行为保持不变；新增 well-known source，不恢复 Git Tag、Commit、Skill 子路径或逻辑 ref，也不恢复 Local path。
- Source 分类遵循 `skills@1.5.18`：GitHub/GitLab URL、GitLab tree URL、GitHub shorthand、Git SSH/SCP 地址以及以 `.git` 结尾的 HTTP(S) 地址属于 Git；其他 HTTP(S) 地址属于 well-known，`raw.githubusercontent.com` 按上游规则不属于 well-known。well-known 发现失败不回退 Git clone，自建 Git HTTP(S) 地址需要显式 `.git` 或可识别的 GitLab tree 形式。
- well-known 同时支持 `/.well-known/agent-skills/index.json` 和旧版 `/.well-known/skills/index.json`，并支持 `skills@1.5.18` 的 legacy `files[]` 索引与 discovery 0.2.0 `skill-md` / `archive` + SHA-256 digest 索引。
- 输入站点任意 HTTP(S) 入口时，按上游路径相对发现、站点根目录回退和 `agent-skills` 优先于 `skills` 的顺序寻找索引。输入 `https://open.feishu.cn/.well-known/skills/lark-approval/SKILL.md` 因此解析为站点根目录的完整飞书 catalog，而不是只包含 `lark-approval` 的单 Skill source。
- Add 只把解析成功的 source 加入当前 Scope，初始 `managedSkills` 为空；不提供预览或选择步骤，也不自动安装任何 Skill。用户随后通过 Skill 行 Install 或 source 级 Install all 决定安装内容。
- well-known 的 Update、Install、Install all、Scope Update、Scope Install all、Uninstall 和 Remove Source 沿用现有 Scope 语义：Update 只同步当前 managed skills；新增 Skill 不自动安装；上游删除的 managed skill 自动清理；明确安装同名 Skill 可以覆盖 unmanaged 内容。
- Hub 与 Project 仍是独立 Scope，不增加跨 Scope 自动更新或 operation 联动。被动扫描不联网；需要 source 内容的 Add、Update、Install 和 Install all 才访问远端。
- 每个规范化 source 只维护一份中央内容。Git 继续维护一个 working clone；well-known 只维护一个当前下载快照，不保留历史版本。中央内容不因 Scope 删除而自动清理。
- Well-known snapshot 只发布完整 materialization：索引中被接受的任一 Skill，其 `SKILL.md`、supporting file、artifact、digest 或 archive 校验失败时，该 index candidate 不得发布；已有 source 因此保留旧中央快照和 Scope 状态。这里保留此前确认的数据完整性要求，不复制 `skills@1.5.18` 忽略 legacy supporting-file 下载失败的容错缺陷。
- Registry protocol version 保持不变，现有 `inspectRepo`、`addRepo`、`updateRepo`、`removeRepo` 和响应 `repo` 字段作为传输兼容名称继续使用；用户可见文案统一使用 Source。
- 不支持没有可发现 well-known index 的任意独立 `SKILL.md` 或下载 URL；这类输入按 `skills@1.5.18` 流程返回未发现 Skill，而不是把响应正文直接当作一个 Skill。

### 技术决策

- 上游行为基线固定为 [`source-parser.ts`](https://github.com/vercel-labs/skills/blob/v1.5.18/src/source-parser.ts)、[`add.ts`](https://github.com/vercel-labs/skills/blob/v1.5.18/src/add.ts) 和 [`providers/wellknown.ts`](https://github.com/vercel-labs/skills/blob/v1.5.18/src/providers/wellknown.ts) 的 `v1.5.18` 实现，不跟随上游 main 的未来变化。
- 将现有 Git-only source 规范化扩展为确定性的 source 分类与 provider 分派。已持久化 Git source 都保持规范化 `.git` 地址；成功解析的 well-known source 持久化实际命中的 canonical index URL，使后续 lock 校验和 provider 选择不需要联网。
- well-known `sourceKey` 覆盖完整 canonical index identity：规范化 scheme、host、port 和完整 index path（包括 `agent-skills` / `skills` variant）；query、fragment 和 userinfo 不参与，因为输入直接拒绝。不同输入解析到同一 canonical index 时复用同一中央快照；HTTP/HTTPS、不同 path-relative catalog 和两种 variant 不冲突。已经持久化的 legacy canonical index 不因站点后来新增优先级更高的 `agent-skills` index 自动迁移，用户可以显式添加新 source 并移除旧 source。
- 中央 Store 对上层继续提供统一 checkout/snapshot 视图：稳定目录、source、sourceKey、可选 branch、当前 revision 和完整 Skill catalog。Git revision 是 commit；well-known revision 是对 canonical index 身份、接受的索引内容和实际下载文件按稳定顺序计算的 SHA-256。
- `.skill-source-lock.json` 保持 version 3 和现有字段，不新增迁移：well-known 的 `branch` 为空，`commit` 保存 64 位内容 revision，`updatedAt` 和 `managedSkills` 含义不变。内存中保留 source kind，但不写新增 wire 字段。
- well-known 下载先写入 source store 同级临时 staging；校验完成后发布到 sourceKey 对应的稳定中央路径。发布失败恢复旧快照并清理 staging；中央发布成功后，后续 Scope 目标或 lock 更新失败不回滚中央快照，与 Git latest checkout 的现有边界一致。
- legacy index 沿用上游全索引校验：任一 entry 的名称、描述、files 或 `SKILL.md` 声明非法时，该 index candidate 无效；合法 entry 的 `SKILL.md` 必须包含 name/description frontmatter。与上游不同，任一声明文件下载或内容校验失败都会使该 candidate 失败，不能发布残缺 snapshot。最终至少有一个有效 Skill 才算发现成功。
- discovery 0.2.0 index 只接受精确 schema URI；非法 entry 按上游规则忽略，合法 artifact 必须通过声明的 SHA-256。`skill-md` 只生成根 `SKILL.md`；`archive` 支持 ZIP、TAR.GZ/TGZ，要求根 `SKILL.md`，拒绝加密文件、链接、绝对路径、反斜杠和 `.`/`..` 路径段，并沿用上游 1000 文件、50 MiB 解包上限。被接受 entry 的 artifact 下载、digest、frontmatter 或 archive 校验失败会使该 candidate 失败，不从即将发布的 snapshot 中静默过滤；最终至少有一个有效 Skill 才算发现成功。
- 最终物化 catalog 继续执行 WheelMaker 现有的大小写不敏感重复安装名检查；存在重复项时拒绝该 candidate，避免多个远端条目写入同一中央目录。
- well-known catalog 的安装名使用 index entry `name`；`SKILL.md` frontmatter 只负责内容有效性，不替换安装名。中央布局统一物化为 `<source-root>/skills/<install-name>/...`，从而复用现有 Global 链接、Project 复制、目录 hash、详情读取和 Scope 事务。
- 网络、解析、digest、archive 或发布错误使用 well-known 专属错误上下文，不再显示 Git clone 错误；错误不得泄露 URL userinfo、query 中的凭据或响应正文。HTTP(S) source 拒绝 userinfo，沿用现有 ref/query/fragment 限制。
- HTTP provider 使用调用方 context 并施加 10 分钟 operation deadline、30 秒 response-header timeout 和最多 5 次 redirect；只允许 HTTP(S)，禁止 HTTPS → HTTP 降级，跨 host artifact redirect 可以继续但不得携带 userinfo 或认证 header。下载并发上限为 8。
- 所有响应采用流式有界读取：index 最大 4 MiB、entry 数最大 1000、单个 `skill-md` 或 legacy file 最大 32 MiB、压缩 artifact 最大 64 MiB、单 archive 仍以实际解包内容限制为 50 MiB/1000 文件、整个 catalog 最大 512 MiB/10000 文件。达到限制、context 取消或 timeout 都视为 candidate 失败；digest 和解包必须在读取/写入过程中执行限制，不能先无限读入内存或磁盘。

## 设计视图

### 功能设计

Skills 页面继续使用 source-first ledger。底部入口从 `Add Git repository` 改为 `Add skill source`，输入提示同时接受 Git repository 和 well-known URL；提交后直接执行，不出现 Repo 检查、Skill 预览或选择界面。

Git source 的显示和操作不变。well-known source 加入成功后显示实际发现到的完整 catalog，但所有 Skill 初始均为未安装；飞书具体 `SKILL.md` 地址会显示同一站点 index 发布的全部有效 Skill。Source 行继续提供 Update、Install all 和删除，Skill 行继续提供 Install、Uninstall 和详情。

well-known 解析、下载、校验或中央发布失败时，Add operation 不新增 source；已有 source 保留旧中央快照、Scope lock 和安装内容。中央发布成功后如果后续 Scope 目标或 lock 失败，中央 snapshot 保持新版：Project 回滚可回滚副本并保留旧 lock，Global 链接可能已经看到新版，operation/status 必须报告失败并允许重试对齐。

### 技术设计

#### 整体方案

```text
Add / Update / Install source action
                 |
                 v
       normalize + classify source
          |                 |
          | git             | well-known
          v                 v
  Git latest checkout   discover index candidates
          |                 |
          |                 v
          |           fetch valid skills
          |                 |
          |                 v
          |          validate + stage + publish
          |                 |
          +--------+--------+
                   v
       common central source snapshot
      (path, revision, catalog, source key)
                   |
          +--------+--------+
          v                 v
     Global links       Project copies
          +--------+--------+
                   v
          atomic Scope lock update
```

Source provider 负责远端内容和中央 source snapshot；Scope Manager 继续负责 managed ownership、链接/复制事务和 lock。上层操作不根据 kind 重写安装规则，只通过统一 snapshot 获取稳定目录、revision 和 catalog。

#### 关键结构

- Source identity：包含 kind、用户输入、canonical source 和 sourceKey。初次 well-known Add 在发现索引后确定 canonical source；持久化后可以从包含完整 scheme/host/port/index path 的 canonical identity 离线重建 sourceKey。
- Source snapshot：沿用 checkout 形状并将 commit 泛化为 revision；Git 提供 branch/commit，well-known 提供空 branch/content revision，两者都提供中央 path 和 `skills/.../SKILL.md` catalog。
- Central store：Git source 目录仍包含 `.git/`；well-known source 目录包含物化的 `skills/` 和仅供 WheelMaker 校验/重建 catalog 的 source metadata。临时 staging 和备份不是可用版本，成功后清理。
- Scope lock：继续以 canonical source/sourceKey 去重，以 `commit` 表示当前 Scope 已对齐的 provider revision，以 `managedSkills` 表示所有权。现有 version 2 → version 3 迁移规则不变。

#### 实现流程

1. Add 接收输入并按 `skills@1.5.18` 规则分类。Git 进入现有 latest-repo；well-known 按“输入 path 的 `agent-skills`、站点根 `agent-skills`、输入 path 的 `skills`、站点根 `skills`”顺序尝试 index candidates；输入本身是已持久化 canonical index 时直接读取该 index。
2. Well-known provider 解析首个能够完整物化所有 accepted entries 的 candidate，以最多 8 个并发下载其 Skill，在 staging 中构造统一 `skills/<name>/...` 布局并计算目录 hash 与 source revision。任何 accepted entry 不完整、资源超限、timeout 或取消都会放弃该 candidate；初次发现可以继续尝试后续 candidate，已持久化 canonical index 的更新只读取该 index，不切换 source identity。
3. Provider 将 staging 发布到稳定中央路径并返回 common snapshot。Add 向当前 Scope lock 写入 canonical source、revision 和空 `managedSkills`；不触碰安装目录。
4. Update、Install 和 Install all 每次都通过对应 provider 获取最新 snapshot。Update 只对齐已有 managed skills；Install 在同一 revision 上先同步已有 managed skills，再加入选择项；Install all 选择 catalog 全部条目。
5. Global 链接和 Project 双目录复制继续使用现有事务。目标成功后才写 Scope lock；目标或 lock 失败时回滚可回滚的 Scope 文件变化，中央 source snapshot 保持最新并允许下次重试。Project 失败后保留旧副本和旧 revision；Global 因稳定链接可能已看到新 snapshot，operation/status 明确暴露未对齐状态。
6. Uninstall 和 Remove Source 不访问网络，直接修改当前 Scope 目标与 lock；中央 Git clone或 well-known snapshot 保留。
7. 被动 reindex 从 Scope lock、已存在中央内容和安装目录合成状态，不下载 index。中央 well-known snapshot 缺失时显示需要重新获取，直到用户执行依赖 source 内容的操作。

### 预估改动面

- `server/internal/hub/tools/skill_sources.go`：统一 source identity、well-known canonical source/sourceKey、version 3 lock 校验与旧 Git source 兼容。
- `server/internal/hub/tools/skill_source_store.go`、`skill_source_resolver.go`：抽象 common snapshot/provider 分派，保留 Git 实现并加入 well-known 中央 staging/publish、revision 和 catalog。
- `server/internal/hub/tools/skills_native.go`、`skills.go`：让 Add、Update、Install、Install all、Scope 批量操作和错误清理使用统一 source provider；保留现有传输 action 名。
- 新的 well-known provider 文件：index candidate、两版 schema、HTTP fetch、frontmatter、digest、ZIP/TAR.GZ 解包和安全限制。
- `app/web/src/app/ChatHubSkillManagement.tsx` 及相关测试：将用户可见的 Git-only 文案改为 Source 文案，不增加 preview/selection 交互。
- `server/internal/hub/tools/tools_test.go` 或拆分后的同包测试：增加本地 HTTP fixtures 和 provider/operation/rollback 测试，不依赖真实飞书或公网。
- `docs/wiki/features/skills-management.md`：把一级对象从 Git Repo 扩展为 Git/well-known Source，并同步发现、存储、revision、操作和 UI 规则。

## 验收

- 输入飞书 `lark-approval/SKILL.md` 地址不会追加 `.git` 或执行 clone，而是命中站点根 `/.well-known/skills/index.json` 并列出完整有效 catalog；本地 HTTP fixture 和命令级测试证明候选顺序与结果。
- GitHub/GitLab、SSH、shorthand 和显式 `.git` 地址继续进入 Git provider；普通非 GitHub/GitLab HTTP(S) 地址进入 well-known，发现失败后不回退 Git；source 分类单元测试覆盖各类边界。
- legacy `files[]` source 只有在所有 accepted entries 的 `SKILL.md` 和 supporting files 都成功下载并校验后才发布；非法 index candidate、缺失文件、timeout 和部分下载不会产生残缺 snapshot，provider 测试证明已有旧 snapshot 保持不变。
- discovery 0.2.0 的 `skill-md`、ZIP 和 TAR.GZ artifact 均可安装；accepted entry 的 digest 不匹配、危险路径、链接、加密 ZIP、超文件数、超解包大小或缺失根 `SKILL.md` 会使 candidate 失败且不发布部分 snapshot；provider 测试覆盖成功与失败。
- Add 成功后 Scope lock 仍为 version 3、`managedSkills` 为空、安装目录没有新增 Skill；Web/Go 测试证明没有 preview 或选择步骤。
- 解析到同一 canonical index 的站点入口、具体 Skill URL 和 canonical index URL 使用相同 sourceKey 和中央路径；HTTP/HTTPS、不同 path-relative catalog、`agent-skills` 和 `skills` 使用不同 key。站点新增新 variant 不会让现有 canonical source 静默改向；identity 测试覆盖这些边界。
- Well-known Update 只同步 managed skills，新发布 Skill 不自动安装；上游删除 managed skill 会清理；Install、Install all 和 Scope 批量操作使用同一次最新 snapshot。
- 下载、解析、digest、archive 或中央发布失败时，旧中央 snapshot、Global/Project 安装和 Scope lock 全部保留；本地 HTTP 与文件系统 fixture 验证不存在部分发布。
- 中央发布成功后 Project 复制或 Scope lock 写入失败时，中央保持新版、Project 回滚可回滚副本且 lock 保持旧 revision；Global 链接可能看到新版并通过 operation/status 暴露未对齐状态。测试分别覆盖发布前和发布后失败，不能用一个笼统“Update 失败”断言代替。
- 慢响应、超过 4 MiB 的 index、超过 1000 entries、超过单文件/artifact/catalog 预算、超过文件数、redirect 循环、HTTPS 降级和 context 取消都会在既定 deadline 内失败并保留旧 snapshot；HTTP fixture 同时验证合法跨 host artifact redirect 不携带认证信息且可以成功。
- Global 继续使用中央目录链接，Project 继续复制完整 Skill 目录；同名 unmanaged 安装可被明确 Install 覆盖，其他 unmanaged 内容保留。
- Remove Source 和 Uninstall 在离线状态下可工作，且不删除中央 well-known snapshot；被动 reindex 不联网。
- 前端显示 `Add skill source` 和通用 Source 提示，错误不再把 well-known 请求描述为 Git clone；相关 Jest 测试和 TypeScript typecheck 通过，不执行 Web build。
- Registry protocol version、现有 action 名、Scope lock version 3、旧 lock 迁移和现有 Git source 行为保持兼容；相关 Windows hidden Go tests 通过。
