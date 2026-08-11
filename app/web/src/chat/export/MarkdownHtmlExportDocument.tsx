import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, {defaultSchema, type Options as RehypeSanitizeSchema} from 'rehype-sanitize';
import ReactMarkdown, {type Components} from 'react-markdown';

import {
  markdownCodeRenderer,
  markdownPreRenderer,
  useMarkdownCapabilityPlugins,
} from '../../code/markdownPreview';
import {
  DEFAULT_CODE_FONT,
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_CODE_LINE_HEIGHT,
  DEFAULT_CODE_TAB_SIZE,
  DEFAULT_CODE_THEME,
  type CodeFontId,
  type CodeThemeId,
} from '../../code/shikiSettings';
import {waitForMarkdownExportReady} from './chatMarkdownImageExport';
import {
  MARKDOWN_EXPORT_CONTENT_CLASS_NAME,
  MARKDOWN_EXPORT_CONTENT_STYLE,
} from './markdownHtmlExport';
import {serializeMarkdownHtmlExportSurface} from './markdownHtmlExportSurface';

export {serializeMarkdownHtmlExportSurface} from './markdownHtmlExportSurface';

type ThemeMode = 'dark' | 'light';

export type MarkdownHtmlImageWarning = {
  source: string;
  message: string;
  fatal?: boolean;
};

export type MarkdownHtmlImageResolution = {
  src: string;
  warning?: string;
  fatal?: boolean;
};

export type MarkdownHtmlImageResolver = (
  source: string,
) => Promise<MarkdownHtmlImageResolution>;

export type MarkdownHtmlExportDocumentProps = {
  content: string;
  themeMode?: ThemeMode;
  codeTheme?: CodeThemeId;
  codeFont?: CodeFontId;
  codeFontSize?: number;
  codeLineHeight?: number;
  codeTabSize?: number;
  imageResolver?: MarkdownHtmlImageResolver;
  onImageWarning?: (warning: MarkdownHtmlImageWarning) => void;
};

export type MarkdownHtmlExportContentProps = MarkdownHtmlExportDocumentProps & {
  className: string;
};

export type MarkdownHtmlExportSurfaceRequest = MarkdownHtmlExportDocumentProps & {
  id: number;
  title: string;
};

export type MarkdownHtmlExportSurfaceResult = {
  html: string;
  unresolvedImageUrls: string[];
};

const markdownHtmlExportSanitizeSchema: RehypeSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className'],
    a: [...(defaultSchema.attributes?.a ?? []), 'rel', 'target'],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'data'],
  },
};

async function passThroughMarkdownImage(source: string): Promise<MarkdownHtmlImageResolution> {
  return {src: source};
}

function MarkdownHtmlExportImage({
  src,
  alt,
  imageResolver,
  onImageWarning,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & Pick<MarkdownHtmlExportDocumentProps, 'imageResolver' | 'onImageWarning'>) {
  const source = typeof src === 'string' ? src : '';
  const [resolvedSrc, setResolvedSrc] = useState('');
  const [pending, setPending] = useState(Boolean(source));

  useEffect(() => {
    let cancelled = false;
    if (!source) {
      setResolvedSrc('');
      setPending(false);
      return () => {
        cancelled = true;
      };
    }
    setPending(true);
    setResolvedSrc('');
    (imageResolver ?? passThroughMarkdownImage)(source)
      .then(result => {
        if (cancelled) return;
        setResolvedSrc(result.fatal ? '' : result.src || source);
        if (result.warning) {
          onImageWarning?.({source, message: result.warning, fatal: result.fatal});
        }
      })
      .catch(error => {
        if (cancelled) return;
        setResolvedSrc(source);
        onImageWarning?.({
          source,
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (!cancelled) {
          setPending(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [source, imageResolver, onImageWarning]);

  return (
    <img
      {...props}
      src={resolvedSrc || undefined}
      alt={alt || ''}
      data-markdown-export-pending={pending ? 'true' : undefined}
    />
  );
}

export function MarkdownHtmlExportContent({
  content,
  className,
  themeMode = 'light',
  codeTheme = DEFAULT_CODE_THEME,
  codeFont = DEFAULT_CODE_FONT,
  codeFontSize = DEFAULT_CODE_FONT_SIZE,
  codeLineHeight = DEFAULT_CODE_LINE_HEIGHT,
  codeTabSize = DEFAULT_CODE_TAB_SIZE,
  imageResolver,
  onImageWarning,
}: MarkdownHtmlExportContentProps) {
  const markdownCapabilities = useMarkdownCapabilityPlugins(content);
  const markdownComponents = useMemo<Components>(
    () => ({
      pre: markdownPreRenderer,
      code: ({className, children}) => markdownCodeRenderer({
        className,
        children,
        themeMode,
        codeTheme,
        codeFont,
        codeFontSize,
        codeLineHeight,
        codeTabSize,
        wrap: true,
        lineNumbers: false,
        framed: true,
      }),
      img: ({node: _node, src, alt, ...props}) => (
        <MarkdownHtmlExportImage
          {...props}
          src={typeof src === 'string' ? src : undefined}
          alt={alt || ''}
          imageResolver={imageResolver}
          onImageWarning={onImageWarning}
        />
      ),
    }),
    [
      themeMode,
      codeTheme,
      codeFont,
      codeFontSize,
      codeLineHeight,
      codeTabSize,
      imageResolver,
      onImageWarning,
    ],
  );
  const rehypePlugins = useMemo<NonNullable<React.ComponentProps<typeof ReactMarkdown>['rehypePlugins']>>(
    () => [
      rehypeRaw,
      ...markdownCapabilities.rehypePlugins,
      [rehypeSanitize, markdownHtmlExportSanitizeSchema],
    ] as NonNullable<React.ComponentProps<typeof ReactMarkdown>['rehypePlugins']>,
    [markdownCapabilities.rehypePlugins],
  );

  return (
    <div
      className={className}
      data-markdown-export-pending={markdownCapabilities.pending ? 'true' : undefined}
    >
      <ReactMarkdown
        remarkPlugins={markdownCapabilities.remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function MarkdownHtmlExportDocument(props: MarkdownHtmlExportDocumentProps) {
  return (
    <MarkdownHtmlExportContent
      {...props}
      className={`markdown-preview markdown-html-export-document ${MARKDOWN_EXPORT_CONTENT_CLASS_NAME}`}
    />
  );
}

export function MarkdownHtmlExportSurface({
  request,
  onComplete,
  onError,
}: {
  request: MarkdownHtmlExportSurfaceRequest;
  onComplete: (result: MarkdownHtmlExportSurfaceResult) => void;
  onError: (message: string) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const imageWarningsRef = useRef(new Map<string, MarkdownHtmlImageWarning>());
  const onImageWarning = useCallback((warning: MarkdownHtmlImageWarning) => {
    imageWarningsRef.current.set(warning.source, warning);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const surface = surfaceRef.current;
      if (!surface) return;
      try {
        await waitForMarkdownExportReady(surface);
        if (cancelled) return;
        const fatalWarning = Array.from(imageWarningsRef.current.values())
          .find(warning => warning.fatal);
        if (fatalWarning) {
          throw new Error(fatalWarning.message);
        }
        onComplete({
          html: serializeMarkdownHtmlExportSurface(surface, request.title),
          unresolvedImageUrls: Array.from(imageWarningsRef.current.keys()),
        });
      } catch (error) {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onComplete, onError, request.id, request.title]);

  return (
    <div className="markdown-html-export-host" aria-hidden="true">
      <style>{MARKDOWN_EXPORT_CONTENT_STYLE}</style>
      <div ref={surfaceRef} className="markdown-html-export-surface">
        <MarkdownHtmlExportDocument
          content={request.content}
          themeMode={request.themeMode}
          codeTheme={request.codeTheme}
          codeFont={request.codeFont}
          codeFontSize={request.codeFontSize}
          codeLineHeight={request.codeLineHeight}
          codeTabSize={request.codeTabSize}
          imageResolver={request.imageResolver}
          onImageWarning={onImageWarning}
        />
      </div>
    </div>
  );
}
