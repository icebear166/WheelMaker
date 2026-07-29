> 由 scope skill 于 2026-07-29 生成

# Hub 菜单统一（per-hub 操作中心）

## 目标

hub 下拉已重构为 per-hub 操作面板（Settings / Hub Ops / Projects 三行手风琴），但 Update 设置页仍平行存在：它与面板功能大量重叠，且承载更深的操作（逐 npm 包、逐项目 index 状态）。本次把 per-hub 操作全部收口到 hub 菜单，行模型升级为"复合按钮行"（主点击 = 动作，▾ = 展开逐项 detail），并删除 Update 设置页。最终形态：hub 菜单 = 唯一的 per-hub 操作中心。

## 决策

1. **统一终态**：per-hub 功能全部进 hub 菜单；Update 设置页删除。全局项另行安置（见架构）。
2. **行解剖**：`Hub Ops` 改名 `Hub`；每个操作行 = 摘要区 + 复合按钮组。复合按钮（split button）左半主点击执行动作，右半 `▾` 展开该动作的 detail；按钮上直接带信息（计数、状态）。`Update` 是唯一的简单按钮（无 ▾）。
3. **展开互斥**：每个 hub 同时只开一个 detail（Settings 展开也算其一），复用现有 `expandedSections: Record<hubId, id | null>` 模型。
4. **版本号位置**：Latest 版本号**不**放 Update 按钮（空间不足）；与 `Update all hubs` 组成面板级 footer 行。Hub 行摘要区仍显示当前版本 + 可升级红点。
5. **逐 npm 包行**：每行两个按钮 —— `Update`（已安装且有更新）或 `Install`（未安装）二选一 + `Uninstall`；**不提供 reinstall**。
6. **可见性主点击**：全部显示 / 全部隐藏切换（本地偏好，无 confirm）。
7. **Skills ▾ 现阶段内容**：已索引 skill 计数 + 扫描状态/错误；完整 skills 管理（install/uninstall/detail）留在 Skills 设置页，将来再搬。

## 架构

```
● hub-a ⌄
 ⚙ Settings      V2 ✓                                   ⌄   （现状：Flicker 段 + key 行）
 ⛭ Hub        v1.2🔴  [Update]  [NPM ·2 ▾]  [Skills ·12 ▾]
 ▤ Projects             [👁 11/12 ▾]  [Scan 1/2 ▾]
 ──────────────────────────────────────────────────────
 Latest v1.3                              [Update all hubs]   （面板 footer，非 per-hub）
```

- **行模型**：Settings 行保留整行手风琴（无复合按钮）；Hub / Projects 行没有独立 chevron，摘要区不可点击，展开完全由按钮的 `▾` 触发。行不再是整行按钮。
- **detail 落点**：▾ 展开的 detail 渲染在该按钮所属行下方；detail id 集合 `'settings' | 'npm' | 'skills' | 'visibility' | 'scan'`，每 hub 互斥。
- **数据来源**：沿用 `updateHubCards` 聚合（`wheelMakerUpdateHubs` / `agentPackageHubs` / `projectIndexByHubId`）与各 pending map；`chatHubOpsByHubId` 扩展出 NPM 逐包列表、Skills 计数、Scan 计数等视图数据。
- **Update 设置页删除**：`UpdateSettingsDetail.tsx` 及其专用测试删除；settings 导航移除 `update` 入口；`settingsDetailView === 'update'` 的全部引用（含 `updateSurfaceActiveRef`、轮询门控、源码结构测试）同步清理；release history 死 props 一并移除。
- **Android APK 卡**：迁移到 Settings 根页（`SettingsRootContent`），仅 Android 客户端显示，交互不变。

## 流程

- 动作复用现有链路：`Update`/`Restart` → `requestWheelMakerUpdate` confirm；NPM 批量 → `requestAgentPackageHubUpdate` confirm；NPM 单包 → `requestAgentPackageAction` confirm（install/update/uninstall）；Skills → `handleScanSkills`；Scan all → `handleScanAllProjectIndexes`；单项目 scan → `handleScanProjectIndex`；可见性全显/全隐 → `toggleHubVisibility`（`hubProjectPreferences.ts:212`）写 `hiddenProjectIds`；Update all hubs → `requestWheelMakerUpdateAll` confirm。
- 轮询保活沿用 `updateSurfaceActiveRef`（hub 菜单打开期间轮询不停）。

## 验收标准

- Hub 行：摘要显示当前版本与红点；`Update`/`Restart` label 与现有 `hubStatusLabel` 语义一致；NPM 按钮带 outdated 计数（0 时主点击禁用）；Skills 按钮带已索引计数。
- 复合按钮：主点击不触发展开；▾ 只展开对应 detail；同 hub 再点其他 ▾ 时前一 detail 收起；Settings 展开与按钮 detail 互斥。
- NPM detail：逐包行显示名称、`installed → latest`、二选一主按钮（Update/Install）+ Uninstall；无 reinstall；动作均走现有 confirm。
- Scan detail：逐项目 index 状态 + 单项目 scan 按钮；Scan 主点击 = scan all。
- 👁 detail：逐项目可见性勾选（中性样式）；主点击全显/全隐。
- footer：显示 Latest 版本；`Update all hubs` 走现有 confirm 与 pending 语义。
- Update 设置页从导航消失；Android 上 APK 卡出现在 Settings 根页；无残留 `settingsDetailView === 'update'` 引用。
- 老 hub 降级行为不变；移动端全屏页同构渲染。

### 测试

- 扩展 `app/web/src/app/ChatHubMenu.test.tsx`：复合按钮信息渲染、主点击回调、▾ 互斥、NPM 逐包行按钮（Update/Install 二选一 + Uninstall、无 reinstall 文案）、footer 渲染。
- `UpdateSettingsDetail.tsx` 与其测试文件随组件删除；`web-agent-package-update-settings.test.ts` 等源码结构套件中针对 Update 页的断言删除或迁移到 ChatHubMenu / SettingsRootContent 断言。
- 不测：Skills 设置页（不动）、release publish（不动）。

## 范围之外

- Skills 完整管理（install/uninstall/detail/source）迁入 Skills ▾ —— 将来单独做。
- Release Publish 设置页。
- protocol version 变更（本次零协议改动）。
- 独立的 hub restart 服务端 action（仍复用 wheelmakerUpdate 通道）。
