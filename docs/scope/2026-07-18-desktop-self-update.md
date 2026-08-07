> 由 scope skill 于 2026-07-18 生成

# Windows Desktop 自更新

## 目标

为标准安装目录中的 `WheelMakerDesktop.exe` 增加轻量自更新能力。Desktop 每次启动后在后台检查 `stable.json.desktopExe`，有更新时在右上 Windows 扩展菜单显示红点和更新入口；用户点击后，Desktop 启动本地一次性 `update.exe` 并退出，由更新器等待文件锁释放、复用现有可信部署链更新 Desktop，最后自动重新打开应用。检查与更新不得阻塞正常使用、弹出命令行窗口、要求管理员权限或影响 Hub。

## 决策

- 自更新仅支持标准目录 `~/.wheelmaker/desktop/WheelMakerDesktop.exe`，不支持任意复制目录。
- 更新器固定为 `~/.wheelmaker/desktop/update.exe`，是 Windows GUI 子系统的一次性程序；不注册服务、计划任务或常驻进程。
- Windows 扩展菜单中的 Desktop 更新项始终位于 Dev Mode 下方。检查中、已最新、有更新和检查失败分别显示明确状态；只有有更新时显示红点，检查失败时入口用于重试。
- 启动检查在后台执行。离线、超时或元数据错误不弹窗、不影响 Desktop；用户可从菜单手动重试。
- 更新入口不接受网页提供的命令、路径、URL、版本或哈希。原生层只启动固定安装目录中的 `update.exe`，更新器自行使用固定的部署入口和可信稳定通道。
- 更新成功后自动重新启动新版 Desktop。更新失败时保持旧 EXE 不变，显示 Windows 原生错误，并重新启动旧版 Desktop。
- 本地 EXE 与 stable 的比较使用 SHA-256，不新增另一套版本状态文件，也不依赖 Windows 文件版本字段。
- `update.exe` 随每个 Windows 平台包构建、安装和更新，不受本轮是否包含可选 Desktop 资产影响。
- 现有 `update_exe.bat` 保留为首次升级和恢复入口。旧 Desktop 因没有新增原生桥，必须先手动更新到支持自更新的版本一次。
- 本任务只实现、测试并提交源码，不正式上传 Release。

## 架构

### Web 更新状态

Web 复用统一的 WheelMaker release URL 与 stable 元数据解析，不在 Desktop 组件中新增散落的服务地址。Desktop 标题栏挂载后发起一次后台检查，并通过原生桥读取当前标准安装 EXE 的 SHA-256。Web 将本地 SHA 与 `stable.desktopExe.sha256` 比较，维护 `checking`、`current`、`available` 和 `failed` 四种状态，负责菜单文案、可用性和红点展示。

### Desktop 原生桥

正式 HTTPS Desktop 页面新增两个无参数或只读绑定：读取本地 Desktop 更新信息、请求开始 Desktop 更新。桥接层继续使用现有页面授权策略；Local Dev 页面、普通浏览器和非 Desktop 壳不暴露该能力。

读取绑定只接受标准安装路径，返回当前 EXE SHA 和本地更新器是否存在。请求更新绑定不信任 Web 的任何发布数据：它校验当前 EXE 与 `update.exe` 均在固定目录，启动 `update.exe` 并只传递当前 Desktop PID；启动成功后才关闭 Desktop，启动失败则保持当前窗口运行并将错误返回 Web。

### 一次性更新器

新增独立 Go 命令构建 `update.exe`。更新器根据当前用户 HOME 推导 `~/.wheelmaker`，等待传入的父 PID 退出，然后隐藏启动：

```text
node ~/.wheelmaker/deploy.mjs desktop-update
```

现有 `desktop-update` 继续负责读取并验证 stable、下载 Desktop、校验 SHA-256 和原子替换。更新器不复制这套网络与信任逻辑。命令成功后启动固定路径的 `WheelMakerDesktop.exe`；命令失败时显示原生 MessageBox，再启动仍存在的旧 EXE。更新器自身不删除，也不修改 Hub/Web、运行时注册或部署状态。

### 构建与部署

Windows 平台包新增 `desktop/update.exe`，而可选发布资产 `WheelMakerDesktop.exe` 的继承指针语义保持不变。完整部署和内部更新都只将平台包里的 `update.exe` 写入标准 desktop 目录，不清空、不覆盖现有 `WheelMakerDesktop.exe`。生成的 `update_exe.bat` 继续调用 `deploy.mjs desktop-update`，供首次升级和故障恢复使用。

## 流程

### 启动检查

```text
Desktop Web 标题栏挂载
  -> 获取 stable.json（复用统一 release 配置）
  -> 原生桥计算标准安装 EXE SHA-256
  -> 比较 stable.desktopExe.sha256
  -> 更新菜单状态与 Windows 扩展红点
```

stable 不含有效 Desktop 指针、本地路径不受支持、更新器缺失或网络请求失败时进入 `failed`，不弹窗。用户点击失败状态后重新执行完整检查。该流程只在每次启动时自动执行一次，不增加定时轮询。

### 执行更新

```text
用户点击 Update Desktop
  -> Web 调用无参数原生更新绑定
  -> 原生层校验固定路径并启动 update.exe --parent-pid <pid>
  -> Desktop 关闭
  -> update.exe 等待父 PID 退出
  -> 隐藏调用 deploy.mjs desktop-update
  -> 成功：启动新版 Desktop
  -> 失败：保留旧 EXE，MessageBox 提示，启动旧版 Desktop
```

## 验收标准

- 标准安装的 Windows Desktop 每次启动后只进行一次非阻塞更新检查。
- Windows 扩展菜单始终在 Dev Mode 下方显示 Desktop 更新项，并正确呈现检查中、已最新、有更新和失败重试状态。
- 有更新时，Windows 扩展图标与更新菜单项显示 WheelMaker 主题一致的红点；无更新、检查中或失败时不显示更新红点。
- 浏览器、非 Windows 原生壳和 Local Dev 不显示或不能调用正式 Desktop 更新能力。
- Web 不能向原生层或更新器传入任意命令、文件路径、下载 URL、版本或哈希。
- 点击更新后只有在 `update.exe` 成功启动时才关闭 Desktop。
- `update.exe` 无命令行窗口、无需管理员权限，等待 Desktop 退出后复用 `deploy.mjs desktop-update` 更新，并在成功后重新打开新版。
- 下载、校验或替换失败时旧 EXE 保持可运行，用户看到原生错误，旧版 Desktop 自动重新打开。
- Windows 平台包始终包含 `desktop/update.exe`；正常部署和内部更新会安装它，但不会删除或覆盖现有 Desktop EXE。
- 不带 Desktop EXE 的后续 stable 仍沿用既有 `desktopExe` 指针并可被启动检查识别。
- 现有 `update_exe.bat` 继续可用于旧版首次升级和恢复。

### 测试

- React 测试覆盖四种检查状态、菜单顺序、红点、重试、更新点击以及非 Desktop/Local Dev 隐藏行为。
- Desktop Go 测试覆盖桥接授权、标准路径限制、SHA 计算、固定更新器启动参数、启动失败不关闭窗口。
- 更新器 Go 测试通过注入的进程等待、命令执行、MessageBox 和重启接口覆盖成功与失败流程，不运行真实替换。
- 发布构建测试断言只有 Windows 平台包包含 `desktop/update.exe`，且它独立于 `withDesktop`。
- 部署测试覆盖完整部署和内部更新安装 `update.exe`、保留现有 `WheelMakerDesktop.exe`，并保留 `update_exe.bat`。
- 不在自动测试中访问真实 release 服务、关闭真实 Desktop 或替换用户本机 EXE。

## 范围之外

- 任意目录、便携版或非标准用户 HOME 下的 Desktop 自更新。
- macOS、Linux 或 Android 更新行为。
- 更新器服务、计划任务、常驻后台进程或管理员级安装。
- Desktop 定时轮询、静默强制更新、版本回退或跳过指定版本。
- 修改 Registry protocol version。
- 本次实现完成后的正式 Release 构建与上传。
