import React from 'react';
import {ChatIcon} from '../ChatIcon';

export type ChatStopStatusPillProps = {
  cancelling: boolean;
  onCancel: () => void;
  /** Touch layouts have no hover: the first tap swaps the bike for the stop
     glyph (armed) and only a second tap within ARM_TIMEOUT_MS cancels;
     otherwise the pill reverts to the pedaling bike. */
  armOnTap?: boolean;
};

const STOP_ARM_TIMEOUT_MS = 2000;

// Brand-flavored working indicator: a tiny cyclist pedals while the agent is
// generating (WheelMaker's wheels, literally turning). The bike cross-fades
// into a stop square on hover (desktop) or after an arming tap (touch); while
// cancelling the wheels freeze mid-turn, like a bike braking to a stop.
function ChatPedalingBikeGlyph() {
  return (
    <svg
      viewBox="0 0 40 20"
      width={30}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon-name="bike"
      className="chat-stop-bike"
    >
      <g className="chat-stop-bike-wind" strokeWidth={1.2}>
        <path d="M1 8.5h5.5" />
        <path d="M0.5 12.5h6.5" />
      </g>
      <g className="chat-stop-bike-wheel-anim" strokeWidth={1.3}>
        <circle cx="14.5" cy="14" r="5" />
        <g strokeWidth={1.1}>
          <path d="M10.2 14h8.6" />
          <path d="M12.35 10.28l4.3 7.44" />
          <path d="M12.35 17.72l4.3-7.44" />
        </g>
      </g>
      <g className="chat-stop-bike-wheel-anim" strokeWidth={1.3}>
        <circle cx="32.5" cy="14" r="5" />
        <g strokeWidth={1.1}>
          <path d="M28.2 14h8.6" />
          <path d="M30.35 10.28l4.3 7.44" />
          <path d="M30.35 17.72l4.3-7.44" />
        </g>
      </g>
      <g strokeWidth={1.3}>
        <path d="M14.5 14 21.5 14.2" />
        <path d="M21.5 14.2 19 8.2" />
        <path d="M19 8.2 27.4 8.2" />
        <path d="M21.5 14.2 27.4 8.2" />
        <path d="M27.4 8.2 32.5 14" />
        <path d="M17.2 7h3.4" />
        <path d="M27.4 8.2 28.8 6.2h2.2" />
      </g>
      <g strokeWidth={1.3}>
        <circle cx="25" cy="3.4" r="1.5" />
        <path d="M19.6 8.6 24 6.7" />
        <path d="M24 6.7 28.6 6.6" />
        <path d="M19.6 8.6 21.9 11.2" />
      </g>
      <g className="chat-stop-bike-crank" strokeWidth={1.2}>
        <path d="M21.5 12.5v3.4" />
        <circle cx="21.5" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="21.5" cy="15.9" r="0.9" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}

export function ChatStopStatusPill({cancelling, onCancel, armOnTap = false}: ChatStopStatusPillProps) {
  const [armed, setArmed] = React.useState(false);
  const armTimerRef = React.useRef<number | null>(null);

  const clearArmTimer = React.useCallback(() => {
    if (armTimerRef.current !== null) {
      window.clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => clearArmTimer, [clearArmTimer]);

  React.useEffect(() => {
    if (cancelling) {
      clearArmTimer();
      setArmed(false);
    }
  }, [cancelling, clearArmTimer]);

  const handleClick = () => {
    if (cancelling) {
      return;
    }
    if (!armOnTap) {
      onCancel();
      return;
    }
    if (!armed) {
      setArmed(true);
      clearArmTimer();
      armTimerRef.current = window.setTimeout(() => {
        armTimerRef.current = null;
        setArmed(false);
      }, STOP_ARM_TIMEOUT_MS);
      return;
    }
    clearArmTimer();
    setArmed(false);
    onCancel();
  };

  return (
    <button
      type="button"
      className={`chat-stop-pill${cancelling ? ' cancelling' : ''}${armed ? ' armed' : ''}`}
      onClick={handleClick}
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
        {cancelling ? 'Cancelling' : armed ? 'Tap again to stop' : 'Responding'}
      </span>
    </button>
  );
}
