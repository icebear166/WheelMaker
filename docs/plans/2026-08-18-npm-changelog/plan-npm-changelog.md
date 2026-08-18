# WheelMaker npm Changelog Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建一个中文 WheelMaker npm 更新追踪 skill，并用它建立 9 个活动 agent runtime 包的版本 changelog。

**Scope Source:** `docs/scope/2026-08-18-npm-changelog.md`

**Architecture:** Skill instructions own the research workflow and WheelMaker integration checklist. Small Python helpers provide deterministic policy extraction and changelog structure validation; external Git/npm research remains an agent-driven step because source availability and release formats vary by package.

**Tech Stack:** Markdown, YAML, Python 3 standard library, npm registry/tarball commands, Git/web research.

**Verification:** `python -m unittest discover -s .agents/skills/npm-changelog/scripts/tests -v`; skill `quick_validate.py`; `inspect_npm_policy.py`; `validate_changelog.py`; `git diff --check`.

---

### Task 1: Scaffold the skill and establish helper RED tests

**Files:**
- Create: `.agents/skills/npm-changelog/` through `skill-creator/scripts/init_skill.py`
- Create: `.agents/skills/npm-changelog/scripts/tests/test_helpers.py`

**Acceptance:** 标准 skill 目录、`SKILL.md`、`agents/openai.yaml`、`scripts/` 和 `references/` 存在；测试以 CLI 方式验证包清单提取、文件名编码和 changelog 结构，并在辅助脚本尚未实现时因返回码/断言失败而 RED。

- [ ] **Step 1: Initialize the skill**

Run from the worktree root:

```powershell
python C:\Users\suweimin\.codex\skills\.system\skill-creator\scripts\init_skill.py npm-changelog --path .agents\skills --resources scripts,references --interface display_name="WheelMaker NPM Changelog" --interface short_description="跟踪 WheelMaker Agent npm 版本与接入影响" --interface default_prompt="使用 $npm-changelog 更新 WheelMaker 关注的 agent npm 版本与接入影响。"
```

Expected: exit code 0 and no example placeholder files.

- [ ] **Step 2: Write CLI helper tests before helper implementation**

测试使用临时 Go source、临时 changelog 目录和 `subprocess` 调用未来的两个 CLI，覆盖：解析 runtime policy 并排除 deprecated、scoped package 文件名编码、检测重复版本、检查 `WheelMaker integration` 章节和报告缺失包文件。

- [ ] **Step 3: Run the helper tests to verify RED**

Run:

```powershell
python -m unittest discover -s .agents/skills/npm-changelog/scripts/tests -v
```

Expected: tests fail through assertions because the helper command files do not yet exist; this confirms the tests exercise the intended CLI contract.

### Task 2: Implement deterministic helpers and skill guidance

**Files:**
- Create: `.agents/skills/npm-changelog/scripts/inspect_npm_policy.py`
- Create: `.agents/skills/npm-changelog/scripts/validate_changelog.py`
- Create: `.agents/skills/npm-changelog/references/changelog-format.md`
- Create: `.agents/skills/npm-changelog/references/integration-checklist.md`
- Modify: `.agents/skills/npm-changelog/SKILL.md`
- Modify: `.agents/skills/npm-changelog/agents/openai.yaml`

**Acceptance:** Helper tests pass; skill frontmatter triggers on WheelMaker agent npm update/changelog requests; instructions are imperative, Chinese, under the context budget, and do not include template placeholders.

- [ ] **Step 1: Implement `inspect_npm_policy.py`**

从 `server/internal/hub/tools/npm.go` 读取 `runtimeNPMPackages`，解析字符串常量别名、包名、显示名、agent 类型、binary name、kind 和私有 registry 特例；只输出 `kind == runtime` 的活动包，并给出稳定 changelog 文件名。无效或重复 policy 以非零状态退出。

- [ ] **Step 2: Implement `validate_changelog.py`**

复用 policy 提取逻辑，检查每个活动包存在且仅存在对应文件；解析 `##` semver 标题，拒绝重复版本和非降序章节；检查每个版本拥有 `### WheelMaker integration`，并报告缺失文件、重复版本、空版本章节和未清理占位文本。

- [ ] **Step 3: Run the helper tests to verify GREEN**

Run:

```powershell
python -m unittest discover -s .agents/skills/npm-changelog/scripts/tests -v
```

Expected: all helper tests pass.

- [ ] **Step 4: Write the skill workflow and references**

`SKILL.md` 必须说明：读取仓库 `CLAUDE.md`、动态读取 npm policy、增量/首次 10 版本规则、开源 Git/changelog 路径、闭源 npm tarball diff 路径、`@myflicker/cli` 私有 registry、中文 CHANGELOG 分类、WheelMaker integration 检查点、失败时不猜测且 best-effort、写入前检查 Git 状态和完成后的验证命令。详细模板和接入检查项放入两个 reference 文件。

- [ ] **Step 5: Validate skill metadata and helper entrypoints**

Run:

```powershell
python C:\Users\suweimin\.codex\skills\.system\skill-creator\scripts\quick_validate.py .agents/skills/npm-changelog
python .agents/skills/npm-changelog/scripts/inspect_npm_policy.py .
```

Expected: skill validator reports valid；policy JSON contains exactly the 9 active package names from `npm.go`.

### Task 3: Create the changelog directory and documentation index

**Files:**
- Create: `docs/changelog/`
- Modify: `docs/README.md`

**Acceptance:** `docs/README.md` lists `changelog/` as external dependency version history, and the directory is ready to contain one file per active package.

- [ ] **Step 1: Add the documentation entry**

在 `docs/README.md` 的文档分区中增加 `changelog/` 入口，说明内容为 WheelMaker 关注的 agent npm 版本变更与接入注意事项。

- [ ] **Step 2: Run the helper structure check before data import**

Run:

```powershell
python .agents/skills/npm-changelog/scripts/validate_changelog.py .
```

Expected: it reports the expected missing package files without modifying any file.

### Task 4: Research and write the 9 package changelogs

**Files:**
- Create: `docs/changelog/agentclientprotocol--claude-agent-acp.md`
- Create: `docs/changelog/anthropic-ai--claude-code.md`
- Create: `docs/changelog/openai--codex.md`
- Create: `docs/changelog/github--copilot.md`
- Create: `docs/changelog/opencode-ai.md`
- Create: `docs/changelog/tencent-ai--codebuddy-code.md`
- Create: `docs/changelog/moonshot-ai--kimi-code.md`
- Create: `docs/changelog/qodercn-ai--qoderclicn.md`
- Create: `docs/changelog/myflicker--cli.md`

**Acceptance:** 每个活动包有一份中文 changelog；无既有记录时包含最新 10 个可获得版本，版本从新到旧排列，每个版本有适用的传统分类和 `WheelMaker integration`。

- [ ] **Step 1: Build the version/source matrix**

运行 `inspect_npm_policy.py`，为每个包读取 npm metadata 和 latest dist-tag；解析已有文件（当前为空）并确定最新 10 个版本。对每个包记录研究所需的 registry、repository、官方 changelog 和 tarball 地址；`@myflicker/cli` 使用 `npm.go` 私有 registry，不能用 public registry 结果替代。

- [ ] **Step 2: Research public-source packages**

对 repository 可访问的包，核对官方 changelog、release/tag 和相关 Git 提交，按版本整理新增、修改、修复、弃用、安全和 CLI/API/engine 变化；只把能支持 WheelMaker 接入判断的内容写入 changelog。

- [ ] **Step 3: Research packages without accessible public source**

使用 `npm pack <package>@<version> --pack-destination <temporary-directory>` 下载相邻版本，解压后比较 `package.json`、bin/入口、运行时代码、依赖、内置资源和 engine 字段；过滤压缩包时间戳与生成噪声，再把实际可见的变化整理为中文版本条目。

- [ ] **Step 4: Analyze WheelMaker integration impact**

逐包回看 `server/internal/hub/tools/npm.go` 的 policy、全局安装/更新/重装动作、binary lookup 和 registry 选择，并按需要检查对应 ACP provider/agent 启动配置；在每个版本的 `WheelMaker integration` 中给出“无需动作、需回归验证、需调整接入或暂不建议升级”的判断及理由。

- [ ] **Step 5: Write all 9 Markdown files**

使用 `references/changelog-format.md` 的模板，版本章节最新在前；不为没有可靠依据的细节编造结论，不要求逐条变更附来源注释，不删除未来可继续增量使用的结构。

### Task 5: Validate content, update plan, and checkpoint the implementation

**Files:**
- Modify: `docs/plans/2026-08-18-npm-changelog/plan-npm-changelog.md`

**Acceptance:** helper tests、skill validator、policy extraction、changelog validator 和 Markdown whitespace checks 全部通过；计划勾选与实际结果一致，并创建实现 checkpoint。

- [ ] **Step 1: Run focused verification**

```powershell
python -m unittest discover -s .agents/skills/npm-changelog/scripts/tests -v
python C:\Users\suweimin\.codex\skills\.system\skill-creator\scripts\quick_validate.py .agents/skills/npm-changelog
python .agents/skills/npm-changelog/scripts/inspect_npm_policy.py .
python .agents/skills/npm-changelog/scripts/validate_changelog.py .
git diff --check
```

Expected: all commands exit 0；policy contains 9 packages；changelog validator finds 9 valid files and no duplicate versions.

- [ ] **Step 2: Run relevant project checks**

由于本任务只新增 skill、Python helper 和 Markdown，不修改 Go/TypeScript 行为；运行 helper tests 和 metadata/content validation 即为主验证，不执行完整 Web 构建或 Go 全量测试。

- [ ] **Step 3: Review diff and checkpoint**

检查 `git status --short`、`git diff --stat` 和新文件内容，仅 stage 本任务文件；调用 `git-workflow` checkpoint，记录实现 commit hash 和 subject。

### Task 6: Finalize the prepared Git workflow

**Files:**
- Modify: none beyond completed task files.

**Acceptance:** finalize 根据真实验证结果完成 commit、push、main 合并和 cleanup 偏好；若无法执行其中一项，报告具体原因而不宣称全部完成。

- [ ] **Step 1: Re-run final acceptance checks**

使用 Task 5 的命令和最终 `git status -sb`/diff 检查，确认没有任务外文件被 stage。

- [ ] **Step 2: Invoke `git-workflow` finalize**

传入 `complete` 及逐项验收证据，继承 `spec/npm-changelog-0818` 的 prepared Git 上下文，按偏好 push 当前分支，条件满足时合入 `main` 并清理 worktree/分支。
