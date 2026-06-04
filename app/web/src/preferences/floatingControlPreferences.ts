export const FLOATING_CONTROL_DEFAULT_Y_RATIO = 0.25;
export const FLOATING_CONTROL_DEFAULT_IDLE_OPACITY = 0.34;
export const FLOATING_CONTROL_IDLE_OPACITY_MIN = 0.1;
export const FLOATING_CONTROL_IDLE_OPACITY_MAX = 0.8;

export type LegacyFloatingControlSlot =
  | 'upper'
  | 'upper-middle'
  | 'center'
  | 'lower-middle'
  | 'lower';

export function sanitizeFloatingControlYRatio(
  value: unknown,
  fallback = FLOATING_CONTROL_DEFAULT_Y_RATIO,
): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(1, Math.max(0, numeric));
}

export function sanitizeFloatingControlIdleOpacity(
  value: unknown,
  fallback = FLOATING_CONTROL_DEFAULT_IDLE_OPACITY,
): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const rounded = Math.round((numeric + Number.EPSILON) * 100) / 100;
  return Math.min(
    FLOATING_CONTROL_IDLE_OPACITY_MAX,
    Math.max(FLOATING_CONTROL_IDLE_OPACITY_MIN, rounded),
  );
}

export function floatingControlYRatioFromLegacySlot(value: unknown): number | null {
  switch (value) {
    case 'upper':
      return 0;
    case 'upper-middle':
      return 0.25;
    case 'center':
      return 0.5;
    case 'lower-middle':
      return 0.75;
    case 'lower':
      return 1;
    default:
      return null;
  }
}
