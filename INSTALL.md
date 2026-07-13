# WheelMaker 首次部署 Runbook

本文档给 AI 操作员使用。目标是首次双机部署：先判断当前机器是 Registry 入口机还是 Worker，再按角色执行。

## 1. 环境准备

每台机器都需要：

- Git 可用
- Go `1.26+`
- Node.js `22.11+`
- npm 可用

Registry 入口机额外需要：

- Nginx
- 推荐准备 TLS 证书和私钥

执行原则：

- 先检测，再安装或升级。
- 已存在且版本满足要求就跳过。
- 已存在但版本不满足时，先尝试升级；升级失败再询问用户。
- 不要重复安装同类工具链。
- Windows：如果已有 Scoop，用 Scoop；没有 Scoop 就用 winget。不要自动安装 Scoop。
- Linux：发行版包版本满足时再用发行版包；不满足时先提出 Go 官方包、NodeSource、nvm 等升级方案，让用户确认。
- 只有 Registry 入口机才处理 Nginx。
- Go module 或 npm 下载长时间无进展、超时、连接失败时，可以建议临时换源，但先说明原因并让用户确认。不要一开始就换源。

常用检测：

```bash
git --version
go version
node --version
npm --version
nginx -v
```

Windows 额外确认：

```powershell
scoop --version
winget --version
where nginx
```

Linux 部署服务前确认 user service 能长期运行：

```bash
systemctl --user status
loginctl show-user "$USER" -p Linger
sudo loginctl enable-linger "$USER"
```

下载源处理 tips：

- Go 可临时使用 `GOPROXY=https://goproxy.cn,direct`，或恢复为 `https://proxy.golang.org,direct`。
- npm 可临时使用 `https://registry.npmmirror.com`，部署后提醒用户是否恢复默认 registry。
- 换源是环境改动；执行前必须说明当前失败现象和将要修改的配置。

## 2. 克隆仓库

优先使用 SSH：

```bash
ssh -T git@github.com
git clone git@github.com:swm8023/WheelMaker.git
cd WheelMaker
```

如果 SSH 不可用，并且用户确认可以用 HTTPS：

```bash
git clone https://github.com/swm8023/WheelMaker.git
cd WheelMaker
```

不要猜其他仓库地址。

## 3. 生成共享 Token

先问用户是否已有共享 Registry token。没有则生成一个高熵 token。

Windows：

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

macOS/Linux：

```bash
openssl rand -base64 32
```

Registry 入口机和所有 Worker 必须使用同一个 token。

## 4. 首次部署

在仓库根目录执行。

Windows：

```bat
deploy.bat
```

macOS/Linux：

```bash
bash deploy.sh
```

说明：

- 首次部署必须用 `deploy.bat` 或 `deploy.sh`。
- 不要用 `update-publish.bat` 或 `update-publish.sh` 做首次部署；它们只适合服务已存在后的更新发布。
- Windows 可能触发 UAC；首次创建服务时可能要求当前账号密码。AI 运行前要提醒用户关注终端或弹窗，命令长时间停住时先判断是否正在等待人工输入。
- 部署流程会构建二进制、发布 Web 到 `~/.wheelmaker/web`、安装服务，并在缺失时创建 `~/.wheelmaker/config.json`。

## 5. Registry 入口机配置

Registry 入口机负责：

- `registry.listen: true`
- 本机运行 Registry listener
- 发布 Web UI
- 配置 Nginx，对外提供 Web UI 和 `/ws`

编辑 `~/.wheelmaker/config.json`：

```json
{
  "projects": [
    {
      "name": "WheelMaker",
      "path": "D:\\Code\\WheelMaker"
    }
  ],
  "registry": {
    "listen": true,
    "port": 9630,
    "server": "127.0.0.1",
    "token": "<shared-token>",
    "hubId": "hub-a"
  },
  "log": {
    "level": "warn"
  }
}
```

要点：

- `projects[].path` 改成实际 checkout 路径。
- `registry.server` 在 Registry 入口机上用 `127.0.0.1`。
- `registry.token` 使用共享 token。
- `registry.hubId` 要稳定且唯一。

重启服务：

```bash
~/.wheelmaker/restart.sh
```

Windows：

```powershell
~/.wheelmaker/restart.bat
```

## 6. Worker 机器配置

Worker 机器负责：

- `registry.listen: false`
- 运行本机 Hub
- 把本机项目和 agent 上报到 Registry 入口机
- 不配置 Nginx

编辑 `~/.wheelmaker/config.json`：

```json
{
  "projects": [
    {
      "name": "Project-B",
      "path": "D:\\Code\\Project-B"
    }
  ],
  "registry": {
    "listen": false,
    "port": 9630,
    "server": "https://<registry-host>:28800",
    "token": "<shared-token>",
    "hubId": "hub-b"
  },
  "log": {
    "level": "warn"
  }
}
```

要点：

- `registry.server` 写 Registry 入口机的 origin，不要写 `/ws`。
- 推荐使用 `https://<registry-host>:28800`；内网临时部署也可以用用户确认过的 `http://...`。
- WheelMaker 会把 HTTP/HTTPS origin 转换成 WebSocket endpoint。
- `registry.token` 必须和入口机一致。
- 每台机器的 `registry.hubId` 必须唯一。

## 7. Nginx 配置

只在 Registry 入口机配置 Nginx。

写配置前先确认：

- 域名或 IP
- 对外端口，默认 `28800`
- 使用 HTTPS 还是 HTTP。推荐 HTTPS；公网部署应优先 HTTPS。内网临时部署可在用户确认后使用 HTTP。
- 如果使用 HTTPS，确认 TLS 证书路径和私钥路径。
- Nginx 配置目录或目标配置文件路径。

默认只暴露：

- `/`：Web UI 静态文件，root 指向 `~/.wheelmaker/web`
- `/ws`：反代到 `http://127.0.0.1:9630`

HTTPS 模板：

```nginx
server {
    listen 28800 ssl;
    server_name _;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;

    root /home/<user>/.wheelmaker/web;

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
        index index.html;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    location /ws {
        proxy_pass http://127.0.0.1:9630;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
```

HTTP 临时内网模板只去掉 `ssl` 和证书配置：

```nginx
server {
    listen 28800;
    server_name _;
    root /home/<user>/.wheelmaker/web;

    location / {
        index index.html;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    location /ws {
        proxy_pass http://127.0.0.1:9630;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
```

Windows 路径示例：

```nginx
root C:/Users/<User>/.wheelmaker/web;
ssl_certificate     C:/path/to/fullchain.pem;
ssl_certificate_key C:/path/to/privkey.pem;
```

安全流程：

1. 生成配置。
2. 展示给用户确认。
3. 用户确认后写入配置文件。
4. 执行 `nginx -t`。
5. 只有测试通过后才 reload。

```bash
nginx -t
nginx -s reload
```

需要 sudo 时：

```bash
sudo nginx -t
sudo nginx -s reload
```

## 8. 验证

Registry 入口机：

```bash
curl -k https://<registry-host>:28800/
```

如果使用 HTTP：

```bash
curl http://<registry-host>:28800/
```

确认服务状态：

```bash
~/.wheelmaker/status.sh
```

Windows：

```powershell
~/.wheelmaker/status.bat
```

Worker 无法连上入口机时，优先检查：

- `registry.server`
- 共享 token
- Nginx `/ws` WebSocket 代理
- 防火墙和对外端口
- Registry 入口机服务状态
