import React from 'react';
import {ChatIcon} from '../ChatIcon';

export type ChatStopStatusPillProps = {
  cancelling: boolean;
  onCancel: () => void;
};

// One capsule that is both the running status and the stop target. The label
// carries a light-sweep shimmer while responding; the glyph slot keeps a
// fixed footprint so the pill does not resize when the spinner replaces the
// stop square while cancelling.
export function ChatStopStatusPill({cancelling, onCancel}: ChatStopStatusPillProps) {
  return (
    <button
      type="button"
      className={`chat-stop-pill${cancelling ? ' cancelling' : ''}`}
      onClick={onCancel}
      disabled={cancelling}
      aria-label={cancelling ? 'Cancelling prompt' : 'Stop generating'}
      aria-busy={cancelling}
      title={cancelling ? 'Cancelling prompt' : 'Stop generating'}
    >
      <span className="chat-stop-pill-label" role="status" aria-live="polite" aria-atomic="true">
        {cancelling ? 'Cancelling' : 'Responding'}
      </span>
      <ChatIcon
        name={cancelling ? 'loader' : 'stop'}
        size={12}
        filled={!cancelling}
        spin={cancelling}
        className="chat-stop-pill-glyph"
      />
    </button>
  );
}
