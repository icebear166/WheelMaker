import React from 'react';

import {ChatEdgeSurfaceHeader} from './ChatEdgeSurfaceHeader';
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
        <ChatEdgeSurfaceHeader
          title={title}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          actions={actions}
        />
        {collapsed ? null : children}
      </div>
    </aside>
  );
}
