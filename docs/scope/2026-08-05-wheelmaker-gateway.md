> 由 scope skill 于 2026-08-05 生成

> **历史规格：** 本文已由 [发布、部署与 Gateway 简化](../2026-08-06-deployment-and-gateway-simplification/spec-deployment-and-gateway-simplification.md) 取代；正文仅保留决策历史。

# WheelMaker Gateway

## 目标

WheelMaker 当前依赖用户预先安装并维护 Nginx，用它托管 Workspace Web、代理 Registry WebSocket，并为自建 Release Server 提供 TLS、静态发布文件和 API 代理。本项目新增由 WheelMaker 自行构建和发布的 `wheelmaker-gateway`，在独立进程内嵌入 Caddy，以一个宿主机级 Gateway 同时承载 Workspace 和 Release Server 的多域名入口。用户不需要额外安装 Caddy；Gateway 与 Hub、Web 和 Release Server 保持独立生命周期，使普通 WheelMaker 更新不会停止公网入口。

## 决策

- **Gateway 如何定位？** `wheelmaker-gateway` 是独立可执行程序和独立系统服务，不合并进 `wheelmaker` Hub，也不把 Web 构建产物编译进二进制。
- **一台机器运行多少 Gateway？** 每台物理机只运行一个 Gateway，统一占用对外端口、管理证书和聚合多个站点。第一版支持一个 `workspace` 站点和一个 `release-server` 站点，它们可以使用同一主域名的不同子域名。
- **Gateway 以什么权限运行？** 与本机 WheelMaker Hub 使用同一操作系统用户和普通权限，但使用独立服务生命周期。如果是没有 Hub 的 Release-only 主机，显式 Gateway 安装使用发起部署的当前非 root 用户作为固定运行用户。首次安装通过 sudo/UAC 注册开机自启并授予监听低位端口所需的最小平台权限；运行期不使用 root/SYSTEM。
- **Gateway 支持哪些发布目标？** 与现有 WheelMaker 矩阵一致：`windows-amd64`、`linux-amd64`、`darwin-amd64` 和 `darwin-arm64`。
- **Gateway 如何发布？** 在现有 WheelMaker 发布选项中增加 Gateway，交互与 Android APK 选项同类。Gateway 使用本次 WheelMaker 版本号，不提供独立版本输入或独立发布入口。勾选后任一 Gateway 构建、上传或提交失败都导致整次发布失败，`stable.json` 不更新；未勾选时保留已发布的 Gateway 指针和文件。
- **Gateway 产物如何存放？** Release Server 使用固定 `/gateway/` 命名空间，不创建 `v1.x` 版本目录。当前清单记录版本、平台、大小和 SHA-256，同时保留上一版清单和产物供回滚。`stable.json` 像 Android 指针一样携带当前 Gateway 清单路径、版本和摘要，让部署器在执行前建立现有 HTTPS + SHA-256 信任链。
- **Gateway 如何部署？** 仍使用公共 `deploy.mjs` 一键入口。完整部署默认下载当前 Gateway、安装或更新服务、设置开机自启并立即尝试启动。另提供显式 Gateway 部署模式供手动安装或更新。`deploy.mjs update` 不检查、下载、更新、重启或配置 Gateway。
- **完整部署何时写 Workspace 站点？** 每次交互式完整部署都询问是否写入 Workspace Gateway 配置；询问只影响配置，不影响 Gateway 下载和服务安装。已有配置时展示当前域名和 TLS 模式，允许沿用或修改；选择“否”只跳过本次写入，不删除已有站点。非交互模式必须用参数明确选择是否写入，写入时缺少必要值则失败。
- **Gateway 如何启停和更新？** Gateway Home 提供自己的 `start` / `stop` 包装脚本，它们只控制当前运行状态；安装脚本已固定配置开机自启，不另提供 `enable` / `disable` 命令。显式 Gateway 升级允许数秒中断：先下载和校验，再快速切换并启动，新版启动失败就恢复本地上一版。
- **配置归属如何划分？** Hub/Registry 继续使用 `~/.wheelmaker/config.json`；Gateway 只读取固定 Gateway Home 中的全局配置和站点声明。Workspace 部署器只管理 `workspace.json`，Release Server 部署器只管理 `release-server.json`，两者不直接编辑聚合后的 Caddy JSON。
- **HTTPS 如何配置？** `publicUrl` 为 `https://` 且未同时提供证书与私钥时，Caddy 自动申请、存储和续期公网证书，并将 HTTP 重定向 HTTPS。指定证书与私钥时改用用户证书；`publicUrl` 明确使用 `http://` 时才关闭 TLS。自动申请失败不降级到 HTTP，也不自动使用不受信任的自签名证书。
- **旧 Nginx 如何处理？** Gateway 部署、Workspace 部署和 Release Server 部署都不停止、修改或卸载 Nginx。另提供与 Gateway 无关的 Nginx 停用脚本，只停止 Nginx 并禁止它开机自启，不删软件包、配置或证书。Gateway 遇到端口被占用时只报错。
- **防火墙由谁管理？** 延续现有自动部署脚本的边界：不修改本机防火墙、云安全组或 DNS，只检查并提示用户保证公网 `80/443` 可达；`9630/9680` 仍只监听 loopback。
- **Web 更新是否做零中断改造？** 不做。普通更新继续删除旧 `~/.wheelmaker/web` 后重命名临时目录，接受切换瞬间可能出现短暂 404。Gateway 进程本身在 Hub/Web 普通更新时保持运行。
- **Release Server 如何迁移？** Release Server 部署流程硬切到 Gateway 站点声明，删除 Nginx 和外部 Caddy/Caddyfile 部署分支。它只生成和校验 `release-server.json`，不安装、升级、启动或停止 Gateway，也不操作 Nginx；运维者使用独立 Gateway 部署模式和 `start` / `stop` 脚本管理服务。

## 架构

```text
                         one host / one wheelmaker-gateway
Internet :80/:443                  |
        |                          +-- ~/.wheelmaker/gateway/config.json
        v                          +-- ~/.wheelmaker/gateway/sites/*.json
+-------------------------+       +-- generated/caddy.json
| wheelmaker-gateway      |
| embedded Caddy          |
+------------+------------+
             |
             +-- workspace host
             |     +-- static -> ~/.wheelmaker/web
             |     `-- /ws*  -> 127.0.0.1:9630
             |
             `-- release host
                   +-- static -> /srv/wheelmaker-release/public
                   `-- /api/*, /healthz -> 127.0.0.1:9680
```

Gateway 只接受有限语义站点类型，不暴露原始 Caddyfile 或任意 Caddy JSON。站点文件是 Gateway 的持久期望状态；Gateway 校验全局配置和全部站点后生成 Caddy JSON，再以原子方式替换生成物。运行中检测到有效配置变更时热加载，不重启 Gateway；无效变更不覆盖上一份有效生成物。冷启动时全部配置必须通过校验，否则服务启动失败并报出具体文件。

### 配置与生成文件

Gateway Home 在首次安装时解析为绝对路径并写入服务定义；后续命令使用已安装服务记录的同一路径，不按当前执行用户重新计算 `~`。

```text
~/.wheelmaker/gateway/
  config.json                    # 用户维护的全局配置
  sites/
    workspace.json               # WheelMaker 部署器维护
    release-server.json          # Release Server 部署器维护
  generated/caddy.json           # 完全生成，可重建
  state/release.json             # 已安装版本、摘要和安装状态
  data/                           # Caddy ACME 账户、证书和运行状态
  logs/                           # Gateway 和访问日志
  downloads/                      # 下载和切换前暂存
  rollback/                       # 本地上一版可执行文件
```

`config.json` 只保存宿主机级共享配置，缺失时由安装器创建，已存在时普通部署不覆盖：

```json
{
  "schema": 1,
  "acme": {
    "email": ""
  },
  "log": {
    "level": "info"
  }
}
```

`workspace.json` 由完整 WheelMaker 部署流程生成：

```json
{
  "schema": 1,
  "kind": "workspace",
  "publicUrl": "https://workspace.example.com",
  "webRoot": "/home/user/.wheelmaker/web",
  "upstream": "http://127.0.0.1:9630",
  "tls": {
    "certificateFile": "",
    "keyFile": ""
  }
}
```

`release-server.json` 由 Release Server 部署流程根据 `scripts/release/channel.json` 和远端服务配置生成：

```json
{
  "schema": 1,
  "kind": "release-server",
  "publicUrl": "https://release.wheelmaker.top",
  "publicRoot": "/srv/wheelmaker-release/public",
  "upstream": "http://127.0.0.1:9680",
  "tls": {
    "certificateFile": "",
    "keyFile": ""
  }
}
```

`publicUrl` 必须是无 userinfo、query 和 fragment 的 `http` 或 `https` URL，且路径必须为 `/`；域名和可选外部端口均由它推导。证书和私钥必须同时为空或同时为可读绝对路径。`upstream` 必须是 loopback HTTP 地址；静态根目录必须是绝对路径。站点文件不保存自由形式路由：`kind` 决定可用路由集，防止部署器相互覆盖或把 Gateway 扩展为任意宿主机代理。

### 路由合同

Workspace 站点保留现有 Nginx 公网合同：以 `webRoot` 提供静态文件和 SPA fallback，将 `/ws` 及其子路径以 WebSocket/HTTP 代理到 `upstream`，并保留必要的 Host、forwarded headers 和安全响应头语义。Registry 继续只监听 loopback，Gateway 不扩大 Registry 信任边界。

Release Server 站点以 `publicRoot` 提供匿名 `GET`、`HEAD` 和 Range 下载，保留既有 CORS 和禁止目录列表的行为；`/api/*` 和 `/healthz` 代理到 `upstream`，发布上传保留流式传输和已有大小/超时边界。Release Server 部署器保持 `publicRoot` 的写权限属于 `wheelmaker-release`，只为 Gateway 运行用户授予读取和目录穿越权限。

## 流程

### 源码发布

1. 发布者使用现有 `publish-release` 入口选择 Desktop、Android 和 Gateway；Gateway 选项可不勾选，不存在 Gateway-only 发布模式。
2. 勾选 Gateway 时，构建四个目标产物，生成使用本次 WheelMaker 版本的 Gateway 清单，并与其他发布文件一起上传到同一 Release Server 会话。
3. Release Server 在 staging 中校验所有 Gateway 文件的平台集、大小和 SHA-256，所有文件齐全后才进入 commit。
4. commit 先保留旧 Gateway 清单和产物为 `previous`，再用本次文件替换固定 `current` 命名空间，并将 Gateway 指针写入候选 stable。任一 stable 生效前失败都恢复旧 Gateway 命名空间。
5. `stable.json` 仍是最后一个影响客户端选择的原子写入。stable 生效后整次发布成功；未勾选 Gateway 时，候选 stable 携带上一个 Gateway 指针。

### Workspace 完整部署

1. `deploy.mjs` 根据 stable 中的 Gateway 指针下载清单和当前平台产物，先校验清单摘要，再校验文件大小和 SHA-256。
2. 交互式部署询问是否写入 Workspace 站点。选择写入时，沿用或收集 `publicUrl` 和可选证书路径，根据 WheelMaker Home 和 Registry 端口生成候选 `workspace.json`；选择跳过时对现有文件不做任何修改。
3. 部署器用当前全局配置、现有其他站点和候选 Workspace 站点做聚合校验；校验失败时不写文件。
4. 部署器使用管理员权限安装或更新独立 Gateway 服务，记录固定 Gateway Home，设置开机自启并立即尝试启动。已安装且版本与摘要相同时不重启。
5. 端口被 Nginx 或其他进程占用时，Gateway 启动失败，部署器报出端口和占用进程线索，但不修改占用者。

### Gateway 手动更新

1. 运维者显式调用 Gateway 部署模式；普通 `deploy.mjs update` 不进入此流程。
2. 部署器完成 stable、清单、平台、大小和 SHA-256 校验，将新二进制放入 `downloads/`，并在停止旧服务前用新二进制校验全部配置。
3. 通过平台服务管理器停止 Gateway，把当前二进制保存到 `rollback/`，替换后立即启动并执行本地健康检查。
4. 新版未在限定时间内启动健康时，停止新版、恢复上一版二进制并重新启动；报告升级失败和回滚结果。

### Release Server 部署

1. Release Server 继续部署自己的 Go 服务、数据目录和 systemd unit，但不上传或安装 Nginx 模板、Caddyfile 或外部 Caddy 软件包。
2. 部署器从已安装的 Gateway 服务元数据发现固定 Gateway Home 和运行用户。Gateway 尚未安装时，部署失败并提示先运行独立 Gateway 部署模式，不在 Release Server 流程中隐式安装。
3. 部署器从 `scripts/release/channel.json` 取得 `publicUrl`，从 Release Server 配置取得 `publicRoot` 和 loopback `upstream`，原子生成并聚合校验 `sites/release-server.json`，同时为 Gateway 用户配置公开目录只读权限。
4. 如果 Gateway 正在运行，它自行检测有效文件并热加载；如果 Gateway 已停止，部署器不启动它，新配置在下次手动 `start` 时生效。
5. Release Server 部署成功以 loopback `/healthz` 和站点配置校验为准。公网 HTTPS 检查可以报告当前状态，但在运维者未启动 Gateway 时不将其误报为 Release Server 二进制部署失败。

## 验收标准

- 源码中存在独立 `wheelmaker-gateway` 入口，嵌入 Caddy 而不依赖目标机已安装的 `caddy` 命令，且不与 Hub 进程或 Web 构建产物合并。
- 发布入口增加 Gateway 选项；勾选时构建四个平台产物，使用本次 WheelMaker 版本，将经大小和 SHA-256 校验的产物发布到固定 `/gateway/` 并保留上一版；任一 Gateway 错误阻止 stable 提交。
- stable 的 Gateway 指针可验证固定清单，清单可验证当前平台产物；未勾选 Gateway 的新 WheelMaker 发布继续携带上一个有效 Gateway 指针。
- 完整一键部署默认安装 Gateway 独立服务、设置开机自启并立即启动；四个支持平台均有 Gateway `start` / `stop` 包装脚本，而普通 `deploy.mjs update` 对 Gateway 零操作。
- 每次交互式完整部署都询问是否写 Workspace 站点；已有配置可沿用或修改，选择跳过不修改现有文件，且询问结果不改变 Gateway 下载和安装行为。
- Gateway Home 在首次安装后对全机唯一；全局配置、Workspace 站点、Release Server 站点和生成 Caddy JSON 的所有权边界与本 Spec 一致，两个部署器不会覆盖对方站点。
- 无效站点候选不替换持久文件；直接造成的无效文件不会替换运行中的有效 Caddy 配置；冷启动失败会指明无效文件。
- Workspace 静态 Web 和 `/ws` WebSocket 在 Gateway 下与现有 Nginx 合同兼容；Release Server 静态下载、Range、CORS、`/api/*` 和 `/healthz` 在 Gateway 下与现有公网合同兼容。
- `https://` 站点在无自定义证书时由 Caddy 自动申请和续期，证书保存在 Gateway Home；DNS 或 `80/443` 不可达时明确失败，不降级到 HTTP 或自签名证书。同时提供的证书/私钥路径可覆盖自动 TLS。
- Release Server 部署不再上传 Nginx/Caddy 模板或安装外部代理，只在已安装 Gateway 的固定 Home 中生成 `release-server.json`、校验它并配置公开目录只读权限；它不改变 Gateway 运行状态或 Nginx 状态。
- 独立 Nginx 停用脚本只停止并禁止可识别的 Nginx 服务自启，不启动 Gateway，不卸载软件包，不删除配置或证书；无法安全识别服务时报告人工操作而不猜测。
- Gateway 安装和启动不修改 Nginx、DNS、本机防火墙或云安全组；端口冲突、DNS 错误和公网端口不可达都会给出可操作错误。
- Hub/Web 普通更新不停止 Gateway；Registry 重连和 Web 目录替换瞬间的短暂不可用属于已接受边界。Gateway 手动更新可短暂中断，启动失败必须自动回滚二进制并报告回滚健康结果。
- Registry Protocol 版本和已有 Hub/Registry 消息格式不变。

### 测试

- Gateway Go 测试覆盖：全局配置和两种站点 schema、URL/TLS/绝对路径/loopback 上游校验、多域名聚合、Caddy JSON 确定性生成、无效热加载保留旧配置、Workspace WebSocket/SPA 路由以及 Release Server 静态/Range/API 路由。
- 发布 MJS 测试覆盖：Gateway 选项的互动和非交互参数、四平台构建矩阵、清单、Gateway 指针继承、Gateway 上传白名单和事务失败不更新 stable。
- 部署 MJS 测试覆盖：每次交互式完整部署都询问、跳过不删文件、stable/清单/产物校验、四平台服务计划、开机自启和立即启动、`start`/`stop`、端口冲突报错、升级失败回滚，以及普通 `update` 不进入 Gateway 代码路径。
- Release Server 部署测试覆盖：不上传/安装 Nginx 或 Caddyfile，不操作 Gateway/Nginx 服务，缺少 Gateway 安装元数据时失败，生成精确 `release-server.json`，且只给 Gateway 用户公开目录读权限。
- 安全测试覆盖：拒绝非 loopback 上游、拒绝不完整自定义 TLS 文件对、拒绝原始 Caddy 配置和路径逃逸，确保 Registry/Release Server 内部端口不公开绑定。
- 平台 smoke test 覆盖四个发布产物可启动和可读取版本；Linux 验证开机服务、低位端口和同机双域名，Windows/macOS 验证服务注册、当前用户身份和 `start` / `stop` 包装脚本。
- 自动测试不修改真实 DNS、防火墙或云安全组，不向公网 ACME 服务申请证书；真实自动 TLS 和外网路由在受控主机上手工验收。

## 范围之外

- 不将 Gateway 合并进 Hub，不将 Web 嵌入 Gateway 二进制，不用 Gateway 替代 Release Server Go 服务。
- 不允许用户提供原始 Caddyfile/Caddy JSON、任意路由或非 loopback 反向代理上游；第一版不扩展第三种站点类型或同类多实例。
- 不为 Gateway 增加独立发布版本、Gateway-only 发布入口或 Gateway 版本目录。
- 不让普通 WheelMaker 或 Release Server 更新自动升级、停止或重启 Gateway。
- 不自动停止、卸载或删除 Nginx，不删除 Nginx/Certbot 配置和证书。
- 不管理 DNS、防火墙、云安全组或路由器端口映射。
- 不支持自动 DNS-01、通配符证书申请、内网 CA 信任下发或失败时自动降级。用户可以显式配置已有通配符证书文件。
- 不改造 Web 目录为版本化或原子指针切换，不承诺 Web 更新零 404；不实现 Gateway 二进制真正零中断交接。
- 不修改 Registry Protocol version、Hub/Registry 消息协议或客户端交互。
