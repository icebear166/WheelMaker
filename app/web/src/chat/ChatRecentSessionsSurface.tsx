import React, { type ReactNode } from 'react';
import {DESKTOP_SESSION_LIST_DENSITY} from './sessionListDensity';
import {useChatEdgeSurfaceGeometry} from './layout/chatEdgeSurfaceGeometry';
import {ChatSessionPanel} from './ChatSessionPanel';

export type ChatRecentSessionsSurfaceProps = {
  children: ReactNode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Session layout controls rendered in the shared title bar. */
  header?: ReactNode;
};

export const ChatRecentSessionsSurface = React.memo(function ChatRecentSessionsSurface({
  children,
  collapsed,
  onToggleCollapsed,
  header,
}: ChatRecentSessionsSurfaceProps) {
  const surfaceRef = useChatEdgeSurfaceGeometry('left');

  return (
    <ChatSessionPanel
      ref={surfaceRef}
      mode="floating"
      title="Recent Sessions"
      className={`chat-recent-sessions-surface desktop ${collapsed ? 'collapsed' : 'expanded'}`}
      ariaLabel="Recent sessions"
      sessionListDensity={DESKTOP_SESSION_LIST_DENSITY}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      header={header}
    >
      <div className="chat-recent-sessions-surface-list">{children}</div>
    </ChatSessionPanel>
  );
});
