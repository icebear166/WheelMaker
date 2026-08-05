# WheelMaker Release Server 部署

Release Server 独立于产品版本部署。它以 SSH 登录用户运行，只监听
`127.0.0.1:9680`，同时提供发布 API 和全部匿名公开文件。Nginx 或内置 Gateway
只需把整个公网 origin 反向代理到该 loopback 监听地址。

## 边界与路径

- 远端用户由 SSH 配置决定。同一台机器同时部署 Workspace 和 Release Server，且
  希望共用一个 Gateway Home 时，必须使用同一登录用户。
- 部署只使用该用户的 Home，不依赖 `/srv`、`www-data`、ACL 工具或旧服务权限。
- 部署器管理 Release Server 的 user-level systemd unit，但不安装、停止、重载或
  配置 Nginx、Caddy、DNS、证书、防火墙。

```text
~/.wheelmaker/release-server/config.json
~/.wheelmaker/release-server/versions/<source-sha>/wheelmaker-release-server
~/.wheelmaker/release-server/current
~/.wheelmaker/release-server/data/public
~/.wheelmaker/release-server/data/staging
~/.config/systemd/user/wheelmaker-release-server.service

~/.wheelmaker/gateway/sites/release-server.json
```

`config.json` 保存 `publicUrl`、`listen`、`dataRoot` 和发布 Token 摘要。公开地址来自
`scripts/release/channel.json`。每次部署保留 Token 与数据路径，更新 `publicUrl`，并
重新生成 Gateway 站点声明。该声明固定代理 `http://127.0.0.1:9680`，不再包含静态
`publicRoot`。

生成站点声明不表示已安装 Gateway；继续使用 Nginx 时可以忽略该文件。

## 部署命令

在干净源码树运行：

```text
deploy-release-server.bat
```

命令不再接受 Gateway selector。它从 `scripts/release/channel.json` 读取 HTTPS origin
与 SSH 主机，交叉编译 Linux/amd64 二进制，上传短期 staging 目录，再执行远端事务。
实际登录用户由 SSH alias 和 `User` 配置决定；脚本不内置 `root@...`。

远端事务安装版本、升级配置、启动用户服务、检查 loopback 健康、写入站点声明并删除
上传目录。提交前失败时保留原安装版本。

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

该命令幂等安装或升级 Gateway、注册开机服务并确保其运行。Workspace 与 Release
Server 的业务部署不会调用这条生命周期命令。

## TLS 与外部端口

Gateway 把 `https://` `publicUrl` 解释为自动证书管理。DNS 和所需公网端口必须已经
指向本机；`publicUrl` 中显式配置的外部端口会保留在 HTTP 到 HTTPS 跳转中。Release
Server 部署不管理这些前置条件。

## 发布 Token 与发布恢复

第一次本地 public 发布在本机创建 `~/.wheelmaker/release-server.json`，只把 Token 的
SHA-256 摘要发送给远端 `configure-token` 命令。原始 Token 不进入 URL、公开文件或
站点声明。

正式发布最后才让 `stable.json` 可见，然后通过 `config.json.publicUrl` 下载并验证
新 stable、部署脚本、manifest 和 Range 产物。公网验证失败时，服务会恢复旧 stable
和全部派生公开文件，再向发布端返回失败。

旧 `/srv` 或系统级服务不属于普通部署范围。需要先由运维者一次性迁移数据、停用旧
服务，再复用 `9680` 端口。
