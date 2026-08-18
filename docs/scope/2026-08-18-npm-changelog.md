> 由 scope skill 于 2026-08-18 生成
> 状态：已批准 2026-08-18

# WheelMaker npm 版本变更追踪 skill

## 目标

创建一个项目级 skill，持续追踪 WheelMaker 通过 Hub npm 管理的 agent runtime 包，并把版本变更整理为中文传统 CHANGELOG。每次运行根据已有记录或首次运行规则补齐版本，重点说明对 WheelMaker 安装、更新、启动和 ACP 接入的影响。

## 决策基线

### 需求边界

- 关注清单唯一来源是 `server/internal/hub/tools/npm.go` 的 `runtimeNPMPackages`，当前为 9 个活动包：
  - `@agentclientprotocol/claude-agent-acp`
  - `@anthropic-ai/claude-code`
  - `@openai/codex`
  - `@github/copilot`
  - `opencode-ai`
  - `@tencent-ai/codebuddy-code`
  - `@moonshot-ai/kimi-code`
  - `@qodercn-ai/qoderclicn`
  - `@myflicker/cli`
- 不追踪 `app/package.json` 的仓库构建依赖，不为 `deprecatedNPMPackages` 中的两个废弃包建档。
- 在 `docs/changelog/` 中为每个关注包建立一个 Markdown 文件，内容使用中文；npm 包名、版本号、代码标识符保持原样。
- 已有记录时，从该文件最后记录的版本开始逐版本补齐到当前最新版本；没有记录时，记录当前可用的最新 10 个版本。可用版本少于 10 个时记录全部可获得版本。
- 每个版本使用传统 CHANGELOG 分类，至少包含适用的 `Added`、`Changed`、`Fixed`、`Deprecated`、`Removed`、`Security` 和 `WheelMaker integration`。
- 开源包必须结合公开 Git 源码、提交/标签记录和官方 changelog；没有可验证公开源码的包使用 npm 发布包的版本间代码与元数据 diff。研究时使用来源交叉验证，但 changelog 不要求每条结论附链接、commit、发布日期或证据说明。
- 变更摘要必须落到 WheelMaker 接入语境：npm 安装/更新/重装、全局 bin、Node/npm engine、ACP provider、CLI 参数、环境变量、认证、配置、模型/能力声明、兼容性、安全性和运行时行为等。与 WheelMaker 无关的上游变化可以简短记录。
- 首次实施包含一次当前数据抓取并填充 9 份 changelog；后续 skill 只增量更新，不删除已有版本记录。
- 网络、Git、npm registry 或私有 registry 不可用时，不猜测变更；单个包失败不阻塞其他包，已有文档保持不变，并在运行结果中说明失败包。
- 本任务不修改 WheelMaker npm 安装逻辑、HubState、Registry protocol version、ACP 协议或运行时包版本。

### 技术决策

- skill 放在项目目录 `.agents/skills/npm-changelog`，使用标准 `SKILL.md` frontmatter，并生成 `agents/openai.yaml` 元数据；按 `skill-creator` 要求通过 `init_skill.py` 初始化并用 `quick_validate.py` 校验。
- skill 每次运行先读取 `npm.go` 的活动 `runtimeNPMPackages`，避免把包名清单复制成另一份长期事实；同时读取每个 policy 的显示名、agent 类型、binary name 和 registry 特例。
- 版本边界以 changelog 文件中的最新版本标题为状态，不新增独立版本锁文件。版本标题按最新在前排列，更新时保持既有内容和顺序。
- 包文件名采用稳定编码：去掉 `@`，将 scope 与包名之间的 `/` 替换为 `--`，例如 `@openai/codex` 对应 `openai--codex.md`；无 scope 的包直接使用包名。
- 开源/闭源判断先读取 npm metadata 的 repository 与发布信息；公开仓库可访问时走 Git/changelog 路径，否则走 npm tarball diff。`@myflicker/cli` 继续使用 `npm.go` 中的私有 registry 配置；其他包使用 npm public registry。
- 闭源 diff 以相邻已发布版本的 npm tarball 为输入，过滤压缩包时间戳、生成目录和纯元数据噪声后，分析实际源码、入口、依赖、CLI 资源和 package metadata 的变化。
- skill 的结果以可读的 Markdown 版本条目为主，不强制输出逐条来源注释；只有来源缺失会改变 WheelMaker 接入判断时，才在 `WheelMaker integration` 中说明限制。

## 设计视图

### 功能设计

skill 触发后读取 WheelMaker npm policy 和 `docs/changelog/` 现状，为每个活动包计算本次需要覆盖的版本范围。对每个版本收集上游变更，按传统分类翻译为中文，并补充 WheelMaker integration 判断，例如“无需动作”“需回归验证”“需调整 provider/启动参数”或“暂不建议升级”。完成后写回对应包文件，保留历史条目和未涉及的分类空缺。

首次运行没有包文件时，为每个包建立标题和最新 10 个版本；已有文件只插入缺失版本，不重复生成。某一包数据获取失败时，继续处理其他包，并保留该包已有内容。

### 技术设计

#### 整体方案

```text
runtimeNPMPackages in npm.go
          │
          ▼
  package/version planner ──► docs/changelog/<package>.md
          │
          ├─ public Git + official changelog
          └─ npm registry + tarball diff
          │
          ▼
  WheelMaker integration analysis
```

skill 指导 Codex 先建立包与版本计划，再按包选择公开 Git 或 npm tarball 工作流，最后用 `npm.go` 中的 policy 和相关 agent/provider 代码校验接入影响。确定性强的包清单解析、版本排序和 tarball diff 可放入 skill `scripts/`，外部来源判断和语义分析由 Codex 完成。

#### 关键结构

每份 changelog 包含包标题、追踪元信息和按版本倒序排列的版本章节。版本章节只写实际适用的分类；`WheelMaker integration` 必须存在并给出升级行动判断。文件状态由版本标题承载，不持久化额外运行数据库。

#### 实现流程

1. 读取 `npm.go`，提取活动 runtime package policy 和 registry 特例。
2. 扫描 `docs/changelog/`，解析每个包文件最新版本；不存在时将目标范围设为最新 10 个版本。
3. 获取版本列表、发布日期和变更材料；公开仓库优先核对 Git tags/commits 与官方 changelog，闭源包比较 npm tarball。
4. 将变更归类并结合 WheelMaker 安装、Hub npm action、agent binary、ACP provider 和启动配置分析兼容影响。
5. 以中文写入新增版本章节，避免重复版本和无证据猜测；单包失败不回滚其他成功包。
6. 运行 skill 校验、结构检查和代表性数据检查，报告新增版本、无更新包及失败包。

### 预估改动面

- `.agents/skills/npm-changelog/`：新 skill 的 `SKILL.md`、`agents/openai.yaml` 和必要的确定性辅助脚本/参考文件。
- `docs/changelog/`：9 个活动 npm 包各一份中文 changelog，并完成首次数据填充。
- `docs/README.md`：补充 `changelog/` 文档入口说明。
- 不修改 `server/`、`app/` 的产品代码或协议文件。
- 验证范围包括 skill frontmatter/元数据校验、包清单解析、版本边界与重复检测、tarball diff 代表性运行，以及 changelog 结构检查。
- wiki：不更新 `docs/wiki`。

## 验收

- `npm.go` 的 9 个活动 runtime 包均有对应 `docs/changelog/` 文件；两个 deprecated 包和 `app/package.json` 依赖没有被纳入。
- 空记录包首次运行包含最新 10 个可获得版本；已有记录包只增加最后版本之后的缺失版本，版本章节不重复且最新在前。
- 开源包的研究流程确实检查公开 Git 与官方 changelog；闭源包的研究流程确实比较 npm tarball，而不是用猜测替代源码分析。
- 每个版本章节使用中文传统分类，并包含对 WheelMaker 安装/更新/启动/ACP 接入影响的分析和明确行动判断。
- registry、Git 或 tarball 获取失败时不会生成虚构变更；其他包仍可继续处理，已有 changelog 不被破坏。
- skill 通过 `quick_validate.py`；辅助脚本代表性运行成功；文档目录入口和 9 份 changelog 的 Markdown 结构检查通过。
- 任务不产生 protocol version、npm 安装逻辑或现有产品行为变化。
