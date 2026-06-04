import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';

import { useMarkdownCapabilityPlugins } from '../code/markdownPreview';
import type { RegistryChatMessage, RegistrySessionContentBlock } from '../registry/registryTypes';
import { formatPromptDurationMs } from '../workspace/sessionTime';
import {
  chatPromptAttachmentLabel,
  chatPromptAttachmentMeta,
  isPromptAttachmentContentBlock,
} from './chatPromptAttachments';
import {
  splitChatConfirmationReplyText,
  splitChatOptionReplyText,
  type ChatConfirmationReply,
  type ChatOptionReply,
} from './chatOptionReplies';
import { resolvePromptDoneStatus, type ChatPromptStatus } from './chatPromptStatus';

function msgKind(method: string): string {
  switch (method) {
    case 'prompt_done':
      return 'prompt_result';
    case 'agent_thought_chunk':
      return 'thought';
    case 'tool_call':
      return 'tool';
    case 'agent_plan':
      return 'plan';
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

function msgPlanEntries(
  method: string,
  param: Record<string, unknown>,
): { content: string; status?: string }[] {
  if (method !== 'agent_plan' || !Array.isArray(param)) {
    return [];
  }
  const entries: { content: string; status?: string }[] = [];
  for (const item of param as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const content = typeof entry.content === 'string' ? entry.content.trim() : '';
    if (!content) continue;
    const status = typeof entry.status === 'string' ? entry.status.trim() : '';
    entries.push(status ? { content, status } : { content });
  }
  return entries;
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

function isPlanEntryCompleted(status?: string): boolean {
  const value = (status || '').trim().toLowerCase();
  return value === 'completed' || value === 'done' || value === 'success';
}

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
  optionReplies?: ChatOptionReply[];
  optionRepliesDisabled?: boolean;
  onSelectOptionReply?: (label: string) => void;
  confirmationReply?: ChatConfirmationReply | null;
  onSelectConfirmationReply?: (replyText: string) => void;
  onRetryPendingPrompt?: () => void;
  onEditPendingPrompt?: () => void;
};

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
  optionReplies = [],
  optionRepliesDisabled = false,
  onSelectOptionReply,
  confirmationReply = null,
  onSelectConfirmationReply,
  onRetryPendingPrompt,
  onEditPendingPrompt,
}: ChatTurnViewProps) {
  const text = msgText(message.method, message.param).trim();
  const kind = msgKind(message.method);
  const markdownCapabilities = useMarkdownCapabilityPlugins(text);

  if (message.method === 'prompt_request' || message.method === 'user_message_chunk') {
    const imageBlocks = groupImageBlocks([message]);
    const attachmentBlocks = groupPromptAttachmentBlocks([message]);
    return (
      <div className="chat-prompt-group">
        {text || promptStatus ? (
          <div className="chat-prompt-user-row">
            {text ? (
              <div className="chat-prompt-user">{text}</div>
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
            {attachmentBlocks.map((block, index) => {
              const label = chatPromptAttachmentLabel(block, index);
              const meta = chatPromptAttachmentMeta(block);
              return (
                <div
                  key={`${message.sessionId}:${message.turnIndex}:attachment:${index}`}
                  className={`chat-prompt-attachment-chip ${block.type === 'image' ? 'image' : 'file'}`}
                  title={meta ? `${label} | ${meta}` : label}
                >
                  <span
                    className={`codicon ${block.type === 'image' ? 'codicon-file-media' : 'codicon-file'} chat-prompt-attachment-icon`}
                    aria-hidden="true"
                  />
                  <span className="chat-prompt-attachment-body">
                    <span className="chat-prompt-attachment-name">{label}</span>
                    {meta ? (
                      <span className="chat-prompt-attachment-meta">{meta}</span>
                    ) : null}
                  </span>
                </div>
              );
            })}
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
    return (
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
    );
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
  if (kind === 'plan') {
    let planEntries = msgPlanEntries(message.method, message.param);
    if (planEntries.length === 0 && text) {
      planEntries = text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(content => ({ content }));
    }
    if (planEntries.length === 0) {
      return null;
    }
    return (
      <div className="chat-plan-block">
        <div className="chat-plan-title">
          <span className="codicon codicon-checklist" />
          <span>Plan</span>
        </div>
        <ul className="chat-plan-list">
          {planEntries.map((item, index) => {
            const done = isPlanEntryCompleted(item.status);
            return (
              <li
                key={`${message.sessionId}:${message.turnIndex}:plan:${index}`}
                className={done ? 'done' : ''}
              >
                <span className="chat-plan-marker">{done ? '✓' : '○'}</span>
                <span>{item.content}</span>
              </li>
            );
          })}
        </ul>
      </div>
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
