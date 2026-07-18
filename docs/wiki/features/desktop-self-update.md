> 摘要：本页维护 Windows Desktop 启动检查、红点交互、一次性更新器和可信更新边界。

# Windows Desktop 自更新

## 用户行为

标准安装的 Windows Desktop 每次启动后在后台检查一次 `stable.json.desktopExe`，不阻塞应用，也不在检查失败时弹窗。Windows 扩展菜单在 Dev Mode 下方始终显示 Desktop 更新状态：检查中、已是最新版、有更新或检查失败重试。有更新时，扩展图标和菜单项显示 WheelMaker 主题红点。

Web 使用当前 `WheelMakerDesktop.exe` 的 SHA-256 与 stable 指针比较，不维护额外版本状态。网络或元数据检查失败时，用户可以从菜单重试；Desktop 不增加定时轮询。

## 安装布局

自更新只支持固定目录：

```text
~/.wheelmaker/desktop/
├─ WheelMakerDesktop.exe
└─ update.exe
```

`update.exe` 随每个 Windows 平台包安装，与可选的 Desktop 发布资产是否在本轮生成无关。任意目录复制版和 Local Dev 不提供正式自更新能力。

## 可信更新流程

Web 只能调用无参数的原生更新入口，不能传入命令、路径、URL、版本或哈希。原生层校验标准安装目录，启动固定的 `update.exe` 并只传递当前 Desktop PID；只有启动成功后才关闭 Desktop。

更新器等待旧进程退出，然后隐藏调用：

```text
node ~/.wheelmaker/deploy.mjs desktop-update
```

下载、stable 验证、SHA-256 校验和原子替换继续由部署 MJS 负责。成功后更新器启动新版 Desktop；失败时旧 EXE 保持不变，更新器显示 Windows 原生错误并重新启动旧版。整个流程使用当前用户权限，不请求管理员提权。更新器不注册服务、计划任务或常驻进程，也不修改 Hub/Web。

## 兼容边界

旧 Desktop 没有新增原生桥，不能仅靠远程 Web 获得自更新能力。它需要先通过现有 `update_exe.bat` 手动升级一次；该批处理文件继续作为首次升级和故障恢复入口。

设计来源：[`spec-desktop-self-update.md`](../../scope/2026-07-18-desktop-self-update/spec-desktop-self-update.md)。
