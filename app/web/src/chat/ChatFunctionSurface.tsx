import React from 'react';

import {ChatEdgeSurfaceHeader} from './ChatEdgeSurfaceHeader';
import {
  useChatEdgeSurfaceGeometry,
  type ChatEdgeSurfaceSide,
} from './layout/chatEdgeSurfaceGeometry';

export type ChatFunctionSurfaceProps = {
  title: string;
  collapsed: boolean;
  mode: 'compact' | 'detail';
  actions: React.ReactNode;
  onToggleCollapsed: () => void;
  children: React.ReactNode;
  side?: ChatEdgeSurfaceSide;
  className?: string;
};

export function ChatFunctionSurface({
  title,
  collapsed,
  mode,
  actions,
  onToggleCollapsed,
  children,
  side = 'left',
  className = '',
}: ChatFunctionSurfaceProps) {
  const surfaceRef = useChatEdgeSurfaceGeometry(side);
  return (
    <aside
      ref={surfaceRef}
      className={`chat-function-surface desktop side-${side} ${mode}${collapsed ? ' collapsed' : ''}${className ? ` ${className}` : ''}`}
      data-mode={mode}
      data-side={side}
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
