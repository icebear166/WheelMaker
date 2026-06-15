import React from 'react';

import {
  chatComposerSingleTokenUnitLength,
  chatComposerTokenUnitLength,
  normalizeChatComposerTokens,
  serializeChatComposerTokens,
  serializedChatComposerTextPosition,
  tokenizeKnownChatSlashCommands,
  type ChatComposerFileToken,
  type ChatComposerSkillToken,
  type ChatComposerToken,
} from './chatComposerTokens';
import {
  chatComposerCapsuleAfterPosition,
  chatComposerCapsuleBeforePosition,
  deleteChatComposerTokenById,
  insertChatComposerTokens,
} from './chatComposerTokenEditing';

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
      (nextTokens: ChatComposerToken[], cursor = chatComposerTokenUnitLength(nextTokens)) => {
        const normalized = normalizeChatComposerTokens(
          composingRef.current ? nextTokens : tokenizeTextTokens(nextTokens, slashCommands),
        );
        tokensRef.current = normalized;
        pendingSelectionRef.current = cursor;
        onTokensChange(normalized);
        const serialized = serializeChatComposerTokens(normalized);
        onPlainTextChange?.(serialized.text, serializedChatComposerTextPosition(normalized, cursor));
      },
      [onPlainTextChange, onTokensChange, slashCommands],
    );

    const insertTokens = React.useCallback(
      (insertedTokens: ChatComposerToken[]) => {
        const current = tokensRef.current;
        const position = currentTokenPosition(rootRef.current, current);
        const insertion = insertChatComposerTokens(current, position, insertedTokens);
        setSelectedToken('');
        emitTokens(insertion.tokens, insertion.cursor);
      },
      [emitTokens, setSelectedToken],
    );

    const deleteSelectedCapsule = React.useCallback(() => {
      const selectedId = selectedTokenIdRef.current;
      if (!selectedId) {
        return;
      }
      setSelectedToken('');
      emitTokens(deleteChatComposerTokenById(tokensRef.current, selectedId));
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

    const handleBeforeInput = React.useCallback((event: React.FormEvent<HTMLDivElement>) => {
      if (isCompositionTextEvent(event.nativeEvent)) {
        composingRef.current = true;
      }
    }, []);

    const handleInput = React.useCallback((event?: React.FormEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      if (!root) {
        return;
      }
      if (isCompositionTextEvent(event?.nativeEvent)) {
        composingRef.current = true;
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
            ? chatComposerCapsuleBeforePosition(current, position)
            : chatComposerCapsuleAfterPosition(current, position);
          if (removable) {
            event.preventDefault();
            emitTokens(deleteChatComposerTokenById(current, removable.id));
          }
        }
      },
      [deleteSelectedCapsule, emitTokens, onKeyDown, onSend],
    );

    return (
      <>
        <div
          ref={rootRef}
          className={`chat-rich-composer ${className}`.trim()}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          role="textbox"
          aria-label={placeholder}
          aria-multiline="true"
          enterKeyHint={enterKeyHint}
          onBeforeInput={handleBeforeInput}
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
        <span className="chat-rich-composer-placeholder" aria-hidden="true">
          {placeholder}
        </span>
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

function isCompositionTextEvent(nativeEvent: Event | undefined): boolean {
  const inputEvent = nativeEvent as (Event & {inputType?: string; isComposing?: boolean}) | undefined;
  return inputEvent?.isComposing === true || inputEvent?.inputType === 'insertCompositionText';
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
  icon.className = 'chat-composer-capsule-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = token.type === 'skill' ? '/' : '@';
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
  const safePosition = Math.max(0, Math.min(position, chatComposerTokenUnitLength(tokens)));
  let cursor = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const tokenLength = chatComposerSingleTokenUnitLength(token);
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

function currentTokenPosition(root: HTMLDivElement | null, tokens: ChatComposerToken[]): number {
  const fallback = chatComposerTokenUnitLength(tokens);
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
          position += domNodeUnitLength(child);
        }
      }
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE || isCapsuleNode(node)) {
      position += domNodeUnitLength(node);
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
  return found ? position : chatComposerTokenUnitLength(tokens);
}

function domNodeUnitLength(node: Node): number {
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
    total += domNodeUnitLength(child);
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
