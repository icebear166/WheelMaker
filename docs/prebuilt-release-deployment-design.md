# WheelMaker 预构建发布与部署设计

日期：2026-07-16  
状态：已实施

## 目标

将 WheelMaker 从“目标机器拉取私有源码、安装构建工具并现场编译”的发布方式，迁移为“发布端构建、目标机器下载预构建产物”的方式。

部署目标机器只需要 Node.js 22+，不需要 Git、Go、npm、私有源码访问权限或 GitHub CLI。源码仓库保持私有；可公开下载的部署控制文件和二进制资产位于单独的公开 GitHub release 仓库。

本设计取代以下旧流程：

- `wheelmaker-deploy` Go CLI 的源码拉取、npm、Go 构建与服务配置职责；
- `wheelmaker-updater` 常驻 Go 进程和 `update-now.signal` 轮询机制；
- Hub/Monitor/Updater 三个常驻程序的组合。

旧设计文档保留作历史记录，不再是新部署的实现依据：

- `docs/superpowers/specs/2026-05-30-wheelmaker-deploy-cli-design.md`
- `docs/superpowers/specs/2026-05-19-wheelmaker-update-publish-design.md`

## 已确认的边界

- 发布版本只使用 `v1.x`，每次成功发布将 `x` 加一。
- 发布版本必须记录 UTC 发布时间和私有源码 commit SHA；不维护 changelog。
- 发布物目标为 Windows amd64、Linux amd64、macOS arm64；不发布 macOS amd64。
- 每个平台只有一份完整 `.tar.gz`，其中始终包含 Hub 和 Web。即使配置不监听 Web，也始终下载、部署 Web。
- Desktop 的 `WheelMakerDesktop.exe` 是可选发布资产；它与 Hub/Web 当前版本独立追踪。
- Android 不属于本次发布/部署迁移范围，保持现有独立流程。
- 不做自动备份或自动回滚。失败保留失败状态，修复后由下一次更新重试。
- 目标端的公开入口只有 `node deploy.mjs` 和一次性迁移命令 `node deploy.mjs migrate-uninstall`。`update` 是 Hub 和系统任务使用的内部入口。

## 仓库与信任模型

```text
私有 WheelMaker 源码仓库
  ├─ Go Hub、Web、Desktop 源码
  ├─ 所有 deploy/release MJS 源码
  ├─ scripts/release.mjs
  └─ 手动 workflow_dispatch 发布工作流

公开 wheelmaker-release 仓库
  ├─ deploy.mjs / deploy-core.mjs（由发布流程复制）
  ├─ stable.json
  ├─ publish-status.json
  └─ GitHub Releases
       ├─ 三个平台 tar.gz
       ├─ release-manifest.json
       └─ 可选 WheelMakerDesktop.exe
```

Action 使用一个 GitHub App 向公开仓库写入 Contents 和 Releases。该 App 只安装到公开仓库，不能读取私有源码仓库；本地发布则复用操作员已登录的 `gh auth token`，不保存额外私钥文件。两条路径都只在发布进程内持有临时 token。

发布仓库的 GitHub HTTPS 内容与写权限是发布信任边界，不再维护独立 Ed25519 密钥和 `.sig` 文件。目标端按以下顺序验证内容完整性：

1. 通过固定 GitHub HTTPS 地址下载并校验 `stable.json` schema；
2. 使用 stable 中的 SHA-256 验证 `deploy.mjs`、`deploy-core.mjs` 和 `release-manifest.json`；
3. 使用 manifest 中的大小与 SHA-256 验证当前平台压缩包；
4. 仅在完整压缩包验证成功后解压和部署。

因此公开仓库写权限可直接改变 stable，必须严格限制仓库管理员和 GitHub App 权限。JSON 仍由发布脚本以确定的 UTF-8、无 BOM、末尾单个换行方式写出，以便精确计算 SHA-256。

## 公共控制文件

### stable.json

`stable.json` 是唯一的部署控制面；它必须来自固定的公开仓库 HTTPS 地址并通过 schema 校验。示例：

```json
{
  "schema": 1,
  "version": "v1.23",
  "publishedAt": "2026-07-16T09:00:00Z",
  "sourceSha": "0123456789abcdef0123456789abcdef01234567",
  "deploy": {
    "mjsUrl": "https://raw.githubusercontent.com/<owner>/<repo>/<commit>/deploy.mjs",
    "mjsSha256": "<sha256>",
    "coreUrl": "https://raw.githubusercontent.com/<owner>/<repo>/<commit>/deploy-core.mjs",
    "coreSha256": "<sha256>"
  },
  "release": {
    "manifestUrl": "https://github.com/<owner>/<repo>/releases/download/v1.23/release-manifest.json",
    "manifestSha256": "<sha256>"
  },
  "desktopExe": {
    "version": "v1.21",
    "url": "https://github.com/<owner>/<repo>/releases/download/v1.21/WheelMakerDesktop.exe",
    "sha256": "<sha256>"
  }
}
```

`deploy.*Url` 必须固定到公开仓库的 commit SHA，而不是可变分支名。`desktopExe` 在某次发布未构建 Desktop 时原样继承，所以 stable 从 v1.21 更新到 v1.23 后，仍能获取 v1.21 的最近 Desktop EXE。

### release-manifest.json

manifest 记录当前版本的三个完整资产、大小和 SHA-256。它不包含 MJS：MJS 是公开 Git 中独立维护、由 stable 指向的控制文件。

```json
{
  "schema": 1,
  "version": "v1.23",
  "publishedAt": "2026-07-16T09:00:00Z",
  "sourceSha": "0123456789abcdef0123456789abcdef01234567",
  "artifacts": {
    "windows-amd64": { "url": "...", "sha256": "...", "size": 0 },
    "linux-amd64": { "url": "...", "sha256": "...", "size": 0 },
    "darwin-arm64": { "url": "...", "sha256": "...", "size": 0 }
  }
}
```

### publish-status.json

此文件仅供 Web 显示发布进度，绝不作为部署信任来源。内容不得包含日志、路径、token、私有仓库名或错误堆栈。

```json
{
  "schema": 1,
  "state": "running",
  "phase": "packaging",
  "version": "v1.23",
  "sourceSha": "0123456789abcdef0123456789abcdef01234567",
  "publisher": "local",
  "startedAt": "2026-07-16T09:00:00Z",
  "updatedAt": "2026-07-16T09:02:00Z"
}
```

允许的 phase 是 `validating`、`packaging`、`uploading`、`publishing-release`、`updating-stable`。本地/Action 构建发生在建立发布客户端之前，不写远程状态。终态为 `succeeded` 或 `failed`；失败状态保留到下一轮发布覆盖，并只包含通用错误码。

## 发布物与本地构建

每份 tar.gz 的解压目录与未发布本地构建输出完全一致：

```text
wheelmaker-v1.23-windows-amd64/
  hub/
    wheelmaker.exe
  web/
    ...静态站点文件...
```

本地构建模式只生成上述目录，不访问 GitHub、不上传、不修改 `stable.json`。选择 public 发布时，同一次 MJS 调用将刚生成的平台目录打包为 `.tar.gz`、写 manifest 并发布，不保存或复用跨命令的构建记录。

解压实现必须使用 Node 标准库并拒绝绝对路径、`..` 路径穿越、符号链接、硬链接和超过预设文件数/总大小上限的条目。目标端先校验完整压缩包哈希，再解压。

## 发布流程

发布脚本只在私有源码仓库中存在。它支持本地直接发布和私有仓库中手动触发的 GitHub Action；二者调用相同 MJS 逻辑。本地发布以 Windows 为正式支持环境，不要求发布者使用 Linux、WSL 或 Unix shell；Windows 主机交叉编译三个 Hub 目标。Ubuntu 仅是手动 Action 的运行环境。

```text
validate source SHA
  → 构建一次 Web
  → 在当前发布环境交叉编译三个 Hub 目标
  → 可选构建 Desktop EXE
  → 若未选择 public：保留本地产物并结束
  → 若选择 public：读取 stable，计算下一个 v1.x
  → 由本轮平台目录生成 tar.gz、SHA-256 和 manifest
  → 将 deploy.mjs/deploy-core.mjs 提交到公开 Git
  → 创建草稿 Release 并上传资产
  → 发布 Release
  → 最后提交 stable.json
```

本地 public 发布要求工作树干净，并使用 `gh auth token` 写入公开仓库。Action 使用 `workflow_dispatch` 的必填 `ref`，在一个 MJS 进程内完成构建和发布。没有 Release 资产成功公开之前，禁止更新 stable。

Windows 提供两个交互入口：`publish-release.bat` 依次询问是否包含 Desktop、是否发布到 public 仓库；`publish-release-action.bat` 要求当前干净 commit 已推送，询问 Desktop 后触发当前分支的 workflow。

发布不设置持久化自定义锁。GitHub Release tag 的唯一性是并发仲裁：若创建草稿时 tag 冲突，发布器重新读取 stable，取得下一个版本后重试。失败时删除本轮草稿；下一轮开始前清理超过两小时的同类草稿。

### Desktop EXE

`with_desktop` 是发布输入，不接收用户指定的 EXE 文件路径：

- `false`：不构建、不上传 EXE，继承旧 `desktopExe` 指针；
- `true`：发布脚本调用 Go 和 `go-winres` 自动生成 `WheelMakerDesktop.exe`，上传到本次 Release，更新 `desktopExe` 指针。本地 Windows 发布在 Windows 主机构建；Action 在 Ubuntu 上交叉编译。

Desktop 构建逻辑完全位于发布 MJS。发布端不运行 Desktop 应用、不创建桌面快捷方式，也不要求 WebView2。

### Action 时间控制

- 默认发布优先在本地执行，零 runner 消耗；Action 是手动兜底。
- Action 使用单个 Ubuntu job，不使用平台 matrix，不上传/下载中间 Actions artifact。
- Web 只运行一次 `npm ci` 和一次生产构建，产物复制到三个包。
- 使用 `setup-node` 的 npm 缓存（`app/package-lock.json`）和 `setup-go` 的 Go 缓存（`server/go.sum`）。不缓存 `node_modules`、App 私钥或 token。
- `with_desktop=false` 时跳过 Desktop 构建；`true` 时仍在该 Ubuntu job 内交叉编译。

## 目标端部署

### 安装目录与脚本更新

```text
~/.wheelmaker/
  bin/
    wheelmaker(.exe)
  web/
    ...静态站点文件...
  desktop/
    WheelMakerDesktop.exe
  deploy.mjs
  deploy-core.mjs
  staging/
    lock.json
    status.json
    <job-id>/
  config.json
  release.json
  deploy.bat
  start.bat / stop.bat / restart.bat / status.bat
  deploy.sh
  start.sh  / stop.sh  / restart.sh  / status.sh
```

公开 `deploy.mjs` 是小型启动器，源码在私有源码仓库维护、由发布流程复制到公开 Git。每次调用它时：

1. 从固定 GitHub HTTPS 地址下载并校验 stable schema；
2. 若 stable 指向的 `deploy.mjs` 或 `deploy-core.mjs` 哈希变化，下载到临时文件、验证哈希后替换本地副本；
3. 当前进程执行已加载的 `deploy-core.mjs`。启动器在本轮被替换时，新启动器从下一次调用生效；
4. core 下载、验证和解压当前平台资产，并执行安装或内部更新流程。

MJS 不放进平台包；产品包只包含 Hub 与 Web。`staging` 是唯一的更新工作区，同时保存锁和状态；不再使用独立 `update/` 目录。普通部署和内部更新分别将包中的 Hub/Web 应用到既有 `bin/` 和 `web/`，绝不引入 `app/` 这一层；`desktop/` 只由独立 Desktop 更新流程管理。

### 公开与内部入口

```text
node deploy.mjs                       日常安装或更新
deploy.bat / deploy.sh                当前平台的日常部署包装脚本
node deploy.mjs migrate-uninstall     一次性旧版清理
node deploy.mjs update                仅供 Hub/系统任务调用
update_exe.bat                        更新可选 Desktop EXE
```

不提供 `schedule`、`history`、`status` 或单独 `install` 命令。历史由 Web 直接读取公开 GitHub Releases API；状态由 Hub 读取本机 `staging/status.json`；日程固定为本地时间每天 03:00。

普通部署同时生成当前平台的 `deploy.bat` 或 `deploy.sh`，只调用 `node deploy.mjs`，不进入迁移或内部更新模式；Windows wrapper 在 Node 结束后暂停，保证双击时能看到结果。继续生成既有生命周期包装脚本：Windows 的 `start.bat`、`stop.bat`、`restart.bat`、`status.bat`，以及 macOS/Linux 的同名 `.sh` 文件。它们调用 core 的内部运行时操作，以当前平台的既有任务、LaunchAgent 或 user unit 执行启动、停止、重启、状态查询；这些内部操作不是面向用户的 deploy 子命令。普通部署每次都修复这些包装脚本。

### 当前用户运行模型

新安装统一以当前用户运行，避免“用户可写目录 + 高权限系统服务”导致的权限提升风险：

| 平台 | Hub | 每日更新 |
| --- | --- | --- |
| Windows | 当前用户计划任务 `WheelMaker`，登录触发并在退出时重启 | `WheelMakerUpdater` 计划任务，每日 03:00 |
| macOS | `com.wheelmaker.hub` LaunchAgent，KeepAlive | `com.wheelmaker.updater` LaunchAgent，日历触发 |
| Linux | `wheelmaker-hub.service` systemd user service | `wheelmaker-updater.timer` + service |

普通新部署只创建上述当前用户注册项。内部 `update` 严格禁止创建、删除或改写计划任务、LaunchAgent 或 systemd unit，因此不需要管理员权限。

更新先在 `staging/<job-id>` 下载、校验和解压；然后请求旧 Hub 正常退出，替换 `bin/` 中的 Hub 和 `web/` 中的静态站点，触发既有 Hub 任务重新启动。失败后写入状态，不自动回滚。

每次成功应用包后，core 重写既有 `~/.wheelmaker/release.json`，将其升级为预构建安装元数据：

```json
{
  "schemaVersion": 2,
  "version": "v1.23",
  "publishedAt": "2026-07-16T09:00:00Z",
  "sourceSha": "<private-source-sha>",
  "manifestSha256": "<sha256>",
  "installedAt": "2026-07-16T09:10:00Z"
}
```

它是 App 判断“当前已安装版本”的唯一来源，不再记录本机源码仓库、分支、remote 或 Git SHA 推导字段。

### Web 触发与安装锁

Web 不能同步等待或直接替换 Hub。Web 调用 Hub 的受控 update 接口；Hub 原子创建 `staging/lock.json`（状态为 `queued`）并启动既有 updater 任务，然后立即返回 `accepted` 与 jobId。任务运行 `node deploy.mjs update`，接管 queued job 并更新状态。

```text
Web → Hub update API → 原子创建 lock → 触发 OS updater task
    → deploy.mjs update → 旧 Hub 退出 → 替换 bin/web → 触发 Hub task
```

`lock.json` 是短生命周期互斥租约，包含 jobId、owner、开始时间和心跳；成功或失败时删除。重复点击返回同一 job 的状态，不能启动第二个更新。过期锁只有在确认对应任务未运行时才可回收。

`status.json` 是持久的最近一次状态，包含 jobId、`queued|downloading|verifying|applying|restarting|succeeded|failed`、时间和无敏感信息的错误码。它在任务结束后保留，直至下一次任务覆盖。

### App 版本判断

Hub 的 `cmd.update.query` 读取本机 `release.json`，并从固定公开仓库拉取、校验 `stable.json` schema。响应包含 `installed` 与 `stable` 的版本、发布时间和 sourceSha，而不再包含 Git remote、分支、behind/ahead count 或工作树状态。App 以 `installed.version === stable.version` 判断 `up_to_date`，版本不同判断 `update_available`；存在 lock 时显示 queued/running 状态；stable 获取或解析失败显示 `checking_failed`。部署 MJS 仍独立下载 stable 并验证后续 SHA-256 链，UI 查询不能成为更新控制输入。

App 的 Update 页面展示“当前版本”和“最新版本”，而非“Current/Latest Git SHA”或提交差异；更新按钮继续调用受控 job 请求接口。

### 旧版迁移

旧版用户按顺序执行：

```text
deploy.bat 或 deploy.sh
  → 将源码仓库中的 deploy.mjs 复制到 ~/.wheelmaker/
  → node deploy.mjs migrate-uninstall
  → node deploy.mjs
```

`migrate-uninstall` 仅处理旧环境：停止并删除旧 Hub、Go updater、monitor 的服务/任务/启动项和旧 EXE；保留 `config.json`、数据库、日志和用户数据。存在旧 Windows 系统服务时该命令请求管理员权限。正常 deploy/update 永不探测或兼容旧模式。

### Desktop 更新

`update_exe.bat` 读取 stable 中的独立 `desktopExe` 指针，并按其中的 SHA-256 下载、校验最近一次发布的 EXE。若 `WheelMakerDesktop.exe` 正在运行，脚本提示用户先退出并结束；不引入自删除、自替换或常驻更新助手。

## 迁移后的程序边界

运行时只保留 Hub Go 程序和按需运行的 Node 部署脚本；不保留 Go bootstrap、Go updater 或 Go monitor 进程。Hub 承担受控更新请求与本地状态查询，MJS 承担资产下载、验证、文件切换和平台任务触发。

## 验收标准

- 无 Git/Go/npm 的 Windows、Linux、macOS 目标端可仅凭 Node 22+ 完成新安装和后续更新。
- 三个平台包分别包含同一轮 Web 与对应 Hub，且目标端不会构建 Web。
- manifest、MJS 和平台包在任一 SHA-256 无效时均不被执行或解压；stable schema 或 URL 不合法时部署失败。
- Web 重复点击更新只产生一个 job；Hub 替换期间 HTTP 请求已得到 accepted 响应。
- 内部 `update` 不改写任意平台运行注册项，且无需管理员权限。
- `migrate-uninstall` 清除旧运行项而保留用户配置/数据；迁移后不再保留旧 updater/monitor。
- v1.3 未带 Desktop EXE、v1.2 带 EXE 时，v1.3 的 `update_exe.bat` 仍下载 v1.2 EXE。
- Action 在一个 Ubuntu job 内完成三平台 Hub、可选 Desktop、一次 Web 构建和发布；缓存命中时不重新下载 Go/npm 依赖。
- 成功安装保持 `bin/`、`web/`、`desktop/` 与 deploy/start/stop/restart/status 包装脚本的既有路径约定，且不产生 `app/` 目录。
- App 从 schema v2 的本机 `release.json` 和公开 stable 得出当前/最新版本，不执行 Git 查询或显示提交差异。
