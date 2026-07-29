import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

function MermaidBlock({ content, themeMode }: MermaidBlockProps) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

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

  if (error) {
    return <div className="mermaid-error">{error}</div>;
  }

  if (!svg) {
    return (
      <div className="muted block" data-markdown-export-pending="true">
        Rendering mermaid diagram...
      </div>
    );
  }

  return (
    <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: svg }} />
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
