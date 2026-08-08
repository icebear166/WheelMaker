> 摘要：本页维护 Chat 头部 Hub 菜单作为 per-hub 操作中心的统一行模型、展开与直接动作语义、MCP 预留入口，以及桌面浮窗 / 移动端全屏宿主共享内部布局的约定。

# Hub 菜单

来源：

- [Hub Menu Unified Layout spec](../../scope/2026-07-30-hub-menu-unified-layout.md)
- [Hub State Unification spec](../../scope/2026-07-31-hub-state-unification.md)

Hub 菜单是唯一的 per-hub 操作中心：所有针对单个 Hub 的配置与维护动作都收口在这里，不再设置平行的 per-hub 设置页。桌面端是锚定在 Chat 头部摘要按钮下的浮窗（`chat-hub-popover`），移动端是带返回栏的全屏宿主（`chat-hub-page`）。宿主形式不同，但内部结构、尺寸和交互保持一致。

## 面板结构

每个 Hub 是一个完整视觉分组：标题行按颜色点、名称、版本直接动作、手风琴 chevron 排列；展开后依次显示 Settings、Global、Projects。移除贯穿内容的彩色树线，Hub 颜色只保留在名称前的颜色点。标题行除独立的颜色和版本按钮外整行可展开，chevron 位于最右侧。

```
● hub-a                                  v1.2  ↓  ↻  ⌄
  ⚙ Settings                                      ● V2  ›
  ⛭ Global                    [Package 2] [MCP 0] [Skills 12]
  ▤ Projects                [Visible 11] [Scan 2] [Skills 24]
  ┌ Expanded detail panel                               ┐
  └─────────────────────────────────────────────────────┘

Latest v1.3                                  Update all hubs
```

- **Settings 行**：整行手风琴。展开内容是 Flicker Bridge 段（Off/V1/V2 是唯一生命周期与模式控件）和紧凑单行 API key 编辑器（状态图标 + 行内密码输入 + Set/Replace + Clear）。收缩摘要显示 Flicker `V1`/`V2` 或 `Off`，使用颜色点表达状态。
- **Hub 标题行**：颜色点在名称前；版本号是只读状态，右侧提供独立的 Update 与 Restart 图标动作，无展开行为。已安装的正常 Hub 有新版本时同时显示两个动作；已是最新版或本地版本较新时只显示 Restart；未安装或 `update_only` Hub 只显示 Update。Update 使用 `cloudDownload`，Restart 使用 `refreshCw`，存在新版本时红色提示点附着在 Update 动作上。两个动作都走 `wheelmakerUpdate` confirm 流程，pending 时动作组禁用。版本动作默认透明，仅 hover/focus/active 时出现背景。
- **Global 行**：固定三个等宽入口，顺序为 NPM、MCP、Skills。入口都采用“图标 + 数量”，不显示文字标签和 disclosure chevron：
  - NPM 使用 package 图标，数量沿用现有统计；存在可更新包时显示不占布局空间的红色提示点。展开逐包列表，批量 `Update all` 位于 detail 工具栏。
  - MCP 使用官方 MCP 图标，当前数量固定为 `0`；点击展开本地空态 `MCP servers` / `No MCP servers configured.`，不发起网络、API 或协议调用。
  - Skills 使用 sparkles 图标，只展示当前 Hub 的全局 Skills，不混入 Project Skills；批量 `Update all` 位于 detail 工具栏且只更新 Hub 全局 Skills。
- **Projects 行**：固定三个等宽入口，顺序为 Visibility、Scan、Skills，同样只显示图标和数量：
  - Visibility 使用 eye 图标，数量沿用当前可见/总数语义；展开逐项目可见性勾选，不提供 Show All / Hide All。
  - Scan 使用 scan-line 图标，数量沿用当前已索引/总数语义；展开逐项目 index 状态与单项目 scan，批量 `Scan all` 位于 detail 工具栏。
  - Skills 使用与 Global Skills 相同的 sparkles 图标，数量是所有 Projects 的 Skill 总数。
- **footer**：Latest 稳定版本号 + `Update all hubs`（现有 confirm 与 pending 语义）。footer 位于所有 Hub 后的正常文档流，不 sticky/fixed。

## 数据读取与更新触发

Hub 菜单只读取统一 HubStore，不为 WheelMaker Update、NPM、Skills、File Index 或 Flicker 建立独立 Hub 缓存。菜单触发遵循可见层级：

| UI 边沿 | 行为 |
| --- | --- |
| 打开 Hub 菜单 | 对显示中的 Hub refresh `wheelmakerUpdate`，用于标题行版本 |
| 展开某个 Hub | 对该 Hub refresh `flickerBridge`、`agentPackages`、`skills`、`fileIndex` |
| 展开 Settings | 独立读取 HubConfig，不重复 refresh HubState |
| 展开 NPM、Global Skills、Project Skills、Scan | 只消费展开 Hub 时取得的数据，不重复 refresh |
| 展开 Visibility 或 MCP | 不触发 HubState |
| 打开 Skill Detail / Add Skill | 只做详情或候选查询，不覆盖或 refresh `skills` |

请求只能由 closed→open 或 collapsed→expanded 边沿触发，不能因 render、effect 依赖变化或 detail 切换重复发送。同一 Section 已 queued/updating 时复用既有任务。关闭菜单、收起 Hub 或关闭 companion surface 不取消 Hub 已接受的 Update 或 Restart。

Composer Slash Menu 和聊天文件 `@mention` 不因打开而刷新 HubState：前者读取当前 Project/Agent 的 effective Skills，后者查询既有 File Index。Limits Monitor 是独立常驻数据面；它继续消费 Usage Service 的启动扫描和 10 分钟周期 `tokenStats` 更新，打开 Monitor 本身不触发刷新。

## 按钮语义与展开互斥

Global / Projects 的入口整个点击区域只负责展开或收起；只有 Hub 标题里的版本动作执行直接维护操作。Update 与 Restart 是两个独立图标按钮：Update 负责下载、校验、部署并重启，Restart 只重启托管 runtime 并重新加载运行环境。批量更新、批量扫描等动作放在展开 detail 内。三个入口使用轻分隔线组成一体化三列，不做三个厚重的输入框式圆角按钮；展开态通过背景变化表达。

detail 渲染为 Hub 分组内全宽、轻缩进的单个面板。Settings 独立展开；Global 的 NPM / MCP / Skills 互斥；Projects 的 Visibility / Scan / Skills 互斥。三个行组之间可同时展开；当前应用会话内关闭并重新打开菜单时保留展开状态。功能按钮只执行自己的动作，不顺带关闭 Hub 面板。

## 逐 npm 包行

detail 工具栏显示 `NPM packages` 与 `Update all`。每行是 32px 单行固定网格：包名、版本状态、Install/Update 图标槽、Uninstall 图标槽。包名过长时省略并保留 `title`/可访问名称。

- 已安装且为最新版：只显示一个当前版本号；Update 槽留空，仅显示 Uninstall。
- 有更新：显示 `current → target`；显示 Update 与 Uninstall。
- 未安装：显示 `Not installed · target`；只显示 Install，Uninstall 槽留空。

不可用操作不渲染图标，但固定槽位仍保留以保证整列对齐。**不提供 reinstall**。所有动作走现有 npmPackage confirm 流程。

MyFlicker 的 `@myflicker/cli` 仅在 Hub 首次 NPM 扫描时能从 `https://npm.corp.kuaishou.com` 读取到匹配的有效包元数据时显示；源不可达、返回非包元数据或缺少 latest 版本时整行省略。该包的 latest 查询、安装和更新命令只在对应的单次 npm 调用上附加 `--registry=https://npm.corp.kuaishou.com`，不修改其他包或用户的 npm 配置。

## Hub 全局 Skills

Skills detail 只读取当前 Hub 的 HubState `skills.hubInventory`。工具栏提供 Add Skill、选择模式和带文字的 Hub 范围 `Update all`；后者只更新 Hub 全局 Skills，明确排除 Project Skills。snapshot 不提供远端更新可用性，因此存在 managed Skill 时允许执行 Update all，不存在时禁用并显示 `No managed skills`，不伪造 `Up to date`。列表不分组，逐项行使用 32px 单行网格，只显示名称和必要状态；点击名称打开详情，右侧保留固定对齐的 Update、Uninstall 图标槽。外部或不可管理 Skill 在名称后直接显示 External 标识，可查看详情但禁用更新与卸载。

Skill 行的 `Codex` / `Claude` 胶囊只表示该 Skill 是否实际存在于 `.agents/skills` / `.claude/skills`；它不表示 npm 包是否安装，也不表示兼容性或缺失状态。内容不一致时只显示 `content differs` 非阻塞诊断，不自动复制或覆盖目录。

批量卸载只在显式选择模式中显示复选框。无常驻手动刷新按钮：打开 detail 和完成安装、更新、卸载后自动同步，失败时提供重试。单项 loading 原位替换操作图标，全量或批量 loading 原位替换工具栏按钮；成功使用短暂 Toast，失败使用带重试的常驻 Toast，任何状态变化都不改变列表行高或位置。

## Project Skills

Project Skills 只存在于 Projects 行，不混入 Hub Skills。展开后顶部是单个全宽 Project 选择器，收起时显示当前 Project 的完整名称和 Skill 数量；打开后显示当前快照中的全部 Project，选择即切换并关闭列表。默认优先选择当前 Chat Project，否则选择第一个 Project。下方读取 HubState `skills.effectiveSkills[projectId]`，复用 Hub Skills 的 32px 单行扁平列表和管理动作，不为每个 Project 创建向下展开的分组。Project 范围的 Add Skill、逐项动作、批量卸载和 `Update all` 都只作用于当前选择的 Project。

Hub 与 Project 的 Add Skill 均复用完整安装流程：source 输入、候选 Skill 选择/全选和确认。Marketplace 外链只放在安装界面，不占主列表工具栏。

Project Snapshot 不再提供 `agentProfiles`。Hub 菜单和 Composer 使用同一个 `skills` Section revision；Hub/Project Skill 更新后，服务端原子提交完整 Section，两个界面同时切换。Composer 按当前 Agent 的实际可见 inventory 生成提示；目录不一致时在 Slash Menu 中显示非阻塞说明。

## Skill 详情与安装 surface

点击 Skill 名称打开现有 Skill detail，包括 source metadata、管理状态、`SKILL.md` 和 supporting files。桌面端的详情与安装使用 Hub 浮窗右侧的大型伴随卡片，不压缩主列表，并且同一时间只显示一个；移动端进入带返回栏的独立页面，支持系统返回键和 Android 返回手势。返回或关闭伴随 surface 不意外关闭 Hub 面板。

Hub 菜单是唯一的 Skills 管理入口：Hub 全局 Skills 位于各 Hub 的 Global 行，Project Skills 位于 Projects 行和当前选择的 Project 下。独立 Skills 设置页及其跨 Hub 扫描、Project 平铺、分类分组和 Hub+Project 联合更新能力均已移除；共享命令、安装内容和详情内容仍由 Hub 桌面/移动 companion surface 复用。

## 密度与响应式

桌面与移动端共用同一组内部尺寸：Hub / Settings / Global / Projects 主行和三列入口高 40px，detail 工具栏高 36px，NPM / Skills / Visibility / Scan 明细行高 32px。detail 与项目列表仅使用轻量缩进，不叠加颜色控件宽度。所有列表保持单行网格、稳定行高和固定操作槽；版本和计数使用等宽数字，图标按钮都有可访问名称。

移动端全屏宿主的页面栏只显示返回按钮，不显示并列关闭按钮。返回顺序为 Skills 子页面 → Hubs → 退出 Hub 菜单；Android 系统返回键和返回手势遵循同一顺序。除宿主导航外，移动端不为 NPM、MCP、Visibility、Scan 等展开内容创建独立子页。

## 配置与降级

Hub 级配置走 `hub.config.get/update`，写 Hub 本地 `db/hub-config.json`，secret 永不回显。HubConfig 是持久化配置，HubState 是运行态；两者可以由统一 HubStore 组织，但不得互相复制为第二份权威。

Registry Protocol 使用 2.7 并在当前 HubState schema 内硬切，Hub 与 Web 配套发布，不保留旧 HubState 或 `agentProfiles` 降级分支。2.6 Hub 只保留 `update_only` 升级通道；菜单不通过轮询维持 WheelMaker Update、NPM、Skills、File Index 或 Flicker，异步 Action 完成后由 Hub 主动发布对应完整 Section。
