# WheelMaker Release Server 部署

Release Server 的部署流程独立于产品版本。它以 SSH 登录用户构建并安装
loopback Go 服务；Gateway 配置只是可选的组件数据。本流程不安装、启动、停止、
重载、校验或渲染 Caddy/Nginx。

## 边界与路径

- 服务只监听 `127.0.0.1:9680`。
- 远端登录用户由 SSH 配置决定。同一台机器上部署 Workspace 和 Release Server
  时必须使用同一个用户。
- 安装完全由登录用户拥有，只要求该用户有可用的 user systemd manager，并在尚未
  启用时能够开启 linger；不需要 `/srv`、`www-data`、ACL 工具或旧服务权限。
- 服务运行在登录用户的 user-level systemd unit 中：

  ```text
  ~/.wheelmaker/release-server/config.json
  ~/.wheelmaker/release-server/versions/<source-sha>/wheelmaker-release-server
  ~/.wheelmaker/release-server/current
  ~/.wheelmaker/release-server/data/public
  ~/.wheelmaker/release-server/data/staging
  ~/.config/systemd/user/wheelmaker-release-server.service
  ```

- `--gateway=none` 不创建、不修改 Gateway 文件。
- `--gateway=caddy` 只原子写入
  `~/.wheelmaker/gateway/sites/release-server.json`，即使没有安装或运行 Caddy
  也可以部署。
- Gateway 生命周期仍由 Workspace 的显式 `gateway`、`gateway-update`、`start`、
  `stop` 命令负责。`scripts/disable-nginx.sh` 和 `.ps1` 仍是独立的旧 Nginx
  停止并禁止自启工具。

## 部署命令

在干净源码树运行：

```text
deploy-release-server.bat --gateway=none
  安装 Release Server，不触碰 Gateway 文件。

deploy-release-server.bat --gateway=caddy
  执行相同的安装，并原子写入
  ~/.wheelmaker/gateway/sites/release-server.json。
```

省略参数等同于 `caddy`。如果必须保持现有 Nginx 或其他入口完全不变，请显式使用
`--gateway=none`。参数只决定是否写入 Release Server 语义站点文件，不改变二进制
下载、staging、健康检查或 Gateway 生命周期。

本地脚本读取 `scripts/release/channel.json` 的 HTTPS 源，使用该主机配置的 SSH
身份，检查 Linux/amd64，以 `CGO_ENABLED=0` 交叉编译，上传短期临时目录并调用远端
事务。SSH alias 和 `User` 配置决定实际登录用户；脚本不内置 `root@...`。

## 旧 Nginx 主机的一次性迁移

普通部署不会探测、停止、禁用或迁移旧 systemd 服务。如果主机仍从
`/srv/wheelmaker-release` 提供 Release Server，先完成普通 Home 安装，再通过 SSH
手动迁移：

1. 将 `/etc/wheelmaker-release-server/config.json`、旧数据目录、旧 unit 和匹配的
   Release Server Nginx 配置备份到登录用户 Home 下带时间戳的目录。
2. 把 token 摘要、发布数据和公开资源复制到
   `~/.wheelmaker/release-server/data`；生成 `config.json` 时使用 Home 下的绝对
   `dataRoot`，旧文件全部保留以便回滚。
3. 启动并检查 user unit 的 loopback
   `http://127.0.0.1:9680/healthz`，然后只把 Release Server 的 Nginx 静态根调整到
   `~/.wheelmaker/release-server/data/public`，其他 Nginx 站点、证书和入口配置不变。
4. loopback 和外部 HTTPS `/healthz` 都成功后，停止并禁用旧 systemd unit，但不删除它。
   任一检查失败时，停止 user unit、恢复 Nginx 备份并启动旧 unit。

该迁移是运维者的一次性操作，不属于 Node 安装器或 Gateway 生命周期，也不提供迁移脚本。

## Gateway TLS 与路由

`caddy` 模式写入固定 loopback upstream 和空证书字段的语义站点。独立管理的内嵌
Caddy 会将 `https://` 公网地址用于 ACME 证书申请与续期。Release Server 部署不调用
Caddy admin API、不检查生成的 Caddy JSON，也不修改 Nginx、DNS、防火墙或证书。

## 发布 Token

第一次本地 public 发布生成 `~/.wheelmaker/release-server.json`。它只把 SHA-256
摘要发送到登录用户的
`$HOME/.wheelmaker/release-server/current/wheelmaker-release-server`，执行
`configure-token`，然后执行
`systemctl --user restart wheelmaker-release-server.service`。原始 Token 不进入
命令行、URL、公开文件或站点配置。

## 更新与恢复

普通 Workspace 更新和 Release Server 部署不会检查或重启 Gateway。Gateway 更新必须
显式执行、独立完成。远端事务提交前失败会清理临时上传目录，旧 Release Server 和
Nginx 服务路径继续保留。
