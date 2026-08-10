> 摘要：本页维护 WheelMaker Gateway 的宿主机级入口、统一配置、TLS 和运行时边界。

# Gateway

WheelMaker Gateway (`wheelmaker-gateway`) 是独立可执行程序，在进程内嵌入 Caddy。
每台物理机只运行一个 Gateway，由它统一占用公网端口并按主机名聚合 Registry、Release
和 Share 路由。Gateway 不合并进 Hub 或 Release Server，也不把 Registry Web 编译进
二进制。

## 运行时边界

- Gateway 使用执行部署的操作系统用户，拥有独立于 Hub 和 Release Server 的服务。
  两个业务服务位于同一机器且希望共用 Gateway 时，必须由同一用户部署。
- 只有 `node deploy.mjs gateway` 管理 Gateway 生命周期。该命令幂等安装或升级 stable
  指向的版本，注册开机服务并确保进程健康；不再有 Hub 内部的 Gateway 更新入口。
- Hub 完整部署、`deploy.mjs update` 和 Hub 运行时只管理 Hub 自己的配置、Web、状态和
  服务，不读取或写入 Gateway 目录，也不暴露 Gateway 更新的 HubState/API/UI 入口。
- Gateway 只通过自己的 `deploy.mjs gateway` 入口安装、升级和管理生命周期。Release
  Server 部署是明确的例外：它只更新 Gateway `config.json` 的 `release` 对象，并由
  Release Server 进程读取该对象；它不读取或写入 Hub 配置。
- `~/.wheelmaker/gateway/start.*` 与 `stop.*` 只控制当前运行状态，不改变开机自启设置。
- Gateway 与全部部署器都不修改 Nginx、DNS、防火墙、云安全组或用户证书。
- 安装或升级切换后如果服务无法启动，不会自动回滚、卸载或删除本次安装的包装器、
  二进制和 release state。修复端口、权限或配置后重新运行 `node deploy.mjs gateway`。

## 配置所有权与布局

```text
~/.wheelmaker/
├─ config.json                         # Hub 自己的配置，含 Hub publicUrl/share 设置
├─ web/                                # Registry Web 根目录
├─ release-server/
│  ├─ versions/<source-sha>/           # Release Server 版本
│  ├─ current -> versions/<source-sha>
│  └─ data/                            # Release Server 公开文件与 staging
├─ shares/public/                      # Hub 生成的公开分享文件
└─ gateway/
   ├─ config.json                      # Gateway 唯一配置：registry/release/share
   ├─ generated/caddy.json             # 聚合后的运行时配置
   ├─ data/                            # Caddy ACME 状态
   └─ state/release.json               # Gateway 自己的安装状态
```

Gateway 只读取自己的 `config.json`。部署 Gateway 时如果文件不存在，会一次性生成完整
配置；三个 section 的 `publicUrl` 默认都为空，空值表示该路由不生成，之后直接填入
地址即可。Gateway 从 `--home`（通常为 `~/.wheelmaker/gateway`）的父目录推导 Registry
Web、Release data 和 Share public 根目录：

```text
~/.wheelmaker/gateway/config.json     # Gateway 唯一事实源
~/.wheelmaker/web/                    # registry 路由的静态根目录
~/.wheelmaker/release-server/data/    # release 路由的服务数据
~/.wheelmaker/shares/public/          # share 路由的静态根目录
```

配置形状如下；Gateway 的全局 `acme`、`log`、`relay` 以及三个完整 section 都由同一份
文件承载：

```json
{
  "schema": 1,
  "acme": {"email": ""},
  "log": {"level": "info"},
  "relay": {"listenPort": 0},
  "registry": {"publicUrl": "", "tls": {"certificateFile": "", "keyFile": ""}},
  "release": {
    "publicUrl": "",
    "listen": "127.0.0.1:9680",
    "dataRoot": "~/.wheelmaker/release-server/data",
    "tokenSha256": "",
    "tls": {"certificateFile": "", "keyFile": ""}
  },
  "share": {"publicUrl": "", "tls": {"certificateFile": "", "keyFile": ""}}
}
```

Release Server 的运行配置是 Gateway `config.json.release`，不再有
`~/.wheelmaker/release-server/config.json` 或 `gateway/sites/*.json`。Release Server
部署器从 channel URL 更新完整配置中的 `release.publicUrl`，保留 `listen`、`dataRoot`、
`tokenSha256`、TLS 和其他 section；旧的 Release Server `config.json` 只用于一次性迁移。
Hub 自己的 `config.json` 仍由 Hub 管理，Gateway 不读取它；Hub 的 Share 运行逻辑也只
读取 Hub 自己的配置。需要公开 Share 时，运维者在 Gateway `share.publicUrl` 中填入同一
origin，两个组件之间不通过读取对方文件同步。

## 公开地址与路由

- `registry.publicUrl`、`release.publicUrl` 和 `share.publicUrl` 都是 Gateway 路由地址；
  留空就是显式 disabled，不会生成对应 host route。填入合法 URL 后，Gateway 轮询
  `config.json` 并热加载。
- Hub 的 `~/.wheelmaker/config.json.publicUrl` 只用于 Hub 自己连接 Registry，Gateway
  不读取；Hub 部署的 `--public-url` 不会改变 Gateway 配置。
- Release Server 的地址来自 `scripts/release/channel.json`，Release Server 部署只更新
  Gateway `config.json` 的 `release.publicUrl`，不生成站点文件，也不改 Hub 配置。
- Gateway 只接受 HTTP(S) origin；`https://` 且未指定用户证书时使用 Caddy 自动证书，
  显式证书和私钥必须同时存在。HTTP 不启用 TLS，也不生成 HTTPS 跳转。
- 聚合时按大小写不敏感的 hostname 检查唯一性。任意两个非空 URL 使用相同 hostname
  都会使新配置被拒绝，上一份有效配置继续运行。

路由合同：

- `registry`：从 Registry Web 根目录提供 Web 与 SPA fallback，把 `/ws` 代理到
  `http://127.0.0.1:9630`。
- `release`：把整个 host 代理到 `http://127.0.0.1:9680`。Release Server 自己提供
  首页、部署脚本、元数据、发布产物、健康检查和 API。
- `share`：从 `shares/public` 下精确提供 `GET`/`HEAD /s/<43-character-token>` 的
  HTML 文件，不做 SPA fallback、Registry 查询、反向代理或 CSP，并固定 HTML、inline、
  no-store、robots、referrer 和 nosniff 响应头。

自动 TLS 依赖 DNS 指向本机且所需公网端口可达。失败时不会降级为 HTTP 或不受信任的
自签名证书。

## 固定端口 Port Relay

Gateway 的 `config.json` 可声明：

```json
{
  "relay": {
    "listenPort": 28810
  }
}
```

`relay.listenPort` 是宿主机唯一的 Relay 公网端口。字段缺失或为 `0` 时不生成 Relay
listener；配置端口必须避开 Gateway 的 `80/443`、Registry 的 `9630`、Release Server
的 `9680` 和 Caddy admin 的 `2019`。Relay listener 依附 Registry route；没有有效
Registry `publicUrl` 时不生成该 listener，但不影响其他 route。

Gateway 在固定端口按 Registry `publicUrl` 的 scheme 监听 HTTP 或 HTTPS，把所有 URI
（包括普通页面、绝对资源路径、query 和 WebSocket）反向代理到 Registry
`127.0.0.1:9630`。代理会删除客户端传入的 `X-WheelMaker-Relay`，再写入
`X-WheelMaker-Relay: 1`；Registry 以该标记选择 Relay 数据面，Relay access code 仍是
实际认证机制。

Gateway 与 Registry 各自管理配置。Gateway 的 `relay.listenPort` 只决定边缘 listener；
Registry worker 只读取 Hub 自己的 `config.json.registry.relayPort`。两者都为 `0` 时使用
client-managed standalone 模式；若要由 Gateway 提供固定 Relay，运维者需要在两边分别填入
相同端口，任何一边变化都不会自动修改另一边。

Gateway 配置的有效变更按 hot-load 流程应用；无效配置或新端口绑定失败时保留上一份有效
Caddy 配置。公网 DNS、防火墙、NAT、安全组和证书申请前置条件仍由部署者负责。

## 部署入口

```text
node deploy.mjs                                      # 只部署 Hub/Web
node deploy.mjs --public-url=https://host.example   # 非交互完整 Hub 部署
node deploy.mjs update                               # 只更新 Hub/Web
node deploy.mjs gateway                              # 独立安装/升级/启动 Gateway
deploy-release-server.bat                            # 部署 Release，并更新 Gateway release section
~/.wheelmaker/gateway/start.sh|stop.sh               # 只控制 Gateway 当前运行状态
```

业务部署不处理旧 Nginx。如果要停用旧 Nginx，可单独运行
`scripts/disable-nginx.sh` 或 `scripts/disable-nginx.ps1`；它们只停止并禁止已识别服务
自启，不删除软件包、配置或证书。Release Server 继续使用 Nginx 时，应把整个公开 host
反代到 `127.0.0.1:9680`，Nginx worker 不需要读取用户 Home。

> 固定端口 Port Relay：[`docs/scope/2026-08-06-port-relay-fixed-gateway-port.md`](../../scope/2026-08-06-port-relay-fixed-gateway-port.md)
>
> 原始 Gateway 设计（历史）：[`docs/scope/2026-08-05-wheelmaker-gateway.md`](../../scope/2026-08-05-wheelmaker-gateway.md)
