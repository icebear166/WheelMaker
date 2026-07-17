# WheelMaker 自建发布服务器设计

日期：2026-07-17
状态：已实施
生产验证：2026-07-17，`https://release.wheelmaker.top`

## 目标

WheelMaker 已完成预构建发布改造，但公开控制文件和安装包仍托管在 GitHub，国内网络下载速度无法满足安装与更新。新方案将公开发布面完整迁移到 `https://release.wheelmaker.top`：源码继续保持私有，本地 Windows 和私有仓库的手动 GitHub Action 仍负责构建，独立 Go 服务负责接收、校验和原子发布，Nginx 负责公开 HTTPS 下载。

GitHub Release、公开 `wheelmaker-release` 仓库及其 API 不再参与发布、部署或 Web 查询。既有 GitHub 客户端不设置过渡桥接，旧用户必须重新执行新域名提供的一行迁移安装命令。

自建通道使用全新的版本序列，不迁移 GitHub 通道的 v1.5 stable、历史或资产。服务器没有 stable 时以 `v1.0` 为基线，第一次成功发布为 `v1.1`；后续继续只递增 `x`。旧用户执行 `migrate-uninstall` 后由新通道版本重写本机 `release.json`，不比较两个通道的版本高低。

## 总体架构

```text
私有 WheelMaker 源码
  ├─ publish-release.bat / scripts/release.mjs
  ├─ 手动 workflow_dispatch
  ├─ deploy.mjs / deploy-core.mjs
  └─ wheelmaker-release-server Go 源码
          │
          │ HTTPS + Bearer Token
          ▼
release.wheelmaker.top:443
  └─ Nginx
      ├─ /api/*  ───────────────► 127.0.0.1:9680 Go 发布服务
      ├─ /healthz ──────────────► 127.0.0.1:9680
      └─ 其他 GET/HEAD/Range ───► /srv/wheelmaker-release/public
                                      ├─ stable.json
                                      ├─ publish-status.json
                                      ├─ releases.json
                                      ├─ deploy.mjs / deploy-core.mjs
                                      └─ releases/v1.x/...
```

服务器使用现有 Ubuntu 26.04、标准 systemd Nginx 和 Certbot。Go 服务以非登录用户 `wheelmaker-release` 运行，只监听 loopback；不在服务器安装源码、Git、Go、Node、Docker或数据库。Nginx 对公开文件只读，发布服务是公开目录的唯一写入者。

## 公开内容与 URL

源码中的发布基础地址只在 `scripts/release/channel.json` 维护一次：

```json
{
  "baseUrl": "https://release.wheelmaker.top"
}
```

发布元数据使用根相对路径，客户端始终相对基础地址解析；历史清单不写死域名。独立发布的 `deploy.mjs` 由发布流程从同一配置注入基础地址，Web 构建也从同一配置生成公开查询地址。域名以后变化时只修改这一处源配置并重新发布。

公开路径如下：

```text
/                         最小安装说明页
/stable.json              当前部署控制面
/publish-status.json      最近发布阶段，仅用于展示
/releases.json            永久版本历史和资产可用性
/deploy.mjs               最新的小型安装/自更新启动器
/deploy-core.mjs          最新 core 副本
/releases/v1.x/*          不可变 MJS、版本清单、平台包及可选 Desktop/Android
```

所有公开路径允许匿名 `GET`、`HEAD` 和 Range 下载，并返回 `Access-Control-Allow-Origin: *`；目录列表关闭。上传 API 不开放浏览器 CORS。

`stable.json` 和 `release-manifest.json` 升级为 schema 2，保留版本、发布时间、私有源码 SHA、MJS 哈希、当前 manifest，以及最近一次 Desktop/Android 指针。所有路径均为根相对路径。安装端仍按 stable → MJS/manifest → 平台包的 SHA-256 链验证，任何大小、哈希、schema 或路径异常都会在解压和执行前失败。local `release.json` 的 `schemaVersion: 2` 与网络协议版本均不改变。

```json
{
  "schema": 2,
  "version": "v1.6",
  "publishedAt": "2026-07-17T09:00:00Z",
  "sourceSha": "0123456789abcdef0123456789abcdef01234567",
  "deploy": {
    "mjsPath": "/releases/v1.6/deploy.mjs",
    "mjsSha256": "<sha256>",
    "corePath": "/releases/v1.6/deploy-core.mjs",
    "coreSha256": "<sha256>"
  },
  "release": {
    "manifestPath": "/releases/v1.6/release-manifest.json",
    "manifestSha256": "<sha256>"
  },
  "desktopExe": {
    "version": "v1.5",
    "path": "/releases/v1.5/WheelMakerDesktop.exe",
    "sha256": "<sha256>"
  },
  "androidApk": {
    "version": "v1.4",
    "path": "/releases/v1.4/WheelMakerAndroid.apk",
    "sha256": "<sha256>",
    "size": 123456
  }
}
```

schema 2 manifest 中每个平台条目使用 `path`、`sha256` 和 `size`。`releases.json` 使用 schema 1，顶层 `releases` 数组中的每个版本永久记录基础元数据和资产列表。

MJS 不放入平台压缩包，而是作为普通文件放在不可变的 `/releases/v1.x/` 目录中，stable 引用该版本目录及其哈希。根目录的 MJS 仅供首次安装和下次启动自更新。客户端先比较本地哈希，MJS 未变化时即使版本目录变化也不会重复下载 core；更新根副本不会破坏 stable 的哈希链。

`releases.json` 永久记录每个 `v1.x` 的发布时间、源码 SHA、manifest SHA 和资产列表，不记录 changelog。

## 发布 API 与认证

发布服务提供以下接口：

```text
GET    /healthz
POST   /api/publish/start
PUT    /api/publish/{session}/status
PUT    /api/publish/{session}/files/{filename}
POST   /api/publish/{session}/commit
DELETE /api/publish/{session}
```

除 `healthz` 外，所有 `/api/` 请求必须使用 `Authorization: Bearer <token>`。本地发布与 GitHub Action 共用一个至少 32 字节随机 Token；服务端只保存 `tokenSha256` 并使用常量时间比较。Token 不写入仓库、URL、状态文件或日志：本地明文位于 `~/.wheelmaker/release-server.json`，Action 明文位于私有源码仓库的 GitHub Actions Secret `WHEELMAKER_RELEASE_TOKEN`。

`start` 只接收版本、源码 SHA、`local|action` 展示标识以及是否包含 Desktop/Android；开始时间来自服务器 UTC 时钟。服务端据此推导本轮固定文件白名单。每个文件的 `PUT` 请求使用 `Content-Length` 和 `X-WheelMaker-SHA256` 声明构建后才能确定的大小与摘要；文件名禁止路径分隔符、编码绕过和白名单外取值。上传按流处理，在写入 staging 的同时计算并复核大小与 SHA-256，不把大文件完整读入内存。Nginx 关闭请求缓冲，Go 服务先验证请求头再读取请求体。

固定上限为每个 MJS/JSON 5 MiB、每个二进制资产 2 GiB、每个会话最多 9 个文件且总计不超过 8 GiB。客户端和代理不设置总时长截止，只对连接无数据活动设置超时，因此慢速但持续传输的上传不会被固定分钟数中断。

发布会话不是持久发布锁。相同版本可以并行准备，但 `commit` 在进程内短暂串行化，并要求提交版本严格等于当前 stable 的下一个 `v1.x`；先成功者生效，其他提交收到 `409 Conflict`。不存在需要人工删除的锁文件。超过 24 小时无活动的会话由维护任务标记为 `publisher_timeout` 并清理。

## 原子提交

本地和 Action 使用相同客户端协议：

```text
读取 stable，计算下一个 v1.x
  → start 会话并写 validating/building 状态
  → 构建 Web、三平台 Hub 和可选 Desktop/Android
  → 打包并登记预期大小与 SHA-256
  → 流式上传全部文件
  → commit
  → 服务端复核文件、manifest、版本与继承指针
  → 发布包含 MJS 和资产的不可变 releases/v1.x
  → 原子替换 stable.json
  → 刷新根 MJS、releases.json 和 succeeded 状态
```

`stable.json` 是最后一个影响部署选择的写入。其替换使用同一文件系统内的临时文件、`fsync` 和 rename。stable 更新前失败时，旧版本继续可用；stable 更新后即视为发布成功，根 MJS、历史索引和展示状态属于可从 stable/manifest 修复的派生数据。服务启动时会把未被 stable 或历史索引引用的未完成目录移回 staging 恢复区，并由 24 小时 staging 清理机制处理；同时修复 stable 已生效但派生文件尚未刷新的中断场景。服务不会直接从公开版本目录删除文件。

第一次发布读取不到 stable 时按 `v1.0` 计算下一版本，不回查 GitHub、不导入旧历史，也不接受由调用者指定任意起始版本。

`publish-status.json` 允许 `validating`、`building`、`packaging`、`uploading`、`committing`、`updating-stable` 阶段，以及 `running`、`succeeded`、`failed` 状态。它只包含版本、源码 SHA、发布者、时间和通用错误码，不包含日志、Token、本地路径或错误堆栈。命令行同时输出每个阶段、文件上传进度和最终结果。

## 文件保留

第一版永久保留所有成功发布的版本元数据、MJS、manifest、平台包、Desktop EXE 和 Android 文件，不实现按时间、数量或磁盘容量自动删除发布资产，也不创建 cleanup timer。发布前若磁盘无法容纳本次已声明文件和安全余量，服务端返回存储空间错误并保持旧 stable 不变。

发布会话自己的 staging 不属于已发布资产：成功、显式取消或超时失败时可以删除该会话的临时文件，服务启动时也可以清理无法恢复的未提交事务。第一版不提供发布资产回滚、多服务器复制、对象存储或自动备份。

## 发布服务部署

发布服务有独立于产品 `v1.x` 的部署流程。源码仓库根目录提供 `deploy-release-server.bat`，本地 Windows 使用专用 root SSH 密钥连接服务器：

```text
读取 channel.json，并使用固定 root 用户、22 端口和专用 SSH 私钥路径
  → 检测远端 linux/amd64
  → CGO_ENABLED=0 交叉编译 Go 服务
  → SCP 到远端临时路径
  → 首次运行时创建用户、目录、空 Token 配置、systemd、Nginx 和 Certbot 配置
  → 安装到 /opt/wheelmaker-release-server/versions/<source-sha>/
  → 原子切换 current 链接并重启
  → 检查 https://release.wheelmaker.top/healthz
  → 在 Windows 窗口中显示结果并 pause
```

后续运行复用同一脚本，仅安装新二进制、同步受版本管理的配置、重启并健康检查。服务器不通过自己的发布 API自更新。Token 不由服务器部署脚本询问或生成，而由第一次本地 public 发布自动初始化。

第一次本地 public 发布发现 `~/.wheelmaker/release-server.json` 不存在时，自动生成 32 字节随机 Token，并以 schema 1 JSON 保存；文件只含 Token，不保存 `baseUrl`、主机或 SSH 参数。发布器将 Token 的 SHA-256 通过 `root@release.wheelmaker.top:22` 和默认私钥 `~/.ssh/wheelmaker-release-server_ed25519` 写入远端配置，再开始 HTTPS 上传，全程不要求用户输入。若本机已有可用 `gh` 登录，发布器同时通过标准输入将同一 Token 写入当前私有仓库的 `WHEELMAKER_RELEASE_TOKEN` Secret；没有 `gh` 时只跳过 Action Secret 初始化，不影响本地发布。

后续本地发布直接复用该文件，不再连接 SSH；Action 只读取同一个 Secret。服务端只有一个 `tokenSha256`，不实现 Token 列表、轮换、撤销或管理 API。`release-server.json` 必须限制为当前用户可读，不能复制到服务器或源码仓库。基础地址仍只来自源码 channel 配置。远端固定配置与 unit 路径为：

```text
/etc/wheelmaker-release-server/config.json
/etc/systemd/system/wheelmaker-release-server.service
/etc/nginx/sites-available/release.wheelmaker.top
/etc/nginx/sites-enabled/release.wheelmaker.top
```

## 目标端与 Web 迁移

新安装页提供可在任意目录执行的 PowerShell 和 POSIX shell 一行命令。命令从 `release.wheelmaker.top/deploy.mjs` 下载启动器到 `~/.wheelmaker/`，依次执行 `migrate-uninstall` 和普通部署。下载不设置总时长超时，并显示当前阶段与字节进度。

Windows 迁移删除旧计划任务和服务时，以提权操作后的实际注册状态为准：即使提权子进程返回非零，只要重新枚举后已无残留就继续清理；仍有残留时才失败，并保留一次性诊断文件和具体残留名称，避免第一次已完成删除、第二次重跑才成功的误报。

不发布 GitHub 过渡版本。旧用户的 GitHub 启动器不能自动发现新地址，必须重新执行新命令；迁移完成后，部署、更新、Desktop 更新和 Android 更新都不得访问 GitHub Release 或 `raw.githubusercontent.com`。

Web 从 `/stable.json`、`/publish-status.json` 和 `/releases.json` 读取全局版本、阶段和历史，不再调用 GitHub Releases API。Hub 继续只报告本机 `release.json`、更新 job 和安装状态，不新增远程下载职责，也不修改协议版本。

## 运维与安全边界

- Nginx 负责 TLS、公开静态下载、Range、上传大小限制、访问日志和 `/api/` 反向代理；继续使用现有 Certbot 自动续期，不引入 Caddy。
- Go 服务监听 `127.0.0.1:9680`，systemd journal 记录结构化服务日志；日志禁止记录 Authorization、完整请求体和本地 Token。
- `/srv/wheelmaker-release/public` 与 staging/data 由 `wheelmaker-release` 拥有；Nginx 只有公开目录读取权限。
- 上传限制文件数量、单文件大小、总大小和会话时长；失败上传只留在不可公开的 staging，随后自动清理。
- SSH root 密钥只保存在发布者本机，不上传服务器、不进入源码仓库；服务器仅保存对应公钥。
- 单服务器是第一版明确接受的可用性边界。服务器磁盘或主机故障时，需要从私有源码和本地发布能力重新构建发布面。
