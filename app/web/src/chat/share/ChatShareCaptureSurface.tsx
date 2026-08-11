import React, {useCallback, useEffect, useRef} from 'react';

import {
  renderMarkdownElementToPngBlob,
  resolveMarkdownImageExportWidth,
  waitForMarkdownExportReady,
  type MarkdownImageExportMode,
} from '../export/chatMarkdownImageExport';
import type {
  MarkdownHtmlImageResolver,
  MarkdownHtmlImageWarning,
} from '../export/MarkdownHtmlExportDocument';
import {MARKDOWN_EXPORT_CONTENT_STYLE} from '../export/markdownHtmlExport';
import {serializeMarkdownHtmlExportSurface} from '../export/markdownHtmlExportSurface';
import {ChatShareDocument} from './ChatShareDocument';
import {
  CHAT_SHARE_DOCUMENT_CLASS_NAME,
  CHAT_SHARE_DOCUMENT_STYLE,
} from './chatShareDocumentStyle';
import type {ChatShareSnapshot} from './chatShareSnapshot';

export type ChatShareCaptureMode = 'image' | 'html';

export type ChatShareCaptureRequest = {
  id: number;
  mode: ChatShareCaptureMode;
  snapshot: ChatShareSnapshot;
  widthMode: MarkdownImageExportMode;
  imageResolver?: MarkdownHtmlImageResolver;
};

export type ChatShareCaptureResult =
  | {mode: 'image'; blob: Blob; unresolvedImageUrls: string[]}
  | {mode: 'html'; html: string; unresolvedImageUrls: string[]};

export function ChatShareCaptureSurface({
  request,
  onComplete,
  onError,
}: {
  request: ChatShareCaptureRequest;
  onComplete: (result: ChatShareCaptureResult) => void;
  onError: (message: string) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const imageWarningsRef = useRef(new Map<string, MarkdownHtmlImageWarning>());
  const onImageWarning = useCallback((warning: MarkdownHtmlImageWarning) => {
    imageWarningsRef.current.set(warning.source, warning);
  }, []);
  const width = resolveMarkdownImageExportWidth(request.widthMode);

  useEffect(() => {
    let cancelled = false;
    imageWarningsRef.current.clear();
    (async () => {
      const surface = surfaceRef.current;
      const documentNode = surface?.querySelector<HTMLElement>('.markdown-html-export-document');
      if (!surface || !documentNode) {
        return;
      }
      try {
        await waitForMarkdownExportReady(surface);
        const fatalWarning = Array.from(imageWarningsRef.current.values())
          .find(warning => warning.fatal);
        if (fatalWarning) {
          throw new Error(fatalWarning.message);
        }
        let result: ChatShareCaptureResult;
        if (request.mode === 'image') {
          const backgroundColor = getComputedStyle(documentNode).backgroundColor || '#ffffff';
          const blob = await renderMarkdownElementToPngBlob(documentNode, {backgroundColor});
          result = {
            mode: 'image',
            blob,
            unresolvedImageUrls: Array.from(imageWarningsRef.current.keys()),
          };
        } else {
          result = {
            mode: 'html',
            html: serializeMarkdownHtmlExportSurface(surface, request.snapshot.title, {
              additionalStyles: CHAT_SHARE_DOCUMENT_STYLE,
              bodyClassName: request.snapshot.scope === 'session'
                ? CHAT_SHARE_DOCUMENT_CLASS_NAME
                : '',
            }),
            unresolvedImageUrls: Array.from(imageWarningsRef.current.keys()),
          };
        }
        if (!cancelled) {
          onComplete(result);
        }
      } catch (error) {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onComplete, onError, request.id, request.mode, request.snapshot]);

  return (
    <div
      className="chat-share-capture-host"
      data-capture-mode={request.mode}
      data-export-mode={request.widthMode}
      aria-hidden="true"
    >
      <style>{MARKDOWN_EXPORT_CONTENT_STYLE + CHAT_SHARE_DOCUMENT_STYLE}</style>
      <div ref={surfaceRef} className="chat-share-capture-surface" style={{width}}>
        <ChatShareDocument
          snapshot={request.snapshot}
          imageResolver={request.imageResolver}
          onImageWarning={onImageWarning}
        />
      </div>
    </div>
  );
}
