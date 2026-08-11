import React from 'react';

import {
  MarkdownHtmlExportContent,
  type MarkdownHtmlImageResolver,
  type MarkdownHtmlImageWarning,
} from '../export/MarkdownHtmlExportDocument';
import {
  MARKDOWN_EXPORT_CONTENT_CLASS_NAME,
} from '../export/markdownHtmlExport';
import {
  CHAT_SHARE_DOCUMENT_CLASS_NAME,
} from './chatShareDocumentStyle';
import type {
  ChatShareEntry,
  ChatShareSnapshot,
  ChatShareTerminalStatus,
} from './chatShareSnapshot';

export type ChatShareDocumentProps = {
  snapshot: ChatShareSnapshot;
  imageResolver?: MarkdownHtmlImageResolver;
  onImageWarning?: (warning: MarkdownHtmlImageWarning) => void;
};

const STATUS_LABELS: Record<ChatShareTerminalStatus, string> = {
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};

function formattedSnapshotTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return value;
  }
  return `${parsed.toISOString().replace('T', ' ').replace('.000Z', 'Z')}`;
}

function markdownProps(
  snapshot: ChatShareSnapshot,
  imageResolver?: MarkdownHtmlImageResolver,
  onImageWarning?: (warning: MarkdownHtmlImageWarning) => void,
) {
  return {
    themeMode: snapshot.presentation.themeMode,
    codeTheme: snapshot.presentation.codeTheme,
    codeFont: snapshot.presentation.codeFont,
    codeFontSize: snapshot.presentation.codeFontSize,
    codeLineHeight: snapshot.presentation.codeLineHeight,
    codeTabSize: snapshot.presentation.codeTabSize,
    imageResolver,
    onImageWarning,
  };
}

function ChatShareEntryView({
  entry,
  snapshot,
  imageResolver,
  onImageWarning,
}: {
  entry: ChatShareEntry;
  snapshot: ChatShareSnapshot;
  imageResolver?: MarkdownHtmlImageResolver;
  onImageWarning?: (warning: MarkdownHtmlImageWarning) => void;
}) {
  const content = (
    <>
      <MarkdownHtmlExportContent
        {...markdownProps(snapshot, imageResolver, onImageWarning)}
        content={entry.markdown}
        className="chat-share-entry-markdown"
      />
      {entry.attachments.length > 0 ? (
        <ul className="chat-share-attachments">
          {entry.attachments.map((attachment, index) => (
            <li
              className="chat-share-attachment-label"
              data-attachment-kind={attachment.kind}
              key={`${attachment.kind}:${attachment.label}:${index}`}
            >
              {attachment.label}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
  return (
    <section className={`chat-share-entry ${entry.role}`}>
      {entry.status ? (
        <div className="chat-share-status-row">
          <span className={`chat-share-status ${entry.status}`}>{STATUS_LABELS[entry.status]}</span>
        </div>
      ) : null}
      {entry.role === 'user' ? <div className="chat-share-prompt">{content}</div> : content}
    </section>
  );
}

export function ChatShareDocument({
  snapshot,
  imageResolver,
  onImageWarning,
}: ChatShareDocumentProps) {
  if (snapshot.scope === 'response') {
    const response = snapshot.entries.find(entry => entry.role === 'assistant');
    return (
      <MarkdownHtmlExportContent
        {...markdownProps(snapshot, imageResolver, onImageWarning)}
        content={response?.markdown ?? ''}
        className={`markdown-preview markdown-html-export-document ${MARKDOWN_EXPORT_CONTENT_CLASS_NAME}`}
      />
    );
  }

  return (
    <article
      className={`markdown-preview markdown-html-export-document ${MARKDOWN_EXPORT_CONTENT_CLASS_NAME} ${CHAT_SHARE_DOCUMENT_CLASS_NAME}`}
      data-chat-share-scope="session"
    >
      <header className="chat-share-header">
        <h1 className="chat-share-title">{snapshot.title}</h1>
        <time className="chat-share-timestamp" dateTime={snapshot.capturedAt}>
          {formattedSnapshotTime(snapshot.capturedAt)}
        </time>
      </header>
      <div className="chat-share-entries">
        {snapshot.entries.map((entry, index) => (
          <ChatShareEntryView
            entry={entry}
            snapshot={snapshot}
            imageResolver={imageResolver}
            onImageWarning={onImageWarning}
            key={`${entry.role}:${entry.startTurnIndex}:${entry.endTurnIndex}:${index}`}
          />
        ))}
      </div>
    </article>
  );
}
