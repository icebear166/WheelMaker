import React, {type HTMLAttributes, type PointerEventHandler, type ReactNode, type Ref, type UIEventHandler} from 'react';
import {ChatEdgeSurfaceHeader} from './ChatEdgeSurfaceHeader';

export type ChatSessionPanelMode = 'floating' | 'slideout' | 'pinned';

export type ChatSessionPanelProps = {
  mode: ChatSessionPanelMode;
  title: string;
  header?: ReactNode;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  sessionListDensity?: string;
  collapsed?: boolean;
  keepChildrenMounted?: boolean;
  onToggleCollapsed?: () => void;
  onPointerEnter?: PointerEventHandler<HTMLElement>;
  onPointerLeave?: PointerEventHandler<HTMLElement>;
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  scrollProps?: HTMLAttributes<HTMLDivElement>;
};

export const ChatSessionPanel = React.memo(React.forwardRef<HTMLElement, ChatSessionPanelProps>(function ChatSessionPanel({
  mode,
  title,
  header,
  children,
  className,
  ariaLabel,
  sessionListDensity,
  collapsed = false,
  keepChildrenMounted = false,
  onToggleCollapsed,
  onPointerEnter,
  onPointerLeave,
  scrollRef,
  onScroll,
  scrollProps,
}, ref) {
  const panelClassName = [
    'chat-session-panel',
    `chat-session-panel-${mode}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <aside
      ref={ref}
      className={panelClassName}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      aria-label={ariaLabel ?? title}
      data-session-list-density={sessionListDensity}
    >
      <div className="chat-edge-surface-glass" aria-hidden="true" />
      <div className="chat-edge-surface-content chat-session-panel-content">
        <div className="chat-session-panel-header">
          <ChatEdgeSurfaceHeader
            title={title}
            collapsed={collapsed}
            onToggleCollapsed={onToggleCollapsed}
            toolbar={header}
          />
        </div>
        {collapsed && !keepChildrenMounted ? null : (
          <div ref={scrollRef} className="chat-session-panel-scroll" onScroll={onScroll} {...scrollProps}>{children}</div>
        )}
      </div>
    </aside>
  );
}));
