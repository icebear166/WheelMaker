> 由 scope skill 于 2026-07-23 生成

# 更新设置页重构

## 目标

Workspace 设置里的「更新」详情页（`UpdateSettingsDetail`）目前把多类更新（App 自身、Hub runtime、NPM agent 包、项目文件索引）连同统计、历史信息堆在同一屏，存在明显的冗余：同一 hub 的 release 状态被渲染两次、当前版本号被渲染两次、顶部汇总计数与每个 hub 的明细重复展示同一组数字，再加上 Release history、Publish 流水线状态、SHA 摘要等对普通用户价值低的字段，整页信息密度过高、显得混乱。

本次在**保留全部更新功能**的前提下，通过去重、折叠低价值字段、统一视觉语言，把页面收敛为「顶部全局动作 + 每个 hub 一张紧凑卡」的结构，让 hub 卡默认折叠、高度明显降低。

## 决策

- **力度**：大重构。去纯重复 + 把低价值字段折叠/移到 tooltip + 重构 hub 卡三段布局。
- **顶部瘦身**：去掉汇总条四计数（Hubs / Release updates / NPM updates / Indexed projects）+ 扫描指示灯、Release history 卡、Stable release 卡的 published 时间与 publish 流水线状态。顶部仅保留「最新版本号 + Update All Hubs」一行。
- **hub 当前版本**：常驻显示当前版本号；状态用 icon 表达，不再用文字标签。
- **统一 icon 状态映射**（hub 行与 Android 卡共用）：有升级 `codicon-arrow-up`（强调色）/ 已是最新 `codicon-check`（绿）/ 检查中 `codicon-loading` 旋转 / 失败 `codicon-error`。
- **hub 行按钮**：有升级显示 `[Update Hub]`；已是最新不显示按钮（icon 已说明）；检查中 loading 禁用；失败显示 `[Retry]`。
- **NPM 取消勾选/批量选**：折叠标题旁放 `[Update NPM]`（只更新有升级的已安装包）。展开后每行一个包：未安装 → `[Install]`、已安装且有更新 → `[Update]`（带版本箭头）、已安装且最新 → 主区灰显「Up to date」+ 行末低调卸载 icon 按钮（`codicon-trash`，保留卸载入口）。npm 数据未就绪时更新类按钮禁用。
- **NPM 行精简**：去掉 agentTags、status 文字标签、常驻技术包名（挪 `title` tooltip）；版本号仅在有更新时显示「当前 → 最新」。
- **Projects 行精简**：折叠标题旁放 `[Scan All]`；展开后每行 = 项目名 + 状态 icon + `[Scan]`；去掉 path、fileCount、indexedAt。
- **Android 卡全砍 meta**：去掉 subtitle、状态文字、versionCode、SHA 摘要、Published 时间、APK 大小、Install 权限格，收敛为「Android APK + 当前→最新版本 + icon + `[Download and Install]` + `[Check]`」一行；无安装权限时 `[Download and Install]` 禁用并带 tooltip。
- **功能全保留**：三类更新能力，以及 Update All Hubs / Update NPM / Scan All / 单包 install·update·uninstall / Android 下载安装 + Check + Retry，行为均与现状一致。

## 架构

组件边界不变：仍是 `UpdateSettingsDetail` 接收父组件传入的 props 做纯展示渲染。本次改动集中在 JSX 布局与展示逻辑：

- 删除顶部三块（汇总条、Release history、Stable release 的多数字段），保留版本号 + Update All Hubs。
- hub 卡内去除重复的状态标签与版本号渲染；引入统一「状态 → icon」渲染（由现有 `deriveWheelMakerHubStatus` 等派生函数 + 新增的 icon 映射辅助得到）。
- NPM / Projects 折叠区精简每行字段、按状态收敛按钮逻辑。
- Android 卡从 4 格 meta 收敛为单行。
- 配套调整/清理相关 CSS（旧 meta-grid / history / summary 类）。

`agentPackageUpdateView.ts` 中现有的 `deriveWheelMakerHubStatus`、`deriveNpmPackageUpdateTargets`、`wheelMakerUpdateStatusLabel` 等保留语义不变；仅可能新增一个 status → codicon 的映射辅助函数。父组件传入但本次不再使用的 prop 可保留不清理，以收紧改动范围。

## 验收标准

- 顶部仅渲染「最新版本号 + Update All Hubs」；汇总条四计数、扫描灯、Release history 卡、Stable release 的 published 时间 / publish 状态不再渲染。
- 每个 hub 卡默认只显示：hubId + 当前版本号 + 状态 icon + `[Update Hub]`，以及折叠态的 NPM、Projects 两行；卡片默认高度明显低于现状。
- 同一 hub 的 release 状态不再出现两次；当前版本号不再重复渲染。
- NPM 折叠展开后每行只含：包显示名、（有更新时的）版本箭头、单一主按钮（Install / Update / 灰显「Up to date」）+ 已安装包行末的卸载 icon 按钮；不再渲染 agentTags、status 文字标签、常驻技术包名。
- npm 数据未就绪（loading / error）时，`[Update NPM]` 与各行 `[更新]` 按钮禁用。
- Projects 折叠展开后每行只含：项目名、状态 icon、`[Scan]`；不再渲染 path / fileCount / indexedAt。
- Android 卡收敛为单行；无安装权限时 `[Download and Install]` 禁用并带 tooltip。
- 全部更新功能（Update All Hubs / Update NPM / Scan All / 单包 install·update·uninstall、Android 下载安装、Check、Retry）行为与现状一致，仅展示层变化。
- 涉及的旧 CSS 类相应清理或替换，无大块死样式残留。

失败场景预期：

- 任意一类检查失败：对应 icon 显示 `codicon-error`，按钮变 `[Retry]`；不阻塞其它子区。
- npm / project 数据加载中：icon 显示旋转 loading，操作按钮禁用。
- 无 hub / 无包 / 无项目：对应折叠区显示空态文案，不报错。

### 测试

切入点：`UpdateSettingsDetail` 是 props 驱动的纯展示组件。优先补/改组件级渲染测试（合并到现有 settings 相关测试文件，不轻易新增 test 文件）：

- 测：顶部只渲染版本号 + Update All Hubs，不渲染汇总条 / Release history。
- 测：hub 卡默认折叠、状态 icon 在四种状态下映射正确。
- 测：NPM 行三态按钮（更新 / 灰显 / 安装）与禁用条件（loading 时禁用）。
- 测：Projects 行字段精简（无 path / fileCount / indexedAt）。
- 测：Android 卡单行渲染、无权限时按钮禁用。

不测：真实网络请求与真实更新流程（由 `agentPackageUpdateView` 的纯函数测试覆盖）。

## 范围之外

- 不改任何更新 / 安装 / 扫描的后端逻辑与数据派生函数的语义（仅可能新增 icon 映射辅助）。
- 不改 protocol version。
- 不改 Desktop 标题栏自更新流程（见 `docs/wiki/release-and-build/desktop-self-update.md`）。
- 不重构父组件（`SettingsSurface` / `SettingsBundle`）的数据获取，不强制清理未用 prop。
- 不新增 wiki 页面（本次 wiki 不更新）。
