> 由 scope skill 于 2026-08-05 生成

# Gateway 配置选择与 Release Server 用户级迁移

## 目标

让 Workspace、Registry 和 Release Server 对公网入口实现保持无感知。部署入口只通过统一的 `--gateway=none|caddy` 决定是否写入 Caddy 站点声明，不再要求先安装 Gateway，也不再暴露旧 Nginx 到 Caddy 的专用迁移流程。Release Server 改为由实际 SSH 登录用户运行，并在一次普通部署中自动把旧系统级服务安全迁移为用户级 systemd 服务；已有 Nginx、证书、发布数据和上传协议继续兼容。

## 决策

- **业务服务是否感知入口实现？** 不感知。Hub、Registry 和 Release Server 继续只提供本地静态目录与 loopback upstream，Nginx/Caddy 的选择只存在于部署器。
- **入口参数是什么？** `deploy.mjs` 与 `deploy-release-server.bat` 统一接受 `--gateway=none|caddy`。非交互调用未传参时按 `none` 处理；完整交互部署未显式传参时每次询问，默认选择 `none`；`update` 不询问也不写入口配置。
- **`none` 做什么？** 对 Gateway 配置完全无操作，即使已有 Caddy 目录或站点文件也不创建、不覆盖、不删除。现有 Nginx 或其他入口继续工作。
- **`caddy` 做什么？** 只在部署用户的 `~/.wheelmaker/gateway/sites/` 下原子写入当前组件负责的语义 JSON。Workspace 只维护 `workspace.json`，Release Server 只维护 `release-server.json`，两者同机且由同一用户部署时自然共享一个 Gateway Home。
- **部署器是否管理入口服务？** 不管理。配置写入不调用 Gateway `validate`/`render`，不调用 Caddy admin API，不校验或 reload Nginx，也不安装、启动、停止、重启、启用或禁用 Nginx/Caddy。
- **现有 Gateway 参数如何整理？** 删除 `--gateway-write`、`--gateway-skip`、`--gateway-config=write|skip`、Workspace web root/upstream/证书覆盖参数。`--gateway-public-url` 仅保留给 Workspace Caddy 配置：已有有效站点且未传该参数时复用原 URL，显式传入时更新 URL；首次非交互创建时必须传入。`deploy.mjs gateway`、`gateway-update`、start/stop 包装器以及源码发布的 `--with-gateway` 保持独立语义，不属于本参数。
- **Workspace 公网 URL 从哪里来？** `workspace.json` 已存在且没有显式新值时复用；显式 `--gateway-public-url=https://...` 时更新；首次交互配置时询问；首次非交互 `--gateway=caddy` 时必须提供。Web 根目录、Registry upstream 和自动 TLS 使用部署器已知的固定值。
- **Release Server 公网 URL 从哪里来？** 唯一读取 `scripts/release/channel.json`，不新增域名参数。`publicRoot` 保持 `/srv/wheelmaker-release/public`，upstream 保持 `http://127.0.0.1:9680`，TLS 声明保持自动 HTTPS。
- **Gateway Home 如何确定？** 始终使用执行部署的实际用户 Home：`~/.wheelmaker/gateway`。Release Server 远程部署使用 SSH 登录用户的 Home；不再使用 `/srv/.../gateway`，也不再通过 `/etc/wheelmaker-gateway/home` 发现路径。同机部署必须使用同一个登录用户才能聚合两个站点。
- **Release Server 由谁运行？** 使用实际 SSH 登录用户，不再创建或依赖专门的 `wheelmaker-release` 运行用户。SSH 主机继续从 release channel 推导，远端用户名由 SSH 登录本身决定，不再硬编码 `root@`。
- **Release Server 文件放在哪里？** 版本化二进制和配置放在 `~/.wheelmaker/release-server`；用户 unit 安装到用户 systemd 目录并引用该 Home。发布数据、staging 和公开目录继续保留在 `/srv/wheelmaker-release`，从而让旧 Nginx 的静态路径保持不变。
- **Release Server 生命周期由谁管理？** Release Server 部署器管理自己的用户级 systemd 服务，包括 daemon reload、enable、restart、健康检查和开机常驻所需的 linger；它不因此获得入口服务的生命周期所有权。
- **旧机器如何迁移？** 普通 Release Server 部署自动检测旧系统级 `wheelmaker-release-server.service`。部署器先完成预检和新文件 staging，原样迁移旧 `/etc/wheelmaker-release-server/config.json` 中的 Token 哈希，再在一次受控切换中停止并禁用旧服务、把 `/srv/wheelmaker-release` 的写权限迁移给 SSH 用户、启动用户服务并检查 loopback 与外部 HTTPS。成功后保留旧 unit、二进制、配置和系统用户但维持 disabled；失败时恢复旧服务状态、数据权限和可用性。
- **没有 Caddy 时选择 `caddy` 会怎样？** 站点 JSON 只作为休眠配置存在。Nginx 未被触及，仍继续把公网请求转到同一 `127.0.0.1:9680` 并读取同一公开目录；以后单独安装并启动 Caddy 时才消费该配置。
- **首次发布 Token 如何适配？** 本地 publisher 的 SSH 初始化不再调用 root 的 `/opt` 二进制、`/etc` 配置或系统级 systemctl；它连接同一 SSH 用户，调用 Home 中的 Release Server 二进制与配置，并重启对应用户服务。现有本地 Token 文件、pending 恢复和 GitHub Secret 行为不变。
- **旧发布 API 兼容如何处理？** 保留发布器在未选择 Gateway 产物时省略 `withGateway` 字段的行为，不修改协议版本。
- **旧专用迁移入口如何处理？** 删除 `--legacy-nginx`、`bootstrap-release-gateway.bat` 和 `scripts/release-server/bootstrap-gateway.mjs` 及其专用测试；旧机迁移只存在于普通 Release Server 部署流程。

## 架构

同一部署用户拥有一个 WheelMaker Home，各组件只写自己负责的文件：

```text
~/.wheelmaker/
├─ gateway/
│  └─ sites/
│     ├─ workspace.json       # deploy.mjs 所有
│     └─ release-server.json  # deploy-release-server.bat 所有
└─ release-server/
   ├─ config.json
   ├─ versions/<source-sha>/wheelmaker-release-server
   └─ current -> versions/<source-sha>

~/.config/systemd/user/
└─ wheelmaker-release-server.service

/srv/wheelmaker-release/
├─ public/                    # 旧 Nginx 与未来 Caddy 读取
├─ staging/
└─ data/
```

入口配置写入和入口进程生命周期是两条独立控制流。`--gateway` 只选择是否写语义站点文件；Gateway 二进制的安装、升级和运行仍由显式 Gateway 命令负责。

## 流程

### Workspace 完整部署

1. `--gateway=none` 或交互默认否：继续 Hub/Web 部署，不接触 Gateway 配置或服务。
2. `--gateway=caddy`：读取已有 `workspace.json`；未传新 URL 时复用已有值，显式传入时更新，首次时从交互输入或 `--gateway-public-url` 得到域名。
3. 使用固定 Web root、loopback Registry upstream 和自动 TLS 原子写入 `workspace.json`，随后继续普通部署；不安装或启动 Gateway。
4. `deploy.mjs update` 永远跳过以上入口配置流程。

### Release Server 普通部署

1. 本地从干净源码交叉编译 Linux/amd64，并通过既有专用密钥连接 release channel 主机；SSH 配置决定登录用户。
2. 远端在停止任何服务前验证平台、sudo/用户 systemd/linger 能力、数据路径和旧配置可迁移性，并把新版本 staging 到用户 Home。
3. 新装机器创建用户配置和 `/srv/wheelmaker-release`；旧机器原样复制旧 Token 配置并记录旧系统服务的 active/enabled 状态与数据权限。
4. 执行受控切换：停止旧系统服务、迁移数据目录写权限、启用并启动用户服务。
5. 检查 `http://127.0.0.1:9680/healthz` 和 channel 的外部 HTTPS `/healthz`。失败则停止用户服务并恢复旧权限与旧服务状态；成功则保留旧文件但不再启动旧系统服务。
6. `--gateway=none` 不再执行入口动作；`--gateway=caddy` 只在 SSH 用户 Home 写 `release-server.json`。两种模式下 Nginx 都不会被部署器修改。

### 第一次本地正式发布

1. pending Token 的生成和本地私有权限流程保持不变。
2. SSH 使用与 Release Server 部署相同的主机、密钥和登录用户，在用户 Home 中执行 `configure-token`。
3. 通过用户级 systemd 重启 Release Server，确认公网 healthz 已报告 publisher configured 后再提升 pending Token。

## 验收标准

- `deploy.mjs` 和 `deploy-release-server.bat` 都只接受 `--gateway=none|caddy`；非法值失败；非交互缺省为 `none`，完整交互部署缺省进入默认选项为 `none` 的询问。
- 不再接受或生成 `--legacy-nginx`、`--gateway-write`、`--gateway-skip`、`--gateway-config=write|skip` 及专用 bootstrap 迁移脚本。
- 完整交互部署每次询问是否写 Caddy 配置并默认否；显式参数不重复询问；`update` 从不读取或修改 Gateway 配置。
- `none` 在 Gateway 目录不存在、存在或含现有站点文件时均为严格 no-op。
- `caddy` 自动创建 `~/.wheelmaker/gateway/sites`，原子写入且只覆盖调用组件拥有的站点文件；同机顺序部署不会互相覆盖。
- Workspace 首次非交互 Caddy 配置缺少 public URL 时失败且不留下半文件；已有有效站点时可无额外 URL 复用。
- Release Server Caddy 配置只从 release channel 和固定路径生成；没有 Caddy 安装时部署仍通过旧 Nginx 的外部 healthz。
- Gateway 配置路径不再出现 `/srv/.../gateway` 或 `/etc/wheelmaker-gateway/home`。
- 普通完整部署不再隐式下载、安装或启动 Gateway；独立 `gateway`、`gateway-update` 和 start/stop 能力继续工作。
- Release Server 新装使用 SSH 用户 Home、用户级 systemd 和 `/srv/wheelmaker-release` 数据目录，不创建专门运行用户，也不安装系统级 unit。
- 旧系统级 Release Server 的 Token、发布历史、stable、公开资产和 Nginx/Certbot 状态完整保留；迁移成功后只有用户服务占用 `127.0.0.1:9680`。
- 旧服务迁移在任何预检失败时不停止旧服务；切换后健康检查失败时恢复旧服务 active/enabled 状态和原数据权限。
- 首次 publisher Token 初始化只操作用户 Home 中的二进制、配置和用户服务，不再依赖 root 路径。
- 未选择 Gateway 发布产物时，旧 Release Server 仍能接受 publish start；不修改 Registry 或 Release Server 协议版本。

### 测试

- 参数解析测试覆盖 `none`、`caddy`、缺省、非法值、交互映射和 `update` 隔离。
- Gateway 配置测试覆盖首次创建、已有文件复用、组件文件隔离、原子写入、缺少 URL 失败，以及 `none` 的文件系统严格 no-op。
- 部署编排测试证明完整 Hub/Web 部署不再调用 Gateway 安装器，显式 Gateway 命令仍保留原行为。
- Release Server 远端脚本测试覆盖新装、旧配置迁移、用户 unit、linger、数据权限切换、旧 system service 状态保存和成功后的 disabled 状态。
- 故障注入测试覆盖新用户服务启动失败、loopback 健康失败和外部 HTTPS 健康失败，逐项验证旧服务与权限回滚。
- Publisher 配置测试覆盖非 root SSH 目标、Home 路径、用户级服务重启及现有 pending Token 恢复。
- 保留并运行发布 API 的旧字段兼容回归测试，以及现有 Node 脚本和 Go Release Server 全量测试。
- 不在单元测试中实际修改开发机 systemd、Nginx、Caddy 或 `/srv`；真实旧机切换作为部署验收执行。

## 范围之外

- 不安装、卸载、升级或配置 Nginx/Certbot。
- 不由 Workspace 或 Release Server 部署隐式安装、升级或控制 Caddy/Gateway 服务。
- 不删除旧系统级 Release Server unit、`/opt` 二进制、`/etc` 配置或 `wheelmaker-release` 用户。
- 不改变 Gateway 产物发布格式、独立 Gateway 更新/回滚命令或 start/stop 接口。
- 不自动迁移、停止、禁用或删除已经独立安装的旧 Gateway/Caddy 服务；其生命周期继续由显式 Gateway 命令或运维人员管理。
- 不修改 Release Server、Registry 或 ACP 协议版本。
- 不自动推导 Workspace 子域名，也不把入口域名写入 Hub 业务配置。
