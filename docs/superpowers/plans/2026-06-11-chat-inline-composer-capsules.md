# Chat Inline Composer Capsules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build inline skill and file capsules in the chat composer while keeping the existing `session.send` protocol unchanged.

**Architecture:** Add a token model as the source of truth for composer drafts, then render that model through a lightweight local `contenteditable` component. Prompt history uses a separate parser that enhances only `prompt_request` text with inline capsules and continues to treat uploaded attachments as attachment chips.

**Tech Stack:** React 19, TypeScript, Jest, `react-test-renderer`, existing registry `RegistrySessionContentBlock` types.

---

## File Structure

- Create `app/web/src/chat/composer/chatComposerTokens.ts`
  - Owns token types, normalization, file label calculation, slash tokenization, and serialization to prompt text plus resource links.
- Create `app/web/src/chat/composer/chatPromptInlineParts.ts`
  - Converts `prompt_request` text plus `resource_link` blocks into renderable inline prompt parts.
- Create `app/web/src/chat/composer/ChatRichComposer.tsx`
  - Owns the local `contenteditable` editing surface and inline capsule rendering.
- Modify `app/web/src/chat/ChatTurnView.tsx`
  - Renders prompt text as inline prompt parts and excludes project file mentions from attachment chips.
- Modify `app/web/src/chat/composer/chatPromptAttachments.ts`
  - Adds a reusable project-file-link predicate so uploaded attachments and `@` file mentions can be distinguished outside `WorkspaceApp.tsx`.
- Modify `app/web/src/app/WorkspaceApp.tsx`
  - Stores composer tokens in drafts, wires skill/file pickers to token insertion, serializes tokens on send, and restores pending prompts from blocks.
- Modify `app/web/src/styles/chat.css`
  - Adds compact inline capsule styles for the composer and prompt history.
- Add tests:
  - `app/__tests__/web-chat-composer-tokens.test.ts`
  - `app/__tests__/web-chat-prompt-inline-parts.test.ts`
  - `app/__tests__/web-chat-rich-composer.test.tsx`

---

### Task 1: Composer Token Serialization

**Files:**
- Create: `app/__tests__/web-chat-composer-tokens.test.ts`
- Create: `app/web/src/chat/composer/chatComposerTokens.ts`

- [x] **Step 1: Write the failing token serialization tests**

Create `app/__tests__/web-chat-composer-tokens.test.ts`:

```ts
import {
  chatComposerHasSendableTokens,
  normalizeChatComposerTokens,
  serializeChatComposerTokens,
  tokenizeKnownChatSlashCommands,
  type ChatComposerToken,
} from '../web/src/chat/composer/chatComposerTokens';

describe('chat composer tokens', () => {
  test('serializes skill and file capsules into text plus resource links', () => {
    const tokens: ChatComposerToken[] = [
      {type: 'skill', id: 's1', command: '/grill-me', label: 'Grill Me'},
      {type: 'text', text: ' in '},
      {type: 'file', id: 'f1', path: 'app/web/src/chat/fix_drop.py', name: 'fix_drop.py', label: ''},
      {type: 'text', text: ' please'},
    ];

    expect(serializeChatComposerTokens(tokens)).toEqual({
      text: '/grill-me in @fix_drop.py please',
      blocks: [
        {type: 'text', text: '/grill-me in @fix_drop.py please'},
        {type: 'resource_link', uri: 'app/web/src/chat/fix_drop.py', name: 'fix_drop.py'},
      ],
    });
  });

  test('uses shortest unique suffixes for duplicate basenames', () => {
    const tokens: ChatComposerToken[] = [
      {type: 'file', id: 'a', path: 'app/web/src/chat/fix_drop.py', name: 'fix_drop.py', label: ''},
      {type: 'text', text: ' and '},
      {type: 'file', id: 'b', path: 'server/chat/fix_drop.py', name: 'fix_drop.py', label: ''},
    ];

    expect(serializeChatComposerTokens(tokens).text).toBe(
      '@web/src/chat/fix_drop.py and @server/chat/fix_drop.py',
    );
  });

  test('wraps whitespace file labels in angle brackets', () => {
    const tokens: ChatComposerToken[] = [
      {type: 'file', id: 'f1', path: 'docs/my file.ts', name: 'my file.ts', label: ''},
    ];

    expect(serializeChatComposerTokens(tokens).text).toBe('@<my file.ts>');
  });

  test('deduplicates resource links while preserving repeated text mentions', () => {
    const tokens: ChatComposerToken[] = [
      {type: 'file', id: 'f1', path: 'app/a.ts', name: 'a.ts', label: ''},
      {type: 'text', text: ' then '},
      {type: 'file', id: 'f2', path: 'app/a.ts', name: 'a.ts', label: ''},
    ];

    expect(serializeChatComposerTokens(tokens)).toEqual({
      text: '@a.ts then @a.ts',
      blocks: [
        {type: 'text', text: '@a.ts then @a.ts'},
        {type: 'resource_link', uri: 'app/a.ts', name: 'a.ts'},
      ],
    });
  });

  test('normalizes adjacent text and empty tokens', () => {
    expect(
      normalizeChatComposerTokens([
        {type: 'text', text: 'a'},
        {type: 'text', text: ''},
        {type: 'text', text: 'b'},
      ]),
    ).toEqual([{type: 'text', text: 'ab'}]);
  });

  test('tokenizes complete known slash commands without changing unknown text', () => {
    expect(
      tokenizeKnownChatSlashCommands('/grill-me in /unknown', [
        {command: '/grill-me', label: 'Grill Me'},
      ]),
    ).toEqual([
      {type: 'skill', id: expect.any(String), command: '/grill-me', label: 'Grill Me'},
      {type: 'text', text: ' in /unknown'},
    ]);
  });

  test('reports sendable content from non-empty text or capsules', () => {
    expect(chatComposerHasSendableTokens([{type: 'text', text: '  '}])).toBe(false);
    expect(chatComposerHasSendableTokens([{type: 'skill', id: 's1', command: '/x', label: 'X'}])).toBe(true);
    expect(chatComposerHasSendableTokens([{type: 'file', id: 'f1', path: 'a.ts', name: 'a.ts', label: ''}])).toBe(true);
  });
});
```

- [x] **Step 2: Run token tests and verify RED**

Run from `app`:

```bash
npm test -- --runTestsByPath __tests__/web-chat-composer-tokens.test.ts
```

Expected: Jest fails because `chatComposerTokens.ts` does not exist.

- [x] **Step 3: Implement token helpers**

Create `app/web/src/chat/composer/chatComposerTokens.ts` with:

```ts
import type {RegistrySessionContentBlock} from '../../registry/registryTypes';

export type ChatComposerTextToken = {type: 'text'; text: string};
export type ChatComposerSkillToken = {type: 'skill'; id: string; command: string; label: string};
export type ChatComposerFileToken = {type: 'file'; id: string; path: string; name: string; label: string};
export type ChatComposerToken = ChatComposerTextToken | ChatComposerSkillToken | ChatComposerFileToken;

export type ChatComposerSlashCommand = {
  command: string;
  label: string;
};

export type SerializedChatComposerTokens = {
  text: string;
  blocks: RegistrySessionContentBlock[];
};

export function normalizeChatComposerTokens(tokens: ChatComposerToken[]): ChatComposerToken[] {
  const out: ChatComposerToken[] = [];
  for (const token of tokens) {
    if (token.type === 'text') {
      if (!token.text) continue;
      const prev = out[out.length - 1];
      if (prev?.type === 'text') {
        prev.text += token.text;
      } else {
        out.push({type: 'text', text: token.text});
      }
      continue;
    }
    if (token.type === 'skill' && token.command.trim()) {
      out.push({...token, command: normalizeSkillCommand(token.command), label: token.label.trim() || skillLabelFromCommand(token.command)});
    }
    if (token.type === 'file' && token.path.trim()) {
      const path = normalizeProjectPath(token.path);
      out.push({...token, path, name: token.name.trim() || fileNameFromPath(path), label: token.label.trim()});
    }
  }
  return out;
}

export function chatComposerHasSendableTokens(tokens: ChatComposerToken[]): boolean {
  return normalizeChatComposerTokens(tokens).some(token => {
    if (token.type === 'text') return token.text.trim().length > 0;
    return true;
  });
}

export function serializeChatComposerTokens(tokens: ChatComposerToken[]): SerializedChatComposerTokens {
  const normalized = applyFileLabels(normalizeChatComposerTokens(tokens));
  const text = normalized.map(token => {
    if (token.type === 'text') return token.text;
    if (token.type === 'skill') return token.command;
    return fileReferenceText(token.label || token.name || fileNameFromPath(token.path));
  }).join('');
  const blocks: RegistrySessionContentBlock[] = text ? [{type: 'text', text}] : [];
  const seen = new Set<string>();
  for (const token of normalized) {
    if (token.type !== 'file') continue;
    if (seen.has(token.path)) continue;
    seen.add(token.path);
    blocks.push({type: 'resource_link', uri: token.path, name: token.name || fileNameFromPath(token.path)});
  }
  return {text, blocks};
}

export function tokenizeKnownChatSlashCommands(text: string, commands: ChatComposerSlashCommand[]): ChatComposerToken[] {
  const byCommand = new Map(commands.map(item => [normalizeSkillCommand(item.command), item.label]));
  const parts: ChatComposerToken[] = [];
  const pattern = /(^|[\s([{,;])\/[A-Za-z0-9][A-Za-z0-9_-]*(?=$|[\s)\]},;.!?])/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const prefix = match[1] ?? '';
    const commandStart = match.index + prefix.length;
    const command = normalizeSkillCommand(text.slice(commandStart, pattern.lastIndex));
    const label = byCommand.get(command);
    if (!label) continue;
    if (commandStart > cursor) {
      parts.push({type: 'text', text: text.slice(cursor, commandStart)});
    }
    parts.push({type: 'skill', id: `skill:${command}:${commandStart}`, command, label});
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) {
    parts.push({type: 'text', text: text.slice(cursor)});
  }
  return normalizeChatComposerTokens(parts.length > 0 ? parts : [{type: 'text', text}]);
}

function applyFileLabels(tokens: ChatComposerToken[]): ChatComposerToken[] {
  const fileTokens = tokens.filter((token): token is ChatComposerFileToken => token.type === 'file');
  const labels = shortestUniqueFileLabels(fileTokens.map(token => token.path));
  let fileIndex = 0;
  return tokens.map(token => {
    if (token.type !== 'file') return token;
    const label = labels[fileIndex++] || token.name || fileNameFromPath(token.path);
    return {...token, label};
  });
}

function shortestUniqueFileLabels(paths: string[]): string[] {
  const normalized = paths.map(normalizeProjectPath);
  return normalized.map((path, index) => {
    const pathParts = path.split('/').filter(Boolean);
    for (let length = 1; length <= pathParts.length; length += 1) {
      const suffix = pathParts.slice(-length).join('/');
      const unique = normalized.every((other, otherIndex) => {
        if (otherIndex === index) return true;
        const otherParts = other.split('/').filter(Boolean);
        return otherParts.slice(-length).join('/') !== suffix;
      });
      if (unique) return suffix;
    }
    return path;
  });
}

function fileReferenceText(label: string): string {
  return /\s/.test(label) ? `@<${label}>` : `@${label}`;
}

function normalizeSkillCommand(command: string): string {
  const value = command.trim();
  return value.startsWith('/') ? value : `/${value}`;
}

function skillLabelFromCommand(command: string): string {
  return normalizeSkillCommand(command)
    .replace(/^\//, '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function normalizeProjectPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
}

function fileNameFromPath(path: string): string {
  const normalized = normalizeProjectPath(path);
  return normalized.split('/').filter(Boolean).pop() || normalized || 'file';
}
```

- [x] **Step 4: Run token tests and verify GREEN**

Run:

```bash
npm test -- --runTestsByPath __tests__/web-chat-composer-tokens.test.ts
```

Expected: all tests in `web-chat-composer-tokens.test.ts` pass.

---

### Task 2: Prompt Inline Parsing

**Files:**
- Create: `app/__tests__/web-chat-prompt-inline-parts.test.ts`
- Create: `app/web/src/chat/composer/chatPromptInlineParts.ts`
- Modify: `app/web/src/chat/composer/chatPromptAttachments.ts`

- [x] **Step 1: Write failing prompt parser tests**

Create `app/__tests__/web-chat-prompt-inline-parts.test.ts`:

```ts
import {
  buildChatPromptInlineParts,
} from '../web/src/chat/composer/chatPromptInlineParts';
import {
  isProjectFileResourceLinkBlock,
  isPromptAttachmentContentBlock,
} from '../web/src/chat/composer/chatPromptAttachments';
import type {RegistrySessionContentBlock} from '../web/src/registry/registryTypes';

describe('chat prompt inline parts', () => {
  test('renders new prompt text and resource links as inline file parts', () => {
    const blocks: RegistrySessionContentBlock[] = [
      {type: 'text', text: '/grill-me in @fix_drop.py please'},
      {type: 'resource_link', uri: 'app/fix_drop.py', name: 'fix_drop.py'},
    ];

    expect(buildChatPromptInlineParts(blocks, [{command: '/grill-me', label: 'Grill Me'}])).toEqual([
      {type: 'skill', command: '/grill-me', label: 'Grill Me'},
      {type: 'text', text: ' in '},
      {type: 'file', label: 'fix_drop.py', path: 'app/fix_drop.py', name: 'fix_drop.py'},
      {type: 'text', text: ' please'},
    ]);
  });

  test('supports bracketed file mentions with spaces', () => {
    const blocks: RegistrySessionContentBlock[] = [
      {type: 'text', text: 'read @<my file.ts>'},
      {type: 'resource_link', uri: 'docs/my file.ts', name: 'my file.ts'},
    ];

    expect(buildChatPromptInlineParts(blocks, []).at(-1)).toEqual({
      type: 'file',
      label: 'my file.ts',
      path: 'docs/my file.ts',
      name: 'my file.ts',
    });
  });

  test('leaves manual at text unchanged when no resource link matches', () => {
    expect(buildChatPromptInlineParts([{type: 'text', text: 'see @fix_drop.py'}], [])).toEqual([
      {type: 'text', text: 'see @fix_drop.py'},
    ]);
  });

  test('classifies project file resource links separately from uploaded attachments', () => {
    const mention = {type: 'resource_link', uri: 'app/a.ts', name: 'a.ts'} as RegistrySessionContentBlock;
    const uploaded = {type: 'resource_link', uri: 'file:///D:/a.ts', name: 'a.ts'} as RegistrySessionContentBlock;

    expect(isProjectFileResourceLinkBlock(mention)).toBe(true);
    expect(isPromptAttachmentContentBlock(mention)).toBe(false);
    expect(isProjectFileResourceLinkBlock(uploaded)).toBe(false);
    expect(isPromptAttachmentContentBlock(uploaded)).toBe(true);
  });
});
```

- [x] **Step 2: Run prompt parser tests and verify RED**

Run:

```bash
npm test -- --runTestsByPath __tests__/web-chat-prompt-inline-parts.test.ts
```

Expected: Jest fails because `chatPromptInlineParts.ts` and `isProjectFileResourceLinkBlock` do not exist.

- [x] **Step 3: Implement prompt parser and attachment filter**

Add `isProjectFileResourceLinkBlock` to `chatPromptAttachments.ts` and make `isPromptAttachmentContentBlock` return false for project-relative resource links.

Create `chatPromptInlineParts.ts` with:

```ts
import type {RegistrySessionContentBlock} from '../../registry/registryTypes';
import {isProjectFileResourceLinkBlock} from './chatPromptAttachments';

export type ChatPromptInlinePart =
  | {type: 'text'; text: string}
  | {type: 'skill'; command: string; label: string}
  | {type: 'file'; label: string; path: string; name: string};

export type ChatPromptInlineSkill = {
  command: string;
  label: string;
};

export function buildChatPromptInlineParts(
  blocks: RegistrySessionContentBlock[],
  skills: ChatPromptInlineSkill[],
): ChatPromptInlinePart[] {
  const text = blocks.find(block => block.type === 'text' && typeof block.text === 'string')?.text ?? '';
  if (!text) return [];
  const files = blocks
    .filter(isProjectFileResourceLinkBlock)
    .map(block => ({path: block.uri?.trim() ?? '', name: block.name?.trim() || fileNameFromPath(block.uri ?? '')}))
    .filter(file => file.path);
  const skillByCommand = new Map(skills.map(skill => [normalizeSkillCommand(skill.command), skill.label]));
  const parts: ChatPromptInlinePart[] = [];
  let cursor = 0;
  const mentionPattern = /(^|[\s([{,;])(?:\/[A-Za-z0-9][A-Za-z0-9_-]*|@<[^>\r\n]+>|@[^\s)\]},;.!?]+)/g;
  const usedFiles = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(text)) !== null) {
    const prefix = match[1] ?? '';
    const start = match.index + prefix.length;
    const raw = text.slice(start, mentionPattern.lastIndex);
    const replacement = inlinePartForRawToken(raw, files, usedFiles, skillByCommand);
    if (!replacement) continue;
    if (start > cursor) parts.push({type: 'text', text: text.slice(cursor, start)});
    parts.push(replacement);
    cursor = mentionPattern.lastIndex;
  }
  if (cursor < text.length) parts.push({type: 'text', text: text.slice(cursor)});
  return mergeTextParts(parts.length > 0 ? parts : [{type: 'text', text}]);
}

function inlinePartForRawToken(
  raw: string,
  files: {path: string; name: string}[],
  usedFiles: Set<number>,
  skillByCommand: Map<string, string>,
): ChatPromptInlinePart | null {
  if (raw.startsWith('/')) {
    const command = normalizeSkillCommand(raw);
    const label = skillByCommand.get(command);
    return label ? {type: 'skill', command, label} : null;
  }
  const label = raw.startsWith('@<') && raw.endsWith('>') ? raw.slice(2, -1) : raw.slice(1);
  const fileIndex = files.findIndex((file, index) => !usedFiles.has(index) && (file.name === label || file.path.endsWith(`/${label}`) || file.path === label));
  if (fileIndex < 0) return null;
  usedFiles.add(fileIndex);
  const file = files[fileIndex];
  return {type: 'file', label, path: file.path, name: file.name};
}

function mergeTextParts(parts: ChatPromptInlinePart[]): ChatPromptInlinePart[] {
  const out: ChatPromptInlinePart[] = [];
  for (const part of parts) {
    if (part.type === 'text' && !part.text) continue;
    const prev = out[out.length - 1];
    if (part.type === 'text' && prev?.type === 'text') {
      prev.text += part.text;
    } else {
      out.push(part);
    }
  }
  return out;
}

function normalizeSkillCommand(command: string): string {
  const value = command.trim();
  return value.startsWith('/') ? value : `/${value}`;
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).pop() || normalized || 'file';
}
```

- [x] **Step 4: Run prompt parser tests and verify GREEN**

Run:

```bash
npm test -- --runTestsByPath __tests__/web-chat-prompt-inline-parts.test.ts
```

Expected: all tests in `web-chat-prompt-inline-parts.test.ts` pass.

---

### Task 3: Rich Composer Component

**Files:**
- Create: `app/__tests__/web-chat-rich-composer.test.tsx`
- Create: `app/web/src/chat/composer/ChatRichComposer.tsx`

- [x] **Step 1: Write failing rich composer tests**

Create `app/__tests__/web-chat-rich-composer.test.tsx`:

```tsx
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  ChatRichComposer,
  type ChatRichComposerHandle,
} from '../web/src/chat/composer/ChatRichComposer';
import type {ChatComposerToken} from '../web/src/chat/composer/chatComposerTokens';

describe('ChatRichComposer', () => {
  test('renders skill and file capsules inline', async () => {
    const tokens: ChatComposerToken[] = [
      {type: 'skill', id: 's1', command: '/grill-me', label: 'Grill Me'},
      {type: 'text', text: ' in '},
      {type: 'file', id: 'f1', path: 'app/fix_drop.py', name: 'fix_drop.py', label: 'fix_drop.py'},
    ];
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRichComposer tokens={tokens} onTokensChange={jest.fn()} readOnly={false} />,
      );
    });

    const capsules = renderer!.root.findAllByProps({'data-chat-composer-capsule': true});
    expect(capsules.map(item => item.props['data-kind'])).toEqual(['skill', 'file']);
    expect(capsules.map(item => item.props.contentEditable)).toEqual([false, false]);
  });

  test('imperative insertion appends file and skill tokens', async () => {
    const onTokensChange = jest.fn();
    const ref = React.createRef<ChatRichComposerHandle>();

    await ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ChatRichComposer
          ref={ref}
          tokens={[{type: 'text', text: 'check '}]}
          onTokensChange={onTokensChange}
          readOnly={false}
        />,
      );
    });

    await ReactTestRenderer.act(() => {
      ref.current!.insertSkill({command: '/grill-me', label: 'Grill Me'});
      ref.current!.insertFile({path: 'app/fix_drop.py', name: 'fix_drop.py'});
    });

    expect(onTokensChange).toHaveBeenLastCalledWith([
      {type: 'text', text: 'check '},
      {type: 'skill', id: expect.any(String), command: '/grill-me', label: 'Grill Me'},
      {type: 'text', text: ' '},
      {type: 'file', id: expect.any(String), path: 'app/fix_drop.py', name: 'fix_drop.py', label: ''},
      {type: 'text', text: ' '},
    ]);
  });

  test('deleteSelectedCapsule removes the selected token', async () => {
    const onTokensChange = jest.fn();
    const ref = React.createRef<ChatRichComposerHandle>();

    await ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ChatRichComposer
          ref={ref}
          tokens={[
            {type: 'text', text: 'a '},
            {type: 'file', id: 'f1', path: 'app/a.ts', name: 'a.ts', label: 'a.ts'},
            {type: 'text', text: ' b'},
          ]}
          onTokensChange={onTokensChange}
          readOnly={false}
        />,
      );
    });

    await ReactTestRenderer.act(() => {
      ref.current!.selectToken('f1');
      ref.current!.deleteSelectedCapsule();
    });

    expect(onTokensChange).toHaveBeenLastCalledWith([
      {type: 'text', text: 'a  b'},
    ]);
  });
});
```

- [x] **Step 2: Run rich composer tests and verify RED**

Run:

```bash
npm test -- --runTestsByPath __tests__/web-chat-rich-composer.test.tsx
```

Expected: Jest fails because `ChatRichComposer.tsx` does not exist.

- [x] **Step 3: Implement `ChatRichComposer`**

Create `ChatRichComposer.tsx` with:

```tsx
import React from 'react';
import {
  normalizeChatComposerTokens,
  type ChatComposerFileToken,
  type ChatComposerSkillToken,
  type ChatComposerToken,
} from './chatComposerTokens';

export type ChatRichComposerHandle = {
  focus: () => void;
  insertSkill: (input: Pick<ChatComposerSkillToken, 'command' | 'label'>) => void;
  insertFile: (input: Pick<ChatComposerFileToken, 'path' | 'name'>) => void;
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
  onPlainTextChange?: (text: string, cursor: number) => void;
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
    onPlainTextChange,
    onSend,
  }, ref) {
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const selectedTokenIdRef = React.useRef('');
    const [selectedTokenId, setSelectedTokenId] = React.useState('');

    const setSelectedToken = React.useCallback((id: string) => {
      selectedTokenIdRef.current = id;
      setSelectedTokenId(id);
    }, []);

    const emitTokens = React.useCallback((nextTokens: ChatComposerToken[]) => {
      const normalized = normalizeChatComposerTokens(nextTokens);
      onTokensChange(normalized);
      onPlainTextChange?.(plainTextFromTokens(normalized), plainTextFromTokens(normalized).length);
    }, [onPlainTextChange, onTokensChange]);

    const appendTokens = React.useCallback((next: ChatComposerToken[]) => {
      emitTokens([...tokens, ...next]);
    }, [emitTokens, tokens]);

    React.useImperativeHandle(ref, () => ({
      focus: () => rootRef.current?.focus(),
      insertSkill: input => {
        appendTokens([
          {type: 'skill', id: createTokenId('skill'), command: input.command, label: input.label},
          {type: 'text', text: ' '},
        ]);
      },
      insertFile: input => {
        appendTokens([
          {type: 'file', id: createTokenId('file'), path: input.path, name: input.name, label: ''},
          {type: 'text', text: ' '},
        ]);
      },
      selectToken: setSelectedToken,
      deleteSelectedCapsule: () => {
        const selectedId = selectedTokenIdRef.current;
        if (!selectedId) return;
        setSelectedToken('');
        emitTokens(tokens.filter(token => !('id' in token) || token.id !== selectedId));
      },
    }), [appendTokens, emitTokens, setSelectedToken, tokens]);

    return (
      <div
        ref={rootRef}
        className={`chat-rich-composer ${className}`.trim()}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        data-empty={tokens.length === 0 || plainTextFromTokens(tokens).trim().length === 0 ? 'true' : undefined}
        enterKeyHint={enterKeyHint}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSend?.();
          }
          if ((event.key === 'Backspace' || event.key === 'Delete') && selectedTokenIdRef.current) {
            event.preventDefault();
            const selectedId = selectedTokenIdRef.current;
            setSelectedToken('');
            emitTokens(tokens.filter(token => !('id' in token) || token.id !== selectedId));
          }
        }}
      >
        {tokens.map((token, index) => {
          if (token.type === 'text') {
            return <span key={`text:${index}`}>{token.text}</span>;
          }
          const selected = token.id === selectedTokenId;
          return (
            <span
              key={token.id}
              data-chat-composer-capsule={true}
              data-kind={token.type}
              data-token-id={token.id}
              contentEditable={false}
              className={`chat-composer-capsule ${token.type}${selected ? ' selected' : ''}`}
              onMouseDown={event => {
                event.preventDefault();
                setSelectedToken(token.id);
              }}
            >
              <span className={`codicon ${token.type === 'skill' ? 'codicon-code' : 'codicon-file-code'}`} aria-hidden="true" />
              <span className="chat-composer-capsule-label">{token.label || token.name}</span>
            </span>
          );
        })}
      </div>
    );
  },
);

function createTokenId(kind: string): string {
  nextTokenId += 1;
  return `${kind}:${Date.now()}:${nextTokenId}`;
}

function plainTextFromTokens(tokens: ChatComposerToken[]): string {
  return tokens.map(token => {
    if (token.type === 'text') return token.text;
    if (token.type === 'skill') return token.command;
    return token.name;
  }).join('');
}
```

- [x] **Step 4: Run rich composer tests and verify GREEN**

Run:

```bash
npm test -- --runTestsByPath __tests__/web-chat-rich-composer.test.tsx
```

Expected: all tests in `web-chat-rich-composer.test.tsx` pass.

---

### Task 4: WorkspaceApp Wiring

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`
- Test: `app/__tests__/web-chat-ui.test.ts`
- Test: `app/__tests__/web-chat-turn-rendering.test.ts`

- [x] **Step 1: Write failing source-structure tests for WorkspaceApp wiring**

Extend `app/__tests__/web-chat-ui.test.ts` with:

```ts
test('uses rich composer tokens for inline skill and file capsules', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
  const stylesCss = readWebStyles(projectRoot);

  expect(mainTsx).toContain("import { ChatRichComposer, type ChatRichComposerHandle } from '../chat/composer/ChatRichComposer';");
  expect(mainTsx).toContain('const [chatComposerTokens, setChatComposerTokens] = useState<ChatComposerToken[]>([]);');
  expect(mainTsx).toContain('const serializedComposer = serializeChatComposerTokens(sourceTokens);');
  expect(mainTsx).toContain('chatRichComposerRef.current?.insertSkill');
  expect(mainTsx).toContain('chatRichComposerRef.current?.insertFile');
  expect(mainTsx).not.toContain('<textarea');
  expect(stylesCss).toContain('.chat-rich-composer');
  expect(stylesCss).toContain('.chat-composer-capsule');
});
```

Extend `app/__tests__/web-chat-turn-rendering.test.ts` with:

```ts
test('renders inline prompt capsules and keeps project file mentions out of attachment chips', () => {
  const chatTurn = readChatTurnView();
  const styles = readStyles();

  expect(chatTurn).toContain("from './composer/chatPromptInlineParts'");
  expect(chatTurn).toContain('buildChatPromptInlineParts(');
  expect(chatTurn).toContain('className={`chat-prompt-inline-capsule ${part.type}`}');
  expect(styles).toContain('.chat-prompt-inline-capsule');
});
```

- [x] **Step 2: Run source-structure tests and verify RED**

Run:

```bash
npm test -- --runTestsByPath __tests__/web-chat-ui.test.ts __tests__/web-chat-turn-rendering.test.ts
```

Expected: tests fail because `WorkspaceApp.tsx` still renders a textarea and `ChatTurnView.tsx` does not use inline parts.

- [x] **Step 3: Wire composer tokens in `WorkspaceApp.tsx`**

Make these concrete changes:

```ts
import { ChatRichComposer, type ChatRichComposerHandle } from '../chat/composer/ChatRichComposer';
import {
  chatComposerHasSendableTokens,
  normalizeChatComposerTokens,
  serializeChatComposerTokens,
  type ChatComposerToken,
} from '../chat/composer/chatComposerTokens';
```

Add state beside the current composer state:

```ts
const chatRichComposerRef = useRef<ChatRichComposerHandle | null>(null);
const [chatComposerTokens, setChatComposerTokens] = useState<ChatComposerToken[]>([]);
const chatComposerTokensRef = useRef<ChatComposerToken[]>([]);
```

Replace sendability:

```ts
const chatComposerHasSendableContent =
  chatComposerHasSendableTokens(chatComposerTokens) || chatAttachments.length > 0;
```

In `sendChatMessage`, use:

```ts
const sourceTokens = options.blocksOverride ? [] : chatComposerTokensRef.current;
const serializedComposer = options.blocksOverride
  ? {text: trimmedText, blocks: options.blocksOverride}
  : serializeChatComposerTokens(sourceTokens);
const trimmedText = (options.textOverride ?? serializedComposer.text).trim();
```

When building blocks without override:

```ts
blocks.push(...serializedComposer.blocks);
blocks.push(...uploadedAttachments.map(attachment => attachment.block).filter(isRegistryChatContentBlock));
```

Reset tokens on successful send:

```ts
setChatComposerTokens([]);
chatComposerTokensRef.current = [];
```

Use the rich composer in JSX:

```tsx
<ChatRichComposer
  ref={chatRichComposerRef}
  tokens={chatComposerTokens}
  onTokensChange={nextTokens => {
    const normalized = normalizeChatComposerTokens(nextTokens);
    chatComposerTokensRef.current = normalized;
    setChatComposerTokens(normalized);
    updateChatComposerText(serializeChatComposerTokens(normalized).text);
  }}
  readOnly={chatSending}
  enterKeyHint={isWide ? undefined : 'send'}
  onSend={() => {
    if (!chatSending && !chatAttachmentUploadPending) {
      sendChatMessage().catch(() => undefined);
    }
  }}
/>
```

In skill and file picker handlers:

```ts
chatRichComposerRef.current?.insertSkill({command: command.name, label: command.name.replace(/^\//, '').replace(/[-_]+/g, ' ')});
chatRichComposerRef.current?.insertFile({path, name: result.name?.trim() || chatFileMentionName(path)});
```

- [x] **Step 4: Add rich composer and prompt capsule CSS**

Add to `app/web/src/styles/chat.css`:

```css
.chat-rich-composer {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 32px;
  max-height: 180px;
  overflow-y: auto;
  padding: 5px 8px 2px;
  color: var(--text);
  font: inherit;
  font-size: 15px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  outline: none;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--muted) 46%, transparent) transparent;
}

.chat-rich-composer[data-empty='true']::before {
  content: attr(data-placeholder);
  color: var(--muted);
  pointer-events: none;
}

.chat-composer-capsule,
.chat-prompt-inline-capsule {
  display: inline-flex;
  align-items: center;
  max-width: min(260px, 100%);
  gap: 4px;
  margin: 0 2px;
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--border) 78%, var(--accent));
  border-radius: 999px;
  vertical-align: baseline;
  line-height: 1.35;
  white-space: nowrap;
}

.chat-composer-capsule.skill,
.chat-prompt-inline-capsule.skill {
  color: color-mix(in srgb, #79c0ff 76%, var(--text));
  background: color-mix(in srgb, #1f6feb 12%, transparent);
}

.chat-composer-capsule.file,
.chat-prompt-inline-capsule.file {
  color: color-mix(in srgb, var(--text) 84%, var(--muted));
  background: color-mix(in srgb, var(--surface-1) 82%, var(--accent));
}

.chat-composer-capsule.selected {
  outline: 2px solid color-mix(in srgb, var(--accent) 58%, transparent);
  outline-offset: 1px;
}

.chat-composer-capsule-label,
.chat-prompt-inline-capsule-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [x] **Step 5: Run WorkspaceApp source tests and verify GREEN**

Run:

```bash
npm test -- --runTestsByPath __tests__/web-chat-ui.test.ts __tests__/web-chat-turn-rendering.test.ts
```

Expected: updated source-structure tests pass.

---

### Task 5: Prompt History Rendering

**Files:**
- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Modify: `app/web/src/styles/chat.css`
- Test: `app/__tests__/web-chat-prompt-inline-parts.test.ts`
- Test: `app/__tests__/web-chat-turn-rendering.test.ts`

- [x] **Step 1: Render inline prompt parts in ChatTurnView**

Import:

```ts
import {buildChatPromptInlineParts, type ChatPromptInlinePart} from './composer/chatPromptInlineParts';
```

Add a render helper:

```tsx
function renderPromptInlineParts(parts: ChatPromptInlinePart[]): React.ReactNode {
  return parts.map((part, index) => {
    if (part.type === 'text') {
      return <React.Fragment key={`text:${index}`}>{part.text}</React.Fragment>;
    }
    return (
      <span
        key={`${part.type}:${index}:${part.type === 'file' ? part.path : part.command}`}
        className={`chat-prompt-inline-capsule ${part.type}`}
        title={part.type === 'file' ? part.path : part.command}
      >
        <span className={`codicon ${part.type === 'skill' ? 'codicon-code' : 'codicon-file-code'}`} aria-hidden="true" />
        <span className="chat-prompt-inline-capsule-label">{part.label}</span>
      </span>
    );
  });
}
```

In prompt rendering:

```tsx
const inlineParts = buildChatPromptInlineParts(blocks, []);
const promptBody = inlineParts.length > 0 ? renderPromptInlineParts(inlineParts) : text;

return (
  <div className="chat-prompt-user">
    {promptBody}
  </div>
);
```

- [x] **Step 2: Run prompt rendering tests**

Run:

```bash
npm test -- --runTestsByPath __tests__/web-chat-prompt-inline-parts.test.ts __tests__/web-chat-turn-rendering.test.ts
```

Expected: tests pass.

---

### Task 6: Full Verification

**Files:**
- All files touched by Tasks 1-5.

- [x] **Step 1: Run focused composer tests**

Run:

```bash
npm test -- --runTestsByPath __tests__/web-chat-composer-tokens.test.ts __tests__/web-chat-prompt-inline-parts.test.ts __tests__/web-chat-rich-composer.test.tsx
```

Expected: all focused tests pass.

- [x] **Step 2: Run web TypeScript check**

Run:

```bash
npm run tsc:web
```

Expected: TypeScript exits with code 0.

- [x] **Step 3: Run full app test suite**

Run:

```bash
npm test
```

Expected: Jest exits with code 0.

- [x] **Step 4: Inspect git diff**

Run:

```bash
git diff --stat
git diff -- app/web/src/chat/composer app/web/src/chat/ChatTurnView.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css
```

Expected: diff only contains inline composer capsule implementation and tests.

- [x] **Step 5: Commit implementation**

Run:

```bash
git add -A
git commit -m "feat: add inline chat composer capsules"
```

Expected: commit succeeds.

- [x] **Step 6: Push branch**

Run:

```bash
git push origin main
```

Expected: push succeeds.
