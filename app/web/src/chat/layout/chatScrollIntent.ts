export const CHAT_USER_SCROLL_LOCK_MS = 320;

export function nextChatUserScrollLockUntil(
  now = Date.now(),
  durationMs = CHAT_USER_SCROLL_LOCK_MS,
): number {
  return now + Math.max(0, durationMs);
}

export function isChatUserScrollLocked(lockUntil: number, now = Date.now()): boolean {
  return lockUntil > now;
}

export function shouldAutoScrollChatToBottom(input: {
  force: boolean;
  followsLatest: boolean;
  pointerScrolling: boolean;
  userScrollLocked: boolean;
}): boolean {
  return input.force || (input.followsLatest && !input.pointerScrolling && !input.userScrollLocked);
}

export type ChatKeyboardInsetScrollAction = 'none' | 'immediate' | 'deferred';

export const CHAT_KEYBOARD_INSET_OPEN_THRESHOLD_PX = 72;

function normalizeChatKeyboardInset(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function resolveChatKeyboardLayoutViewportHeight(input: {
  currentLayoutViewportHeight: number;
  previousLayoutViewportHeight: number;
  visualViewportHeight: number;
  visualViewportOffsetTop: number;
}): number {
  const currentLayoutViewportHeight = normalizeChatKeyboardInset(input.currentLayoutViewportHeight);
  const visualViewportHeight = normalizeChatKeyboardInset(input.visualViewportHeight);
  const visualViewportOffsetTop = normalizeChatKeyboardInset(input.visualViewportOffsetTop);
  const layoutFollowsVisualViewport = currentLayoutViewportHeight > 0
    && visualViewportHeight > 0
    && visualViewportOffsetTop <= 4
    && Math.abs(currentLayoutViewportHeight - visualViewportHeight) < CHAT_KEYBOARD_INSET_OPEN_THRESHOLD_PX;
  // A resized layout already keeps the composer above the keyboard. Retain the taller
  // layout only while the visual viewport overlays or pans within it, as on iOS.
  if (layoutFollowsVisualViewport) {
    return currentLayoutViewportHeight;
  }
  return Math.max(
    currentLayoutViewportHeight,
    normalizeChatKeyboardInset(input.previousLayoutViewportHeight),
  );
}

export function resolveChatKeyboardInset(input: {
  windowInnerHeight: number;
  layoutViewportHeight?: number;
  visualViewportHeight: number;
  visualViewportOffsetTop: number;
  openThreshold?: number;
}): number {
  const windowInnerHeight = normalizeChatKeyboardInset(input.windowInnerHeight);
  const layoutViewportHeight = Math.max(
    windowInnerHeight,
    normalizeChatKeyboardInset(input.layoutViewportHeight ?? 0),
  );
  const visualViewportHeight = normalizeChatKeyboardInset(input.visualViewportHeight);
  const visualViewportOffsetTop = normalizeChatKeyboardInset(input.visualViewportOffsetTop);
  const openThreshold = normalizeChatKeyboardInset(input.openThreshold ?? CHAT_KEYBOARD_INSET_OPEN_THRESHOLD_PX);
  const visualViewportBottomGap = Math.max(
    0,
    layoutViewportHeight - (visualViewportHeight + visualViewportOffsetTop),
  );
  const visualViewportHeightGap = Math.max(
    0,
    layoutViewportHeight - visualViewportHeight,
  );
  // Offset-aware padding keeps the composer at the same screen coordinate when iOS pans the visual viewport.
  return visualViewportHeightGap >= openThreshold ? visualViewportBottomGap : 0;
}

export function resolveChatKeyboardInsetScrollAction(input: {
  previousInset: number;
  nextInset: number;
}): ChatKeyboardInsetScrollAction {
  const previousInset = normalizeChatKeyboardInset(input.previousInset);
  const nextInset = normalizeChatKeyboardInset(input.nextInset);
  if (nextInset === previousInset) {
    return 'none';
  }
  return nextInset > previousInset ? 'immediate' : 'deferred';
}

export type ChatScrollNavVisibility = {
  atBottom: boolean;
  showScrollToBottom: boolean;
  showScrollToTop: boolean;
};

export function resolveChatScrollBottomTop(input: {
  scrollHeight: number;
  clientHeight: number;
}): number {
  const scrollHeight = Number.isFinite(input.scrollHeight) ? Math.max(0, input.scrollHeight) : 0;
  const clientHeight = Number.isFinite(input.clientHeight) ? Math.max(0, input.clientHeight) : 0;
  return Math.max(0, scrollHeight - clientHeight);
}

export function resolveChatScrollNavVisibility(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  threshold: number;
  /** Distance from the top beyond which jump-to-top appears; defaults to one viewport. */
  topThreshold?: number;
}): ChatScrollNavVisibility {
  const scrollTop = Number.isFinite(input.scrollTop) ? Math.max(0, input.scrollTop) : 0;
  const scrollHeight = Number.isFinite(input.scrollHeight) ? Math.max(0, input.scrollHeight) : 0;
  const clientHeight = Number.isFinite(input.clientHeight) ? Math.max(0, input.clientHeight) : 0;
  const threshold = Number.isFinite(input.threshold) ? Math.max(0, input.threshold) : 0;
  const topThreshold = Number.isFinite(input.topThreshold)
    ? Math.max(0, input.topThreshold ?? 0)
    : clientHeight;
  const distanceFromBottom = Math.max(
    0,
    resolveChatScrollBottomTop({scrollHeight, clientHeight}) - scrollTop,
  );
  const scrollable = scrollHeight > clientHeight + 1;
  const atBottom = !scrollable || distanceFromBottom <= threshold;
  return {
    atBottom,
    showScrollToBottom: !atBottom,
    // The nav group only exists while away from the bottom, so jump-to-top is
    // offered on top of that, once the reader is at least a viewport deep.
    showScrollToTop: !atBottom && scrollTop > topThreshold,
  };
}

export type ChatSessionReadWindowUpdate = {
  resetToLatest?: true;
  followLatest?: boolean;
  revealTurnIndex?: number;
};

export function resolveChatSessionReadWindowUpdate(input: {
  useIncremental: boolean;
  followsLatest: boolean;
  revealTurnIndex?: number;
}): ChatSessionReadWindowUpdate {
  const revealTurnIndex = Number.isFinite(input.revealTurnIndex)
    ? Math.max(0, Math.trunc(input.revealTurnIndex ?? 0))
    : 0;
  if (revealTurnIndex > 0) {
    return {revealTurnIndex};
  }
  if (input.useIncremental) {
    return {followLatest: input.followsLatest};
  }
  return {resetToLatest: true};
}
