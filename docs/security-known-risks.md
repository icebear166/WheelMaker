# WheelMaker 已知安全风险与延期项

最后复核：2026-07-13

本页列出当前边界之外或需要单独迁移窗口的事项。它们不是已完成修复。

## 信任边界限制

- **OS user / administrator attacker**：能控制运行 WheelMaker 的操作系统用户或管理员权限的攻击者，可以读取配置、进程内存、项目文件和本地 Session 状态。当前文件权限和 set-only API 不能抵御这一等级的本机控制。
- **Controlled same-origin page**：已控制同源页面或同源静态发布链的攻击者位于浏览器信任边界内。CSP、无内联业务脚本、严格 Origin 校验和 HttpOnly Cookie 降低风险，但不能把被完全控制的同源内容重新变成可信内容。
- **Same-origin path is not isolation**：根路径和 `/wheelmaker/` 可以拥有不同 Cookie Path 和 Base Path 校验，但同一 Origin 的不同 path 不是强安全隔离。互不信任的部署必须使用不同 Origin，最好使用不同主机名。
- **Relay is not a permanent high-entropy key**：六位访问码只用于短期、有人值守的在线分享。速率限制和 generation 降低在线猜测风险，但不能把它提升为永久高熵分享密钥。
- **Self-signed certificates are unsupported**：Desktop、Android 和远程 Hub 不提供证书忽略开关。使用公开 CA，或把组织 CA 正确安装进系统信任链；系统信任失败应保持 fail closed。
- **Junction**：项目根内的 Junction/目录链接是受信任配置的一部分，可能访问根目录之外。它不适合在不受信任用户可修改的项目树中充当沙箱。

## 工具链和依赖延期

- **Go upgrade is deferred**：本安全阶段按批准范围没有升级 Go toolchain 或 Go dependencies。升级需要独立兼容性评审、全量 Go 测试和发布验证。
- **Major dependency upgrades are deferred**：AGP 9、AndroidX Core 1.19、AndroidX WebKit 1.16、Kotlin 2.3/2.4、OkHttp 5 和 repository-owned Gradle wrapper 都需要平台或 API 迁移。当前无 npm audit finding，具体兼容性约束和复核触发器见 [security-dependency-deferred.md](security-dependency-deferred.md)。

## 历史凭据和 Git 历史

History rewrite is pending。完整历史扫描在已删除的 `wheelmaker_diag_out.log` 中发现四个脱敏位置 fingerprint，涉及 commits `2c61525ae3ec` 和 `64d5b8d6b2af`；当前 tree 为零 finding。真实值和 raw report 只保留在仓库外，详情及 owner action 见 [security-credential-response.md](security-credential-response.md)。

在 Registry owner 完成旧值吊销前，凭据响应仍是外部 blocker。即使完成吊销，历史清理也只允许在单独维护窗口执行，需要：

1. 明确所有受影响远端 refs、fork、clone、CI cache 和未合并分支。
2. 确认每个受影响 credential fingerprint 已吊销并记录非敏感验证时间。
3. 取得仓库 owner 和运维 owner 的再次审批，通知所有 clone/CI 使用者。
4. 备份 refs，约定 freeze window，执行历史重写和协调后的 force update，再重新运行完整历史扫描。

当前计划禁止运行 `git filter-repo`、BFG、删除远端 refs 或 force-push main。历史重写未执行不能被描述为已经消除历史泄漏。
