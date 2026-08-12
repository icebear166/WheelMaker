> 摘要：本页维护 WheelMaker 图标菜单在浏览器、APK 与 EXE 中的统一项目、平台差异和页面入口约定。

# WheelMaker App Menu

WheelMaker 图标是跨端一致的应用级菜单入口，不直接打开 Settings。菜单使用等高单行、左侧图标与名称、右侧状态的行模型，并支持 Escape、点击外部关闭、方向键导航和关闭后焦点归还。

## 菜单结构

主项目顺序固定：

1. `Settings`：关闭菜单并打开 Settings 首页。
2. `Theme`：在应用整体 Light/Dark 间立即切换；右侧文字和图标显示当前主题。
3. `Port Relay`：关闭菜单并打开独立 Port Relay 页面（radioTower 图标），不属于 Settings。
4. `Update`：只在 APK/EXE 原生客户端显示。

主项目后使用分隔线。所有端都显示 `Release publishing`，它打开独立发布页面，不属于 Settings；页面返回后回到 Chat。支持 Desktop 本地开发能力时，`Dev Mode` 紧随其后。

浏览器/PWA 不显示 Update，也不把 Update 指向 Hub/Web 更新页。其菜单结构为 Settings、Theme、Port Relay、分隔线、Release Publishing。

## 客户端更新

APK/EXE 每次打开菜单都执行一次无缓存更新检查。Update 右侧状态约定：

- 有更新：`当前版本 → 最新版本`，显示更新红点，可以点击。
- 已是最新版：`当前版本 · Current`，不可点击。
- 检查中：不可点击。
- 检查失败：显示 `Retry`，点击只重新检查。
- 旧 Desktop 缺少版本元数据：`Unknown → 最新版本`，不把最新版本伪装成本地版本，仍可更新。

点击可用更新只触发一次现有平台更新流程：Android 下载、校验并打开系统安装器；Desktop 启动可信更新脚本并退出当前窗口。

## Settings 边界

PC 宽屏 Settings 首页在现有内容之前增加 `Application` 分组，其中 `Keyboard Shortcuts` 打开应用内快捷键管理详情；该入口与受管理快捷键在窄屏/移动布局均不出现。PC 后续分组仍为 `Chat`（对话行为 + 语音输入/TTS）、`Code`（代码展示）、`State`（连接状态、设备、数据库、本地缓存与登出）、`Debug`（诊断开关与日志）。移动端继续只有这四个分组。除 PC 专属 Keyboard Shortcuts 外，子详情页仍只有 Status、Devices、Database、Logs，不再有 peer 页与底部 shortcut bar。

Port Relay 是一级菜单入口与独立页面，不出现在 Settings 内。

以下应用级入口不再出现在 Settings：

- Android APK 更新卡片。
- `Appearance → Dark Mode`；Appearance 没有其他项目时整个分区消失。
- `Debug → Release publishing` 及其 Settings detail 类型。

`Code → Code Theme` 仍属于 Settings，因为它控制代码块配色而非应用整体明暗主题。Hub/Web 与 Agent package 更新不在 Settings 内，由 Chat 头部 Hub 菜单的 per-hub 操作面板承担。

设计来源：

- [`spec-unified-app-menu.md`](../../scope/2026-07-30-unified-app-menu.md)
