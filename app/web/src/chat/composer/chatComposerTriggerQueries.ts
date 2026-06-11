export type ChatComposerTriggerQuery = {
  start: number;
  end: number;
  query: string;
};

export function hasChatComposerTriggerBoundary(text: string, index: number): boolean {
  return index === 0 || /\s/.test(text[index - 1] ?? '');
}

export function resolveChatSlashQuery(text: string, cursor: number): ChatComposerTriggerQuery | null {
  return resolveChatTriggerQuery(text, cursor, '/');
}

export function resolveChatFileMentionQuery(text: string, cursor: number): ChatComposerTriggerQuery | null {
  return resolveChatTriggerQuery(text, cursor, '@');
}

function resolveChatTriggerQuery(
  text: string,
  cursor: number,
  trigger: '/' | '@',
): ChatComposerTriggerQuery | null {
  const safeCursor = Math.max(0, Math.min(text.length, cursor));
  const beforeCursor = text.slice(0, safeCursor);
  const triggerIndex = beforeCursor.lastIndexOf(trigger);
  if (triggerIndex < 0 || !hasChatComposerTriggerBoundary(beforeCursor, triggerIndex)) {
    return null;
  }
  const query = beforeCursor.slice(triggerIndex + 1);
  if (/\s/.test(query)) {
    return null;
  }
  return {start: triggerIndex, end: safeCursor, query};
}
