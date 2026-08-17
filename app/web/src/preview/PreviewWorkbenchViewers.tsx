import React from 'react';

import {ChatIcon} from '../chat/ChatIcon';
import {ShikiCodeBlock} from '../code/ShikiCodeBlock';
import {detectCodeLanguage} from '../code/codeLanguage';
import {MarkdownPreview} from '../code/markdownPreview';
import {HtmlPreview} from './HtmlPreview';
import {UnifiedDiffPreview} from './UnifiedDiffPreview';
import {
  isHtmlPreviewAttachment,
  isHtmlPreviewPath,
  type HtmlPreviewSource,
} from './htmlPreviewSource';
import {
  resolvePromptDiffActiveFilePath,
  type AttachmentPreviewTab,
  type FilePreviewTab,
  type PromptDiffPreviewTab,
} from './previewWorkbenchState';
import {isAbsolutePreviewFilePath} from './previewFileLink';
import type {CodeFontId, CodeThemeId} from '../code/shikiSettings';

export type HTMLPreviewConnectionProps = {
  htmlPreviewEndpoint: string;
  htmlPreviewCSRFToken: string;
};

function attachmentPreviewReadPayloadFromKey(tab: AttachmentPreviewTab): {
  sessionId: string;
  uri?: string;
  attachmentId?: string;
} | null {
  const identity = tab.attachmentKey.split('\u001f').pop() || '';
  if (!identity || identity === 'attachment') {
    return null;
  }
  if (identity.startsWith('sha256-')) {
    return {sessionId: tab.sessionId, attachmentId: identity};
  }
  if (identity.includes('/') || identity.includes('\\') || identity.includes(':')) {
    return {sessionId: tab.sessionId, uri: identity};
  }
  return null;
}

export function attachmentHTMLPreviewSource(tab: AttachmentPreviewTab): HtmlPreviewSource | null {
  if (!isHtmlPreviewAttachment(tab.title, tab.mimeType)) {
    return null;
  }
  const payload = attachmentPreviewReadPayloadFromKey(tab);
  if (!payload) {
    return null;
  }
  if (payload.attachmentId) {
    return {
      source: 'session-attachment',
      projectId: tab.projectId,
      sessionId: payload.sessionId,
      attachmentId: payload.attachmentId,
    };
  }
  if (payload.uri) {
    return {
      source: 'session-attachment',
      projectId: tab.projectId,
      sessionId: payload.sessionId,
      uri: payload.uri,
    };
  }
  return null;
}

export {attachmentPreviewReadPayloadFromKey};

function getFileExtension(path: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return match ? match[1].toLowerCase() : '';
}

function isMarkdownPath(path: string): boolean {
  const ext = getFileExtension(path);
  return ext === 'md' || ext === 'markdown';
}

function inferImageMimeType(path: string): string {
  const ext = getFileExtension(path);
  switch (ext) {
    case 'svg':
      return 'image/svg+xml';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'ico':
      return 'image/x-icon';
    case 'avif':
      return 'image/avif';
    default:
      return '';
  }
}

function isImageFile(path: string, mimeType?: string): boolean {
  const normalizedMime = (mimeType || '').trim().toLowerCase();
  return normalizedMime.startsWith('image/') || inferImageMimeType(path) !== '';
}

function encodeUtf8ToBase64(value: string): string {
  try {
    if (typeof TextEncoder !== 'undefined') {
      const bytes = new TextEncoder().encode(value);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
  } catch {
    // fallback below
  }
  return btoa(unescape(encodeURIComponent(value)));
}

function buildImageDataUrl(params: {
  content: string;
  path: string;
  mimeType?: string;
  isBinary?: boolean;
}): string {
  const {content, path, mimeType, isBinary} = params;
  if (!content) return '';
  const normalizedMime = inferImageMimeType(path) || (mimeType || '').trim() || 'image/png';
  return `data:${normalizedMime};base64,${isBinary ? content : encodeUtf8ToBase64(content)}`;
}

export type ChatFilePeekViewerProps = HTMLPreviewConnectionProps & {
  peek: FilePreviewTab | null;
  mode: 'desktop' | 'mobile';
  tabs: FilePreviewTab[];
  treeOpen: boolean;
  themeMode: 'dark' | 'light';
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
  wrapLines: boolean;
  showLineNumbers: boolean;
  highlightedLines: Set<number>;
  onLineClick?: (line: number, event: MouseEvent) => void;
  onClose: () => void;
  onCopyPath: () => void;
  onTabSelect: (path: string) => void;
  onTabClose: (path: string) => void;
  onToggleTree: () => void;
  treeContent: React.ReactNode;
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

export const ChatFilePeekViewer = React.memo(function ChatFilePeekViewer({
  peek,
  mode,
  tabs,
  treeOpen,
  themeMode,
  codeTheme,
  codeFont,
  codeFontSize,
  codeLineHeight,
  codeTabSize,
  wrapLines,
  showLineNumbers,
  highlightedLines,
  onLineClick,
  onClose,
  onCopyPath,
  onTabSelect,
  onTabClose,
  onToggleTree,
  treeContent,
  scrollRef,
  htmlPreviewEndpoint,
  htmlPreviewCSRFToken,
}: ChatFilePeekViewerProps) {
  let body: React.ReactNode;
  if (!peek) {
    body = (
      <div className="chat-file-workbench-empty">
        <ChatIcon name="files" />
        <span>No file selected</span>
      </div>
    );
  } else if (peek.loading) {
    body = <div className="muted block">Loading file...</div>;
  } else if (peek.error) {
    body = (
      <div className="chat-file-peek-error" role="alert">
        <ChatIcon name="circleX" />
        <span>{peek.error || 'Failed to load file'}</span>
      </div>
    );
  } else if (isImageFile(peek.path, peek.info?.mimeType)) {
    const imageSrc = buildImageDataUrl({
      content: peek.content,
      path: peek.path,
      mimeType: peek.info?.mimeType,
      isBinary: peek.info?.isBinary,
    });
    body = imageSrc ? (
      <div className="file-image-preview-wrap chat-file-peek-image-wrap">
        <img className="file-image-preview" src={imageSrc} alt={peek.path.split('/').pop() || 'image preview'} />
      </div>
    ) : <div className="muted block">Image content is unavailable.</div>;
  } else if (isMarkdownPath(peek.path)) {
    body = (
      <MarkdownPreview
        content={peek.content}
        themeMode={themeMode}
        codeTheme={codeTheme}
        codeFont={codeFont}
        codeFontSize={codeFontSize}
        codeLineHeight={codeLineHeight}
        codeTabSize={codeTabSize}
        wrap={wrapLines}
        lineNumbers={showLineNumbers}
        targetLine={peek.targetLine}
      />
    );
  } else if (isHtmlPreviewPath(peek.path)) {
    body = (
      <HtmlPreview
        endpoint={htmlPreviewEndpoint}
        csrfToken={htmlPreviewCSRFToken}
        source={{
          source: isAbsolutePreviewFilePath(peek.path) ? 'external-file' : 'project-file',
          projectId: peek.projectId,
          path: peek.path,
        }}
      />
    );
  } else {
    body = (
      <ShikiCodeBlock
        content={peek.content}
        language={detectCodeLanguage(peek.path)}
        wrap={false}
        lineNumbers={true}
        themeMode={themeMode}
        codeTheme={codeTheme}
        codeFont={codeFont}
        codeFontSize={codeFontSize}
        codeLineHeight={codeLineHeight}
        codeTabSize={codeTabSize}
        highlightedLines={highlightedLines}
        onLineClick={onLineClick}
      />
    );
  }

  return <>{body}</>;
}, (prev, next) => {
  const p = prev.peek;
  const n = next.peek;
  return p?.projectId === n?.projectId &&
    p?.path === n?.path &&
    p?.targetLine === n?.targetLine &&
    p?.content === n?.content &&
    p?.loading === n?.loading &&
    p?.error === n?.error &&
    prev.mode === next.mode &&
    prev.tabs === next.tabs &&
    prev.treeOpen === next.treeOpen &&
    prev.themeMode === next.themeMode &&
    prev.codeTheme === next.codeTheme &&
    prev.codeFont === next.codeFont &&
    prev.codeFontSize === next.codeFontSize &&
    prev.codeLineHeight === next.codeLineHeight &&
    prev.codeTabSize === next.codeTabSize &&
    prev.wrapLines === next.wrapLines &&
    prev.showLineNumbers === next.showLineNumbers &&
    prev.highlightedLines === next.highlightedLines &&
    prev.htmlPreviewEndpoint === next.htmlPreviewEndpoint &&
    prev.htmlPreviewCSRFToken === next.htmlPreviewCSRFToken;
});

export type ChatAttachmentPreviewViewerProps = HTMLPreviewConnectionProps & {
  preview: AttachmentPreviewTab;
  mode: 'desktop' | 'mobile';
  onClose: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  themeMode: 'dark' | 'light';
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
  wrapLines: boolean;
  showLineNumbers: boolean;
  highlightedLines: Set<number>;
  onLineClick?: (line: number, event: MouseEvent) => void;
};

export const ChatAttachmentPreviewViewer = React.memo(function ChatAttachmentPreviewViewer({
  preview,
  mode,
  onClose,
  scrollRef,
  themeMode,
  codeTheme,
  codeFont,
  codeFontSize,
  codeLineHeight,
  codeTabSize,
  wrapLines,
  showLineNumbers,
  highlightedLines,
  onLineClick,
  htmlPreviewEndpoint,
  htmlPreviewCSRFToken,
}: ChatAttachmentPreviewViewerProps) {
  const htmlSource = attachmentHTMLPreviewSource(preview);
  let body: React.ReactNode;
  if (preview.loading) {
    body = <div className="muted block">Loading attachment...</div>;
  } else if (preview.error) {
    body = (
      <div className="chat-file-peek-error" role="alert">
        <ChatIcon name="circleX" />
        <span>{preview.error}</span>
      </div>
    );
  } else if (htmlSource) {
    body = <HtmlPreview endpoint={htmlPreviewEndpoint} csrfToken={htmlPreviewCSRFToken} source={htmlSource} />;
  } else if (preview.kind === 'image' && preview.src) {
    body = (
      <div className="chat-attachment-original-wrap">
        <img className="chat-attachment-original-image" src={preview.src} alt={preview.title} />
      </div>
    );
  } else if (preview.content === undefined && preview.isBinary === false) {
    body = (
      <div className="chat-file-peek-error" role="alert">
        <ChatIcon name="circleX" />
        <span>Failed to decode file content (UTF-8 expected).</span>
      </div>
    );
  } else if (preview.content !== undefined) {
    const fileName = preview.title || 'attachment';
    body = isMarkdownPath(fileName) ? (
      <MarkdownPreview
        content={preview.content}
        themeMode={themeMode}
        codeTheme={codeTheme}
        codeFont={codeFont}
        codeFontSize={codeFontSize}
        codeLineHeight={codeLineHeight}
        codeTabSize={codeTabSize}
        wrap={wrapLines}
        lineNumbers={showLineNumbers}
      />
    ) : (
      <ShikiCodeBlock
        content={preview.content}
        language={detectCodeLanguage(fileName)}
        wrap={false}
        lineNumbers={true}
        themeMode={themeMode}
        codeTheme={codeTheme}
        codeFont={codeFont}
        codeFontSize={codeFontSize}
        codeLineHeight={codeLineHeight}
        codeTabSize={codeTabSize}
        highlightedLines={highlightedLines}
        onLineClick={onLineClick}
      />
    );
  } else {
    body = (
      <div className="chat-attachment-preview-placeholder">
        <ChatIcon name="file" />
        <div className="chat-attachment-preview-placeholder-main">
          <div className="chat-attachment-preview-placeholder-title">{preview.title}</div>
          {preview.meta ? <div className="chat-attachment-preview-placeholder-meta">{preview.meta}</div> : null}
          <div className="chat-attachment-preview-placeholder-status">Preview is being implemented.</div>
        </div>
      </div>
    );
  }
  return <>{body}</>;
}, (prev, next) => prev.preview === next.preview &&
  prev.mode === next.mode &&
  prev.themeMode === next.themeMode &&
  prev.codeTheme === next.codeTheme &&
  prev.codeFont === next.codeFont &&
  prev.codeFontSize === next.codeFontSize &&
  prev.codeLineHeight === next.codeLineHeight &&
  prev.codeTabSize === next.codeTabSize &&
  prev.wrapLines === next.wrapLines &&
  prev.showLineNumbers === next.showLineNumbers &&
  prev.highlightedLines === next.highlightedLines &&
  prev.htmlPreviewEndpoint === next.htmlPreviewEndpoint &&
  prev.htmlPreviewCSRFToken === next.htmlPreviewCSRFToken);

export type ChatPromptArtifactPreviewViewerProps = {
  preview: PromptDiffPreviewTab;
  mode: 'desktop' | 'mobile';
  themeMode: 'dark' | 'light';
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontFamily: string;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
  onClose: () => void;
  onToggleFile: (path: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

export const ChatPromptArtifactPreviewViewer = React.memo(function ChatPromptArtifactPreviewViewer({
  preview,
  mode,
  themeMode,
  codeTheme,
  codeFont,
  codeFontFamily,
  codeFontSize,
  codeLineHeight,
  codeTabSize,
  onClose,
  onToggleFile,
  scrollRef,
}: ChatPromptArtifactPreviewViewerProps) {
  const activeFilePath = resolvePromptDiffActiveFilePath(preview.files, preview.activeFilePath);
  return (
    <UnifiedDiffPreview
      files={preview.files}
      activeFilePath={activeFilePath}
      loading={preview.loading}
      error={preview.error}
      overviewLabel={`${preview.files.length} changed ${preview.files.length === 1 ? 'file' : 'files'}`}
      onToggleFile={onToggleFile}
      themeMode={themeMode}
      codeTheme={codeTheme}
      codeFont={codeFont}
      codeFontFamily={codeFontFamily}
      codeFontSize={codeFontSize}
      codeLineHeight={codeLineHeight}
      codeTabSize={codeTabSize}
    />
  );
}, (prev, next) => prev.preview === next.preview &&
  prev.mode === next.mode &&
  prev.themeMode === next.themeMode &&
  prev.codeTheme === next.codeTheme &&
  prev.codeFont === next.codeFont &&
  prev.codeFontFamily === next.codeFontFamily &&
  prev.codeFontSize === next.codeFontSize &&
  prev.codeLineHeight === next.codeLineHeight &&
  prev.codeTabSize === next.codeTabSize);
