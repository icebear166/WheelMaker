import React, { type ReactNode } from 'react';

export type ChatSessionGlobalBarProps = {
  /** Optional title text; omitted in the PC session panel chrome. */
  title?: string;
  /** Floating recent panel only: toggle the all-sessions slide-out. */
  slideOutOpen?: boolean;
  onToggleSlideOut?: () => void;
  /** Show the pin toggle (pin = switch to the fixed sidebar mode). */
  pinActive?: boolean;
  onTogglePin?: () => void;
  /** Right-side controls (search / archive), shown when expanded or in pinned mode. */
  trailing?: ReactNode;
};

export const ChatSessionGlobalBar = React.memo(function ChatSessionGlobalBar({
  title,
  slideOutOpen,
  onToggleSlideOut,
  pinActive,
  onTogglePin,
  trailing,
}: ChatSessionGlobalBarProps) {
  return (
    <div className={`chat-session-global-bar${slideOutOpen ? ' slide-out-open' : ''}`}>
      <div className="chat-session-global-bar-leading">
        {onToggleSlideOut ? (
          <button
            type="button"
            className="chat-session-global-bar-btn"
            onClick={onToggleSlideOut}
            aria-expanded={!!slideOutOpen}
            aria-label={slideOutOpen ? 'Close all sessions' : 'Show all sessions'}
            title={slideOutOpen ? 'Close all sessions' : 'Show all sessions'}
          >
            <span
              className={`codicon ${slideOutOpen ? 'codicon-chevron-left' : 'codicon-list-flat'}`}
              aria-hidden="true"
            />
          </button>
        ) : null}
        {title ? <span className="chat-session-global-bar-title">{title}</span> : null}
        {onTogglePin ? (
          <button
            type="button"
            className={`chat-session-global-bar-btn${pinActive ? ' active' : ''}`}
            onClick={onTogglePin}
            aria-pressed={!!pinActive}
            aria-label={pinActive ? 'Unpin session sidebar' : 'Pin session sidebar'}
            title={pinActive ? 'Unpin session sidebar' : 'Pin session sidebar'}
          >
            <span className="codicon codicon-pinned" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {trailing ? <div className="chat-session-global-bar-trailing">{trailing}</div> : null}
    </div>
  );
});
