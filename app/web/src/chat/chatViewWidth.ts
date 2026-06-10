export type ChatViewWidth = 'full' | 'fixed-560';

export const DEFAULT_CHAT_VIEW_WIDTH: ChatViewWidth = 'full';

export const CHAT_VIEW_WIDTH_OPTIONS: Array<{id: ChatViewWidth; label: string}> = [
  {id: 'full', label: 'Full'},
  {id: 'fixed-560', label: '560px'},
];

const CHAT_VIEW_WIDTH_IDS = new Set<ChatViewWidth>(
  CHAT_VIEW_WIDTH_OPTIONS.map(option => option.id),
);

export function isChatViewWidth(value: unknown): value is ChatViewWidth {
  return typeof value === 'string' && CHAT_VIEW_WIDTH_IDS.has(value as ChatViewWidth);
}
