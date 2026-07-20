// Pure state helpers for the Windows Ctrl+F search-target picker modal.

export type ChatSearchTarget = 'current' | 'sessions' | 'preview';

export const CHAT_SEARCH_TARGET_ORDER: ChatSearchTarget[] = ['current', 'sessions', 'preview'];

export type ChatSearchTargetAvailability = Record<ChatSearchTarget, boolean>;

export const CHAT_SEARCH_TARGET_META: Record<
  ChatSearchTarget,
  {label: string; icon: string; hint: string}
> = {
  current: {
    label: 'Current session',
    icon: 'codicon-comment-discussion',
    hint: 'Search messages in this chat',
  },
  sessions: {
    label: 'All sessions',
    icon: 'codicon-list-tree',
    hint: 'Search session titles',
  },
  preview: {
    label: 'File preview',
    icon: 'codicon-go-to-file',
    hint: 'Search in the open file',
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
