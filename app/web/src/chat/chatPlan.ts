import type {RegistryChatMessage} from '../registry/registryTypes';

export type ChatPlanEntryState = 'pending' | 'in_progress' | 'completed';

export type ChatPlanEntry = {
  content: string;
  status: ChatPlanEntryState;
};

export type ChatPlanSnapshot = {
  turnIndex: number;
  entries: ChatPlanEntry[];
  activeEntry: ChatPlanEntry | null;
  activeIndex: number;
  completedCount: number;
  totalCount: number;
};

function positiveTurnIndex(message: RegistryChatMessage): number {
  const turnIndex = Number(message.turnIndex ?? 0);
  return Number.isFinite(turnIndex) ? Math.max(0, Math.trunc(turnIndex)) : 0;
}

function normalizePlanStatus(status: unknown): ChatPlanEntryState {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
  switch (value) {
    case 'completed':
    case 'complete':
    case 'done':
    case 'success':
    case 'succeeded':
      return 'completed';
    case 'in_progress':
    case 'in-progress':
    case 'inprogress':
    case 'active':
    case 'running':
      return 'in_progress';
    default:
      return 'pending';
  }
}

function isPromptStartMessage(message: RegistryChatMessage): boolean {
  return message.method === 'prompt_request' || message.method === 'user_message_chunk';
}

export function isChatPlanMessage(message: RegistryChatMessage): boolean {
  return message.method === 'agent_plan';
}

export function normalizeChatPlanEntries(param: Record<string, unknown>): ChatPlanEntry[] {
  const rawEntries = Array.isArray(param.entries) ? param.entries : [];
  const entries: ChatPlanEntry[] = [];
  for (const item of rawEntries) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const content = typeof entry.content === 'string' ? entry.content.trim() : '';
    if (!content) continue;
    entries.push({
      content,
      status: normalizePlanStatus(entry.status),
    });
  }
  return entries;
}

function summarizeChatPlanEntries(entries: ChatPlanEntry[]): Omit<ChatPlanSnapshot, 'turnIndex' | 'entries'> {
  const completedCount = entries.reduce(
    (sum, entry) => sum + (entry.status === 'completed' ? 1 : 0),
    0,
  );
  let activeIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].status === 'in_progress') {
      activeIndex = index;
      break;
    }
  }
  if (activeIndex < 0) {
    activeIndex = entries.findIndex(entry => entry.status !== 'completed');
  }
  if (activeIndex < 0 && entries.length > 0) {
    activeIndex = entries.length - 1;
  }
  return {
    activeEntry: activeIndex >= 0 ? entries[activeIndex] : null,
    activeIndex,
    completedCount,
    totalCount: entries.length,
  };
}

export function extractLatestChatPlan(messages: RegistryChatMessage[]): ChatPlanSnapshot | null {
  let latestPromptTurnIndex = 0;
  let latestPlanMessage: RegistryChatMessage | null = null;
  for (const message of messages) {
    const turnIndex = positiveTurnIndex(message);
    if (isPromptStartMessage(message)) {
      latestPromptTurnIndex = Math.max(latestPromptTurnIndex, turnIndex);
      continue;
    }
    if (isChatPlanMessage(message) && (!latestPlanMessage || turnIndex >= positiveTurnIndex(latestPlanMessage))) {
      latestPlanMessage = message;
    }
  }
  if (!latestPlanMessage || latestPromptTurnIndex > positiveTurnIndex(latestPlanMessage)) {
    return null;
  }
  const entries = normalizeChatPlanEntries(latestPlanMessage.param);
  if (entries.length === 0) {
    return null;
  }
  return {
    turnIndex: positiveTurnIndex(latestPlanMessage),
    entries,
    ...summarizeChatPlanEntries(entries),
  };
}
