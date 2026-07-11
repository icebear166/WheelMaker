import React, { type ReactNode } from 'react';

export type ChatRecentSessionsSurfaceProps = {
  children: ReactNode;
  onUnpin: () => void;
};

export const ChatRecentSessionsSurface = React.memo(function ChatRecentSessionsSurface({
  children,
  onUnpin,
}: ChatRecentSessionsSurfaceProps) {
  const [collapsed, setCollapsed] = React.useState(false);

  if (collapsed) {
    return (
      <aside className="chat-recent-sessions-surface desktop collapsed" aria-label="Recent sessions">
        <button
          type="button"
          className="chat-recent-sessions-compact-trigger"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-label="Expand recent sessions"
          title="Expand recent sessions"
        >
          <span className="codicon codicon-history chat-recent-sessions-compact-icon" aria-hidden="true" />
          <span className="chat-recent-sessions-surface-title">Recent Sessions</span>
          <span className="codicon codicon-chevron-down chat-recent-sessions-compact-chevron" aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="chat-recent-sessions-surface desktop expanded" aria-label="Recent sessions">
      <div className="chat-recent-sessions-surface-header">
        <button
          type="button"
          className="chat-recent-sessions-surface-toggle"
          onClick={() => setCollapsed(true)}
          aria-expanded={true}
          aria-label="Collapse recent sessions"
          title="Collapse recent sessions"
        >
          <span className="codicon codicon-chevron-up" aria-hidden="true" />
        </button>
        <span className="chat-recent-sessions-surface-title">Recent Sessions</span>
        <button
          type="button"
          className="chat-recent-sessions-surface-unpin"
          onClick={onUnpin}
          aria-label="Unpin recent sessions"
          title="Unpin recent sessions"
        >
          <span className="codicon codicon-pinned" aria-hidden="true" />
        </button>
      </div>
      <div className="chat-recent-sessions-surface-list">{children}</div>
    </aside>
  );
});
