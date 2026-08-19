## 仓库结构
```
WheelMaker/
  server/   — Go 守护进程（ACP 桥接、IM 适配器）
  app/      — Workspace Web UI（React / webpack，供浏览器与 WheelMaker Desktop 使用）
  docs/     — 共享协议与设计文档
  scripts/  — 脚本
```

**根据工作区跳转到对应文档：**
- 修改 Go 服务端 → 读 [server/CLAUDE.md](server/CLAUDE.md)
- 修改 Workspace Web UI → 读 [app/CLAUDE.md](app/CLAUDE.md)

## 全局约定
- 代码注释和标识符用英文
- 测试改动优先合并到现有 `*_test.go` 文件；只有在现有文件明显不适合承载时才新增 test 文件
- 禁止扫描 dist 产物目录（例如检索时使用 rg --glob '!**/dist/**'）
- Web 构建产物直接输出到 `~/.wheelmaker/web`，不再经过 `app/dist`
- 禁止无意义的 `strings.TrimSpace`：仅允许在明确的输入边界归一化场景使用，禁止在内部链路重复清洗
- 未经用户明确同意，禁止修改 protocol version；协议版本变更前必须说明兼容性与发布影响并获得确认
- 需求澄清、方案选择、设计讨论只用文字对话；不要主动提议用浏览器/Web 可视化伴随工具展示选项
- 需求澄清和方案选择中的每个候选项（无论使用 `A.` / `B.` / `C.`、数字或其他标签）必须各自作为独立 Markdown 段落，选项之间使用空行；禁止依赖行尾两个空格或普通换行分隔选项。选项包含补充列表时，选项标题、补充列表和下一选项之间也必须使用空行
- 完成修改后的默认验证只运行与本次改动直接相关的必要测试：先根据 `git diff` 和未跟踪文件判断影响范围；未改对应模块时跳过该模块测试，并在结果中说明跳过原因
- Go 改动优先运行受影响的包（例如 `go test ./internal/gateway`）；只有改动跨包共享代码、协议、`go.mod`/`go.sum`、构建配置，或用户明确要求发布/全量验证时，才扩大到 `go test ./...`
- Web 改动优先运行相关 Jest 测试；改动 TypeScript/TSX、类型声明或 Web 类型配置时再运行 `npm run tsc:web`；全量 Jest 仅在高风险改动、发布验证或用户明确要求时运行
- 不要为了“验证完整”默认重复运行全量 Go/Jest，也不要默认使用 `-count=1` 破坏 Go 测试缓存；测试跳过、扩大或失败都要在交付结果中明确记录
- Windows 下确实需要启动 Go 测试时，使用仓库的 `scripts/run-hidden-go-test.vbs` 作为 `go test -exec` 的无窗口启动器；它由 GUI 宿主 `wscript.exe` 承载，隐藏临时 `*.test.exe` 的控制台，同时保留 stdout/stderr 和退出码。不要直接运行或用 `go test -c` 启动 `*.test.exe`。该包装只用于必要的实际测试运行，不因它绕过 Go 测试缓存而重复测试。PowerShell 下使用下面的固定参数，再把它传给每个必要的 `go test` 命令：
  ```powershell
  $repoRoot = (git rev-parse --show-toplevel)
  $hiddenGoTestRunner = Join-Path $repoRoot 'scripts\run-hidden-go-test.vbs'
  $hiddenGoTestExec = 'wscript.exe //nologo "' + $hiddenGoTestRunner + '"'
  go test ./internal/gateway "-exec=$hiddenGoTestExec"
  ```
- 当用户要求“仅构建发布产物”时，运行 `publish-release.bat`，按需选择 Desktop/Android，并选择不发布到 public release server；非交互等价命令是 `node scripts/release.mjs [--with-desktop] [--with-android]`。默认本地构建主机是 Windows，输出到 `.release-out/v1.x`，不发布也不触发 Action
- 当用户要求“正式发布 WheelMaker”时，从干净的源码工作树运行 `publish-release.bat`，按需选择 Desktop/Android，并确认发布到 public release server；非交互等价命令是 `node scripts/release.mjs [--with-desktop] [--with-android] --publish`。不要默认触发 GitHub Action；`.github/workflows/publish-release.yml` 只作为 `publish-release-action.bat` 手动触发的远程构建回退，并且只读取 `WHEELMAKER_RELEASE_TOKEN`
- 目标机首次安装和旧版迁移统一使用 `https://release.wheelmaker.top/` 中可在任意目录执行的一行命令；源码仓库根目录不提供 `deploy.bat` / `deploy.sh`。目标机更新统一走已安装的公共 `deploy.mjs`；`deploy.mjs update` 不安装/卸载运行时，安装目录内由普通部署生成的 `deploy.bat` / `deploy.sh` 只调用 `node deploy.mjs`。不要恢复旧 updater EXE、文件信号或目标机源码构建流程

