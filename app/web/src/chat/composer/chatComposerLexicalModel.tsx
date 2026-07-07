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
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type RangeSelection,
  type SerializedLexicalNode,
  type Spread,
  TextNode,
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
  chatComposerCapsuleAfterPosition,
  chatComposerCapsuleBeforePosition,
  deleteChatComposerTokenByIdAtBoundary,
  deleteChatComposerTokenByIdAtPosition,
  insertChatComposerTokens,
  type ChatComposerTokenDeletionResult,
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
      previous.__selected !== this.__selected ||
      previous.__label !== this.__label ||
      previous.__command !== this.__command ||
      previous.__path !== this.__path ||
      previous.__name !== this.__name
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
  const out: ChatComposerToken[] = [];
  const paragraphs = $getComposerParagraphs();
  for (let index = 0; index < paragraphs.length; index += 1) {
    if (index > 0) {
      out.push({type: 'text', text: '\n'});
    }
    out.push(...$readComposerChildren(paragraphs[index]));
  }
  return normalizeChatComposerTokens(out);
}

export function $currentComposerPosition(tokens: ChatComposerToken[]): number {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return chatComposerTokenUnitLength(tokens);
  }
  return $selectionPointToComposerPosition(selection);
}

export function $setSelectedComposerCapsule(selectedTokenId: string): void {
  for (const paragraph of $getComposerParagraphs()) {
    for (const child of paragraph.getChildren()) {
      if ($isChatComposerCapsuleNode(child)) {
        child.setSelected(!!selectedTokenId && child.getToken().id === selectedTokenId);
      }
    }
  }
}

export function $getSelectedComposerCapsuleId(): string {
  for (const paragraph of $getComposerParagraphs()) {
    for (const child of paragraph.getChildren()) {
      if ($isChatComposerCapsuleNode(child) && child.__selected) {
        return child.getToken().id;
      }
    }
  }
  return '';
}

export function registerComposerSlashCommandTransform(
  editor: LexicalEditor,
  slashCommands: {command: string; label: string}[],
): () => void {
  if (slashCommands.length === 0) {
    return () => undefined;
  }
  return editor.registerNodeTransform(TextNode, textNode => {
    if (editor.isComposing() || textNode.isComposing()) {
      return;
    }
    $replaceKnownSlashCommandsInTextNode(textNode, slashCommands);
  });
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
  const sourceTokens = $readComposerTokens();
  const deletion = deleteChatComposerTokenByIdAtPosition(
    sourceTokens,
    tokenId,
    $currentComposerPosition(sourceTokens),
  );
  $setComposerTokens(deletion.tokens, '', deletion.cursor);
  return deletion.tokens;
}

export function $deleteComposerTokenByIdAtBoundary(tokenId: string): ChatComposerTokenDeletionResult {
  const deletion = deleteChatComposerTokenByIdAtBoundary($readComposerTokens(), tokenId);
  $setComposerTokens(deletion.tokens, '', deletion.cursor);
  return deletion;
}

export function $deleteComposerCapsuleForCharacterDeletion(
  isBackward: boolean,
  options: {includeRange?: boolean} = {},
): ChatComposerTokenDeletionResult | null {
  const sourceTokens = $readComposerTokens();
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return null;
  }

  if (selection.isCollapsed()) {
    const position = $currentComposerPosition(sourceTokens);
    const target = isBackward
      ? chatComposerCapsuleBeforePosition(sourceTokens, position)
      : chatComposerCapsuleAfterPosition(sourceTokens, position);
    if (!target) {
      return null;
    }
    const deletion = deleteChatComposerTokenByIdAtPosition(sourceTokens, target.id, position);
    $setComposerTokens(deletion.tokens, '', deletion.cursor);
    return deletion;
  }

  if (options.includeRange === false) {
    return null;
  }

  const range = $composerSelectionRange(selection);
  const target = composerCapsuleInRange(sourceTokens, range.start, range.end);
  if (!target) {
    return null;
  }
  const deletion = deleteChatComposerTokenByIdAtPosition(sourceTokens, target.token.id, target.start);
  $setComposerTokens(deletion.tokens, '', deletion.cursor);
  return deletion;
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

function $replaceKnownSlashCommandsInTextNode(
  textNode: TextNode,
  slashCommands: {command: string; label: string}[],
): boolean {
  const text = textNode.getTextContent();
  const nextTokens = normalizeComposerTextTokens([{type: 'text', text}], slashCommands);
  if (chatComposerTokensEqualForLexical(nextTokens, [{type: 'text', text}])) {
    return false;
  }
  const parent = textNode.getParent();
  if (!parent) {
    return false;
  }
  const positionBeforeNode = $composerPositionBeforeChild(parent, textNode);
  const selection = $getSelection();
  const rawSelectionOffset = $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.getNode().getKey() === textNode.getKey()
    ? selection.anchor.offset
    : null;
  const replacementNodes = $createComposerNodes(nextTokens, '');
  const [firstNode, ...remainingNodes] = replacementNodes;
  if (!firstNode) {
    textNode.remove();
    return true;
  }
  let previousNode = textNode.replace(firstNode);
  for (const node of remainingNodes) {
    previousNode = previousNode.insertAfter(node);
  }
  if (rawSelectionOffset !== null) {
    $selectComposerPosition(
      parent,
      $readComposerChildren(parent),
      positionBeforeNode + composerPositionFromSerializedTextOffset(nextTokens, rawSelectionOffset),
    );
  }
  return true;
}

function $composerPositionBeforeChild(parent: ElementNode, target: LexicalNode): number {
  let position = 0;
  for (const child of parent.getChildren()) {
    if (child.getKey() === target.getKey()) {
      return position;
    }
    position += $composerNodeUnitLength(child);
  }
  return position;
}

function $composerNodeUnitLength(node: LexicalNode): number {
  if ($isTextNode(node)) {
    return node.getTextContentSize();
  }
  return 1;
}

function composerPositionFromSerializedTextOffset(tokens: ChatComposerToken[], offset: number): number {
  const safeOffset = Math.max(0, offset);
  let serializedCursor = 0;
  let composerCursor = 0;
  for (const token of tokens) {
    const serializedText = token.type === 'text'
      ? token.text
      : token.type === 'skill'
        ? token.command
        : fileReferenceText(token.label || token.name || token.path);
    const serializedEnd = serializedCursor + serializedText.length;
    if (safeOffset <= serializedEnd) {
      if (token.type === 'text') {
        return composerCursor + Math.max(0, safeOffset - serializedCursor);
      }
      return safeOffset <= serializedCursor ? composerCursor : composerCursor + 1;
    }
    serializedCursor = serializedEnd;
    composerCursor += chatComposerSingleTokenUnitLength(token);
  }
  return composerCursor;
}

function $getComposerParagraphs(): ElementNode[] {
  return $getRoot().getChildren().filter($isComposerElementNode);
}

function $isComposerElementNode(node: LexicalNode | null | undefined): node is ElementNode {
  return !!node && 'getChildren' in node;
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
  return $composerSelectionPointToPosition(selection.anchor);
}

function $composerSelectionRange(selection: RangeSelection): {start: number; end: number} {
  const anchor = $composerSelectionPointToPosition(selection.anchor);
  const focus = $composerSelectionPointToPosition(selection.focus);
  return {
    start: Math.min(anchor, focus),
    end: Math.max(anchor, focus),
  };
}

function $composerSelectionPointToPosition(point: RangeSelection['anchor']): number {
  const anchorNode = point.getNode();
  let position = 0;
  const paragraphs = $getComposerParagraphs();
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    if (paragraphIndex > 0) {
      position += 1;
    }

    if (anchorNode === paragraph) {
      const children = paragraph.getChildren();
      const safeOffset = Math.max(0, Math.min(point.offset, children.length));
      return position + children.slice(0, safeOffset).reduce((total, child) => {
        return total + $composerNodeUnitLength(child);
      }, 0);
    }

    for (const child of paragraph.getChildren()) {
      if (child === anchorNode) {
        if ($isTextNode(child)) {
          return position + Math.max(0, Math.min(point.offset, child.getTextContentSize()));
        }
        return position;
      }
      if (child.getKey() === anchorNode.getKey()) {
        return position;
      }
      position += $composerNodeUnitLength(child);
    }
  }
  return position;
}

function composerCapsuleInRange(
  tokens: ChatComposerToken[],
  start: number,
  end: number,
): {token: ChatComposerSkillToken | ChatComposerFileToken; start: number; end: number} | null {
  if (start >= end) {
    return null;
  }
  let cursor = 0;
  for (const token of tokens) {
    const next = cursor + chatComposerSingleTokenUnitLength(token);
    if (token.type !== 'text' && cursor >= start && next <= end) {
      return {token, start: cursor, end: next};
    }
    cursor = next;
  }
  return null;
}

function fileReferenceText(label: string): string {
  return /\s/.test(label) ? `@<${label}>` : `@${label}`;
}

function chatComposerTokensEqualForLexical(left: ChatComposerToken[], right: ChatComposerToken[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((token, index) => {
    const other = right[index];
    if (!other || token.type !== other.type) {
      return false;
    }
    if (token.type === 'text' && other.type === 'text') {
      return token.text === other.text;
    }
    if (token.type === 'skill' && other.type === 'skill') {
      return token.id === other.id && token.command === other.command && token.label === other.label;
    }
    if (token.type === 'file' && other.type === 'file') {
      return token.id === other.id && token.path === other.path && token.name === other.name && token.label === other.label;
    }
    return false;
  });
}
