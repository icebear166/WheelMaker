> 由 scope skill 于 2026-08-01 生成

# Hub Runtime Restart

## 目标

Hub 菜单当前把版本操作收敛为一个按钮：有新版本时只能 Update，已是最新版时虽然显示 Restart 语义，但仍调用更新流程。本能力将 Update 与 Restart 拆成两个独立动作；Restart 通过 `deploy.mjs runtime restart` 重启托管 runtime，使服务管理器重新创建 guardian、Hub worker 以及同一 runtime 中的 Registry worker，并让新进程读取服务管理器当前提供的环境变量。更新流程、协议版本和 update-only 兼容行为保持不变。

## 决策

1. **Restart 与版本差异无关。** 正常 Hub 只要已安装且能识别当前版本，就可以 Restart；即使存在可用更新，也同时显示 Update 和 Restart。
2. **UI 使用两个独立图标动作。** 版本号改为状态展示；Update 使用 `cloudDownload`，Restart 使用 `refreshCw`。有更新时提示点附着在 Update 动作上。
3. **Restart 走 MJS runtime 控制层。** 不让 Hub worker 仅退出后等待旧 guardian 拉起，因为旧 guardian 可能继续持有旧的环境变量。MJS 新增 `runtime restart`，由平台服务管理器重新创建托管 runtime。
4. **Restart 是完整 runtime 重启。** 当前 guardian 统一管理 Hub 与可选 Registry worker；Registry worker 同时重启是可接受行为，Web 通过现有断线重连和新 `instanceId` 处理短暂中断。
5. **Hub 必须先返回 action 响应。** Hub 在成功写出 `hub.state.action` 响应后，异步启动独立的 runtime-restart helper；helper 不等待 Hub 自身完成退出。
6. **update-only 保持永久白名单。** update-only Hub 只允许 `wheelmakerUpdate/requestUpdate`，不允许 `restart`；Registry 在路由层拒绝，App 继续显示仅可更新状态。
7. **不增加协议版本。** 新 action 复用现有 `hub.state.action`，Registry Protocol 保持 2.6。
8. **环境变量来源是服务管理器的当前配置。** Restart 负责触发服务管理器重新创建进程，不把旧 Hub 的 `os.Environ()` 复制给新 worker，也不把当前 Hub 的环境重新写回运行时配置；新变量必须已经存在于 systemd、launchd 或 Windows Task 所使用的环境来源中。

## 架构

前端继续使用现有 Hub 菜单和确认框，但把版本操作拆为独立的 Update/Restart callback。Registry repository/service 增加 Restart wrapper，沿用 `hub.state.action` 的 envelope。Hub Reporter 在 `wheelmakerUpdate` section 增加 `restart` action，成功写响应后调用注入的 runtime restart handler。runtime restart handler 启动安装目录中的 Node 与 `deploy.mjs`，MJS 根据平台调用服务管理器的 restart 能力。

```text
Web Hub menu
  ├─ Update   -> confirm -> hub.state.action(wheelmakerUpdate, requestUpdate)
  └─ Restart  -> confirm -> hub.state.action(wheelmakerUpdate, restart)
                              -> Registry validation/routing
                              -> Hub writes accepted response
                              -> detached helper: node deploy.mjs runtime restart
                              -> platform manager recreates runtime
                              -> fresh guardian/Hub/optional Registry workers
```

### UI

Hub 标题行采用以下动作矩阵：

| Hub 状态 | 可见动作 | 行为 |
| --- | --- | --- |
| 已安装且有新版本 | Update、Restart | 两个动作各自打开对应确认框 |
| 已安装且最新版或本地版本较新 | Restart | 重启 runtime，不下载更新 |
| 未安装 | Update | 保留现有安装/更新流程，不显示 Restart |
| update-only | Update | 隐藏 Restart |
| Update 或 Restart pending | 当前版本号保留，动作组禁用 | 当前动作显示 loading |

Update 确认框保持现有下载、校验、部署并重启说明。Restart 确认框使用标题 `Restart WheelMaker?`、主按钮 `Restart` 和说明“不会下载更新，runtime 会重新启动并加载最新环境”。Restart 被接受后显示 `Restarting…`，断线和恢复复用现有 HubStore/Registry 重连状态。

### MJS runtime adapter

`deploy.mjs` 接受 `runtime restart`。该本地生命周期命令在提升已有 pending launcher 后直接进入 core，不检查 stable、不下载或替换部署脚本与业务版本。`deploy-core.mjs` 的 runtime adapter 保留现有 start/stop，并增加平台 restart：

- Linux：`systemctl --user restart wheelmaker-hub.service`，让 systemd 重新读取 `EnvironmentFile`。
- macOS：对 `gui/<uid>/com.wheelmaker.hub` 执行 `launchctl kickstart -k`，让 launchd 重新创建 job。
- Windows：使用不会被当前 Hub worker 提前终止的重启脚本，停止现有 `WheelMaker` task/worker 后重新启动 `WheelMaker` Scheduled Task。

Restart 必须是 runtime adapter 的单一平台动作；不能在 MJS 中先等待 stop 完成、再依赖已经属于同一 runtime 的进程继续执行 start。

## 流程

1. Hub 菜单读取现有 `wheelmakerUpdate` 状态，并为正常、已安装 Hub 计算 `updateVisible` 与 `restartVisible`；两者独立计算。
2. 用户点击 Update 或 Restart，App 建立对应 `ConfirmTarget`。确认框的标题、说明、图标和主按钮根据动作选择。
3. 确认 Update 时，保持现有 `requestUpdate`、更新租约、状态刷新和 updater 行为。
4. 确认 Restart 时，App 调用 Registry service 的 restart wrapper；不调用 `cmd.update`，不创建下载或更新 job。
5. Registry 对正常 Hub 转发 `hub.state.action`；对 update-only Hub 在 firewall 层返回 `FORBIDDEN`。
6. Hub Reporter 校验 `wheelmakerUpdate/restart`，返回 `{ok:true, accepted:true, status:"restart_pending", hubId}`，并在响应成功写出后异步启动 runtime restart helper。
7. MJS 调用当前平台服务管理器重启 `wheelmaker-hub` runtime。服务管理器重新创建 guardian，guardian 重新启动 Hub 和配置启用的 Registry worker；新 Hub 重新读取配置与服务管理器环境。
8. Web 收到断线后进入既有 reconnect 状态；新 Hub 连接产生新的 `instanceId`，HubStore 按既有 instance replacement 规则替换状态。

## 验收标准

- 有新版本的正常 Hub 同时显示 Update 与 Restart，两个图标的 aria-label、确认框和 callback 各自对应正确动作。
- 已是最新版或本地版本较新的正常 Hub 显示 Restart，点击后不触发下载、校验、部署或 `requestUpdate`。
- 未安装 Hub 仍只显示现有 Update/安装行为。
- update-only Hub 不显示 Restart；直接发送 `wheelmakerUpdate/restart` 会被 Registry 拒绝。
- Restart 响应在 Hub 关闭前写出；成功响应后 Hub 才启动异步 runtime restart helper。
- `node deploy.mjs runtime restart` 在 Linux、macOS、Windows 三个平台分别调用正确的 runtime manager，并保留 start/stop 行为。
- runtime manager 被重启后，Hub 不再依赖旧 guardian 的环境快照；新进程使用服务管理器当前配置提供的环境变量。
- Restart 期间 Update 与 Restart 动作禁用并显示 loading；重连后版本状态恢复为正常查询结果。
- Registry worker 同属 runtime 时可以随 Hub 一起短暂重启；Web 最终能重新连接并接收新 HubState。
- Registry Protocol 仍为 2.6，未增加顶层 RPC 或 protocol version。
- 现有 Update、Hub 菜单其他动作、Flicker Bridge restart 和 Desktop self-update 行为不回归。

### 测试

- 前端单元测试覆盖：双动作渲染、最新版只显示 Restart、update-only 隐藏 Restart、两个确认目标及 pending 禁用状态。
- 前端 service/repository 测试覆盖：Restart 发送精确的 `hub.state.action` section/action，并与 Update payload 区分。
- `AppDialogs` 测试覆盖 Restart 标题、说明、图标和主按钮，同时保持 Update 文案。
- Hub Go 测试覆盖：`validateHubStateAction` 允许正常 restart、Reporter 在写响应后调用 restart handler、handler 返回 accepted payload，以及错误时不触发 handler。
- Registry Go 测试覆盖：update-only firewall 拒绝 restart，现有 requestUpdate 白名单仍通过。
- MJS 测试覆盖：`runtime restart` 参数解析、Linux/macOS/Windows runtime adapter 的 manager 命令，以及未知 runtime action 仍报错。
- 运行受影响的前端 Vitest、MJS Node tests 和 Go package tests；最终执行仓库规定的完整验证命令。

## 范围之外

- 不改变更新下载、签名校验、部署和 rollback 流程。
- 不为当前 Shell 环境新增跨平台同步机制，也不定义新的任意环境变量持久化格式。
- 不拆分 Hub 与 Registry 的 guardian/service；完整 runtime 重启时 Registry 同步重启属于已接受行为。
- 不为 update-only Hub 增加新协议能力。
- 不修改 Registry Protocol 版本、HubState schema 的既有 section 结构或 Web 重连协议。
- 不新增独立的全局 Restart 菜单；动作只存在于 Hub 标题行版本操作区域。
