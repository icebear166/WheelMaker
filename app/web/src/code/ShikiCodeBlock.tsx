import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  resolveCodeFontFamily,
  type CodeFontId,
  type CodeThemeId,
} from './shikiSettings';

type ThemeMode = 'dark' | 'light';
type GitDiffRowsModule = typeof import('../git/diffRows');

const VS_CODE_EDITOR_FONT_FAMILY = "Consolas, 'Courier New', monospace";

let shikiRendererModulePromise: Promise<typeof import('./shikiRenderer')> | null = null;
let gitDiffRowsModulePromise: Promise<GitDiffRowsModule> | null = null;

function loadShikiRenderer(): Promise<typeof import('./shikiRenderer')> {
  if (!shikiRendererModulePromise) {
    shikiRendererModulePromise = import('./shikiRenderer')
      .catch(error => {
        shikiRendererModulePromise = null;
        throw error;
      });
  }
  return shikiRendererModulePromise;
}

export function preloadShikiRenderer(): void {
  loadShikiRenderer().catch(() => undefined);
}

const loadGitDiffRows = () => {
  if (!gitDiffRowsModulePromise) {
    gitDiffRowsModulePromise = import(/* webpackChunkName: "git-diff" */ '../git/diffRows');
  }
  return gitDiffRowsModulePromise;
};

function escapeFallbackHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export type ShikiCodeBlockProps = {
  content: string;
  language: string;
  wrap: boolean;
  lineNumbers: boolean;
  themeMode: ThemeMode;
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
  highlightedLines?: Set<number>;
  onLineClick?: (line: number, event: MouseEvent) => void;
};

function renderPlainCodeFallbackHtml({
  content,
  wrap,
  lineNumbers,
  codeFont,
  codeFontSize,
  codeLineHeight,
  codeTabSize,
}: Pick<ShikiCodeBlockProps, 'content' | 'wrap' | 'lineNumbers' | 'codeFont' | 'codeFontSize' | 'codeLineHeight' | 'codeTabSize'>): string {
  const fontFamily = resolveCodeFontFamily(codeFont);
  const fontSize = `${codeFontSize}px`;
  const preClassName = `wm-shiki-pre ${wrap ? 'wm-shiki-wrap' : 'wm-shiki-nowrap'}`;
  const preStyle = `margin:0;padding:0;border-radius:0;white-space:normal;overflow-x:${wrap ? 'hidden' : 'auto'};font-family:${fontFamily};font-size:${fontSize};line-height:${codeLineHeight};`;
  const codeStyle = wrap
    ? `display:block;min-width:100%;white-space:normal;tab-size:${codeTabSize};`
    : `display:block;min-width:100%;width:max-content;white-space:normal;tab-size:${codeTabSize};`;
  const lineContentStyle = wrap
    ? `display:block;min-width:0;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;tab-size:${codeTabSize};font-family:${fontFamily};font-size:${fontSize};line-height:${codeLineHeight};`
    : `display:block;min-width:0;white-space:pre;tab-size:${codeTabSize};font-family:${fontFamily};font-size:${fontSize};line-height:${codeLineHeight};`;
  const escapedContent = escapeFallbackHtml(content || ' ');

  if (!lineNumbers) {
    return `<pre class="${preClassName}" data-shiki-fallback="true" style="${preStyle}"><code class="wm-shiki-code" style="${codeStyle}"><span class="wm-shiki-line-content" style="${lineContentStyle}">${escapedContent}</span></code></pre>`;
  }

  const lines = (content || ' ').split('\n');
  const renderedLines = lines.map((line, index) => {
    const lineNumber = String(index + 1);
    const escapedLine = escapeFallbackHtml(line || ' ');
    return `<span data-line="${lineNumber}" data-line-number="${lineNumber}" style="display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;"><span class="wm-shiki-line-number" aria-hidden="true" style="display:inline-block;min-width:3.5em;padding-right:1em;text-align:right;user-select:none;color:var(--muted);opacity:0.75;">${lineNumber}</span><span class="wm-shiki-line-content" style="${lineContentStyle}">${escapedLine}</span></span>`;
  }).join('');

  return `<pre class="${preClassName}" data-shiki-fallback="true" style="${preStyle}"><code class="wm-shiki-code" style="${codeStyle}">${renderedLines}</code></pre>`;
}

export function ShikiCodeBlock({
  content,
  language,
  wrap,
  lineNumbers,
  themeMode,
  codeTheme,
  codeFont,
  codeFontSize,
  codeLineHeight,
  codeTabSize,
  highlightedLines,
  onLineClick,
}: ShikiCodeBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState('');
  const [renderFailed, setRenderFailed] = useState(false);
  const fallbackHtml = useMemo(
    () => renderPlainCodeFallbackHtml({
      content,
      wrap,
      lineNumbers,
      codeFont,
      codeFontSize,
      codeLineHeight,
      codeTabSize,
    }),
    [
      content,
      wrap,
      lineNumbers,
      codeFont,
      codeFontSize,
      codeLineHeight,
      codeTabSize,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    setHtml('');
    setRenderFailed(false);
    (async () => {
      const { renderShikiHtml } = await loadShikiRenderer();
      const nextHtml = await renderShikiHtml({
        code: content,
        language,
        themeMode,
        codeTheme,
        codeFont,
        codeFontSize,
        codeLineHeight,
        codeTabSize,
        wrap,
        lineNumbers,
        mode: 'block',
      });
      if (!cancelled) {
        setHtml(nextHtml);
      }
    })().catch(() => {
      if (!cancelled) {
        setHtml('');
        setRenderFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    content,
    language,
    themeMode,
    codeTheme,
    codeFont,
    codeFontSize,
    codeLineHeight,
    codeTabSize,
    wrap,
    lineNumbers,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const lineElements = container.querySelectorAll<HTMLElement>('[data-line-number]');
    for (const el of lineElements) {
      const lineNum = Number(el.dataset.lineNumber);
      if (highlightedLines && highlightedLines.has(lineNum)) {
        el.classList.add('wm-line-target');
      } else {
        el.classList.remove('wm-line-target');
      }
    }
  }, [html, fallbackHtml, highlightedLines]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onLineClick) return;
      const target = e.target as HTMLElement;
      const lineEl = target.closest<HTMLElement>('[data-line-number]');
      if (!lineEl) return;
      const lineNum = Number(lineEl.dataset.lineNumber);
      if (Number.isFinite(lineNum)) {
        onLineClick(lineNum, e.nativeEvent);
      }
    },
    [onLineClick],
  );

  return (
    <div
      ref={containerRef}
      className={`code-wrap ${wrap ? 'wrap' : 'nowrap'}`}
      data-markdown-export-pending={html || renderFailed ? undefined : 'true'}
      data-shiki-render-failed={renderFailed ? 'true' : undefined}
      dangerouslySetInnerHTML={{ __html: html || fallbackHtml }}
      onClick={onLineClick ? handleClick : undefined}
    />
  );
}

export type ShikiDiffPaneProps = {
  content: string;
  language: string;
  wrap: boolean;
  lineNumbers: boolean;
  themeMode: ThemeMode;
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontFamily: string;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
};

export function ShikiDiffPane({
  content,
  language,
  wrap,
  lineNumbers,
  themeMode,
  codeTheme,
  codeFont,
  codeFontFamily,
  codeFontSize,
  codeLineHeight,
  codeTabSize,
}: ShikiDiffPaneProps) {
  const [diffHtml, setDiffHtml] = useState('');
  const [diffRenderState, setDiffRenderState] = useState<'loading' | 'empty' | 'ready'>('loading');

  useEffect(() => {
    let cancelled = false;

    setDiffHtml('');
    setDiffRenderState('loading');
    (async () => {
      const {parseUnifiedDiffRenderLines} = await loadGitDiffRows();
      const lines = parseUnifiedDiffRenderLines(content);
      if (cancelled) {
        return;
      }
      if (lines.length === 0) {
        setDiffRenderState('empty');
        return;
      }
      setDiffRenderState('ready');
      const { renderShikiDiffHtml } = await loadShikiRenderer();
      const nextDiffHtml = await renderShikiDiffHtml({
        lines,
        language,
        themeMode,
        codeTheme,
        codeFont,
        codeFontSize,
        codeLineHeight,
        codeTabSize,
        wrap,
        lineNumbers,
      });
      if (!cancelled) {
        setDiffHtml(nextDiffHtml);
      }
    })().catch(() => {
      if (!cancelled) {
        setDiffRenderState('ready');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    content,
    language,
    themeMode,
    codeTheme,
    codeFont,
    codeFontSize,
    codeLineHeight,
    codeTabSize,
    wrap,
    lineNumbers,
  ]);

  if (diffRenderState === 'empty')
    return <div className="muted block">No diff hunks available</div>;

  const diffStyle = {
    fontFamily: codeFontFamily || VS_CODE_EDITOR_FONT_FAMILY,
    fontSize: `${codeFontSize}px`,
    lineHeight: String(codeLineHeight),
    tabSize: String(codeTabSize),
  };

  return (
    <div className={`code-wrap diff-wrap ${wrap ? 'wrap' : 'nowrap'}`}>
      <div
        className={`diff-inline ${wrap ? 'wrap' : 'nowrap'}`}
        style={diffStyle}
        dangerouslySetInnerHTML={{__html: diffHtml || '<pre><code> </code></pre>'}}
      />
    </div>
  );
}
