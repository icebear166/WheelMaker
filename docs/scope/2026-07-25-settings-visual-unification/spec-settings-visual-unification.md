> 由 scope skill 于 2026-07-25 生成

# 设置界面视觉统一

## 目标

Settings 的四个页面（根页 Settings、Update、Skills、Port Relay）在长期演进中各自长出了独立的容器、按钮、状态与图标方言（约 8 种按钮、4 种卡片、4 种状态、codicon 图标全量使用），且 app/web/src/styles/settings.css 内 `settings-list/section/row` 被重复定义两次、相互覆盖。本次把这四页统一收敛到 docs/wiki/frontend-interaction/visual-language.md 已落定的精致深色工具风语言：一套共享 kit、共享 Lucide 图标组件、统一的状态点词汇；在风格与微交互层面对齐，并顺手修平若干别扭的小流程，但所有后端动作与操作步骤保持不变。

## 决策

- **改造力度：对齐重构。** 建立统一 kit + 共享 Icon 组件，四页全量迁移；按 wiki 拆彩色左轨、去渐变、扁平化嵌套、codicon→Lucide、按钮改 ghost 默认。业务逻辑零变更。
- **交互范围：微交互对齐 + 轻量流程修正。** 统一 hover/focus/disabled/loading、disclosure 进退场、列表进入、按压、`prefers-reduced-motion` 降级；修平 Port Relay 草稿目标行、Skills hub picker 选中态与 bulk 可见度等小流程；不重设计信息架构、不改 install/update/enable 逻辑。
- **交付节奏：一气呵成。** 内部两阶段推进（地基 → 根页+Port Relay → Update+Skills），收尾一次性 `tsc`/`jest`/`build` + commit + push + 截图。
- **图标：codicon → Lucide。** 提升 app/web/src/chat/sessionlist/SessionIcon.tsx 的 glyph map 与渲染到共享组件 `app/web/src/common/Icon.tsx`；`SessionIcon` 改为薄再导出，对外 API（`SessionIcon` / `SessionIconName`）与 sessionlist 行为零变化。设置四页全部 codicon 替换为 `<Icon>`；新增所需 glyph，形状用 `better-icons get lucide:<id>` 校验。
- **材质与圆角：** 设置模态/详情页统一实心面板材质（`--surface-panel` + `--border-subtle` 发丝边 + `--shadow-floating` + 顶部 1px 内高光），圆角收敛 control 6px / 面板 8px；面板 8px 在 kit 内就地取值，**不修改全局 `--radius-panel` token**（避免波及非设置界面）；删除 apk 卡、hub 卡上的渐变。
- **层级：** 靠字重/字号/缩进/`--hub-accent` 色彩锚点表达；**移除** Update hub 卡 3px 左轨、Skills scope 2px 左轨、Port Relay status 3px 左轨；**扁平化** Skills 卡片套卡片结构。hub 分组沿用既有 `wide-project-hub-N` + `--hub-accent`，以小色点 + 名称表达，不为单项目单独配色。
- **控件语言：** 按钮 ghost 默认（`--text-tertiary`，hover `--hover` + `--text-primary`），accent 只给开启/选中/进行中态；8 种 `*-action-btn`/`*-update-btn` 收敛为 `set-btn`（ghost / `--primary` / `--danger` / `--icon`）。
- **状态词汇：** 4 种 pill + codicon status 收敛为 `set-status`（CSS 状态点 实心/脉冲/描边 + mono 标签，`is-{idle,ok,running,warn,error}`），跨 hub/skill/relay/package 统一。
- **数据排版：** 机器标识符（hub id、版本号、端口、access code、计数）走 mono + `tabular-nums`。
- **kit 命名：** 详情三页共用 `set-card` / `set-btn` / `set-status` / `set-disclosure` / `set-field` / `set-kv`；根页沿用其干净的 `settings-section` / `settings-row` 列表词汇（去重后）。两套共用同一按钮/状态/图标系统。
- **测试冲突处理：** app/web/src/settings/UpdateSettingsDetail.test.tsx 现断言 `codicon-trash` / `codicon-sync` 字符串，迁移后改为断言新图标标识（`data-icon-name="trash"` / `"refreshCw"`），测试意图（卸载呈 trash、重装/更新呈 sync）不变。

## 架构

渲染入口不变：app/web/src/app/WorkspaceApp.tsx 经 `renderSettingsDetailShell` 把各详情页包进 app/web/src/settings/SettingsSurface.tsx 的 `SettingsDetailShell`（提供 header + back + body），根页用 app/web/src/settings/SettingsRootContent.tsx；移动端底部快捷栏（Settings/Update/Skills/Port Relay）与桌面布局分支保留。

新增/迁移的单元：

- **共享 Icon 组件** `app/web/src/common/Icon.tsx`：承载 Lucide glyph map 与 `<Icon>` 渲染；`SessionIcon` 改为从其再导出，保持对外 API 不变。
- **统一 kit（CSS）** 追加于 app/web/src/styles/settings.css（权威置末位），并删除被取代的方言规则与 `settings-list/section/row` 的重复定义；app/web/src/styles/portRelay.css 中被 kit 覆盖的设置区段样式收敛或删除。
- **四个页面组件** 仅替换 className / 图标 / 局部结构与轻量流程，props 契约与回调不变。

## 流程

1. 用户从移动端快捷栏或桌面 Settings 入口进入；根页展示分组设置行，详情页经 `SettingsDetailShell` 渲染。
2. Update：hub 列表 → 每 hub 卡（色点 + 名 + 状态点 + 版本）→ NPM / Projects 各为 `set-disclosure` 展开；操作经既有 `requestWheelMakerUpdate` / `requestAgentPackageAction` 等回调，不变。
3. Skills：hub picker 选 hub → scope 区块（hub/project）→ skill 行 → detail 侧栏；安装/卸载/更新经既有回调，不变。
4. Port Relay：状态区 + access 区 + 目标列表 + 启用/停用；新增「+ Add target」内联表单取代虚线草稿行；启用/停用/重置码经既有回调，不变。

## 验收标准

- 四页视觉语言一致：同一套按钮、卡片、状态点、图标（Lucide）、圆角与材质；移动端与 PC 端仅密度/交互手段分化。
- 四页不再出现任何 `codicon-*`（含快捷栏、详情 header 的 back/chevron/refresh/close）；图标统一走 `<Icon>`。
- 不再存在彩色左轨、apk/hub 渐变、Skills 卡片套卡片；层级靠字重/字号/缩进/色点表达。
- 按钮默认 ghost，accent 仅出现在开启/选中/进行中态。
- 状态健康度跨页用同一套 `set-status` 点 + 标签表达。
- Port Relay 目标新增改为显式「+ Add target」按钮 + 内联表单；Skills hub picker 选中态与 bulk 选中可见度清晰。
- 所有进退场 / hover / 按压动画走 `--motion-*` / `--ease-*`；`prefers-reduced-motion` 与 `prefers-reduced-transparency` 均有降级。
- `npm run tsc:web` 通过；`jest` 通过（含更新后的图标断言）；`npm run build:web` 通过。
- 深色与浅色主题下四页均可用，配色全部来自 tokens，无未定义变量 fallback。

### 测试

- 更新 app/web/src/settings/UpdateSettingsDetail.test.tsx 的图标断言：`codicon-trash`→`data-icon-name="trash"`、`codicon-sync`→`data-icon-name="refreshCw"`，保留「卸载呈 trash、重装/更新呈 sync」的意图。
- 为共享 Icon 组件补最小渲染测试（SessionIcon 既有测试迁移覆盖，保证再导出后行为不变）。
- 桌面 / 窄桌面 / 移动断点手动视觉验证四页：材质、层级、disclosure 进退场、reduced-motion/transparency 降级。
- 不为 install/update/enable/disable 等既有后端动作新增功能测试（逻辑未变）。

## 范围之外

- 不改变任何设置项的数据模型、持久化、权限条件与后端动作逻辑。
- 不重做信息架构、不合并/拆分页面、不新增设置项。
- 不改动 chat、shell 顶栏、sessionlist 等非设置界面（`SessionIcon` 迁移仅限再导出，不改其行为与外观）。
- 不修改 protocol version；不调整移动端快捷栏的四入口拓扑。
- 不引入新图标库（沿用已建立的 Lucide inline SVG 体系）。
