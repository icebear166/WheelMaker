import React, {type HTMLAttributes, type PointerEventHandler, type ReactNode, type Ref, type UIEventHandler} from 'react';

export type ChatSessionPanelMode = 'floating' | 'slideout' | 'pinned';

export type ChatSessionPanelProps = {
  mode: ChatSessionPanelMode;
  title: string;
  header?: ReactNode;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  sessionListDensity?: string;
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
      onPointerLeave={onPointerLeave}
      aria-label={ariaLabel ?? title}
      data-session-list-density={sessionListDensity}
    >
      <div className="chat-edge-surface-glass" aria-hidden="true" />
      <div className="chat-edge-surface-content chat-session-panel-content">
        <div className="chat-session-panel-header">
          <span className="chat-session-panel-title">{title}</span>
          {header}
        </div>
        <div ref={scrollRef} className="chat-session-panel-scroll" onScroll={onScroll} {...scrollProps}>{children}</div>
      </div>
    </aside>
  );
}));
