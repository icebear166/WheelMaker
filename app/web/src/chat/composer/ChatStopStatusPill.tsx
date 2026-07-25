import React from 'react';
import {ChatIcon} from '../ChatIcon';

export type ChatStopStatusPillProps = {
  cancelling: boolean;
  onCancel: () => void;
};

export function ChatStopStatusPill({cancelling, onCancel}: ChatStopStatusPillProps) {
  return (
    <div className={`chat-stop-status${cancelling ? ' cancelling' : ''}`}>
      <span className="chat-stop-status-indicator" role="status" aria-live="polite" aria-atomic="true">
        <span className="chat-stop-status-dot" aria-hidden="true" />
        <span className="chat-stop-status-label">{cancelling ? 'Cancelling' : 'Responding'}</span>
      </span>
      <button
        type="button"
        className="chat-stop-button"
        onClick={onCancel}
        disabled={cancelling}
        aria-label={cancelling ? 'Cancelling prompt' : 'Stop generating'}
        aria-busy={cancelling}
        title={cancelling ? 'Cancelling prompt' : 'Stop generating'}
      >
        <ChatIcon
          name={cancelling ? 'loader' : 'square'}
          size={11}
          filled={!cancelling}
          spin={cancelling}
          className="chat-stop-button-glyph"
        />
      </button>
    </div>
  );
}
