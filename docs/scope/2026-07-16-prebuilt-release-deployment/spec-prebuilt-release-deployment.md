> 由 scope skill 于 2026-07-16 生成

# WheelMaker 预构建发布与部署

## 目标

WheelMaker 目前在目标机器上依赖私有源码、Git、Go 和 npm 拉取与构建。新流程应由发布端生成经过签名的预构建 Hub + Web 产物，目标机器仅依赖 Node.js 22+ 从公开仓库下载和部署；私有源码不向部署目标或公开仓库暴露。

## 决策

- 私有 `WheelMaker` 源码仓库保留所有源码、发布 MJS 和部署 MJS 源码；单独的公开 GitHub release 仓库存放复制后的 `deploy.mjs`、`deploy-core.mjs`、已签名 `stable.json` 和 GitHub Releases。
- 发布版本严格为 `v1.x`，每次成功发布只递增 `x`；stable 记录版本、UTC 发布时间和私有源码 SHA，不维护 changelog。
- 每个版本发布 Windows amd64、Linux amd64、macOS arm64 三份完整 `.tar.gz`。每份始终包含对应 Hub 和 Web；不发布 macOS amd64。
- Desktop `WheelMakerDesktop.exe` 是可选资产。`with_desktop` 决定本轮是否自动构建它；未构建时 stable 继承上一次实际发布的 Desktop 指针。
- 本地发布直接通过 GitHub API 上传，并以 Windows 为正式支持的发布主机；它不要求 Linux、WSL 或 Unix shell，且在 Windows 上交叉编译三份 Hub。私有仓库 Action 仅作手动兜底，使用单个 Ubuntu job，Web 只构建一次，Hub 与 Desktop 均交叉编译。
- GitHub App 只安装到公开 release 仓库、只用于写 Contents/Releases；独立 Ed25519 私钥签名 stable 和 release manifest。目标端内置公钥，绝不因 App 上传权限而跳过签名验证。
- 发布过程先公开 Release，再写 stable；失败时 stable 不变，并把公开 `publish-status.json` 写为不含敏感信息的失败状态。Release tag 冲突通过重新读取 stable 并分配下一个版本解决，不维护持久发布锁。
- 所有 MJS 均由私有源码仓库维护、发布时复制到公开 Git。小型 `deploy.mjs` 每次验证 stable，按需更新自身与 `deploy-core.mjs`，然后执行 core；MJS 不放进平台包。
- 目标端公开入口只有 `node deploy.mjs`、一次性 `node deploy.mjs migrate-uninstall` 和独立 `update_exe.bat`。`node deploy.mjs update` 是 Hub 与系统任务使用的内部入口。
- 保持既有安装布局：Hub 位于 `~/.wheelmaker/bin/`，Web 位于 `~/.wheelmaker/web/`，Desktop 位于 `~/.wheelmaker/desktop/`；不引入 `app/` 目录。继续生成既有 start/stop/restart/status 的 `.bat` 与 `.sh` 包装脚本，并由内部运行时操作驱动当前用户注册项。
- 新版仅以当前用户身份运行：Windows 计划任务、macOS LaunchAgent、Linux systemd user unit。内部 update 只替换 Hub/Web 文件并重启既有运行项，不安装、删除或改写运行注册，因此无需管理员权限。
- Web 更新请求由 Hub 原子创建 `staging/lock.json`，触发既有 updater 任务并立即返回 jobId；`status.json` 持久保存最近一次进度/结果。重复请求复用同一 job。
- 成功部署写入 schema v2 的 `~/.wheelmaker/release.json`，记录已安装的发布版本、发布时间、sourceSha、manifestSha256 和安装时间。Hub 查询已签名公开 stable 后，以本机版本与 stable 版本判断更新状态；App 不再依据本机 Git SHA、分支或提交差异推断当前版本。
- 旧版迁移只通过 `migrate-uninstall` 清理旧 Hub/monitor/updater 服务、任务与 EXE，保留配置、数据库和日志。旧 Windows 系统服务的删除可请求管理员权限；正常部署不再探测或兼容旧模式。
- `update_exe.bat` 验签 stable 的独立 Desktop 指针，且 Desktop 正在运行时只提示用户退出后重试，不使用后台自替换助手。

## 架构

```text
私有源码仓库                         公开 release 仓库
release.mjs ──签名/上传────────────→ deploy.mjs / deploy-core.mjs
   │                                → stable.json + .sig
   └─构建 Hub + Web + 可选 Desktop ─→ GitHub Release assets

目标机器
deploy.mjs → 验签 stable → 更新 core → 下载/验签 manifest 与平台包
          → ~/.wheelmaker/bin/ + web/ → 当前用户 Hub 运行项
```

目标目录为 `~/.wheelmaker/`：`bin/` 保存 Hub、`web/` 保存静态站点、`desktop/` 保存 Desktop EXE，根目录保存 launcher、core、配置、release 元数据和既有运行包装脚本；`staging/` 是下载工作区，也保存短生命周期 `lock.json` 与持久 `status.json`。

## 流程

### 发布

发布脚本校验源码 SHA 后读取 stable、分配下一个 `v1.x`，构建一次 Web，交叉编译三个 Hub，按需构建 Desktop，生成 tar.gz、manifest、哈希和签名。它将 MJS 提交到公开 Git，创建并上传草稿 Release，公开 Release，最后提交 stable 与签名。本地运行以 Windows 为正式环境；手动 Action 则在 Ubuntu 执行相同流程。

Action 使用 `workflow_dispatch` 的 commit ref 和 `with_desktop` 布尔值；使用 `app/package-lock.json` 的 npm 缓存及 `server/go.sum` 的 Go 缓存，不缓存凭据或 `node_modules`。

### 安装与更新

普通 `node deploy.mjs` 下载并验证当前平台包，应用 Hub 到 `bin/`、Web 到 `web/` 后创建或修复当前用户运行项和 start/stop/restart/status 包装脚本，并确保每日本地时间 03:00 的 updater 任务存在。更新时先下载、校验、解压到 `staging/<job-id>`；旧 Hub 正常退出后替换 `bin/` 与 `web/`，重写 schema v2 `release.json`，再触发现有 Hub 运行项。失败写入状态但不回滚。

Web 不同步执行更新：Hub 先创建 queued lock、触发系统 updater，再返回 accepted/jobId。updater 执行内部 `deploy.mjs update`，接管该 lock，写入下载、验证、应用、重启及终态状态。lock 在终态删除，status 保留到下一轮覆盖。

Hub 的查询接口同时读取本机 `release.json` 和已验签公开 `stable.json`，将当前安装版本与最新 stable 版本传给 App。App 不再查询 Git remote、分支或 behind/ahead 提交数。

### 迁移与 Desktop

旧用户先让 `deploy.bat` 或 `deploy.sh` 复制 launcher，然后执行 `migrate-uninstall`，最后执行普通 deploy。迁移只删除旧运行项和旧 EXE，不删除用户数据。

Desktop 更新独立于当前 Hub stable：即使当前 Hub 版本不含 EXE，`update_exe.bat` 也使用 stable 中继承的最近 EXE 指针下载正确资产。

## 验收标准

- 无 Git、Go、npm 的三平台目标端可仅凭 Node.js 22+ 完成安装和更新。
- 任一 stable、manifest、MJS 或 tar.gz 的签名/哈希无效时，目标端不执行脚本、不解压资产、不替换 `bin/` 或 `web/`。
- 每个 tar.gz 都含 Hub 与 Web；目标端部署从不运行 Web 构建。
- Web 重复触发只产生一个更新 job；Hub 被替换前已向调用方返回 accepted。
- 内部 update 不修改 Windows 计划任务、LaunchAgent 或 systemd user unit，且无需管理员权限。
- 成功安装始终保持 `bin/`、`web/`、`desktop/` 与 start/stop/restart/status 包装脚本的既有路径；不产生 `app/` 目录。
- 迁移清除旧 updater/monitor/服务但保留配置、数据库和日志。
- 后续不带 EXE 的 stable 仍可通过 `update_exe.bat` 下载之前最近发布的 Desktop EXE。
- App 用本机 schema v2 `release.json` 与已验签 stable 显示当前/最新版本，不再显示 Git SHA、分支或提交差异。
- 手动 Action 在一个 Ubuntu job 内完成三平台构建；缓存命中时不重复下载 Go/npm 依赖。

### 测试

- Node 单元测试覆盖版本递增、Ed25519 原始字节签名、SHA-256、恶意 tar 拒绝、staging 锁和状态转换。
- Go 测试覆盖 Hub 的 update request/query、同 job 去重与正常退出交接。
- Web 测试覆盖 queued/running/succeeded/failed 状态呈现，不再显示 Git 拉取或源码构建信息。
- 发布 CI 进行三目标交叉编译、可选 Desktop 编译和本地产物目录验证；公开发布前验证 manifest/stable 签名。

## 范围之外

- 自动备份、自动回滚和版本回退 UI。
- Android 发布迁移。
- macOS amd64 产物。
- 正常部署流程中的旧服务探测、旧源码部署兼容或常驻 Go updater/bootstrap/monitor。
- 公开仓库中的私有源码、构建日志、签名私钥、GitHub App 私钥或 token。
