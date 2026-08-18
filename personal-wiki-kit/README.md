# Personal Wiki Kit

Personal Wiki Kit 是 WheelMaker 仓库内独立版本化的公共工具包。它负责构建、查询、预览和发布个人 Wiki，但不保存任何人的私人文章、附件、服务器地址或凭据。

## 数据边界

- `personal-wiki-kit/`：可公开复用的程序、中文 Skill、示例模板和测试。
- 私人 Wiki 仓库：文章、目录注册表、附件、显示配置和锁定的 Kit 版本。
- `~/.personal-wiki/`：只存在于本机的私人仓库位置与工程映射。

模板只能包含虚构示例。真实知识必须保留在用户自己的私人仓库中，不能复制到本目录。

## 版本规则

当前 Kit 版本由 `kit.json` 唯一声明。私人 Wiki 通过 `wiki-kit.lock.json` 固定精确版本；`latest` 不是合法版本，也不会自动升级。

## 开发检查

```powershell
npm install --ignore-scripts
npm test
npm run check:public
```

完整的初始化、打开、查询、发布和升级命令会由本 Kit 的统一 CLI 提供。
