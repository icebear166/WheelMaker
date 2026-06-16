import React from 'react';
import {
  $applyNodeReplacement,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  DecoratorNode,
  type EditorConfig,
  type ElementNode,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type RangeSelection,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';

import {
  chatComposerSingleTokenUnitLength,
  chatComposerTokenUnitLength,
  normalizeChatComposerTokens,
  tokenizeKnownChatSlashCommands,
  type ChatComposerFileToken,
  type ChatComposerSkillToken,
  type ChatComposerToken,
} from './chatComposerTokens';
import {
  deleteChatComposerTokenById,
  insertChatComposerTokens,
} from './chatComposerTokenEditing';

export type SerializedChatComposerCapsuleNode = Spread<{
  kind: 'skill' | 'file';
  tokenId: string;
  command?: string;
  label: string;
  path?: string;
  name?: string;
  selected?: boolean;
}, SerializedLexicalNode>;

export type ChatComposerLexicalNodeForTest =
  | {type: 'text'; text: string}
  | {type: 'linebreak'}
  | {type: 'capsule'; token: ChatComposerSkillToken | ChatComposerFileToken};

export type ChatComposerLexicalInsertionResult = {
  tokens: ChatComposerToken[];
  cursor: number;
};

export class ChatComposerCapsuleNode extends DecoratorNode<React.ReactNode> {
  __kind: 'skill' | 'file';
  __tokenId: string;
  __command: string;
  __label: string;
  __path: string;
  __name: string;
  __selected: boolean;

  static getType(): string {
    return 'chat-composer-capsule';
  }

  static clone(node: ChatComposerCapsuleNode): ChatComposerCapsuleNode {
    return new ChatComposerCapsuleNode(
      {
        kind: node.__kind,
        tokenId: node.__tokenId,
        command: node.__command,
        label: node.__label,
        path: node.__path,
        name: node.__name,
        selected: node.__selected,
      },
      node.__key,
    );
  }

  static importJSON(serializedNode: SerializedLexicalNode): ChatComposerCapsuleNode {
    const capsule = serializedNode as unknown as LexicalUpdateJSON<SerializedChatComposerCapsuleNode>;
    return $createChatComposerCapsuleNode({
      kind: capsule.kind,
      tokenId: capsule.tokenId,
      command: capsule.command ?? '',
      label: capsule.label,
      path: capsule.path ?? '',
      name: capsule.name ?? '',
      selected: capsule.selected === true,
    });
  }

  constructor(
    input: {
      kind: 'skill' | 'file';
      tokenId: string;
      command?: string;
      label: string;
      path?: string;
      name?: string;
      selected?: boolean;
    },
    key?: NodeKey,
  ) {
    super(key);
    this.__kind = input.kind;
    this.__tokenId = input.tokenId;
    this.__command = input.command ?? '';
    this.__label = input.label;
    this.__path = input.path ?? '';
    this.__name = input.name ?? '';
    this.__selected = input.selected === true;
  }

  exportJSON(): SerializedChatComposerCapsuleNode {
    return {
      type: ChatComposerCapsuleNode.getType(),
      version: 1,
      kind: this.__kind,
      tokenId: this.__tokenId,
      command: this.__command,
      label: this.__label,
      path: this.__path,
      name: this.__name,
      selected: this.__selected,
    };
  }

  createDOM(): HTMLElement {
    const element = document.createElement('span');
    element.dataset.chatComposerCapsule = 'true';
    element.dataset.kind = this.__kind;
    element.dataset.tokenId = this.__tokenId;
    element.className = this.className();
    return element;
  }

  updateDOM(previous: ChatComposerCapsuleNode, dom: HTMLElement): boolean {
    if (
      previous.__kind !== this.__kind ||
      previous.__tokenId !== this.__tokenId ||
      previous.__selected !== this.__selected
    ) {
      dom.dataset.kind = this.__kind;
      dom.dataset.tokenId = this.__tokenId;
      dom.className = this.className();
    }
    return false;
  }

  decorate(): React.ReactNode {
    return (
      <>
        <span className="chat-composer-capsule-icon" aria-hidden="true">
          {this.__kind === 'skill' ? '/' : '@'}
        </span>
        <span className="chat-composer-capsule-label">
          {this.__kind === 'skill' ? this.__label : (this.__label || this.__name)}
        </span>
      </>
    );
  }

  getTextContent(): string {
    return this.__kind === 'skill' ? this.__command : fileReferenceText(this.__label || this.__name || this.__path);
  }

  getTextContentSize(): number {
    return 1;
  }

  isInline(): true {
    return true;
  }

  isKeyboardSelectable(): true {
    return true;
  }

  isIsolated(): true {
    return true;
  }

  getToken(): ChatComposerSkillToken | ChatComposerFileToken {
    if (this.__kind === 'skill') {
      return {
        type: 'skill',
        id: this.__tokenId,
        command: this.__command,
        label: this.__label,
      };
    }
    return {
      type: 'file',
      id: this.__tokenId,
      path: this.__path,
      name: this.__name,
      label: this.__label,
    };
  }

  setSelected(selected: boolean): this {
    const writable = this.getWritable();
    writable.__selected = selected;
    return writable;
  }

  private className(): string {
    return `chat-composer-capsule ${this.__kind}${this.__selected ? ' selected' : ''}`;
  }
}

export function $createChatComposerCapsuleNode(
  input: {
    kind: 'skill' | 'file';
    tokenId: string;
    command?: string;
    label: string;
    path?: string;
    name?: string;
    selected?: boolean;
  },
): ChatComposerCapsuleNode {
  return $applyNodeReplacement(new ChatComposerCapsuleNode(input));
}

export function $isChatComposerCapsuleNode(node: LexicalNode | null | undefined): node is ChatComposerCapsuleNode {
  return node instanceof ChatComposerCapsuleNode;
}

export function $setComposerTokens(tokens: ChatComposerToken[], selectedTokenId = '', cursor?: number): void {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  paragraph.append(...$createComposerNodes(tokens, selectedTokenId));
  root.append(paragraph);
  $selectComposerPosition(paragraph, normalizeChatComposerTokens(tokens), cursor ?? chatComposerTokenUnitLength(tokens));
}

export function $readComposerTokens(): ChatComposerToken[] {
  const paragraph = $getComposerParagraph();
  if (!paragraph) {
    return [];
  }
  return normalizeChatComposerTokens($readComposerChildren(paragraph));
}

export function $currentComposerPosition(tokens: ChatComposerToken[]): number {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return chatComposerTokenUnitLength(tokens);
  }
  return $selectionPointToComposerPosition(selection);
}

export function $setSelectedComposerCapsule(selectedTokenId: string): void {
  const paragraph = $getComposerParagraph();
  if (!paragraph) {
    return;
  }
  for (const child of paragraph.getChildren()) {
    if ($isChatComposerCapsuleNode(child)) {
      child.setSelected(!!selectedTokenId && child.getToken().id === selectedTokenId);
    }
  }
}

export function $insertComposerTokens(
  insertedTokens: ChatComposerToken[],
  slashCommands: {command: string; label: string}[],
): ChatComposerLexicalInsertionResult {
  const sourceTokens = $readComposerTokens();
  const insertion = insertChatComposerTokens(
    sourceTokens,
    $currentComposerPosition(sourceTokens),
    insertedTokens,
  );
  const nextTokens = normalizeComposerTextTokens(insertion.tokens, slashCommands);
  $setComposerTokens(nextTokens, '', insertion.cursor);
  return {
    tokens: nextTokens,
    cursor: insertion.cursor,
  };
}

export function $insertComposerPlainText(text: string): void {
  const node = $createTextNode(text);
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    selection.insertNodes([node]);
    return;
  }
  const currentTokens = $readComposerTokens();
  const nextTokens = normalizeChatComposerTokens([...currentTokens, {type: 'text', text}]);
  $setComposerTokens(nextTokens, '', chatComposerTokenUnitLength(nextTokens));
}

export function $deleteComposerTokenById(tokenId: string): ChatComposerToken[] {
  const nextTokens = deleteChatComposerTokenById($readComposerTokens(), tokenId);
  $setComposerTokens(nextTokens, '', chatComposerTokenUnitLength(nextTokens));
  return nextTokens;
}

export function $deleteSelectedComposerCapsule(selectedTokenId: string): boolean {
  if (!selectedTokenId) {
    return false;
  }
  const paragraph = $getComposerParagraph();
  if (!paragraph) {
    return false;
  }
  for (const child of paragraph.getChildren()) {
    if ($isChatComposerCapsuleNode(child) && child.getToken().id === selectedTokenId) {
      child.remove();
      return true;
    }
  }
  return false;
}

export function $selectComposerPosition(
  paragraph: ElementNode,
  tokens: ChatComposerToken[],
  position: number,
): void {
  const safePosition = Math.max(0, Math.min(position, chatComposerTokenUnitLength(tokens)));
  let cursor = 0;
  const children = paragraph.getChildren();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const tokenLength = chatComposerSingleTokenUnitLength(token);
    const start = cursor;
    const end = cursor + tokenLength;
    const child = children[index];
    if (safePosition <= end) {
      if (token.type === 'text' && $isTextNode(child)) {
        child.select(Math.max(0, Math.min(safePosition - start, token.text.length)));
        return;
      }
      paragraph.select(safePosition <= start ? index : index + 1);
      return;
    }
    cursor = end;
  }
  paragraph.select(children.length);
}

export function lexicalNodesFromChatComposerTokensForTest(tokens: ChatComposerToken[]): ChatComposerLexicalNodeForTest[] {
  return normalizeChatComposerTokens(tokens).flatMap(token => {
    if (token.type === 'text') {
      return token.text.split('\n').flatMap((part, index) => {
        const out: ChatComposerLexicalNodeForTest[] = [];
        if (index > 0) {
          out.push({type: 'linebreak'});
        }
        if (part) {
          out.push({type: 'text', text: part});
        }
        return out;
      });
    }
    return [{type: 'capsule', token}];
  });
}

export function chatComposerTokensFromLexicalNodesForTest(nodes: ChatComposerLexicalNodeForTest[]): ChatComposerToken[] {
  return normalizeChatComposerTokens(nodes.map(node => {
    if (node.type === 'text') {
      return {type: 'text', text: node.text};
    }
    if (node.type === 'linebreak') {
      return {type: 'text', text: '\n'};
    }
    return node.token;
  }));
}

function $createComposerNodes(tokens: ChatComposerToken[], selectedTokenId: string): LexicalNode[] {
  return lexicalNodesFromChatComposerTokensForTest(tokens).map(node => {
    if (node.type === 'text') {
      return $createTextNode(node.text);
    }
    if (node.type === 'linebreak') {
      return $createLineBreakNode();
    }
    return $createChatComposerCapsuleNode({
      kind: node.token.type,
      tokenId: node.token.id,
      command: node.token.type === 'skill' ? node.token.command : '',
      label: node.token.label,
      path: node.token.type === 'file' ? node.token.path : '',
      name: node.token.type === 'file' ? node.token.name : '',
      selected: node.token.id === selectedTokenId,
    });
  });
}

export function normalizeComposerTextTokens(
  tokens: ChatComposerToken[],
  slashCommands: {command: string; label: string}[],
): ChatComposerToken[] {
  if (slashCommands.length === 0) {
    return normalizeChatComposerTokens(tokens);
  }
  return normalizeChatComposerTokens(tokens.flatMap(token => {
    if (token.type !== 'text') {
      return [token];
    }
    return tokenizeKnownChatSlashCommands(token.text, slashCommands);
  }));
}

function $getComposerParagraph(): ElementNode | null {
  const first = $getRoot().getFirstChild();
  return first && 'getChildren' in first ? first as ElementNode : null;
}

function $readComposerChildren(paragraph: ElementNode): ChatComposerToken[] {
  const out: ChatComposerToken[] = [];
  for (const child of paragraph.getChildren()) {
    if ($isTextNode(child)) {
      const text = child.getTextContent();
      if (text) {
        out.push({type: 'text', text});
      }
      continue;
    }
    if ($isLineBreakNode(child)) {
      out.push({type: 'text', text: '\n'});
      continue;
    }
    if ($isChatComposerCapsuleNode(child)) {
      out.push(child.getToken());
    }
  }
  return out;
}

function $selectionPointToComposerPosition(selection: RangeSelection): number {
  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  const paragraph = $getComposerParagraph();
  if (!paragraph) {
    return 0;
  }
  let position = 0;
  for (const child of paragraph.getChildren()) {
    if (child === anchorNode) {
      if ($isTextNode(child)) {
        return position + Math.max(0, Math.min(anchor.offset, child.getTextContentSize()));
      }
      return position;
    }
    if (child.getKey() === anchorNode.getKey()) {
      return position;
    }
    position += $isTextNode(child) ? child.getTextContentSize() : 1;
  }
  if (anchorNode === paragraph) {
    const children = paragraph.getChildren();
    return children.slice(0, Math.max(0, anchor.offset)).reduce((total, child) => {
      return total + ($isTextNode(child) ? child.getTextContentSize() : 1);
    }, 0);
  }
  return position;
}

function fileReferenceText(label: string): string {
  return /\s/.test(label) ? `@<${label}>` : `@${label}`;
}
