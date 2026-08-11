import type {CodeFontId, CodeThemeId} from '../../code/shikiSettings';
import type {
  RegistryChatMessage,
  RegistrySessionContentBlock,
} from '../../registry/registryTypes';
import {
  buildAgentMessageMarkdown,
  buildPromptDoneCopyRange,
  chatMessageParamText,
  orderChatMessagesByTurnIndex,
} from '../chatCopyRange';
import {hasContinuousTurnRange} from '../chatTurnRange';
import {resolvePromptDoneStatus} from '../turns/chatPromptStatus';

export type ChatShareScope = 'response' | 'session';
export type ChatShareRole = 'user' | 'assistant';
export type ChatShareTerminalStatus = 'failed' | 'cancelled' | 'interrupted';

export type ChatShareAttachment = Readonly<{
  kind: 'image' | 'file';
  label: string;
}>;

export type ChatShareEntry = Readonly<{
  role: ChatShareRole;
  markdown: string;
  attachments: readonly ChatShareAttachment[];
  status?: ChatShareTerminalStatus;
  startTurnIndex: number;
  endTurnIndex: number;
}>;

export type ChatSharePresentation = {
  themeMode: 'dark' | 'light';
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
};

export type ChatShareSnapshotContext = {
  projectId: string;
  sessionId: string;
  title: string;
  capturedAt: string;
  presentation: ChatSharePresentation;
};

export type ChatShareSnapshot = Readonly<{
  scope: ChatShareScope;
  projectId: string;
  sessionId: string;
  terminalTurnIndex?: number;
  title: string;
  capturedAt: string;
  presentation: Readonly<ChatSharePresentation>;
  entries: readonly ChatShareEntry[];
}>;

type CompletedPromptRange = {
  messages: RegistryChatMessage[];
  startTurnIndex: number;
  endTurnIndex: number;
  done: RegistryChatMessage;
};

function positiveTurnIndex(message: RegistryChatMessage): number {
  const value = Number(message.turnIndex);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function isPromptStart(message: RegistryChatMessage): boolean {
  if (message.method === 'prompt_request') {
    return true;
  }
  return message.method === 'user_message_chunk' && message.param.steered !== true;
}

function contentBlocks(message: RegistryChatMessage): RegistrySessionContentBlock[] {
  if (!Array.isArray(message.param.contentBlocks)) {
    return [];
  }
  return message.param.contentBlocks.filter(
    (block): block is RegistrySessionContentBlock => !!block && typeof block === 'object',
  );
}

function userMarkdown(messages: RegistryChatMessage[]): string {
  return messages
    .filter(message => message.method === 'prompt_request' || message.method === 'user_message_chunk')
    .map(message => chatMessageParamText(message.param).trim())
    .filter(Boolean)
    .join('\n\n');
}

function userAttachments(messages: RegistryChatMessage[]): ChatShareAttachment[] {
  const attachments: ChatShareAttachment[] = [];
  for (const message of messages) {
    if (message.method !== 'prompt_request' && message.method !== 'user_message_chunk') {
      continue;
    }
    for (const block of contentBlocks(message)) {
      if (block.type !== 'image' && block.type !== 'resource_link') {
        continue;
      }
      const image = block.type === 'image' || (
        typeof block.mimeType === 'string' && block.mimeType.trim().toLowerCase().startsWith('image/')
      );
      const name = typeof block.name === 'string' ? block.name.trim() : '';
      attachments.push(Object.freeze({
        kind: image ? 'image' : 'file',
        label: name || (image ? 'Image attachment' : 'File attachment'),
      }));
    }
  }
  return attachments;
}

function completedPromptRanges(
  turns: RegistryChatMessage[],
  sessionId: string,
): CompletedPromptRange[] {
  const ordered = orderChatMessagesByTurnIndex(turns)
    .filter(message => message.sessionId === sessionId && positiveTurnIndex(message) > 0);
  let open: {message: RegistryChatMessage; index: number} | null = null;
  const completed: CompletedPromptRange[] = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const message = ordered[index];
    if (isPromptStart(message)) {
      open = {message, index};
      continue;
    }
    if (message.method !== 'prompt_done' || message.finished !== true || !open) {
      continue;
    }
    const startTurnIndex = positiveTurnIndex(open.message);
    const endTurnIndex = positiveTurnIndex(message);
    const messages = ordered.slice(open.index, index + 1);
    open = null;
    if (
      messages.some(candidate => candidate.method === 'session/gap') ||
      !hasContinuousTurnRange(messages, startTurnIndex, endTurnIndex)
    ) {
      continue;
    }
    completed.push({messages, startTurnIndex, endTurnIndex, done: message});
  }
  return completed;
}

function frozenSnapshotBase(
  scope: ChatShareScope,
  context: ChatShareSnapshotContext,
): Omit<ChatShareSnapshot, 'entries'> {
  return {
    scope,
    projectId: context.projectId,
    sessionId: context.sessionId,
    title: context.title,
    capturedAt: context.capturedAt,
    presentation: Object.freeze({...context.presentation}),
  };
}

function freezeSnapshot(
  snapshot: Omit<ChatShareSnapshot, 'entries'> & {entries: ChatShareEntry[]},
): ChatShareSnapshot {
  return Object.freeze({
    ...snapshot,
    entries: Object.freeze(snapshot.entries.map(entry => Object.freeze({
      ...entry,
      attachments: Object.freeze([...entry.attachments]),
    }))),
  });
}

export function buildResponseChatShareSnapshot(
  turns: RegistryChatMessage[],
  doneTurnIndex: number,
  context: ChatShareSnapshotContext,
): ChatShareSnapshot | null {
  const terminalTurnIndex = Math.trunc(doneTurnIndex);
  const done = turns.find(message => (
    message.sessionId === context.sessionId &&
    message.method === 'prompt_done' &&
    positiveTurnIndex(message) === terminalTurnIndex
  ));
  if (!done) {
    return null;
  }
  const range = buildPromptDoneCopyRange(
    turns.filter(message => message.sessionId === context.sessionId),
    terminalTurnIndex,
  );
  if (!range.ok) {
    return null;
  }
  return freezeSnapshot({
    ...frozenSnapshotBase('response', context),
    terminalTurnIndex,
    entries: [{
      role: 'assistant',
      markdown: range.markdown,
      attachments: [],
      startTurnIndex: range.startTurnIndex,
      endTurnIndex: range.endTurnIndex,
    }],
  });
}

export function buildSessionChatShareSnapshot(
  turns: RegistryChatMessage[],
  context: ChatShareSnapshotContext,
): ChatShareSnapshot | null {
  const entries: ChatShareEntry[] = [];
  for (const range of completedPromptRanges(turns, context.sessionId)) {
    const markdown = userMarkdown(range.messages);
    const attachments = userAttachments(range.messages);
    const assistantMarkdown = buildAgentMessageMarkdown(range.messages.slice(1, -1));
    const status = resolvePromptDoneStatus(range.done.param)?.kind;
    if (markdown || attachments.length > 0) {
      entries.push({
        role: 'user',
        markdown,
        attachments,
        startTurnIndex: range.startTurnIndex,
        endTurnIndex: range.endTurnIndex,
      });
    }
    if (assistantMarkdown || status) {
      entries.push({
        role: 'assistant',
        markdown: assistantMarkdown,
        attachments: [],
        ...(status ? {status} : {}),
        startTurnIndex: range.startTurnIndex,
        endTurnIndex: range.endTurnIndex,
      });
    }
  }
  if (entries.length === 0) {
    return null;
  }
  return freezeSnapshot({
    ...frozenSnapshotBase('session', context),
    entries,
  });
}
