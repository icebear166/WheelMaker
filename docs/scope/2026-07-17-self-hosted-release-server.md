> 由 scope skill 于 2026-07-17 生成

# WheelMaker 自建发布服务器

## 目标

将已实现的预构建发布从速度不可控的公开 GitHub Release 完整迁移到 `https://release.wheelmaker.top`。私有源码、本地 Windows 构建和私有仓库手动 GitHub Action 保持不变；目标端仍只下载预构建产物。新增轻量 Go 发布服务接收认证上传并原子维护 stable、历史和资产，现有 Nginx 负责匿名 HTTPS 下载，从而让发布、部署、Desktop/Android 更新和 Web 版本查询不再依赖 GitHub 托管。

## 决策

- 公开基础地址固定为 `https://release.wheelmaker.top`，源码只维护一个 `baseUrl`；公开 JSON 使用根相对路径。
- GitHub Release 和公开 release 仓库完全退出运行链路，不保留 fallback 或过渡版本；旧用户手动重新执行新域名的一行迁移安装命令。
- 自建通道不迁移 GitHub v1.5 的 stable、历史或资产，版本从 `v1.1` 重新开始；无 stable 时固定以 `v1.0` 为基线，调用者不能指定其他起始版本。
- 复用服务器现有标准 Nginx、systemd 和 Certbot，不使用 Caddy、Docker、数据库或对象存储。
- Nginx 匿名提供静态 `GET`、`HEAD`、Range 和公共 CORS；Go 服务只监听 `127.0.0.1:9680` 并处理认证上传、校验、提交、状态和事务临时目录。
- 本地发布与私有 GitHub Action 共用一个 Bearer Token；服务端只保存 `tokenSha256`，本地明文位于 `~/.wheelmaker/release-server.json`，Action 明文位于 `WHEELMAKER_RELEASE_TOKEN` Secret。不实现 Token 列表、轮换、撤销或管理 API。
- 发布版本继续使用 `v1.x`，客户端读取 stable 后加一；提交必须严格等于当前 stable 的下一版本，同版本并发失败为 `409`，不设置需人工清除的持久锁。
- stable 和 release manifest 使用 schema 2 及根相对 `path`；stable 最后生效，服务端继承最近 Desktop/Android 指针，并引用不可变版本目录中的 MJS 维持完整哈希链。local `release.json` schemaVersion 和网络协议版本不变。
- 版本、发布时间、源码 SHA、manifest SHA 和资产可用性永久保存，不记录 changelog，不支持回滚。
- 所有成功发布的版本元数据和资产永久保留；第一版不实现按时间、数量或容量自动删除发布资产，也不创建 cleanup timer。
- 发布服务使用独立 `deploy-release-server.bat`：本地 Windows 交叉编译 linux/amd64，通过 root SSH 私钥首次初始化或后续升级；远端进程始终以非 root `wheelmaker-release` 用户运行。
- 第一次本地 public 发布自动生成只含 Token 的 `~/.wheelmaker/release-server.json`，通过固定 SSH 主机和默认专用私钥把哈希写入服务器；无交互输入。后续直接复用，不含重复 baseUrl 或 SSH 配置。
- 发布服务版本独立于产品 `v1.x`，按私有源码 SHA 安装；服务器不通过自身 API 自更新。
- Hub 继续只报告本机安装与更新 job；Web 改读自建 stable、发布状态和历史，不修改现有协议版本。

## 架构

```text
本地 Windows / 私有 GitHub Action
  └─ scripts/release.mjs
       └─ HTTPS Bearer upload
            └─ Nginx :443
                 ├─ /api/*, /healthz → Go :9680
                 └─ public files → /srv/wheelmaker-release/public

/srv/wheelmaker-release/
  ├─ public/
  │   ├─ stable.json
  │   ├─ publish-status.json
  │   ├─ releases.json
  │   ├─ deploy.mjs / deploy-core.mjs
  │   └─ releases/v1.x/...
  ├─ staging/<session>/
  └─ data/
```

Go 命令位于私有源码的 `server/cmd/wheelmaker-release-server`。服务端是发布元数据的唯一写入者；publisher 只声明发布输入并上传文件，不能直接覆盖 stable、历史或任意服务器路径。Nginx 对 public 目录只读，上传请求关闭代理缓冲并先由 Go 验证 Authorization。

公开 stable 和 release manifest 使用 schema 2：MJS、manifest、平台包和可选资产字段统一命名为根相对 `path`；客户端相对唯一基础地址解析并验证大小与 SHA-256。根 `deploy.mjs` 仅用于首次安装，stable 引用 `/releases/v1.x/` 中的不可变 MJS，平台压缩包不包含 MJS。`releases.json` 使用 schema 1，永久记录每个版本及其资产列表。

API 固定为：

```text
GET    /healthz
POST   /api/publish/start
PUT    /api/publish/{session}/status
PUT    /api/publish/{session}/files/{filename}
POST   /api/publish/{session}/commit
DELETE /api/publish/{session}
```

`start` 只声明版本、源码 SHA、`local|action` 展示标识及 Desktop/Android 构建选项；时间由服务器生成，服务端据此推导固定文件白名单。每个文件上传时通过 `Content-Length` 和 `X-WheelMaker-SHA256` 声明大小与摘要。服务端拒绝路径字符、白名单外文件、超限文件和无效摘要；上传流式落到不可公开 staging。会话 24 小时无活动后自动失败和清理。

上限固定为 MJS/JSON 单文件 5 MiB、二进制资产单文件 2 GiB、每会话最多 9 个文件且总计 8 GiB。上传不设置总时长截止，只设置无数据活动超时。

## 流程

### 产品发布

1. publisher 从 `/stable.json` 计算下一 `v1.x`，建立会话并写入发布阶段。
2. 现有发布器构建一次 Web、三个 Hub 包及按需 Desktop/Android，本地未发布模式仍生成相同 `.release-out/v1.x` 目录。
3. public 模式登记并流式上传全部文件；命令行显示阶段、文件名、字节和百分比，不设置总时长上传超时。
4. `commit` 复核版本、文件、manifest 和继承指针，在同一文件系统发布包含 MJS 与资产的不可变版本目录。
5. 服务端原子替换 stable 作为最后一个部署控制写入，再刷新根 MJS、`releases.json` 和成功状态。
6. 任一步在 stable 前失败时旧 stable 保持可用；版本冲突返回 `409`，发布者重新读取 stable 后重新构建下一版本。

### 发布服务部署

1. `deploy-release-server.bat` 从 `channel.json` 推导主机，并使用固定 root 用户、22 端口和 `~/.ssh/wheelmaker-release-server_ed25519` 专用私钥。
2. 本地以 `CGO_ENABLED=0` 构建 linux/amd64 Go 二进制并上传临时路径。
3. 首次运行创建 `wheelmaker-release` 用户、`/srv` 数据目录、空 Token 配置、systemd unit、Nginx 站点和 `release.wheelmaker.top` Certbot 证书。
4. 将二进制安装到 `/opt/wheelmaker-release-server/versions/<source-sha>/`，原子切换 `current`，重启后验证外部 HTTPS healthz。
5. 后续运行复用同一脚本，只同步受版本管理的配置和二进制；Windows 入口结束前 pause。

### 安装、更新和历史

1. 新用户和旧用户都从新域名安装页复制 PowerShell 或 POSIX 一行命令，在任意目录下载根 `deploy.mjs`。
2. 旧用户命令依次执行 `migrate-uninstall` 和普通部署；不从 GitHub 自动桥接。
3. 已安装 launcher 每次读取新 stable，按哈希拉取版本目录中的 launcher/core，再执行现有 core；哈希未变则不重复下载，`update` 仍不安装或卸载服务。
4. Web 读取 `/stable.json`、`/publish-status.json` 和 `/releases.json`；所有历史版本和资产持续可查询、可下载。

## 验收标准

- `release.wheelmaker.top` 使用有效 HTTPS，匿名请求可下载 stable、历史、MJS、manifest 和资产，并支持 `HEAD`、Range 与跨源只读访问。
- 第一次本地 public 发布在无输入情况下生成 `release-server.json`、经 SSH 安装唯一 Token 哈希并完成 HTTPS 发布；未提供 Token或 Token 错误的上传请求失败且请求体不会进入 public。
- 上传拒绝路径穿越、未声明文件、超出数量/大小上限、大小不符和 SHA-256 不符，失败 staging 会自动清理。
- 磁盘无法容纳本次声明文件和安全余量时，发布在上传或 stable 变更前失败，既有版本不被自动删除。
- commit 只接受 stable 的下一 `v1.x`；两个发布者提交同一版本时只有一个成功，失败方收到 `409`，无需删除锁文件。
- 空服务器的第一次 commit 只接受 `v1.1`，不会读取或迁移 GitHub v1.5；迁移用户安装后本机 `release.json` 记录新通道版本。
- stable 更新前的任意注入失败都保持旧 stable 与旧安装可用；成功 stable 的 MJS、manifest 和资产哈希链全部可验证。
- 本地发布和手动 Action 通过同一 HTTPS 客户端完成发布；本地未发布模式仍只生成 `.release-out/v1.x`。
- 发布状态能展示 validating、building、packaging、uploading、committing、updating-stable 和终态，公开内容不泄露 Token、私有路径或错误堆栈。
- 任意成功发布版本的 MJS、manifest、平台包和可选 Desktop/Android 资产不会被后台任务删除。
- `deploy-release-server.bat` 能在已确认的 Ubuntu x86_64 服务器完成首次初始化和幂等升级，远端无需 Git、Go 或 Node，服务进程不是 root。
- 全新安装及人工迁移后的部署、内部更新、Desktop 更新、Android 更新和 Web 历史查询均不请求 GitHub Release、GitHub API 或 raw GitHub 内容。
- 现有 Hub 更新 job、`bin/web/desktop` 安装布局、start/stop wrapper、`update` 非管理员边界和网络协议版本保持不变。

### 测试

- Go handler/存储测试覆盖 Token 常量时间验证、文件白名单、流式大小与 SHA、磁盘不足、版本冲突、stable-last、崩溃恢复和状态脱敏。
- Node 发布测试用本地假服务覆盖本地/Action 认证、阶段上报、上传进度、409 处理、可选 Desktop/Android 继承和无总时长超时。
- deploy MJS 测试覆盖唯一基础地址、根相对 URL、版本目录 MJS、自更新、哈希失败和无 GitHub 请求。
- Web 测试覆盖 self-hosted stable/status/history 和 CSP，不访问 GitHub Releases API。
- PowerShell 源测试覆盖首次/后续服务器部署步骤、SSH 私钥不复制到服务器、远端非 root unit、外部 healthz 和 pause。
- 自动测试使用临时目录与本地 HTTP 服务，不写生产服务器；最终验收单独执行真实 HTTPS smoke、一次无发布构建及一次受控发布。

## 范围之外

- GitHub Release fallback、旧 GitHub 客户端自动桥接或公开 release 仓库兼容。
- 下载认证、私有安装包、分用户下载权限或面向浏览器的上传 UI。
- 产品或发布服务自动回滚、历史版本重新部署。
- 多发布服务器、CDN、对象存储、自动备份和跨地域容灾。
- 按时间、数量或磁盘阈值自动删除已发布资产及 cleanup timer。
- 在目标安装机器或发布服务器上拉取私有源码、Git 构建或 npm/Go 现场构建。
- Caddy、Docker、数据库和网络协议版本变更。
