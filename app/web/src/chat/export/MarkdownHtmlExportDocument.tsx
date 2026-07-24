import React, {useEffect, useMemo, useState} from 'react';
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

type ThemeMode = 'dark' | 'light';

export type MarkdownHtmlImageWarning = {
  source: string;
  message: string;
};

type MarkdownHtmlImageResolution = {
  src: string;
  warning?: string;
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

const markdownHtmlExportSanitizeSchema: RehypeSanitizeSchema = {
  ...defaultSchema,
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
        setResolvedSrc(result.src || source);
        if (result.warning) {
          onImageWarning?.({source, message: result.warning});
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

export function MarkdownHtmlExportDocument({
  content,
  themeMode = 'light',
  codeTheme = DEFAULT_CODE_THEME,
  codeFont = DEFAULT_CODE_FONT,
  codeFontSize = DEFAULT_CODE_FONT_SIZE,
  codeLineHeight = DEFAULT_CODE_LINE_HEIGHT,
  codeTabSize = DEFAULT_CODE_TAB_SIZE,
  imageResolver,
  onImageWarning,
}: MarkdownHtmlExportDocumentProps) {
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
      className="markdown-preview markdown-html-export-document"
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
