import type {
  RegistryChatMessage,
  RegistrySessionSummary,
} from '../../registry/registryTypes';
import {resolveChatSessionTitle} from '../session/chatSessionTitle';
import {
  chatSessionKeyFromParts,
  type ChatSessionKey,
} from '../session/chatSessionKey';
import type {
  PromptCompletionNotificationStatus,
  WheelMakerNotificationPayload,
} from '../../notifications/notificationPayload';

export function chatSessionKeyFromNotificationUrl(rawUrl: string): ChatSessionKey | null {
  let url: URL;
  try {
    url = new URL(rawUrl, 'https://wheelmaker.invalid');
  } catch {
    return null;
  }
  return chatSessionKeyFromParts(
    url.searchParams.get('wmProjectId') ?? '',
    url.searchParams.get('wmSessionId') ?? '',
  );
}

export function promptCompletionNotificationKey(
  projectId: string,
  message: RegistryChatMessage,
): string {
  const turnIndex = Math.max(0, Math.trunc(Number(message.turnIndex) || 0));
  return `${projectId}:${message.sessionId}:${turnIndex}`;
}

export function resolvePromptCompletionStatus(
  param: Record<string, unknown>,
): PromptCompletionNotificationStatus {
  const stopReason = typeof param.stopReason === 'string'
    ? param.stopReason.trim().toLowerCase()
    : '';
  if (stopReason === 'cancelled' || stopReason === 'canceled') {
    return 'cancelled';
  }
  if (stopReason === 'interrupted') {
    return 'interrupted';
  }
  if (stopReason === 'failed' || stopReason === 'error') {
    return 'failed';
  }
  return 'completed';
}

export function shouldNotifyPromptCompletion(input: {
  enabled: boolean;
  message: RegistryChatMessage;
  projectId: string;
  selectedRuntimeKey: string;
  documentVisibility: DocumentVisibilityState | 'hidden' | 'visible';
  activeTab: string;
}): boolean {
  if (!input.enabled || !input.projectId || !input.message.sessionId) {
    return false;
  }
  if (input.message.method !== 'prompt_done') {
    return false;
  }
  if (input.documentVisibility !== 'visible') {
    return true;
  }
  if (input.activeTab !== 'chat') {
    return true;
  }
  return input.selectedRuntimeKey !== `${input.projectId}:${input.message.sessionId}`;
}

export function promptCompletionSessionKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}

export function promptCompletionStatusPhrase(status: PromptCompletionNotificationStatus): string {
  switch (status) {
    case 'cancelled':
      return 'Prompt cancelled';
    case 'interrupted':
      return 'Prompt interrupted';
    case 'failed':
      return 'Prompt failed';
    case 'completed':
    default:
      return 'Prompt completed';
  }
}

export function buildPromptCompletionNotification(input: {
  projectId: string;
  message: RegistryChatMessage;
  session?: Pick<RegistrySessionSummary, 'sessionId' | 'title'>;
}): WheelMakerNotificationPayload {
  const status = resolvePromptCompletionStatus(input.message.param);
  const sessionTitle = resolveChatSessionTitle(input.session?.title ?? '') || input.message.sessionId;
  const projectId = input.projectId;
  const sessionId = input.message.sessionId;
  const turnIndex = Math.max(0, Math.trunc(Number(input.message.turnIndex) || 0));
  const replyPreview = typeof input.message.param.replyPreview === 'string'
    ? input.message.param.replyPreview
    : '';
  const errorMessage = status === 'failed' && typeof input.message.param.message === 'string'
    ? input.message.param.message
    : '';
  const preview = replyPreview || errorMessage;

  return {
    type: 'chat.prompt.completed',
    projectId,
    sessionId,
    turnIndex,
    title: sessionTitle,
    body: preview || promptCompletionStatusPhrase(status),
    preview,
    status,
    tag: promptCompletionSessionKey(projectId, sessionId),
    url: `/?wmProjectId=${encodeURIComponent(projectId)}&wmSessionId=${encodeURIComponent(sessionId)}`,
  };
}
