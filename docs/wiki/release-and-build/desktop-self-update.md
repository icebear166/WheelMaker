> 摘要：本页维护 Windows Desktop 菜单检查、版本展示、红点交互、脚本更新器和可信更新边界。

# Windows Desktop 自更新

## 用户行为

标准安装的 Windows Desktop 每次打开 WheelMaker 菜单时检查一次 `stable.json.desktopExe`，不阻塞应用，也不在检查失败时弹窗。Update 是菜单第三个主项目，位于 Release Publishing 与 Dev Mode 之前；它显示检查中、已是最新版、有更新或检查失败重试。有更新时，WheelMaker 图标和菜单项显示主题红点。

正式发布构建通过 Go linker 把 `v1.x` 发布版本写入 `WheelMakerDesktop.exe`，原生 bridge 将该版本与当前 EXE 的 SHA-256 一起返回给 Web。Web 使用 SHA-256 与 stable 指针判断是否有更新，并使用版本字段展示当前版本。旧 EXE 没有版本元数据时显示 Unknown，不根据最新指针猜测当前版本。网络或元数据检查失败时，用户可以从菜单重试；Desktop 不增加定时轮询。

## 安装布局

自更新只支持固定目录：

```text
~/.wheelmaker/
├─ deploy.mjs
├─ deploy-core.mjs
├─ update_exe.bat
└─ desktop/
   └─ WheelMakerDesktop.exe
```

`update_exe.bat` 由 Windows 部署生成，同时承担标准自更新入口和无参数手动恢复入口。Windows 平台包不携带独立 Desktop updater 二进制。任意目录复制版和 Local Dev 不提供正式自更新能力。

## 可信更新流程

Web 只能调用无参数的原生更新入口，不能传入命令、路径、URL、版本或哈希。原生层校验标准安装目录和固定 BAT 的 capability 标记，以可见 `cmd.exe` 启动 `update_exe.bat`，并只传递当前 Desktop PID；只有命令行成功启动后才关闭 Desktop。

BAT 调用：

```text
node ~/.wheelmaker/deploy.mjs desktop-self-update --parent-pid <PID>
```

`deploy.mjs` 只校验固定命令形状、取得可信 stable 并加载最新 core；`deploy-core.mjs` 等待指定 PID 退出，再复用既有下载、SHA-256 校验和原子替换逻辑。命令行显示阶段、下载进度和完整错误，成功或失败后都执行 `pause`。更新完成后不自动启动 Desktop，用户关闭命令行并手动打开 EXE。

整个流程使用当前用户权限，不请求管理员提权，不注册服务或计划任务，也不修改 Hub/Web。若还有其他 Desktop 实例，运行检查拒绝替换且不会创建新的 Desktop 进程。

## 兼容边界

无参数运行 `update_exe.bat` 时继续调用 `node deploy.mjs desktop-update`，供用户先关闭全部 Desktop 后手动恢复。

升级机器已有的 `desktop/update.exe` 不由平台更新主动删除，旧 Desktop 仍可用它进入兼容的 `desktop-update` 链路。launcher 会先加载最新 core；core 在安装新版 Desktop 的同时刷新带 capability 标记的 BAT，使新版 Desktop 首次启动时即可切换到脚本更新。全新安装不创建 `desktop/update.exe`。

设计来源：

- [`spec-desktop-self-update.md`](../../scope/2026-07-18-desktop-self-update.md)
- [`spec-desktop-script-updater.md`](../../scope/2026-07-27-desktop-script-updater.md)
- [`spec-unified-app-menu.md`](../../scope/2026-07-30-unified-app-menu.md)
