> 由 scope skill 于 2026-07-28 生成

# Shared File Context Menu Actions

## 目标

聊天回复底部的 Changed Files 条目当前左键只会打开 diff，用户无法从该入口直接查看文件本身。为所有可识别文件入口统一一套简洁的右键菜单：Changed file 继续以左键打开 diff，同时可从右键菜单打开普通文件预览；菜单按运行平台提供文件打开、文件复制、HTML 输出和路径复制动作，并完善图标与浅色主题表现。

## 决策

- **哪些入口使用共享菜单？** Changed Files 中的单个文件行和现有聊天文件链接使用同一文件菜单；`Changed N files` 汇总按钮不增加右键菜单。
- **点击行为是否改变？** 不改变。Changed file 左键继续打开对应 diff；普通文件链接保持现有左键预览行为。
- **如何打开文件本身？** 菜单第一项统一为 `Preview file`，使用 eye 图标并打开普通 file preview tab。文件已删除或读取失败时仍允许进入预览，由现有预览错误状态说明失败原因。
- **Desktop 菜单如何组织？** 不显示分组标题，只用两条轻量分隔线形成三组，顺序固定为：
  1. `Preview file`
  2. `Open with VS Code`
  3. `Show in File Explorer`
  4. 分隔线
  5. `Copy file`
  6. `Copy file as HTML`（仅可导出的项目内 Markdown）
  7. 分隔线
  8. `Copy relative path`（仅项目内文件）
  9. `Copy absolute path`
- **`Copy file` 的含义是什么？** 将 Desktop 主机上现存的普通文件作为 Windows 文件对象放入系统剪贴板，用户可粘贴到文件资源管理器或其他接受文件粘贴的应用；不复制文件文本内容。项目内和项目外的已识别路径都可尝试使用，并沿用 VS Code / Explorer 动作现有的 Desktop 主机路径边界，不同步远端 Hub 文件。
- **HTML 动作如何随平台变化？** Desktop 将现有 Markdown HTML 输出显示为 `Copy file as HTML`，结果是剪贴板中的 `.html` 文件；浏览器和 Android 继续显示 `Export as HTML`，分别保持下载和分享行为。只有项目内 Markdown 显示该动作；明确标记为已删除的 Changed file 隐藏该动作，其他读取失败在执行后使用现有错误反馈。
- **不可用动作如何处理？** 运行环境不支持的动作直接隐藏。明确标记为已删除的 Changed file 不显示 `Copy file` 或 HTML 文件动作；其他因文件状态过期导致的失败使用现有错误或 toast 反馈，不静默失败。
- **菜单如何保持简洁？** 文案统一使用 sentence case；不增加 `Copy path` 子菜单。菜单继续支持首项聚焦、方向键导航、Escape、点击外部、滚动和窗口尺寸变化关闭。
- **图标如何处理？** 使用现有 `ChatIcon` 线性图标体系和统一尺寸：`Preview file` 使用 eye，VS Code 使用 code，Explorer 使用 folderOpen，普通文件复制使用 copy，HTML 文件使用 fileCode，relative path 使用 fileSymlink，absolute path 使用 clipboard。图标使用 `currentColor`，与文字状态同步。
- **主题如何处理？** 菜单背景、边框、文字、hover 和 focus 全部使用现有主题 token；浅色主题使用更低浓度的阴影并保持可见边界，深色主题保持当前层级感。两种主题下图标、分隔线和焦点轮廓都必须达到清晰可辨的对比度。
- **是否增加移动端手势？** 不增加长按菜单；本次只扩展现有 `contextmenu` 入口。

## 架构

`ChatTurnView` 只负责把 Changed file 的右键事件连同 artifact、message 和文件路径交给 Workspace 层，避免在展示组件中解析项目路径或调用平台能力。`WorkspaceApp` 根据该消息所属项目构造 `PreviewFileLink`，并与普通聊天文件链接共用菜单状态、能力判断和动作处理。`ChatFileLinkContextMenu` 保持无业务副作用的展示组件，根据调用方提供的能力渲染有序动作与分隔线。

`Preview file` 复用现有 file preview 打开与读取链路。路径复制继续使用 Web Clipboard API。Markdown HTML 继续复用现有渲染和跨平台输出链路，只按平台调整菜单文案。

Windows Desktop 新增受信任页面可调用的单文件剪贴板动作。原生层要求 Desktop 主机绝对路径、验证目标是现存普通文件，并复用现有 HTML 文件剪贴板中的 OLE/`CF_HDROP` 发布能力。该 binding 只暴露给已经通过现有导航授权的远端 Workspace 页面，不暴露给 bootstrap 或不受信任页面。该改动不增加 Registry 方法，也不修改 protocol version。

## 流程

1. 用户右键单个 Changed file 或普通文件链接。
2. Workspace 根据该聊天所属项目解析项目内相对路径或项目外绝对路径，并计算当前平台可用动作。
3. 共享菜单在指针位置打开，首项聚焦，按固定顺序渲染可用动作和必要分隔线。
4. 选择 `Preview file` 时关闭菜单，并通过现有 file preview 流程打开文件；读取失败留在预览中展示错误。
5. 选择 `Copy file` 时关闭菜单，将绝对路径传给 Desktop bridge；原生层重新校验文件后把文件对象放入系统剪贴板。
6. 选择 HTML 动作时关闭菜单，复用现有 Markdown HTML 生成与平台输出流程。
7. 选择路径动作时关闭菜单，复制对应路径并显示现有成功或失败反馈。

## 验收标准

- Changed file 左键仍打开指定文件的 diff，右键不会触发左键动作，而是在指针位置打开共享文件菜单。
- `Changed N files` 汇总按钮保持现有行为且不接管右键菜单。
- Changed file 和普通聊天文件链接的菜单第一项均为 `Preview file`；选择后打开所属项目中的普通 file preview，而不是 prompt-diff preview。
- 已删除或无法读取的文件通过 file preview 展示明确错误，不产生空白 tab 或静默失败。
- Desktop 菜单严格按已确认的三组顺序显示；不满足条件的动作隐藏后，不留下开头、结尾或相邻的多余分隔线。
- Desktop 的 `Copy file` 将 Desktop 主机上可访问的项目内或项目外普通文件放入 Windows 文件剪贴板，粘贴得到原文件；目录、缺失路径、非绝对路径和未授权调用被拒绝并给出失败反馈。
- Desktop 的项目内 Markdown 显示 `Copy file as HTML`，并把生成的 `.html` 文件放入剪贴板；浏览器和 Android 仍显示 `Export as HTML` 并保持下载、分享语义。
- 项目外文件不显示 `Copy relative path`；非 Markdown、项目外 Markdown 和明确删除的文件不显示 HTML 动作。
- 所有菜单项使用已确认的现有线性图标，图标尺寸、文字基线、行高和点击区域一致。
- 深色与浅色主题下菜单的背景、边框、阴影、图标、分隔线、hover 和 focus-visible 状态清晰，浅色主题没有过重的黑色阴影。
- 菜单继续支持键盘导航和现有关闭条件；普通网页链接、Relay 链接和无法识别的 URI 不受影响。
- Registry 协议及其版本保持不变。

### 测试

- React 组件测试覆盖菜单动作顺序、条件隐藏、分隔线去重、图标映射、平台文案和键盘行为。
- Chat turn / Workspace 集成测试覆盖 Changed file 的左键 diff、右键菜单、所属项目路径解析、`Preview file` 路由及失败反馈。
- Web 平台测试覆盖普通/外部文件、Markdown HTML、路径复制和 Desktop bridge 能力 gating。
- Windows Go 测试覆盖 trusted-page binding 授权、绝对普通文件校验、目录/缺失路径拒绝、OLE 文件剪贴板与现有 fallback 行为。
- CSS 回归断言覆盖主题 token、分隔线、统一图标尺寸及浅色阴影；在 Desktop 深色与浅色主题各手动检查一次菜单。
- 不测试操作系统外部应用自身的粘贴实现，也不新增端到端 Android 长按测试。

## 范围之外

- 改变 Changed file 或普通文件链接的左键行为。
- 给 `Changed N files` 汇总按钮增加文件动作。
- 移动端长按菜单、目录复制、一次复制多个文件或复制文件文本内容。
- 为项目外 Markdown 增加 HTML 导出所需的资源解析能力。
- 下载或同步远端 Hub 文件到 Desktop 后再执行 `Copy file`。
- 新增编辑器选择、macOS Finder/Linux 文件管理器支持。
- 新增 Registry 方法或修改 protocol version。
