import React from 'react';

import {ChatEdgeSurfaceHeader} from './ChatEdgeSurfaceHeader';
import {
  useChatEdgeSurfaceGeometry,
  type ChatEdgeSurfaceSide,
} from './layout/chatEdgeSurfaceGeometry';
import {useChatEdgeSurfaceHoverReveal} from './layout/chatEdgeSurfaceHoverReveal';

export type ChatFunctionSurfaceProps = {
  title: string;
  collapsed: boolean;
  mode: 'compact' | 'detail';
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  onToggleCollapsed: () => void;
  children: React.ReactNode;
  side?: ChatEdgeSurfaceSide;
  className?: string;
  revealOnHover?: boolean;
};

export function ChatFunctionSurface({
  title,
  collapsed,
  mode,
  actions,
  toolbar,
  onToggleCollapsed,
  children,
  side = 'left',
  className = '',
  revealOnHover = false,
}: ChatFunctionSurfaceProps) {
  const surfaceRef = useChatEdgeSurfaceGeometry(side);
  const hoverReveal = useChatEdgeSurfaceHoverReveal(revealOnHover);
  return (
    <aside
      ref={surfaceRef}
      className={`chat-function-surface desktop side-${side} ${mode}${collapsed ? ' collapsed' : ''}${className ? ` ${className}` : ''}${hoverReveal.revealed ? ' chat-edge-surface-hover-revealed' : ''}`}
      data-mode={mode}
      data-side={side}
      aria-label={title}
      onPointerEnter={hoverReveal.onPointerEnter}
      onPointerLeave={hoverReveal.onPointerLeave}
    >
      <div className="chat-edge-surface-glass" aria-hidden="true" />
      <div className="chat-edge-surface-content">
        <ChatEdgeSurfaceHeader
          title={title}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          actions={actions}
          toolbar={toolbar}
        />
        {collapsed ? null : children}
      </div>
    </aside>
  );
}
