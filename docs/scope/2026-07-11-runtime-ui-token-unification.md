> 由 scope skill 于 2026-07-11 生成

# Runtime UI Semantic Token Unification

## 目标

将 WheelMaker 运行时工作区的视觉表面全面收敛到已存在的语义 token，消除旧 `--bg`、`--panel*`、`--text`、`--border`、`--accent` 和直接写入的应用 chrome 颜色所造成的桌面、移动端与详情页之间的层级偏差。保留冷静、深色、开发工具式的工作台语言，不改变内容、路由、设置、功能交互或信息架构。

## 决策

- 这是一次保守的运行时 UI 统一，不是引入新设计系统或重做页面布局。设计取向为低变化、低动效、高信息密度。
- `tokens.css` 中现有的 `surface-*`、`text-*`、`border-*`、`accent-*`、`state-*` 是唯一权威的运行时 token 词汇；不增加新的品牌颜色。
- `--surface-workspace-content` 是聊天、预览和代码承载区的统一内容平面。默认 Auto 代码主题使用它，手动选择的代码主题保留自身背景。
- 单一蓝色 `--accent-primary` 只表达选择、当前上下文和主要可操作状态；成功、警告、危险、信息分别只使用对应的 `state-*` token。
- 所有业务 chrome 使用明确的语义表面：应用画布使用 `--surface-canvas`，侧栏使用 `--surface-sidebar`，工作区内容使用 `--surface-workspace-content`，普通面板使用 `--surface-panel`，输入和局部抬升控件使用 `--surface-raised`，菜单和临时覆盖层使用 `--surface-overlay`。
- 迁移范围包含 Shell、Chat、Settings、Debug、Port Relay、全局基础控件、Chat Preview 及其 Preview Workbench chrome。目标样式不再依赖旧 alias 直接决定颜色。
- File 与 Git 的独立内容页不纳入本次视觉收敛。`file.css` 中仅服务于 Chat Preview、Preview Workbench 和聊天文件提及的 chrome 可修改。
- 语法高亮、显式代码主题、diff 增删行、HTML 预览白底、二维码画布、图片透明棋盘和 Windows 原生窗口控制的专用颜色保持不变。
- 已有 token alias 暂时继续保留在 `tokens.css`，以兼容本次范围外的 File/Git 内容页；它们不再作为本次范围内样式的来源。

## 架构

`tokens.css` 继续只定义颜色、边框、阴影、圆角和动效 token。各样式文件不再根据旧 alias 猜测表面用途，而是按照组件角色直接引用语义 token：

- `shell.css` 和 `surfaces.css`：应用画布、桌面顶栏、侧栏、抽屉、菜单、模态和通用工具控件。
- `chat.css`：会话浏览、聊天正文、composer、计划浮层、反馈卡、选择态和聊天内菜单。
- `settings.css`、`debug.css`、`portRelay.css`：设置工作台、详情面板、日志和端口转发的中性表面、输入和状态。
- `code.css`：仅将应用 chrome、Markdown 和 Mermaid 的中性表面迁移；不改代码主题、diff 或 HTML 预览内容色。
- `file.css`：仅迁移 Chat Preview/Preview Workbench 相关选择器，不触及 File 页面本身。

视觉层级固定为“画布 < 工作区内容 < 面板 < 抬升控件 < 覆盖层”。同一角色在宽桌面、窄桌面和竖屏移动端必须使用同一 token，不通过 breakpoint 换用不同灰阶。

## 验收标准

- Shell、Chat、Settings、Debug、Port Relay、基础控件及 Chat Preview chrome 中的中性表面、文字、边框、主强调和状态反馈均直接使用语义 token。
- 宽桌面、窄桌面和竖屏移动端的聊天与预览内容平面一致；默认 Auto 代码主题与该平面一致。
- 选中态不再使用旧硬编码蓝色；成功、警告、危险和信息反馈不再使用互相冲突的硬编码状态色。
- Settings、Debug 和 Port Relay 的卡片、输入、浮层和空状态与 Shell/Chat 使用相同的表面与边框层级，但保留各自的内容结构和状态语义。
- File/Git 独立内容页、显式代码主题、diff、HTML 预览、二维码、图片透明底和原生窗口控制颜色未被改变。
- 不新增依赖、字体、图片、路由、设置项、文案、持久化字段或行为。
- 深色与浅色主题均保持清晰的文字、边框、焦点和状态对比度。

### 测试

- 为 token 迁移加入样式契约测试，锁定各运行时表面使用的语义 token，并防止目标样式重新使用旧 alias 或硬编码应用 chrome 色。
- 保留并更新现有 Chat、Settings、Preview、Debug、Port Relay、Shell 和代码主题测试，确保结构和行为契约不变。
- 运行 Web TypeScript 检查、完整 Jest 套件和生产 Web 构建。
- 在深色和浅色主题下人工检查宽桌面、窄桌面及竖屏移动端的 Shell、Chat、Preview、Settings、Debug、Port Relay；重点确认内容平面、菜单、输入焦点、选中态和状态反馈。

## 范围之外

- 不改变 File/Git 独立内容页的视觉语言。
- 不替换显式代码主题、语法高亮 token 或 diff 语义色。
- 不改变页面布局、控件尺寸、导航、会话流程、设置字段、反馈文案或动作回调。
- 不引入 Fluent、Carbon、Material 或其他组件库。
