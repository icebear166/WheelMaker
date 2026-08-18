# 私人个人 Wiki

此仓库只保存知识数据：文章、注册表、附件、显示配置、Kit 版本锁和薄启动器。构建、查询、服务器、Skill 与部署程序由锁定的 Personal Wiki Kit 提供。

- 双击 `open-wiki.bat` 在本机打开只读 Wiki。
- 双击 `publish-wiki.bat` 校验并发布已批准的知识改动。
- 双击 `update-wiki-kit.bat` 显式检查并更新 Kit；不会自动追踪最新版。
- 工程到 Wiki 项目的本机映射保存在 `~/.personal-wiki/project-routing.json`，不提交到本仓库。

如果初始化时启用了在线模式，`.github/workflows/publish.yml` 只下载 `wiki-kit.lock.json` 锁定的 Kit 制品。请在仓库 Secrets 中配置 `WIKI_DEPLOY_KEY`、`WIKI_SSH_KNOWN_HOSTS`、`WIKI_DEPLOY_HOST`；非默认 SSH 端口可配置为 `WIKI_DEPLOY_PORT`。不要把这些值写入文件。
