import React from 'react';
import {ChatIcon} from '../ChatIcon';

export type ChatStopStatusPillProps = {
  cancelling: boolean;
  onCancel: () => void;
};

export function ChatStopStatusPill({cancelling, onCancel}: ChatStopStatusPillProps) {
  return (
    <button
      type="button"
      className={`chat-stop-pill${cancelling ? ' cancelling' : ''}`}
      onClick={onCancel}
      disabled={cancelling}
      aria-label={cancelling ? 'Cancelling prompt' : 'Stop generating'}
      aria-busy={cancelling}
    >
      <span className="chat-stop-pill-dot" aria-hidden="true" />
      <span className="chat-stop-pill-label">{cancelling ? 'Cancelling' : 'Responding'}</span>
      <ChatIcon
        name={cancelling ? 'loader' : 'square'}
        size={11}
        filled={!cancelling}
        spin={cancelling}
        className="chat-stop-pill-glyph"
      />
    </button>
  );
}
