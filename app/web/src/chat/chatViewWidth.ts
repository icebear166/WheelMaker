export type ChatViewWidth = 'full' | 'fixed-800';

export const DEFAULT_CHAT_VIEW_WIDTH: ChatViewWidth = 'fixed-800';

export const CHAT_VIEW_WIDTH_OPTIONS: Array<{id: ChatViewWidth; label: string}> = [
  {id: 'full', label: 'Full'},
  {id: 'fixed-800', label: '800px'},
];

const CHAT_VIEW_WIDTH_IDS = new Set<ChatViewWidth>(
  CHAT_VIEW_WIDTH_OPTIONS.map(option => option.id),
);

export function isChatViewWidth(value: unknown): value is ChatViewWidth {
  return typeof value === 'string' && CHAT_VIEW_WIDTH_IDS.has(value as ChatViewWidth);
}

export function normalizeChatViewWidth(
  value: unknown,
  fallback: ChatViewWidth = DEFAULT_CHAT_VIEW_WIDTH,
): ChatViewWidth {
  if (value === 'fixed-560') return 'fixed-800';
  return isChatViewWidth(value) ? value : fallback;
}
