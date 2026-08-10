# WheelMaker：面向可 SSH 操作 AI 的 v2 部署指南

这是一份用于部署全新 Linux/amd64 WheelMaker Registry 入口机的执行 Runbook。它会部署 Hub、Web UI、内置 Gateway，以及可选的匿名 Share 路由。执行命令前必须先通读全文。

默认公网结构：

~~~text
https://<registry-domain>/       WheelMaker Web UI 和 Registry
https://<share-domain>/s/<token> 匿名文档分享
~~~

默认优先使用内置 Gateway。只有调用者明确表示不要内置 Gateway 时，才进入 Nginx 分支。服务器上已经安装 Nginx 不等于调用者拒绝 Gateway；如果 Nginx 已占用 80 或 443，先停止并询问调用者是把端口交给 Gateway，还是明确继续使用 Nginx。

## 执行规则

- 不要要求调用者把 SSH 私钥或密码粘贴到聊天中。使用 SSH agent、已有密钥路径或平台提供的安全 SSH 连接器。
- 把目标机视为生产机器。不要执行 git clone、源码构建、清空防火墙、暴露 loopback 端口或针对宽泛路径删除文件。
- 不要把 Registry Token 放入命令行、进程参数、Nginx 文件、日志、公开文档或最终报告。
- 必须让调用者明确选择 WheelMaker 运行用户，并确认 Registry Token 后，才能应用这些决定。
- 不要未经询问替换已有同域名 Nginx 站点或旧 Gateway 配置。
- 在服务、HTTPS、WebSocket、Share 和监听端口检查全部通过前，不得宣称部署成功。

## 调用者必须提供的信息

连接前收集以下信息：

| 输入 | 要求 |
| --- | --- |
| SERVER_IP | 用于 SSH 和 DNS 检查的 IPv4 或 IPv6 地址。 |
| REGISTRY_DOMAIN | WheelMaker 入口域名，不要包含协议、路径或端口。 |
| SHARE_DOMAIN | 可选的独立分享域名；不需要 Share 时留空。 |
| SSH_LOGIN | SSH 用户名，以及安全的密钥、agent 或连接器。 |

每个非空域名都必须在申请证书前解析到 SERVER_IP。Gateway 使用公网 TCP 80 和 443。内置 Gateway 不使用旧的任意 28800 入口端口。

## 1. 修改前检查目标机

先执行只读检查：

~~~bash
id
cat /etc/os-release
uname -s
uname -m
node --version 2>/dev/null || true
systemctl --user --version
systemctl --user show-environment
getent ahosts "$REGISTRY_DOMAIN" || true
[ -n "$SHARE_DOMAIN" ] && getent ahosts "$SHARE_DOMAIN" || true
ss -ltnp
command -v nginx && nginx -T 2>/dev/null || true
~~~

只有同时满足 Linux/amd64（Linux、x86_64）、Node.js 22.15+ 和可用的 systemd --user 时才能继续。遇到 ARM64、其他操作系统、没有持久 user manager 的容器，或必须从源码编译 WheelMaker 的目标机，直接停止。

记录以下事实：

- 80、443、9630、2019 是否已经被其他进程占用；
- 现有 Nginx 是否声明任一目标域名；
- $HOME/.wheelmaker 或 $HOME/.wheelmaker/gateway/config.json 是否已经存在；
- 选定用户的 systemd manager 是否能在退出 SSH 后继续运行。

如果旧 Gateway 配置已经存在，运行 Gateway 命令前必须检查它的 schema。schema 1 或旧版 Gateway 文件不会被 v2 自动迁移或覆盖。遇到这种情况停止，询问调用者下一步，不要删除或覆盖原文件。

## 2. 选择运行用户并启用 lingering

让调用者选择一项：

1. 使用 SSH 登录用户；
2. 使用专用的非特权用户，例如 wheelmaker。

Hub、Gateway、$HOME/.wheelmaker 和所有 user service 必须使用同一个用户。为该用户启用 lingering：

~~~bash
sudo loginctl enable-linger "$RUN_USER"
sudo -iu "$RUN_USER" systemctl --user show-environment
~~~

如果 user manager 检查失败，停止。不要用未记录的 root daemon 替代 user service。

## 3. 安装预编译 Hub 和 Web

以选定用户执行，不要以无关的 root 进程执行。命令可以从任意目录运行：

~~~bash
d="$HOME/.wheelmaker" && mkdir -p "$d" && curl --fail --location --progress-bar --proto '=https' --tlsv1.2 'https://release.wheelmaker.top/deploy.mjs' --output "$d/deploy.mjs" && node "$d/deploy.mjs"
~~~

启动器会通过 SHA-256 链验证公开元数据、部署脚本、manifest 和 Linux/amd64 包。全新安装只在 $HOME/.wheelmaker/ 下安装 Hub 和 Web，不需要源码仓库、Git、Go、npm 或编译器。

已有安装的普通 Hub/Web 更新使用已安装的：

~~~bash
node "$HOME/.wheelmaker/deploy.mjs" update
~~~

只有检测到旧运行时或旧 updater 且调用者批准清理时，才能执行 migrate-uninstall。不要把迁移清理塞进默认安装命令。

## 4. 只配置一份 Hub 公网地址

Registry 和 Share 的公网地址唯一保存在 Hub 的 $HOME/.wheelmaker/config.json。以选定用户原子编辑该文件并保留其他字段。入口机的相关形状如下：

~~~json
{
  "publicUrl": "https://registry.example.com",
  "projects": [],
  "token": "<调用者确认的 Token>",
  "hubId": "hub-a",
  "registry": {
    "listen": true,
    "port": 9630,
    "share": {
      "publicUrl": "https://share.example.com"
    }
  },
  "log": {
    "level": "warn"
  }
}
~~~

调用者不需要 Share 时，保持 registry.share.publicUrl 为空或省略 share 对象。不要把 share 放在顶层。如果启用 Share，必须使用与 publicUrl 不同的域名；Gateway 不允许两个路由使用同一个 hostname。

Registry Token 由入口机和受信任 Worker 共用。私下生成候选值，只给调用者查看并确认：

~~~bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
~~~

不要在部署记录中打印最终 Token。将 config.json 权限保持为 0600。

修改 Hub 配置后，使用已生成的 wrapper 重启 Hub：

~~~bash
"$HOME/.wheelmaker/stop.sh"
"$HOME/.wheelmaker/start.sh"
~~~

Gateway 会读取父目录中的 Hub 配置，并热加载合法变更。Gateway 自己的配置中不再保存第二份 Registry 或 Share publicUrl。

### 可选固定 Relay 端口

只有调用者明确需要受信任 Worker 的固定 Relay 数据路径时才配置：

~~~json
{
  "registry": {
    "listen": true,
    "port": 9630,
    "relayPort": 28810
  }
}
~~~

该端口必须符合调用者的网络策略，并且不能是 80、443、2019、9630 或 9680。默认不要公网暴露。

## 5. 默认安装内置 Gateway

除非调用者明确拒绝 Gateway，否则执行：

~~~bash
node "$HOME/.wheelmaker/deploy.mjs" gateway
~~~

必须以 Hub 所有者身份执行。该命令独立安装或升级 Gateway、创建 user service 并启动它。普通 Hub 部署不会安装、停止或重启 Gateway。

Gateway v2 会生成 $HOME/.wheelmaker/gateway/config.json，使用 schema 2 和 wm_sites。需要确认的字段如下：

~~~json
{
  "schema": 2,
  "wm_sites": {
    "tls": {
      "certificateFile": "",
      "keyFile": ""
    },
    "registry": {
      "urlMode": "sync_hub"
    },
    "share": {
      "urlMode": "sync_hub"
    }
  }
}
~~~

以上只是相关片段，不要用省略字段的示例覆盖 Gateway 自动生成的完整文件。不要在 wm_sites.registry 或 wm_sites.share 下填写 publicUrl。sync_hub 表示从前面那份 Hub 配置读取地址。不要创建第二个 Share 服务，也不要维护第二份 Share URL。

### Gateway TLS

首选自动申请公网 HTTPS：

- 每个启用的域名都解析到本机；
- 公网 TCP 80 和 443 能到达本机；
- wm_sites.tls.certificateFile 和 keyFile 保持为空；
- Gateway 通过内嵌 Caddy 自动申请和续期证书。

如果调用者提供已有证书，只在唯一的共享 wm_sites.tls 对象中同时填写证书和私钥路径。证书必须覆盖 Registry 和 Share 域名。不能只填写其中一个路径。

不输出密钥地检查服务：

~~~bash
systemctl --user is-active wheelmaker-gateway.service
systemctl --user is-enabled wheelmaker-gateway.service
ss -ltnp | grep -E ':(80|443|2019|9630)\b'
~~~

Gateway 公网监听端口是 80 和 443；admin 监听 2019 且只绑定 loopback；Hub listener 使用 loopback 9630。

## 6. Share 行为与验证

Share 由 Hub 和内置 Gateway 共同提供：

~~~text
$HOME/.wheelmaker/config.json.registry.share.publicUrl  地址来源
$HOME/.wheelmaker/shares/records/                    元数据
$HOME/.wheelmaker/shares/public/s/<token>             已发布 HTML
Gateway <share-domain>/s/<token>                      匿名路由
~~~

调用者在已登录的 Workspace 中创建分享。返回链接必须使用 SHARE_DOMAIN，接收者无需登录。清空或暂时无效的 Share 地址只会停用 Share 路由，不会删除已有分享记录。路由只提供精确 token 路径，不提供 SPA fallback。

创建一个测试分享后，尽可能从服务器外部验证：

~~~bash
curl --fail --silent --show-error --head "https://$SHARE_DOMAIN/s/<token>"
~~~

最终部署报告不要包含真实 Share token。

## 7. 只有调用者明确拒绝 Gateway 时才进入 Nginx 分支

不要因为服务器已经安装 Nginx 就自动进入本节。只有调用者明确选择 Nginx 替代 Gateway 时，才执行本节。

该分支不要运行 node $HOME/.wheelmaker/deploy.mjs gateway。启用 Share 时，Nginx 必须同时暴露两个 origin：

- Registry origin：从 $HOME/.wheelmaker/web 提供静态文件，/ws 以 WebSocket Upgrade 反代到 127.0.0.1:9630；
- Share origin：从 $HOME/.wheelmaker/shares/public 提供静态文件，只允许 /s/<43-character-token>；
- 9630 始终只绑定 loopback。

如果 Nginx 无法读取选定用户的 Home，只绑定两个公开根目录，并在持久化前验证来源：

~~~bash
sudo install -d -m 0755 /var/www/wheelmaker/web /var/www/wheelmaker/shares/public
sudo mount --bind "$HOME/.wheelmaker/web" /var/www/wheelmaker/web
sudo mount --bind "$HOME/.wheelmaker/shares/public" /var/www/wheelmaker/shares/public
findmnt -T /var/www/wheelmaker/web
findmnt -T /var/www/wheelmaker/shares/public
~~~

为两个域名分别配置 Nginx server block。Registry block 必须保持 /ws 为 prefix location：

~~~nginx
location ^~ /ws {
    proxy_pass http://127.0.0.1:9630;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 3600s;
    proxy_buffering off;
}

location / {
    try_files $uri $uri/ /index.html;
}
~~~

Share block 不得提供 SPA fallback：

~~~nginx
root /var/www/wheelmaker/shares/public;
default_type text/html;

location ~ ^/s/[A-Za-z0-9_-]{43}$ {
    try_files $uri =404;
    add_header Content-Disposition inline always;
    add_header Cache-Control "no-store" always;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    add_header Referrer-Policy no-referrer always;
    add_header X-Content-Type-Options nosniff always;
}

location / {
    return 404;
}
~~~

使用调用者现有的可信证书流程，先执行 nginx -t，通过后才 reload。不要修改无关的 server block。

## 8. 防火墙与最终验收

Gateway 分支放行 TCP 80 和 443；保持 9630、2019 不可从公网访问。只有调用者明确启用了 Relay 并批准网络范围时，才放行 relayPort。保留当前 SSH 规则，不清空未知防火墙策略。

执行相关最终检查：

~~~bash
systemctl --user is-active wheelmaker-hub.service
systemctl --user is-active wheelmaker-gateway.service
ss -ltnp | grep ':9630'
curl --fail --silent --show-error --head "https://$REGISTRY_DOMAIN/"
curl --silent --show-error --head "http://$REGISTRY_DOMAIN/"
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' "https://$REGISTRY_DOMAIN/ws?auth=status"
openssl s_client -connect "$REGISTRY_DOMAIN:443" -servername "$REGISTRY_DOMAIN" </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
~~~

只有满足以下条件才能接受部署成功：

- HTTPS Registry origin 返回 WheelMaker 页面；
- Gateway 分支下 HTTP 跳转到 HTTPS；
- /ws?auth=status 到达 Hub，而不是代理 404/502；
- Gateway 分支的 Hub 和 Gateway user service 均为 active/enabled；
- 9630 和 2019 只绑定 loopback；
- 测试分享链接从独立 Share origin 返回预期 HTML；
- 公网防火墙没有暴露内部端口。

如果前置检查、配置、服务、证书、代理、Share 或监听端口检查失败：停止，不要宣称成功，保留备份，报告具体失败检查，只询问最小的下一步决定。不要通过覆盖旧 Gateway 配置或暴露 9630 来自动恢复。
