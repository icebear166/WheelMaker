> 摘要：本页维护 Chat 头部 hub 菜单作为 per-hub 操作中心的行模型、复合按钮、展开互斥、面板级全局操作条，以及桌面浮窗 / 移动端全屏页的双形态约定。

# Hub 菜单

hub 菜单是唯一的 per-hub 操作中心：所有针对单个 hub 的配置与维护动作都收口在这里，不再设置平行的 per-hub 设置页。桌面端是锚定在 Chat 头部摘要按钮下的浮窗（`chat-hub-popover`），移动端是带返回栏的全屏页（`chat-hub-page`），两者共享同一个 `ChatHubPanel` 渲染，结构分支由 JS 的 `isWide` 驱动而非 CSS 断点。

## 面板结构

每个 hub 是一个 `chat-hub-tree`：hub 行（颜色点 + 名称 + 手风琴 chevron，展开状态持久化）下方是三行操作区，面板底部是一条不属于任何 hub 的全局 footer。

```
● hub-a ⌄
 ⚙ Settings      V2 ✓                                   ⌄
 ⛭ Hub        v1.2🔴  [Update]  [NPM ·2 ▾]  [Skills ·12 ▾]
 ▤ Projects             [👁 11/12 ▾]  [Scan 1/2 ▾]
 ──────────────────────────────────────────────────────
 Latest v1.3                              [Update all hubs]
```

- **Settings 行**：唯一的整行手风琴（无复合按钮）。展开内容是 Flicker Bridge 段（Off/V1/V2 三段控件 = 持久 enable + 模式，右侧 Stop/Start 运行时 toggle）和紧凑单行 API key 编辑器（状态对勾/叉图标 + 行内密码输入 + Set/Replace + 图标 Clear）。收缩摘要显示 Flicker `V1`/`V2` + 绿勾或 `Off` + 灰叉。
- **Hub 行**：摘要区显示当前版本号，可升级时版本右上角红点（不放按钮上，空间不足）。按钮组：
  - `Update` / `Restart`：唯一的简单按钮（无 ▾），走 wheelmakerUpdate confirm 流程。
  - `NPM ·n ▾`：主点击批量更新全部 outdated 包（0 时禁用）；▾ 展开逐包行。
  - `Skills ·n ▾`：主点击 rescan hub skills；▾ 展开计数与扫描状态/错误。
- **Projects 行**：`👁 x/y ▾`（主点击全显/全隐，本地偏好无 confirm；▾ 逐项目可见性勾选）+ `Scan x/y ▾`（主点击 scan all 项目索引；▾ 逐项目 index 状态 + 单项目 scan）。
- **footer**：Latest 稳定版本号 + `Update all hubs`（现有 confirm 与 pending 语义）。

## 复合按钮（split button）

行不是整行按钮（按钮内不嵌按钮）。Hub / Projects 行没有独立 chevron，摘要区不可点击，展开完全由按钮右半的 `▾` 触发。按钮左半是动作 + 信息（计数、状态），右半 `▾` 只展开对应 detail。主点击不触发展开。

detail 渲染在所属行下方，detail id 为 `'settings' | 'npm' | 'skills' | 'visibility' | 'scan'`；**每个 hub 同时只开一个 detail**（含 Settings 展开），打开另一个会收起前一个，状态不持久化、菜单关闭即重置。

## 逐 npm 包行

每行：包名、`installed → latest`、二选一主按钮（有更新 `Update` / 未安装 `Install`）+ `Uninstall`。**不提供 reinstall**。所有动作走现有 npmPackage confirm 流程。

## 配置与降级

hub 级配置走 `hub.config.get/update`（写 hub 本地 `db/hub-config.json`，secret 永不回显；config.json `api_keys.*` 作为回退并 overlay 到 configured 标记）。老 hub / 老 registry 不支持时该行显示降级文案，其余功能不受影响。更新类轮询在菜单打开期间通过 `updateSurfaceActiveRef` 保活（不再只绑 Update 设置视图）。
