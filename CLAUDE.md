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
- 当用户要求“仅构建发布产物”时，在源码仓库运行 `node scripts/release.mjs build`；只有明确要求包含 Desktop 时才加 `--with-desktop`。默认本地构建主机是 Windows，输出到 `.release-out`，不发布也不触发 Action
- 当用户要求“正式发布 WheelMaker”时，优先从干净的源码工作树运行 `node scripts/release.mjs publish`（按需加 `--with-desktop`）；不要默认触发 GitHub Action。`.github/workflows/publish-release.yml` 只作为手动 `workflow_dispatch` 的远程构建回退
- 目标机更新统一走已安装的公共 `deploy.mjs`；`deploy.mjs update` 不安装/卸载运行时，`deploy.bat` / `deploy.sh` 只用于从旧源码部署做一次性迁移。不要恢复旧 updater EXE、文件信号或目标机源码构建流程

## Completion Gate (Highest Priority)
Before the final user-facing completion message in any implementation task, execute this exact tail sequence:
1. `git add -A`
2. `git commit -m "<message>"`
3. `git push origin <branch>`
If any step fails, report failure and keep working until resolved. Do not claim completion early.

