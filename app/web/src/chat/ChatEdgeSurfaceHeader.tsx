import React, {type ReactNode} from 'react';

export type ChatEdgeSurfaceHeaderProps = {
  title: string;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  summary?: ReactNode;
  leadingActions?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
};

export function ChatEdgeSurfaceHeader({
  title,
  collapsed,
  onToggleCollapsed,
  summary,
  leadingActions,
  actions,
  toolbar,
}: ChatEdgeSurfaceHeaderProps) {
  return (
    <header className="chat-edge-surface-header">
      {onToggleCollapsed ? (
        <button
          type="button"
          className="chat-edge-surface-toggle"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          <span
            className={`codicon ${collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`}
            aria-hidden="true"
          />
        </button>
      ) : <span className="chat-edge-surface-toggle-spacer" aria-hidden="true" />}
      <span className="chat-edge-surface-title">{title}</span>
      {toolbar ? (
        <div className="chat-edge-surface-toolbar">{toolbar}</div>
      ) : (
        <>
          {summary ? <span className="chat-edge-surface-summary">{summary}</span> : <span />}
          {leadingActions ? <span className="chat-edge-surface-leading-actions">{leadingActions}</span> : <span />}
          {actions ? <span className="chat-edge-surface-actions">{actions}</span> : <span />}
        </>
      )}
    </header>
  );
}
