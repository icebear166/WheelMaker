> 摘要：本页维护 WheelMaker 公共与 Hub 驱动发布控制面，以及目标机本地部署 MJS 的职责、命令、状态机和平台注册边界。

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

正式发布在认证、创建会话和构建前读取当前 `stable.json`。如果干净源码工作树的当前 Git HEAD 与 `stable.sourceSha` 相同，发布器直接返回 `unchanged`，不构建、不打包且不占用新版本号；本地只构建模式不受此规则影响。版本冲突后的重试也会重新检查该 SHA，避免并发操作为同一源码提交生成两个正式版本。

本地发布从 `~/.wheelmaker/release-server.json` 读取发布 Token。GitHub Action 从仓库 Secret `WHEELMAKER_RELEASE_TOKEN` 读取同一个 Token。匿名客户端可以读取 `stable.json`、发布历史、部署脚本和版本资产，但不能上传。

如果提交时版本已存在，发布器重新读取 `stable.json`、分配下一个 `v1.x` 并重试，最多三次。

### Gateway 发布通道

现有发布选项中另增 Gateway，行为与 Android APK 选项一致。勾选时使用本次 WheelMaker 版本构建四个 Gateway 平台产物，使用同一发布会话上传，以大小和 SHA-256 校验并与主版本一起提交。Gateway 不进入 `releases/v1.x/`，而是使用固定 `/gateway/` 命名空间，保留当前和上一版清单/产物。`stable.json` 携带 Gateway 当前指针；未勾选时继承上一个指针。Gateway 构建、上传或提交失败会使整次发布失败并保留旧 stable。

目标机的完整部署会默认下载、安装并启动 Gateway；日常 `deploy.mjs update` 不检查或触碰 Gateway。Gateway 的站点配置位于固定 Gateway Home，与 Hub 的 `config.json` 分开，各个部署器只维护自己的站点文件。

发布服务器另有两个需要发布 Token 的维护端点：`GET /api/storage` 返回 `public/releases/` 的总占用与可清理占用；`POST /api/prune` 只保留 `stable.json` 引用的版本（stable 版本及其 Desktop/Android 指针版本），删除其余 `v1.x` 版本目录，并先把 `releases.json` 截断到只剩被保留版本的条目（历史列表因此不会出现死链）；`stable.json` 不变。发布页面通过发布 Hub 查询占用并触发清理，发布 Hub 复用本地发布 Token 调用这两个端点。

## Hub 驱动发布与临时 Web

Settings 可以选择一个拥有源码目录的发布 Hub 执行正式发布，或只构建并发布临时 Web。发布 Hub、源码目录、可选 Server Hub 与 auto pull 是浏览器本地设置，正式版本发布与临时 Web 共用同一个 Server Hub 作为目标；发布 Token 只保存在发布 Hub 的受保护配置中，前端不保存或传输它。已接受的发布任务在 Hub 内继续执行，页面关闭不会取消任务，重开后继续从发布 Hub 读取状态和日志。

正式版本发布仍使用现有 `v1.x` 事务，并只保留 Desktop、Android 选项。临时 Web 不经过 Release Server：发布 Hub 构建 ZIP 后经 Registry 在线分块传给页面配置的 Server Hub（即临时 Web 的 Web Hub）。它不改写 `stable.json`、正式发布状态或历史。

Registry 只认证、路由、转发并确认临时 Web 分块，不持久化 ZIP。每个分块最多 `4 MiB`，发送方逐块等待目标确认。Web Hub 必须在线；它在 `~/.wheelmaker/staging/debug-web-<jobId>/` 接收完整 ZIP，并复用更新租约防止与正式部署并发，校验声明的文件大小和 SHA-256 后才原子替换 `~/.wheelmaker/web`。离线、断线、顺序错误或摘要不符都会使任务失败且保留原 Web；Target Hub 保留 `~/.wheelmaker/release-jobs/<jobId>/debug-web.zip` 供之后显式重试。Target Hub 持久化任务状态与日志，因此页面关闭不影响构建或传输，页面重新打开后仍从 Target Hub 查询结果。

正式版本的 auto pull 与 Server Hub 拉取稳定版本保持既有行为。临时 Web 请求只携带源码路径和 `webHubId`，不使用 Release Server URL、公开当前指针或下载回拉；Web Hub 只返回最终应用状态，过程日志仍归 Target Hub 所有。旧 `hub.release.notify(debugWeb)` 路径已禁用，避免临时 Web 重新落回 Release Server。

## 目标机部署代码

目标机本地部署由两个 MJS 文件组成；运行时生命周期控制也由这套可信 MJS 入口提供：

```text
~/.wheelmaker/
├─ deploy.mjs          轻量启动器
└─ deploy-core.mjs     部署核心
```

源码分别位于：

- [`scripts/deploy/deploy.mjs`](../../../scripts/deploy/deploy.mjs)
- [`scripts/deploy/deploy-core.mjs`](../../../scripts/deploy/deploy-core.mjs)

源码中的发布地址是占位符。打包时才把 `deploy.mjs` 渲染为 `https://release.wheelmaker.top`，避免在部署代码各处重复维护 URL。

## 平台包格式与解压

平台包是 `wheelmaker-v1.x-<platform>.tar.zst`，由 [`scripts/release/tar.mjs`](../../../scripts/release/tar.mjs) 用 zstd level 22 压缩。目标机由 `deploy-core.mjs` 的 `extractTarZst` 用 `node:zlib` 原生 zstd 流式解压，因此要求 Node.js ≥ 22.15。

`deploy-core.mjs` 在解压前做版本守卫：Node < 22.15 时抛出明确错误，指引重跑 `https://release.wheelmaker.top/` 的一行安装命令升级 Node，而不是崩溃在缺失的 zstd API 上。日常 `deploy.mjs update` 不安装或升级 Node，所以存量机若仍停在 22.15 以下，需要重新执行一次完整安装才能继续更新。

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
| `node deploy.mjs runtime restart` | 重启托管 Hub runtime 并重新加载服务管理器环境 | 否 |
| `node deploy.mjs desktop-update` | 按 `stable.json` 指针更新 Desktop | 否 |
| `node deploy.mjs desktop-self-update --parent-pid <PID>` | 等待当前 Desktop 退出后按 stable 指针更新 | 否 |
| `node deploy.mjs migrate-uninstall` | 一次性清理旧部署模式 | 只删除旧注册 |

完整安装生成当前平台的 `deploy`、`start` 和 `stop` 包装脚本。Windows 额外生成带 self-update capability 标记的 `update_exe.bat`。该 BAT 有 PID 时进入 `desktop-self-update`，无参数时保留 `desktop-update` 手动恢复语义。独立的 `restart` 和 `status` 包装脚本已退役；Hub 菜单的 Restart 通过已安装的 `deploy.mjs runtime restart` 入口执行。

## 托管 runtime 重启

`runtime restart` 只控制进程生命周期，不下载、校验、替换版本文件，也不执行 `deploy.mjs update`。Hub 通过响应后的独立 helper 调用它，避免当前 worker 在写回 `hub.state.action` 响应前终止自己。

平台 adapter 使用服务管理器的单一 restart 动作：

- Linux：`systemctl --user restart wheelmaker-hub.service`；systemd 重新读取 `EnvironmentFile` 后创建新的 guardian。
- macOS：`launchctl kickstart -k gui/<uid>/com.wheelmaker.hub`；launchd 重新创建 `com.wheelmaker.hub` job。
- Windows：停止 `WheelMaker` Scheduled Task 及其 worker，再重新启动该 task；重启脚本必须独立于将被停止的当前 worker。

当前 guardian 同时管理 Hub 与配置启用的 Registry worker，因此完整 runtime restart 可能使两者短暂断线。新 Hub 连接会生成新的 `instanceId`。Restart 只重新读取服务管理器已经提供的环境来源，不把旧 worker 的环境快照同步成新的跨平台配置。

## 主协议不兼容时的受限更新

Registry 主协议硬切不能切断 Web 主动更新旧 Hub 的唯一通道。Hub 主协议较旧时，Registry 允许它以 `update_only` 模式保持连接。认证、Token 和 Hub ID 校验不降级；Hub 比 Registry 更新、协议格式无效或 Client 协议不匹配时仍拒绝连接。

该兼容完全由 Registry 实现，不增加维护版本、专用 RPC 或 Hub 端握手分支。旧 Hub 仍按原流程报告 Project；Registry 成功应答但丢弃这些报告，所以 Hub 保持在线、App 项目数为零。Registry 在现有 Hub descriptor 中标记 `connectionMode: "update_only"`，App 只在 Hub 展开内容中显示“Protocol 不匹配，仅可更新”，不承担权限控制。

Registry 只向受限 Hub 放行现有 `hub.state.refresh` 的 `wheelmakerUpdate` section，以及 `hub.state.action` 的 `wheelmakerUpdate/requestUpdate` action；其他 HubState payload 和全部业务请求由 Registry 拒绝。Hub 内部仍复用既有 UpdateCommand、更新租约、`staging/status.json` 和 `node deploy.mjs update`。受限连接成功不会自动开始更新。

请求被接受后，Hub 在 `applying` 阶段断开属于预期行为；新 Hub 重启并以当前主协议重新握手后恢复完整业务模式。若更新失败但旧 Hub 重新启动，它会再次进入 `update_only`，允许用户查询失败状态并重试。从该能力发布起，Registry 长期保持上述更新 HubState wire 子集兼容，使后续主协议升级继续沿用同一受限路径。

> 决策来源：[`docs/scope/2026-07-31-update-only-hub/spec-update-only-hub.md`](../../scope/2026-07-31-update-only-hub/spec-update-only-hub.md)

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
→ 替换 bin/wheelmaker(.exe) 和 web/
→ 写入 release.json
→ 配置当前平台运行时
→ 生成包装脚本
→ 启动 Hub
→ 确认 Hub Worker 存活
→ 标记成功
→ 清理 staging/<jobId>
```

状态写入 `~/.wheelmaker/staging/status.json`，更新租约写入 `lock.json`。主要状态包括 `queued`、`downloading`、`verifying`、`applying`、`restarting`、`succeeded` 和 `failed`。

陈旧恢复：租约心跳超过 2 小时（`deploy-core.mjs` 的 `STALE_LEASE_MS`）视为卡死。更新器自身再次运行时可抢占陈旧租约；Hub 的 UpdateCommand 在查询或收到新更新请求时发现陈旧活跃 job，会写入 `failed`（`errorCode: updater_stalled`）并删除 `lock.json`，使 `canRequestUpdate` 恢复、新请求重新触发更新器。此外租约停在 `queued` 超过 2 分钟视为触发丢失，新更新请求会以同一 jobId 强制重触发更新器；重触发失败则写入 `failed`（`errorCode: updater_trigger_failed`）并清锁。手工恢复等价于删除 `staging/lock.json` 与 `status.json`。

目标机替换 `bin/` 和 `web/`，但不会清空或覆盖现有 `WheelMakerDesktop.exe`。Windows 平台包不再包含独立 Desktop updater；升级部署保留旧机器已有的 `desktop/update.exe`，全新安装不创建它。Desktop 主程序仍通过独立命令更新，不随每次 Hub/Web 部署更新。

## Windows Desktop 自更新边界

标准安装目录中的 Desktop 使用以下固定布局：

```text
~/.wheelmaker/
├─ deploy.mjs
├─ deploy-core.mjs
├─ update_exe.bat
└─ desktop/
   └─ WheelMakerDesktop.exe
```

Desktop 启动后由 Web 后台读取公共 stable 元数据，并通过受限原生桥比较当前 EXE SHA-256 与 `stable.desktopExe.sha256`。有更新时，Windows 扩展菜单显示红点和更新入口。

用户确认更新后，原生层只允许以可见 `cmd.exe` 启动固定的 `update_exe.bat`，且只传入当前 Desktop PID。BAT 调用 `node ~/.wheelmaker/deploy.mjs desktop-self-update --parent-pid <PID>`；launcher 只做固定命令校验和可信 core 加载，core 等待 PID 退出后复用下载、SHA 校验和原子替换逻辑。

命令行显示更新阶段、下载进度和错误，完成后打印结果并 `pause`。更新链不自动重启 Desktop；用户关闭命令行后手动打开 EXE。失败时旧 EXE 保持不变，也不会创建新的 Desktop 进程。

自更新只支持标准安装目录，不接受 Web 提供的命令、路径或 URL。无参数 `update_exe.bat` 保留手动恢复语义。升级机器已有的 `desktop/update.exe` 暂时保留供旧 Desktop 过渡；旧 helper 触发兼容 `desktop-update` 时，最新 core 会在安装新版 Desktop 的同一流程中刷新带 capability 标记的 BAT。新版 Desktop 只在标记匹配时报告 updater ready。

Desktop 自更新的用户状态、固定路径和可信调用链详见 [`desktop-self-update.md`](desktop-self-update.md)。

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
