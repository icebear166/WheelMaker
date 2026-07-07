export const GESTURE_CLICK_CANCEL_PX = 12;
export const GESTURE_MOVE_LONG_PRESS_MS = 1000;

export function shouldCancelGestureClick({
  distancePx,
}: {
  distancePx: number;
}): boolean {
  return distancePx >= GESTURE_CLICK_CANCEL_PX;
}

export function shouldStartGestureMove({
  elapsedMs,
}: {
  elapsedMs: number;
}): boolean {
  return elapsedMs >= GESTURE_MOVE_LONG_PRESS_MS;
}
