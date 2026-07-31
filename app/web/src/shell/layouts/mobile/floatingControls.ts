import {
  FLOATING_CONTROL_DEFAULT_Y_RATIO,
  sanitizeFloatingControlYRatio,
} from '../../../preferences/floatingControlPreferences';

export {
  FLOATING_CONTROL_DEFAULT_Y_RATIO,
  floatingControlYRatioFromLegacySlot,
  sanitizeFloatingControlYRatio,
  type LegacyFloatingControlSlot,
} from '../../../preferences/floatingControlPreferences';

export const FLOATING_CONTROL_SIDE_HYSTERESIS_PX = 24;
export const FLOATING_CONTROL_COMPOSER_GAP_PX = 12;

export type FloatingControlVerticalBounds = {
  minTop: number;
  maxTop: number;
};

type FloatingControlSide = 'left' | 'right';

export function resolveFloatingControlDragSide(
  currentSide: FloatingControlSide,
  pointerX: number,
  viewportWidth: number,
  hysteresisPx = FLOATING_CONTROL_SIDE_HYSTERESIS_PX,
): FloatingControlSide {
  const midpoint = viewportWidth / 2;
  if (currentSide === 'right') {
    return pointerX < midpoint - hysteresisPx ? 'left' : 'right';
  }
  return pointerX > midpoint + hysteresisPx ? 'right' : 'left';
}

export function floatingControlTopFromYRatio(
  ratio: number,
  minTop: number,
  maxTop: number,
): number {
  const clampedRatio = sanitizeFloatingControlYRatio(ratio);
  return Math.round(minTop + (maxTop - minTop) * clampedRatio);
}

export function floatingControlYRatioFromTop(
  top: number,
  minTop: number,
  maxTop: number,
): number {
  if (maxTop <= minTop) {
    return FLOATING_CONTROL_DEFAULT_Y_RATIO;
  }
  return sanitizeFloatingControlYRatio((top - minTop) / (maxTop - minTop));
}

export function resolveFloatingControlYRatioForStableTop({
  previousTop,
  minTop,
  maxTop,
  fallbackRatio = FLOATING_CONTROL_DEFAULT_Y_RATIO,
}: {
  previousTop: number;
  minTop: number;
  maxTop: number;
  fallbackRatio?: number;
}): number {
  if (maxTop <= minTop) {
    return sanitizeFloatingControlYRatio(fallbackRatio);
  }
  const clampedTop = Math.min(maxTop, Math.max(minTop, previousTop));
  return floatingControlYRatioFromTop(clampedTop, minTop, maxTop);
}

export function resolveFloatingControlYRatioForBoundsChange({
  previousTop,
  minTop,
  maxTop,
  fallbackRatio = FLOATING_CONTROL_DEFAULT_Y_RATIO,
}: {
  previousTop: number;
  minTop: number;
  maxTop: number;
  fallbackRatio?: number;
}): number {
  // Bounds shifts (keyboard, composer measurement) must preserve the visible
  // position; snapping back to the default ratio teleports the control.
  return resolveFloatingControlYRatioForStableTop({
    previousTop,
    minTop,
    maxTop,
    fallbackRatio,
  });
}

export function resolveFloatingControlDefaultBounds({
  viewportHeight,
  stackHeight,
  safeAreaTopInset,
  safeAreaBottomInset,
  defaultComposerTop,
  composerGap = FLOATING_CONTROL_COMPOSER_GAP_PX,
  expandedOverflowPx = 0,
}: {
  viewportHeight: number;
  stackHeight: number;
  safeAreaTopInset: number;
  safeAreaBottomInset: number;
  defaultComposerTop: number | null;
  composerGap?: number;
  /** Extra headroom above the collapsed control reserved for its expanded card. */
  expandedOverflowPx?: number;
}): FloatingControlVerticalBounds {
  const minTop = Math.max(safeAreaTopInset + 6, 6) + Math.max(0, expandedOverflowPx);
  const bottomInset = Math.max(safeAreaBottomInset + 6, 6);
  const viewportMaxTop = viewportHeight - stackHeight - bottomInset;
  const composerMaxTop = defaultComposerTop === null
    ? viewportMaxTop
    : defaultComposerTop - stackHeight - composerGap;
  return {
    minTop,
    maxTop: Math.max(minTop, Math.min(viewportMaxTop, composerMaxTop)),
  };
}

export function resolveFloatingControlAvoidanceBounds({
  defaultBounds,
  viewportHeight,
  keyboardOffset,
  stackHeight,
  safeAreaBottomInset,
  composerTop,
  composerGap = FLOATING_CONTROL_COMPOSER_GAP_PX,
  reservedBottomInset = 0,
}: {
  defaultBounds: FloatingControlVerticalBounds;
  viewportHeight: number;
  keyboardOffset: number;
  stackHeight: number;
  safeAreaBottomInset: number;
  composerTop: number | null;
  composerGap?: number;
  reservedBottomInset?: number;
}): FloatingControlVerticalBounds {
  const bottomInset = Math.max(safeAreaBottomInset + 6, 6);
  const viewportMaxTop = viewportHeight - keyboardOffset - stackHeight - bottomInset;
  const composerMaxTop = composerTop === null
    ? viewportMaxTop
    : composerTop - stackHeight - composerGap;
  const reservedMaxTop = reservedBottomInset > 0
    ? viewportHeight - keyboardOffset - stackHeight - reservedBottomInset
    : defaultBounds.maxTop;
  return {
    minTop: defaultBounds.minTop,
    maxTop: Math.max(
      defaultBounds.minTop,
      Math.min(defaultBounds.maxTop, viewportMaxTop, composerMaxTop, reservedMaxTop),
    ),
  };
}
