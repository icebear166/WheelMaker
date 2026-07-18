import type { RegistryChatMessage } from '../../registry/registryTypes';

export type ChatPromptStatus = 'confirming' | 'responding' | 'undelivered' | 'queued' | null;

export type ChatPromptDoneStatus = {
  kind: 'cancelled' | 'interrupted' | 'failed';
  label: string;
  message: string;
};

export type ChatPromptTurnStatusIndex = {
  hasOpenPrompt: boolean;
  statusFor: (promptTurn: RegistryChatMessage) => ChatPromptStatus;
};

function positiveTurnIndex(message: RegistryChatMessage): number {
  const turnIndex = Number(message.turnIndex);
  return Number.isFinite(turnIndex) ? Math.max(0, Math.trunc(turnIndex)) : 0;
}

function isPromptStart(message: RegistryChatMessage): boolean {
  return message.method === 'prompt_request' || message.method === 'user_message_chunk';
}

function promptStatusKey(message: RegistryChatMessage): string {
  return `${message.sessionId}\u0000${positiveTurnIndex(message)}\u0000${message.method}`;
}

export function buildPromptTurnStatusIndex(
  turns: RegistryChatMessage[],
): ChatPromptTurnStatusIndex {
  let ordered = turns;
  for (let index = 1; index < turns.length; index += 1) {
    if (positiveTurnIndex(turns[index - 1]) > positiveTurnIndex(turns[index])) {
      ordered = [...turns].sort((left, right) => (
        positiveTurnIndex(left) - positiveTurnIndex(right)
      ));
      break;
    }
  }
  const statusByPromptKey = new Map<string, ChatPromptStatus>();
  const openPromptBySession = new Map<string, string>();

  for (const message of ordered) {
    if (isPromptStart(message)) {
      const key = promptStatusKey(message);
      statusByPromptKey.set(key, 'responding');
      if (positiveTurnIndex(message) > 0) {
        openPromptBySession.set(message.sessionId, key);
      }
      continue;
    }
    if (message.method !== 'prompt_done') {
      continue;
    }
    const openPromptKey = openPromptBySession.get(message.sessionId);
    if (openPromptKey) {
      statusByPromptKey.set(openPromptKey, null);
      openPromptBySession.delete(message.sessionId);
    }
  }

  return {
    hasOpenPrompt: Array.from(statusByPromptKey.values()).some(status => status === 'responding'),
    statusFor: promptTurn => isPromptStart(promptTurn)
      ? statusByPromptKey.get(promptStatusKey(promptTurn)) ?? null
      : null,
  };
}

export function resolvePromptTurnStatus(
  turns: RegistryChatMessage[],
  promptTurn: RegistryChatMessage,
): ChatPromptStatus {
  if (!isPromptStart(promptTurn)) {
    return null;
  }
  const promptTurnIndex = positiveTurnIndex(promptTurn);
  if (promptTurnIndex <= 0) {
    return 'responding';
  }
  const ordered = [...turns]
    .filter(message => message.sessionId === promptTurn.sessionId)
    .sort((left, right) => positiveTurnIndex(left) - positiveTurnIndex(right));

  for (const message of ordered) {
    const turnIndex = positiveTurnIndex(message);
    if (turnIndex <= promptTurnIndex) {
      continue;
    }
    if (isPromptStart(message)) {
      break;
    }
    if (message.method === 'prompt_done') {
      return null;
    }
  }
  return 'responding';
}

export function resolvePromptDoneStatus(param: Record<string, unknown>): ChatPromptDoneStatus | null {
  const stopReason = typeof param.stopReason === 'string'
    ? param.stopReason.trim().toLowerCase()
    : '';
  const message = typeof param.message === 'string' ? param.message.trim() : '';
  switch (stopReason) {
    case 'cancelled':
    case 'canceled':
      return {kind: 'cancelled', label: 'Cancelled', message};
    case 'interrupted':
      return {kind: 'interrupted', label: 'Interrupted', message};
    case 'failed':
    case 'error':
      return {kind: 'failed', label: 'Failed', message};
    default:
      return null;
  }
}
