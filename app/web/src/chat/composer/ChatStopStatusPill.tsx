import React from 'react';
import {ChatIcon} from '../ChatIcon';

export type ChatStopStatusPillProps = {
  cancelling: boolean;
  onCancel: () => void;
};

// Brand-flavored working indicator: a tiny cyclist pedals while the agent is
// generating (WheelMaker's wheels, literally turning). The bike cross-fades
// into a stop square on hover; while cancelling the wheels freeze mid-turn,
// like a bike braking to a stop.
function ChatPedalingBikeGlyph() {
  return (
    <svg
      viewBox="0 0 39 20"
      width={28}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon-name="bike"
      className="chat-stop-bike"
    >
      <g className="chat-stop-bike-wind" strokeWidth={1.2}>
        <path d="M1 6.5h6" />
        <path d="M0 10.5h7.5" />
        <path d="M1 15h5.5" />
      </g>
      <g className="chat-stop-bike-wheel-anim" strokeWidth={1.4}>
        <circle cx="14" cy="14" r="5" />
        <g strokeWidth={1}>
          <path d="M9.7 14h8.6" />
          <path d="M11.85 10.28l4.3 7.44" />
          <path d="M11.85 17.72l4.3-7.44" />
        </g>
      </g>
      <g className="chat-stop-bike-wheel-anim" strokeWidth={1.4}>
        <circle cx="32" cy="14" r="5" />
        <g strokeWidth={1}>
          <path d="M27.7 14h8.6" />
          <path d="M29.85 10.28l4.3 7.44" />
          <path d="M29.85 17.72l4.3-7.44" />
        </g>
      </g>
      <g strokeWidth={1.4}>
        <path d="M14 14 18.2 7.6" />
        <path d="M20.5 14.3 18.2 7.6" />
        <path d="M18.2 7.6 27.3 8" />
        <path d="M20.5 14.3 27.3 8" />
        <path d="M27.3 8 32 14" />
        <path d="M14 14h6.5" />
        <path d="M16.8 6.4h3" />
        <path d="M27.3 8l1.2-1.9h2" />
      </g>
      <g strokeWidth={1.4}>
        <circle cx="24.9" cy="3.3" r="1.5" />
        <path d="M18.8 8.3 23.9 6.3" />
        <path d="M23.9 6.3 29.2 6.5" />
        <path d="M18.8 8.3 21 10.7" />
      </g>
      <g className="chat-stop-bike-crank" strokeWidth={1.2}>
        <path d="M20.5 12v4.6" />
        <circle cx="20.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="20.5" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}

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
      <span className="chat-stop-pill-stage" aria-hidden="true">
        <ChatPedalingBikeGlyph />
        <ChatIcon name="stop" size={12} filled className="chat-stop-pill-stop-glyph" />
      </span>
      <span className="chat-stop-pill-a11y-label" role="status" aria-live="polite" aria-atomic="true">
        {cancelling ? 'Cancelling' : 'Responding'}
      </span>
    </button>
  );
}
