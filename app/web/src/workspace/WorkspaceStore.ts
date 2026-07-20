import type {
  RegistryChatMessage,
  RegistryChatSession,
  RegistryFsEntry,
  RegistryProject,
  RegistrySessionTurn,
} from '../registry/registryTypes';
import {decodeSessionTurnToMessage} from '../chat/chatWire';
import {
  chatSessionKeyFromParts,
  type ChatSessionKey,
} from '../chat/session/chatSessionKey';
import { sanitizeCachedSessionMessages } from '../chat/turns/chatSync';
import {
  WorkspacePersistenceRepository,
  type PersistedChatCursor,
  type PersistedGlobalState,
  type WorkspaceDatabaseDump,
  type WorkspaceStorageError,
} from './WorkspacePersistence';

export type HydratedProjectState = {
  projectId: string;
};

export type CachedDirectory = {
  hash: string;
  entries: RegistryFsEntry[];
};

export type CachedFile = {
  hash: string;
  content: string;
};

export type CachedChatSession = {
  session: RegistryChatSession;
  cursor: PersistedChatCursor;
};

export type CachedChatSessionContent = {
  turns: RegistrySessionTurn[];
  messages: RegistryChatMessage[];
};

function mergeCachedChatSessionSummary(
  existing: RegistryChatSession | undefined,
  next: RegistryChatSession,
): RegistryChatSession {
  if (!existing) {
    return next;
  }
  return {
    ...next,
    configOptions:
      next.configOptions ??
      (existing.configOptions ? [...existing.configOptions] : undefined),
    commands:
      next.commands ??
      (existing.commands ? [...existing.commands] : undefined),
    usage:
      next.usage ??
      (existing.usage ? { ...existing.usage } : undefined),
  };
}

function sanitizeCursor(cursor: Partial<PersistedChatCursor> | undefined): PersistedChatCursor {
  const turnIndex = Number.isFinite(cursor?.turnIndex)
    ? Math.max(0, Math.floor(Number(cursor?.turnIndex)))
    : 0;
  return {
    turnIndex,
  };
}

function chatMessageToRawTurn(message: RegistryChatMessage): RegistrySessionTurn {
  return {
    turnIndex: Math.trunc(message.turnIndex ?? 0),
    content: JSON.stringify({method: message.method, param: message.param ?? {}}),
    finished: message.finished === true,
  };
}

export class WorkspaceStore {
  constructor(private readonly persistence = new WorkspacePersistenceRepository()) {}

  ready(): Promise<void> {
    return this.persistence.ready();
  }

  subscribeStorageErrors(listener: (error: WorkspaceStorageError) => void): () => void {
    return this.persistence.subscribeStorageErrors(listener);
  }

  getGlobalState(): PersistedGlobalState {
    return this.persistence.getGlobalState();
  }

  rememberGlobalState(patch: Partial<PersistedGlobalState>): void {
    const current = this.persistence.getGlobalState();
    const nextPatch: Partial<PersistedGlobalState> = {...patch};
    if (patch.selectedProjectId !== undefined && !patch.selectedProjectId) {
      nextPatch.selectedProjectId = current.selectedProjectId;
    }
    this.persistence.patchGlobalState(nextPatch);
  }

  selectProjectOnConnect(projects: RegistryProject[], fallbackProjectId: string): string {
    const preferred = this.persistence.getGlobalState().selectedProjectId;
    if (preferred && projects.some(item => item.projectId === preferred)) {
      return preferred;
    }
    return fallbackProjectId;
  }

  hydrateProject(projectId: string): HydratedProjectState {
    return {projectId};
  }

  hydrateCachedProject(projectId: string): HydratedProjectState {
    return this.hydrateProject(projectId);
  }

  getCachedDirectory(projectId: string, path: string): CachedDirectory | null {
    const cached = this.persistence.getCachedFile(projectId, 'dir', path);
    if (!cached) return null;
    try {
      const parsed = JSON.parse(cached.value) as RegistryFsEntry[];
      const entries = Array.isArray(parsed) ? parsed : [];
      return {hash: cached.hash, entries};
    } catch {
      return null;
    }
  }

  cacheDirectory(projectId: string, path: string, hash: string, entries: RegistryFsEntry[]): void {
    if (!projectId || !path) return;
    this.persistence.putCachedFile(projectId, 'dir', path, hash, JSON.stringify(entries));
  }

  getCachedFile(projectId: string, path: string): CachedFile | null {
    const cached = this.persistence.getCachedFile(projectId, 'file', path);
    if (!cached) return null;
    return {
      hash: cached.hash,
      content: cached.value,
    };
  }

  cacheFile(projectId: string, path: string, hash: string, content: string): void {
    if (!projectId || !path) return;
    this.persistence.putCachedFile(projectId, 'file', path, hash, content);
  }

  hydrateChatSessions(projectId: string): CachedChatSession[] {
    if (!projectId) return [];
    return this.persistence.getProjectChatSessions(projectId).map(entry => ({
      session: entry.session,
      cursor: sanitizeCursor(entry.cursor),
    }));
  }

  getCachedChatSessionContent(projectId: string, sessionId: string): CachedChatSessionContent | null {
    if (!projectId || !sessionId) return null;
    const cached = this.persistence.getProjectChatSessionContent(projectId, sessionId);
    if (!cached) return null;
    const turns = Array.isArray(cached.turns) ? cached.turns : [];
    return {
      turns,
      messages: turns
        .map(turn => decodeSessionTurnToMessage(sessionId, turn))
        .filter((item): item is RegistryChatMessage => !!item),
    };
  }

  getSelectedChatSessionId(projectId: string): string {
    if (!projectId) return '';
    return this.persistence.getProjectState(projectId).selectedChatSessionId || '';
  }

  rememberSelectedChatSession(projectId: string, sessionId: string): void {
    if (!projectId) return;
    this.persistence.patchProjectState(projectId, { selectedChatSessionId: sessionId.trim() });
  }

  getSelectedChatSessionKey(): ChatSessionKey | null {
    const global = this.persistence.getGlobalState();
    return chatSessionKeyFromParts(
      global.selectedChatProjectId || '',
      global.selectedChatSessionId || '',
    );
  }

  rememberSelectedChatSessionKey(key: ChatSessionKey | null): void {
    const normalized = key
      ? chatSessionKeyFromParts(key.projectId, key.sessionId)
      : null;
    this.persistence.patchGlobalState({
      selectedChatProjectId: normalized?.projectId ?? '',
      selectedChatSessionId: normalized?.sessionId ?? '',
    });
  }

  migrateSelectedChatSessionKey(projectId: string): ChatSessionKey | null {
    const existing = this.getSelectedChatSessionKey();
    if (existing) {
      return existing;
    }
    const fallback = chatSessionKeyFromParts(
      projectId,
      this.getSelectedChatSessionId(projectId),
    );
    if (fallback) {
      this.rememberSelectedChatSessionKey(fallback);
    }
    return fallback;
  }

  replaceChatSessions(projectId: string, sessions: RegistryChatSession[], cursorBySessionId: Record<string, PersistedChatCursor>): void {
    if (!projectId) return;
    const existingById = new Map(
      this.hydrateChatSessions(projectId).map(entry => [
        entry.session.sessionId,
        entry.session,
      ]),
    );
    const payload = sessions.map(session => ({
      session: mergeCachedChatSessionSummary(existingById.get(session.sessionId), session),
      cursor: sanitizeCursor(cursorBySessionId[session.sessionId]),
    }));
    this.persistence.replaceProjectChatSessions(projectId, payload);
  }

  rememberChatSession(projectId: string, session: RegistryChatSession, cursor: PersistedChatCursor): void {
    if (!projectId || !session.sessionId) return;
    const existing = this.hydrateChatSessions(projectId)
      .find(entry => entry.session.sessionId === session.sessionId)
      ?.session;
    const mergedSession = mergeCachedChatSessionSummary(existing, session);
    this.persistence.patchProjectChatSession(projectId, mergedSession, sanitizeCursor(cursor));
  }

  rememberChatSessionContent(
    projectId: string,
    sessionId: string,
    messages: RegistryChatMessage[],
  ): void {
    if (!projectId || !sessionId) return;
    const sanitizedMessages = sanitizeCachedSessionMessages(messages, sessionId);
    this.persistence.patchProjectChatSessionContent(
      projectId,
      sessionId,
      sanitizedMessages.map(chatMessageToRawTurn),
    );
  }

  rememberChatSessionTurns(
    projectId: string,
    sessionId: string,
    turns: RegistrySessionTurn[],
  ): void {
    if (!projectId || !sessionId) return;
    this.persistence.patchProjectChatSessionContent(projectId, sessionId, turns);
  }

  deleteChatSession(projectId: string, sessionId: string): void {
    if (!projectId || !sessionId) return;
    this.persistence.deleteProjectChatSession(projectId, sessionId);
  }

  setDisableFileCache(disableFileCache: boolean): void {
    this.persistence.patchGlobalState({disableFileCache});
  }

  clearFileCache(): void {
    this.persistence.clearFileCache();
  }

  clearLocalCache(): void {
    this.persistence.clearCache();
  }

  dumpDatabase(): Promise<WorkspaceDatabaseDump> {
    return this.persistence.dumpDatabase();
  }
}

