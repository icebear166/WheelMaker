import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';

import { useMarkdownCapabilityPlugins } from '../code/markdownPreview';
import type {
  RegistryChatMessage,
  RegistrySessionContentBlock,
  RegistrySessionPromptArtifact,
  RegistrySessionPromptArtifactFile,
} from '../registry/registryTypes';
import { formatPromptDurationMs } from '../workspace/sessionTime';
import {
  chatPromptAttachmentLabel,
  chatPromptAttachmentMeta,
  isPromptImageAttachmentContentBlock,
  isPromptAttachmentContentBlock,
} from './composer/chatPromptAttachments';
import {
  buildChatPromptInlineParts,
  type ChatPromptInlinePart,
} from './composer/chatPromptInlineParts';
import {
  splitChatConfirmationReplyText,
  splitChatOptionReplyText,
  type ChatConfirmationReply,
  type ChatOptionReply,
} from './chatOptionReplies';
import { resolvePromptDoneStatus, type ChatPromptStatus } from './turns/chatPromptStatus';

function msgKind(method: string): string {
  switch (method) {
    case 'prompt_done':
      return 'prompt_result';
    case 'agent_thought_chunk':
      return 'thought';
    case 'tool_call':
      return 'tool';
    default:
      return 'message';
  }
}

function extractTextFromACPContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const chunks: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.text === 'string' && entry.text.trim()) {
      chunks.push(entry.text.trim());
    }
  }
  return chunks.join('\n').trim();
}

function extractTextFromSessionTurnParam(param: unknown): string {
  if (typeof param === 'string') {
    return param.trim();
  }
  if (Array.isArray(param)) {
    const chunks = param
      .map(item => {
        if (!item || typeof item !== 'object') return '';
        const entry = item as Record<string, unknown>;
        return typeof entry.content === 'string' ? entry.content.trim() : '';
      })
      .filter(Boolean);
    return chunks.join('\n').trim();
  }
  if (!param || typeof param !== 'object') {
    return '';
  }
  const input = param as Record<string, unknown>;
  if (typeof input.text === 'string') {
    return input.text.trim();
  }
  if (typeof input.output === 'string') {
    return input.output.trim();
  }
  if (typeof input.cmd === 'string') {
    return input.cmd.trim();
  }
  if (Array.isArray(input.contentBlocks)) {
    return extractTextFromACPContent(input.contentBlocks);
  }
  return '';
}

function msgText(method: string, param: Record<string, unknown>): string {
  if (method === 'prompt_request') {
    const blocks = Array.isArray(param.contentBlocks) ? param.contentBlocks : [];
    return extractTextFromACPContent(blocks);
  }
  if (method === 'prompt_done') {
    return typeof param.stopReason === 'string' ? param.stopReason : '';
  }
  return extractTextFromSessionTurnParam(param);
}

function msgBlocks(
  method: string,
  param: Record<string, unknown>,
): RegistrySessionContentBlock[] {
  if (Array.isArray(param.contentBlocks)) {
    return param.contentBlocks as RegistrySessionContentBlock[];
  }
  if (method === 'prompt_request') {
    return [];
  }
  return [];
}

function promptDiffArtifacts(param: Record<string, unknown>): RegistrySessionPromptArtifact[] {
  const artifacts = Array.isArray(param.artifacts) ? param.artifacts : [];
  const out: RegistrySessionPromptArtifact[] = [];
  for (const item of artifacts) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const artifactId = typeof entry.artifactId === 'string' ? entry.artifactId : '';
    const type = typeof entry.type === 'string' ? entry.type : '';
    const format = typeof entry.format === 'string' ? entry.format : '';
    if (!artifactId || type !== 'diff' || format !== 'unified-diff') continue;
    const files = parsePromptArtifactFiles(entry.files);
    const fileCount = typeof entry.fileCount === 'number' && Number.isFinite(entry.fileCount)
      ? Math.max(0, Math.trunc(entry.fileCount))
      : files.length;
    out.push({
      artifactId,
      type,
      format,
      fileCount,
      files,
    });
  }
  return out;
}

function parsePromptArtifactFiles(value: unknown): RegistrySessionPromptArtifactFile[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const files: RegistrySessionPromptArtifactFile[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const path = typeof entry.path === 'string' ? entry.path : '';
    const status = typeof entry.status === 'string' ? entry.status : '?';
    const additions = typeof entry.additions === 'number' && Number.isFinite(entry.additions)
      ? Math.max(0, Math.trunc(entry.additions))
      : 0;
    const deletions = typeof entry.deletions === 'number' && Number.isFinite(entry.deletions)
      ? Math.max(0, Math.trunc(entry.deletions))
      : 0;
    if (!path) continue;
    files.push({path, status, additions, deletions});
  }
  return files;
}

function promptArtifactCountLabel(fileCount: number): string {
  const count = Math.max(0, Math.trunc(fileCount));
  return `Changed ${count} ${count === 1 ? 'file' : 'files'}`;
}

function promptArtifactViewKey(message: RegistryChatMessage, artifact: RegistrySessionPromptArtifact): string {
  return `${message.sessionId}:${artifact.artifactId}`;
}

const CollapsibleThought = React.memo(function CollapsibleThought({
  text,
  markdownComponents,
  markdownUrlTransform,
}: {
  text: string;
  markdownComponents: Components;
  markdownUrlTransform: (value: string) => string;
}) {
  const [open, setOpen] = React.useState(false);
  const markdownCapabilities = useMarkdownCapabilityPlugins(text);
  const firstLine = (text || '')
    .split('\n')
    .map(line => line.trim())
    .find(Boolean) || '';

  return (
    <div className={`chat-thought-block${open ? ' chat-thought-open' : ''}`}>
      <div
        className="chat-thought-header"
        onClick={() => setOpen(!open)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
      >
        <span className="codicon codicon-chevron-right chat-thought-chevron" />
        <span className="codicon codicon-lightbulb" />
        {!open && firstLine ? (
          <span className="chat-thought-preview">{firstLine}</span>
        ) : null}
      </div>
      {open ? (
        <div
          className="chat-thought-content"
          data-markdown-export-pending={markdownCapabilities.pending ? 'true' : undefined}
        >
          <ReactMarkdown
            remarkPlugins={markdownCapabilities.remarkPlugins}
            urlTransform={markdownUrlTransform}
            rehypePlugins={markdownCapabilities.rehypePlugins}
            components={markdownComponents}
          >
            {text}
          </ReactMarkdown>
        </div>
      ) : null}
    </div>
  );
});

function groupImageBlocks(msgs: RegistryChatMessage[]): RegistrySessionContentBlock[] {
  const blocks: RegistrySessionContentBlock[] = [];
  for (const m of msgs) {
    for (const b of msgBlocks(m.method, m.param)) {
      if (b.type === 'image' && b.data) {
        blocks.push(b);
      }
    }
  }
  return blocks;
}

function groupPromptAttachmentBlocks(msgs: RegistryChatMessage[]): RegistrySessionContentBlock[] {
  const blocks: RegistrySessionContentBlock[] = [];
  for (const m of msgs) {
    for (const b of msgBlocks(m.method, m.param)) {
      if (isPromptAttachmentContentBlock(b)) {
        blocks.push(b);
      }
    }
  }
  return blocks;
}

function renderPromptInlineParts(parts: ChatPromptInlinePart[]): React.ReactNode {
  return parts.map((part, index) => {
    if (part.type === 'text') {
      return <React.Fragment key={`text:${index}`}>{part.text}</React.Fragment>;
    }
    return (
      <span
        key={`${part.type}:${index}:${part.type === 'file' ? part.path : part.command}`}
        className={`chat-prompt-inline-capsule ${part.type}`}
        title={part.type === 'file' ? part.path : part.command}
      >
        <span className="chat-prompt-inline-capsule-icon" aria-hidden="true">
          {part.type === 'skill' ? '/' : '@'}
        </span>
        <span className="chat-prompt-inline-capsule-label">{part.label}</span>
      </span>
    );
  });
}

export type ChatTurnViewProps = {
  message: RegistryChatMessage;
  promptRequest?: RegistryChatMessage;
  promptStatus?: ChatPromptStatus;
  hideToolCalls: boolean;
  markdownComponents: Components;
  markdownUrlTransform: (value: string) => string;
  copyDisabled?: boolean;
  exportBusy?: boolean;
  onCopyPromptDone?: () => void;
  onExportPromptDoneImage?: () => void;
  ttsState?: 'idle' | 'loading' | 'playing';
  readAloudEnabled?: boolean;
  onReadAloud?: () => void;
  optionReplies?: ChatOptionReply[];
  optionRepliesDisabled?: boolean;
  onSelectOptionReply?: (label: string) => void;
  confirmationReply?: ChatConfirmationReply | null;
  onSelectConfirmationReply?: (replyText: string) => void;
  onRetryPendingPrompt?: () => void;
  onEditPendingPrompt?: () => void;
  onCancelQueuedPrompt?: () => void;
  onPrioritizeQueuedPrompt?: () => void;
  onOpenPromptAttachment?: (block: RegistrySessionContentBlock, message: RegistryChatMessage) => void;
  resolvePromptAttachmentThumbnail?: (block: RegistrySessionContentBlock, message: RegistryChatMessage) => string;
  onLoadPromptAttachmentThumbnail?: (block: RegistrySessionContentBlock, message: RegistryChatMessage) => void;
  onOpenPromptArtifact?: (artifact: RegistrySessionPromptArtifact, message: RegistryChatMessage, filePath?: string) => void;
  openingPromptArtifactKey?: string;
  promptArtifactErrors?: Record<string, string>;
};

type PromptAttachmentChipProps = {
  block: RegistrySessionContentBlock;
  index: number;
  message: RegistryChatMessage;
  onOpenPromptAttachment?: (block: RegistrySessionContentBlock, message: RegistryChatMessage) => void;
  resolvePromptAttachmentThumbnail?: (block: RegistrySessionContentBlock, message: RegistryChatMessage) => string;
  onLoadPromptAttachmentThumbnail?: (block: RegistrySessionContentBlock, message: RegistryChatMessage) => void;
};

const PromptAttachmentChip = React.memo(function PromptAttachmentChip({
  block,
  index,
  message,
  onOpenPromptAttachment,
  resolvePromptAttachmentThumbnail,
  onLoadPromptAttachmentThumbnail,
}: PromptAttachmentChipProps) {
  const imageAttachment = isPromptImageAttachmentContentBlock(block);
  const label = chatPromptAttachmentLabel(block, index);
  const meta = chatPromptAttachmentMeta(block);
  const thumbnailSrc = resolvePromptAttachmentThumbnail?.(block, message) ?? '';

  React.useEffect(() => {
    if (imageAttachment && !thumbnailSrc) {
      onLoadPromptAttachmentThumbnail?.(block, message);
    }
  }, [block, imageAttachment, message, onLoadPromptAttachmentThumbnail, thumbnailSrc]);

  return (
    <button
      type="button"
      className={`chat-prompt-attachment-chip ${isPromptImageAttachmentContentBlock(block) ? 'image' : 'file'}`}
      title={meta ? `${label} | ${meta}` : label}
      onClick={() => onOpenPromptAttachment?.(block, message)}
    >
      {imageAttachment && thumbnailSrc ? (
        <img
          className="chat-prompt-attachment-thumb"
          src={thumbnailSrc}
          alt=""
          aria-hidden="true"
        />
      ) : (
        <span
          className={`codicon ${imageAttachment ? 'codicon-file-media' : 'codicon-file'} chat-prompt-attachment-icon`}
          aria-hidden="true"
        />
      )}
      <span className="chat-prompt-attachment-body">
        <span className="chat-prompt-attachment-name">{label}</span>
        {meta ? (
          <span className="chat-prompt-attachment-meta">{meta}</span>
        ) : null}
      </span>
    </button>
  );
});

export const ChatTurnView = React.memo(function ChatTurnView({
  message,
  promptRequest,
  promptStatus = null,
  hideToolCalls,
  markdownComponents,
  markdownUrlTransform,
  copyDisabled = true,
  exportBusy = false,
  onCopyPromptDone,
  onExportPromptDoneImage,
  ttsState = 'idle',
  readAloudEnabled = false,
  onReadAloud,
  optionReplies = [],
  optionRepliesDisabled = false,
  onSelectOptionReply,
  confirmationReply = null,
  onSelectConfirmationReply,
  onRetryPendingPrompt,
  onEditPendingPrompt,
  onCancelQueuedPrompt,
  onPrioritizeQueuedPrompt,
  onOpenPromptAttachment,
  resolvePromptAttachmentThumbnail,
  onLoadPromptAttachmentThumbnail,
  onOpenPromptArtifact,
  openingPromptArtifactKey = '',
  promptArtifactErrors = {},
}: ChatTurnViewProps) {
  const text = msgText(message.method, message.param).trim();
  const kind = msgKind(message.method);
  const markdownCapabilities = useMarkdownCapabilityPlugins(text);

  if (message.method === 'prompt_request' || message.method === 'user_message_chunk') {
    const imageBlocks = groupImageBlocks([message]);
    const attachmentBlocks = groupPromptAttachmentBlocks([message]);
    const blocks = msgBlocks(message.method, message.param);
    const inlineParts = buildChatPromptInlineParts(blocks);
    return (
      <div className="chat-prompt-group">
        {text || promptStatus ? (
          <div className="chat-prompt-user-row">
            {text ? (
              <div className="chat-prompt-user">
                {inlineParts.length > 0 ? renderPromptInlineParts(inlineParts) : text}
              </div>
            ) : null}
            {promptStatus === 'responding' ? (
              <span className="chat-prompt-status chat-prompt-status-responding" title="Responding">
                <span className="chat-prompt-status-dots" aria-hidden="true">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </span>
            ) : null}
            {promptStatus === 'confirming' ? (
              <span className="chat-prompt-status chat-prompt-status-confirming" title="Sending">
                <span className="codicon codicon-sync" aria-hidden="true" />
              </span>
            ) : null}
            {promptStatus === 'queued' ? (
              <span className="chat-prompt-status chat-prompt-status-queued" title="Queued">
                Queued
              </span>
            ) : null}
          </div>
        ) : null}
        {imageBlocks.length > 0 ? (
          <div className="chat-image-strip">
            {imageBlocks.map((block, index) => (
              <img
                key={`${message.sessionId}:${message.turnIndex}:img:${index}`}
                className="chat-inline-image"
                src={`data:${block.mimeType || 'image/png'};base64,${block.data}`}
                alt="chat attachment"
              />
            ))}
          </div>
        ) : null}
        {attachmentBlocks.length > 0 ? (
          <div className="chat-prompt-attachment-strip">
            {attachmentBlocks.map((block, index) => (
              <PromptAttachmentChip
                key={`${message.sessionId}:${message.turnIndex}:attachment:${index}`}
                block={block}
                index={index}
                message={message}
                onOpenPromptAttachment={onOpenPromptAttachment}
                resolvePromptAttachmentThumbnail={resolvePromptAttachmentThumbnail}
                onLoadPromptAttachmentThumbnail={onLoadPromptAttachmentThumbnail}
              />
            ))}
          </div>
        ) : null}
        {promptStatus === 'undelivered' ? (
          <div className="chat-prompt-delivery-line">
            <span>Not delivered</span>
            <button type="button" onClick={() => onRetryPendingPrompt?.()}>
              Retry
            </button>
            <button type="button" onClick={() => onEditPendingPrompt?.()}>
              Edit
            </button>
          </div>
        ) : null}
        {promptStatus === 'queued' ? (
          <div className="chat-prompt-queue-actions">
            <button type="button" className="chat-prompt-queue-action" onClick={onPrioritizeQueuedPrompt}>
              Send next
            </button>
            <button type="button" className="chat-prompt-queue-action danger" onClick={onCancelQueuedPrompt}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (message.method === 'prompt_done') {
    const completedAt = typeof message.param.completedAt === 'string' ? Date.parse(message.param.completedAt) : NaN;
    const createdAt = typeof promptRequest?.param.createdAt === 'string' ? Date.parse(promptRequest.param.createdAt) : NaN;
    const durationMs = Number.isFinite(completedAt) && Number.isFinite(createdAt) && completedAt >= createdAt
      ? completedAt - createdAt
      : 0;
    const modelName = typeof promptRequest?.param.modelName === 'string'
      ? promptRequest.param.modelName
      : '';
    const doneStatus = resolvePromptDoneStatus(message.param);
    const diffArtifacts = promptDiffArtifacts(message.param);
    return (
      <>
        {diffArtifacts.length > 0 ? (
          <div className="chat-prompt-artifacts">
            {diffArtifacts.map(artifact => {
              const artifactKey = promptArtifactViewKey(message, artifact);
              const loading = openingPromptArtifactKey === artifactKey;
              const error = promptArtifactErrors[artifactKey] || '';
              return (
                <div key={artifact.artifactId} className="chat-prompt-artifact">
                  <button
                    type="button"
                    className="chat-prompt-artifact-summary"
                    onClick={() => onOpenPromptArtifact?.(artifact, message)}
                    disabled={loading}
                    aria-busy={loading}
                    title="Open full diff"
                  >
                    <span
                      className={`codicon ${loading ? 'codicon-loading codicon-modifier-spin' : 'codicon-diff'}`}
                      aria-hidden="true"
                    />
                    <span>{promptArtifactCountLabel(artifact.fileCount || artifact.files?.length || 0)}</span>
                  </button>
                  {artifact.files && artifact.files.length > 0 ? (
                    <div className="chat-prompt-artifact-files">
                      {artifact.files.map(file => (
                        <button
                          key={`${artifact.artifactId}:${file.path}`}
                          type="button"
                          className="chat-prompt-artifact-file"
                          onClick={() => onOpenPromptArtifact?.(artifact, message, file.path)}
                          title={file.path}
                        >
                          <span className={`chat-prompt-artifact-file-status status-${file.status.toLowerCase()}`}>
                            {file.status}
                          </span>
                          <span className="chat-prompt-artifact-file-path">{file.path}</span>
                          <span className="chat-prompt-artifact-file-counts">
                            {file.additions > 0 ? <span className="additions">+{file.additions}</span> : null}
                            {file.deletions > 0 ? <span className="deletions">-{file.deletions}</span> : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {error ? <div className="chat-prompt-artifact-error">{error}</div> : null}
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="chat-prompt-separator">
          <hr />
          <span className="chat-prompt-separator-label">
            By {modelName || 'unknown'}
            {durationMs > 0 ? ` · ${formatPromptDurationMs(durationMs)}` : ''}
            {doneStatus ? (
              <span className={`chat-prompt-stop-reason ${doneStatus.kind}`}>
                {doneStatus.label}
              </span>
            ) : null}
          </span>
          <div className="chat-prompt-actions" aria-label="Prompt actions">
            <button
              type="button"
              className="chat-prompt-action-button"
              onClick={() => onReadAloud?.()}
              disabled={copyDisabled || !readAloudEnabled || ttsState === 'loading'}
              aria-busy={ttsState === 'loading'}
              title={ttsState === 'playing' ? 'Stop reading' : 'Read aloud'}
              aria-label={ttsState === 'playing' ? 'Stop reading aloud' : 'Read response aloud'}
            >
              {ttsState === 'loading' ? (
                <span className="codicon codicon-loading codicon-modifier-spin" />
              ) : ttsState === 'playing' ? (
                <span className="codicon codicon-debug-stop" />
              ) : (
                <span className="codicon codicon-unmute" />
              )}
            </button>
            <button
              type="button"
              className="chat-prompt-action-button"
              onClick={() => onCopyPromptDone?.()}
              disabled={copyDisabled}
              title="Copy response"
              aria-label="Copy response markdown"
            >
              <span className="codicon codicon-copy" />
            </button>
            <button
              type="button"
              className="chat-prompt-action-button"
              onClick={() => onExportPromptDoneImage?.()}
              disabled={copyDisabled || exportBusy}
              aria-busy={exportBusy}
              title="Export response image"
              aria-label="Export response markdown image"
            >
              <span className="codicon codicon-device-camera" />
            </button>
          </div>
          {doneStatus ? (
            <div className={`chat-prompt-result-line ${doneStatus.kind}`}>
              {doneStatus.message || `Response ${doneStatus.label.toLowerCase()}.`}
            </div>
          ) : null}
        </div>
      </>
    );
  }

  if (message.method === 'agent_plan') {
    return null;
  }
  if (hideToolCalls && kind === 'tool') {
    return null;
  }
  if (kind === 'tool') {
    return (
      <div className="chat-tool-line" title={text}>
        <span className="codicon codicon-tools" />
        <span>{text}</span>
      </div>
    );
  }
  if (kind === 'thought') {
    return (
      <CollapsibleThought
        text={text}
        markdownComponents={markdownComponents}
        markdownUrlTransform={markdownUrlTransform}
      />
    );
  }
  if (!text) {
    return null;
  }
  const optionReplyParts = splitChatOptionReplyText(text);
  const confirmationReplyParts = splitChatConfirmationReplyText(text);
  const hasOptionReplyParts = optionReplyParts.some(part => part.type === 'option');
  const selectableOptionReplies = optionReplies.length > 0;
  const selectableConfirmationReply = optionReplies.length === 0 ? confirmationReply : null;
  const hasConfirmationReplyParts =
    !!selectableConfirmationReply &&
    !hasOptionReplyParts &&
    confirmationReplyParts.some(part => part.type === 'confirmation');
  return (
    <div
      className="chat-main-message"
      data-markdown-export-pending={markdownCapabilities.pending ? 'true' : undefined}
    >
      {hasOptionReplyParts ? (
        optionReplyParts.map((part, index) => {
          if (part.type === 'markdown') {
            return part.text ? (
              <ReactMarkdown
                key={`markdown:${index}`}
                remarkPlugins={markdownCapabilities.remarkPlugins}
                urlTransform={markdownUrlTransform}
                rehypePlugins={markdownCapabilities.rehypePlugins}
                components={markdownComponents}
              >
                {part.text}
              </ReactMarkdown>
            ) : null;
          }
          const optionContent = (
            <>
              <span className="chat-option-reply-label">{part.reply.label}.</span>
              <span className="chat-option-reply-text">{part.reply.text}</span>
            </>
          );
          return (
            <div key={`option:${part.reply.label}:${index}`} className="chat-option-reply-line">
              {selectableOptionReplies ? (
                <button
                  type="button"
                  className="chat-option-reply-inline-button"
                  onClick={() => onSelectOptionReply?.(part.reply.label)}
                  disabled={optionRepliesDisabled}
                  title={part.reply.text}
                  aria-label={`Reply ${part.reply.label}: ${part.reply.text}`}
                >
                  {optionContent}
                </button>
              ) : (
                <div className="chat-option-reply-static" title={part.reply.text}>
                  {optionContent}
                </div>
              )}
            </div>
          );
        })
      ) : hasConfirmationReplyParts ? (
        confirmationReplyParts.map((part, index) => {
          if (part.type === 'markdown') {
            return part.text ? (
              <ReactMarkdown
                key={`markdown:${index}`}
                remarkPlugins={markdownCapabilities.remarkPlugins}
                urlTransform={markdownUrlTransform}
                rehypePlugins={markdownCapabilities.rehypePlugins}
                components={markdownComponents}
              >
                {part.text}
              </ReactMarkdown>
            ) : null;
          }
          return (
            <div key={`confirmation:${index}`} className="chat-confirmation-reply-line">
              <button
                type="button"
                className="chat-confirmation-reply-action"
                onClick={() => onSelectConfirmationReply?.(part.reply.replyText)}
                disabled={optionRepliesDisabled}
                title={part.reply.replyText}
                aria-label={`Reply ${part.reply.replyText}: ${part.reply.sentence}`}
              >
                <span className="chat-confirmation-reply-check" aria-hidden="true">
                  <span className="codicon codicon-check" />
                </span>
                <span className="chat-confirmation-reply-text">{part.reply.sentence}</span>
              </button>
            </div>
          );
        })
      ) : (
        <ReactMarkdown
          remarkPlugins={markdownCapabilities.remarkPlugins}
          urlTransform={markdownUrlTransform}
          rehypePlugins={markdownCapabilities.rehypePlugins}
          components={markdownComponents}
        >
          {text}
        </ReactMarkdown>
      )}
    </div>
  );
});
