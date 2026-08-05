> 摘要：本页维护 WheelMaker Gateway 的宿主机级入口、站点配置、TLS 和运行时边界。

# Gateway

WheelMaker Gateway (`wheelmaker-gateway`) 是独立可执行程序，在进程内嵌入 Caddy。每台物理机只运行一个 Gateway，由它统一占用 `80/443`，按主机名聚合 Workspace 和 Release Server 站点。Gateway 不合并进 Hub，也不将 Web 构建产物嵌入二进制。

## 运行时边界

- Gateway 使用与本机 Hub 相同的操作系统用户和普通权限，但拥有独立系统服务。没有 Hub 的 Release-only 主机使用执行显式 Gateway 部署的当前非 root 用户。
- 首次安装通过管理员权限注册开机自启和低位端口能力，安装后立即尝试启动。`start` / `stop` 只控制当前运行状态，不改变开机自启设置。
- Hub/Web 的普通 `deploy.mjs update` 不下载、更新、重启或修改 Gateway。Gateway 显式升级可有数秒中断；启动失败时恢复本地上一版。
- Gateway 和部署器不停止、卸载或修改 Nginx，也不修改 DNS、本机防火墙或云安全组。

## 配置所有权

Gateway Home 在首次安装时确定为绝对路径，例如 `~/.wheelmaker/gateway/`：

```text
gateway/
  config.json                   # 宿主机级全局配置
  sites/workspace.json          # WheelMaker 部署器所有
  sites/release-server.json     # Release Server 部署器所有
  generated/caddy.json          # 由全部站点聚合生成
  data/                         # Caddy ACME 证书和状态
```

`config.json` 只存放宿主机级共享设置，已存在时部署不覆盖。部署器只修改自己的站点文件，不直接编辑聚合后的 Caddy JSON。`kind` 限定路由合同，不允许原始 Caddyfile、任意 Caddy JSON 或非 loopback 上游。

## 站点合同

- `workspace` 站点以 `webRoot` 提供 Web 和 SPA fallback，将 `/ws` 路由到 loopback Registry 端口 `9630`。
- `release-server` 站点以 `publicRoot` 提供发布静态文件、Range 和 CORS，将 `/api/*` 与 `/healthz` 路由到 loopback Release Server 端口 `9680`。
- 站点用 `publicUrl` 表达域名、协议和可选外部端口。`https://` 未指定证书时由 Caddy 自动申请和续期；证书与私钥同时指定时使用用户证书；`http://` 明确表示不启用 TLS。
- 自动 TLS 依赖 DNS 指向主机且公网 `80/443` 可达。失败时不降级为 HTTP 或不受信自签名。

## 生命周期

Gateway 校验全局配置和全部站点后生成运行时 Caddy JSON。合法变更使用原子写入和热加载；无效变更保留上一份有效配置。Release Server 部署只写入自己的站点文件，不启动或停止 Gateway；如果 Gateway 正在运行，有效配置会被检测并热加载。

部署入口：

```text
node deploy.mjs --gateway-skip                 # 完整部署，保留 Workspace 站点
node deploy.mjs --gateway-write --gateway-public-url=https://workspace.example.com
node deploy.mjs gateway                         # 只安装/启动 stable 中的 Gateway
node deploy.mjs gateway-update                 # 显式下载、校验并更新 Gateway，可回滚
~/.wheelmaker/gateway/start.sh|stop.sh          # 只控制 Gateway 当前运行状态
```

完整部署的交互模式每次询问是否写 `workspace.json`；回答否不会删除现有文件，但 Gateway 下载、安装和启动仍按默认流程执行。普通 `node deploy.mjs update` 不读取 Gateway 状态，也不触碰其服务。

旧 Nginx 不由 Gateway 或 Release Server 部署流程处理。需要迁移时，运维者可单独运行 `scripts/disable-nginx.sh` 或 `scripts/disable-nginx.ps1`；脚本只停止并禁止已识别的 Nginx 服务自启，不删除软件包、配置和证书。无法安全识别服务时脚本返回人工处理提示。

> 详细设计：[`docs/scope/2026-08-05-wheelmaker-gateway/spec-wheelmaker-gateway.md`](../../scope/2026-08-05-wheelmaker-gateway/spec-wheelmaker-gateway.md)
