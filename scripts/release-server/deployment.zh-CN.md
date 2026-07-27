# WheelMaker：面向可 SSH 操作 AI 的部署指南

这是一份用于部署全新 WheelMaker Registry 入口机的执行 Runbook。开始执行命令前必须先阅读。调用者需要提供服务器 IP、公开域名和可用的 SSH 登录方式。AI 可以通过 SSH 自动执行常规安装步骤，但必须在本文明确列出的关口停下来询问调用者。

本文部署的访问地址固定为 HTTPS 根路径：

```text
https://<domain>/
```

本文不部署 WheelMaker 发布服务器，不克隆项目，不安装外部编码 Agent，也不配置模型供应商 API Key。

语言版本：

- English: `https://release.wheelmaker.top/deployment.md`
- 中文：`https://release.wheelmaker.top/deployment.zh-CN.md`

## 执行规则

- 不要要求调用者把 SSH 私钥或密码粘贴到聊天中。使用 SSH agent、已有密钥路径或平台提供的安全 SSH 连接器。
- 把调用者的服务器视为生产数据。不要执行 `git clone`、源码构建、针对宽泛路径的 `rm -rf`、清空防火墙规则或盲目替换 Nginx 配置。
- 常规的软件包安装、服务配置、Nginx 备份和防火墙放行可以自动执行。
- 在选择 WheelMaker 系统用户、确认 Registry Token、替换已有同域名 Nginx 站点，或安全检查失败后继续时，必须停下来询问调用者。
- 在最终 HTTPS、WebSocket、服务和监听端口检查全部通过前，不得宣称部署成功。
- 不要把 Registry Token 或供应商 Key 放入命令行、Nginx 文件、日志、公开文档或诊断输出。

## 调用者必须提供的信息

连接前收集以下信息：

| 输入 | 要求 |
| --- | --- |
| `SERVER_IP` | 用于 SSH 和 DNS 检查的 IPv4 或 IPv6 地址。 |
| `DOMAIN` | 真实 DNS 域名，不要包含 `https://`、路径或端口。 |
| `SSH_LOGIN` | SSH 用户名，以及安全的密钥、agent 或连接器。 |

域名的 A/AAAA 记录必须已经指向 `SERVER_IP`。AI 可以验证 DNS，但不修改调用者的 DNS 服务商配置。为了申请证书和提供 HTTPS，公网必须能访问 80 和 443 端口。

## 支持的目标环境

当前公开发布物包含预编译的 Linux AMD64 Hub。修改服务器前先检查：

```bash
uname -s
uname -m
node --version 2>/dev/null || true
systemctl --user --version
```

只有同时满足以下条件时才能继续：

- 操作系统是 Linux；
- 机器架构是 `x86_64`/`amd64`；
- 有可用的 `systemd --user`，并能在用户退出登录后继续运行；
- Node.js 版本为 `22.15.0` 或更高，或者可以从可信系统源安装。

遇到 ARM64、其他 CPU 架构、无法使用 systemd user manager 的容器，或必须从源码编译 WheelMaker 的目标机时，直接停止并清楚说明原因。不要下载未经验证的二进制文件来绕过检查。

## 1. 安装前检查服务器

先执行只读检查：

```bash
id
cat /etc/os-release
command -v apt-get dnf yum apk pacman zypper || true
getent ahosts "$DOMAIN" || true
ss -ltnp
nginx -T 2>/dev/null || true
systemctl --user show-environment
```

记录以下事实：

- 发行版和包管理器；
- 当前 SSH 端口和正在使用的防火墙管理器；
- Nginx 是否已经安装；
- `DOMAIN` 是否已经被现有 Nginx server block 使用；
- `127.0.0.1:9630` 是否已被占用；
- `/var/www/wheelmaker` 或选定的状态目录是否已经存在。

如果其他 Nginx server block 已经声明了 `DOMAIN`，停止并询问调用者，不要替换它。如果没有 Nginx，使用目标发行版可信的包管理器安装。

只备份将要修改的文件。执行 Nginx reload 前必须确保备份可以恢复：

```bash
backup_dir="/root/wheelmaker-deploy-backup-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$backup_dir"
```

不要删除已有备份或已有应用数据。

## 2. 安装运行时依赖

只安装本文和目标发行版安全更新所需的依赖：

- Node.js `22.15.0+`；
- Nginx；
- Certbot；
- `curl` 和最新 CA 证书包；
- 用于证书检查的 `openssl`；
- 如果选定用户需要，安装 `sudo`/`runuser`；
- 如果服务器已有防火墙管理器，使用其对应工具。

使用发行版的可信软件源或官方 Node.js 发布渠道。不要安装 Go、npm 依赖、WheelMaker 源码或编译工具链。最后确认运行时版本：

```bash
node --version
nginx -v
certbot --version
```

如果 Node.js 低于 `22.15.0`，不要运行 WheelMaker 安装器。

## 3. 选择 WheelMaker 运行用户

让调用者选择以下一项：

1. 使用 SSH 登录用户运行 WheelMaker；
2. 创建或使用专用的非特权用户，例如 `wheelmaker`。

选定用户负责 `~/.wheelmaker`、Hub 进程和 `systemd --user`。只有需要特权的操作才使用 root 或 `sudo`。

为选定用户启用 lingering，使用户服务在退出登录后继续运行：

```bash
sudo loginctl enable-linger "$RUN_USER"
sudo -iu "$RUN_USER" systemctl --user show-environment
```

如果失败就停止，不要用未记录的 root 常驻 daemon 替代 user service。

## 4. 安装预编译 WheelMaker 发布物

以下命令必须以 `RUN_USER` 执行，而不是以无关的 root 进程执行。命令可以从任意目录运行：

```bash
d="$HOME/.wheelmaker" && mkdir -p "$d" && curl --fail --location --progress-bar --proto '=https' --tlsv1.2 'https://release.wheelmaker.top/deploy.mjs' --output "$d/deploy.mjs" && node "$d/deploy.mjs" migrate-uninstall && node "$d/deploy.mjs"
```

启动器会使用发布 SHA-256 链验证公开发布元数据、部署脚本、manifest 和平台包。它会在以下位置安装 Hub 和 Web：

```text
$HOME/.wheelmaker/
├── bin/wheelmaker
├── web/
├── staging/
├── deploy.mjs
├── deploy-core.mjs
├── release.json
└── config.json
```

全新安装必须保持 `projects` 为空。此次部署不要克隆仓库或添加项目路径。

## 5. 确认 Registry Token

没有配置时，安装器会生成一个加密随机的 32-byte 默认 Token。AI 不得静默选择另一个值。

1. 在服务器上生成或读取候选 Token；
2. 只在私密部署对话中展示给调用者；
3. 询问调用者确认候选值，或提供替代值；
4. 使用调用者确认后的值作为 `registry.token`。

默认 Token 的生成命令：

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

如果调用者提供自定义值，要求它非空，并提醒短 Token 的安全性更弱。不要把 Token 原文放入 shell 命令、进程参数、Nginx 文件或日志。更新 JSON 时通过内存环境变量或安全输入传递。

生成后的 `config.json` 应保持以下结构，同时保留其他已有字段：

```json
{
  "projects": [],
  "registry": {
    "listen": true,
    "port": 9630,
    "server": "127.0.0.1",
    "token": "<caller-confirmed-token>",
    "hubId": "<stable-unique-hub-id>"
  },
  "log": {
    "level": "warn"
  }
}
```

以 `RUN_USER` 身份原子写入文件，并设置权限为 `0600`。修改后重启选定用户的 Hub：

```bash
sudo -iu "$RUN_USER" systemctl --user restart wheelmaker-hub.service
```

模型供应商 API Key 不属于本次部署。浏览器登录后，如有需要，在 WheelMaker 的 **Settings → Server** 页面配置。

## 6. 让 Nginx 读取 Web 目录

线上参考服务器把 WheelMaker 私有状态放在选定用户的 home 下，再把状态目录 bind mount 到 `/var/www/wheelmaker`。这样 Nginx 不需要获得用户私有 home 的访问权限，同时仍能从同一个安装根目录读取 `web/` 和 Hub 状态。

使用选定用户的真实 home：

```bash
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
STATE_DIR="$RUN_HOME/.wheelmaker"
WEB_MOUNT=/var/www/wheelmaker

sudo install -d -o root -g root -m 0755 "$WEB_MOUNT"
sudo mount --bind "$STATE_DIR" "$WEB_MOUNT"
```

加入持久化配置前，确认 `findmnt -T "$WEB_MOUNT"` 显示的是预期源目录。然后把以下 bind mount 加入 `/etc/fstab` 并执行 `mount -a`：

```text
<state-dir> /var/www/wheelmaker none bind 0 0
```

如果挂载点已经来自其他源目录，停止并询问调用者。不要卸载无关应用。

## 7. 配置 Nginx

线上参考部署使用两个 Nginx 文件：

1. 通常位于 `/etc/nginx/conf.d/wheelmaker-upgrade-map.conf` 的 Upgrade map：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}
```

2. 位于 `/etc/nginx/sites-available/<domain>`、并链接到 `sites-enabled` 的独立站点配置。

以下是根路径部署配置。只替换 `<domain>` 和证书路径，`/ws` 必须保持 prefix location。

### Certbot 临时 HTTP 配置

先安装这份配置、测试并 reload Nginx。它只暴露 ACME challenge，不通过 HTTP 暴露应用：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name <domain>;
    root /var/www/wheelmaker/web;

    location ^~ /.well-known/acme-challenge/ {
        try_files $uri =404;
    }

    location / {
        return 404;
    }
}
```

执行 `nginx -t` 后才能执行 `systemctl reload nginx`。如果测试失败，恢复备份并停止。

### 申请受信任的 HTTPS 证书

确认 DNS 和 80 端口后申请公开受信任的证书。如果调用者提供邮箱，将其传给 Certbot；否则使用无邮箱注册参数，并在结果中报告：

```bash
sudo certbot certonly --webroot --non-interactive --agree-tos --register-unsafely-without-email --webroot-path /var/www/wheelmaker/web --domain "$DOMAIN"
```

不要使用自签名证书，不要忽略证书错误，申请失败时不要继续使用 HTTP。

### 最终 HTTPS 配置

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name <domain>;
    root /var/www/wheelmaker/web;

    location ^~ /.well-known/acme-challenge/ {
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name <domain>;
    root /var/www/wheelmaker/web;
    index index.html;
    autoindex off;

    ssl_certificate /etc/letsencrypt/live/<domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<domain>/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;

    location /ws {
        proxy_pass http://127.0.0.1:9630;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }

    location = / {
        try_files /index.html =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    location = /index.html {
        try_files /index.html =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    location = /service-worker.js {
        try_files /service-worker.js =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    location = /manifest.webmanifest {
        try_files /manifest.webmanifest =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    location ~* \.[a-z0-9]+$ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }
}
```

`/ws` 必须保持 prefix location。它同时承载登录/status/logout HTTP 请求、WebSocket Upgrade 和 `/ws/preview/`；改成 exact `location = /ws` 会破坏 preview 响应。不要从旧服务器配置中添加已经退役的 `/monitor/` 路由。

执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

如果 `nginx -t` 失败，恢复备份的站点文件，不要 reload 损坏的配置。

## 8. 配置主机防火墙

识别当前使用的防火墙管理器，只做最小且安全的修改：

- 修改前保留当前 SSH 端口；
- 放行 TCP 80 和 TCP 443；
- 不允许公网访问 TCP 9630；
- 不清空、重置或替换未知防火墙规则；
- 如果云平台防火墙不能通过本次 SSH 会话修改，报告调用者需要在云平台放行 80/443。

对于 UFW 或 firewalld，使用它们原生的 service/port 命令。对于 nftables 或未知策略，先检查；如果可能影响已有服务，询问后再添加规则。

## 9. 最终验收

按选定用户执行相应检查：

```bash
sudo nginx -t
sudo -iu "$RUN_USER" systemctl --user is-active wheelmaker-hub.service
sudo -iu "$RUN_USER" systemctl --user is-enabled wheelmaker-updater.timer
ss -ltnp | grep ':9630'
curl --fail --silent --show-error --head "https://$DOMAIN/"
curl --silent --show-error --head "http://$DOMAIN/"
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' "https://$DOMAIN/ws?auth=status"
openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

只有满足以下条件才接受部署成功：

- `https://$DOMAIN/` 返回 WheelMaker 页面；
- HTTP 会跳转到 HTTPS；
- 证书有效并受客户端信任；
- `/ws?auth=status` 到达 WheelMaker，而不是返回代理 404/502；
- Hub 处于 active，updater timer 处于 enabled；
- `9630` 只绑定 loopback；
- 公网防火墙没有暴露 9630。

调用者现在可以打开页面，用已确认的 Registry Token 登录。最终部署摘要不要包含 Token，只说明受保护的配置文件路径。

## 失败处理

如果前置检查、平台检查、Token 决策、DNS 检查、证书申请、Nginx 测试、防火墙安全检查、服务检查或 HTTPS 检查失败：

1. 停止部署；
2. 不要宣称成功；
3. 保留受保护的备份并报告路径；
4. 报告具体失败检查和最小下一步；
5. 不要删除无关应用，也不要为了自动恢复而把 loopback Registry 端口暴露到公网。
