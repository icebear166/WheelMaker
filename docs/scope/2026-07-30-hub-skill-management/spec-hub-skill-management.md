> 由 scope skill 于 2026-07-30 生成

# Hub Skill Management

## 目标

将独立 Skills 设置页中仍有价值的管理能力迁移到 Hub 菜单，同时维持现有紧凑层级：Hub 行只管理 Hub 全局 Skills，Project Skills 收口到 Projects 行。新入口需要支持查看详情、安装、更新、卸载、批量卸载和操作反馈，并在桌面浮窗与移动端全屏页中保持一致语义，不扩大现有 Registry protocol。

## 决策

- Hub 行的 `Skills · n` 只展开当前 Hub 的全局 Skills，不显示 Project Skills。
- Projects 行使用三个等宽展开入口：`[眼睛 x/y] [Scan x/y] [Skills · n]`。Visibility 使用眼睛图标缩短标签；Skills 放在最后，与 Hub 行对应。
- Projects 的 `Skills · n` 使用所有 Projects 的 Skill 总数；展开后的 Project 选择器显示每个可选 Project 的数量。
- Project Skills 不按 Project 向下堆叠。detail 顶部固定 Project 选择器，下方只显示所选 Project 的扁平 Skill 列表。
- Project 选择器默认选择第一个 Project；离线 Project 不进入选择器。没有在线 Project 时显示空状态。
- Hub 与 Project 的 Skill 列表复用相同行模型。行内仅显示名称和必要状态，不显示 category、agents 或其他低价值 detail 文本。
- Skill 名称不负责导航。右侧固定对齐详情、更新、卸载三个图标槽；不可用动作保留对齐槽并进入禁用态。
- 外部托管 Skill 使用紧凑的链接或锁定图标标识，允许查看详情，但禁止更新和卸载。
- Hub Skills 的 `Update all` 只更新 Hub 全局 Skills，绝不包含 Project Skills；Project Skills 的 `Update all` 只更新当前选择的 Project。
- `Update all` 使用带文字的醒目按钮。现有接口不提供远端更新可用性，因此只按管理能力判断：存在 managed Skill 时允许执行；不存在 managed Skill 时禁用并显示 `No managed skills`。
- Hub Skills 与 Project Skills 的工具栏都提供 `+ Add Skill`。目标自动绑定当前 Hub 或当前所选 Project。
- Marketplace 入口只出现在 Add Skill 安装界面，不占用主列表工具栏。
- 批量卸载通过工具栏的选择图标进入独立选择模式。复选框只在选择模式出现，并显示已选数量、取消和卸载。
- 不提供常驻手动刷新按钮。展开 Skills、安装、更新或卸载完成后自动重新读取状态；读取失败时提供重试。
- 操作反馈不得改变列表行高或推动列表位置：单项操作由原按钮位置显示 loading，全量或批量操作由原工具栏按钮位置显示 loading；成功使用短暂 Toast，失败使用带重试且不自动消失的 Toast。
- 桌面端详情和安装界面以 Hub 浮窗右侧的大卡片呈现，不压缩主列表；同一时间只显示一个伴随卡片。
- 移动端详情和安装使用独立页面，并支持页面返回按钮、系统返回键和 Android 返回手势。
- 点击详情、安装、更新、卸载、选择或其他功能按钮均不关闭 Hub 面板；仅沿用明确的关闭、返回或外部点击语义。
- 原独立 Skills 设置页本次保留作为过渡入口，待新入口稳定后再单独移除。

## 架构

`ChatHubPanel` 继续承担 Hub 菜单的基础层级和互斥展开状态，新增的 Skill 管理界面分成三个可复用单元：

1. **Skill scope toolbar**：承载数量、Add Skill、选择模式与当前作用域的 Update all。
2. **Skill list**：接收明确的 Hub 或 Project scope，渲染稳定行高的扁平列表，并调用现有详情、更新、卸载和批量卸载动作。
3. **Skill companion surface**：承载详情与安装流程；桌面端渲染为浮窗右侧卡片，移动端渲染为可返回的独立页面。

Hub scope 始终使用当前 Hub 的 `hubSkills`。Project scope 由 Projects detail 中的选择器确定，任何 action 都必须携带该 Project 的 scope，不能退化成 Hub 范围或跨 Project 范围。现有 Skills 管理数据与 Registry service 接口继续作为唯一数据源。

## 流程

### 打开与切换

1. 用户整块点击 Hub 行的 `Skills · n` 或 Projects 行的 `Skills · n`。
2. 界面自动读取当前 Hub 的 Skills 状态。
3. Hub detail 直接展示全局 Skills；Projects detail 先选择第一个在线 Project，再展示其 Skills。
4. 用户切换 Project 时复用同一列表区域，仅替换 scope 和数据，不向下新增 Project 分组。

### 详情

1. 用户点击 Skill 行末尾的详情图标。
2. 界面通过现有详情接口读取 source metadata、管理状态、`SKILL.md` 内容和 supporting files。
3. 桌面端打开右侧伴随卡片；移动端进入独立详情页。
4. 返回或关闭只关闭详情 surface，不意外关闭 Hub 面板。

### 安装

1. 用户点击当前 scope 工具栏的 `+ Add Skill`。
2. 安装 surface 提供 Marketplace 外链、source 输入、候选 Skill 列表、选择/全选和安装确认。
3. 安装目标固定为打开入口时的 Hub 或 Project scope。
4. 操作完成后自动刷新当前 scope，成功或失败反馈不改变列表布局。

### 更新与卸载

1. 单项 action 只影响所在行和当前 scope。
2. Hub `Update all` 发送 Hub 全局 scope，并明确排除 Projects。
3. Project `Update all` 只发送当前选择的 Project scope。
4. 批量卸载只处理当前 scope 选择模式中已勾选的 Skills。
5. 操作期间原位显示 loading，完成后自动同步列表。

## 验收标准

- Hub Skills 列表不出现任何 Project Skill。
- Projects 行存在三个等宽入口，Visibility 使用眼睛图标，Skills 位于最后。
- Project Skills 使用固定选择器和单一列表；不渲染逐 Project 下拉分组，且不显示离线 Project。
- Hub 与 Project 的 Skill 行名称、三个操作图标槽和禁用态对齐一致，操作前后行高不变。
- Skill 名称不可点击；详情只能由详情图标打开。
- category、agents 等次要说明不再出现在列表行。
- Hub Update all、Project Update all、逐项动作和批量卸载均严格遵守各自 scope。
- Update all 不伪造更新可用性：存在 managed Skill 时可执行，不存在时禁用并显示 `No managed skills`。
- 外部托管 Skill 可查看详情，但无法更新或卸载。
- 安装流程支持 source、候选选择、全选、确认和 Marketplace 跳转，且安装目标不会因 UI 切换而串 scope。
- 没有常驻刷新按钮；打开和操作后自动同步，失败可重试。
- loading、成功和失败反馈都不改变 Skill 行高或列表位置。
- 功能按钮不会导致 Hub 面板关闭。
- 桌面详情/安装卡片不挤压主列表；移动端详情/安装页支持返回按钮、系统返回键与 Android 返回手势。
- 原 Skills 设置页仍可使用。
- 不修改 Registry protocol version。

### 测试

- 为 Hub/Projects 展开互斥、Project 选择、行操作、选择模式、稳定布局状态和 companion surface 路由补充组件测试。
- 为 Hub 与 Project 的 update/install/uninstall payload 增加 scope 边界测试，重点断言 Hub Update all 不携带 Projects。
- 为操作后自动同步、失败重试和 loading 原位替换补充状态测试。
- 为移动端详情/安装页补充返回按钮、浏览器/系统返回和 Android 返回手势测试。
- 保留并运行现有 Hub 菜单、Skills 管理、响应式 shell 与 Registry service 测试。
- 不为未修改的 Registry protocol 增加兼容版本测试。

## 范围之外

- 本次不删除独立 Skills 设置页。
- 本次不恢复 category 分组或列表行内详细说明。
- 本次不显示离线 Project，也不新增在线状态定义。
- 本次不实现 Project Skills 的多列平铺或逐 Project 手风琴。
- 本次不新增手动 reindex/refresh 控件。
- 本次不修改 Registry protocol 或 Skill 存储格式。
