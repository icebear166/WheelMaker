import type {RegistryChatMessage} from '../../registry/registryTypes';
import {msgText} from '../chatMessageText';

export type ChatSearchMatch = {
  turnIndex: number;
};

// Only user prompts and assistant reply text are searchable. Thoughts, tool
// calls, plan, status and done messages are intentionally excluded.
const CHAT_SEARCHABLE_METHODS = new Set<string>([
  'prompt_request',
  'user_message_chunk',
  'agent_message_chunk',
]);

export function isChatSearchableMethod(method: string): boolean {
  return CHAT_SEARCHABLE_METHODS.has(method);
}

export function buildChatSearchMatches(
  messages: RegistryChatMessage[],
  query: string,
): ChatSearchMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [];
  }
  const matches: ChatSearchMatch[] = [];
  const seenTurnIndex = new Set<number>();
  for (const message of messages) {
    if (!isChatSearchableMethod(message.method)) {
      continue;
    }
    const text = msgText(message.method, message.param).toLocaleLowerCase();
    if (!text.includes(normalizedQuery)) {
      continue;
    }
    const turnIndex = message.turnIndex ?? 0;
    if (seenTurnIndex.has(turnIndex)) {
      continue;
    }
    seenTurnIndex.add(turnIndex);
    matches.push({turnIndex});
  }
  return matches;
}

export type ChatSearchHighlightSegment = {
  text: string;
  match: boolean;
};

export function splitChatSearchHighlightSegments(
  text: string,
  query: string,
): ChatSearchHighlightSegment[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!text || !normalizedQuery) {
    return text ? [{text, match: false}] : [];
  }
  const lowerText = text.toLocaleLowerCase();
  const segments: ChatSearchHighlightSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const matchIndex = lowerText.indexOf(normalizedQuery, cursor);
    if (matchIndex < 0) {
      segments.push({text: text.slice(cursor), match: false});
      break;
    }
    if (matchIndex > cursor) {
      segments.push({text: text.slice(cursor, matchIndex), match: false});
    }
    segments.push({
      text: text.slice(matchIndex, matchIndex + normalizedQuery.length),
      match: true,
    });
    cursor = matchIndex + normalizedQuery.length;
  }
  return segments.filter(segment => segment.text.length > 0);
}
