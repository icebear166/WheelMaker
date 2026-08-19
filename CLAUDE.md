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
- 禁止构建 Web，保持 `app/dist` 为空
- 未经用户明确同意，禁止修改 protocol version；协议版本变更前必须说明兼容性与发布影响并获得确认
- 验证只运行与本次改动直接相关的必要测试；Windows 下 Go 测试通过 `go test -exec` 使用 `scripts/run-hidden-go-test.vbs`，避免 `*.test.exe` 弹窗。

