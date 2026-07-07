import {
  chatComposerSingleTokenUnitLength,
  chatComposerTokenUnitLength,
  normalizeChatComposerTokens,
  type ChatComposerFileToken,
  type ChatComposerSkillToken,
  type ChatComposerTextToken,
  type ChatComposerToken,
} from './chatComposerTokens';

export type ChatComposerTokenInsertionResult = {
  tokens: ChatComposerToken[];
  cursor: number;
};

export type ChatComposerTokenDeletionResult = {
  tokens: ChatComposerToken[];
  cursor: number;
};

export function insertChatComposerTokens(
  tokens: ChatComposerToken[],
  position: number,
  inserted: ChatComposerToken[],
): ChatComposerTokenInsertionResult {
  const safePosition = Math.max(0, Math.min(Math.trunc(position), chatComposerTokenUnitLength(tokens)));
  const queryRange = activeQueryRange(tokens, safePosition);
  const nextTokens = queryRange
    ? replaceTokenRange(tokens, queryRange.start, queryRange.end, inserted)
    : replaceTokenRange(tokens, safePosition, safePosition, inserted);
  return {
    tokens: nextTokens,
    cursor: queryRange
      ? queryRange.start + chatComposerTokenUnitLength(inserted)
      : safePosition + chatComposerTokenUnitLength(inserted),
  };
}

export function deleteChatComposerTokenById(
  tokens: ChatComposerToken[],
  id: string,
): ChatComposerToken[] {
  return normalizeChatComposerTokens(tokens.filter(token => !chatComposerTokenHasId(token, id)));
}

export function deleteChatComposerTokenByIdAtPosition(
  tokens: ChatComposerToken[],
  id: string,
  position: number,
): ChatComposerTokenDeletionResult {
  const normalized = normalizeChatComposerTokens(tokens);
  const safePosition = Math.max(0, Math.min(Math.trunc(position), chatComposerTokenUnitLength(normalized)));
  let cursor = 0;
  let removedStart = -1;
  let removedEnd = -1;
  for (const token of normalized) {
    const next = cursor + chatComposerSingleTokenUnitLength(token);
    if (chatComposerTokenHasId(token, id)) {
      removedStart = cursor;
      removedEnd = next;
      break;
    }
    cursor = next;
  }
  if (removedStart < 0 || removedEnd < 0) {
    return {tokens: normalized, cursor: safePosition};
  }
  const nextTokens = deleteChatComposerTokenById(normalized, id);
  const removedLength = removedEnd - removedStart;
  const nextCursor = safePosition <= removedStart
    ? safePosition
    : safePosition <= removedEnd
      ? removedStart
      : safePosition - removedLength;
  return {
    tokens: nextTokens,
    cursor: Math.max(0, Math.min(nextCursor, chatComposerTokenUnitLength(nextTokens))),
  };
}

export function deleteChatComposerTokenByIdAtBoundary(
  tokens: ChatComposerToken[],
  id: string,
): ChatComposerTokenDeletionResult {
  const normalized = normalizeChatComposerTokens(tokens);
  let cursor = 0;
  for (const token of normalized) {
    if (chatComposerTokenHasId(token, id)) {
      return deleteChatComposerTokenByIdAtPosition(normalized, id, cursor);
    }
    cursor += chatComposerSingleTokenUnitLength(token);
  }
  return {tokens: normalized, cursor};
}

export function chatComposerTokenHasId(token: ChatComposerToken, id: string): boolean {
  return token.type !== 'text' && token.id === id;
}

export function chatComposerCapsuleBeforePosition(
  tokens: ChatComposerToken[],
  position: number,
): ChatComposerFileToken | ChatComposerSkillToken | null {
  let cursor = 0;
  for (const token of tokens) {
    const next = cursor + chatComposerSingleTokenUnitLength(token);
    if (next === position && token.type !== 'text') {
      return token;
    }
    cursor = next;
  }
  return null;
}

export function chatComposerCapsuleAfterPosition(
  tokens: ChatComposerToken[],
  position: number,
): ChatComposerFileToken | ChatComposerSkillToken | null {
  let cursor = 0;
  for (const token of tokens) {
    if (cursor === position && token.type !== 'text') {
      return token;
    }
    cursor += chatComposerSingleTokenUnitLength(token);
  }
  return null;
}

function activeQueryRange(
  tokens: ChatComposerToken[],
  position: number,
): {start: number; end: number} | null {
  const located = locateTextPosition(tokens, position);
  if (!located) {
    return null;
  }
  const before = located.token.text.slice(0, located.offset);
  const fileAt = before.lastIndexOf('@');
  const slashAt = before.lastIndexOf('/');
  const queryStart = Math.max(fileAt, slashAt);
  if (queryStart < 0 || /\s/.test(before.slice(queryStart + 1))) {
    return null;
  }
  if (queryStart > 0 && !/\s/.test(before[queryStart - 1])) {
    return null;
  }
  return {
    start: located.tokenStart + queryStart,
    end: position,
  };
}

function locateTextPosition(
  tokens: ChatComposerToken[],
  position: number,
): {token: ChatComposerTextToken; tokenStart: number; offset: number} | null {
  let cursor = 0;
  for (const token of tokens) {
    const length = chatComposerSingleTokenUnitLength(token);
    if (token.type === 'text' && position >= cursor && position <= cursor + length) {
      return {token, tokenStart: cursor, offset: Math.max(0, Math.min(position - cursor, length))};
    }
    cursor += length;
  }
  return null;
}

function replaceTokenRange(
  tokens: ChatComposerToken[],
  start: number,
  end: number,
  inserted: ChatComposerToken[],
): ChatComposerToken[] {
  const out: ChatComposerToken[] = [];
  let cursor = 0;
  let insertedAdded = false;
  for (const token of tokens) {
    const length = chatComposerSingleTokenUnitLength(token);
    const tokenStart = cursor;
    const tokenEnd = cursor + length;
    if (tokenEnd < start || tokenStart > end) {
      if (!insertedAdded && tokenStart >= start) {
        out.push(...inserted);
        insertedAdded = true;
      }
      out.push(token);
      cursor = tokenEnd;
      continue;
    }
    if (token.type === 'text') {
      const keepBefore = Math.max(0, Math.min(start - tokenStart, token.text.length));
      const keepAfter = Math.max(0, Math.min(tokenEnd - end, token.text.length));
      if (keepBefore > 0) {
        out.push({type: 'text', text: token.text.slice(0, keepBefore)});
      }
      if (!insertedAdded) {
        out.push(...inserted);
        insertedAdded = true;
      }
      if (keepAfter > 0) {
        out.push({type: 'text', text: token.text.slice(token.text.length - keepAfter)});
      }
    } else if ((tokenStart < start || tokenEnd > end) && !insertedAdded) {
      out.push(...inserted);
      insertedAdded = true;
      out.push(token);
    } else if (tokenStart < start || tokenEnd > end) {
      out.push(token);
    } else if (!insertedAdded) {
      out.push(...inserted);
      insertedAdded = true;
    }
    cursor = tokenEnd;
  }
  if (!insertedAdded) {
    out.push(...inserted);
  }
  return normalizeChatComposerTokens(out);
}
