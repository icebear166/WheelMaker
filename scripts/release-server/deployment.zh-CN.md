# WheelMaker Release Server 部署

Release Server 独立于产品版本部署。它以 SSH 登录用户运行，只监听
`127.0.0.1:9680`，同时提供发布 API 和全部匿名公开文件。Nginx 或内置 Gateway
只需把整个公网 origin 反向代理到该 loopback 监听地址。

## 边界与路径

- 远端用户由 SSH 配置决定。Hub 与 Release Server 只有在使用同一登录用户时才能共用
  一个 Gateway；两个服务不读取对方的配置。
- 部署只使用该用户的 Home，不依赖 `/srv`、`www-data`、ACL 工具或旧服务权限。
- 部署器管理 Release Server 的 user-level systemd unit 和自己的运行数据，但不安装、
  停止、重载或配置 Nginx、Caddy、DNS、证书、防火墙。

```text
~/.wheelmaker/release-server/versions/<source-sha>/wheelmaker-release-server
~/.wheelmaker/release-server/current
~/.wheelmaker/release-server/data/public
~/.wheelmaker/release-server/data/staging
~/.config/systemd/user/wheelmaker-release-server.service

~/.wheelmaker/gateway/config.json       # 共享 Gateway 配置
                                         # 只更新其中的 release 对象
```

Release Server 的运行配置是 `~/.wheelmaker/gateway/config.json` 中的 `release`：

```json
{
  "release": {
    "publicUrl": "https://release.example.com",
    "listen": "127.0.0.1:9680",
    "dataRoot": "/home/alice/.wheelmaker/release-server/data",
    "tokenSha256": "",
    "tls": {"certificateFile": "", "keyFile": ""}
  }
}
```

Gateway 部署在缺少配置时生成完整顶层配置，所有 `publicUrl` 默认为空。Release Server
部署从 `scripts/release/channel.json` 取得公网地址，只更新 `config.json.release.publicUrl`，
保留 Release 其余字段以及 `registry`/`share` section。Release Server 进程读取同一份
Gateway 配置。旧的 `~/.wheelmaker/release-server/config.json` 只迁移一次，新的 Gateway
配置提交成功后才删除；不会创建或读取 `gateway/sites/*.json`。

## 部署命令

在干净源码树运行：

```text
deploy-release-server.bat
```

命令不再接受 Gateway selector。它从 `scripts/release/channel.json` 读取 HTTPS origin
与 SSH 主机，交叉编译 Linux/amd64 二进制，上传短期 staging 目录，再执行远端事务。
实际登录用户由 SSH alias 和 `User` 配置决定；脚本不内置 `root@...`。

远端事务安装版本、更新 Gateway 配置中的 `release` 对象、启动用户服务、检查 loopback
健康并删除上传目录。提交前失败时保留原安装版本和原 Gateway 配置。

## 反向代理合同

Release Server 自己提供 `/`、顶层部署脚本、发布元数据、版本产物、`/healthz` 和
`/api/*`。Nginx 只需代理整个 host：

```nginx
server {
    listen 443 ssl;
    server_name release.example.com;

    # 在这里配置 ssl_certificate 与 ssl_certificate_key。
    location / {
        proxy_pass http://127.0.0.1:9680;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Nginx worker 不需要读取 `~/.wheelmaker`。公开文件支持 GET、HEAD、CORS 和字节 Range；
API 鉴权保持不变。

如需使用内置 Caddy 入口，单独执行发布首页提供的命令：

```text
node ~/.wheelmaker/deploy.mjs gateway
```

该命令独立安装或升级 Gateway、注册开机服务并确保其运行；Hub 部署不会调用这条生命
周期命令。

## TLS 与外部端口

Gateway 把 `https://` `release.publicUrl` 解释为自动证书管理。DNS 和所需公网端口必须
已经指向本机；`publicUrl` 中显式配置的外部端口会保留在 HTTP 到 HTTPS 跳转中。Release
Server 部署不管理这些前置条件。

## 发布 Token 与发布恢复

第一次本地 public 发布在本机创建 `~/.wheelmaker/release-server.json`，只把 Token 的
SHA-256 摘要发送给远端 `configure-token` 命令。它是发布器的密钥文件，不是服务运行
配置；原始 Token 不进入 URL、公开文件、Gateway 配置或站点声明。

正式发布最后才让 `stable.json` 可见，然后通过 `release.publicUrl` 下载并验证新 stable、
部署脚本、manifest 和 Range 产物。公网验证失败时，服务会恢复旧 stable 和全部派生
公开文件，再向发布端返回失败。

旧 `/srv` 或系统级服务不属于普通部署范围。需要先由运维者一次性迁移数据、停用旧服务，
再复用 `9680` 端口。
