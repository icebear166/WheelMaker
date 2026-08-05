# WheelMaker 首次部署 Runbook

本文档给 AI 操作员使用。目标是首次双机部署：先判断当前机器是 Registry 入口机还是 Worker，再按角色执行。

部署前先阅读 [安全模型](docs/security.md) 和 [已知风险](docs/security-known-risks.md)。

## 1. 环境准备

目标机器只需要 Node.js `22.15+`。部署流程从公共发布仓库下载元数据和预编译包，不需要 WheelMaker 源码、Git、Go、npm 或本机交叉编译环境。

Registry 入口机额外需要：

- Nginx
- 推荐准备 TLS 证书和私钥

执行原则：

- 先检测 Node，再安装或升级；不要在目标机安装无关的源码构建工具链。
- Windows 可使用现有 Scoop 或 winget 安装 Node；不要自动安装 Scoop。
- Linux 发行版包不满足 Node 22.15 时，先提出 NodeSource、nvm 等方案让用户确认。
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

全新安装和旧源码模式迁移都不需要克隆或进入源码仓库。以下整行命令可在任意目录执行：它把公共 `deploy.mjs` 下载到 `~/.wheelmaker/deploy.mjs`，先幂等清理可能存在的旧运行时，再安装当前 stable。

Windows PowerShell：

```powershell
$ErrorActionPreference='Stop'; $d=Join-Path $HOME '.wheelmaker'; New-Item -ItemType Directory -Force -Path $d | Out-Null; $m=Join-Path $d 'deploy.mjs'; Invoke-WebRequest 'https://release.wheelmaker.top/deploy.mjs' -OutFile $m; & node $m migrate-uninstall; if ($LASTEXITCODE -eq 0) { & node $m }
```

macOS/Linux：

```bash
(d="$HOME/.wheelmaker" && mkdir -p "$d" && curl --fail --location --proto '=https' --tlsv1.2 --progress-bar 'https://release.wheelmaker.top/deploy.mjs' --output "$d/deploy.mjs" && node "$d/deploy.mjs" migrate-uninstall && node "$d/deploy.mjs")
```

启动器从 `https://release.wheelmaker.top` 匿名下载 schema 2 `stable.json`，把其中的根相对路径限制在同一个 Origin，并按固定 SHA-256 刷新自身核心，再按 stable → manifest → 平台包的 SHA-256 链验证下载内容。后续目标机版本判断只读公开 stable 和本地 schema v2 `release.json`，不读取 Git。自建通道从 `v1.1` 重新开始，不迁移或比较旧 GitHub 通道的 stable、历史和版本号。

## 3. 确认共享 Token 策略

首次部署在缺少配置时会从系统加密随机源自动生成独立的 32-byte/256-bit Base64URL Registry Token；不要设置默认值，也不要把 Token 放进仓库或命令行。随机源失败时部署会直接失败。

Registry 入口机和所有受信任 Worker 使用同一个 Token。入口机部署完成后，通过受保护的本地方式把 `~/.wheelmaker/config.json` 中的 `registry.token` 配置到 Worker；不要在聊天或普通日志中传递。显式配置的短 Token 会被接受，但抗猜测强度更低，不推荐新部署使用。

## 4. 首次部署

全新安装或旧源码发布模式迁移都已由第 2 节的一行命令完成。源码仓库根目录不再提供迁移 wrapper，当前目录不会参与安装。

说明：

- 一行命令下载公共 launcher，调用一次 `migrate-uninstall`，再执行正常部署。后续日常部署不要再调用迁移模式。
- 迁移会删除旧 Hub/updater/deploy/monitor 运行时、`~/.wheelmaker/build`、`mobile`、`tmp`、旧 `cache/go-build`、`update-now.signal` 和退役的 restart/status helper，但保留配置、数据库、日志、Desktop 与当前 agent cache。
- Windows 只有发现旧 Windows Service 时才可能触发 UAC；新 Scheduled Task 使用当前用户、Limited 权限。
- 正常部署下载并验证预编译 Hub + Web，始终一起替换到 `~/.wheelmaker/bin` 和 `~/.wheelmaker/web`，在缺失时创建 `config.json`，写 schema v2 `release.json`，并启动 Hub。
- 正常部署会在安装目录生成当前平台的日常部署入口：Windows 双击 `~/.wheelmaker/deploy.bat`，macOS/Linux 执行 `~/.wheelmaker/deploy.sh`。两者只调用 `node deploy.mjs`，不执行迁移；Windows 完成后会暂停窗口以便查看结果。
- 固定的 03:00 updater 和 Web 手动更新都调用 `node ~/.wheelmaker/deploy.mjs update`。该命令只停止/替换/启动现有运行时，不安装或卸载服务/任务，也不需要管理员权限。
- Windows Desktop 按需单独更新：先关闭 Desktop，再运行 `~/.wheelmaker/update_exe.bat`。若本次 stable 版本没有发布新 EXE，会继续使用 stable 中继承的上一版 Desktop 指针。

安装目录：

```text
~/.wheelmaker/bin/       Hub
~/.wheelmaker/web/       每次部署的完整 Web
~/.wheelmaker/desktop/   可选 Desktop EXE
~/.wheelmaker/staging/   lock.json、status.json 和临时包
```

安装目录 helper 保持轻量：Windows 为 `deploy.bat`、`start.bat`、`stop.bat`，macOS/Linux 为对应 `.sh`；Windows 另有 `update_exe.bat`。这里的 `deploy.bat/sh` 是日常部署入口；源码仓库根目录不再提供同名迁移 wrapper。重启时依次调用 `stop`、`start`；发布状态由 Web 和 `staging/status.json` 提供，不生成 restart/status helper。

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
~/.wheelmaker/stop.sh
~/.wheelmaker/start.sh
```

Windows：

```powershell
~/.wheelmaker/stop.bat
~/.wheelmaker/start.bat
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

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 5;
    gzip_types
        text/css
        application/javascript
        application/json
        application/manifest+json
        image/svg+xml;

    root /home/<user>/.wheelmaker/web;

    location = / {
        try_files /index.html =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
        add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self' wss: https://release.wheelmaker.top https://codexradar.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
    }

    location = /index.html {
        try_files /index.html =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
        add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self' wss: https://release.wheelmaker.top https://codexradar.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
    }

    location = /service-worker.js {
        try_files /service-worker.js =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
        add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self' wss: https://release.wheelmaker.top https://codexradar.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
    }

    location = /manifest.webmanifest {
        try_files /manifest.webmanifest =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
        add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self' wss: https://release.wheelmaker.top https://codexradar.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
    }

    location ~* \.[a-z0-9]+$ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self' wss: https://release.wheelmaker.top https://codexradar.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
    }

    location / {
        index index.html;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, must-revalidate" always;
        add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self' wss: https://release.wheelmaker.top https://codexradar.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests" always;
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

压缩配置必须写入实际提供 Base URL 静态资源的 Nginx；只有 `nginx -t` 通过并 reload 后，APK、EXE 和浏览器才能收到压缩资源。

`/ws/preview/` 是经过认证的 iframe POST 端点，由现有 `/ws` prefix location
一并代理。必须保持前缀匹配；若改为精确匹配 `/ws`，Registry WebSocket
仍可工作，但 HTML 预览响应会被挡住。预览响应必须原样透传 upstream Content-Security-Policy，
且 must not add X-Frame-Options: DENY；上面静态 Web location 的 `DENY`
仍然保留。使用此模板的部署不需要新增 Nginx location。

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

确认 Web 可以访问，并在 Web 更新页面或 `~/.wheelmaker/staging/status.json` 查看最近一次发布任务状态。安装目录不再生成单独的 status helper。

Worker 无法连上入口机时，优先检查：

- `registry.server`
- 共享 token
- Nginx `/ws` WebSocket 代理
- 防火墙和对外端口
- Registry 入口机服务状态

## 9. 统一发布与 Android 签名

从仓库根目录运行 `publish-release.bat`，依次选择是否包含 Desktop、是否包含 Android、是否发布到 public release server。三个选项默认都是否；不发布时仍匿名读取 `https://release.wheelmaker.top/stable.json`，使用下一个 `v1.x` 并写入 `.release-out/v1.x/`，不会创建 Token 或远端 session。可复用的 Webpack、Go、Gradle 缓存位于 `.release-work/cache/`，本轮临时目录 `.release-work/tmp/` 在成功或失败后清理。

非交互调用为：

```powershell
node scripts/release.mjs --with-desktop --with-android --publish
```

Android `release` 构建不会回退到 debug key。统一发布器从 `mobile/android/signing/signing.properties` 和 `mobile/android/signing/release.p12` 读取已提交的发布身份，不依赖本机环境变量。修改这两个文件会改变后续 APK 的签名身份，应按发布凭据保护源码仓库写权限和备份。发布机器需安装 JDK 17、Android SDK Build Tools、Gradle 和 Node.js 22.15+；未选择 Android 时不初始化 Android 工具链。

`v1.x` 对应 Android `versionName=1.x`、`versionCode=x`。选中 Android 后，APK 与 `android-release.json` 进入同一个自建 `releases/v1.x/` 目录；未选中时 `stable.androidApk` 继承最近一次 Android 资产。主机上的 `deploy.mjs` 不下载 APK，只有原生 Android Update 页面使用该公共指针安装更新。

第一次本地正式发布会自动生成 32-byte Token，先以私有权限写入 `~/.wheelmaker/release-server.json.pending`，通过 SSH 只把 SHA-256 配到服务器，确认 `/healthz` 后再原子改名为 `~/.wheelmaker/release-server.json`。中断后会复用 pending Token，不会生成第二个不匹配的值。若 `gh --version` 和 `gh auth status` 都成功，发布器还会通过标准输入设置私有源码仓库的 `WHEELMAKER_RELEASE_TOKEN` Secret；该步骤失败只给出警告，不影响已经可用的本地发布。Action 只读取这个 Secret，且不使用 SSH。

发布服务单独通过 `deploy-release-server.bat` 部署。运行前需要 Windows 上可用的 `go`、`ssh`、`scp`、干净的源码 commit、`~/.ssh/wheelmaker-release-server_ed25519` 和 `root@release.wheelmaker.top` 权限。正常模式幂等更新 loopback Release Server 和独立 Gateway 的站点声明，不管理 Gateway 生命周期，也不删除 `/srv/wheelmaker-release/public/releases`。已有旧 Nginx 主机首次迁移时，先运行 `deploy-release-server.bat --legacy-nginx`，再运行 `bootstrap-release-gateway.bat`，停用旧 Nginx 后手动启动 Gateway。产品发布以 HTTPS 流式上传；所有文件通过大小和 SHA-256 校验后才提交，`stable.json` 最后原子替换。schema 2 元数据只保存根相对 `path`，每个版本的 MJS 与 tar.gz 并列，资产永久保留；磁盘不足返回失败并保持旧 stable。
