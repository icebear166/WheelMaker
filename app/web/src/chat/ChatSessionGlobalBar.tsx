import React, {type ReactNode} from 'react';
import {SessionIcon} from './sessionlist/SessionIcon';

export type ChatSessionGlobalBarProps = {
  /** Floating recent panel only: toggle the all-sessions slide-out. */
  slideOutOpen?: boolean;
  onToggleSlideOut?: () => void;
  /** Floating recent panel only: expose the keyboard toggle next to the button. */
  showSlideOutShortcut?: boolean;
  /** Show the pin toggle (pin = switch to the fixed sidebar mode). */
  pinActive?: boolean;
  onTogglePin?: () => void;
  /** List controls (archive / search), kept next to the title. */
  leading?: ReactNode;
  /** PC toolbar is hidden by default; the user expands it via the sliders button. */
  collapsible?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
};

export const ChatSessionGlobalBar = React.memo(function ChatSessionGlobalBar({
  slideOutOpen,
  onToggleSlideOut,
  showSlideOutShortcut,
  pinActive,
  onTogglePin,
  leading,
  collapsible = false,
  expanded = true,
  onToggleExpanded,
}: ChatSessionGlobalBarProps) {
  const hidden = collapsible && !expanded;
  return (
    <div className={`chat-session-global-bar${slideOutOpen ? ' slide-out-open' : ''}${hidden ? ' collapsed' : ''}`}>
      {!hidden ? (
        <>
          <div className="chat-session-global-bar-leading-actions">{leading}</div>
          <div className="chat-session-global-bar-layout-actions">
            {showSlideOutShortcut && onToggleSlideOut ? (
              <span className="chat-session-global-bar-shortcut" aria-hidden="true">Ctrl+1</span>
            ) : null}
            {onToggleSlideOut ? (
              <button
                type="button"
                className="chat-session-global-bar-btn"
                onClick={onToggleSlideOut}
                aria-expanded={!!slideOutOpen}
                aria-label={slideOutOpen ? 'Close all sessions' : 'Show all sessions'}
                title={slideOutOpen ? 'Close all sessions' : 'Show all sessions'}
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
                title={pinActive ? 'Unpin session sidebar' : 'Pin session sidebar'}
              >
                <SessionIcon name="pin" filled={pinActive} />
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {collapsible && onToggleExpanded ? (
        <button
          type="button"
          className={`chat-session-global-bar-btn chat-session-global-bar-expand${hidden ? '' : ' active'}`}
          onClick={onToggleExpanded}
          aria-expanded={!hidden}
          aria-label={hidden ? 'Show session toolbar' : 'Hide session toolbar'}
          title={hidden ? 'Show session toolbar' : 'Hide session toolbar'}
        >
          <SessionIcon name="sliders" />
        </button>
      ) : null}
    </div>
  );
});
