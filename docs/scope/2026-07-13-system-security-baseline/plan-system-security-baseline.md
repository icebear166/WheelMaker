# WheelMaker System Security Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已批准的系统安全规格完成认证、远程客户端壳、后端密钥、Monitor 退出、Relay 与输入资源防护、诊断和供应链加固，并用分阶段发布避免再次产生无法连接的中间状态。

**Architecture:** 计划以 Registry 持久设备 Session 为认证核心，以同一个 HTTPS Base URL 派生 Web、认证和 WSS；Desktop/Android 先迁移为只带极小 Bootstrap 的远程同源壳，然后 Web 与 Registry 同批硬切换到 Cookie。其余独立安全域各自测试、提交和回滚，最终由凭据轮换及端到端安全门统一收口。

**Tech Stack:** Go 1.26.x（本轮不升级）、Gorilla WebSocket、React 19、TypeScript、Jest、webpack 5、Kotlin、Android WebView/WebKit、Gradle、PowerShell、Gitleaks。

---

## 实施总则

- 目标规格是同目录的 `spec-system-security-baseline.md`；已删除的旧 `docs/plans/2026-07-13-security-hardening-plan.md` 不得继续执行。
- 每一阶段使用独立提交。一个阶段的测试门未通过时，不进入下一阶段，也不发布其中一半。
- 第 1 阶段只增加持久 Session、Base Path 路由和设备协议；暂时保留无 Origin 的 Hub Token 认证以及现有跨 Origin 原生壳 Token 过渡路径。
- 第 2 阶段发布新版 Desktop/Android 远程壳，但仍不删除 Registry 的过渡认证。
- 第 5 阶段是不可拆分的硬切换发布单元：Web 删除 Token，Registry 同时拒绝所有带 Origin 的 Token WebSocket。两者必须来自同一提交和同一发布批次。
- 回滚只能回滚完整阶段。不得只回滚 Web 或只回滚 Registry 的认证硬切换。
- 不升级 Go，不改变 Junction/符号链接信任语义，不自动编辑用户 Nginx，不重写 Git 历史。
- 已删除的 LocalHubRead listener、证明交换、角色、方法、前端 manager 和 UI 不得以兼容名义恢复。

## 阶段与依赖

| 顺序 | 详细计划 | 依赖 | 独立完成标准 |
| --- | --- | --- | --- |
| 1 | [Registry 设备 Session 基础](plan-01-registry-device-sessions.md) | 当前 Token/loopback 基线 | 根路径、子路径、重启恢复、滑动续期和设备撤销测试通过；旧客户端仍可连接 |
| 2 | [Desktop/Android 远程客户端壳](plan-02-remote-client-shells.md) | 阶段 1 | 两端只内置 Bootstrap、只接受系统可信 HTTPS，不再运行/代理完整内置 Workspace |
| 3 | [Monitor 硬删除](plan-03-monitor-retirement.md) | 无；建议在硬切换前 | 源码、协议和现行配置消失，三平台升级清理测试通过 |
| 4 | [后端长期密钥](plan-04-backend-secret-storage.md) | 阶段 1 | 密钥 set-only，语音/TTS/DeepSeek 不再需要页面持有原文 |
| 5 | [浏览器 Cookie 硬切换](plan-05-browser-cookie-hard-cut.md) | 阶段 1、2、4 | 浏览器无 Token 持久化/传输；所有带 Origin 的 WS 只接受同源 Cookie |
| 6 | [Relay、Git 与资源边界](plan-06-relay-git-resource-defense.md) | 阶段 1 | Relay 双层限速、Git 参数隔离、网络/内存/磁盘上限测试通过 |
| 7 | [诊断、Web 与 Android 纵深防御](plan-07-diagnostics-web-android-hardening.md) | 阶段 2、4、5 | 递归脱敏、Bridge/APK/签名、CSP/开发服务器和兼容依赖门通过 |
| 8 | [凭据响应与安全验收](plan-08-credential-response-and-acceptance.md) | 阶段 1–7 | 当前凭据已轮换/清理，Gitleaks 和全量/端到端安全门通过 |

```text
01 Registry sessions ──┬──> 02 remote shells ──────────┐
                       ├──> 04 backend secrets ────────┼──> 05 browser hard cut
                       └──> 06 relay/resource defense  │
03 monitor retirement ─────────────────────────────────┤
                                                       v
                                            07 defense in depth
                                                       v
                                            08 credential/acceptance
```

### Task 1: 建立实施前基线

- [x] **Step 1: 确认分支、工作树和规格提交**

Run:

```powershell
git branch --show-current
git status --short
git log -3 --oneline
```

Expected: 当前分支为实施分支；工作树为空；历史包含 `docs: define system security baseline`。若工作树有用户改动，先停止并隔离重叠文件，不覆盖它们。

- [x] **Step 2: 运行当前全量基线并保存结果**

Run:

```powershell
Set-Location server
go test ./...
Set-Location ..\app
npm test -- --runInBand
npm run tsc:web
Set-Location ..\mobile\android
.\gradlew.bat test lint
```

Expected: 所有命令 PASS。若存在与本计划无关的既有失败，在首个阶段提交前记录到同目录 `baseline-failures.md`，包含命令、失败测试名和原始错误摘要；不得把既有失败误报成本轮回归。

- [x] **Step 3: 标记各阶段开始状态**

在本文件的阶段表中只使用详细计划链接跟踪，不复制子计划 checkbox。开始某阶段前，先打开对应文件，从第一个未完成任务执行；完成后再回到本文件勾选下方相应门：

- [x] 阶段 1 完成并通过其发布门。
- [x] 阶段 2 完成并通过其发布门。
- [ ] 阶段 3 完成并通过其发布门。
- [ ] 阶段 4 完成并通过其发布门。
- [ ] 阶段 5 完成并通过其原子发布门。
- [ ] 阶段 6 完成并通过其发布门。
- [ ] 阶段 7 完成并通过其发布门。
- [ ] 阶段 8 完成并通过最终安全门。

### Task 2: 执行发布边界检查

- [ ] **Step 1: 在阶段 2 发布前证明旧认证仍可用**

Run:

```powershell
Set-Location server
go test ./internal/registry -run 'TestWebSocket.*Token|TestWebSession' -v
```

Expected: 无 Origin 的 Hub Token 测试和原生壳过渡 Token 测试均 PASS；阶段 2 客户端发布不会先切断旧版本。

- [ ] **Step 2: 在阶段 5 发布前生成同批产物**

Run:

```powershell
Set-Location app
npm run build:web:release
Set-Location ..
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish_desktop.ps1 -WhatIf
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish_android.ps1 -WhatIf
Set-Location server
go test ./internal/registry ./internal/protocol
```

Expected: Web release 构建成功；Desktop/Android 发布预检只引用 Bootstrap；Registry/协议测试 PASS。随后从同一提交构建 Web、Registry、Desktop 和 Android，不混用旧产物。

- [ ] **Step 3: 执行最终验收并核对范围外项**

执行 `plan-08-credential-response-and-acceptance.md` 的完整命令后，检查：

```powershell
git diff --check
git status --short
git log --oneline --decorate -12
```

Expected: 无 whitespace error；只有验收文档中明确列出的输出文件；提交按阶段可识别。历史重写、Go 升级、Nginx 自动修改、Junction 限制均未混入。

## 已知平台约束

浏览器同源模型只隔离 scheme/host/port，不隔离同一 Origin 下的路径。因此 Base Path 在 Registry 侧可用于路由、Cookie Path 和 Session 绑定一致性检查，但不能把同一 Origin 的另一个不可信应用变成独立安全主体。若同一域名和端口还托管不可信应用，部署必须改用独立 hostname；Desktop/Android 的 Native Bridge 仍严格校验 Origin、Base Path 和主 Frame。

静态文件由用户 Nginx 直接提供时，应用代码无法自行添加 `X-Content-Type-Options`、`frame-ancestors` 等 HTTP 响应头。计划会提供 CSP/Referrer 的页面内防护、更新新安装模板并加入实际响应检查，但既有静态 Nginx 若要通过完整响应头验收，仍需管理员手动加入安全头；WheelMaker 不自动改写配置，也不增加新的认证 Location。
