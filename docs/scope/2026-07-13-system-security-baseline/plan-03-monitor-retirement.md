# WheelMaker Monitor Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完整删除 `wheelmaker-monitor` 的运行代码、配置、协议、UI 和现行文档，同时保证升级能在 Windows、Linux 和 macOS 主动停止服务、删除遗留定义/二进制并迁移旧 `config.json`。

**Architecture:** Monitor 不再是可运行角色。部署器在严格解析配置前执行一次窄化 JSON migration，并保留仅用于卸载遗留产物的三平台 cleanup 代码；运行时 shared config 和 Registry/Hub 协议随后硬删除 Monitor。历史 scope/plan 文档可作为审计记录保留，现行使用文档不再宣称 Monitor 可用。

**Tech Stack:** Go、Windows Service Control Manager、systemd user units、macOS LaunchAgents、JSON migration、Go tests、PowerShell source checks。

---

### Task 1: 先实现旧安装的幂等清理

**Files:**

- Create: `server/cmd/wheelmaker-deploy/legacy_monitor.go`
- Modify: `server/cmd/wheelmaker-deploy/main.go`
- Modify: `server/cmd/wheelmaker-deploy/main_test.go`
- Modify: `server/cmd/wheelmaker-deploy/service_windows.go`
- Modify: `server/cmd/wheelmaker-deploy/service_windows_test.go`
- Modify: `server/cmd/wheelmaker-deploy/service_linux.go`
- Modify: `server/cmd/wheelmaker-deploy/service_darwin.go`

- [x] **Step 1: 写旧配置 migration 测试**

从包含未知旧 Monitor 子字段的原始 JSON 开始：

```json
{
  "projects": [],
  "registry": {"token": "custom-short"},
  "monitor": {"server": "127.0.0.1", "port": 9631, "legacy": true},
  "log": {"level": "warn"}
}
```

断言 migration：只删除顶层 `monitor`；保留短自定义 Token 和所有其他字段；用 `shared.WriteConfigFile` 原子私有写；第二次执行不改字节；损坏 JSON 不覆盖原文件。

- [x] **Step 2: 写三平台 cleanup 命令测试**

用现有 command runner/fake 验证：

- Windows：停止并删除 legacy service `WheelMakerMonitor`，删除安装目录的 `wheelmaker-monitor.exe`。
- Linux：`systemctl --user disable --now wheelmaker-monitor.service`，删除 user unit、daemon-reload，删除 `wheelmaker-monitor`。
- macOS：`launchctl bootout` legacy label，删除 plist 和 `wheelmaker-monitor`。
- 服务/文件不存在视为成功；真实权限错误和其他命令错误向上返回。
- 目标路径必须先 resolve 并确认位于 WheelMaker 安装目录，不执行计算路径的递归删除。

- [x] **Step 3: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./cmd/wheelmaker-deploy -run 'TestMigrateLegacyMonitor|TestCleanupLegacyMonitor' -v
```

Expected: FAIL；统一 migration/cleanup 尚不存在或现有平台逻辑不完整。

- [x] **Step 4: 实现迁移和幂等清理**

迁移在任何 `shared.LoadConfig` 之前运行，使用 `map[string]json.RawMessage` 只移除精确顶层 key：

```go
func migrateLegacyMonitorConfig(path string) (bool, error) {
	raw, err := os.ReadFile(path)
	if err != nil { return false, err }
	var root map[string]json.RawMessage
	if err := json.Unmarshal(raw, &root); err != nil { return false, err }
	if _, ok := root["monitor"]; !ok { return false, nil }
	delete(root, "monitor")
	encoded, err := json.MarshalIndent(root, "", "  ")
	if err != nil { return false, err }
	return true, shared.WriteConfigFile(path, append(encoded, '\n'))
}
```

不要保留一个会启动 Monitor 的兼容分支；legacy 常量只能被 cleanup 调用。

- [x] **Step 5: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./cmd/wheelmaker-deploy -run 'TestMigrateLegacyMonitor|TestCleanupLegacyMonitor' -v
git add cmd/wheelmaker-deploy
git commit -m "fix: retire legacy monitor installations"
```

Expected: PASS；三平台清理可重复执行。

### Task 2: 删除 Monitor 协议角色和路由

**Files:**

- Delete: `server/internal/hub/hub_monitor.go`
- Modify: `server/internal/protocol/registry.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`
- Modify: `server/internal/hub/hub.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`
- Modify: `server/internal/hub/tools/manager.go`
- Modify: `server/internal/hub/tools/tools_test.go`
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Create: `app/__tests__/web-monitor-retirement.test.ts`

- [x] **Step 1: 写拒绝已删除角色/方法测试**

协议枚举测试中删除 Monitor descriptors，并新增 Registry 回归：`connect.init role=monitor` 返回 `forbidden`；`monitor.status`、`monitor.restart` 或现有 Monitor 方法一律返回 unknown/forbidden，不能路由到 Hub。

`web-monitor-retirement.test.ts` 断言 `RegistryMethods`、repository 和 DTO 不包含 `Monitor`。

- [x] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/protocol ./internal/registry ./internal/hub -run 'Test.*Monitor.*(Removed|Rejected|Method)' -v
Set-Location ..\app
npm test -- --runInBand __tests__/web-monitor-retirement.test.ts
```

Expected: FAIL；当前 role/method/route 仍存在。

- [x] **Step 3: 删除协议和运行路由**

删除 `RegistryRoleMonitor`、Monitor method 常量/descriptor/payload、Registry monitor peer map、`MonitorCore` 及其 status/log/database/action handler。不要将旧方法改成 alias；删除后统一走现有 unsupported method 错误。

`ReporterConfig.MonitorBaseDir` 和 `tools.ManagerConfig.MonitorBaseDir` 还被 file index/update tools 当作 WheelMaker state dir 使用，必须同步重命名为 `StateDir`，更新 `hub.go` 和测试；不能因为删除 Monitor 而丢掉 file index/update 的目录能力。删除 `SetMonitorResetSessionPromptState` 及只服务于 Monitor action 的回调。

- [x] **Step 4: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/protocol ./internal/registry ./internal/hub
Set-Location ..\app
npm test -- --runInBand __tests__/web-monitor-retirement.test.ts
npm run tsc:web
Set-Location ..
git add server/internal/protocol server/internal/registry server/internal/hub app/web/src/registry app/__tests__/web-monitor-retirement.test.ts
git commit -m "refactor: remove monitor protocol role"
```

Expected: PASS；协议不再承认 Monitor。

### Task 3: 删除 Monitor 源码和配置模型

**Files:**

- Delete: `server/cmd/wheelmaker-monitor/`
- Modify: `server/internal/shared/config.go`
- Modify: `server/internal/shared/shared_test.go`
- Modify: `server/config.example.json`
- Modify: `server/cmd/wheelmaker-deploy/main.go`
- Modify: `server/cmd/wheelmaker-deploy/main_test.go`
- Modify: `app/web/src/shell/AppDialogs.tsx`

- [ ] **Step 1: 把 shared config 测试改为严格拒绝 Monitor**

`shared.LoadConfig` 对顶层 `monitor` 返回 unknown field；部署器 migration 后再调用相同 parser 则成功。`config.example.json` 不含 Monitor。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location server
go test ./internal/shared ./cmd/wheelmaker-deploy -run 'TestLoadConfig.*Monitor|TestEnsureConfig' -v
```

Expected: FAIL；`MonitorConfig` 仍被接受。

- [ ] **Step 3: 删除运行源码和 UI 文案**

删除整个 command 目录、`AppConfig.Monitor`、`MonitorConfig` 和默认 9631。Deploy build/publish 清单不得再产出 Monitor；仅 Task 1 的 legacy cleanup 可提及旧文件名。删除 Web 中打开/重启/查看 Monitor 的对话框或按钮分支。

- [ ] **Step 4: 运行测试并提交**

Run:

```powershell
Set-Location server
go test ./internal/shared ./cmd/wheelmaker-deploy ./...
Set-Location ..\app
npm test -- --runInBand
npm run tsc:web
Set-Location ..
git add -A server/cmd/wheelmaker-monitor server/internal/shared server/config.example.json server/cmd/wheelmaker-deploy app/web/src/shell/AppDialogs.tsx
git commit -m "refactor: delete wheelmaker monitor runtime"
```

Expected: PASS；Go package list 不再包含 `cmd/wheelmaker-monitor`。

### Task 4: 更新现行安装和架构文档

**Files:**

- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `server/CLAUDE.md`
- Modify: `docs/registry-protocol.md`
- Modify: `docs/nginx-security.md`
- Modify: `docs/readme-assets/nginx-routing.svg`
- Modify: `docs/readme-assets/topology.svg`
- Modify: `docs/readme-assets/topology-dual-machine.svg`

- [ ] **Step 1: 删除现行 Monitor 指引**

README/INSTALL 的配置和 Nginx 示例只保留 Web 与 `/ws`。SVG 删除 :9631、Monitor 节点和 `/monitor/` 箭头，并同步 `<desc>` 可访问文本。协议文档删除 Monitor role/method。

- [ ] **Step 2: 运行文档引用门**

Run:

```powershell
$paths = @('README.md','INSTALL.md','server/CLAUDE.md','server/config.example.json','docs/registry-protocol.md','docs/nginx-security.md','docs/readme-assets','app/web/src','server/internal/protocol','server/internal/registry','server/internal/hub')
rg -n -i 'wheelmaker-monitor|registryrolemonitor|monitorcore|monitorbasedir|monitor\.status|monitor\.restart|:9631|/monitor/' $paths
```

Expected: 无输出。部署器 legacy cleanup 和历史 scope/plan 不在此门中，允许保留审计所需名称。

- [ ] **Step 3: 提交文档更新**

Run:

```powershell
git add README.md INSTALL.md server/CLAUDE.md docs/registry-protocol.md docs/nginx-security.md docs/readme-assets
git commit -m "docs: remove retired monitor service"
```

Expected: 提交成功。

### Task 5: 执行 Monitor 退出验收

- [ ] **Step 1: 运行全量 Go/Web 测试**

Run:

```powershell
Set-Location server
go test ./...
Set-Location ..\app
npm test -- --runInBand
npm run tsc:web
```

Expected: PASS。

- [ ] **Step 2: 检查剩余引用只属于升级清理或历史记录**

Run:

```powershell
rg -n -i 'wheelmaker-monitor|:9631|monitor\.status|registryrolemonitor|monitorcore|monitorbasedir' . --glob '!docs/scope/**' --glob '!docs/plans/**' --glob '!docs/superpowers/**' --glob '!docs/reviews/**' --glob '!**/*.html' --glob '!server/cmd/wheelmaker-deploy/legacy_monitor.go' --glob '!server/cmd/wheelmaker-deploy/*test.go'
```

Expected: 无输出。若命中，逐一删除运行/现行引用，不能扩大 allowlist。

- [ ] **Step 3: 推送阶段提交**

Run:

```powershell
git status --short
git push origin HEAD
```

Expected: 工作树为空，阶段 3 已推送。
