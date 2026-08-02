import React from 'react';

import {formatPromptDurationMs} from '../workspace/sessionTime';
import {ChatIcon} from './ChatIcon';
import type {ChatWorkGroupStatus} from './turns/chatDisplayIndex';

function workGroupLabel(status: ChatWorkGroupStatus, durationMs: number): string {
  const duration = durationMs > 0 ? formatPromptDurationMs(durationMs) : '';
  if (status === 'failed') {
    return duration ? `Failed after ${duration}` : 'Failed';
  }
  if (status === 'stopped') {
    return duration ? `Stopped after ${duration}` : 'Stopped';
  }
  return duration ? `Worked for ${duration}` : 'Worked';
}

export const ChatWorkGroup = React.memo(function ChatWorkGroup({
  status,
  durationMs,
  highlighted,
  children,
}: {
  status: ChatWorkGroupStatus;
  durationMs: number;
  highlighted?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const label = workGroupLabel(status, durationMs);

  return (
    <div
      className={[
        'chat-view-content',
        'chat-work-group',
        open ? 'chat-work-group-open' : '',
        highlighted ? 'chat-turn-search-highlight' : '',
      ].filter(Boolean).join(' ')}
    >
      <button
        type="button"
        className="chat-work-group-header"
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} completed work`}
        onClick={() => setOpen(current => !current)}
      >
        <ChatIcon name="chevronRight" size={11} className="chat-work-group-chevron" />
        <span className="chat-work-group-label">{label}</span>
      </button>
      {open ? <div className="chat-work-group-content">{children}</div> : null}
    </div>
  );
});
