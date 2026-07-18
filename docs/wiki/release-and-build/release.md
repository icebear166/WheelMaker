> 摘要：本页维护 WheelMaker 公共发布控制面，以及目标机本地部署 MJS 的职责、命令、状态机和平台注册边界。

# 发布

## 公共发布控制面

正式发布把 `.release-out/v1.x/` 中的资产上传到 `https://release.wheelmaker.top`。发布服务器是元数据的唯一写入者，源码侧发布器只创建发布会话、上传声明过的资产并提交会话。

发布阶段为：

```text
创建发布会话
→ building
→ packaging
→ uploading
→ committing
→ 服务端原子更新 stable.json
```

本地发布从 `~/.wheelmaker/release-server.json` 读取发布 Token。GitHub Action 从仓库 Secret `WHEELMAKER_RELEASE_TOKEN` 读取同一个 Token。匿名客户端可以读取 `stable.json`、发布历史、部署脚本和版本资产，但不能上传。

如果提交时版本已存在，发布器重新读取 `stable.json`、分配下一个 `v1.x` 并重试，最多三次。

## 目标机部署代码

目标机本地部署由两个 MJS 文件组成：

```text
~/.wheelmaker/
├─ deploy.mjs          轻量启动器
└─ deploy-core.mjs     部署核心
```

源码分别位于：

- [`scripts/deploy/deploy.mjs`](../../../scripts/deploy/deploy.mjs)
- [`scripts/deploy/deploy-core.mjs`](../../../scripts/deploy/deploy-core.mjs)

源码中的发布地址是占位符。打包时才把 `deploy.mjs` 渲染为 `https://release.wheelmaker.top`，避免在部署代码各处重复维护 URL。

## 启动器职责

`deploy.mjs` 只负责获得可信的部署核心，不直接停止 Hub 或替换业务文件：

```text
解析命令
→ 提升上次暂存的 deploy.next.mjs
→ 下载并验证 stable.json
→ 按 SHA-256 检查本地 deploy.mjs
→ 按 SHA-256 检查本地 deploy-core.mjs
→ 下载变化的脚本
→ 动态加载 deploy-core.mjs
→ runCore(command)
```

部署下载必须使用 HTTPS，并保持在受信任发布站点的同一个 Origin。脚本、manifest 和平台包都按发布元数据校验 SHA-256。

启动器自身有更新时写入 `deploy.next.mjs`，下次运行时再替换当前启动器。核心有更新时原子替换 `deploy-core.mjs`，本次运行立即加载新核心。

## 命令

| 命令 | 职责 | 是否配置系统运行时 |
|---|---|---|
| `node deploy.mjs` | 完整安装或重新部署 Hub 和 Web | 是 |
| `node deploy.mjs update` | 日常更新 Hub 和 Web | 否 |
| `node deploy.mjs runtime start` | 启动 Hub | 否 |
| `node deploy.mjs runtime stop` | 停止 Hub | 否 |
| `node deploy.mjs desktop-update` | 按 `stable.json` 指针更新 Desktop | 否 |
| `node deploy.mjs migrate-uninstall` | 一次性清理旧部署模式 | 只删除旧注册 |

完整安装生成当前平台的 `deploy`、`start` 和 `stop` 包装脚本。Windows 额外生成 `update_exe.bat`。`restart` 和 `status` 包装脚本已退役。

## 完整安装状态机

完整安装不会为了下载而提前停止 Hub。当前顺序为：

```text
读取 stable.json
→ 下载 release-manifest.json
→ 下载当前平台包
→ 校验包大小和 SHA-256
→ 安全解压到 staging/<jobId>/package
→ 初始化或迁移 config.json
→ 进入 applying
→ 停止 Hub
→ 替换 bin/wheelmaker(.exe)、web/ 和 Windows desktop/update.exe
→ 写入 release.json
→ 配置当前平台运行时
→ 生成包装脚本
→ 启动 Hub
→ 确认 Hub Worker 存活
→ 标记成功
→ 清理 staging/<jobId>
```

状态写入 `~/.wheelmaker/staging/status.json`，更新租约写入 `lock.json`。主要状态包括 `queued`、`downloading`、`verifying`、`applying`、`restarting`、`succeeded` 和 `failed`。

目标机替换 `bin/` 和 `web/`。Windows 平台还会把一次性 Desktop 更新器写入 `desktop/update.exe`，但不会清空或覆盖现有 `WheelMakerDesktop.exe`。Desktop 主程序仍通过独立的 `desktop-update` 命令更新，不随每次 Hub/Web 部署更新。

## Windows Desktop 自更新边界

标准安装目录中的 Desktop 使用以下固定布局：

```text
~/.wheelmaker/desktop/
├─ WheelMakerDesktop.exe
└─ update.exe
```

`update.exe` 是随每个 Windows 平台包部署的一次性 GUI 程序，使用当前用户权限，不请求管理员提权，也不注册服务、计划任务或常驻进程。Desktop 启动后由 Web 后台读取公共 stable 元数据，并通过受限原生桥比较当前 EXE SHA-256 与 `stable.desktopExe.sha256`。有更新时，Windows 扩展菜单显示红点和更新入口。

用户确认更新后，原生层只允许启动固定目录的 `update.exe`，且只传入当前 Desktop PID。更新器等待 Desktop 退出，再隐藏调用 `node ~/.wheelmaker/deploy.mjs desktop-update`，复用部署 MJS 的下载、SHA 校验和原子替换逻辑。成功或失败都会重新打开 Desktop；失败时旧 EXE 保持不变并显示原生错误。

自更新只支持标准安装目录，不接受 Web 提供的命令、路径或 URL。`update_exe.bat` 保留为旧 Desktop 第一次升级和故障恢复入口；旧版必须先手动更新到带原生自更新桥的 Desktop 一次。

## Windows 计划任务

Windows 完整安装维护两个当前用户计划任务：

- `WheelMaker`：用户登录时执行 `wheelmaker.exe -d`。
- `WheelMakerUpdater`：每天 03:00 执行 `node deploy.mjs update`。

进入 `applying` 前不停止 Hub。真正替换 `wheelmaker.exe` 前，部署器才执行：

```powershell
Stop-ScheduledTask -TaskName 'WheelMaker' -ErrorAction SilentlyContinue
```

并停止安装目录内的当前 WheelMaker 进程。文件替换完成后，部署器通过以下语义重新注册任务：

```powershell
Register-ScheduledTask -TaskName 'WheelMaker' ... -Force
Register-ScheduledTask -TaskName 'WheelMakerUpdater' ... -Force
```

任务不存在时会创建；任务已经存在时会覆盖 Action、Trigger、Principal 和 Settings，不会产生同名重复任务。随后重新启动 `WheelMaker`。

完整安装不会顺带删除旧 Windows Service。第一次从旧源码部署迁移时，必须先执行 `migrate-uninstall`，由它删除旧任务、服务、注册项、旧 EXE 和旧构建缓存。

## Windows 提权边界

完整安装并非全程使用管理员权限：

```text
下载、验证和解压                 普通权限
停止当前用户任务和进程           普通权限
替换 ~/.wheelmaker/bin 和 web    普通权限
创建或覆盖计划任务               UAC 提权
重新启动当前用户任务             普通权限
```

计划任务注册通过隐藏的提权 PowerShell 执行，并保留发起部署的运行用户作为任务 Principal。日常 `deploy.mjs update` 不调用运行时配置，不创建、删除或覆盖任务，因此不要求管理员权限。

## 平台运行时

- Windows：当前用户计划任务。
- Linux：`systemd --user` 的 `wheelmaker-hub.service`、`wheelmaker-updater.service` 和 `wheelmaker-updater.timer`。
- macOS：`com.wheelmaker.hub` 和 `com.wheelmaker.updater` LaunchAgent。

完整安装负责写入并启用这些定义；日常更新只停止、替换并重新启动已有 Hub。
