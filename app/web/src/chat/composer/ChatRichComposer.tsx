import React from 'react';

import {
  normalizeChatComposerTokens,
  serializeChatComposerTokens,
  tokenizeKnownChatSlashCommands,
  type ChatComposerFileToken,
  type ChatComposerSkillToken,
  type ChatComposerTextToken,
  type ChatComposerToken,
} from './chatComposerTokens';

export type ChatRichComposerHandle = {
  focus: () => void;
  insertSkill: (input: Pick<ChatComposerSkillToken, 'command' | 'label'>) => void;
  insertFile: (input: Pick<ChatComposerFileToken, 'path' | 'name'>) => void;
  insertText: (text: string) => void;
  selectToken: (id: string) => void;
  deleteSelectedCapsule: () => void;
};

export type ChatRichComposerProps = {
  tokens: ChatComposerToken[];
  onTokensChange: (tokens: ChatComposerToken[]) => void;
  readOnly: boolean;
  placeholder?: string;
  enterKeyHint?: React.HTMLAttributes<HTMLDivElement>['enterKeyHint'];
  className?: string;
  slashCommands?: {command: string; label: string}[];
  onPlainTextChange?: (text: string, cursor: number) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>;
  onSend?: () => void;
};

let nextTokenId = 1;

export const ChatRichComposer = React.forwardRef<ChatRichComposerHandle, ChatRichComposerProps>(
  function ChatRichComposer({
    tokens,
    onTokensChange,
    readOnly,
    placeholder = 'Send a message...',
    enterKeyHint,
    className = '',
    slashCommands = [],
    onPlainTextChange,
    onKeyDown,
    onPaste,
    onSend,
  }, ref) {
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const tokensRef = React.useRef<ChatComposerToken[]>(tokens);
    const composingRef = React.useRef(false);
    const pendingSelectionRef = React.useRef<number | null>(null);
    const selectedTokenIdRef = React.useRef('');
    const [selectedTokenId, setSelectedTokenId] = React.useState('');

    React.useLayoutEffect(() => {
      if (composingRef.current) {
        return;
      }
      const normalized = normalizeChatComposerTokens(tokens);
      tokensRef.current = normalized;
      syncComposerDom(rootRef.current, normalized, selectedTokenIdRef.current);
      const pendingSelection = pendingSelectionRef.current;
      pendingSelectionRef.current = null;
      if (pendingSelection !== null) {
        restoreComposerSelection(rootRef.current, normalized, pendingSelection);
      }
    }, [tokens]);

    React.useLayoutEffect(() => {
      updateSelectedCapsule(rootRef.current, selectedTokenId);
    }, [selectedTokenId]);

    const setSelectedToken = React.useCallback((id: string) => {
      selectedTokenIdRef.current = id;
      setSelectedTokenId(id);
    }, []);

    const emitTokens = React.useCallback(
      (nextTokens: ChatComposerToken[], cursor = tokenUnitLength(nextTokens)) => {
        const normalized = normalizeChatComposerTokens(
          composingRef.current ? nextTokens : tokenizeTextTokens(nextTokens, slashCommands),
        );
        tokensRef.current = normalized;
        pendingSelectionRef.current = cursor;
        onTokensChange(normalized);
        const serialized = serializeChatComposerTokens(normalized);
        onPlainTextChange?.(serialized.text, Math.min(cursor, serialized.text.length));
      },
      [onPlainTextChange, onTokensChange, slashCommands],
    );

    const insertTokens = React.useCallback(
      (insertedTokens: ChatComposerToken[]) => {
        const current = tokensRef.current;
        const position = currentTokenPosition(rootRef.current, current);
        const queryRange = activeQueryRange(current, position);
        const next = queryRange
          ? replaceTokenRange(current, queryRange.start, queryRange.end, insertedTokens)
          : insertTokensAtPosition(current, position, insertedTokens);
        setSelectedToken('');
        emitTokens(next, queryRange ? queryRange.start + tokenUnitLength(insertedTokens) : position + tokenUnitLength(insertedTokens));
      },
      [emitTokens, setSelectedToken],
    );

    const deleteSelectedCapsule = React.useCallback(() => {
      const selectedId = selectedTokenIdRef.current;
      if (!selectedId) {
        return;
      }
      setSelectedToken('');
      emitTokens(tokensRef.current.filter(token => !tokenHasId(token, selectedId)));
    }, [emitTokens, setSelectedToken]);

    React.useImperativeHandle(
      ref,
      () => ({
        focus: () => rootRef.current?.focus(),
        insertSkill: input => {
          insertTokens([
            {
              type: 'skill',
              id: createTokenId('skill'),
              command: input.command,
              label: input.label,
            },
            {type: 'text', text: ' '},
          ]);
        },
        insertFile: input => {
          insertTokens([
            {
              type: 'file',
              id: createTokenId('file'),
              path: input.path,
              name: input.name,
              label: '',
            },
            {type: 'text', text: ' '},
          ]);
        },
        insertText: text => {
          if (!text) {
            return;
          }
          insertTokens([{type: 'text', text}]);
        },
        selectToken: setSelectedToken,
        deleteSelectedCapsule,
      }),
      [deleteSelectedCapsule, insertTokens, setSelectedToken],
    );

    const handleInput = React.useCallback(() => {
      const root = rootRef.current;
      if (!root) {
        return;
      }
      if (composingRef.current) {
        return;
      }
      setSelectedToken('');
      emitTokens(readTokensFromDom(root, tokensRef.current), currentTokenPosition(root, tokensRef.current));
    }, [emitTokens, setSelectedToken]);

    const handleMouseDown = React.useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>('[data-chat-composer-capsule="true"]')
          : null;
        if (!target) {
          setSelectedToken('');
          return;
        }
        const tokenId = target.dataset.tokenId ?? '';
        if (!tokenId) {
          return;
        }
        event.preventDefault();
        setSelectedToken(tokenId);
      },
      [setSelectedToken],
    );

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) {
          return;
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onSend?.();
          return;
        }
        if ((event.key === 'Backspace' || event.key === 'Delete') && selectedTokenIdRef.current) {
          event.preventDefault();
          deleteSelectedCapsule();
          return;
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          const current = tokensRef.current;
          const position = currentTokenPosition(rootRef.current, current);
          const removable = event.key === 'Backspace'
            ? capsuleBeforePosition(current, position)
            : capsuleAfterPosition(current, position);
          if (removable) {
            event.preventDefault();
            emitTokens(current.filter(token => !tokenHasId(token, removable.id)));
          }
        }
      },
      [deleteSelectedCapsule, emitTokens, onKeyDown, onSend],
    );

    return (
      <>
        {chatComposerTokensEmpty(tokens) ? (
          <span className="chat-rich-composer-placeholder" aria-hidden="true">
            {placeholder}
          </span>
        ) : null}
        <div
          ref={rootRef}
          className={`chat-rich-composer ${className}`.trim()}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          role="textbox"
          aria-label={placeholder}
          aria-multiline="true"
          enterKeyHint={enterKeyHint}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onMouseDown={handleMouseDown}
          onPaste={onPaste}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            handleInput();
          }}
        />
      </>
    );
  },
);

function tokenizeTextTokens(
  tokens: ChatComposerToken[],
  slashCommands: {command: string; label: string}[],
): ChatComposerToken[] {
  if (slashCommands.length === 0) {
    return tokens;
  }
  return tokens.flatMap(token => {
    if (token.type !== 'text') {
      return [token];
    }
    return tokenizeKnownChatSlashCommands(token.text, slashCommands);
  });
}

function createTokenId(kind: string): string {
  nextTokenId += 1;
  return `${kind}:${Date.now()}:${nextTokenId}`;
}

function chatComposerTokensEmpty(tokens: ChatComposerToken[]): boolean {
  return normalizeChatComposerTokens(tokens).every(token => token.type === 'text' && token.text.trim().length === 0);
}

function syncComposerDom(
  root: HTMLDivElement | null,
  tokens: ChatComposerToken[],
  selectedTokenId: string,
): void {
  if (!root) {
    return;
  }
  const ownerDocument = root.ownerDocument;
  root.replaceChildren(...tokens.map(token => {
    if (token.type === 'text') {
      return ownerDocument.createTextNode(token.text);
    }
    return createCapsuleNode(ownerDocument, token, token.id === selectedTokenId);
  }));
}

function createCapsuleNode(
  ownerDocument: Document,
  token: ChatComposerSkillToken | ChatComposerFileToken,
  selected: boolean,
): HTMLElement {
  const capsule = ownerDocument.createElement('span');
  capsule.dataset.chatComposerCapsule = 'true';
  capsule.dataset.kind = token.type;
  capsule.dataset.tokenId = token.id;
  capsule.contentEditable = 'false';
  capsule.className = `chat-composer-capsule ${token.type}${selected ? ' selected' : ''}`;

  const icon = ownerDocument.createElement('span');
  icon.className = `codicon ${token.type === 'skill' ? 'codicon-code' : 'codicon-file-code'}`;
  icon.setAttribute('aria-hidden', 'true');
  capsule.appendChild(icon);

  const label = ownerDocument.createElement('span');
  label.className = 'chat-composer-capsule-label';
  label.textContent = token.type === 'skill' ? token.label : (token.label || token.name);
  capsule.appendChild(label);

  return capsule;
}

function updateSelectedCapsule(root: HTMLDivElement | null, selectedTokenId: string): void {
  if (!root) {
    return;
  }
  for (const capsule of Array.from(root.querySelectorAll<HTMLElement>('[data-chat-composer-capsule="true"]'))) {
    capsule.classList.toggle('selected', !!selectedTokenId && capsule.dataset.tokenId === selectedTokenId);
  }
}

function restoreComposerSelection(
  root: HTMLDivElement | null,
  tokens: ChatComposerToken[],
  position: number,
): void {
  if (
    !root ||
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    document.activeElement !== root
  ) {
    return;
  }
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const point = composerCaretPoint(root, tokens, position);
  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function composerCaretPoint(
  root: HTMLDivElement,
  tokens: ChatComposerToken[],
  position: number,
): {node: Node; offset: number} {
  const safePosition = Math.max(0, Math.min(position, tokenUnitLength(tokens)));
  let cursor = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const tokenLength = singleTokenUnitLength(token);
    const tokenStart = cursor;
    const tokenEnd = cursor + tokenLength;
    const child = root.childNodes[index];
    if (safePosition <= tokenEnd) {
      if (token.type === 'text' && child?.nodeType === Node.TEXT_NODE) {
        return {node: child, offset: Math.max(0, Math.min(safePosition - tokenStart, token.text.length))};
      }
      return {node: root, offset: safePosition <= tokenStart ? index : index + 1};
    }
    cursor = tokenEnd;
  }
  return {node: root, offset: root.childNodes.length};
}

function tokenHasId(token: ChatComposerToken, id: string): boolean {
  return token.type !== 'text' && token.id === id;
}

function tokenUnitLength(tokens: ChatComposerToken[]): number {
  return tokens.reduce((total, token) => total + singleTokenUnitLength(token), 0);
}

function singleTokenUnitLength(token: ChatComposerToken): number {
  return token.type === 'text' ? token.text.length : 1;
}

function currentTokenPosition(root: HTMLDivElement | null, tokens: ChatComposerToken[]): number {
  const fallback = tokenUnitLength(tokens);
  if (!root || typeof window === 'undefined' || !window.getSelection) {
    return fallback;
  }
  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode;
  if (!selection || selection.rangeCount === 0 || !anchorNode || !root.contains(anchorNode)) {
    return fallback;
  }
  return domOffsetToTokenPosition(root, anchorNode, selection.anchorOffset, tokens);
}

function domOffsetToTokenPosition(
  root: HTMLDivElement,
  anchorNode: Node,
  anchorOffset: number,
  tokens: ChatComposerToken[],
): number {
  let position = 0;
  let found = false;
  const tokenById = tokenMap(tokens);

  const visit = (node: Node): void => {
    if (found) {
      return;
    }
    if (node === anchorNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        position += Math.max(0, Math.min(anchorOffset, node.textContent?.length ?? 0));
      } else {
        const children = Array.from(node.childNodes);
        for (const child of children.slice(0, Math.max(0, anchorOffset))) {
          position += domNodeUnitLength(child, tokenById);
        }
      }
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE || isCapsuleNode(node)) {
      position += domNodeUnitLength(node, tokenById);
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      visit(child);
      if (found) {
        return;
      }
    }
  };

  for (const child of Array.from(root.childNodes)) {
    visit(child);
    if (found) {
      break;
    }
  }
  return found ? position : tokenUnitLength(tokens);
}

function domNodeUnitLength(node: Node, tokenById: Map<string, ChatComposerToken>): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }
  if (isCapsuleNode(node)) {
    return 1;
  }
  if (node.nodeName === 'BR') {
    return 1;
  }
  let total = 0;
  for (const child of Array.from(node.childNodes)) {
    total += domNodeUnitLength(child, tokenById);
  }
  return total;
}

function readTokensFromDom(root: HTMLDivElement, previousTokens: ChatComposerToken[]): ChatComposerToken[] {
  const tokenById = tokenMap(previousTokens);
  const out: ChatComposerToken[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) {
        out.push({type: 'text', text: node.textContent});
      }
      return;
    }
    if (isCapsuleNode(node)) {
      const id = (node as HTMLElement).dataset.tokenId ?? '';
      const token = tokenById.get(id);
      if (token) {
        out.push(token);
      }
      return;
    }
    if (node.nodeName === 'BR') {
      out.push({type: 'text', text: '\n'});
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      visit(child);
    }
  };
  for (const child of Array.from(root.childNodes)) {
    visit(child);
  }
  return normalizeChatComposerTokens(out);
}

function tokenMap(tokens: ChatComposerToken[]): Map<string, ChatComposerToken> {
  const map = new Map<string, ChatComposerToken>();
  for (const token of tokens) {
    if (token.type !== 'text') {
      map.set(token.id, token);
    }
  }
  return map;
}

function isCapsuleNode(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).dataset.chatComposerCapsule === 'true';
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
    const length = singleTokenUnitLength(token);
    if (token.type === 'text' && position >= cursor && position <= cursor + length) {
      return {token, tokenStart: cursor, offset: Math.max(0, Math.min(position - cursor, length))};
    }
    cursor += length;
  }
  return null;
}

function insertTokensAtPosition(
  tokens: ChatComposerToken[],
  position: number,
  inserted: ChatComposerToken[],
): ChatComposerToken[] {
  return replaceTokenRange(tokens, position, position, inserted);
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
    const length = singleTokenUnitLength(token);
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

function capsuleBeforePosition(tokens: ChatComposerToken[], position: number): ChatComposerFileToken | ChatComposerSkillToken | null {
  let cursor = 0;
  for (const token of tokens) {
    const next = cursor + singleTokenUnitLength(token);
    if (next === position && token.type !== 'text') {
      return token;
    }
    cursor = next;
  }
  return null;
}

function capsuleAfterPosition(tokens: ChatComposerToken[], position: number): ChatComposerFileToken | ChatComposerSkillToken | null {
  let cursor = 0;
  for (const token of tokens) {
    if (cursor === position && token.type !== 'text') {
      return token;
    }
    cursor += singleTokenUnitLength(token);
  }
  return null;
}
