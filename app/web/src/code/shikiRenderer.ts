import {createHighlighterCore} from '@shikijs/core';
import {createJavaScriptRegexEngine} from '@shikijs/engine-javascript';
import type {HighlighterCore, LanguageInput, ShikiTransformer, ThemedToken, ThemeInput} from '@shikijs/types';
import {
  resolveCodeFontFamily,
  type CodeFontId,
  type CodeThemeId,
  type CuratedCodeThemeId,
  type DiffRenderLine,
} from './shikiSettings';

type ThemeMode = 'dark' | 'light';
type RenderMode = 'block' | 'inline';

type RenderShikiBaseOptions = {
  language: string;
  themeMode: ThemeMode;
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
  wrap: boolean;
  highlightedLines?: Set<number>;
};

type RenderShikiOptions = RenderShikiBaseOptions & {
  code: string;
  lineNumbers: boolean;
  mode: RenderMode;
};

type RenderShikiDiffOptions = RenderShikiBaseOptions & {
  lines: DiffRenderLine[];
  lineNumbers: boolean;
};

const SHIKI_THEME_DARK: CuratedCodeThemeId = 'dark-plus';
const SHIKI_THEME_LIGHT: CuratedCodeThemeId = 'light-plus';
const SHIKI_THEME_LOADERS: Record<CuratedCodeThemeId, () => Promise<ThemeInput>> = {
  'dark-plus': async () => (await import('@shikijs/themes/dark-plus')).default,
  'light-plus': async () => (await import('@shikijs/themes/light-plus')).default,
  'material-theme-darker': async () => (await import('@shikijs/themes/material-theme-darker')).default,
  'material-theme-lighter': async () => (await import('@shikijs/themes/material-theme-lighter')).default,
  monokai: async () => (await import('@shikijs/themes/monokai')).default,
  'tokyo-night': async () => (await import('@shikijs/themes/tokyo-night')).default,
};
const SHIKI_LANG_LOADERS: Record<string, () => Promise<LanguageInput>> = {
  typescript: async () => (await import('@shikijs/langs/typescript')).default,
  tsx: async () => (await import('@shikijs/langs/tsx')).default,
  javascript: async () => (await import('@shikijs/langs/javascript')).default,
  jsx: async () => (await import('@shikijs/langs/jsx')).default,
  json: async () => (await import('@shikijs/langs/json')).default,
  go: async () => (await import('@shikijs/langs/go')).default,
  c: async () => (await import('@shikijs/langs/c')).default,
  cpp: async () => (await import('@shikijs/langs/cpp')).default,
  shellscript: async () => (await import('@shikijs/langs/shellscript')).default,
  yaml: async () => (await import('@shikijs/langs/yaml')).default,
  markdown: async () => (await import('@shikijs/langs/markdown')).default,
  diff: async () => (await import('@shikijs/langs/diff')).default,
  html: async () => (await import('@shikijs/langs/html')).default,
  python: async () => (await import('@shikijs/langs/python')).default,
  powershell: async () => (await import('@shikijs/langs/powershell')).default,
};
const INLINE_CACHE_LIMIT = 4000;
const inlineCache = new Map<string, string>();
const loadedThemes = new Set<string>();
const loadedLanguages = new Set<string>(['text']);

let highlighterPromise: Promise<HighlighterCore> | null = null;

function resolveTheme(themeMode: ThemeMode, codeTheme: CodeThemeId): CuratedCodeThemeId {
  if (codeTheme === 'auto-plus') {
    return themeMode === 'light' ? SHIKI_THEME_LIGHT : SHIKI_THEME_DARK;
  }
  return codeTheme;
}

function resolveLanguage(language: string): string {
  const normalized = (language || '').trim().toLowerCase();
  switch (normalized) {
    case 'clike':
      return 'c';
    case 'markup':
      return 'html';
    default:
      return normalized || 'text';
  }
}

function appendStyle(node: any, styleText: string): void {
  if (!styleText) return;
  const current = typeof node?.properties?.style === 'string' ? node.properties.style.trim() : '';
  node.properties = node.properties || {};
  node.properties.style = current ? `${current};${styleText}` : styleText;
}

function buildLineTransformer(
  wrap: boolean,
  lineNumbers: boolean,
  codeFont: CodeFontId,
  codeFontSize: number,
  codeLineHeight: number,
  codeTabSize: number,
  diffLines?: DiffRenderLine[],
  highlightedLines?: Set<number>,
  lineOffset = 0,
): ShikiTransformer {
  const fontFamily = resolveCodeFontFamily(codeFont);
  const fontSize = `${codeFontSize}px`;
  const lineContentStyle = wrap
    ? `display:block;min-width:0;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;tab-size:${codeTabSize};font-family:${fontFamily};font-size:${fontSize};line-height:${codeLineHeight};`
    : `display:block;min-width:0;white-space:pre;tab-size:${codeTabSize};font-family:${fontFamily};font-size:${fontSize};line-height:${codeLineHeight};`;

  return {
    name: 'wm-line-layout',
    pre(hast) {
      this.addClassToHast(hast, ['wm-shiki-pre', wrap ? 'wm-shiki-wrap' : 'wm-shiki-nowrap']);
      appendStyle(hast, `margin:0;padding:0;border-radius:0;white-space:normal;overflow-x:${wrap ? 'hidden' : 'auto'};font-family:${fontFamily};font-size:${fontSize};line-height:${codeLineHeight};`);
    },
    code(hast) {
      this.addClassToHast(hast, 'wm-shiki-code');
      appendStyle(hast, wrap ? `display:block;min-width:100%;white-space:normal;tab-size:${codeTabSize};` : `display:block;min-width:100%;width:max-content;white-space:normal;tab-size:${codeTabSize};`);
    },
    line(hast, line) {
      const diffLine = diffLines?.[line - 1];
      const originalChildren = Array.isArray(hast.children) ? hast.children : [];
      const lineContentChildren = originalChildren.length > 0
        ? originalChildren
        : [{type: 'text' as const, value: ' '}];
      const contentNode = {
        type: 'element' as const,
        tagName: 'span',
        properties: {
          className: ['wm-shiki-line-content'],
          style: lineContentStyle,
        },
        children: lineContentChildren as any[],
      };

      hast.properties = hast.properties || {};
      if (diffLine) {
        const normalizedLineNumber = diffLine.newLineNumber ?? diffLine.oldLineNumber ?? diffLine.lineNumber;
        const renderedLineNumber = normalizedLineNumber === null ? '' : String(normalizedLineNumber);
        this.addClassToHast(hast, ['wm-shiki-diff-line', `wm-shiki-diff-${diffLine.kind}`]);
        hast.properties['data-line'] = renderedLineNumber;
        hast.properties['data-line-kind'] = diffLine.kind;
        hast.properties['data-line-number'] = renderedLineNumber;
        if (diffLine.separator) {
          hast.properties['data-separator'] = diffLine.separator;
        }
      } else {
        hast.properties['data-line'] = String(line + lineOffset);
        hast.properties['data-line-number'] = String(line + lineOffset);
      }

      if (lineNumbers) {
        if (diffLine) {
          const oldLineLabel = diffLine.oldLineNumber === null || diffLine.oldLineNumber === undefined ? '' : String(diffLine.oldLineNumber);
          const newLineLabel = diffLine.newLineNumber === null || diffLine.newLineNumber === undefined ? '' : String(diffLine.newLineNumber);
          const marker = diffLine.kind === 'added' ? '+' : diffLine.kind === 'removed' ? '-' : ' ';
          const markerClassName = diffLine.kind === 'added'
            ? 'wm-shiki-diff-marker-added'
            : diffLine.kind === 'removed'
              ? 'wm-shiki-diff-marker-removed'
              : 'wm-shiki-diff-marker-context';
          const diffGutterNode = {
            type: 'element' as const,
            tagName: 'span',
            properties: {
              className: ['wm-shiki-diff-gutter'],
              'aria-hidden': 'true',
            },
            children: [
              {
                type: 'element' as const,
                tagName: 'span',
                properties: {className: ['wm-shiki-diff-marker', markerClassName]},
                children: [{type: 'text' as const, value: marker}],
              },
              {
                type: 'element' as const,
                tagName: 'span',
                properties: {className: ['wm-shiki-line-number', 'wm-shiki-diff-line-number-old']},
                children: [{type: 'text' as const, value: oldLineLabel}],
              },
              {
                type: 'element' as const,
                tagName: 'span',
                properties: {className: ['wm-shiki-line-number', 'wm-shiki-diff-line-number-new']},
                children: [{type: 'text' as const, value: newLineLabel}],
              },
            ],
          };
          hast.children = [diffGutterNode as any, contentNode as any];
          appendStyle(hast, 'display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;');
        } else {
          const lineLabel = String(line + lineOffset);
          const lineNumberNode = {
            type: 'element' as const,
            tagName: 'span',
            properties: {
              className: ['wm-shiki-line-number'],
              'aria-hidden': 'true',
              style: 'display:inline-block;min-width:3.5em;padding-right:1em;text-align:right;user-select:none;color:var(--muted);opacity:0.75;',
            },
            children: [{type: 'text' as const, value: lineLabel}],
          };
          hast.children = [lineNumberNode as any, contentNode as any];
          appendStyle(hast, 'display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;');
        }
      } else {
        if (diffLine) {
          const marker = diffLine.kind === 'added' ? '+' : diffLine.kind === 'removed' ? '-' : ' ';
          const markerClassName = diffLine.kind === 'added'
            ? 'wm-shiki-diff-marker-added'
            : diffLine.kind === 'removed'
              ? 'wm-shiki-diff-marker-removed'
              : 'wm-shiki-diff-marker-context';
          const diffMarkerNode = {
            type: 'element' as const,
            tagName: 'span',
            properties: {
              className: ['wm-shiki-diff-marker', markerClassName],
              'aria-hidden': 'true',
            },
            children: [{type: 'text' as const, value: marker}],
          };
          hast.children = [diffMarkerNode as any, contentNode as any];
          appendStyle(hast, 'display:grid;grid-template-columns:1.5em minmax(0,1fr);align-items:start;');
        } else {
          hast.children = [contentNode as any];
        }
      }

      if (highlightedLines && highlightedLines.has(line + lineOffset)) {
        this.addClassToHast(hast, 'wm-line-target');
      }

      return hast;
    },
  };
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [darkTheme, lightTheme] = await Promise.all([
        SHIKI_THEME_LOADERS['dark-plus'](),
        SHIKI_THEME_LOADERS['light-plus'](),
      ]);
      loadedThemes.add('dark-plus');
      loadedThemes.add('light-plus');
      return createHighlighterCore({
        engine: createJavaScriptRegexEngine(),
        themes: [darkTheme, lightTheme],
        langs: [],
      });
    })();
  }
  return highlighterPromise;
}

async function ensureThemeLoaded(highlighter: HighlighterCore, theme: CuratedCodeThemeId): Promise<void> {
  if (loadedThemes.has(theme)) return;
  const loader = SHIKI_THEME_LOADERS[theme];
  if (!loader) return;
  const registration = await loader();
  await highlighter.loadTheme(registration);
  loadedThemes.add(theme);
}

async function ensureLanguageLoaded(highlighter: HighlighterCore, language: string): Promise<void> {
  if (loadedLanguages.has(language)) return;
  const loader = SHIKI_LANG_LOADERS[language];
  if (!loader) return;
  const registration = await loader();
  await highlighter.loadLanguage(registration);
  loadedLanguages.add(language);
}

function getInlineCacheKey(options: RenderShikiOptions, lang: string, theme: string): string {
  return `${theme}|${lang}|${options.wrap ? 1 : 0}|${options.codeFont}|${options.codeFontSize}|${options.codeLineHeight}|${options.codeTabSize}|${options.code}`;
}

function setInlineCache(key: string, value: string): void {
  inlineCache.set(key, value);
  if (inlineCache.size <= INLINE_CACHE_LIMIT) return;
  const oldest = inlineCache.keys().next().value as string | undefined;
  if (oldest) inlineCache.delete(oldest);
}

function renderWithHighlighter(
  highlighter: HighlighterCore,
  code: string,
  lang: string,
  theme: string,
  wrap: boolean,
  lineNumbers: boolean,
  codeFont: CodeFontId,
  codeFontSize: number,
  codeLineHeight: number,
  codeTabSize: number,
  mode: RenderMode,
  diffLines?: DiffRenderLine[],
  highlightedLines?: Set<number>,
): string {
  const normalizedCode = code || ' ';
  if (mode === 'inline') {
    return highlighter.codeToHtml(normalizedCode, {
      lang,
      theme,
      structure: 'inline',
    });
  }
  return highlighter.codeToHtml(normalizedCode, {
    lang,
    theme,
    structure: 'classic',
    transformers: [buildLineTransformer(
      wrap,
      lineNumbers,
      codeFont,
      codeFontSize,
      codeLineHeight,
      codeTabSize,
      diffLines,
      highlightedLines,
    )],
  });
}

export async function renderShikiHtml(options: RenderShikiOptions): Promise<string> {
  const language = resolveLanguage(options.language);
  const theme = resolveTheme(options.themeMode, options.codeTheme);
  const highlighter = await getHighlighter();
  try {
    await ensureThemeLoaded(highlighter, theme);
  } catch {
    // fall through with already loaded default themes
  }
  const langCandidates = language === 'text' ? ['text'] : [language, 'text'];

  let inlineCacheKey = '';
  if (options.mode === 'inline') {
    inlineCacheKey = getInlineCacheKey(options, language, theme);
    const cached = inlineCache.get(inlineCacheKey);
    if (cached) return cached;
  }

  for (const lang of langCandidates) {
    try {
      await ensureLanguageLoaded(highlighter, lang);
      const html = renderWithHighlighter(
        highlighter,
        options.code,
        lang,
        theme,
        options.wrap,
        options.lineNumbers,
        options.codeFont,
        options.codeFontSize,
        options.codeLineHeight,
        options.codeTabSize,
        options.mode,
        undefined,
        options.highlightedLines,
      );
      if (options.mode === 'inline') {
        setInlineCache(inlineCacheKey, html);
      }
      return html;
    } catch {
      // Try fallback language.
    }
  }

  return `<span>${escapeHtml(options.code || ' ')}</span>`;
}

export async function renderShikiDiffHtml(options: RenderShikiDiffOptions): Promise<string> {
  const language = resolveLanguage(options.language);
  const theme = resolveTheme(options.themeMode, options.codeTheme);
  const highlighter = await getHighlighter();
  try {
    await ensureThemeLoaded(highlighter, theme);
  } catch {
    // fall through with already loaded default themes
  }

  const langCandidates = language === 'text' ? ['text'] : [language, 'text'];
  const code = options.lines.length > 0
    ? options.lines.map(line => (line.code.length > 0 ? line.code : ' ')).join('\n')
    : ' ';

  for (const lang of langCandidates) {
    try {
      await ensureLanguageLoaded(highlighter, lang);
      return renderWithHighlighter(
        highlighter,
        code,
        lang,
        theme,
        options.wrap,
        options.lineNumbers,
        options.codeFont,
        options.codeFontSize,
        options.codeLineHeight,
        options.codeTabSize,
        'block',
        options.lines,
      );
    } catch {
      // Try fallback language.
    }
  }

  return `<pre><code>${escapeHtml(code)}</code></pre>`;
}

function tokenFontStyleToCSS(fontStyle: number): string {
  const parts: string[] = [];
  if (fontStyle & 1) parts.push('font-style:italic');
  if (fontStyle & 2) parts.push('font-weight:bold');
  if (fontStyle & 4) parts.push('text-decoration:underline');
  return parts.join(';');
}

export type ShikiTokenizeResult = {
  tokens: ThemedToken[][];
  fg: string;
  bg: string;
  themeName: string;
};

export async function tokenizeShikiCode(
  code: string,
  language: string,
  themeMode: ThemeMode,
  codeTheme: CodeThemeId,
): Promise<ShikiTokenizeResult> {
  const resolvedLang = resolveLanguage(language);
  const resolvedTheme = resolveTheme(themeMode, codeTheme);
  const highlighter = await getHighlighter();
  try {
    await ensureThemeLoaded(highlighter, resolvedTheme);
  } catch {
    // fall through with already loaded default themes
  }
  const langCandidates = resolvedLang === 'text' ? ['text'] : [resolvedLang, 'text'];
  for (const lang of langCandidates) {
    try {
      await ensureLanguageLoaded(highlighter, lang);
      const result = highlighter.codeToTokens(code || ' ', {
        lang,
        theme: resolvedTheme,
      });
      return {
        tokens: result.tokens,
        fg: result.fg || 'inherit',
        bg: result.bg || 'inherit',
        themeName: result.themeName || '',
      };
    } catch {
      // Try fallback language.
    }
  }
  const lines = (code || ' ').split('\n');
  return {
    tokens: lines.map(line => [{content: line, fontStyle: 0, offset: 0}]),
    fg: 'inherit',
    bg: 'inherit',
    themeName: '',
  };
}

export function renderChunkHtmlFromTokens(
  chunkTokens: ThemedToken[][],
  startLine: number,
  fg: string,
  bg: string,
  themeName: string,
  wrap: boolean,
  lineNumbers: boolean,
  codeFont: CodeFontId,
  codeFontSize: number,
  codeLineHeight: number,
  codeTabSize: number,
  highlightedLines?: Set<number>,
): string {
  const fontFamily = resolveCodeFontFamily(codeFont);
  const fontSize = `${codeFontSize}px`;
  const preClass = `wm-shiki-pre ${wrap ? 'wm-shiki-wrap' : 'wm-shiki-nowrap'}`;
  const preStyle = `margin:0;padding:0;border-radius:0;white-space:normal;overflow-x:${wrap ? 'hidden' : 'auto'};font-family:${fontFamily};font-size:${fontSize};line-height:${codeLineHeight};background-color:${bg};color:${fg};`;
  const codeStyle = wrap
    ? `display:block;min-width:100%;white-space:normal;tab-size:${codeTabSize};`
    : `display:block;min-width:100%;width:max-content;white-space:normal;tab-size:${codeTabSize};`;
  const lineContentStyle = wrap
    ? `display:block;min-width:0;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;tab-size:${codeTabSize};font-family:${fontFamily};font-size:${fontSize};line-height:${codeLineHeight};`
    : `display:block;min-width:0;white-space:pre;tab-size:${codeTabSize};font-family:${fontFamily};font-size:${fontSize};line-height:${codeLineHeight};`;

  const lines: string[] = [];
  for (let i = 0; i < chunkTokens.length; i++) {
    const absLine = startLine + i + 1;
    const lineTokens = chunkTokens[i];
    const isHighlighted = highlightedLines?.has(absLine);

    let spans = '';
    for (const token of lineTokens) {
      const tokenStyle = token.color
        ? `color:${token.color}${token.fontStyle ? ';' + tokenFontStyleToCSS(token.fontStyle) : ''}`
        : token.fontStyle ? tokenFontStyleToCSS(token.fontStyle) : '';
      const escaped = escapeHtml(token.content);
      spans += tokenStyle ? `<span style="${tokenStyle}">${escaped}</span>` : escaped;
    }
    if (!spans) spans = ' ';

    const lineClass = isHighlighted ? ' wm-line-target' : '';
    const dataAttr = `data-line="${absLine}" data-line-number="${absLine}"`;

    if (lineNumbers) {
      const lineLabel = String(absLine);
      lines.push(
        `<span class="line${lineClass}" ${dataAttr} style="display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;">` +
        `<span class="wm-shiki-line-number" aria-hidden="true" style="display:inline-block;min-width:3.5em;padding-right:1em;text-align:right;user-select:none;color:var(--muted);opacity:0.75;">${lineLabel}</span>` +
        `<span class="wm-shiki-line-content" style="${lineContentStyle}">${spans}</span>` +
        `</span>`
      );
    } else {
      lines.push(
        `<span class="line${lineClass}" ${dataAttr} style="display:block;">` +
        `<span class="wm-shiki-line-content" style="${lineContentStyle}">${spans}</span>` +
        `</span>`
      );
    }
  }

  return `<pre class="${preClass} shiki ${themeName}" style="${preStyle}"><code class="wm-shiki-code" style="${codeStyle}">${lines.join('\n')}</code></pre>`;
}
