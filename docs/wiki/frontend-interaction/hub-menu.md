> 摘要：本页维护 Chat 头部 hub 菜单作为 per-hub 操作中心的行模型、展开与直接动作语义、行内互斥、面板级全局操作条，以及桌面浮窗 / 移动端全屏页的双形态约定。

# Hub 菜单

hub 菜单是唯一的 per-hub 操作中心：所有针对单个 hub 的配置与维护动作都收口在这里，不再设置平行的 per-hub 设置页。桌面端是锚定在 Chat 头部摘要按钮下的浮窗（`chat-hub-popover`），移动端是带返回栏的全屏页（`chat-hub-page`），两者共享同一份 panel 内容，结构分支由 JS 的 `isWide` 驱动而非 CSS 断点。

## 面板结构

每个 hub 是一个 `chat-hub-tree`：hub 行按颜色点、名称、版本直接动作、手风琴 chevron 排列，展开状态持久化；其下是三行操作区，面板底部是一条不属于任何 hub 的全局 footer。hub 行除独立的颜色和版本按钮外整行可展开，颜色点独立打开调色板。

```
● hub-a                                  [v1.2 ↻] ⌄
 ⚙ Settings      V2 ✓                                   ⌄
 ⛭ Hub                         [NPM ·2 ▾]      [Skills ·12 ▾]
 ▤ Projects       [◉ 11/12 ▾] [Scan 1/2 ▾]   [Skills ·24 ▾]
 ──────────────────────────────────────────────────────
 Latest v1.3                              [Update all hubs]
```

- **Settings 行**：唯一的整行手风琴（无复合按钮）。展开内容是 Flicker Bridge 段（Off/V1/V2 是唯一生命周期与模式控件）和紧凑单行 API key 编辑器（状态对勾/叉图标 + 行内密码输入 + Set/Replace + 图标 Clear）。收缩摘要显示 Flicker `V1`/`V2` + 绿勾或 `Off` + 灰叉。
- **hub 标题行**：颜色在名称前；版本按钮显示当前版本号与状态图标，无展开行为，有更新时执行 Update，已是最新版时执行 Restart，走 wheelmakerUpdate confirm 流程；chevron 位于行末。
- **Hub 行**：NPM 与 Skills 是等宽的整按钮展开入口：
  - `NPM ·n ▾`：整按钮只展开逐包列表。批量 `Update all` 位于 detail 顶部，标题按钮不执行更新。
  - `Skills ·n ▾`：整按钮只展开当前 hub 的全局 Skills，不显示 Project Skills。批量 `Update all` 位于 detail 顶部，标题按钮不执行扫描或更新。
- **Projects 行**：三个等宽展开按钮。`◉ x/y ▾` 用眼睛图标表达 Visibility，展开逐项目可见性勾选，不提供 Show All / Hide All；`Scan x/y ▾` 展开逐项目 index 状态与单项目 scan，批量 `Scan all` 位于 detail 顶部；`Skills ·n ▾` 展开 Project Skills，数量是所有 Projects 的 Skill 总数。
- **footer**：Latest 稳定版本号 + `Update all hubs`（现有 confirm 与 pending 语义）。

## 按钮语义与展开互斥

Hub / Projects 行不使用 split button。带 chevron 的按钮整个点击区域都只负责展开或收起；只有无 chevron 的版本按钮执行直接动作。批量更新、批量扫描等动作放在展开 detail 内，避免标题区同时承担导航与动作语义。

detail 渲染在所属行下方。Settings 独立展开；Hub 行的 NPM / Skills 互斥；Projects 行的 Visibility / Scan / Skills 互斥。三个行组之间可同时展开；当前应用会话内关闭并重新打开菜单时保留展开状态。功能按钮只执行自己的动作，不顺带关闭 Hub 面板。

## 逐 npm 包行

detail 顶部显示 `Update all`。每行采用固定网格：包名、`installed → latest`、Install/Update 图标槽、Uninstall 图标槽。未安装时第一槽为 Install；有更新时为 Update；已是最新版时保留禁用槽，保证整列对齐。第二槽始终是 Uninstall，不可卸载时禁用。**不提供 reinstall**。所有动作走现有 npmPackage confirm 流程。

## Hub 全局 Skills

Skills detail 复用现有 skill management 数据与动作，只读取当前 hub 的 `hubSkills.skills`。工具栏提供 Add Skill、选择模式和带文字的 hub 范围 `Update all`；后者只更新 Hub 全局 Skills，明确排除 Project Skills。现有 snapshot 不提供远端更新可用性，因此存在 managed Skill 时允许执行 Update all，不存在时禁用并显示 `No managed skills`，不伪造 `Up to date`。列表不分组，逐项行只显示名称和必要状态，右侧使用固定对齐的 Detail、Update、Uninstall 图标槽；名称本身不导航。外部或不可管理 Skill 使用链接或锁定图标标识，可查看详情但禁用更新与卸载。

批量卸载只在显式选择模式中显示复选框。无常驻手动刷新按钮：打开 detail 和完成安装、更新、卸载后自动同步，失败时提供重试。单项 loading 原位替换操作图标，全量或批量 loading 原位替换工具栏按钮；成功使用短暂 Toast，失败使用带重试的常驻 Toast，任何状态变化都不改变列表行高或位置。

## Project Skills

Project Skills 只存在于 Projects 行，不混入 Hub Skills。展开后顶部是固定 Project 选择器，默认选择第一个在线 Project，离线 Project 不显示；选择器选项带各自 Skill 数量。下方复用 Hub Skills 的扁平列表和管理动作，不为每个 Project 创建向下展开的分组。Project 范围的 Add Skill、逐项动作、批量卸载和 `Update all` 都只作用于当前选择的 Project。

Hub 与 Project 的 Add Skill 均复用完整安装流程：source 输入、候选 Skill 选择/全选和确认。Marketplace 外链只放在安装界面，不占主列表工具栏。

## Skill 详情与安装 surface

详情图标打开现有 Skill detail，包括 source metadata、管理状态、`SKILL.md` 和 supporting files。桌面端的详情与安装使用 Hub 浮窗右侧的大型伴随卡片，不压缩主列表，并且同一时间只显示一个；移动端进入带返回栏的独立页面，支持系统返回键和 Android 返回手势。返回或关闭伴随 surface 不意外关闭 Hub 面板。

独立 Skills 设置页在迁移期继续保留；待 Hub 菜单入口验证稳定后再通过独立变更移除。

## 密度与响应式

detail 与项目列表相对所属行使用 12–16px 的紧凑缩进，不叠加 hub 标题颜色控件占用的宽度。桌面端列表保持单行网格、稳定行高和统一图标点击区；移动端允许版本或元信息换到名称下方，但操作图标列保持固定在右侧。版本和计数使用等宽数字，图标按钮都有可访问名称。

## 配置与降级

hub 级配置走 `hub.config.get/update`（写 hub 本地 `db/hub-config.json`，secret 永不回显；config.json `api_keys.*` 作为回退并 overlay 到 configured 标记）。老 hub / 老 registry 不支持时该行显示降级文案，其余功能不受影响。更新类轮询在菜单打开期间通过 `updateSurfaceActiveRef` 保活（不再只绑 Update 设置视图）。
