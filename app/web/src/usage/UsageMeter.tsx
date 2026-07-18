import React from 'react';
import type {Tightness} from './usageTypes';

const TICK_COUNT = 5;

interface Props {
  remaining: number; // 0..100
  tone: Tightness;
  label: string;
  compact?: boolean;
}

// UsageMeter is the quota instrument shared by the compact bar and the card
// panel: five ticks, one per 20% of remaining quota. Healthy quotas stay
// accent-blue and quiet; warning/danger take over only when quota runs tight.
export function UsageMeter({remaining, tone, label, compact}: Props): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, remaining));
  const litTicks = clamped <= 0 ? 0 : Math.min(TICK_COUNT, Math.ceil(clamped / (100 / TICK_COUNT)));
  return (
    <span
      className={`usage-meter usage-meter--${tone}${compact ? ' usage-meter--compact' : ''}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label}
    >
      {Array.from({length: TICK_COUNT}, (_, i) => (
        <span key={i} className={`usage-meter-tick${i < litTicks ? ' usage-meter-tick--lit' : ''}`} />
      ))}
    </span>
  );
}
