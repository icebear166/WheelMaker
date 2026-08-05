> 摘要：本页维护 WheelMaker Gateway 的宿主机级入口、站点配置、TLS 和运行时边界。

# Gateway

WheelMaker Gateway (`wheelmaker-gateway`) 是独立可执行程序，在进程内嵌入 Caddy。每台物理机只运行一个 Gateway，由它统一占用 `80/443`，按主机名聚合 Workspace 和 Release Server 站点。Gateway 不合并进 Hub，也不将 Web 构建产物嵌入二进制。

## 运行时边界

- Gateway 使用与本机 Hub 相同的操作系统用户和普通权限，但拥有独立系统服务。没有 Hub 的 Release-only 主机使用执行显式 Gateway 部署的当前用户；Workspace 与 Release Server 同机时必须由同一登录用户部署，才能共享一个 Gateway Home。
- 首次安装通过管理员权限注册开机自启和低位端口能力，安装后立即尝试启动。`start` / `stop` 只控制当前运行状态，不改变开机自启设置。
- Hub/Web 的普通完整部署和 `deploy.mjs update` 都不下载、安装、更新、启动、重启或修改 Gateway。Gateway 只由显式 `gateway`、`gateway-update` 和 start/stop 入口管理；显式升级可有数秒中断，启动失败时恢复本地上一版。
- Gateway 和部署器不停止、卸载或修改 Nginx，也不修改 DNS、本机防火墙或云安全组。
- Release Server 的普通部署只写 SSH 登录用户 Home，不探测旧 systemd/Nginx，也不依赖 `/srv`、`www-data` 或 ACL。旧机切换属于运维者执行的一次性人工迁移，不是 Gateway 生命周期的一部分。

## 配置所有权

Gateway Home 始终属于执行部署的实际用户，路径为 `~/.wheelmaker/gateway/`：

```text
gateway/
  config.json                   # 宿主机级全局配置
  sites/workspace.json          # WheelMaker 部署器所有
  sites/release-server.json     # Release Server 部署器所有
  generated/caddy.json          # 由全部站点聚合生成
  data/                         # Caddy ACME 证书和状态
```

`config.json` 只存放宿主机级共享设置，已存在时部署不覆盖。Workspace 与 Release Server 部署器分别只修改 `workspace.json` 和 `release-server.json`，不直接编辑聚合后的 Caddy JSON，也不通过 `/srv` 或宿主机级元数据发现 Gateway Home；Home 始终由实际登录用户解析为 `~/.wheelmaker/gateway`。`kind` 限定路由合同，不允许原始 Caddyfile、任意 Caddy JSON 或非 loopback 上游。

Release Server 的普通部署使用同一登录用户的 Home：

```text
~/.wheelmaker/release-server/
  config.json
  versions/<source-sha>/wheelmaker-release-server
  current -> versions/<source-sha>
  data/public/
  data/staging/
```

`release-server.json` 的 `publicRoot` 指向该用户的 `data/public` 绝对路径；Release Server、Gateway 和 Workspace 同用户时不需要 ACL 或 `www-data` 共享权限。

两个部署入口统一使用 `--gateway=none|caddy`：

- `none` 是严格无操作，不创建、覆盖或删除 Gateway 目录和站点文件；已有 Nginx 或其他入口继续工作。
- `caddy` 只自动创建站点目录并原子写入当前组件拥有的语义 JSON；它不要求 Caddy 已安装，也不触发 Gateway 校验、渲染或 reload。
- 非交互调用未传参数时按 `none` 处理。Workspace 完整交互部署未传参数时每次询问，默认选择 `none`；`deploy.mjs update` 永远不进入该流程。

## 站点合同

- `workspace` 站点以 `webRoot` 提供 Web 和 SPA fallback，将 `/ws` 路由到 loopback Registry 端口 `9630`。
- `release-server` 站点以 `publicRoot` 提供发布静态文件、Range 和 CORS，将 `/api/*` 与 `/healthz` 路由到 loopback Release Server 端口 `9680`。
- 站点用 `publicUrl` 表达域名、协议和可选外部端口。`https://` 未指定证书时由 Caddy 自动申请和续期；证书与私钥同时指定时使用用户证书；`http://` 明确表示不启用 TLS。
- 自动 TLS 依赖 DNS 指向主机且公网 `80/443` 可达。失败时不降级为 HTTP 或不受信自签名。

## 生命周期

Gateway 进程校验全局配置和全部站点后生成运行时 Caddy JSON。合法变更使用原子写入和热加载；无效变更保留上一份有效配置。站点部署器只负责写文件，不判断 Gateway 是否正在运行，配置消费属于 Gateway 自身生命周期。

部署入口：

```text
node deploy.mjs --gateway=none                 # 完整部署，不触碰入口配置
node deploy.mjs --gateway=caddy --gateway-public-url=https://workspace.example.com
node deploy.mjs gateway                         # 只安装/启动 stable 中的 Gateway
node deploy.mjs gateway-update                 # 显式下载、校验并更新 Gateway，可回滚
deploy-release-server.bat --gateway=none       # 部署 Release Server，不触碰入口配置
deploy-release-server.bat --gateway=caddy      # 另写 release-server.json
~/.wheelmaker/gateway/start.sh|stop.sh          # 只控制 Gateway 当前运行状态
```

Workspace 的 `workspace.json` 已存在且没有显式新 URL 时复用原值；显式 `--gateway-public-url` 时更新。首次交互配置询问公网 URL，首次非交互 Caddy 配置必须提供该参数。Release Server 的公网 URL 固定读取 release channel；两个部署器都不接受 web root、upstream 或证书路径覆盖参数。

普通 Gateway/Release Server 部署不处理旧 Nginx。旧机从 `/srv/wheelmaker-release` 切换到 Home 时，运维者一次性把 Release Server 的 Nginx 静态根调整到新的 `data/public`，其他站点、证书和入口配置保持不变。需要停用 Nginx 时，仍可单独运行 `scripts/disable-nginx.sh` 或 `scripts/disable-nginx.ps1`；脚本只停止并禁止已识别的 Nginx 服务自启，不删除软件包、配置和证书。无法安全识别服务时脚本返回人工处理提示。

> 详细设计：[`docs/scope/2026-08-05-wheelmaker-gateway/spec-wheelmaker-gateway.md`](../../scope/2026-08-05-wheelmaker-gateway/spec-wheelmaker-gateway.md)
>
> 配置选择与 Release Server 迁移决策：[`docs/scope/2026-08-05-gateway-config-and-release-server-migration/spec-gateway-config-and-release-server-migration.md`](../../scope/2026-08-05-gateway-config-and-release-server-migration/spec-gateway-config-and-release-server-migration.md)
