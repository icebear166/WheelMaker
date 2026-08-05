# WheelMaker Release Server 部署

Release Server 的部署流程独立于产品版本。它以 SSH 登录用户构建并迁移
loopback Go 服务；Gateway 配置只是可选的组件数据。本流程不安装、启动、停止、
重载、校验或渲染 Caddy/Nginx。

## 边界与路径

- 服务只监听 `127.0.0.1:9680`。
- 远端登录用户由 SSH 配置决定。同一台机器上部署 Workspace 和 Release Server
  时必须使用同一个用户。
- 登录用户需要免交互 `sudo`，用于 `/srv/wheelmaker-release`、旧 systemd 服务状态、
  ACL 备份/恢复和 login linger。
- 服务运行在登录用户的 user-level systemd unit 中：

  ```text
  ~/.wheelmaker/release-server/config.json
  ~/.wheelmaker/release-server/versions/<source-sha>/wheelmaker-release-server
  ~/.wheelmaker/release-server/current
  ~/.config/systemd/user/wheelmaker-release-server.service
  /srv/wheelmaker-release
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
  部署/迁移 Release Server，不触碰 Gateway 文件。

deploy-release-server.bat --gateway=caddy
  执行相同的部署/迁移，并原子写入
  ~/.wheelmaker/gateway/sites/release-server.json。
```

省略参数等同于 `none`。参数只决定是否写入 Release Server 语义站点文件，不改变
二进制下载、staging、迁移、健康检查或服务生命周期。

本地脚本读取 `scripts/release/channel.json` 的 HTTPS 源，使用该主机配置的 SSH
身份，检查 Linux/amd64，以 `CGO_ENABLED=0` 交叉编译，上传短期临时目录并调用远端
事务。SSH alias 和 `User` 配置决定实际登录用户；脚本不内置 `root@...`。

## 旧 systemd 服务自动迁移

旧 Nginx 机器的第一次部署会先完成预检，不会立即停服：暂存二进制、候选配置、user
unit 和首页资源，用 `validate-config` 校验候选配置，检查 user systemd、sudo、ACL
和平台前置条件，复制现有 `tokenSha256`，并记录旧 system/user 服务、linger、current
链接、unit、数据 ACL 状态。

预检通过后才启用 user linger，停止并禁用旧的系统级 Release Server unit；登录用户
获得稳定数据目录访问权，同时保留公开目录的 `www-data` 组和 setgid；随后原子切换
user 配置、unit 和 `current` 链接。必须同时通过
`http://127.0.0.1:9680/healthz` 和公网 HTTPS `/healthz` 检查。

任何失败都会恢复原服务状态、链接、配置、unit、ACL、首页资源和 linger。成功后旧
unit、文件和服务用户仍保留但处于 disabled，原有 Nginx 配置和 upstream 可继续工作；
迁移不需要 Caddy。

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
