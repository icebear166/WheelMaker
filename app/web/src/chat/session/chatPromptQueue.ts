import type {RegistryChatContentBlock, RegistryChatMessage} from '../../registry/registryTypes';

export type QueuedChatPrompt = {
  id: string;
  sessionId: string;
  blocks: RegistryChatContentBlock[];
  createdAt: string;
  text: string;
};

export type QueuedChatPromptsByKey = Record<string, QueuedChatPrompt[]>;

function clonePrompt(prompt: QueuedChatPrompt): QueuedChatPrompt {
  return {
    ...prompt,
    blocks: prompt.blocks.map(block => ({...block})),
  };
}

export function enqueueChatPrompt(
  state: QueuedChatPromptsByKey,
  runtimeKey: string,
  prompt: QueuedChatPrompt,
): QueuedChatPromptsByKey {
  const current = state[runtimeKey] ?? [];
  return {...state, [runtimeKey]: [...current, clonePrompt(prompt)]};
}

export function cancelQueuedChatPrompt(
  state: QueuedChatPromptsByKey,
  runtimeKey: string,
  promptId: string,
): QueuedChatPromptsByKey {
  const next = (state[runtimeKey] ?? []).filter(prompt => prompt.id !== promptId);
  if (next.length === 0) {
    const {[runtimeKey]: _removed, ...rest} = state;
    return rest;
  }
  return {...state, [runtimeKey]: next};
}

export function moveQueuedChatPromptToFront(
  state: QueuedChatPromptsByKey,
  runtimeKey: string,
  promptId: string,
): QueuedChatPromptsByKey {
  const current = state[runtimeKey] ?? [];
  const target = current.find(prompt => prompt.id === promptId);
  if (!target) return state;
  return {
    ...state,
    [runtimeKey]: [target, ...current.filter(prompt => prompt.id !== promptId)],
  };
}

export function shiftNextQueuedChatPrompt(
  state: QueuedChatPromptsByKey,
  runtimeKey: string,
): {state: QueuedChatPromptsByKey; prompt: QueuedChatPrompt | null} {
  const current = state[runtimeKey] ?? [];
  const [prompt, ...rest] = current;
  if (!prompt) return {state, prompt: null};
  if (rest.length === 0) {
    const {[runtimeKey]: _removed, ...nextState} = state;
    return {state: nextState, prompt};
  }
  return {state: {...state, [runtimeKey]: rest}, prompt};
}

export function moveQueuedChatPrompts(
  state: QueuedChatPromptsByKey,
  fromRuntimeKey: string,
  toRuntimeKey: string,
  sessionId: string,
): QueuedChatPromptsByKey {
  if (fromRuntimeKey === toRuntimeKey) return state;
  const prompts = state[fromRuntimeKey] ?? [];
  if (prompts.length === 0) return state;
  const {[fromRuntimeKey]: _removed, ...rest} = state;
  return {
    ...rest,
    [toRuntimeKey]: [
      ...(state[toRuntimeKey] ?? []),
      ...prompts.map(prompt => ({...clonePrompt(prompt), sessionId})),
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
