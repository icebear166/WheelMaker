// Pure prompt-history helpers for the chat title prompt menu.
// Builds the session's prompt sequence (the "table of contents" entries) and
// resolves which entry owns the currently visible turn.

import type {RegistryChatMessage} from '../../registry/registryTypes';
import {msgText} from '../chatMessageText';

const MAX_PREVIEW_LENGTH = 96;

export type ChatPromptHistoryItem = {
  key: string;
  position: number;
  preview: string;
  turnIndex: number;
};

function isPromptHistoryStartMessage(message: RegistryChatMessage): boolean {
  return message.method === 'prompt_request' || message.method === 'user_message_chunk';
}

export function summarizeChatPromptPreview(text: string, fallback: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.length > MAX_PREVIEW_LENGTH
    ? `${normalized.slice(0, MAX_PREVIEW_LENGTH - 1)}...`
    : normalized;
}

export function buildChatPromptHistory(messages: RegistryChatMessage[]): ChatPromptHistoryItem[] {
  return [...messages]
    .filter(isPromptHistoryStartMessage)
    .sort((left, right) => (left.turnIndex ?? 0) - (right.turnIndex ?? 0))
    .map(message => ({message, turnIndex: Math.max(0, Math.trunc(message.turnIndex ?? 0))}))
    .filter(item => item.turnIndex > 0)
    .map(({message, turnIndex}, index) => {
      const position = index + 1;
      return {
        key: `${message.sessionId}:${turnIndex}:${message.method}`,
        position,
        preview: summarizeChatPromptPreview(
          msgText(message.method, message.param),
          `Prompt ${position}`,
        ),
        turnIndex,
      };
    });
}

/**
 * Index of the history entry that owns the visible turn: the last prompt at or
 * before it. Unknown/non-positive visible turns mean the list is settling at
 * the bottom, so the latest prompt is current. Turns preceding the first
 * prompt pin to the first entry.
 */
export function resolveCurrentChatPromptIndex(
  items: ChatPromptHistoryItem[],
  visibleTurnIndex: number,
): number {
  if (items.length === 0) {
    return -1;
  }
  if (!Number.isFinite(visibleTurnIndex) || visibleTurnIndex <= 0) {
    return items.length - 1;
  }
  let current = 0;
  for (let index = 0; index < items.length; index += 1) {
    if (items[index].turnIndex > visibleTurnIndex) {
      break;
    }
    current = index;
  }
  return current;
}
