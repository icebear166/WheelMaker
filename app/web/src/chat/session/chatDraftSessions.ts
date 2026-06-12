import type { ChatSessionKey } from './chatSessionKey';

export const DRAFT_CHAT_SESSION_ID_PREFIX = 'draft-chat-session-';

export type DraftChatSessionStatus = 'creating' | 'failed' | 'sendingFirstPrompt';

export type DraftChatSession = {
  draftId: string;
  projectId: string;
  agentType: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: DraftChatSessionStatus;
  errorMessage: string;
};

type CreateDraftChatSessionInput = {
  projectId: string;
  agentType: string;
  nowIso?: string;
  draftId?: string;
};

type ResolveDraftReplacementSelectionInput = {
  currentSelectedKey: ChatSessionKey | null;
  draft: DraftChatSession;
  realSessionId: string;
};

function createDraftChatSessionId(): string {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${DRAFT_CHAT_SESSION_ID_PREFIX}${timePart}-${randomPart}`;
}

function normalizedDraftErrorMessage(errorMessage: string): string {
  return errorMessage.trim() || 'Session create failed.';
}

export function isDraftChatSessionId(sessionId: string): boolean {
  return sessionId.startsWith(DRAFT_CHAT_SESSION_ID_PREFIX);
}

export function createDraftChatSession({
  projectId,
  agentType,
  nowIso,
  draftId,
}: CreateDraftChatSessionInput): DraftChatSession {
  const createdAt = nowIso || new Date().toISOString();
  const normalizedAgentType = agentType.trim();
  return {
    draftId: draftId || createDraftChatSessionId(),
    projectId,
    agentType: normalizedAgentType,
    title: `New ${normalizedAgentType || 'agent'} session`,
    createdAt,
    updatedAt: createdAt,
    status: 'creating',
    errorMessage: '',
  };
}

export function markDraftChatSessionSending(draft: DraftChatSession): DraftChatSession {
  return {
    ...draft,
    status: 'sendingFirstPrompt',
    errorMessage: '',
    updatedAt: new Date().toISOString(),
  };
}

export function markDraftChatSessionFailed(
  draft: DraftChatSession,
  errorMessage: string,
): DraftChatSession {
  return {
    ...draft,
    status: 'failed',
    errorMessage: normalizedDraftErrorMessage(errorMessage),
    updatedAt: new Date().toISOString(),
  };
}

export function removeDraftChatSession(
  drafts: DraftChatSession[],
  draftId: string,
): DraftChatSession[] {
  return drafts.filter(draft => draft.draftId !== draftId);
}

export function resolveDraftReplacementSelection({
  currentSelectedKey,
  draft,
  realSessionId,
}: ResolveDraftReplacementSelectionInput): ChatSessionKey | null {
  if (
    currentSelectedKey?.projectId === draft.projectId &&
    currentSelectedKey.sessionId === draft.draftId
  ) {
    return {projectId: draft.projectId, sessionId: realSessionId};
  }
  return currentSelectedKey;
}
