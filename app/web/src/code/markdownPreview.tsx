import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {Icon} from '../common/Icon';
import {
  MERMAID_PAN_STEP,
  MERMAID_ZOOM_STEP,
  createMermaidViewport,
  mermaidViewportKeyAction,
  panMermaidViewport,
  setMermaidViewportScale,
} from './mermaidViewport';
import { ShikiCodeBlock } from './ShikiCodeBlock';
import {remarkWindowsFileLinks} from './markdownFileLinks';
import type { CodeFontId, CodeThemeId } from './shikiSettings';
import {markdownSourceTargetProps} from '../preview/previewLineNavigation';

type ThemeMode = 'dark' | 'light';
type MarkdownRemarkPlugins = NonNullable<React.ComponentProps<typeof ReactMarkdown>['remarkPlugins']>;
type MarkdownRehypePlugins = NonNullable<React.ComponentProps<typeof ReactMarkdown>['rehypePlugins']>;
type MarkdownMathPipeline = {
  remarkPlugins: MarkdownRemarkPlugins;
  rehypePlugins: MarkdownRehypePlugins;
};
type MarkdownCapabilityPlugins = MarkdownMathPipeline & {
  pending: boolean;
};

let mermaidRenderSequence = 0;
let mermaidModulePromise: Promise<typeof import('mermaid').default> | null = null;
let markdownMathPipeline: MarkdownMathPipeline | null = null;
let markdownMathPipelinePromise: Promise<MarkdownMathPipeline> | null = null;

const markdownMathPattern = /\\\(|\\\[|\$\$|(?:^|[^\\])\$(?:[^\s$\\]|[^\s$][^$\n]*[^\s$])\$/m;

function nextMermaidRenderId(): string {
  mermaidRenderSequence += 1;
  return `wm-mermaid-${mermaidRenderSequence}`;
}

function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid')
      .then(module => module.default)
      .catch(error => {
        mermaidModulePromise = null;
        throw error;
      });
  }
  return mermaidModulePromise;
}

function markdownNeedsMath(content: string): boolean {
  return markdownMathPattern.test(content);
}

function loadMarkdownMathPipeline(): Promise<MarkdownMathPipeline> {
  if (markdownMathPipeline) {
    return Promise.resolve(markdownMathPipeline);
  }
  if (!markdownMathPipelinePromise) {
    markdownMathPipelinePromise = Promise.all([
      import('remark-math'),
      import('rehype-katex'),
      import('katex/dist/katex.min.css'),
    ])
      .then(([remarkMathModule, rehypeKatexModule]) => {
        markdownMathPipeline = {
          remarkPlugins: [remarkMathModule.default],
          rehypePlugins: [rehypeKatexModule.default],
        };
        return markdownMathPipeline;
      })
      .catch(error => {
        markdownMathPipelinePromise = null;
        throw error;
      });
  }
  return markdownMathPipelinePromise;
}

export function useMarkdownCapabilityPlugins(content: string): MarkdownCapabilityPlugins {
  const needsMath = useMemo(() => markdownNeedsMath(content), [content]);
  const [loadedMathPipeline, setLoadedMathPipeline] = useState<MarkdownMathPipeline | null>(() =>
    needsMath ? markdownMathPipeline : null,
  );

  useEffect(() => {
    let cancelled = false;
    if (!needsMath) {
      setLoadedMathPipeline(null);
      return () => {
        cancelled = true;
      };
    }
    if (markdownMathPipeline) {
      setLoadedMathPipeline(markdownMathPipeline);
      return () => {
        cancelled = true;
      };
    }
    loadMarkdownMathPipeline()
      .then(pipeline => {
        if (!cancelled) {
          setLoadedMathPipeline(pipeline);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedMathPipeline(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsMath]);

  const activeMathPipeline = needsMath
    ? loadedMathPipeline ?? markdownMathPipeline
    : null;

  return useMemo(
    () => ({
      remarkPlugins: activeMathPipeline
        ? [remarkGfm, remarkWindowsFileLinks, ...activeMathPipeline.remarkPlugins]
        : [remarkGfm, remarkWindowsFileLinks],
      rehypePlugins: activeMathPipeline ? activeMathPipeline.rehypePlugins : [],
      pending: needsMath && !activeMathPipeline,
    }),
    [activeMathPipeline, needsMath],
  );
}

type MermaidBlockProps = {
  content: string;
  themeMode: ThemeMode;
};

export function MermaidBlock({ content, themeMode }: MermaidBlockProps) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [viewport, setViewport] = useState(createMermaidViewport);
  const [draggingSurface, setDraggingSurface] = useState<'inline' | 'modal' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalCanvasRef = useRef<HTMLDivElement>(null);
  const wasExpandedRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    viewport: ReturnType<typeof createMermaidViewport>;
    surface: 'inline' | 'modal';
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const source = content.trim();
    if (!source) {
      setSvg('');
      setError('Empty mermaid diagram');
      return () => {
        cancelled = true;
      };
    }

    setSvg('');
    setError('');
    setViewport(createMermaidViewport());
    setDraggingSurface(null);
    dragRef.current = null;

    (async () => {
      try {
        const mermaid = await loadMermaid();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: themeMode === 'light' ? 'default' : 'dark',
        });
        const renderId = nextMermaidRenderId();
        const { svg: nextSvg } = await mermaid.render(renderId, source);
        if (!cancelled) {
          setSvg(nextSvg || '');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [content, themeMode]);

  useEffect(() => {
    if (expanded) {
      closeButtonRef.current?.focus();
    } else if (wasExpandedRef.current) {
      expandButtonRef.current?.focus();
    }
    wasExpandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    if (!expanded || typeof window === 'undefined') return;
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setExpanded(false);
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [expanded]);

  type ViewportSurface = Pick<HTMLElement, 'getBoundingClientRect'>;

  const viewportRect = (surface?: ViewportSurface | null) =>
    surface?.getBoundingClientRect?.() ?? blockRef.current?.getBoundingClientRect() ?? null;

  const viewportAnchor = (
    surface: ViewportSurface | null | undefined,
    clientX: number,
    clientY: number,
  ) => {
    const rect = viewportRect(surface);
    if (!rect) return {x: 0, y: 0};
    return {x: clientX - rect.left, y: clientY - rect.top};
  };

  const keyboardZoomAnchor = (surface?: ViewportSurface | null) => {
    const rect = viewportRect(surface);
    if (!rect) return {x: 0, y: 0};
    return {x: rect.width / 2, y: rect.height / 2};
  };

  const zoomViewport = (direction: 1 | -1, anchor: {x: number; y: number}) => {
    setViewport(current => setMermaidViewportScale(
      current,
      current.scale + direction * MERMAID_ZOOM_STEP,
      anchor,
    ));
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>, surface: 'inline' | 'modal') => {
    if (
      !dragRef.current
      || dragRef.current.pointerId !== event.pointerId
      || dragRef.current.surface !== surface
    ) return;
    dragRef.current = null;
    setDraggingSurface(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    zoomViewport(
      event.deltaY < 0 ? 1 : -1,
      viewportAnchor(event.currentTarget, event.clientX, event.clientY),
    );
  };

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>, surface: 'inline' | 'modal') => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewport,
      surface,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraggingSurface(surface);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>, surface: 'inline' | 'modal') => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.surface !== surface) return;
    event.preventDefault();
    setViewport({
      ...drag.viewport,
      offsetX: drag.viewport.offsetX + event.clientX - drag.startX,
      offsetY: drag.viewport.offsetY + event.clientY - drag.startY,
    });
  };

  const handleViewportKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    surface?: ViewportSurface | null,
  ) => {
    const action = mermaidViewportKeyAction(event.key);
    if (!action) return;
    event.preventDefault();
    switch (action) {
      case 'zoom-in':
        zoomViewport(1, keyboardZoomAnchor(surface ?? event.currentTarget));
        break;
      case 'zoom-out':
        zoomViewport(-1, keyboardZoomAnchor(surface ?? event.currentTarget));
        break;
      case 'reset':
        dragRef.current = null;
        setDraggingSurface(null);
        setViewport(createMermaidViewport());
        break;
      case 'pan-left':
        setViewport(current => panMermaidViewport(current, -MERMAID_PAN_STEP, 0));
        break;
      case 'pan-right':
        setViewport(current => panMermaidViewport(current, MERMAID_PAN_STEP, 0));
        break;
      case 'pan-up':
        setViewport(current => panMermaidViewport(current, 0, -MERMAID_PAN_STEP));
        break;
      case 'pan-down':
        setViewport(current => panMermaidViewport(current, 0, MERMAID_PAN_STEP));
        break;
    }
  };

  const viewportTransform = `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.scale})`;
  const blockClassName = `mermaid-block${draggingSurface === 'inline' ? ' is-dragging' : ''}`;
  let body: React.ReactNode;

  if (error) {
    body = <div className="mermaid-error">{error}</div>;
  } else if (!svg) {
    body = (
      <div className="muted block" data-markdown-export-pending="true">
        Rendering mermaid diagram...
      </div>
    );
  } else {
    body = (
      <div
        className="mermaid-viewport"
        style={{transform: viewportTransform}}
        dangerouslySetInnerHTML={{__html: svg}}
      />
    );
  }

  const modal = expanded && svg && !error ? (
    <div
      className="mermaid-modal-overlay"
      onClick={event => {
        if (event.target === event.currentTarget) {
          setExpanded(false);
        }
      }}
    >
      <div
        className="mermaid-modal-dialog"
        role="dialog"
        aria-modal={true}
        aria-label="Mermaid diagram viewer"
        tabIndex={-1}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setExpanded(false);
            return;
          }
          handleViewportKeyDown(event, modalCanvasRef.current ?? event.currentTarget);
        }}
      >
        <div className="mermaid-modal-toolbar">
          <span className="mermaid-modal-title">Mermaid diagram</span>
          <button
            ref={closeButtonRef}
            type="button"
            className="mermaid-modal-close-button"
            aria-label="Close Mermaid diagram viewer"
            data-tooltip="Close diagram viewer"
            onClick={() => setExpanded(false)}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div
          ref={modalCanvasRef}
          className={`mermaid-modal-canvas${draggingSurface === 'modal' ? ' is-dragging' : ''}`}
          tabIndex={0}
          aria-label="Mermaid diagram canvas"
          onWheel={handleWheel}
          onPointerDown={event => beginDrag(event, 'modal')}
          onPointerMove={event => handlePointerMove(event, 'modal')}
          onPointerUp={event => finishDrag(event, 'modal')}
          onPointerCancel={event => finishDrag(event, 'modal')}
        >
          <div
            className="mermaid-modal-viewport"
            style={{transform: viewportTransform}}
            dangerouslySetInnerHTML={{__html: svg}}
          />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div
        ref={blockRef}
        className={blockClassName}
        tabIndex={0}
        role="region"
        aria-label="Mermaid diagram. Use the mouse wheel to zoom and drag to pan."
        onWheel={handleWheel}
        onPointerDown={event => beginDrag(event, 'inline')}
        onPointerMove={event => handlePointerMove(event, 'inline')}
        onPointerUp={event => finishDrag(event, 'inline')}
        onPointerCancel={event => finishDrag(event, 'inline')}
        onKeyDown={event => handleViewportKeyDown(event)}
      >
        {body}
        {svg && !error ? (
          <button
            ref={expandButtonRef}
            type="button"
            className="mermaid-expand-button"
            aria-label="Open Mermaid diagram viewer"
            data-tooltip="Open diagram viewer"
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              setExpanded(true);
            }}
          >
            <Icon name="maximize" size={15} />
          </button>
        ) : null}
      </div>
      {modal}
    </>
  );
}

export type MarkdownPreviewProps = {
  content: string;
  themeMode: ThemeMode;
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
  wrap: boolean;
  lineNumbers: boolean;
  targetLine?: number | null;
};

export const markdownPreRenderer: NonNullable<Components['pre']> = ({ children }) => (
  <>{children}</>
);

export const markdownCodeRenderer = ({
  className,
  children,
  themeMode,
  codeTheme,
  codeFont,
  codeFontSize,
  codeLineHeight,
  codeTabSize,
  wrap,
  lineNumbers,
  framed,
  adaptiveCodeTheme,
}: {
  className?: string;
  children?: React.ReactNode;
  themeMode: ThemeMode;
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
  wrap: boolean;
  lineNumbers: boolean;
  framed?: boolean;
  adaptiveCodeTheme?: boolean;
}) => {
  const languageMatch = /language-([\w-]+)/.exec(className || '');
  const language = (languageMatch?.[1] || '').toLowerCase();
  const codeText = String(children ?? '').replace(/\n$/, '');

  if (language === "mermaid") {
    return <MermaidBlock content={codeText} themeMode={themeMode} />;
  }

  if (language || codeText.includes('\n')) {
    return (
      <ShikiCodeBlock
        content={codeText}
        language={language || 'text'}
        wrap={wrap}
        lineNumbers={lineNumbers}
        themeMode={themeMode}
        codeTheme={codeTheme}
        codeFont={codeFont}
        codeFontSize={codeFontSize}
        codeLineHeight={codeLineHeight}
        codeTabSize={codeTabSize}
        framed={framed}
        adaptiveCodeTheme={adaptiveCodeTheme}
      />
    );
  }

  return <code className={className}>{children}</code>;
};

const markdownPreviewPropsEqual = (
  prev: MarkdownPreviewProps,
  next: MarkdownPreviewProps,
) =>
  prev.content === next.content &&
  prev.themeMode === next.themeMode &&
  prev.codeTheme === next.codeTheme &&
  prev.codeFont === next.codeFont &&
  prev.codeFontSize === next.codeFontSize &&
  prev.codeLineHeight === next.codeLineHeight &&
  prev.codeTabSize === next.codeTabSize &&
  prev.wrap === next.wrap &&
  prev.lineNumbers === next.lineNumbers &&
  prev.targetLine === next.targetLine;

export const MarkdownPreview = React.memo(function MarkdownPreview({
  content,
  themeMode,
  codeTheme,
  codeFont,
  codeFontSize,
  codeLineHeight,
  codeTabSize,
  wrap,
  lineNumbers,
  targetLine,
}: MarkdownPreviewProps) {
  const markdownComponents = useMemo<Components>(
    () => ({
      pre: ({node, children}) => (
        <div
          className="markdown-source-code-block"
          {...markdownSourceTargetProps(node, targetLine)}
        >
          {children}
        </div>
      ),
      code: ({ className, children }) =>
        markdownCodeRenderer({
          className,
          children,
          themeMode,
          codeTheme,
          codeFont,
          codeFontSize,
          codeLineHeight,
          codeTabSize,
          wrap,
          lineNumbers,
          framed: true,
        }),
      p: ({ node, children, ...props }) => (
        <p {...props} {...markdownSourceTargetProps(node, targetLine)}>
          {children}
        </p>
      ),
      li: ({ node, children, ...props }) => (
        <li {...props} {...markdownSourceTargetProps(node, targetLine)}>
          {children}
        </li>
      ),
      blockquote: ({ node, children, ...props }) => (
        <blockquote {...props} {...markdownSourceTargetProps(node, targetLine)}>
          {children}
        </blockquote>
      ),
      h1: ({ node, children, ...props }) => (
        <h1 {...props} {...markdownSourceTargetProps(node, targetLine)}>
          {children}
        </h1>
      ),
      h2: ({ node, children, ...props }) => (
        <h2 {...props} {...markdownSourceTargetProps(node, targetLine)}>
          {children}
        </h2>
      ),
      h3: ({ node, children, ...props }) => (
        <h3 {...props} {...markdownSourceTargetProps(node, targetLine)}>
          {children}
        </h3>
      ),
      h4: ({ node, children, ...props }) => (
        <h4 {...props} {...markdownSourceTargetProps(node, targetLine)}>
          {children}
        </h4>
      ),
      h5: ({ node, children, ...props }) => (
        <h5 {...props} {...markdownSourceTargetProps(node, targetLine)}>
          {children}
        </h5>
      ),
      h6: ({ node, children, ...props }) => (
        <h6 {...props} {...markdownSourceTargetProps(node, targetLine)}>
          {children}
        </h6>
      ),
      table: ({ node, children, ...props }) => (
        <table {...props} {...markdownSourceTargetProps(node, targetLine)}>
          {children}
        </table>
      ),
    }),
    [
      themeMode,
      codeTheme,
      codeFont,
      codeFontSize,
      codeLineHeight,
      codeTabSize,
      wrap,
      lineNumbers,
      targetLine,
    ],
  );
  const markdownCapabilities = useMarkdownCapabilityPlugins(content);

  return (
    <div
      className="markdown-preview"
      data-markdown-export-pending={markdownCapabilities.pending ? 'true' : undefined}
    >
      <ReactMarkdown
        remarkPlugins={markdownCapabilities.remarkPlugins}
        rehypePlugins={markdownCapabilities.rehypePlugins}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}, markdownPreviewPropsEqual);
