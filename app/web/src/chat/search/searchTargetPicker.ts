// Pure state helpers for the Windows Ctrl+F search-target picker modal.

import type {ChatIconName} from '../ChatIcon';

export type ChatSearchTarget = 'current' | 'sessions' | 'preview';

export const CHAT_SEARCH_TARGET_ORDER: ChatSearchTarget[] = ['current', 'sessions', 'preview'];

export type ChatSearchTargetAvailability = Record<ChatSearchTarget, boolean>;

export const CHAT_SEARCH_TARGET_META: Record<
  ChatSearchTarget,
  {label: string; icon: ChatIconName; hint: string}
> = {
  current: {
    label: 'Current session',
    icon: 'messageSquare',
    hint: 'This chat',
  },
  sessions: {
    label: 'All sessions',
    icon: 'listTree',
    hint: 'Session titles',
  },
  preview: {
    label: 'File preview',
    icon: 'fileSymlink',
    hint: 'Open file',
  },
};

export function resolveChatSearchTargetAvailability(input: {
  previewAvailable: boolean;
}): ChatSearchTargetAvailability {
  return {
    current: true,
    sessions: true,
    preview: input.previewAvailable,
  };
}

export function firstEnabledChatSearchTarget(
  availability: ChatSearchTargetAvailability,
): ChatSearchTarget {
  return CHAT_SEARCH_TARGET_ORDER.find(target => availability[target]) ?? 'current';
}

export function cycleChatSearchTarget(
  current: ChatSearchTarget,
  delta: 1 | -1,
  availability: ChatSearchTargetAvailability,
): ChatSearchTarget {
  const order = CHAT_SEARCH_TARGET_ORDER;
  const startIndex = Math.max(0, order.indexOf(current));
  for (let step = 1; step <= order.length; step += 1) {
    const next = order[(startIndex + step * delta + order.length * order.length) % order.length];
    if (availability[next]) {
      return next;
    }
  }
  return current;
}

export type SessionSearchExpansion = 'open-slideout' | 'focus-only';

// Opening the sessions search only makes sense when a panel that hosts the
// search input is visible. If neither the pinned panel nor the slideout is
// open, the caller must open the slideout first.
export function resolveSessionSearchExpansion(input: {
  sessionPanelPinned: boolean;
  slideOutOpen: boolean;
}): SessionSearchExpansion {
  return input.sessionPanelPinned || input.slideOutOpen ? 'focus-only' : 'open-slideout';
}

export type ChatSearchTargetPickerKeyAction =
  | {type: 'cycle'; delta: 1 | -1}
  | {type: 'confirm'}
  | {type: 'close'}
  | {type: 'type-text'; text: string};

// Keyboard model for the picker modal: arrows/Tab cycle, Enter confirms,
// Esc closes, and any printable character confirms the current target and
// seeds its search input with the typed text (type-to-search).
export function resolveChatSearchTargetPickerKey(event: {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): ChatSearchTargetPickerKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  if (event.key === 'Escape') {
    return {type: 'close'};
  }
  if (event.key === 'Enter') {
    return {type: 'confirm'};
  }
  if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
    return {type: 'cycle', delta: 1};
  }
  if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
    return {type: 'cycle', delta: -1};
  }
  if (event.key.length === 1) {
    return {type: 'type-text', text: event.key};
  }
  return null;
}
