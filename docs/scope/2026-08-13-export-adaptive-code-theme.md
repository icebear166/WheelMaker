> 由 scope skill 于 2026-08-13 生成
> 状态：已批准 2026-08-13

# 导出/分享 Markdown HTML 代码块查看者主题自适应

## 目标

文件导出、文件分享和聊天回复/会话分享的 Markdown HTML 产物中，代码块颜色当前固定为导出时主题，暗色（或浅色）系统的查看者读到反相的代码配色、可读性差。预期这些产物的代码块高亮跟随查看者系统主题，而不是导出者导出时的主题。

## 决策基线

### 需求边界

- 覆盖所有导出/分享 Markdown HTML 的链路：文件导出与文件 Share MD/HTML（`MarkdownHtmlExportSurface` 链路）、聊天回复/会话的分享与 HTML 导出（`ChatShareCaptureSurface` 链路）。
- 代码块（围栏代码块与行内代码）高亮跟随查看者系统主题：暗色系统看到暗色高亮，浅色系统看到浅色高亮。
- Mermaid 图保持导出时主题，单份渲染，不做双主题。
- 导出/分享产物的代码主题固定使用 `dark-plus` / `light-plus` 配对，不随用户的 codeTheme 设置变化。
- PNG 图片导出是位图，无法自适应，保持导出时主题，不在本次范围。
- 页面外框（背景、正文、边框）维持现状——已经跟随查看者系统主题，不改。
- 应用内聊天与预览的实时代码渲染行为完全不变；双主题只作用于导出/分享序列化产物。
- 已生成的旧导出文件与旧分享链接不变。

### 技术决策

- 自适应机制只用 `prefers-color-scheme` 纯 CSS，不引入任何脚本。导出/分享页面禁止脚本是既定安全边界（原始 Markdown HTML 经安全清理，脚本、事件属性与危险 URL 不得进入产物），JS 主题切换器不可用。
- 代码高亮在导出/分享渲染路径改用 Shiki 双主题输出：`themes: {light: 'light-plus', dark: 'dark-plus'}` + CSS 变量前缀 + `defaultColor: false`，token 颜色与 pre 背景输出为明暗两套 CSS 自定义属性，不再输出固定 hex。
- 媒体查询切换 CSS 集中在共享导出样式（`MARKDOWN_EXPORT_CONTENT_STYLE`，两个 capture surface 都注入）中；默认侧方向与现有页面 chrome 一致（`:root` 为暗色值、`@media (prefers-color-scheme: light)` 覆盖为浅色值）。
- 应用内实时渲染继续走单主题路径；双主题模式只在导出/分享 capture 路径启用，通过渲染选项显式区分，不改变 `markdownCodeRenderer` 的既有调用方行为。
- Mermaid 分支（`MermaidBlock`）继续使用导出时 `themeMode`，不受双主题模式影响。

## 设计视图

### 功能设计

用户在任意主题下执行文件 Export as HTML、文件 Share MD/HTML、聊天回复/会话的分享或 HTML 导出，得到的 HTML 产物中代码块不再携带固定配色：暗色系统浏览器打开看到暗色高亮，浅色系统看到浅色高亮，切换系统主题后重新打开或刷新即跟随。导出者的主题与 codeTheme 设置不再影响产物代码配色；Mermaid 图和 PNG 导出维持导出时外观。查看环境不支持 `prefers-color-scheme` 时按默认侧（暗色）呈现，与页面外框现状一致。

### 技术设计

#### 整体方案

两条 capture 链路共用同一段离屏渲染与序列化管线：`MarkdownHtmlExportSurface` / `ChatShareCaptureSurface` 注入 `MARKDOWN_EXPORT_CONTENT_STYLE`，渲染后经 `serializeMarkdownHtmlExportSurface` 产出最终 HTML。双主题在高亮渲染层引入一个显式的导出专用模式：

- `shikiRenderer` 增加双主题渲染分支：`codeToHtml` 传入明暗主题对与 CSS 变量前缀，输出 `--shiki-light` / `--shiki-dark`（及对应背景变量）形式的 token 样式；现有单主题分支保留给应用内实时渲染。
- `markdownCodeRenderer`（`markdownPreview.tsx`）在导出/分享调用上下文使用双主题分支；Mermaid 语言分支不变。行内代码（`structure: 'inline'`）与块级代码（`structure: 'classic'`）都走双主题；diff 渲染若复用同一高亮输出，同样适配。
- `MARKDOWN_EXPORT_CONTENT_STYLE` 增加 `.shiki` 颜色/背景的双主题媒体查询规则，方向与 `MARKDOWN_HTML_EXPORT_PAGE_STYLE` 的 chrome 变量一致（暗色默认，light 媒体查询覆盖）。
- 两个 capture surface 调用渲染时启用双主题模式；`themeMode` 参数继续仅用于 Mermaid 等保持导出时主题的部分。

#### 关键结构

- 双主题 token 样式形态：`<span style="--shiki-light:#111111;--shiki-dark:#eeeeee">`，pre 背景同理（`--shiki-light-bg` / `--shiki-dark-bg`）。
- 导出 CSS 切换形态：`.shiki span { color: var(--shiki-dark); }` + `@media (prefers-color-scheme: light) { .shiki span { color: var(--shiki-light); } }`（背景同构），具体选择器与现有导出 class 结构对齐。

#### 实现流程

导出/分享动作触发 capture surface 离屏渲染 → 代码块经双主题分支输出 CSS 变量 → 序列化产物内联共享导出样式（含媒体查询）→ 产物打开时由查看者浏览器的媒体查询决定实际颜色。渲染失败、图片解析失败等既有失败收敛路径不变；双主题渲染失败时沿用现有 onError 收敛，不引入新的错误面。

### 预估改动面

- `app/web/src/code/shikiRenderer.ts`（双主题渲染分支 + 缓存键适配）
- `app/web/src/code/markdownPreview.tsx`（导出调用上下文接入双主题，Mermaid 分支不变）
- `app/web/src/chat/export/markdownHtmlExport.ts`（`MARKDOWN_EXPORT_CONTENT_STYLE` 媒体查询）
- `app/web/src/chat/export/MarkdownHtmlExportDocument.tsx` 与 `app/web/src/chat/share/ChatShareCaptureSurface.tsx`（启用双主题模式的传递）
- 相关测试：`app/__tests__/web-markdown-html-export.test.tsx`、`app/__tests__/web-chat-share-document.test.tsx`、`app/web/src/code/markdownPreview.test.tsx`、shikiRenderer 相关测试
- wiki：更新 `docs/wiki/features/file-links.md`、`docs/wiki/features/chat-sharing.md`

## 验收

- 文件导出 HTML → 产物中代码块 token 为 `--shiki-light`/`--shiki-dark` 变量形态，共享样式含对应 `prefers-color-scheme` 媒体查询；测试断言产物不含固定 token hex 颜色；暗色系统查看即为 dark-plus 配色（结构测试 + 样式断言）。
- 文件 Share MD/HTML 与聊天回复/会话分享/HTML 导出 → 同样含双主题变量与媒体查询（两条链路各自的测试断言）。
- Mermaid 块 → 产物中仍按导出时主题单份 SVG，无双份渲染；测试断言。
- 用户 codeTheme 设为任一 curated 主题 → 导出产物代码仍为 dark-plus/light-plus 配对；测试断言。
- 应用内聊天/预览代码渲染 → 既有单主题行为不回归（现有 markdownPreview / shikiRenderer 测试全绿）。
- `npm run tsc:web` 无错误；相关 jest 套件全绿，全量 jest 无新增失败。
