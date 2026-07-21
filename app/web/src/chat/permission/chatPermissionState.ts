import type {RegistryChatMessage} from '../../registry/registryTypes';
import type {ChatPermissionOption} from './ChatPermissionDialog';

export type ChatPermissionRecord = {
  permissionId: string;
  requestTurnIndex: number;
  request: RegistryChatMessage;
  response?: RegistryChatMessage;
  status: 'pending' | 'selected' | 'unanswered';
  optionId?: string;
  optionName?: string;
  unansweredReason?: 'cancelled' | 'failed' | 'interrupted' | 'ended';
};

export type ChatPermissionState = {
  active: ChatPermissionRecord | null;
  byRequestTurnIndex: Map<number, ChatPermissionRecord>;
  hiddenTurnIndexes: Set<number>;
};

export type ChatPermissionRequestView = {
  title: string;
  detailsText: string;
  options: ChatPermissionOption[];
};

export function permissionRequestView(message: RegistryChatMessage): ChatPermissionRequestView {
  const title = typeof message.param?.title === 'string' && message.param.title.trim()
    ? message.param.title.trim()
    : 'Agent requests your decision';
  const detailsText = typeof message.param?.detailsText === 'string'
    ? message.param.detailsText.trim()
    : '';
  const rawOptions = Array.isArray(message.param?.options) ? message.param.options : [];
  const options = rawOptions.flatMap(option => {
    if (!option || typeof option !== 'object') return [];
    const value = option as Record<string, unknown>;
    const optionId = typeof value.optionId === 'string' ? value.optionId : '';
    const name = typeof value.name === 'string' ? value.name : '';
    if (!optionId || !name) return [];
    return [{
      optionId,
      name,
      kind: typeof value.kind === 'string' ? value.kind : '',
    }];
  });
  return {title, detailsText, options};
}

function stringParam(message: RegistryChatMessage, key: string): string {
  const value = message.param?.[key];
  return typeof value === 'string' ? value : '';
}

function positiveTurnIndex(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function unansweredReason(stopReason: string): ChatPermissionRecord['unansweredReason'] {
  switch (stopReason.trim().toLowerCase()) {
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'failed':
    case 'error':
      return 'failed';
    case 'interrupted':
      return 'interrupted';
    default:
      return 'ended';
  }
}

export function deriveChatPermissionState(messages: RegistryChatMessage[]): ChatPermissionState {
  const byRequestTurnIndex = new Map<number, ChatPermissionRecord>();
  const hiddenTurnIndexes = new Set<number>();
  let promptOpen = false;
  let promptPending = new Set<number>();

  const finishPending = (reason: ChatPermissionRecord['unansweredReason']) => {
    for (const requestTurnIndex of promptPending) {
      const record = byRequestTurnIndex.get(requestTurnIndex);
      if (record?.status === 'pending') {
        byRequestTurnIndex.set(requestTurnIndex, {...record, status: 'unanswered', unansweredReason: reason});
      }
    }
    promptPending = new Set();
  };

  const ordered = [...messages]
    .filter(message => positiveTurnIndex(message.turnIndex) > 0)
    .sort((left, right) => positiveTurnIndex(left.turnIndex) - positiveTurnIndex(right.turnIndex));

  for (const message of ordered) {
    const turnIndex = positiveTurnIndex(message.turnIndex);
    switch (message.method) {
      case 'prompt_request':
      case 'user_message_chunk':
        if (promptOpen) {
          finishPending('interrupted');
        }
        promptOpen = true;
        promptPending = new Set();
        break;
      case 'permission_request': {
        if (!promptOpen) break;
        const permissionId = stringParam(message, 'permissionId');
        if (!permissionId || byRequestTurnIndex.has(turnIndex)) break;
        byRequestTurnIndex.set(turnIndex, {
          permissionId,
          requestTurnIndex: turnIndex,
          request: message,
          status: 'pending',
        });
        promptPending.add(turnIndex);
        break;
      }
      case 'permission_response': {
        hiddenTurnIndexes.add(turnIndex);
        const permissionId = stringParam(message, 'permissionId');
        const requestTurnIndex = positiveTurnIndex(message.param?.requestTurnIndex);
        const request = byRequestTurnIndex.get(requestTurnIndex);
        if (!request || request.status !== 'pending' || request.permissionId !== permissionId) break;
        byRequestTurnIndex.set(requestTurnIndex, {
          ...request,
          response: message,
          status: 'selected',
          optionId: stringParam(message, 'optionId'),
          optionName: stringParam(message, 'optionName'),
        });
        promptPending.delete(requestTurnIndex);
        break;
      }
      case 'prompt_done':
        finishPending(unansweredReason(stringParam(message, 'stopReason')));
        promptOpen = false;
        break;
      default:
        break;
    }
  }

  const active = promptOpen
    ? Array.from(promptPending)
      .sort((left, right) => left - right)
      .map(turnIndex => byRequestTurnIndex.get(turnIndex) ?? null)
      .find((record): record is ChatPermissionRecord => record?.status === 'pending') ?? null
    : null;
  return {active, byRequestTurnIndex, hiddenTurnIndexes};
}
