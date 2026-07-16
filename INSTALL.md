# WheelMaker 首次部署 Runbook

本文档给 AI 操作员使用。目标是首次双机部署：先判断当前机器是 Registry 入口机还是 Worker，再按角色执行。

部署前先阅读 [安全模型](docs/security.md) 和 [已知风险](docs/security-known-risks.md)。

## 1. 环境准备

目标机器只需要 Node.js `22+`。部署流程从公共发布仓库下载元数据和预编译包，不需要 WheelMaker 源码、Git、Go、npm 或本机交叉编译环境。

Registry 入口机额外需要：

- Nginx
- 推荐准备 TLS 证书和私钥

执行原则：

- 先检测 Node，再安装或升级；不要在目标机安装无关的源码构建工具链。
- Windows 可使用现有 Scoop 或 winget 安装 Node；不要自动安装 Scoop。
- Linux 发行版包不满足 Node 22 时，先提出 NodeSource、nvm 等方案让用户确认。
- 只有 Registry 入口机才处理 Nginx。
- 正常部署和 `deploy.mjs update` 不需要管理员权限。Windows 一次性迁移仅在发现旧 Windows Service 时弹 UAC。

常用检测：

```bash
node --version
nginx -v
```

Windows 额外确认：

```powershell
scoop --version
winget --version
where node
where nginx
```

Linux 部署服务前确认 user service 能长期运行：

```bash
systemctl --user status
loginctl show-user "$USER" -p Linger
sudo loginctl enable-linger "$USER"
```

## 2. 获取公共部署启动器

全新安装不需要克隆私有源码仓库。把公共发布仓库中的 `deploy.mjs` 放到 `~/.wheelmaker/deploy.mjs`：

Windows PowerShell：

```powershell
$install = Join-Path $HOME '.wheelmaker'
New-Item -ItemType Directory -Force -Path $install | Out-Null
Invoke-WebRequest 'https://raw.githubusercontent.com/swm8023/wheelmaker-release/main/deploy.mjs' -OutFile (Join-Path $install 'deploy.mjs')
node (Join-Path $install 'deploy.mjs')
```

macOS/Linux：

```bash
mkdir -p "$HOME/.wheelmaker"
curl --fail --location --proto '=https' --tlsv1.2 \
  https://raw.githubusercontent.com/swm8023/wheelmaker-release/main/deploy.mjs \
  --output "$HOME/.wheelmaker/deploy.mjs"
node "$HOME/.wheelmaker/deploy.mjs"
```

启动器通过 GitHub HTTPS 下载 `stable.json`，并按其中的固定 SHA-256 刷新自身核心，再按 stable → manifest → 平台包的 SHA-256 链验证下载内容。后续目标机版本判断只读公开 stable 和本地 schema v2 `release.json`，不读取 Git。发布安全边界是公开发布仓库的写权限，因此应严格保护该仓库及发布 GitHub App。

## 3. 确认共享 Token 策略

首次部署在缺少配置时会从系统加密随机源自动生成独立的 32-byte/256-bit Base64URL Registry Token；不要设置默认值，也不要把 Token 放进仓库或命令行。随机源失败时部署会直接失败。

Registry 入口机和所有受信任 Worker 使用同一个 Token。入口机部署完成后，通过受保护的本地方式把 `~/.wheelmaker/config.json` 中的 `registry.token` 配置到 Worker；不要在聊天或普通日志中传递。显式配置的短 Token 会被接受，但抗猜测强度更低，不推荐新部署使用。

## 4. 首次部署

全新安装已在第 2 节通过 `node ~/.wheelmaker/deploy.mjs` 完成。只有从旧源码发布模式迁移时，才在旧源码仓库根目录执行一次迁移 wrapper：

Windows：

```bat
deploy.bat
```

macOS/Linux：

```bash
bash deploy.sh
```

说明：

- wrapper 先把 `scripts/deploy/deploy.mjs` 复制到 `~/.wheelmaker/deploy.mjs`，调用 `migrate-uninstall`，再执行一次正常部署。后续不要再调用迁移模式。
- 迁移会删除旧 Hub/updater/deploy/monitor 运行时和 `~/.wheelmaker/build/bootstrap`，但保留配置、数据库、日志和 Desktop。
- Windows 只有发现旧 Windows Service 时才可能触发 UAC；新 Scheduled Task 使用当前用户、Limited 权限。
- 正常部署下载并验证预编译 Hub + Web，始终一起替换到 `~/.wheelmaker/bin` 和 `~/.wheelmaker/web`，在缺失时创建 `config.json`，写 schema v2 `release.json`，并启动 Hub。
- 固定的 03:00 updater 和 Web 手动更新都调用 `node ~/.wheelmaker/deploy.mjs update`。该命令只停止/替换/启动现有运行时，不安装或卸载服务/任务，也不需要管理员权限。
- Windows Desktop 按需单独更新：先关闭 Desktop，再运行 `~/.wheelmaker/update_exe.bat`。若本次 stable 版本没有发布新 EXE，会继续使用 stable 中继承的上一版 Desktop 指针。

安装目录：

```text
~/.wheelmaker/bin/       Hub
~/.wheelmaker/web/       每次部署的完整 Web
~/.wheelmaker/desktop/   可选 Desktop EXE
~/.wheelmaker/staging/   lock.json、status.json 和临时包
```

生命周期 helper 保持原文件名：Windows 为 `start.bat`、`stop.bat`、`restart.bat`、`status.bat`；macOS/Linux 为对应 `.sh`。Windows 另有 `update_exe.bat`。

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

### 配置 Server 功能

使用新版本浏览器、Desktop 或 APK，通过 Registry 的 HTTPS 页面登录后，打开 **设置 > Server**，按需填写：

- Volcengine ASR Key 和模型
- MiMo TTS Key、模型和音色
- DeepSeek Key

不再有独立 enable 开关；有 Key 即启用，清除 Key 即停用。配置保存在 Registry 入口机的 `~/.wheelmaker/db/server-data.json`，不会写入 `config.json`、浏览器本地存储或 Worker。该文件是运行时需要的明文凭据文件，部署程序会收紧文件权限并原子写入，但备份仍必须按密钥保护。

旧版客户端保存的 Key 不会迁移。所有客户端都必须升级，并在 Server 分组重新配置。Web/Desktop 的语音和 TTS 由服务端调用 provider；Android 只在认证后取得 Volcengine ASR Key，保存在进程内存并直连火山，退出登录、切换服务器或进程退出后会清除。Nginx 不需要为这些 Server 配置增加新 location，仍使用现有 HTTPS 页面和 `/ws`。

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
- 远程地址必须使用 `https://<registry-host>:28800`；WheelMaker 会把 HTTPS origin 转换成 WSS endpoint。
- 证书必须能通过系统信任链验证，不提供证书忽略开关。
- `registry.token` 必须和入口机一致。
- 每台机器的 `registry.hubId` 必须唯一。

## 7. Nginx 配置

只在 Registry 入口机配置 Nginx。

写配置前先确认：

- 域名或 IP
- 对外端口，默认 `28800`
- TLS 证书和私钥路径。远程入口只支持 HTTPS/WSS。
- 证书应由公开 CA 签发，或由已经正确安装进所有客户端系统信任链的组织 CA 签发。
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
        add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self' wss: https://api.github.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
    }

    location = /index.html {
        try_files /index.html =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
        add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self' wss: https://api.github.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
    }

    location = /service-worker.js {
        try_files /service-worker.js =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
        add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self' wss: https://api.github.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
    }

    location = /manifest.webmanifest {
        try_files /manifest.webmanifest =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
        add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self' wss: https://api.github.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
    }

    location ~* \.[a-z0-9]+$ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self' wss: https://api.github.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
    }

    location / {
        index index.html;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, must-revalidate" always;
        add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self' wss: https://api.github.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
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

旧 Nginx 配置不加上述四个安全响应头时，新的 `index.html` 仍会通过 meta CSP 和 `no-referrer` 获得部分保护，但 `frame-ancestors` 和非 HTML 资源保护无法通过完整验收。无需新增认证 location；只需在计划升级既有 Nginx 时，把同样的四行加入每个静态 location。`upgrade-insecure-requests` 面向正式 HTTPS 部署，公网入口应使用 HTTPS。

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

Registry 入口机（不得使用 `-k` 跳过证书校验）：

```bash
curl https://<registry-host>:28800/
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

## 9. Android Release 签名

Android `release` 构建不会再回退到 debug key。执行 `assembleRelease`、`bundleRelease`、`build` 或发布脚本前，必须在当前进程环境中提供：

- `WHEELMAKER_ANDROID_KEYSTORE`：JKS/PKCS12 文件的绝对路径
- `WHEELMAKER_ANDROID_STORE_PASSWORD`
- `WHEELMAKER_ANDROID_KEY_ALIAS`
- `WHEELMAKER_ANDROID_KEY_PASSWORD`

缺少任一项、keystore 不存在、alias 不存在或密码无法加载 key 时，构建会直接失败；debug/test/lint 不需要这些变量。不要把密码写进仓库、Gradle 参数、命令历史或发布报告。变量名说明见 `mobile/android/release-signing.properties.example`。

发布报告只记录 keystore 文件名和从已签名 APK 读取的证书 SHA-256，不记录 keystore 路径或密码。发布机器需要 Android SDK Build Tools 的 `apksigner`：

```powershell
$env:WHEELMAKER_ANDROID_KEYSTORE = "C:\secure\wheelmaker-release.jks"
$env:WHEELMAKER_ANDROID_STORE_PASSWORD = Read-Host "Keystore password"
$env:WHEELMAKER_ANDROID_KEY_ALIAS = "wheelmaker-release"
$env:WHEELMAKER_ANDROID_KEY_PASSWORD = Read-Host "Key password"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish_android.ps1
```

发布完成后从当前进程清除密码变量。
