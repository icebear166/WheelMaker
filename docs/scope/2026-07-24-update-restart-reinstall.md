> 由 scope skill 于 2026-07-24 生成（已按代码核实修正）

# 更新页 Restart 与 NPM Reinstall

## 目标

更新页重构（2026-07-23）后，hub 卡「已最新版」没有任何动作按钮（缺手动重启入口）；NPM 包行只能 install / update / uninstall（缺重装修复），且 runtime 包目前**不允许卸载**。本次补三个互相支撑的改动：

1. hub 卡「已最新」提供 **Restart**（触发现有 update 请求，updater 总是重走并重启）。
2. **放开所有包可卸载**（runtime 包也允许 uninstall），让卸载与 reinstall 对全体已装包可用。
3. NPM 已装包提供 **Reinstall**（卸载后重装最新，A）。

## 决策

- **Hub Restart = 触发现有 update 请求，纯前端**：后端 `update.go` 的 `request()` 不检查版本，总是 trigger updater；updater（`deploy-core.mjs` `executeDeployment`）每次都走 downloading→verifying→applying→`restarting`，**无「版本相同跳过」分支**。所以 restart **无需新参数、不改后端**，复用 `requestWheelMakerUpdate(hubId)`。
- **前端按钮**：hub 卡「已最新（`up_to_date` / `local_newer`）」渲染 `[Restart]`，点击调现有 `requestWheelMakerUpdate(hubId)`；「有更新」仍 `[Update Hub]`；job 进行中禁用并显示状态。
- **restart 的重启约束 = 普通 update 的既有约束**（supervisor 重拉），非 restart 新增风险。
- **放开所有包卸载**：后端 `npm.go` `startUninstall` 把 `deprecatedPackageAllowed` 检查改为允许 runtime + deprecated（所有受管包）；`scan` 里 runtime 已装包 `CanUninstall=true`（原 `false`）。效果：所有已装包可卸载。
- **NPM Reinstall = 卸载后重装最新（A）**：后端 `npm.go` `Handle` 新增 `reinstall` case（uninstall → install latest，串联，复用 `acceptOperation` / runner）。
- **NPM 操作矩阵**：
  - 未安装 → `[Install]`
  - 已装·有更新 → `[Update]` + 版本箭头，行末 `[reinstall]` `codicon-sync` · `[uninstall]` `codicon-trash`
  - 已装·最新 → 「Up to date」灰显，行末 `[reinstall]` `codicon-sync` · `[uninstall]` `codicon-trash`
  - reinstall + uninstall 对**所有已装包**出现（runtime 现也可卸载），并列两个 icon。
- **协议**：仅扩展 `RegistryNpmOperation.action` 枚举（已是 `| string` 开放 union）加 `reinstall`。**不升 protocol version，不加新请求参数**，向后兼容。

## 架构

- **前端 `UpdateSettingsDetail.tsx`**：hub 行按钮放开（`up_to_date` / `local_newer` 渲染 Restart）；npm 已装包行加 `codicon-sync` reinstall icon 按钮。
- **前端 `WorkspaceApp.tsx`**：`requestAgentPackageAction` 的 action 类型加 `'reinstall'`；`agentPackageActionLabel` 加 `Reinstall`；confirm 执行链路 `action==='reinstall'` → `service.reinstallNpmPackage`；`requestWheelMakerUpdate` 不变。
- **前端 registry**：`RegistryRepository` 加 `reinstallNpmPackage`（`runHubStateAction 'agentPackages' 'reinstall'`）；`RegistryWorkspaceService` 透传。
- **后端 `server/internal/hub/tools/npm.go`**：`startUninstall` 放开（runtime + deprecated 可卸载）；`scan` runtime 已装包 `CanUninstall=true`；`Handle` 新增 `reinstall` case（uninstall → install latest）。
- **类型**：`RegistryNpmOperation.action` 加 `'reinstall'`；前端 `PackageAction` 加 `'reinstall'`。
- 后端 `update.go` / `deploy-core.mjs` **不改**。

## 流程

- **Restart**：前端点 Restart → `requestWheelMakerUpdate(hubId)` → 后端 trigger updater → updater 重走下载→校验→应用→`restarting` → hub 重启 → 前端 job 轮询显示状态。
- **Reinstall**：前端点 reinstall icon → `requestAgentPackageAction('reinstall', hubId, pkg)` → confirm → `service.reinstallNpmPackage` → 后端 npm uninstall → npm install latest → operation 状态反馈。

## 验收标准

- hub 卡「已最新（`up_to_date` / `local_newer`）」渲染 `[Restart]`；点击触发 `requestWheelMakerUpdate`（与「有更新」同一条请求路径，无新参数）。
- hub 卡「有更新」仍渲染 `[Update Hub]`；job 进行中按钮禁用并显示状态（Restarting…）。
- **不改后端 `update.go` / `deploy-core.mjs`**。
- 所有已装包 `canUninstall=true`（runtime 已装包也 true）；`uninstall` 对所有已装包可用（后端 `startUninstall` 放开）。
- NPM 已装包行渲染 reinstall 与 uninstall 两个 icon 按钮；未装包只有 Install；reinstall 只对已装包出现。
- 点击 reinstall 触发后端一次 reinstall（uninstall → install latest）；operation 状态正确反馈（running / succeeded / failed）。
- 前端 `PackageAction` 类型含 `'reinstall'`；`RegistryNpmOperation.action` 含 `'reinstall'`。
- 不破坏现有 update / install / uninstall / scan 行为。

失败场景：

- Restart 重启失败（无 supervisor 等）：沿用现有 update job 的 failed 状态与连接断开提示。
- reinstall 失败（uninstall 成功但 install 失败）：operation 报 failed + errorSummary，包如实处于未装状态。

### 测试

- **后端（Go）**：`reinstall` case 单测（mock runner 验证 uninstall+install 被调、operation succeeded）；`startUninstall` 放开（runtime 包可卸载）单测；`scan` runtime 已装包 `CanUninstall=true` 单测。合入 `tools_test.go` / `npm_install_message_test.go`。
- **前端（jest）**：`UpdateSettingsDetail.test.tsx` 补「最新版 hub 显示 Restart」「已装包显示 reinstall + uninstall icon」「未装包无 reinstall」。
- 不测：真实 supervisor 重启；后端 update（不改）。

## 范围之外

- 不改后端 `update.go` / `deploy-core.mjs`（restart 复用现有 update 流程）。
- 不新增 server 自重启 RPC / `force` 参数。
- 不解决「无 supervisor 部署下 update 退出不自动恢复」（update 既有约束，超范围）。
- 不改 protocol version（仅扩展 action 枚举，向后兼容）。
- 不动 hub 行版本号 / icon 展示、NPM 行其它字段（重构已定）。
- 不改 Desktop 标题栏自更新流程。
