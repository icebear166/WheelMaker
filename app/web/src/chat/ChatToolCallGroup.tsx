import React from 'react';

import type {RegistryChatMessage} from '../registry/registryTypes';
import {ChatActivityDots} from './ChatActivityDots';
import {ChatIcon, type ChatIconName} from './ChatIcon';

type ToolCallView = {
  key: string;
  title: string;
  kind: string;
  status: string;
};

function stringParam(message: RegistryChatMessage, key: string): string {
  const value = message.param[key];
  return typeof value === 'string' ? value.trim() : '';
}

function toolCallView(message: RegistryChatMessage): ToolCallView {
  return {
    key: `${message.sessionId}:${message.turnIndex}`,
    title: stringParam(message, 'cmd') || 'Tool call',
    kind: stringParam(message, 'kind'),
    status: stringParam(message, 'status').toLowerCase(),
  };
}

function toolStatusIcon(status: string): ChatIconName {
  if (status === 'in_progress' || status === 'pending' || status === 'running') {
    return 'loader';
  }
  if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
    return 'circleX';
  }
  if (status === 'completed' || status === 'done') {
    return 'circleCheck';
  }
  return 'wrench';
}

function toolStatusClass(status: string): string {
  if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
    return 'failed';
  }
  if (status === 'completed' || status === 'done') {
    return 'completed';
  }
  if (status === 'in_progress' || status === 'pending' || status === 'running') {
    return 'running';
  }
  return 'unknown';
}

function toolCallRunning(status: string): boolean {
  return status === 'in_progress' || status === 'pending' || status === 'running';
}

export const ChatToolCallGroup = React.memo(function ChatToolCallGroup({
  messages,
  active,
}: {
  messages: RegistryChatMessage[];
  active?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const calls = messages.map(toolCallView);
  const latest = calls[calls.length - 1] ?? {
    key: 'empty',
    title: 'Tool call',
    kind: '',
    status: '',
  };
  const count = calls.length;
  const running = active ?? calls.some(call => toolCallRunning(call.status));
  const countLabel = `${running ? 'Calling' : 'Called'} ${count} ${count === 1 ? 'tool' : 'tools'}`;

  return (
    <div className={`chat-tool-group${running ? ' chat-tool-group-running' : ''}${open ? ' chat-tool-group-open' : ''}`}>
      <button
        type="button"
        className="chat-tool-group-header"
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${count} tool ${count === 1 ? 'call' : 'calls'}`}
        onClick={() => setOpen(current => !current)}
        data-tooltip={open ? undefined : latest.title}
      >
        <ChatIcon name="chevronRight" size={11} className="chat-tool-group-chevron" />
        <ChatIcon name="wrench" size={11} className="chat-tool-group-summary-icon" />
        <span className="chat-tool-group-count">
          {countLabel}
          {running ? <ChatActivityDots /> : null}
        </span>
        {!open ? (
          <>
            <span className="chat-tool-group-separator" aria-hidden="true">·</span>
            <span className="chat-tool-group-latest">{latest.title}</span>
          </>
        ) : null}
      </button>
      {open ? (
        <div className="chat-tool-group-list">
          {calls.map(call => (
            <div className="chat-tool-group-row" key={call.key}>
              <ChatIcon
                size={11}
                name={toolStatusIcon(call.status)}
                spin={toolCallRunning(call.status)}
                className={`chat-tool-group-status ${toolStatusClass(call.status)}`}
              />
              <span className="chat-tool-group-row-title" data-tooltip={call.title}>{call.title}</span>
              {call.kind ? <span className="chat-tool-group-kind">{call.kind}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});
