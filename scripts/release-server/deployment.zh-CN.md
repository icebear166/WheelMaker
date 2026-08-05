# WheelMaker Release Server 部署

本文是当前硬迁移后的流程。Release Server 不再安装或管理外部反向代理。

## 边界

- Go `wheelmaker-release-server` 以非 root 用户 `wheelmaker-release` 运行，
  只监听 `127.0.0.1:9680`。
- `wheelmaker-gateway` 是独立宿主机服务，进程内嵌 Caddy。稳定状态下先以显式
  Gateway 模式（`node deploy.mjs gateway`）安装它。已有 Nginx 的 Release-only
  主机使用下面的一次性桥接流程。
- 本流程不安装、升级、启动、停止、禁用或卸载 Nginx/Caddy，也不修改 DNS、
  防火墙、云安全组或证书。停用旧 Nginx 请单独运行
  `scripts/disable-nginx.sh` 或 `scripts/disable-nginx.ps1`。
- `~/.wheelmaker/release-server.json` 仍是发布 Token 文件；Token 不进入命令
  行、URL、公开文件或站点配置。

## 从旧 Nginx 主机迁移

旧 Release Server 不认识新的 `withGateway` 字段，不能先向它发布 Gateway。
从干净源码树按以下顺序执行一次：

1. `deploy-release-server.bat --legacy-nginx` 只升级 loopback Go 服务，保留原有
   Nginx、证书和公开静态入口不动。
2. `bootstrap-release-gateway.bat` 从同一源码构建 Linux/amd64 Gateway，安装到
   `/srv/wheelmaker-release/gateway`，注册 `wheelmaker-gateway.service`，写入
   `release-server.json` 并设置开机自启；默认不启动，因为 Nginx 仍占用 80/443。
   只有端口已空闲时才传 `--start`。
3. 运行 `scripts/disable-nginx.sh`，再运行
   `/srv/wheelmaker-release/gateway/start.sh`，检查 HTTPS 和 `/healthz`。
4. 不带桥接参数再次运行 `deploy-release-server.bat`；之后均使用正常的
   Gateway 站点配置流程。

旧 Nginx 配置保留用于回滚。Bootstrap 是一次性迁移工具，普通 Release Server
部署不拥有 Gateway 生命周期。

## 前置条件

1. 确认 `scripts/release/channel.json` 是目标 HTTPS 源，DNS 和公网 80/443
   已指向服务器。
2. 服务器必须是 Linux/amd64，并提供 `go`、`ssh`、`scp`、`systemd`、`curl`。
   Release Server 数据位于 `/srv/wheelmaker-release`。
3. 稳定状态下，以目标非 root 用户单独安装 Gateway。安装器会把绝对 Home 写入
   `/etc/wheelmaker-gateway/home`，并生成 `start.sh`/`stop.sh`。上述迁移流程中，
   Bootstrap 会为 Release-only 主机生成同样的元数据和脚本。

缺少该元数据或 Gateway 二进制时，Release Server 部署会明确提示先运行
显式 Gateway 部署，并用 `wheelmaker-gateway paths --home` 校验记录的 Home，
不猜测其他用户的 Home。

## 自动部署

从干净源码树运行 `deploy-release-server.bat`。脚本会：

1. 读取 channel URL，使用固定 root SSH 身份；
2. 检查远端 Linux/amd64；
3. 使用 `CGO_ENABLED=0` 交叉编译 Go 服务；
4. 只上传服务二进制、systemd unit 和公开首页资源；
5. 原子切换 `/opt/wheelmaker-release-server/current`，只重启
   `wheelmaker-release-server.service`；
6. 写入并校验 Gateway 语义站点文件：

   ```json
   {
     "schema": 1,
     "kind": "release-server",
     "publicUrl": "https://release.wheelmaker.top",
     "publicRoot": "/srv/wheelmaker-release/public",
     "upstream": "http://127.0.0.1:9680",
     "tls": {"certificateFile": "", "keyFile": ""}
   }
   ```

   文件原子写入 `<gateway-home>/sites/release-server.json`。Release Server
   用户保留数据目录写权限，Gateway 用户只获得公开目录的读取和目录穿越权限。

7. 执行 `wheelmaker-gateway validate --home <gateway-home>` 和
   `render --home <gateway-home>`；
8. 检查 `http://127.0.0.1:9680/healthz`。Gateway 管理端点可用时热加载生成的
   JSON；Gateway 已停止时不启动它，新配置在下次手动 `start` 时生效。

公网 HTTPS 检查只是提示信息：Gateway 停止或 DNS 尚未切换，不应被误报为 Go
   服务部署失败。

## Gateway TLS 和路由

语义站点不接受原始 Caddyfile、任意 Caddy JSON 或非 loopback 上游。
`https://` 且证书字段为空时，内嵌 Caddy 在 Gateway Home 中申请并续期 ACME
证书；同时提供完整证书/私钥时使用用户文件；`http://` 才明确关闭 TLS。ACME、
DNS 或端口错误会直接报告，绝不静默降级到 HTTP 或自签名证书。

Gateway 从 `publicRoot` 提供匿名 `GET`/`HEAD`/Range 文件，将 `/api/*` 和
`/healthz` 代理到 loopback，上传校验仍由 Go 服务负责。Release Server 部署不
编辑 `config.json`、`workspace.json` 或生成的 Caddy JSON。

## 失败与恢复

- 源码不干净、远端架构不支持、Gateway 元数据缺失、站点无效或 loopback 健康
  检查失败时，部署不会报告成功。
- 失败不会删除现有发布数据或 Gateway 配置。
- Gateway 生命周期独立：普通 `node deploy.mjs update` 不检查、不下载、不重启
  Gateway。
