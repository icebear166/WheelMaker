> 摘要：本页维护 WheelMaker Gateway 的宿主机级入口、站点配置、TLS 和运行时边界。

# Gateway

WheelMaker Gateway (`wheelmaker-gateway`) 是独立可执行程序，在进程内嵌入 Caddy。
每台物理机只运行一个 Gateway，由它统一占用公网端口并按主机名聚合 Workspace 与
Release Server 站点。Gateway 不合并进 Hub 或 Release Server，也不把 Workspace Web
编译进二进制。

## 运行时边界

- Gateway 使用执行部署的操作系统用户，拥有独立于 Hub 和 Release Server 的服务。
  两个业务服务位于同一机器且希望共用 Gateway 时，必须由同一用户部署。
- 只有 `node deploy.mjs gateway` 管理 Gateway 生命周期。该命令幂等安装或升级 stable
  指向的版本，注册开机服务并确保进程健康；不再有 `gateway-update`。
- Hub 菜单的 Gateway 更新是独立的 `gatewayUpdate` HubState section。Hub 读取
  `gateway/state/release.json` 上报本机版本，Web 用公共 `stable.gateway` 虚拟指针比较
  `sourceSha` 与 `manifestSha256`；只有本机已安装 Gateway 时才显示版本和按钮。按钮仍
  调用 `node deploy.mjs gateway`，Gateway 更新期间不停止或重启 WheelMaker。更新任务
  状态写入 `gateway/update/status.json`；超过 2 小时没有状态推进会被标记为 stalled，
  允许再次请求。
- Workspace 完整部署、`deploy.mjs update` 和 Release Server 部署只写各自站点声明，
  不下载、安装、启停、重载或验证 Gateway。
- `~/.wheelmaker/gateway/start.*` 与 `stop.*` 只控制当前运行状态，不改变开机自启设置。
- Gateway 与全部部署器都不修改 Nginx、DNS、防火墙、云安全组或用户证书。
- 安装或升级切换后如果服务无法启动，不会自动回滚、卸载或删除本次安装的包装器、
  二进制和 release state。部署器会停止失败的服务并报告原因；修复端口、权限或配置
  后重新运行 `node deploy.mjs gateway`，继续使用已保留的版本。

## 配置所有权

```text
~/.wheelmaker/
├─ config.json                         # Workspace/Hub 配置，含 publicUrl
├─ web/                                # Workspace Web 根目录
├─ release-server/
│  └─ config.json                      # Release Server 配置，含 publicUrl
└─ gateway/
   ├─ config.json                      # 宿主机级 ACME、日志和固定 Relay 端口设置
   ├─ sites/
   │  ├─ workspace.json                # WheelMaker 部署器所有
   │  └─ release-server.json           # Release Server 部署器所有
   ├─ generated/caddy.json             # 聚合后的运行时配置
   └─ data/                            # Caddy ACME 状态
```

业务服务自己的 `config.json.publicUrl` 是站点公开 origin 的事实源。Gateway 的
`config.json` 不存站点域名。Workspace 与 Release Server 部署器分别从业务配置原子
生成自己的语义站点 JSON，不编辑另一个组件的文件，也不直接编辑生成后的 Caddy JSON。

站点文件使用受限的 `kind` 合同，不接受原始 Caddyfile、任意 Caddy JSON 或非 loopback
upstream。是否生成站点配置和是否采用内置 Gateway 是两件独立的事：站点文件始终生成，
使用 Nginx 时可以忽略。

## 公开地址

- `publicUrl` 最终保存为只包含 HTTPS origin 的完整地址（loopback 例外保留 HTTP），
  例如 `https://wheelmaker.example.com` 或 `https://example.com:28800`。输入也接受裸域名、
  `ws/wss` 方案和末尾 `/ws`，写入时统一规范化。
- Workspace 已有 `~/.wheelmaker/config.json.publicUrl` 时复用；缺少时 Hub 自动使用本机
  loopback Registry，不要求交互补填。显式 `--public-url` 才会写入新的公网地址。
- `deploy.mjs update` 从已有配置重新生成 `workspace.json`。旧配置缺少地址时只警告并
  跳过站点生成，不阻断 Hub/Web 更新。
- Release Server 的地址来自 `scripts/release/channel.json`，部署时写回它自己的
  `config.json` 并生成站点声明。

## 站点合同

- `workspace`：Gateway 从 `webRoot` 提供 Workspace Web 与 SPA fallback，把 `/ws`
  代理到 `http://127.0.0.1:9630`。
- `release-server`：Gateway 把整个 host 代理到 `http://127.0.0.1:9680`。Release
  Server 自己提供首页、部署脚本、元数据、发布产物、健康检查和 API；站点声明没有
  `publicRoot`。
- 聚合时按大小写不敏感的 hostname 检查唯一性。任意两个站点声明相同 hostname 都会
  使新配置被拒绝，上一份有效配置继续运行。
- `https://` 且未指定用户证书时使用 Caddy 自动证书管理；显式证书和私钥必须同时存在；
  `http://` 不启用 TLS，也不生成 HTTPS 跳转。
- HTTP 到 HTTPS 跳转使用 `publicUrl` 的 authority，因此会保留显式外部端口；matcher
  与 TLS SNI 只使用 hostname。

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
的 `9680` 和 Caddy admin 的 `2019`。Relay listener 依附 Workspace site；没有有效
Workspace `publicUrl` 时不生成该 listener，但不影响其他 site。

Gateway 在固定端口按 Workspace `publicUrl` 的 scheme 监听 HTTP 或 HTTPS，把所有 URI
（包括普通页面、绝对资源路径、query 和 WebSocket）反向代理到 Registry
`127.0.0.1:9630`。代理会删除客户端传入的 `X-WheelMaker-Relay`，再写入
`X-WheelMaker-Relay: 1`；Registry 以该标记选择 Relay 数据面，Relay access code 仍是
实际认证机制。HTTPS 固定端口复用 Workspace hostname 的 Caddy 自动证书或显式证书，
HTTP 不自动升级为 HTTPS。

Gateway 存在时，Registry worker 与 Gateway 使用同一份 Gateway global config，通过只读
provider 获取当前固定端口；App 的 LocalStorage 不能覆盖服务端配置。若 Gateway config
缺失，Registry 进入 client-managed standalone 模式，允许 App 在 `enable.listenPort`
中提供端口，适用于手工配置 Nginx；Registry 不验证 Nginx 是否真的监听该端口。
Registry 继续只在 loopback `9630` 提供主 HTTP listener，不再为每次
`registry.relay.enable` 创建 TCP listener。固定 Caddy/Nginx listener 即使 Relay disabled
也可以保持运行；enable/disable 只切换 Registry 内的 singleton slot 和 Hub tunnel，不触发
边缘代理 reload。Gateway 模式下 `registry.relay.enable.listenPort` 必须等于固定端口；
standalone 模式下该字段就是客户端选择的 Nginx 端口。

Gateway 站点或端口配置的有效变更按现有 hot-load 流程应用；无效配置或新端口绑定失败
时保留上一份有效 Caddy 配置。配置变更导致固定端口移除或改变时，Registry 会关闭旧
tunnel，必须重新 enable。公网 DNS、防火墙、NAT、安全组和证书申请前置条件仍由部署者
负责。

## 部署入口

```text
node deploy.mjs                                      # 部署 Hub/Web；缺省使用 loopback
node deploy.mjs --public-url=https://host.example   # 非交互完整部署
node deploy.mjs update                               # 更新 Hub/Web 并刷新站点声明
node deploy.mjs gateway                              # 幂等安装/升级/启动内置 Gateway
deploy-release-server.bat                            # 部署服务并刷新 release-server.json
~/.wheelmaker/gateway/start.sh|stop.sh               # 只控制 Gateway 当前运行状态
```

业务部署不处理旧 Nginx。如果要停用旧 Nginx，可单独运行 `scripts/disable-nginx.sh` 或
`scripts/disable-nginx.ps1`；它们只停止并禁止已识别服务自启，不删除软件包、配置或
证书。Release Server 继续使用 Nginx 时，应把整个公开 host 反代到
`127.0.0.1:9680`，Nginx worker 不需要读取用户 Home。

> 当前设计：[`docs/scope/2026-08-06-deployment-and-gateway-simplification/spec-deployment-and-gateway-simplification.md`](../../scope/2026-08-06-deployment-and-gateway-simplification/spec-deployment-and-gateway-simplification.md)
>
> 固定端口 Port Relay：[`docs/scope/2026-08-06-port-relay-fixed-gateway-port/spec-port-relay-fixed-gateway-port.md`](../../scope/2026-08-06-port-relay-fixed-gateway-port/spec-port-relay-fixed-gateway-port.md)
>
> 原始 Gateway 设计（历史）：[`docs/scope/2026-08-05-wheelmaker-gateway/spec-wheelmaker-gateway.md`](../../scope/2026-08-05-wheelmaker-gateway/spec-wheelmaker-gateway.md)
