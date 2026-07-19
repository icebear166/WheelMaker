import React, { type ReactNode } from 'react';
import type {SessionListDensity} from './sessionListDensity';
import {useChatEdgeSurfaceGeometry} from './layout/chatEdgeSurfaceGeometry';

export type ChatRecentSessionsSurfaceProps = {
  children: ReactNode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sessionListDensity: SessionListDensity;
  /** Replaces the default expanded-state header (title + collapse toggle). */
  header?: ReactNode;
};

export const ChatRecentSessionsSurface = React.memo(function ChatRecentSessionsSurface({
  children,
  collapsed,
  onToggleCollapsed,
  sessionListDensity,
  header,
}: ChatRecentSessionsSurfaceProps) {
  const surfaceRef = useChatEdgeSurfaceGeometry('left');

  if (collapsed) {
    return (
      <aside
        ref={surfaceRef}
        className="chat-recent-sessions-surface desktop collapsed"
        data-session-list-density={sessionListDensity}
        aria-label="Recent sessions"
      >
        <div className="chat-edge-surface-glass" aria-hidden="true" />
        <div className="chat-edge-surface-content">
          <button
            type="button"
            className="chat-recent-sessions-compact-trigger"
            onClick={onToggleCollapsed}
            aria-expanded={false}
            aria-label="Expand recent sessions"
            title="Expand recent sessions"
          >
            <span className="codicon codicon-history chat-recent-sessions-compact-icon" aria-hidden="true" />
            <span className="chat-recent-sessions-surface-title">Recent Sessions</span>
            <span className="codicon codicon-chevron-down chat-recent-sessions-compact-chevron" aria-hidden="true" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={surfaceRef}
      className="chat-recent-sessions-surface desktop expanded"
      data-session-list-density={sessionListDensity}
      aria-label="Recent sessions"
    >
      <div className="chat-edge-surface-glass" aria-hidden="true" />
      <div className="chat-edge-surface-content">
        {header ?? (
          <div className="chat-recent-sessions-surface-header">
            <button
              type="button"
              className="chat-recent-sessions-surface-toggle"
              onClick={onToggleCollapsed}
              aria-expanded={true}
              aria-label="Collapse recent sessions"
              title="Collapse recent sessions"
            >
              <span className="codicon codicon-chevron-up" aria-hidden="true" />
            </button>
            <span className="chat-recent-sessions-surface-title">Recent Sessions</span>
          </div>
        )}
        <div className="chat-recent-sessions-surface-list">{children}</div>
      </div>
    </aside>
  );
});
