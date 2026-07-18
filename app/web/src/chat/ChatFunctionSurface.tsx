import React from 'react';

import {useChatEdgeSurfaceGeometry} from './layout/chatEdgeSurfaceGeometry';

export type ChatFunctionSurfaceProps = {
  title: string;
  collapsed: boolean;
  mode: 'compact' | 'detail';
  actions: React.ReactNode;
  onToggleCollapsed: () => void;
  children: React.ReactNode;
};

export function ChatFunctionSurface({title, collapsed, mode, actions, onToggleCollapsed, children}: ChatFunctionSurfaceProps) {
  const surfaceRef = useChatEdgeSurfaceGeometry('left');
  return (
    <aside
      ref={surfaceRef}
      className={`chat-function-surface desktop ${mode}${collapsed ? ' collapsed' : ''}`}
      data-mode={mode}
      aria-label={title}
    >
      <div className="chat-edge-surface-glass" aria-hidden="true" />
      <div className="chat-edge-surface-content">
        <header className="chat-function-surface-header">
          <button
            type="button"
            className="chat-function-surface-toggle"
            aria-label={collapsed ? 'Expand functions' : 'Collapse functions'}
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
          >
            <span className={`codicon ${collapsed ? 'codicon-chevron-up' : 'codicon-chevron-down'}`} aria-hidden="true" />
          </button>
          <span className="chat-function-surface-title">{title}</span>
          <span className="chat-function-surface-actions">{actions}</span>
        </header>
        {collapsed ? null : children}
      </div>
    </aside>
  );
}
