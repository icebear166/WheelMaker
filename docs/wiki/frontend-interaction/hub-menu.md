> 摘要：本页维护 Chat 头部 hub 菜单作为 per-hub 操作中心的行模型、展开与直接动作语义、行内互斥、面板级全局操作条，以及桌面浮窗 / 移动端全屏页的双形态约定。

# Hub 菜单

hub 菜单是唯一的 per-hub 操作中心：所有针对单个 hub 的配置与维护动作都收口在这里，不再设置平行的 per-hub 设置页。桌面端是锚定在 Chat 头部摘要按钮下的浮窗（`chat-hub-popover`），移动端是带返回栏的全屏页（`chat-hub-page`），两者共享同一个 `ChatHubPanel` 渲染，结构分支由 JS 的 `isWide` 驱动而非 CSS 断点。

## 面板结构

每个 hub 是一个 `chat-hub-tree`：hub 行（名称 + 紧邻名称的颜色点 + 手风琴 chevron，展开状态持久化）下方是三行操作区，面板底部是一条不属于任何 hub 的全局 footer。名称区域展开 hub，颜色点独立打开调色板。

```
hub-a ● ⌄
 ⚙ Settings      V2 ✓                                   ⌄
 ⛭ Hub        [v1.2 ↻]      [NPM ·2 ▾]      [Skills ·12 ▾]
 ▤ Projects              [Visibility 11/12 ▾] [Scan 1/2 ▾]
 ──────────────────────────────────────────────────────
 Latest v1.3                              [Update all hubs]
```

- **Settings 行**：唯一的整行手风琴（无复合按钮）。展开内容是 Flicker Bridge 段（Off/V1/V2 三段控件 = 持久 enable + 模式，右侧 Stop/Start 运行时 toggle）和紧凑单行 API key 编辑器（状态对勾/叉图标 + 行内密码输入 + Set/Replace + 图标 Clear）。收缩摘要显示 Flicker `V1`/`V2` + 绿勾或 `Off` + 灰叉。
- **Hub 行**：三个按钮等宽，版本按钮是直接动作，NPM 与 Skills 是整按钮展开入口：
  - `v1.2 ↻`：显示当前版本号与状态图标，无展开行为；有更新时执行 Update，已是最新版时执行 Restart，走 wheelmakerUpdate confirm 流程。
  - `NPM ·n ▾`：整按钮只展开逐包列表。批量 `Update all` 位于 detail 顶部，标题按钮不执行更新。
  - `Skills ·n ▾`：整按钮只展开当前 hub 的全局 Skills，不显示 Project Skills。批量 `Update all` 位于 detail 顶部，标题按钮不执行扫描或更新。
- **Projects 行**：两个等宽展开按钮。`Visibility x/y ▾` 展开逐项目可见性勾选，不提供 Show All / Hide All；`Scan x/y ▾` 展开逐项目 index 状态与单项目 scan，批量 `Scan all` 位于 detail 顶部。
- **footer**：Latest 稳定版本号 + `Update all hubs`（现有 confirm 与 pending 语义）。

## 按钮语义与展开互斥

Hub / Projects 行不使用 split button。带 chevron 的按钮整个点击区域都只负责展开或收起；只有无 chevron 的版本按钮执行直接动作。批量更新、批量扫描等动作放在展开 detail 内，避免标题区同时承担导航与动作语义。

detail 渲染在所属行下方。Settings 独立展开；Hub 行的 NPM / Skills 互斥；Projects 行的 Visibility / Scan 互斥。三个行组之间可同时展开，状态不持久化、菜单关闭即重置。

## 逐 npm 包行

detail 顶部显示 `Update all`。每行采用固定网格：包名、`installed → latest`、Install/Update 图标槽、Uninstall 图标槽。未安装时第一槽为 Install；有更新时为 Update；已是最新版时保留禁用槽，保证整列对齐。第二槽始终是 Uninstall，不可卸载时禁用。**不提供 reinstall**。所有动作走现有 npmPackage confirm 流程。

## Hub 全局 Skills

Skills detail 复用现有 skill management 数据与动作，只读取当前 hub 的 `hubSkills.skills`。顶部提供 hub 范围的 `Update all`；逐项行显示名称与弱化的分类/来源信息，右侧使用固定对齐的 Update 与 Uninstall 图标槽。外部或不可管理 Skill 可显示但禁用动作；错误显示在对应动作或行附近。该入口不展示 Project Skills，也不引入新的 Registry protocol。

## 密度与响应式

detail 与项目列表相对所属行使用 12–16px 的紧凑缩进，不叠加 hub 标题颜色控件占用的宽度。桌面端列表保持单行网格和统一图标点击区；移动端允许版本或元信息换到名称下方，但操作图标列保持固定在右侧。版本和计数使用等宽数字，图标按钮都有可访问名称。

## 配置与降级

hub 级配置走 `hub.config.get/update`（写 hub 本地 `db/hub-config.json`，secret 永不回显；config.json `api_keys.*` 作为回退并 overlay 到 configured 标记）。老 hub / 老 registry 不支持时该行显示降级文案，其余功能不受影响。更新类轮询在菜单打开期间通过 `updateSurfaceActiveRef` 保活（不再只绑 Update 设置视图）。
