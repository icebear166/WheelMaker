import React, {type ReactNode} from 'react';
import {SessionIcon} from './sessionlist/SessionIcon';

export type ChatSessionGlobalBarProps = {
  /** Floating recent panel only: toggle the all-sessions slide-out. */
  slideOutOpen?: boolean;
  onToggleSlideOut?: () => void;
  /** Show the pin toggle (pin = switch to the fixed sidebar mode). */
  pinActive?: boolean;
  onTogglePin?: () => void;
  /** List controls (archive / search), kept next to the title. */
  leading?: ReactNode;
};

export const ChatSessionGlobalBar = React.memo(function ChatSessionGlobalBar({
  slideOutOpen,
  onToggleSlideOut,
  pinActive,
  onTogglePin,
  leading,
}: ChatSessionGlobalBarProps) {
  return (
    <div className={`chat-session-global-bar${slideOutOpen ? ' slide-out-open' : ''}`}>
      <div className="chat-session-global-bar-leading-actions">{leading}</div>
      <div className="chat-session-global-bar-layout-actions">
        {onToggleSlideOut ? (
          <button
            type="button"
            className="chat-session-global-bar-btn"
            onClick={onToggleSlideOut}
            aria-expanded={!!slideOutOpen}
            aria-label={slideOutOpen ? 'Close all sessions' : 'Show all sessions'}
            data-tooltip={slideOutOpen ? 'Close all sessions' : 'Show all sessions'}
          >
            <SessionIcon name={slideOutOpen ? 'panelLeftClose' : 'panelLeft'} />
          </button>
        ) : null}
        {onTogglePin ? (
          <button
            type="button"
            className={`chat-session-global-bar-btn${pinActive ? ' active' : ''}`}
            onClick={onTogglePin}
            aria-pressed={!!pinActive}
            aria-label={pinActive ? 'Unpin session sidebar' : 'Pin session sidebar'}
            data-tooltip={pinActive ? 'Unpin session sidebar' : 'Pin session sidebar'}
          >
            <SessionIcon name="pin" />
          </button>
        ) : null}
      </div>
    </div>
  );
});
