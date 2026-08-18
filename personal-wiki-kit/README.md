# Personal Wiki Kit

Personal Wiki Kit 是 WheelMaker 仓库内独立版本化的公共工具包。它负责构建、查询、预览和发布个人 Wiki，但不保存任何人的私人文章、附件、服务器地址或凭据。

## 数据边界

- `personal-wiki-kit/`：可公开复用的程序、中文 Skill、示例模板和测试。
- 私人 Wiki 仓库：文章、目录注册表、附件、显示配置和锁定的 Kit 版本。
- `~/.personal-wiki/`：只存在于本机的私人仓库位置与工程映射。

模板只能包含虚构示例。真实知识必须保留在用户自己的私人仓库中，不能复制到本目录。

## 版本规则

当前 Kit 版本由 `kit.json` 唯一声明。私人 Wiki 通过 `wiki-kit.lock.json` 固定精确版本；`latest` 不是合法版本，也不会自动升级。

## 在线仓库生成

本地模式不会生成 GitHub Action。需要在线发布时，用 `setup --non-interactive` 同时提供精确的 Linux Kit 制品 URL、SHA-256，以及 `--deployment-domain`、`--deployment-ssh-user`、`--deployment-ssh-port`、`--deployment-service-user`、`--deployment-install-root`、`--deployment-listen-port`。生成的私人仓库只提交非秘密配置，并在 Action 中下载、校验和运行已锁定 Kit，不执行 `npm install`、webpack 或 Go 编译。

在线仓库需要配置 `WIKI_DEPLOY_KEY`、`WIKI_SSH_KNOWN_HOSTS`、`WIKI_DEPLOY_HOST`，可选配置 `WIKI_DEPLOY_PORT`。这些值只放在 GitHub Secrets；任何密码、私钥或主机指纹都不得写进仓库。

## 迁移已有 Wiki

迁移器只把已有仓库的“程序层”换成精简的 Kit 接入文件。`content/` 与 `attachments/` 会原样保留，`.gitattributes` 也不会改写；旧的 `app/`、`server/`、`scripts/`、`skills/`、`ops/` 和 npm/Go 构建文件会在候选版本校验成功后才移除。任何不在白名单内的已跟踪文件都会阻止迁移。

先准备一个只含非秘密字段的部署配置 JSON，再做只读预演：

```powershell
node src/cli.mjs migrate-repository `
  --repository D:\path\to\private-wiki `
  --kit-source https://github.com/owner/repo/releases/download/personal-wiki-kit-v0.1.0/personal-wiki-kit-v0.1.0-linux-x64.tar.gz `
  --kit-sha256 <64位小写SHA-256> `
  --deployment-config D:\path\to\deployment.json `
  --dry-run `
  --report D:\path\to\migration-report.json
```

确认报告中 `unknown` 为空且 `identity.equivalent` 为 `true` 后，把 `--dry-run` 改为 `--apply`。应用要求 Git 工作树完全干净；它会生成仓库内迁移报告和指向迁移前提交的恢复标签。文件安装或恢复标签创建失败时，迁移器会还原原有文件和 Git 状态。服务器地址、SSH 密钥、密码与主机指纹都不应写进部署配置。

## 开发检查

```powershell
npm install --ignore-scripts
npm test
npm run check:public
```

完整的初始化、打开、查询、发布和升级命令会由本 Kit 的统一 CLI 提供。
