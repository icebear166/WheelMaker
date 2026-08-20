# Personal Wiki 中文部署指南

这是一份给普通用户的 Personal Wiki 全流程指南。你不需要拉取或编译 WheelMaker 源码，也不需要把私人文章提交到 WheelMaker 仓库。

## 先理解它们之间的关系

```text
Release Server
  └─ 只提供公开的 Personal Wiki Kit：程序、模板和中文 Skill

你的电脑
  └─ 独立的 Personal Wiki Git 仓库：文章、目录、项目归属和附件

你的 GitHub Private 仓库
  └─ 备份私人 Wiki，并可触发自动发布

你的服务器和域名
  └─ 托管编译后的 Wiki 网站，例如 https://wiki.example.com

你的 WheelMaker
  └─ 只保存 Wiki 网址，页头按钮打开这个网址
```

WheelMaker 不读取你的文章、GitHub 仓库、本地工程路径、项目映射或服务器密钥。公共 Kit 也不包含任何用户的私人内容。

## 1. 准备环境

只做本地 Wiki 时，需要：

- Windows 电脑；
- Git；
- 已安装的 WheelMaker（可选，用于显示页头 Wiki 按钮）。

需要在线发布时，还需要：

- 一个 GitHub 账号；
- 一台自己的 Linux 服务器；
- 一个自己的域名，例如 `wiki.example.com`；
- 域名的 DNS A/AAAA 记录指向服务器；
- 服务器允许 HTTPS 使用的 80、443 端口。

## 2. 安装公共 Kit，创建独立私人仓库

下载并运行：

```text
https://release.wheelmaker.top/setup-wiki.bat
```

安装器会读取 Kit 稳定版本，校验下载文件大小和 SHA-256，然后把程序安装到：

```text
%USERPROFILE%\.personal-wiki\kit\versions\<version>
```

之后设置向导会让你选择私人 Wiki 仓库目录，例如：

```text
D:\PersonalData\personal-wiki
```

这个目录是独立 Git 仓库，不属于 WheelMaker 源码目录。

初始化完成后，仓库根目录会有：

```text
personal-wiki/
  content/
    articles/                 文章 Markdown
    registry/
      taxonomy.yaml           知识类型、一级目录、二级目录
      projects.yaml           Wiki 项目定义
      articles.yaml           每篇文章的目录和项目归属
  attachments/                图片、PDF 等附件
  open-wiki.bat               本机预览
  publish-wiki.bat            校验、提交、推送并发布
  update-wiki-kit.bat         显式更新公共 Kit
  wiki.config.json            Wiki 显示和部署配置
  wiki-kit.lock.json          精确锁定 Kit 版本
```

安装器发现已经存在完整安装时不会覆盖数据；需要升级时输入 `U`，或者以后运行仓库中的 `update-wiki-kit.bat`。

## 3. 关联自己的 GitHub Private 仓库

### 推荐方式：安装时自动创建

如果安装电脑已经登录 GitHub CLI，可以在设置向导中填写：

```text
你的 GitHub 用户名/personal-wiki
```

确认后，Kit 会创建 Private 仓库、设置 `origin` 并推送初始提交。

### 手动方式

在 GitHub 创建一个空的 **Private** 仓库，然后在 Wiki 目录执行：

```powershell
cd D:\PersonalData\personal-wiki
git remote add origin git@github.com:你的账号/personal-wiki.git
git push -u origin main
```

远程地址和默认分支直接从 Git 目录读取，不需要重复写进 Wiki 配置文件。

## 4. 配置知识目录和项目归属

### 4.1 修改知识类型、一级目录和二级目录

编辑：

```text
content/registry/taxonomy.yaml
```

它是网页按“知识类型”显示时使用的总目录。想调整某篇文章的目录，只修改 `content/registry/articles.yaml` 中该文章的 `section` 和 `category`，不要移动 Markdown 文件。

### 4.2 定义 Wiki 项目

编辑：

```text
content/registry/projects.yaml
```

例如：

```yaml
schema: 1
projects:
  - id: unity-engine-projects
    title: Unity Engine Projects
```

项目 ID 要稳定，文章注册表使用这个 ID。

### 4.3 把多个本地工程映射到同一个 Wiki 项目

编辑本机配置：

```text
%USERPROFILE%\.personal-wiki\project-routing.json
```

例如把 C1、Z1、SLG 都归到同一个项目：

```json
{
  "schema": 1,
  "routes": [
    {
      "projectId": "unity-engine-projects",
      "roots": [
        "D:/Projects/C1",
        "D:/Projects/Z1",
        "D:/Projects/SLG"
      ]
    }
  ]
}
```

可以写多个本地目录到同一个 `projectId`。没有匹配到的来源不会猜测项目，会按“未指定项目”处理。

## 5. 日常在本机使用

1. 双击 `open-wiki.bat`，打开本机预览；
2. 在 `content/articles/` 新建或修改 Markdown；
3. 在 `content/registry/articles.yaml` 设置文章的知识目录、项目归属和排序；
4. 需要查已有知识时，AI 使用已安装的 `lookup-knowledge` Skill；默认只读取 Git 已提交的 HEAD；
5. AI 产生的新知识必须先列为候选，由你明确批准后才写入；
6. 不要把原始对话、草稿、临时猜测、密码、私钥或其他凭据写入 Wiki。

本地只想验证内容时，可以运行：

```bat
publish-wiki.bat
```

它会检查文章、目录、项目、链接、附件和敏感内容。没有变化时不会创建空提交；发现错误时会停止，不会推送半成品。

## 6. 配置自己的服务器和域名

这一步是可选的。只使用 `open-wiki.bat` 时不需要服务器。

### 6.1 先配置 DNS

把你的域名指向服务器，例如：

```text
wiki.example.com  A  <服务器 IPv4>
```

配置文件中的 `domain` 只写主机名，不写 `https://`、路径或端口。

### 6.2 生成在线部署配置

在线模式需要以下非秘密配置：

```json
{
  "schema": 1,
  "domain": "wiki.example.com",
  "sshUser": "wiki-deploy",
  "sshPort": 22,
  "serviceUser": "personal-wiki",
  "installRoot": "/srv/personal-wiki",
  "listenPort": 9765
}
```

在线初始化时，Kit CLI 会把它写入 `wiki.config.json`，并生成 `.github/workflows/publish.yml`。这个工作流会下载并校验 `wiki-kit.lock.json` 指定的 Linux Kit，不会在 GitHub Runner 上编译 WheelMaker，也不会执行 `npm install`、Webpack 或 Go 构建。

公共 `setup-wiki.bat` 默认完成本地初始化。要从一开始生成在线仓库，需要使用已安装 Kit 中的 CLI `setup --non-interactive`，并同时提供精确的 Linux Kit 下载地址、SHA-256、域名和部署参数；已经创建本地仓库的用户使用下面的 `migrate-repository` 流程即可。

如果你刚用 `setup-wiki.bat` 创建了本地模式仓库，可以用 Kit 的 `migrate-repository` 命令转为在线模式。先保存上面的配置为 `D:\PersonalData\deployment.json`，从稳定版本清单复制 Linux Kit 的 URL 和 SHA-256，然后在 PowerShell 执行：

```powershell
$version = (Get-Content "$env:USERPROFILE\.personal-wiki\kit\active-version.txt" -Raw).Trim()
$kitRoot = "$env:USERPROFILE\.personal-wiki\kit\versions\$version"
& "$kitRoot\runtime\node.exe" "$kitRoot\src\cli.mjs" migrate-repository `
  --repository D:\PersonalData\personal-wiki `
  --kit-source "https://release.wheelmaker.top/personal-wiki-kit/releases/v<version>/personal-wiki-kit-v<version>-linux-x64.tar.gz" `
  --kit-sha256 "<stable.json 中 linux-x64 的 sha256>" `
  --deployment-config D:\PersonalData\deployment.json `
  --dry-run
```

确认报告无误后，把最后一行改成 `--apply` 再运行一次：

1. 从 `/personal-wiki-kit/stable.json` 读取当前 Linux Kit 的下载地址和 SHA-256；
2. 先使用 `--dry-run` 预演；
3. 确认报告中的 `unknown` 为空且知识身份没有变化后，再使用 `--apply`；
4. 应用前必须保持 Git 工作树干净。

在线配置只应包含域名、用户、端口和目录等非秘密字段。服务器密码、SSH 私钥和主机指纹不能写进仓库。

### 6.3 初始化服务器

Kit 提供 `deployment/` 下的服务器部署模板。根据上面的部署配置，把模板中的占位符替换为自己的域名、用户、目录和端口后，在自己的服务器上以 root 身份执行 `provision.sh` 一次。当前 Kit 不会替用户购买或登录 VPS，也不会把服务器初始化做成无需确认的一键操作。模板会：

- 创建专用 Wiki 服务用户；
- 创建发布目录和受限的发布权限；
- 安装 systemd 服务；
- 配置 Caddy 反向代理；
- 让 Caddy 自动申请和续期 HTTPS 证书；
- 使用 Argon2id 密码哈希保护 Wiki。

服务器完成初始化后，GitHub Actions 通过受限 SSH 用户上传构建结果，并调用仅允许切换发布版本的命令。网站地址为：

```text
https://wiki.example.com
```

## 7. 配置 GitHub Actions 的 Secrets

在 GitHub Private 仓库的 **Settings → Secrets and variables → Actions** 中配置：

```text
WIKI_DEPLOY_KEY
WIKI_SSH_KNOWN_HOSTS
WIKI_DEPLOY_HOST
WIKI_DEPLOY_PORT       可选，使用默认 SSH 端口时可以省略
```

这些值只存在 GitHub Secrets 和运行时临时目录，不要提交到仓库、Wiki 配置或聊天记录。

## 8. 把 Wiki 接入 WheelMaker

在你自己的 WheelMaker 服务器配置中加入：

```json
{
  "knowledgeRegistry": {
    "publicUrl": "https://wiki.example.com"
  }
}
```

然后按 WheelMaker 正常流程重启或重新发布 Hub。页头会出现 Wiki 按钮，点击后打开你的域名。

这里配置的只是网址。WheelMaker 不会访问 GitHub Private 仓库，不会读取 Wiki 内容，也不会保存 Wiki 密码或服务器 SSH 密钥。使用的 WheelMaker/Gateway 版本必须支持 `knowledgeRegistry` 配置。

## 9. 正式发布和更新

日常发布流程是：

```text
编辑文章和注册表
  → 双击 open-wiki.bat 本地查看
  → 双击 publish-wiki.bat
  → 校验并提交允许发布的文件
  → 推送到 GitHub Private 仓库
  → GitHub Actions 构建并部署到你的服务器
  → 新版本原子切换上线
```

只有完成服务器健康检查或 GitHub Actions 明确成功后，才认为线上 Wiki 已发布。GitHub 推送成功但工作流失败时，线上仍保持上一版。

升级公共工具时运行：

```text
update-wiki-kit.bat
```

升级只替换程序、模板和 Skill；文章、附件、目录注册表、用户配置和工程映射必须保留。

## 10. 最小检查清单

- [ ] Wiki 仓库是独立 Git 目录，不在 WheelMaker 源码目录中；
- [ ] GitHub 仓库设置为 Private；
- [ ] `taxonomy.yaml`、`projects.yaml`、`articles.yaml` 已定义并互相匹配；
- [ ] `project-routing.json` 已把需要的本地工程映射到正确的项目 ID；
- [ ] 域名 DNS 指向自己的服务器；
- [ ] 服务器只保存部署后的 Wiki，不保存 GitHub 私钥；
- [ ] GitHub Secrets 已配置，仓库中没有密码、私钥和主机指纹；
- [ ] WheelMaker 的 `knowledgeRegistry.publicUrl` 指向自己的 HTTPS 域名；
- [ ] 发布前先本地预览，发布后确认 GitHub Actions 和网站健康状态。
