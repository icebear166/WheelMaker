# Adaptive Code Theme for Exported Markdown HTML — Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让导出/分享的 Markdown HTML 产物中的代码块高亮跟随查看者系统主题（prefers-color-scheme），而非固定导出时主题。

**Scope Source:** `docs/scope/2026-08-13-export-adaptive-code-theme.md`（已批准 2026-08-13）

**Architecture:** 在 `shikiRenderer.renderShikiHtml` 增加显式 `adaptiveCodeTheme` 双主题分支（Shiki `themes: {light, dark}` + `defaultColor: false` + `cssVariablePrefix: '--shiki-'`，token 输出明暗 CSS 变量）；`markdownCodeRenderer`/`ShikiCodeBlock` 透传该模式且 adaptive 时绕过虚拟化分块；`MarkdownHtmlExportContent` 无条件启用（两个 capture surface 共用，一次接入覆盖文件导出/文件分享/聊天分享三链路）；共享导出样式 `MARKDOWN_EXPORT_CONTENT_STYLE` 增加媒体查询切换变量。

**Tech Stack:** React 18、react-markdown、@shikijs/core v4（engine-javascript）、jest 30、react-test-renderer。

**Verification:** worktree `app/` 下 `npx jest <相关套件>` 与 `npm run tsc:web`；收尾全量 `npx jest` 无新增失败。

---

**工作区约定：** 所有路径相对 worktree `D:\Code\WheelMaker\.worktree\export-adaptive-code-theme`；命令在 `app/` 子目录执行。绝不触碰主树。

**关键代码事实（已核实）：**

- `MarkdownHtmlExportContent`（`app/web/src/chat/export/MarkdownHtmlExportDocument.tsx`）是全部三条链路的唯一渲染入口：文件导出/文件分享经 `MarkdownHtmlExportSurface`，聊天回复/会话经 `ChatShareDocument`（`app/web/src/chat/share/ChatShareDocument.tsx:70,110`）。行内代码走 `markdownCodeRenderer` 的 plain `<code>` 分支（无 Shiki），颜色已由导出 CSS 变量承载，天然自适应，无需改动。
- `markdownCodeRenderer`（`app/web/src/code/markdownPreview.tsx:335`）：mermaid 分支（:364）用 `themeMode` 渲染 `MermaidBlock`——保持不变；围栏块渲染 `ShikiCodeBlock`。
- `ShikiCodeBlock`（`app/web/src/code/ShikiCodeBlock.tsx:347`）：大块（`>= VIRTUALIZE_LINE_THRESHOLD` 行或 `>= INCREMENTAL_CHARACTER_THRESHOLD` 字符）走 `ShikiCodeBlockVirtualized`（IntersectionObserver 分块，面向应用内可视区）；小块走 `ShikiCodeBlockSmall`（:366）调 `renderShikiHtml({mode: 'block', ...})`。导出宿主离屏（`left:-10000px`），IO 不触发可视区扩展，虚拟化路径在导出中只渲染首块——adaptive 模式必须绕过虚拟化，这同时修正大代码块导出完整性。
- `renderShikiHtml`（`app/web/src/code/shikiRenderer.ts:366`）：`resolveTheme(themeMode, codeTheme)` 单主题 → `renderWithHighlighter` → `codeToHtml({theme, structure})`；块级后经 `alignAutomaticThemeBackground`（仅 `codeTheme === 'auto-plus'` 时重写 `background-color`）。`transparentBackground`（framed + auto-plus）使 pre 透明、frame surface 透出。
- Shiki v4 双主题输出形态：`codeToHtml(code, {lang, themes: {light: 'light-plus', dark: 'dark-plus'}, defaultColor: false, cssVariablePrefix: '--shiki-'})` → pre 带 `--shiki-light-bg`/`--shiki-dark-bg` 变量（无生效 `background-color`），token span 带 `--shiki-light`/`--shiki-dark` 变量（无固定 `color:#`）。pre 无生效背景 → frame surface（`--surface-panel`，已自适应）透出，与现状视觉一致。
- 导出 chrome 已自适应：`MARKDOWN_HTML_EXPORT_PAGE_STYLE`（`app/web/src/chat/export/markdownHtmlExport.ts:136`）暗色 `:root` 默认 + `@media (prefers-color-scheme: light)` 覆盖。新增 Shiki 切换规则沿用同一方向。
- `waitForMarkdownExportReady` 等待 `data-markdown-export-pending` 清除；`ShikiCodeBlockSmall` 渲染完成即清除（:458），串行 await 所有分块不属于该路径。
- diff 渲染（`renderShikiDiffHtml`/`ShikiDiffPane`）不进入任何导出/分享 capture 文档（`ChatShareDocument` 只渲染 markdown 文本与附件标签），本计划不涉及。

### Task 1: Wiki 同步导出/分享主题边界

**Files:**
- Modify: `docs/wiki/features/file-links.md`
- Modify: `docs/wiki/features/chat-sharing.md`

**Acceptance:** 两页记录"导出/分享 Markdown HTML 产物的代码块高亮跟随查看者系统主题（dark-plus/light-plus 固定对、纯 CSS prefers-color-scheme、无脚本）；Mermaid 与 PNG 导出保持导出时主题"。

- [ ] **Step 1: 读取两页全文，定位导出/渲染边界相关章节**

- [ ] **Step 2: file-links.md 的 Markdown HTML 导出章节补一句双主题边界；chat-sharing.md 的文档渲染/快照章节补同口径一句**

只追加/修订与本次知识直接相关的句子，保留页面既有范围与摘要行。

- [ ] **Step 3: Git checkpoint**

Run: `git add docs/wiki/features/file-links.md docs/wiki/features/chat-sharing.md && git commit -m "docs(wiki): note viewer-adaptive code theme in exported/shared markdown HTML"`
Expected: commit 成功，仅两个 wiki 文件。

### Task 2: shikiRenderer 双主题渲染分支

**Files:**
- Modify: `app/web/src/code/shikiRenderer.ts`
- Create: `app/web/src/code/shikiRenderer.test.ts`

**Acceptance:** `renderShikiHtml({adaptiveCodeTheme: true, ...})` 输出 token 为 `--shiki-light`/`--shiki-dark` 变量形态、无固定 `color:#xxxxxx`；非 adaptive 调用输出保持单主题固定色不变。

- [ ] **Step 1: Write the failing test**

Create `app/web/src/code/shikiRenderer.test.ts`：

```ts
import {renderShikiHtml} from './shikiRenderer';

const baseOptions = {
  code: 'const answer: number = 42;\n',
  language: 'ts',
  themeMode: 'dark' as const,
  codeTheme: 'auto-plus' as const,
  codeFont: 'consolas' as const,
  codeFontSize: 13,
  codeLineHeight: 1.5,
  codeTabSize: 2,
  wrap: true,
  lineNumbers: false,
  mode: 'block' as const,
};

describe('renderShikiHtml adaptive code theme', () => {
  test('emits light/dark CSS variables instead of fixed colors in adaptive mode', async () => {
    const html = await renderShikiHtml({...baseOptions, adaptiveCodeTheme: true});

    expect(html).toContain('--shiki-light:');
    expect(html).toContain('--shiki-dark:');
    expect(html).not.toMatch(/style="[^"]*color:#/);
  });

  test('keeps the dark-plus/light-plus pair regardless of codeTheme and themeMode', async () => {
    const monokai = await renderShikiHtml({
      ...baseOptions,
      codeTheme: 'monokai',
      adaptiveCodeTheme: true,
    });
    const light = await renderShikiHtml({
      ...baseOptions,
      themeMode: 'light',
      adaptiveCodeTheme: true,
    });

    expect(monokai).toContain('--shiki-light:');
    expect(monokai).toContain('--shiki-dark:');
    expect(monokai).toBe(light);
  });

  test('keeps single-theme fixed colors without the adaptive flag', async () => {
    const html = await renderShikiHtml(baseOptions);

    expect(html).toMatch(/color:#/);
    expect(html).not.toContain('--shiki-light:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest web/src/code/shikiRenderer.test.ts`
Expected: FAIL —— `adaptiveCodeTheme` 不是已知选项，前两个用例无 `--shiki-light:` 输出（TS 类型报错表现为测试报错也算 RED，但应以功能缺失断言失败为准；若类型报错先于断言失败，先把选项类型加上再确认断言仍失败）。

- [ ] **Step 3: Write minimal implementation**

`app/web/src/code/shikiRenderer.ts`：

1. `RenderShikiBaseOptions` 增加字段：

```ts
  /** Export/share rendering: emit light/dark CSS variable pairs instead of fixed theme colors. */
  adaptiveCodeTheme?: boolean;
```

2. `renderWithHighlighter`（:322）增加 `adaptive` 参数，双主题时改调：

```ts
  return highlighter.codeToHtml(normalizedCode, {
    lang,
    themes: {light: SHIKI_THEME_LIGHT, dark: SHIKI_THEME_DARK},
    defaultColor: false,
    cssVariablePrefix: '--shiki-',
    structure: 'classic',
    tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
    tokenizeTimeLimit: TOKENIZE_TIME_LIMIT_MS,
    transformers: [buildLineTransformer(...same args...)],
  });
```

`structure: 'inline'` 分支同样以 `themes` 替换 `theme`。`buildLineTransformer` 实参保持现状。

3. `renderShikiHtml`：adaptive 时跳过 `resolveTheme` 的单主题语义——主题加载改为 `ensureThemeLoaded(highlighter, SHIKI_THEME_LIGHT)` + `ensureThemeLoaded(highlighter, SHIKI_THEME_DARK)`（两者已是默认加载主题，:285），inline 缓存键拼入 `adaptive` 标记；`alignAutomaticThemeBackground` 在 adaptive 时不调用（pre 已无生效背景）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest web/src/code/shikiRenderer.test.ts`
Expected: PASS 3/3。

- [ ] **Step 5: Run focused regression checks**

Run: `npx jest web/src/code __tests__/web-chat-markdown-image-export.test.ts`
Expected: PASS（应用内单主题渲染不回归）。

- [ ] **Step 6: Git checkpoint**

`git add app/web/src/code/shikiRenderer.ts app/web/src/code/shikiRenderer.test.ts`，commit `feat(web): add dual-theme shiki output for exported markdown`。

### Task 3: ShikiCodeBlock / markdownCodeRenderer / MarkdownHtmlExportContent 接入

**Files:**
- Modify: `app/web/src/code/ShikiCodeBlock.tsx`
- Modify: `app/web/src/code/markdownPreview.tsx`
- Modify: `app/web/src/chat/export/MarkdownHtmlExportDocument.tsx`
- Test: `app/web/src/code/markdownPreview.test.tsx`

**Acceptance:** 导出/分享渲染链路（`MarkdownHtmlExportContent`）的围栏代码块以 adaptive 双主题渲染并绕过虚拟化；应用内 `MarkdownPreview` 不传该标志、行为不变；mermaid 分支仍按导出时 `themeMode`。

- [ ] **Step 1: Write the failing test**

Append to `app/web/src/code/markdownPreview.test.tsx`（沿用其现有 import 风格）：

```ts
describe('markdownCodeRenderer adaptive code theme', () => {
  test('renders fenced code with light/dark CSS variables in adaptive mode', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <>
          {markdownCodeRenderer({
            className: 'language-ts',
            children: 'const answer: number = 42;\n',
            themeMode: 'dark',
            codeTheme: 'auto-plus',
            codeFont: 'consolas',
            codeFontSize: 13,
            codeLineHeight: 1.5,
            codeTabSize: 2,
            wrap: true,
            lineNumbers: false,
            framed: true,
            adaptiveCodeTheme: true,
          })}
        </>,
      );
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const html = renderer.root.findByProps({className: 'code-wrap wrap'});
    const serialized = JSON.stringify(html.props.dangerouslySetInnerHTML);
    expect(serialized).toContain('--shiki-light:');
    expect(serialized).toContain('--shiki-dark:');

    act(() => renderer.unmount());
  });
});
```

（异步等待以 `data-markdown-export-pending` 清除或轮询 `--shiki-light:` 出现为准，执行时按实际稳定形态收紧。）

另加结构断言测试：adaptive 模式不经过 `ShikiCodeBlockVirtualized`——`ShikiCodeBlock` 分流处大内容 + adaptive 时不出现 `data-chunk-sentinel`。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest web/src/code/markdownPreview.test.tsx`
Expected: FAIL —— `adaptiveCodeTheme` 未透传，输出无 `--shiki-light:`。

- [ ] **Step 3: Write minimal implementation**

1. `ShikiCodeBlock.tsx`：`ShikiCodeBlockProps` 增加 `adaptiveCodeTheme?: boolean`；`ShikiCodeBlock` 分流改为 adaptive 时总是 `ShikiCodeBlockSmall`；`ShikiCodeBlockSmall` 将 `adaptiveCodeTheme` 传入 `renderShikiHtml` 并加入 effect 依赖数组。`ShikiCodeBlockVirtualized` 不接收、不处理该标志（live 专用）。
2. `markdownPreview.tsx`：`markdownCodeRenderer` 参数对象增加 `adaptiveCodeTheme?: boolean`，仅透传给 `ShikiCodeBlock`；mermaid 与 plain `<code>` 分支不触碰。
3. `MarkdownHtmlExportDocument.tsx`：`MarkdownHtmlExportContent` 的 `markdownCodeRenderer({...})` 调用增加 `adaptiveCodeTheme: true`。`MarkdownHtmlExportContentProps` 不变（导出组件无条件启用）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest web/src/code/markdownPreview.test.tsx`
Expected: PASS。

- [ ] **Step 5: Run focused regression checks**

Run: `npx jest web/src/code web/src/file web/src/preview`
Expected: PASS。

- [ ] **Step 6: Git checkpoint**

`git add app/web/src/code/ShikiCodeBlock.tsx app/web/src/code/markdownPreview.tsx app/web/src/code/markdownPreview.test.tsx app/web/src/chat/export/MarkdownHtmlExportDocument.tsx`，commit `feat(web): render exported markdown code blocks with adaptive dual theme`。

### Task 4: 导出共享 CSS 媒体查询与链路断言

**Files:**
- Modify: `app/web/src/chat/export/markdownHtmlExport.ts`
- Test: `app/__tests__/web-markdown-html-export.test.tsx`
- Test: `app/__tests__/web-chat-share-document.test.tsx`

**Acceptance:** `MARKDOWN_EXPORT_CONTENT_STYLE` 含 `.shiki` token 颜色的 `prefers-color-scheme` 切换规则（暗色默认、light 覆盖，方向与页面 chrome 一致）；文件导出与聊天分享两条链路的产物断言覆盖双主题。

- [ ] **Step 1: Write the failing test**

Append to `app/__tests__/web-markdown-html-export.test.tsx`（`MARKDOWN_EXPORT_CONTENT_STYLE` 为已导出常量，直接 import 断言）：

```ts
  test('switches exported shiki token colors with the viewer color scheme', () => {
    expect(MARKDOWN_EXPORT_CONTENT_STYLE).toContain('var(--shiki-dark)');
    expect(MARKDOWN_EXPORT_CONTENT_STYLE).toContain('@media (prefers-color-scheme: light)');
    expect(MARKDOWN_EXPORT_CONTENT_STYLE).toContain('var(--shiki-light)');
  });
```

（import 块相应加入 `MARKDOWN_EXPORT_CONTENT_STYLE`。）

`app/__tests__/web-chat-share-document.test.tsx` 增加/更新断言：`ChatShareDocument` 渲染内容经 `MarkdownHtmlExportContent`（既有断言若已覆盖则补一句双主题来源断言——`MarkdownHtmlExportDocument.tsx` 含 `adaptiveCodeTheme: true`，结构断言写入该测试文件既有源码断言块中）。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/web-markdown-html-export.test.tsx __tests__/web-chat-share-document.test.tsx`
Expected: FAIL —— 样式中尚无 `--shiki-dark` 变量规则。

- [ ] **Step 3: Write minimal implementation**

`app/web/src/chat/export/markdownHtmlExport.ts` 的 `MARKDOWN_EXPORT_CONTENT_STYLE` 追加：

```css
.wheelmaker-markdown-export .shiki span { color: var(--shiki-dark); }
@media (prefers-color-scheme: light) {
  .wheelmaker-markdown-export .shiki span { color: var(--shiki-light); }
}
```

行号 span 等带内联 `color:var(--muted)` 的元素由内联样式优先，不受该规则影响（现状保持）。具体选择器以 Shiki 实际输出类名（`pre.shiki`）核对后落定，规则方向不变。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/web-markdown-html-export.test.tsx __tests__/web-chat-share-document.test.tsx`
Expected: PASS。

- [ ] **Step 5: Run focused regression checks**

Run: `npm run tsc:web && npx jest __tests__/web-markdown-html-export.test.tsx __tests__/web-chat-share-document.test.tsx __tests__/web-share-snapshot.test.ts __tests__/web-share-ui.test.tsx`
Expected: tsc 无错误；jest 全 PASS。

- [ ] **Step 6: Git checkpoint**

`git add app/web/src/chat/export/markdownHtmlExport.ts app/__tests__/web-markdown-html-export.test.tsx app/__tests__/web-chat-share-document.test.tsx`，commit `feat(web): switch exported code colors by viewer color scheme`。

### Task 5: 全量验证与收尾

**Files:** 无新增。

**Acceptance:** spec 验收逐项有据；全量 jest 无新增失败。

- [ ] **Step 1: 全量基线与回归对比**

基线在 Task 2 动手前已执行（执行节拍到 Task 2 前先跑 `npx jest 2>&1 | tail -3` 记录基线失败数）。本步重跑对比：

Run: `npx jest 2>&1 | tail -15`
Expected: 失败套件与失败数不超过基线（主树已知存在任务外既有失败；worktree 基线以实际首跑为准）。

- [ ] **Step 2: tsc**

Run: `npm run tsc:web`
Expected: 无错误。

- [ ] **Step 3: 逐项核对 spec 验收并记录证据**

- [ ] **Step 4: git-workflow finalize（complete）**

push `export-adaptive-code-theme` 并核对远端 SHA；按偏好主树 main 干净则合入并 push main、清理 worktree/分支，主树有未提交修改则暂缓合并、保留分支与 worktree。
