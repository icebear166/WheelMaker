import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  resolveCodeFontFamily,
  type CodeFontId,
  type CodeThemeId,
} from './shikiSettings';
import { CodeBlockFrame } from './CodeBlockFrame';
import type {ThemedToken} from '@shikijs/types';

type ThemeMode = 'dark' | 'light';
type GitDiffRowsModule = typeof import('../git/diffRows');

const VS_CODE_EDITOR_FONT_FAMILY = "Consolas, 'Courier New', monospace";
const VIRTUALIZE_LINE_THRESHOLD = 2000;
const INCREMENTAL_CHARACTER_THRESHOLD = 80_000;
const CHUNK_SIZE = 50;

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
  /** Wrap the block in a framed card with a language label and copy button. */
  framed?: boolean;
  highlightedLines?: Set<number>;
  /** Export/share rendering: light/dark CSS variable colors, never virtualized. */
  adaptiveCodeTheme?: boolean;
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

function useLineClick(onLineClick?: (line: number, event: MouseEvent) => void) {
  return useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onLineClick) return;
      const target = e.target as HTMLElement;
      const lineNumberEl = target.closest<HTMLElement>('.wm-shiki-line-number');
      if (!lineNumberEl) return;
      const lineEl = lineNumberEl.closest<HTMLElement>('[data-line-number]');
      if (!lineEl) return;
      const lineNum = Number(lineEl.dataset.lineNumber);
      if (Number.isFinite(lineNum)) {
        onLineClick(lineNum, e.nativeEvent);
      }
    },
    [onLineClick],
  );
}

type TokenChunkState = {
  tokens: ThemedToken[][];
  fg: string;
  bg: string;
  themeName: string;
  startLine: number;
};

function countCodeLines(content: string): number {
  if (!content) return 0;
  let count = 1;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') count++;
  }
  return count;
}

function firstCodeLines(content: string, lineLimit: number): string {
  let end = 0;
  for (let line = 0; line < lineLimit; line++) {
    end = content.indexOf('\n', end);
    if (end < 0) return content;
    end += 1;
  }
  return content.slice(0, Math.max(0, end - 1));
}

function ShikiCodeBlockVirtualized({
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
  framed,
  highlightedLines,
  onLineClick,
}: ShikiCodeBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const totalLines = useMemo(() => countCodeLines(content), [content]);
  const totalChunks = Math.ceil(totalLines / CHUNK_SIZE);
  const [tokenChunks, setTokenChunks] = useState<Map<number, TokenChunkState>>(new Map());
  const [chunkHtmls, setChunkHtmls] = useState<Map<number, string>>(new Map());
  const [visibleChunks, setVisibleChunks] = useState<Set<number>>(() => new Set([0]));
  const [tokenizeFailed, setTokenizeFailed] = useState(false);
  const initialFallbackHtml = useMemo(
    () => renderPlainCodeFallbackHtml({
      content: firstCodeLines(content, CHUNK_SIZE),
      wrap,
      lineNumbers,
      codeFont,
      codeFontSize,
      codeLineHeight,
      codeTabSize,
    }),
    [content, wrap, lineNumbers, codeFont, codeFontSize, codeLineHeight, codeTabSize],
  );

  useEffect(() => {
    const controller = new AbortController();
    setTokenChunks(new Map());
    setChunkHtmls(new Map());
    setVisibleChunks(new Set([0]));
    setTokenizeFailed(false);
    (async () => {
      const {tokenizeShikiCodeInChunks} = await loadShikiRenderer();
      if (controller.signal.aborted) return;
      await tokenizeShikiCodeInChunks(content, language, themeMode, codeTheme, {
        chunkLines: CHUNK_SIZE,
        signal: controller.signal,
        onChunk: chunk => {
          if (controller.signal.aborted) return;
          const chunkIndex = Math.floor(chunk.startLine / CHUNK_SIZE);
          setTokenChunks(previous => {
            const next = new Map(previous);
            next.set(chunkIndex, {
              tokens: chunk.tokens,
              fg: chunk.fg,
              bg: chunk.bg,
              themeName: chunk.themeName,
              startLine: chunk.startLine,
            });
            return next;
          });
        },
      });
    })().catch(error => {
      if (!controller.signal.aborted && !(error instanceof Error && error.name === 'AbortError')) {
        setTokenizeFailed(true);
      }
    });
    return () => {
      controller.abort();
    };
  }, [content, language, themeMode, codeTheme]);

  const lineHeightPx = Math.max(12, codeFontSize * codeLineHeight);
  // Framed blocks on the automatic code theme drop the pre background so the
  // frame surface shows through as one continuous card.
  const transparentBackground = Boolean(framed && codeTheme === 'auto-plus');

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    if (typeof IntersectionObserver === 'undefined') {
      setVisibleChunks(new Set(Array.from({length: totalChunks}, (_, index) => index)));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      setVisibleChunks(previous => {
        const next = new Set(previous);
        let changed = false;
        for (const entry of entries) {
          const chunkIndex = Number((entry.target as HTMLElement).dataset.chunkSentinel);
          if (!Number.isFinite(chunkIndex)) continue;
          if (entry.isIntersecting && !next.has(chunkIndex)) {
            next.add(chunkIndex);
            changed = true;
          } else if (!entry.isIntersecting && next.delete(chunkIndex)) {
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    }, {rootMargin: `${CHUNK_SIZE * lineHeightPx * 2}px`});

    const sentinels = container.querySelectorAll<HTMLElement>('[data-chunk-sentinel]');
    sentinels.forEach(el => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, [totalChunks, lineHeightPx]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {renderChunkHtmlFromTokens} = await loadShikiRenderer();
      if (cancelled) return;
      const rendered = new Map<number, string>();
      for (const chunkIndex of visibleChunks) {
        const chunk = tokenChunks.get(chunkIndex);
        if (!chunk) continue;
        rendered.set(chunkIndex, renderChunkHtmlFromTokens(
          chunk.tokens,
          chunk.startLine,
          chunk.fg,
          chunk.bg,
          chunk.themeName,
          wrap,
          lineNumbers,
          codeFont,
          codeFontSize,
          codeLineHeight,
          codeTabSize,
          highlightedLines,
          transparentBackground,
        ));
      }
      if (cancelled) return;
      setChunkHtmls(previous => {
        let changed = previous.size !== rendered.size;
        if (!changed) {
          for (const [chunkIndex, html] of rendered) {
            if (previous.get(chunkIndex) !== html) {
              changed = true;
              break;
            }
          }
        }
        return changed ? rendered : previous;
      });
    })().catch(() => {
      if (!cancelled) setTokenizeFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [tokenChunks, visibleChunks, wrap, lineNumbers, codeFont, codeFontSize, codeLineHeight, codeTabSize, highlightedLines, transparentBackground]);

  const handleClick = useLineClick(onLineClick);

  if (tokenizeFailed) {
    return (
      <div className="code-wrap" data-shiki-render-failed="true">
        <div className="muted block">Failed to tokenize file.</div>
      </div>
    );
  }

  const chunks: React.ReactNode[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const html = visibleChunks.has(i) ? chunkHtmls.get(i) : undefined;
    const fallbackHtml = i === 0 && visibleChunks.has(i) && !tokenChunks.has(i)
      ? initialFallbackHtml
      : undefined;
    const renderedHtml = html ?? fallbackHtml;
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalLines);
    const height = (end - start) * lineHeightPx;
    chunks.push(
      <div
        key={i}
        data-chunk-sentinel={i}
        style={renderedHtml ? undefined : {height: `${height}px`}}
        dangerouslySetInnerHTML={renderedHtml ? {__html: renderedHtml} : undefined}
      />,
    );
  }

  return (
    <div
      ref={containerRef}
      className={`code-wrap ${wrap ? 'wrap' : 'nowrap'}`}
      data-markdown-export-pending={tokenChunks.size < totalChunks ? 'true' : undefined}
      onClick={onLineClick ? handleClick : undefined}
    >
      {chunks}
    </div>
  );
}

export function ShikiCodeBlock(props: ShikiCodeBlockProps) {
  const lineCount = useMemo(() => countCodeLines(props.content), [props.content]);

  // Adaptive (export/share) rendering is one-shot and offscreen, so chunked
  // virtualization is skipped entirely in favor of a single full render.
  const block = !props.adaptiveCodeTheme &&
    (lineCount >= VIRTUALIZE_LINE_THRESHOLD ||
      props.content.length >= INCREMENTAL_CHARACTER_THRESHOLD)
      ? <ShikiCodeBlockVirtualized {...props} />
      : <ShikiCodeBlockSmall {...props} />;

  if (!props.framed) {
    return block;
  }
  return (
    <CodeBlockFrame language={props.language} content={props.content}>
      {block}
    </CodeBlockFrame>
  );
}

function ShikiCodeBlockSmall({
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
  framed,
  highlightedLines,
  adaptiveCodeTheme,
  onLineClick,
}: ShikiCodeBlockProps) {
  const [html, setHtml] = useState('');
  const [renderFailed, setRenderFailed] = useState(false);
  const transparentBackground = Boolean(framed && codeTheme === 'auto-plus');
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
        highlightedLines,
        transparentBackground,
        adaptiveCodeTheme,
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
    highlightedLines,
    transparentBackground,
    adaptiveCodeTheme,
  ]);

  const handleClick = useLineClick(onLineClick);

  return (
    <div
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
