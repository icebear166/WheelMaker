# WheelMaker 首次部署 Runbook

本文档主要给 AI 操作员使用。按决策树执行，不要跳过检查，不要猜测机器上的路径，不要重复安装同类工具链。

## 0. 先确认本机角色

部署前先问用户：

```text
这台机器是否作为 Registry 入口机？
```

如果答案是“是”，这台机器需要：

- 运行 Registry listener，配置 `registry.listen: true`
- 发布 Workspace Web UI 到 `~/.wheelmaker/web`
- 对外暴露 HTTPS 入口 `https://<host>:28800/`
- 对外暴露 Registry WebSocket `wss://<host>:28800/ws`
- 安装并配置 Nginx

如果答案是“否”，这台机器是 Worker：

- 为本机项目和 agent 运行 Hub
- 配置 `registry.listen: false`
- 通过 `https://<host>:28800` 连接 Registry 入口机
- 不安装、不配置 Nginx
- 不暴露 Monitor

Monitor 默认不暴露。主部署流程里不要询问是否暴露 Monitor。只有用户后续明确要求暴露 Monitor 时，才补充 Monitor 反向代理配置。

## 1. 版本要求

每台机器都必须满足：

- Git：已安装，并且在 `PATH` 中可用
- Go：`1.26+`
- Node.js：`22.11+`
- npm：随 Node.js 可用

仅 Registry 入口机必须满足：

- Nginx：已安装并可用，或者用户提供明确的 `nginx` 绝对路径
- TLS 证书和私钥

执行规则：

- 先检测，再安装。
- 如果工具已存在且版本满足要求，跳过。
- 如果工具已存在但版本太旧，先尝试用当前机器正在使用的包管理器升级。
- 如果升级失败，停止并询问用户确认下一步安装或升级方式。
- 不要为同一个依赖安装重复工具链。
- 不要自动安装 Scoop。
- Windows 上如果已经有 Scoop，就用 Scoop；如果没有 Scoop，就用 winget。
- Linux 上只有当发行版包能满足版本要求时才使用发行版包。否则提出明确的版本升级方案，并在修改系统工具链前让用户确认。

## 2. 环境检查

### Windows

先执行：

```powershell
git --version
go version
node --version
npm --version
scoop --version
winget --version
```

如果本机是 Registry 入口机，还要执行：

```powershell
nginx -v
where nginx
```

如果 Scoop 已存在，用 Scoop 安装缺失依赖或升级旧版本：

```powershell
scoop update
scoop install git
scoop install go
scoop install nodejs-lts
```

仅 Registry 入口机执行：

```powershell
scoop install nginx
```

如果 Scoop 不存在，不要安装 Scoop，改用 winget：

```powershell
winget install --id Git.Git
winget install --id GoLang.Go
winget install --id OpenJS.NodeJS.LTS
```

仅 Registry 入口机执行：

```powershell
winget install --id Nginx.Nginx
```

如果依赖已存在但版本不满足，先尝试对应包管理器的升级命令：

```powershell
scoop update git go nodejs-lts nginx
```

或：

```powershell
winget upgrade --id Git.Git
winget upgrade --id GoLang.Go
winget upgrade --id OpenJS.NodeJS.LTS
winget upgrade --id Nginx.Nginx
```

如果升级失败，停止并询问用户如何继续。

### macOS

先执行：

```bash
git --version
go version
node --version
npm --version
brew --version
```

如果本机是 Registry 入口机，还要执行：

```bash
nginx -v
which nginx
```

使用 Homebrew 安装或升级：

```bash
brew update
brew install git go node
brew upgrade git go node
```

仅 Registry 入口机执行：

```bash
brew install nginx
brew upgrade nginx
```

如果没有 Homebrew，或者 Homebrew 无法提供 Go `1.26+` 和 Node.js `22.11+`，停止并让用户确认替代安装方案。

### Linux

先执行：

```bash
git --version
go version
node --version
npm --version
systemctl --user status
loginctl show-user "$USER" -p Linger
```

如果本机是 Registry 入口机，还要执行：

```bash
nginx -v
which nginx
```

部署服务前启用 lingering：

```bash
sudo loginctl enable-linger "$USER"
```

Ubuntu/Debian 基础依赖：

```bash
sudo apt update
sudo apt install -y git nginx
```

只有 Registry 入口机才安装 `nginx`。

在 Go 达到 `1.26+` 且 Node.js 达到 `22.11+` 之前，不要继续部署。如果发行版包版本过旧，提出明确升级方案，例如官方 Go tarball 加 NodeSource 或 nvm，并在修改系统工具链前让用户确认。

## 3. 克隆仓库

如果目标机器已经配置 GitHub SSH 访问，优先使用 SSH：

```bash
ssh -T git@github.com
git clone git@github.com:swm8023/WheelMaker.git
cd WheelMaker
```

如果 SSH 不可用，并且用户确认可以使用 HTTPS：

```bash
git clone https://github.com/swm8023/WheelMaker.git
cd WheelMaker
```

不要猜测其他仓库地址。

## 4. 生成共享 Token

先问用户是否已有共享 Registry token。

如果用户没有提供 token，生成一个高熵 token。

Windows：

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

macOS/Linux：

```bash
openssl rand -base64 32
```

Registry 入口机和所有 Worker 机器必须使用同一个 token。

## 5. 首次部署

在仓库根目录执行。

Windows：

```bat
deploy.bat
```

macOS/Linux：

```bash
bash deploy.sh
```

部署 wrapper 会先构建 bootstrap `wheelmaker-deploy` CLI，然后执行首次部署流程。部署流程会构建二进制、发布 Web 资源、在 `~/.wheelmaker` 下写入辅助脚本、安装服务，并且仅在 `~/.wheelmaker/config.json` 不存在时创建默认配置。

Windows 可能触发 UAC 提权；首次创建服务时，也可能要求输入当前账号密码。

## 6. 配置 Registry 入口机

编辑 `~/.wheelmaker/config.json`。

使用以下结构：

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
  "monitor": {
    "server": "127.0.0.1",
    "port": 9631
  },
  "log": {
    "level": "warn"
  }
}
```

根据实际 checkout 路径调整 `projects[].path`。

规则：

- `registry.listen` 必须是 `true`。
- Registry 入口机上的 `registry.server` 应为 `127.0.0.1`。
- `registry.token` 必须是共享 token。
- `registry.hubId` 必须稳定且唯一。
- `monitor.port` 只用于本机。Nginx 默认不要暴露 Monitor。

修改配置后重启服务。

Windows：

```powershell
~/.wheelmaker/restart.bat
```

macOS/Linux：

```bash
~/.wheelmaker/restart.sh
```

## 7. 配置 Worker 机器

编辑 `~/.wheelmaker/config.json`。

使用以下结构：

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
  "monitor": {
    "server": "127.0.0.1",
    "port": 9631
  },
  "log": {
    "level": "warn"
  }
}
```

规则：

- `registry.listen` 必须是 `false`。
- `registry.server` 必须指向 Registry 入口机的 HTTPS origin，不要写 `/ws`。
- WheelMaker 会在内部把 HTTPS origin 转换成 WebSocket endpoint。
- `registry.token` 必须和 Registry 入口机一致。
- 每台机器的 `registry.hubId` 必须唯一。
- Worker 机器不要配置 Nginx。

修改配置后重启服务。

## 8. Registry 入口机上的 Nginx

写入 Nginx 配置前，先询问用户：

- 域名或公网 IP
- 对外 HTTPS 端口，默认 `28800`
- TLS 证书路径
- TLS 私钥路径
- Nginx 配置目录或目标配置文件路径

不要询问 Monitor。Monitor 默认不暴露。

默认使用以下 server block：

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

Windows 使用 Windows 路径：

```nginx
root C:/Users/<User>/.wheelmaker/web;
ssl_certificate     C:/path/to/fullchain.pem;
ssl_certificate_key C:/path/to/privkey.pem;
```

安全执行流程：

1. 生成 Nginx 配置。
2. 展示给用户确认。
3. 用户确认后再写入配置文件。
4. 执行 `nginx -t`。
5. 只有 `nginx -t` 通过后才 reload Nginx。

常见 reload 命令：

Windows：

```powershell
nginx -t
nginx -s reload
```

macOS/Linux：

```bash
sudo nginx -t
sudo nginx -s reload
```

## 9. 验证

在 Registry 入口机上执行：

```bash
curl -k https://<registry-host>:28800/
```

在浏览器确认 Web UI 能打开：

```text
https://<registry-host>:28800/
```

确认服务正在运行。

Windows：

```powershell
~/.wheelmaker/status.bat
```

macOS/Linux：

```bash
~/.wheelmaker/status.sh
```

每台 Worker 机器重启后，确认本机 Hub 能连接到 Registry 入口机。如果无法连接，检查：

- `registry.server`
- 共享 token
- Nginx `/ws` WebSocket 代理
- 对外 HTTPS 端口的防火墙
- Registry 入口机服务状态

## 10. 首次部署不要使用 update-publish

首次部署不要使用 `update-publish.bat` 或 `update-publish.sh`。它们只用于服务已经存在之后，向 updater 请求更新和 Web 发布。

首次部署始终使用：

```bat
deploy.bat
```

或：

```bash
bash deploy.sh
```
