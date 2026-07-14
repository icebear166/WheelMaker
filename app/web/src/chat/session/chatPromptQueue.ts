import type {RegistryChatContentBlock, RegistryChatMessage} from '../../registry/registryTypes';

export type QueuedChatPrompt = {
  kind: 'prompt';
  id: string;
  sessionId: string;
  blocks: RegistryChatContentBlock[];
  createdAt: string;
  text: string;
};

export type QueuedChatCompact = {
  kind: 'compact';
  id: string;
  sessionId: string;
  createdAt: string;
};

export type QueuedChatItem = QueuedChatPrompt | QueuedChatCompact;
export type QueuedChatItemsByKey = Record<string, QueuedChatItem[]>;

// Kept as an alias while WorkspaceApp migrates from its prompt-only state name.
export type QueuedChatPromptsByKey = QueuedChatItemsByKey;

function cloneItem(item: QueuedChatItem): QueuedChatItem {
  if (item.kind === 'prompt') {
    return {...item, blocks: item.blocks.map(block => ({...block}))};
  }
  return {...item};
}

export function enqueueChatItem(
  state: QueuedChatItemsByKey,
  runtimeKey: string,
  item: QueuedChatItem,
): QueuedChatItemsByKey {
  const current = state[runtimeKey] ?? [];
  return {...state, [runtimeKey]: [...current, cloneItem(item)]};
}

export function enqueueChatItemToFront(
  state: QueuedChatItemsByKey,
  runtimeKey: string,
  item: QueuedChatItem,
): QueuedChatItemsByKey {
  const current = state[runtimeKey] ?? [];
  return {...state, [runtimeKey]: [cloneItem(item), ...current]};
}

export function enqueueChatPrompt(
  state: QueuedChatItemsByKey,
  runtimeKey: string,
  prompt: QueuedChatPrompt,
): QueuedChatItemsByKey {
  return enqueueChatItem(state, runtimeKey, prompt);
}

export function enqueueChatCompact(
  state: QueuedChatItemsByKey,
  runtimeKey: string,
  compact: QueuedChatCompact,
): QueuedChatItemsByKey {
  if (hasQueuedChatCompact(state, runtimeKey)) {
    return state;
  }
  return enqueueChatItem(state, runtimeKey, compact);
}

export function hasQueuedChatCompact(state: QueuedChatItemsByKey, runtimeKey: string): boolean {
  return (state[runtimeKey] ?? []).some(item => item.kind === 'compact');
}

export function queuedChatPrompts(state: QueuedChatItemsByKey, runtimeKey: string): QueuedChatPrompt[] {
  return (state[runtimeKey] ?? [])
    .filter((item): item is QueuedChatPrompt => item.kind === 'prompt')
    .map(item => cloneItem(item) as QueuedChatPrompt);
}

export function cancelQueuedChatItem(
  state: QueuedChatItemsByKey,
  runtimeKey: string,
  itemId: string,
): QueuedChatItemsByKey {
  const next = (state[runtimeKey] ?? []).filter(item => item.id !== itemId);
  if (next.length === 0) {
    const {[runtimeKey]: _removed, ...rest} = state;
    return rest;
  }
  return {...state, [runtimeKey]: next};
}

export function cancelQueuedChatPrompt(
  state: QueuedChatItemsByKey,
  runtimeKey: string,
  promptId: string,
): QueuedChatItemsByKey {
  return cancelQueuedChatItem(state, runtimeKey, promptId);
}

export function moveQueuedChatPromptToFront(
  state: QueuedChatItemsByKey,
  runtimeKey: string,
  promptId: string,
): QueuedChatItemsByKey {
  const current = state[runtimeKey] ?? [];
  const target = current.find(item => item.kind === 'prompt' && item.id === promptId);
  if (!target) return state;
  return {
    ...state,
    [runtimeKey]: [target, ...current.filter(item => item !== target)],
  };
}

export function shiftNextQueuedChatItem(
  state: QueuedChatItemsByKey,
  runtimeKey: string,
): {state: QueuedChatItemsByKey; item: QueuedChatItem | null} {
  const current = state[runtimeKey] ?? [];
  const [item, ...rest] = current;
  if (!item) return {state, item: null};
  if (rest.length === 0) {
    const {[runtimeKey]: _removed, ...nextState} = state;
    return {state: nextState, item: cloneItem(item)};
  }
  return {state: {...state, [runtimeKey]: rest}, item: cloneItem(item)};
}

export function shiftNextQueuedChatPrompt(
  state: QueuedChatItemsByKey,
  runtimeKey: string,
): {state: QueuedChatItemsByKey; prompt: QueuedChatPrompt | null} {
  const first = state[runtimeKey]?.[0];
  if (!first || first.kind !== 'prompt') {
    return {state, prompt: null};
  }
  const result = shiftNextQueuedChatItem(state, runtimeKey);
  return {state: result.state, prompt: result.item as QueuedChatPrompt};
}

export function moveQueuedChatPrompts(
  state: QueuedChatItemsByKey,
  fromRuntimeKey: string,
  toRuntimeKey: string,
  sessionId: string,
): QueuedChatItemsByKey {
  if (fromRuntimeKey === toRuntimeKey) return state;
  const items = state[fromRuntimeKey] ?? [];
  if (items.length === 0) return state;
  const {[fromRuntimeKey]: _removed, ...rest} = state;
  return {
    ...rest,
    [toRuntimeKey]: [
      ...(state[toRuntimeKey] ?? []),
      ...items.map(item => ({...cloneItem(item), sessionId})),
    ],
  };
}

export function buildQueuedPromptMessage(prompt: QueuedChatPrompt, turnIndex: number): RegistryChatMessage {
  return {
    sessionId: prompt.sessionId,
    turnIndex,
    method: 'prompt_request',
    param: {
      contentBlocks: prompt.blocks.map(block => ({...block})),
      createdAt: prompt.createdAt,
      queuedPromptId: prompt.id,
      queueStatus: 'queued',
    },
    finished: false,
  };
}
