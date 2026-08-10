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
  Server 部署是明确的例外：它只更新 Gateway `config.json` 的 `wm_sites.release` 对象，并由
  Release Server 进程读取该对象；它不读取或写入 Hub 配置。
- `~/.wheelmaker/gateway/start.*` 与 `stop.*` 只控制当前运行状态，不改变开机自启设置。
- Gateway 与全部部署器都不修改 Nginx、DNS、防火墙、云安全组或用户证书。
- 安装或升级切换后如果服务无法启动，不会自动回滚、卸载或删除本次安装的包装器、
  二进制和 release state。修复端口、权限或配置后重新运行 `node deploy.mjs gateway`。

## 配置所有权与布局

```text
~/.wheelmaker/
├─ config.json                         # Hub 共享业务配置，含 publicUrl/Registry/Share/Relay/log
├─ web/                                # Registry Web 根目录
├─ release-server/
│  ├─ versions/<source-sha>/           # Release Server 版本
│  ├─ current -> versions/<source-sha>
│  └─ data/                            # Release Server 公开文件与 staging
├─ shares/public/                      # Hub 生成的公开分享文件
└─ gateway/
   ├─ config.json                      # Gateway schema 2：ACME/wm_sites/共享 TLS/Release
   ├─ generated/caddy.json             # 聚合后的运行时配置
   ├─ data/                            # Caddy ACME 状态
   └─ state/release.json               # Gateway 自己的安装状态
```

Gateway 读取自己的 `config.json`，并读取 `--home`（通常为
`~/.wheelmaker/gateway`）父目录下的 Hub `config.json`。部署 Gateway 时如果专属配置
文件不存在，会一次性生成 ACME、共享 TLS 和完整 `wm_sites` 配置；Registry/Share 的
公网 URL、Relay 端口和日志级别不在此文件重复保存。Gateway 从父目录推导 Registry
Web、Release data 和 Share public 根目录：

```text
~/.wheelmaker/config.json             # Hub 共享业务配置事实源
~/.wheelmaker/gateway/config.json     # Gateway 专属配置事实源
~/.wheelmaker/web/                    # registry 路由的静态根目录
~/.wheelmaker/release-server/data/    # release 路由的服务数据
~/.wheelmaker/shares/public/          # share 路由的静态根目录
```

Hub 主配置的共享部分形状如下：

```json
{
  "publicUrl": "https://workspace.example.com",
  "log": {"level": "warn"},
  "registry": {
    "listen": true,
    "port": 9630,
    "relayPort": 28810,
    "share": {"publicUrl": "https://share.example.com"}
  }
}
```

Gateway 专属配置使用 schema 2。`wm_sites.registry` 与 `wm_sites.share` 固定使用
`urlMode: "sync_hub"`，`wm_sites.release` 保存 Release Server 运行参数，三个站点共用
`wm_sites.tls`：

```json
{
  "schema": 2,
  "acme": {"email": ""},
  "wm_sites": {
    "tls": {"certificateFile": "", "keyFile": ""},
    "registry": {"urlMode": "sync_hub"},
    "release": {
      "publicUrl": "",
      "listen": "127.0.0.1:9680",
      "dataRoot": "~/.wheelmaker/release-server/data",
      "tokenSha256": ""
    },
    "share": {"urlMode": "sync_hub"}
  }
}
```

`registry` 和 `share` 的 `urlMode` 缺失时默认采用 `sync_hub`，其他值无效。Gateway
schema 1 不做迁移、兼容解析或自动覆盖；部署器与运行时拒绝旧文件并保持原内容不变。

Release Server 的运行配置是 Gateway `config.json.wm_sites.release`，不再有
`~/.wheelmaker/release-server/config.json` 或 `gateway/sites/*.json`。Release Server
部署器从 channel URL 更新完整配置中的 `wm_sites.release.publicUrl`，保留 `listen`、
`dataRoot`、`tokenSha256`、共享 TLS 和其他 Gateway 专属字段；旧的 Release Server `config.json` 只用于
一次性迁移。Hub 的 `config.json` 仍由部署器或运维者维护，Gateway 读取其中的共享字段，
但不写入 Hub 配置。

## 公开地址与路由

- 顶层 `publicUrl` 是 Hub Reporter 连接 Registry 的 origin；本机 `registry.listen:true`
  时，它也是 Gateway Registry route 的 origin。远程 Worker 的 `publicUrl` 仅用于连接
  远程 Registry，不生成本机 Registry route。
- `registry.share.publicUrl` 是 Registry 生成 Share 链接和 Gateway 生成 Share route 的
  唯一 Share origin。清空它只停用 Share；Registry 在 `share.create/list` 请求边界重新
  读取该字段。
- Release Server 的地址来自 `scripts/release/channel.json`，Release Server 部署只更新
  Gateway `config.json` 的 `wm_sites.release.publicUrl`，不生成站点文件，也不改 Hub 配置。
- Gateway 同时轮询 Hub `config.json` 与自身 `config.json` 并热加载合法变化；无效的
  Registry/Share 派生字段只禁用受影响 route，Release route 保留上一份有效专属配置。
  Hub 和 Registry 不监听配置文件，主配置变化按现有启动/重启边界生效。
- Gateway 只接受 HTTP(S) origin；`https://` 且共享 TLS 为空时使用 Caddy 自动证书，
  显式证书和私钥必须同时存在，并由部署者保证证书覆盖所有 HTTPS 站点 hostname。
  HTTP 不启用 TLS，也不生成 HTTPS 跳转。
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

Hub 主配置的 `registry` section 可声明：

```json
{
  "registry": {
    "relayPort": 28810
  }
}
```

`registry.relayPort` 是宿主机唯一的 Relay 公网端口。字段缺失或为 `0` 时不生成 Relay
listener；配置端口必须避开 Gateway 的 `80/443`、Registry 的 `9630`、Release Server
的 `9680` 和 Caddy admin 的 `2019`。Relay listener 依附本机 Registry route；
`registry.listen:false` 或没有有效顶层 `publicUrl` 时不生成该 listener，但不影响其他 route。

Gateway 在固定端口按 Registry `publicUrl` 的 scheme 监听 HTTP 或 HTTPS，把所有 URI
（包括普通页面、绝对资源路径、query 和 WebSocket）反向代理到 Registry
`127.0.0.1:9630`。代理会删除客户端传入的 `X-WheelMaker-Relay`，再写入
`X-WheelMaker-Relay: 1`；Registry 以该标记选择 Relay 数据面，Relay access code 仍是
实际认证机制。

Gateway 与 Registry 共同读取 Hub `config.json.registry.relayPort`，两者都由这一字段
决定固定 Relay 端口；为 `0` 时使用 client-managed standalone 模式。Gateway 只负责边缘
listener，Registry 只负责本机 Relay 控制，配置变更由 Gateway 热加载、由 Registry 在
重启后读取。

Gateway 配置的有效变更按 hot-load 流程应用；无效配置或新端口绑定失败时保留上一份有效
Caddy 配置。公网 DNS、防火墙、NAT、安全组和证书申请前置条件仍由部署者负责。

## 部署入口

```text
node deploy.mjs                                      # 只部署 Hub/Web
node deploy.mjs --public-url=https://host.example   # 非交互完整 Hub 部署
node deploy.mjs update                               # 只更新 Hub/Web
node deploy.mjs gateway                              # 独立安装/升级/启动 Gateway
deploy-release-server.bat                            # 部署 Release，并更新 Gateway wm_sites.release
~/.wheelmaker/gateway/start.sh|stop.sh               # 只控制 Gateway 当前运行状态
```

业务部署不处理旧 Nginx。如果要停用旧 Nginx，可单独运行
`scripts/disable-nginx.sh` 或 `scripts/disable-nginx.ps1`；它们只停止并禁止已识别服务
自启，不删除软件包、配置或证书。Release Server 继续使用 Nginx 时，应把整个公开 host
反代到 `127.0.0.1:9680`，Nginx worker 不需要读取用户 Home。

> 固定端口 Port Relay：[`docs/scope/2026-08-06-port-relay-fixed-gateway-port.md`](../../scope/2026-08-06-port-relay-fixed-gateway-port.md)
>
> 原始 Gateway 设计（历史）：[`docs/scope/2026-08-05-wheelmaker-gateway.md`](../../scope/2026-08-05-wheelmaker-gateway.md)
