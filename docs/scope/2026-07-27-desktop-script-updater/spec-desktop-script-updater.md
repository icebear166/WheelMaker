> 由 scope skill 于 2026-07-27 生成

# Desktop Script Updater

## 目标

Windows Desktop 自更新当前依赖随每个 Windows 平台包发布的 Go GUI helper `desktop/update.exe`。该 helper 约 2.2 MB，职责仅是等待 Desktop 退出、调用现有部署 MJS、报告错误并重启 Desktop；其后台启动配置还会将重启后的 GUI 置为隐藏窗口。目标是删除后续平台包中的独立 updater 二进制，复用已有 `update_exe.bat`、`deploy.mjs` 和 `deploy-core.mjs` 完成自更新，并让用户在可见命令行中看到进度和最终结果。

## 决策

- 不再构建、发布或安装 `desktop/update.exe`，也不新增替代二进制或脚本文件。
- Desktop 点击更新后启动可见的 `cmd.exe`，执行固定路径 `~/.wheelmaker/update_exe.bat` 并只传入当前 Desktop PID；命令行成功启动后 Desktop 才关闭。
- `update_exe.bat` 接收到 PID 时调用 `node deploy.mjs desktop-self-update --parent-pid <PID>`；未接收参数时继续调用 `node deploy.mjs desktop-update`，保留“先手动关闭 Desktop，再运行”的恢复入口。
- `deploy.mjs` 仅增加固定命令和正整数 PID 的参数校验、状态文案与可信 core 转发，不承载等待、更新或结束交互逻辑。
- `deploy-core.mjs` 负责等待指定 Desktop PID 退出，然后复用现有 Desktop 下载、SHA-256 校验和原子替换逻辑。
- 更新完成后不自动启动 Desktop。BAT 输出成功或失败结果，并执行 `pause`；成功提示用户关闭命令行并手动打开 `WheelMakerDesktop.exe`。
- 更新失败时保留完整错误输出，不替换有效旧 EXE，也不启动新的 Desktop 进程。
- Windows 平台包停止携带 `desktop/update.exe`。升级部署不主动删除目标机已有的旧 `desktop/update.exe`，避免旧版 Desktop 在过渡期失去唯一可用的 helper；全新安装不创建该文件。
- 正常的旧版自更新链仍然可过渡：旧 `update.exe` 调用旧入口 `deploy.mjs desktop-update` 时，launcher 会先取得最新可信 `deploy-core.mjs`；core 在安装新版 Desktop 的同一流程中刷新支持 PID 模式的 `update_exe.bat`，确保新版 Desktop 首次启动时已有匹配 BAT。
- BAT 包含固定的 self-update capability 标记。新版 Desktop 只有在标准安装目录中的 BAT 存在且标记匹配时才将 updater 报告为 ready，避免手工复制的新 Desktop 错用旧 BAT。
- 不改变协议版本，不把 Desktop 更新职责转移给 Hub。

## 架构

```text
WheelMakerDesktop.exe
  └─ visible cmd.exe
       └─ ~/.wheelmaker/update_exe.bat <desktop-pid>
            └─ node ~/.wheelmaker/deploy.mjs
                 desktop-self-update --parent-pid <desktop-pid>
                  └─ verified ~/.wheelmaker/deploy-core.mjs
                       ├─ wait for exact Desktop PID
                       ├─ execute existing Desktop update
                       └─ return exit status and logs
```

`deploy.mjs` 继续是小型可信 launcher：校验命令形状、读取公共 stable、校验并更新部署脚本，再将已验证的参数和发布上下文交给 core。Windows 特有的等待和用户交互均不进入 launcher。

## 流程

### 标准自更新

1. Web 菜单确认存在可用 Desktop 更新。
2. Native bridge 校验当前 EXE 位于标准安装目录，并校验固定 BAT 的 capability 标记。
3. Native bridge 以可见窗口启动 `cmd.exe`，执行 `update_exe.bat <current PID>`；启动失败则保持 Desktop 打开并向 Web 返回错误。
4. BAT 调用 Node launcher，launcher 校验 `desktop-self-update --parent-pid <PID>`，同步可信 `deploy.mjs`/`deploy-core.mjs`，再转交 core。
5. Desktop 在 BAT 成功启动后关闭。core 等待传入的精确 PID 消失。
6. core 运行现有 `executeDesktopUpdate`。若还有其他 `WheelMakerDesktop.exe` 实例，现有运行检查拒绝替换并输出明确错误。
7. BAT 保留完整 stdout/stderr 和退出码，打印最终成功或失败提示，然后 `pause`。
8. 用户关闭命令行并手动启动 Desktop。

### 手动恢复

用户先关闭所有 Desktop 实例，再直接运行无参数的 `update_exe.bat`。BAT 继续执行 `deploy.mjs desktop-update`，不等待 PID；结束时同样打印结果并 `pause`。

### 版本过渡

旧版 Desktop 仍使用已安装的 `desktop/update.exe`。该 helper 调用兼容入口 `deploy.mjs desktop-update`，launcher 在执行前下载最新 core。最新 core 除安装新版 Desktop 外，还写入带 capability 标记的新 BAT。平台包不再携带 updater 二进制，但升级时保留磁盘上的旧 helper；待客户端均已迁移后再单独决定清理策略。

## 验收标准

- Windows 平台构建和发布包不包含 `desktop/update.exe`，全新部署不创建它。
- 升级部署不覆盖或删除已安装的旧 `desktop/update.exe`。
- `update_exe.bat` 同时支持无参数手动恢复和单 PID 自更新模式，并在两种模式结束时显示结果后 `pause`。
- Desktop 只执行标准安装目录中的固定 BAT，只传递当前 PID，不接受页面传入的命令、路径、URL、版本或哈希。
- 点击更新后出现可见命令行；命令行能显示 launcher/core 的下载进度、阶段日志和完整错误。
- core 在目标 PID 退出前不检查或替换 Desktop EXE。
- 成功更新后没有任何组件自动启动 Desktop；用户手动启动后只有一个可见 Desktop 实例。
- 更新失败时旧 EXE 保持可用，不产生新的 Desktop 实例。
- 新版 Desktop 不将无 capability 标记的旧 BAT 识别为可用 updater。
- 旧 helper 驱动的 `desktop-update` 会在安装新版 Desktop 时同步生成新版 BAT，覆盖标准升级过渡。
- Go updater 命令及其发布构建逻辑被移除，不影响 Hub、Web、Android 或非 Windows 平台构建。

### 测试

- Go 单元测试覆盖标准路径校验、BAT capability 校验、固定 `cmd.exe` 参数、可见启动配置、启动失败不关闭 Desktop。
- launcher 测试覆盖 `desktop-self-update --parent-pid <正整数>` 的唯一合法形状，以及缺失、零值、负数、非数字和多余参数拒绝。
- core 测试用可控进程探针验证“等待 PID → 更新”的顺序、等待失败、其他 Desktop 仍运行、下载失败、替换失败和成功退出码。
- 部署测试覆盖新版 BAT 内容、平台更新保留旧 updater、全新安装不创建 updater，以及兼容 `desktop-update` 刷新 BAT。
- 发布构建测试断言 Windows 平台目录及归档不再包含 `desktop/update.exe`，也不再编译 `wheelmaker-desktop-updater`。
- Windows 人工验证覆盖一次成功自更新和一次存在额外 Desktop 实例的失败更新，检查命令行可见性、日志、`pause`、EXE 哈希和进程数量。

## 范围之外

- 不增加原生进度窗口、MessageBox、托盘提示或更新完成后的应用内结果页。
- 不自动重启、自动打开或强制终止任何非目标 Desktop 进程。
- 不在本次变更中删除升级机器遗留的 `desktop/update.exe`。
- 不引入 MSIX、ClickOnce、PowerShell/WPF updater、Hub 托管更新或新的运行时依赖。
