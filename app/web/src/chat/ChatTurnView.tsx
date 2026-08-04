import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';

import { useMarkdownCapabilityPlugins } from '../code/markdownPreview';
import {ChatActivityDots} from './ChatActivityDots';
import {ChatIcon, type ChatIconName} from './ChatIcon';
import type {
  RegistryChatMessage,
  RegistrySessionContentBlock,
  RegistrySessionPromptArtifact,
  RegistrySessionPromptArtifactFile,
  RegistrySessionQueueItem,
  RegistrySessionQueueItemStatus,
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
  chatOptionReplyLabelsByLine,
  type ChatConfirmationReply,
  type ChatOptionReply,
} from './chatOptionReplies';
import { resolvePromptDoneStatus, type ChatPromptStatus } from './turns/chatPromptStatus';
import {msgText} from './chatMessageText';
import {splitChatSearchHighlightSegments} from './search/chatSearchState';
import {createChatSearchHighlightPlugin} from './search/chatSearchHighlightPlugin';
import {permissionRequestView, type ChatPermissionRecord} from './permission/chatPermissionState';

function renderChatTextWithHighlight(text: string, query: string | undefined) {
  if (!query) {
    return text;
  }
  return splitChatSearchHighlightSegments(text, query).map((segment, index) =>
    segment.match ? (
      <mark key={index} className="chat-search-match">
        {segment.text}
      </mark>
    ) : (
      <span key={index}>{segment.text}</span>
    ),
  );
}

function collectMarkdownText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(collectMarkdownText).join('');
  }
  if (React.isValidElement<{children?: React.ReactNode}>(node)) {
    return collectMarkdownText(node.props.children);
  }
  return '';
}

function normalizeRenderedReplyText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

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

function sessionOperationView(param: Record<string, unknown>): {
  label: string;
  detail: string;
  icon: ChatIconName;
  status: string;
} {
  const status = typeof param.status === 'string' ? param.status : '';
  const detail = typeof param.message === 'string' ? param.message.trim() : '';
  if (param.type === 'fork') {
    const rawOrigin = param.forkedFrom && typeof param.forkedFrom === 'object'
      ? param.forkedFrom as Record<string, unknown>
      : {};
    const source = typeof rawOrigin.title === 'string' && rawOrigin.title.trim()
      ? rawOrigin.title.trim()
      : typeof rawOrigin.sessionId === 'string' && rawOrigin.sessionId.trim()
        ? rawOrigin.sessionId.trim()
        : 'another session';
    const turnIndex = typeof rawOrigin.turnIndex === 'number' && Number.isFinite(rawOrigin.turnIndex)
      ? Math.max(0, Math.trunc(rawOrigin.turnIndex))
      : 0;
    return {
      label: `Forked from ${source}`,
      detail: detail || (turnIndex > 0 ? `Through turn ${turnIndex}` : ''),
      icon: 'gitBranch',
      status: status || 'completed',
    };
  }
  switch (status) {
    case 'queued':
      return {label: 'Context compaction queued', detail, icon: 'circle', status};
    case 'completed':
      return {label: 'Context compressed', detail, icon: 'circleCheck', status};
    case 'failed':
      return {label: 'Context compaction failed', detail, icon: 'circleX', status};
    default:
      return {label: 'Compressing context', detail, icon: 'loader', status: 'started'};
  }
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
  finished,
  markdownComponents,
  markdownUrlTransform,
}: {
  text: string;
  finished: boolean;
  markdownComponents: Components;
  markdownUrlTransform: (value: string) => string;
}) {
  const [open, setOpen] = React.useState(false);
  const markdownCapabilities = useMarkdownCapabilityPlugins(text);
  const firstLine = (text || '')
    .split('\n')
    .map(line => line.trim())
    .find(Boolean) || '';
  const title = open ? 'Thinking' : finished ? firstLine || 'Thinking' : 'Thinking';

  return (
    <div className={`chat-thought-block${open ? ' chat-thought-open' : ''}${finished ? ' done' : ' streaming'}`}>
      <button
        type="button"
        className="chat-thought-header"
        aria-expanded={open}
        aria-label={open ? 'Collapse thinking' : 'Expand thinking'}
        onClick={() => setOpen(current => !current)}
      >
        <ChatIcon name="chevronRight" size={11} className="chat-thought-chevron" />
        <ChatIcon name="lightbulb" size={11} className="chat-thought-icon" />
        <span className="chat-thought-title">
          {title}
          {!finished ? <ChatActivityDots /> : null}
        </span>
      </button>
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

function renderPromptInlineParts(
  parts: ChatPromptInlinePart[],
  highlightQuery: string | undefined,
): React.ReactNode {
  return parts.map((part, index) => {
    if (part.type === 'text') {
      return (
        <React.Fragment key={`text:${index}`}>
          {renderChatTextWithHighlight(part.text, highlightQuery)}
        </React.Fragment>
      );
    }
    return (
      <span
        key={`${part.type}:${index}:${part.type === 'file' ? part.path : part.command}`}
        className={`chat-prompt-inline-capsule ${part.type}`}
        data-tooltip={part.type === 'file' ? part.path : part.command}
      >
        <span className="chat-prompt-inline-capsule-icon" aria-hidden="true">
          <ChatIcon name={part.type === 'skill' ? 'wand' : 'file'} size={11} />
        </span>
        <span className="chat-prompt-inline-capsule-label">{part.label}</span>
      </span>
    );
  });
}

export type ChatTurnViewProps = {
  message: RegistryChatMessage;
  permissionRecord?: ChatPermissionRecord;
  promptRequest?: RegistryChatMessage;
  promptStatus?: ChatPromptStatus;
  markdownComponents: Components;
  markdownUrlTransform: (value: string) => string;
  copyDisabled?: boolean;
  exportBusy?: boolean;
  exportHtmlBusy?: boolean;
  forkSupported?: boolean;
  forkBusy?: boolean;
  onCopyPromptDone?: () => void;
  onExportPromptDoneImage?: () => void;
  onExportPromptDoneHtml?: () => void;
  onForkPromptDone?: () => void;
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
  onRetryFailedPrompt?: () => void;
  queueItemStatus?: RegistrySessionQueueItemStatus;
  queueActions?: ChatQueueActions;
  onOpenPromptAttachment?: (block: RegistrySessionContentBlock, message: RegistryChatMessage) => void;
  resolvePromptAttachmentThumbnail?: (block: RegistrySessionContentBlock, message: RegistryChatMessage) => string;
  onLoadPromptAttachmentThumbnail?: (block: RegistrySessionContentBlock, message: RegistryChatMessage) => void;
  onOpenPromptArtifact?: (artifact: RegistrySessionPromptArtifact, message: RegistryChatMessage, filePath?: string) => void;
  onOpenPromptArtifactFileContextMenu?: (
    artifact: RegistrySessionPromptArtifact,
    message: RegistryChatMessage,
    file: RegistrySessionPromptArtifactFile,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => void;
  openingPromptArtifactKey?: string;
  promptArtifactErrors?: Record<string, string>;
  highlightQuery?: string;
};

export type ChatQueueActions = {
  cancel?: () => void;
  prioritize?: () => void;
  steer?: () => void;
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
        <ChatIcon
          name={imageAttachment ? 'image' : 'file'}
          className="chat-prompt-attachment-icon"
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
  permissionRecord,
  promptRequest,
  promptStatus = null,
  markdownComponents,
  markdownUrlTransform,
  copyDisabled = true,
  exportBusy = false,
  exportHtmlBusy = false,
  forkSupported = false,
  forkBusy = false,
  onCopyPromptDone,
  onExportPromptDoneImage,
  onExportPromptDoneHtml,
  onForkPromptDone,
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
  onRetryFailedPrompt,
  queueItemStatus,
  queueActions,
  onOpenPromptAttachment,
  resolvePromptAttachmentThumbnail,
  onLoadPromptAttachmentThumbnail,
  onOpenPromptArtifact,
  onOpenPromptArtifactFileContextMenu,
  openingPromptArtifactKey = '',
  promptArtifactErrors = {},
  highlightQuery,
}: ChatTurnViewProps) {
  const text = msgText(message.method, message.param).trim();
  const kind = msgKind(message.method);
  const markdownCapabilities = useMarkdownCapabilityPlugins(text);
  const highlightRehypePlugins = React.useMemo(
    () => highlightQuery
      ? [...markdownCapabilities.rehypePlugins, createChatSearchHighlightPlugin(highlightQuery)]
      : markdownCapabilities.rehypePlugins,
    [markdownCapabilities.rehypePlugins, highlightQuery],
  );
  const interactiveMarkdownComponents = React.useMemo<Components>(() => {
    if (!onSelectOptionReply && !onSelectConfirmationReply) {
      return markdownComponents;
    }
    const BaseParagraph = markdownComponents.p;
    const BaseListItem = markdownComponents.li;
    const optionReplyLabelsByLine = chatOptionReplyLabelsByLine(text);
    const resolveReply = (
      node: {position?: {start?: {line?: number}}} | undefined,
      children: React.ReactNode,
    ): {
      value: string;
      label: string;
      submit: () => void;
    } | null => {
      const renderedText = normalizeRenderedReplyText(collectMarkdownText(children));
      const sourceLine = node?.position?.start?.line;
      const sourceLabel = sourceLine
        ? optionReplyLabelsByLine.get(sourceLine) ?? ''
        : '';
      const visibleLabel = sourceLine
        ? ''
        : /^([A-H1-9])\.\s+/.exec(renderedText)?.[1]?.toUpperCase() ?? '';
      const optionLabel = sourceLabel || visibleLabel;
      const optionReply = optionLabel
        ? optionReplies.find(reply => reply.label === optionLabel)
        : undefined;
      if (optionReply && onSelectOptionReply) {
        return {
          value: optionReply.label,
          label: `Reply ${optionReply.label}: ${renderedText}`,
          submit: () => onSelectOptionReply(optionReply.label),
        };
      }
      const confirmationSentence = confirmationReply
        ? normalizeRenderedReplyText(confirmationReply.sentence)
        : '';
      if (
        confirmationReply &&
        onSelectConfirmationReply &&
        confirmationSentence &&
        (renderedText === confirmationSentence || renderedText.endsWith(confirmationSentence))
      ) {
        return {
          value: confirmationReply.replyText,
          label: `Reply ${confirmationReply.replyText}: ${confirmationReply.sentence}`,
          submit: () => onSelectConfirmationReply(confirmationReply.replyText),
        };
      }
      return null;
    };
    const renderParagraph: NonNullable<Components['p']> = ({node, children, ...props}) => {
      const reply = resolveReply(node, children);
      const activate = () => {
        if (!optionRepliesDisabled) {
          reply?.submit();
        }
      };
      const paragraphProps = reply
        ? {
            ...props,
            className: [props.className, 'chat-reply-target'].filter(Boolean).join(' '),
            'data-chat-reply-value': reply.value,
            role: 'button',
            tabIndex: 0,
            'aria-disabled': optionRepliesDisabled || undefined,
            'aria-label': reply.label,
            onClick: (event: React.MouseEvent<HTMLParagraphElement>) => {
              props.onClick?.(event);
              activate();
            },
            onKeyDown: (event: React.KeyboardEvent<HTMLParagraphElement>) => {
              props.onKeyDown?.(event);
              if (event.defaultPrevented || (event.key !== 'Enter' && event.key !== ' ')) {
                return;
              }
              event.preventDefault();
              activate();
            },
          }
        : props;
      return BaseParagraph ? (
        React.createElement(
          BaseParagraph as React.ElementType,
          {node, ...paragraphProps},
          children,
        )
      ) : (
        <p {...paragraphProps}>{children}</p>
      );
    };
    const renderListItem: NonNullable<Components['li']> = ({node, children, ...props}) => {
      const reply = resolveReply(node, children);
      const activate = () => {
        if (!optionRepliesDisabled) {
          reply?.submit();
        }
      };
      const listItemProps = reply
        ? {
            ...props,
            className: [props.className, 'chat-reply-target'].filter(Boolean).join(' '),
            'data-chat-reply-value': reply.value,
            role: 'button',
            tabIndex: 0,
            'aria-disabled': optionRepliesDisabled || undefined,
            'aria-label': reply.label,
            onClick: (event: React.MouseEvent<HTMLLIElement>) => {
              props.onClick?.(event);
              activate();
            },
            onKeyDown: (event: React.KeyboardEvent<HTMLLIElement>) => {
              props.onKeyDown?.(event);
              if (event.defaultPrevented || (event.key !== 'Enter' && event.key !== ' ')) {
                return;
              }
              event.preventDefault();
              activate();
            },
          }
        : props;
      return BaseListItem ? (
        React.createElement(
          BaseListItem as React.ElementType,
          {node, ...listItemProps},
          children,
        )
      ) : (
        <li {...listItemProps}>{children}</li>
      );
    };
    return {
      ...markdownComponents,
      p: renderParagraph,
      li: renderListItem,
    };
  }, [
    confirmationReply,
    markdownComponents,
    onSelectConfirmationReply,
    onSelectOptionReply,
    optionReplies,
    optionRepliesDisabled,
    text,
  ]);

  if (message.method === 'permission_request' && permissionRecord && permissionRecord.status !== 'pending') {
    const reasonLabels: Record<NonNullable<ChatPermissionRecord['unansweredReason']>, string> = {
      cancelled: 'Cancelled',
      failed: 'Failed',
      interrupted: 'Interrupted',
      ended: 'Unanswered',
    };
    const summary = permissionRecord.status === 'selected'
      ? `Selected: ${permissionRecord.optionName || permissionRecord.optionId || 'Unknown option'}`
      : reasonLabels[permissionRecord.unansweredReason ?? 'ended'];
    const requestView = permissionRequestView(message);
    const question = requestView.detailsText || requestView.title;
    return (
      <div className="chat-permission-history-row" role="status">
        <ChatIcon name="help" className="chat-permission-history-icon" />
        <span className="chat-permission-history-label">Permission</span>
        <div className="chat-permission-history-qa">
          {question ? (
            <span className="chat-permission-history-question" title={question}>{question}</span>
          ) : null}
          <span className="chat-permission-history-summary" title={summary}>{summary}</span>
        </div>
      </div>
    );
  }

  if (message.method === 'session_operation') {
    const operation = sessionOperationView(message.param);
    const operationTypeClass = message.param.type === 'fork' ? ' fork' : '';
    return (
      <div className={`chat-session-operation${operationTypeClass} ${operation.status}`} role="status">
        <ChatIcon name={operation.icon} spin={operation.status === 'started'} className="chat-session-operation-icon" />
        <span className="chat-session-operation-label">{operation.label}</span>
        {operation.detail ? <span className="chat-session-operation-detail">{operation.detail}</span> : null}
      </div>
    );
  }

  if (message.method === 'prompt_request' || message.method === 'user_message_chunk') {
    const imageBlocks = groupImageBlocks([message]);
    const attachmentBlocks = groupPromptAttachmentBlocks([message]);
    const blocks = msgBlocks(message.method, message.param);
    const inlineParts = buildChatPromptInlineParts(blocks);
    const steered = message.method === 'user_message_chunk' && message.param.steered === true;
    const queueStatus = queueItemStatus ?? (
      promptStatus === 'queued' || promptStatus === 'steering' ? promptStatus : undefined
    );
    const queueStatusLabel = queueStatus === 'cancelling'
        ? 'Cancelling'
        : queueStatus === 'steering'
          ? 'Steering'
          : queueStatus === 'running'
            ? 'Running'
            : 'Queued';
    return (
      <div className="chat-prompt-group">
        {text || promptStatus || steered ? (
          <div className="chat-prompt-user-row">
            {text ? (
              <div className="chat-prompt-user">
                {inlineParts.length > 0
                  ? renderPromptInlineParts(inlineParts, highlightQuery)
                  : renderChatTextWithHighlight(text, highlightQuery)}
              </div>
            ) : null}
            {steered ? (
              <span className="chat-prompt-steered-label" data-tooltip="Inserted into the active turn">
                <ChatIcon name="cornerDownLeft" size={11} />
                <span>Steered</span>
              </span>
            ) : null}
            {promptStatus === 'responding' ? (
              <span className="chat-prompt-status chat-prompt-status-responding" data-tooltip="Responding">
                <span className="chat-prompt-status-dots" aria-hidden="true">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </span>
            ) : null}
            {promptStatus === 'confirming' ? (
              <span className="chat-prompt-status chat-prompt-status-confirming" data-tooltip="Sending">
                <ChatIcon name="refreshCw" size={12} />
              </span>
            ) : null}
            {queueStatus ? (
              <span
                className={`chat-prompt-status chat-prompt-status-queued ${queueStatus}`}
              >
                {queueStatusLabel}
              </span>
            ) : null}
            {queueStatus && queueStatus !== 'cancelling' && queueStatus !== 'running' ? (
              <div className="chat-prompt-queue-actions">
                {queueStatus === 'queued' && queueActions?.steer ? (
                  <button
                    type="button"
                    className="chat-prompt-queue-action"
                    data-tooltip="Steer"
                    aria-label="Steer"
                    onClick={queueActions.steer}
                  >
                    <ChatIcon name="cornerDownLeft" size={12} />
                  </button>
                ) : null}
                {queueStatus === 'queued' && queueActions?.prioritize ? (
                  <button
                    type="button"
                    className="chat-prompt-queue-action"
                    data-tooltip="Next"
                    aria-label="Prioritize"
                    onClick={queueActions.prioritize}
                  >
                    <ChatIcon name="arrowUpToLine" size={12} />
                  </button>
                ) : null}
                {queueActions?.cancel ? (
                  <button
                    type="button"
                    className="chat-prompt-queue-action danger"
                    data-tooltip="Cancel"
                    aria-label="Cancel"
                    onClick={queueActions.cancel}
                  >
                    <ChatIcon name="x" size={12} />
                  </button>
                ) : null}
              </div>
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
    const rawForkPoint = message.param.forkPoint;
    const forkPoint = rawForkPoint && typeof rawForkPoint === 'object'
      ? rawForkPoint as Record<string, unknown>
      : null;
    const canFork = typeof forkPoint?.provider === 'string'
      && forkPoint.provider.trim() !== ''
      && typeof forkPoint.ref === 'string'
      && forkPoint.ref.trim() !== ''
      && forkSupported
      && typeof onForkPromptDone === 'function';
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
                    data-tooltip="Open full diff"
                  >
                    <ChatIcon name={loading ? 'loader' : 'fileDiff'} spin={loading} />
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
                          onContextMenu={event =>
                            onOpenPromptArtifactFileContextMenu?.(artifact, message, file, event)
                          }
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
            {doneStatus?.kind === 'failed' && onRetryFailedPrompt ? (
              <button
                type="button"
                className="chat-prompt-action-button"
                onClick={onRetryFailedPrompt}
                data-tooltip="Retry failed prompt"
                aria-label="Retry failed prompt"
              >
                <ChatIcon name="refreshCw" size={13} />
              </button>
            ) : null}
            {canFork ? (
              <button
                type="button"
                className="chat-prompt-action-button"
                onClick={() => onForkPromptDone?.()}
                disabled={forkBusy}
                aria-busy={forkBusy}
                data-tooltip="Fork session from here"
                aria-label="Fork session from here"
              >
                <ChatIcon name={forkBusy ? 'loader' : 'gitBranch'} size={13} spin={forkBusy} />
              </button>
            ) : null}
            <button
              type="button"
              className="chat-prompt-action-button"
              onClick={() => onReadAloud?.()}
              disabled={copyDisabled || !readAloudEnabled || ttsState === 'loading'}
              aria-busy={ttsState === 'loading'}
              data-tooltip={ttsState === 'playing' ? 'Stop reading' : 'Read aloud'}
              aria-label={ttsState === 'playing' ? 'Stop reading aloud' : 'Read response aloud'}
            >
              {ttsState === 'loading' ? (
                <ChatIcon name="loader" size={13} spin />
              ) : ttsState === 'playing' ? (
                <ChatIcon name="stop" size={13} filled />
              ) : (
                <ChatIcon name="volume2" size={13} />
              )}
            </button>
            <button
              type="button"
              className="chat-prompt-action-button"
              onClick={() => onCopyPromptDone?.()}
              disabled={copyDisabled}
              data-tooltip="Copy response"
              aria-label="Copy response markdown"
            >
              <ChatIcon name="copy" size={13} />
            </button>
            <button
              type="button"
              className="chat-prompt-action-button"
              onClick={() => onExportPromptDoneImage?.()}
              disabled={copyDisabled || exportBusy}
              aria-busy={exportBusy}
              data-tooltip="Export response image"
              aria-label="Export response markdown image"
            >
              <ChatIcon name="camera" size={13} />
            </button>
            <button
              type="button"
              className="chat-prompt-action-button"
              onClick={() => onExportPromptDoneHtml?.()}
              disabled={copyDisabled || exportHtmlBusy}
              aria-busy={exportHtmlBusy}
              data-tooltip="Export response HTML"
              aria-label="Export response markdown as HTML"
            >
              <ChatIcon name="fileCode" size={13} />
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
  if (kind === 'thought') {
    return (
      <CollapsibleThought
        text={text}
        finished={message.finished}
        markdownComponents={markdownComponents}
        markdownUrlTransform={markdownUrlTransform}
      />
    );
  }
  if (!text) {
    return null;
  }
  return (
    <div
      className="chat-main-message"
      data-markdown-export-pending={markdownCapabilities.pending ? 'true' : undefined}
    >
      <ReactMarkdown
        remarkPlugins={markdownCapabilities.remarkPlugins}
        urlTransform={markdownUrlTransform}
        rehypePlugins={highlightRehypePlugins}
        components={interactiveMarkdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

export const ChatQueueCompactView = React.memo(function ChatQueueCompactView({
  item,
  actions,
}: {
  item: RegistrySessionQueueItem & {kind: 'compact'};
  actions: ChatQueueActions;
}) {
  const label = item.status === 'running'
      ? 'Compressing context'
      : item.status === 'cancelling'
        ? 'Cancelling context compaction'
        : 'Context compaction queued';
  return (
    <div className={`chat-queue-compact-row ${item.status}`} role="status">
      <ChatIcon
        name={item.status === 'running' ? 'loader' : 'circle'}
        spin={item.status === 'running'}
        className="chat-session-operation-icon"
      />
      <span className="chat-session-operation-label">{label}</span>
      <span className="chat-prompt-queue-actions">
        {item.status === 'queued' && actions.prioritize ? (
          <button type="button" className="chat-prompt-queue-action" aria-label="Prioritize" onClick={actions.prioritize}>
            <ChatIcon name="arrowUpToLine" size={12} />
          </button>
        ) : null}
        {item.status === 'queued' && actions.cancel ? (
          <button type="button" className="chat-prompt-queue-action danger" aria-label="Cancel" onClick={actions.cancel}>
            <ChatIcon name="x" size={12} />
          </button>
        ) : null}
      </span>
    </div>
  );
});
