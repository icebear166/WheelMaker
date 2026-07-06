export type GesturePressIntent = 'pressing' | 'expand' | 'neutral';

export const GESTURE_LONG_PRESS_MS = 200;
export const GESTURE_LONG_PRESS_CANCEL_PX = 12;
export const GESTURE_MOVE_LONG_PRESS_MS = 1000;

export function resolveGesturePressIntent({
  distancePx,
  elapsedMs,
}: {
  distancePx: number;
  elapsedMs: number;
}): GesturePressIntent {
  if (distancePx < GESTURE_LONG_PRESS_CANCEL_PX) {
    return elapsedMs >= GESTURE_LONG_PRESS_MS ? 'expand' : 'pressing';
  }
  return 'neutral';
}

export function shouldStartGestureMove({
  elapsedMs,
}: {
  elapsedMs: number;
}): boolean {
  return elapsedMs >= GESTURE_MOVE_LONG_PRESS_MS;
}
