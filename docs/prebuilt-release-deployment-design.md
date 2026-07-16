# WheelMaker 预构建发布与部署设计

日期：2026-07-16  
状态：已确认，待实施

## 目标

将 WheelMaker 从“目标机器拉取私有源码、安装构建工具并现场编译”的发布方式，迁移为“发布端构建并签名、目标机器下载预构建产物”的方式。

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

公开 wheelmaker-releases 仓库
  ├─ deploy.mjs / deploy-core.mjs（由发布流程复制）
  ├─ stable.json + stable.json.sig
  ├─ publish-status.json
  └─ GitHub Releases
       ├─ 三个平台 tar.gz
       ├─ release-manifest.json + .sig
       └─ 可选 WheelMakerDesktop.exe
```

发布者使用一个 GitHub App 向公开仓库写入 Contents 和 Releases。该 App 只安装到公开仓库，不能读取私有源码仓库。App 安装令牌只负责上传；它不能替代签名密钥。

发布者还持有独立的 Ed25519 私钥。目标端 `deploy.mjs` 内置对应公钥，按以下顺序建立信任：

1. 下载 `stable.json` 和 `stable.json.sig`，验证 `stable.json` 的原始 UTF-8 字节签名；
2. 只信任已签名 stable 中的脚本 URL、manifest URL 和 SHA-256；
3. 下载 `release-manifest.json` 和签名，验证其原始 UTF-8 字节签名；
4. 仅在包的 SHA-256 与已签名 manifest 一致后解压和部署。

签名文件采用 Base64 编码的 Ed25519 签名。JSON 必须由发布脚本以确定的 UTF-8、无 BOM、末尾单个换行方式写出；验证方签名/验证文件原始字节，避免跨语言 JSON canonicalization 差异。

## 公共控制文件

### stable.json

`stable.json` 是唯一的部署控制面；其签名有效后才可使用其中的 URL。示例：

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

允许的 phase 是 `validating`、`building-web`、`building-runtime`、`building-desktop`、`packaging`、`uploading`、`publishing-release`、`updating-stable`。终态为 `succeeded` 或 `failed`；失败状态保留到下一轮发布覆盖，并只包含通用错误码。

## 发布物与本地构建

每份 tar.gz 的解压目录与未发布本地构建输出完全一致：

```text
wheelmaker-v1.23-windows-amd64/
  hub/
    wheelmaker.exe
  web/
    ...静态站点文件...
```

本地构建模式只生成上述目录，不访问 GitHub、不上传、不修改 `stable.json`。发布模式对每个目录创建相同内容的 `.tar.gz`，再写 manifest 和签名。

解压实现必须使用 Node 标准库并拒绝绝对路径、`..` 路径穿越、符号链接、硬链接和超过预设文件数/总大小上限的条目。目标端先校验完整压缩包哈希，再解压。

## 发布流程

发布脚本只在私有源码仓库中存在。它支持本地直接发布和私有仓库中手动触发的 GitHub Action；二者调用相同 MJS 逻辑。

```text
validate source SHA
  → 读取已签名 stable，计算下一个 v1.x
  → 构建一次 Web
  → 在一个 Ubuntu 环境交叉编译三个 Hub 目标
  → 可选交叉编译 Desktop EXE
  → 生成平台目录、tar.gz、SHA-256 和 manifest 签名
  → 将 deploy.mjs/deploy-core.mjs 提交到公开 Git
  → 创建草稿 Release 并上传资产
  → 发布 Release
  → 最后提交 stable.json 与 stable.json.sig
```

本地发布要求工作树干净，并使用 `HEAD` SHA。Action 使用 `workflow_dispatch` 的必填 `ref`，解析为最终 commit SHA。没有 Release 资产成功公开之前，禁止更新 stable。

发布不设置持久化自定义锁。GitHub Release tag 的唯一性是并发仲裁：若创建草稿时 tag 冲突，发布器重新读取 stable，取得下一个版本后重试。失败时删除本轮草稿；下一轮开始前清理超过两小时的同类草稿。

### Desktop EXE

`with_desktop` 是发布输入，不接收用户指定的 EXE 文件路径：

- `false`：不构建、不上传 EXE，继承旧 `desktopExe` 指针；
- `true`：发布脚本在 Ubuntu 上调用 Go 交叉编译和 `go-winres` 生成 `WheelMakerDesktop.exe`，上传到本次 Release，更新 `desktopExe` 指针。

现有 `publish_desktop.ps1` 中的“创建桌面快捷方式”不属于构建或 Action；构建逻辑迁入发布 MJS。发布端不运行 Desktop 应用，也不要求 WebView2。

### Action 时间控制

- 默认发布优先在本地执行，零 runner 消耗；Action 是手动兜底。
- Action 使用单个 Ubuntu job，不使用平台 matrix，不上传/下载中间 Actions artifact。
- Web 只运行一次 `npm ci` 和一次生产构建，产物复制到三个包。
- 使用 `setup-node` 的 npm 缓存（`app/package-lock.json`）和 `setup-go` 的 Go 缓存（`server/go.sum`）。不缓存 `node_modules`、签名密钥、App 私钥或 token。
- `with_desktop=false` 时跳过 Desktop 构建；`true` 时仍在该 Ubuntu job 内交叉编译。

## 目标端部署

### 安装目录与脚本更新

```text
~/.wheelmaker/
  deploy.mjs
  deploy-core.mjs
  app/
    hub/
    web/
  staging/
    lock.json
    status.json
    <job-id>/
  config.json
```

公开 `deploy.mjs` 是小型启动器，源码在私有源码仓库维护、由发布流程复制到公开 Git。每次调用它时：

1. 下载并验签 stable；
2. 若 stable 指向的 `deploy.mjs` 或 `deploy-core.mjs` 哈希变化，下载到临时文件、验证哈希后替换本地副本；
3. 当前进程执行已加载的 `deploy-core.mjs`。启动器在本轮被替换时，新启动器从下一次调用生效；
4. core 下载、验证和解压当前平台资产，并执行安装或内部更新流程。

MJS 不放进平台包；产品包只包含 Hub 与 Web。`staging` 是唯一的更新工作区，同时保存锁和状态；不再使用独立 `update/` 目录。

### 公开与内部入口

```text
node deploy.mjs                       日常安装或更新
node deploy.mjs migrate-uninstall     一次性旧版清理
node deploy.mjs update                仅供 Hub/系统任务调用
update_exe.bat                        更新可选 Desktop EXE
```

不提供 `schedule`、`history`、`status` 或单独 `install` 命令。历史由 Web 直接读取公开 GitHub Releases API；状态由 Hub 读取本机 `staging/status.json`；日程固定为本地时间每天 03:00。

### 当前用户运行模型

新安装统一以当前用户运行，避免“用户可写目录 + 高权限系统服务”导致的权限提升风险：

| 平台 | Hub | 每日更新 |
| --- | --- | --- |
| Windows | 当前用户计划任务 `WheelMaker`，登录触发并在退出时重启 | `WheelMakerUpdater` 计划任务，每日 03:00 |
| macOS | `com.wheelmaker.hub` LaunchAgent，KeepAlive | `com.wheelmaker.updater` LaunchAgent，日历触发 |
| Linux | `wheelmaker-hub.service` systemd user service | `wheelmaker-updater.timer` + service |

普通新部署只创建上述当前用户注册项。内部 `update` 严格禁止创建、删除或改写计划任务、LaunchAgent 或 systemd unit，因此不需要管理员权限。

更新先在 `staging/<job-id>` 下载、校验和解压；然后请求旧 Hub 正常退出，替换 `app/` 的 Hub/Web 文件，触发既有 Hub 任务重新启动。失败后写入状态，不自动回滚。

### Web 触发与安装锁

Web 不能同步等待或直接替换 Hub。Web 调用 Hub 的受控 update 接口；Hub 原子创建 `staging/lock.json`（状态为 `queued`）并启动既有 updater 任务，然后立即返回 `accepted` 与 jobId。任务运行 `node deploy.mjs update`，接管 queued job 并更新状态。

```text
Web → Hub update API → 原子创建 lock → 触发 OS updater task
    → deploy.mjs update → 旧 Hub 退出 → 替换 app → 触发 Hub task
```

`lock.json` 是短生命周期互斥租约，包含 jobId、owner、开始时间和心跳；成功或失败时删除。重复点击返回同一 job 的状态，不能启动第二个更新。过期锁只有在确认对应任务未运行时才可回收。

`status.json` 是持久的最近一次状态，包含 jobId、`queued|downloading|verifying|applying|restarting|succeeded|failed`、时间和无敏感信息的错误码。它在任务结束后保留，直至下一次任务覆盖。

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

`update_exe.bat` 读取并验签 stable 中的独立 `desktopExe` 指针，下载并校验最近一次发布的 EXE。若 `WheelMakerDesktop.exe` 正在运行，脚本提示用户先退出并结束；不引入自删除、自替换或常驻更新助手。

## 迁移后的程序边界

运行时只保留 Hub Go 程序和按需运行的 Node 部署脚本；不保留 Go bootstrap、Go updater 或 Go monitor 进程。Hub 承担受控更新请求与本地状态查询，MJS 承担资产下载、验证、文件切换和平台任务触发。

## 验收标准

- 无 Git/Go/npm 的 Windows、Linux、macOS 目标端可仅凭 Node 22+ 完成新安装和后续更新。
- 三个平台包分别包含同一轮 Web 与对应 Hub，且目标端不会构建 Web。
- stable、manifest、MJS 和平台包在任一哈希或签名无效时均不被执行或解压。
- Web 重复点击更新只产生一个 job；Hub 替换期间 HTTP 请求已得到 accepted 响应。
- 内部 `update` 不改写任意平台运行注册项，且无需管理员权限。
- `migrate-uninstall` 清除旧运行项而保留用户配置/数据；迁移后不再保留旧 updater/monitor。
- v1.3 未带 Desktop EXE、v1.2 带 EXE 时，v1.3 的 `update_exe.bat` 仍下载 v1.2 EXE。
- Action 在一个 Ubuntu job 内完成三平台 Hub、可选 Desktop、一次 Web 构建和发布；缓存命中时不重新下载 Go/npm 依赖。
