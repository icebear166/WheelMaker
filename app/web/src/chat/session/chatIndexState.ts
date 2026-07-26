import type {
  RegistryChatMessageEventPayload,
  RegistryChatSession,
  RegistryEnvelope,
  RegistryProject,
} from '../../registry/registryTypes';
import type { ChatSessionKey } from './chatSessionKey';
import {
  compareChatSessionUpdatedAtDesc,
  mergeChatSession,
  mergeChatSessionList as mergeOrderedChatSessionList,
  sortChatSessions,
} from './chatSessionOrdering';

export type ChatIndexRefreshState = {
  fullRefreshInFlight: boolean;
  fullRefreshDirty: boolean;
  projectRefreshInFlight: Record<string, boolean>;
  projectRefreshDirty: Record<string, boolean>;
  projectErrors: Record<string, string>;
};

export type ChatIndexState = {
  projects: RegistryProject[];
  sessionsByProjectId: Record<string, RegistryChatSession[]>;
  selected: ChatSessionKey | null;
  refresh: ChatIndexRefreshState;
};

export type ChatSessionEventClassification =
  | { kind: 'patch'; projectId: string; session: RegistryChatSession }
  | { kind: 'refreshProject'; projectId: string }
  | { kind: 'refreshAll' }
  | { kind: 'ignore' };

export const CHAT_INDEX_PROJECT_REFRESH_CONCURRENCY = 4;

export function reconnectSessionRuntimeKeys(selectedRuntimeKey: string): string[] {
  return selectedRuntimeKey ? [selectedRuntimeKey] : [];
}

export function chatIndexProjectRefreshTargets(
  projects: RegistryProject[],
  skipProjectId = '',
): string[] {
  return projects
    .filter(project =>
      !!project.projectId &&
      project.online !== false &&
      project.projectId !== skipProjectId,
    )
    .map(project => project.projectId);
}

export async function runChatIndexProjectRefreshes(
  projectIds: string[],
  refresh: (projectId: string) => Promise<void>,
  concurrency = CHAT_INDEX_PROJECT_REFRESH_CONCURRENCY,
): Promise<void> {
  if (projectIds.length === 0) {
    return;
  }
  const workerCount = Math.min(
    projectIds.length,
    Number.isFinite(concurrency)
      ? Math.max(1, Math.trunc(concurrency))
      : CHAT_INDEX_PROJECT_REFRESH_CONCURRENCY,
  );
  let nextIndex = 0;
  const workers = Array.from({length: workerCount}, async () => {
    while (nextIndex < projectIds.length) {
      const projectId = projectIds[nextIndex];
      nextIndex += 1;
      await refresh(projectId);
    }
  });
  await Promise.all(workers);
}

export function createChatIndexState(): ChatIndexState {
  return {
    projects: [],
    sessionsByProjectId: {},
    selected: null,
    refresh: {
      fullRefreshInFlight: false,
      fullRefreshDirty: false,
      projectRefreshInFlight: {},
      projectRefreshDirty: {},
      projectErrors: {},
    },
  };
}

export function shouldUpdateCurrentProjectSessions(
  activeProjectId: string,
  currentProjectId: string,
): boolean {
  return !!activeProjectId && activeProjectId === currentProjectId;
}

function latestSessionUpdatedAt(sessions: RegistryChatSession[] | undefined): string {
  return sortChatSessions(sessions ?? [])[0]?.updatedAt || '';
}

export function sortChatIndexProjects(
  projects: RegistryProject[],
  sessionsByProjectId: Record<string, RegistryChatSession[]>,
  pinnedProjectIds: string[],
): RegistryProject[] {
  const pinnedOrder = new Map(pinnedProjectIds.map((projectId, index) => [projectId, index]));
  return [...projects].sort((left, right) => {
    const leftPinned = pinnedOrder.has(left.projectId);
    const rightPinned = pinnedOrder.has(right.projectId);
    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1;
    }
    if (leftPinned && rightPinned) {
      return (pinnedOrder.get(left.projectId) ?? 0) - (pinnedOrder.get(right.projectId) ?? 0);
    }

    const leftUpdatedAt = latestSessionUpdatedAt(sessionsByProjectId[left.projectId]);
    const rightUpdatedAt = latestSessionUpdatedAt(sessionsByProjectId[right.projectId]);
    const leftHasActivity = !!leftUpdatedAt;
    const rightHasActivity = !!rightUpdatedAt;
    if (leftHasActivity !== rightHasActivity) {
      return leftHasActivity ? -1 : 1;
    }
    if (leftHasActivity && rightHasActivity) {
      const updatedDiff = compareChatSessionUpdatedAtDesc(leftUpdatedAt, rightUpdatedAt);
      if (updatedDiff !== 0) {
        return updatedDiff;
      }
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

export function mergeChatIndexSession(
  state: ChatIndexState,
  projectId: string,
  session: Partial<RegistryChatSession> & { sessionId: string },
): ChatIndexState {
  if (!projectId || !session.sessionId) {
    return state;
  }
  const current = state.sessionsByProjectId[projectId] ?? [];
  return {
    ...state,
    sessionsByProjectId: {
      ...state.sessionsByProjectId,
      [projectId]: mergeChatSession(current, session),
    },
  };
}

export function mergeChatSessionList(
  existing: RegistryChatSession[],
  incoming: RegistryChatSession[],
): RegistryChatSession[] {
  return mergeOrderedChatSessionList(existing, incoming);
}

function projectKnown(state: ChatIndexState, projectId: string): boolean {
  return state.projects.some(project => project.projectId === projectId);
}

function sessionKnown(state: ChatIndexState, projectId: string, sessionId: string): boolean {
  return (state.sessionsByProjectId[projectId] ?? []).some(session => session.sessionId === sessionId);
}

function payloadSession(payload: unknown): RegistryChatSession | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const session = (payload as { session?: RegistryChatSession }).session;
  return session?.sessionId ? session : null;
}

function payloadSessionId(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const value = (payload as Partial<RegistryChatMessageEventPayload>).sessionId;
  return typeof value === 'string' ? value : '';
}

export function classifyChatSessionEvent(
  state: ChatIndexState,
  event: Pick<RegistryEnvelope, 'method' | 'projectId' | 'payload'>,
): ChatSessionEventClassification {
  const projectId = event.projectId || '';
  if (!projectId) {
    return { kind: 'ignore' };
  }
  if (!projectKnown(state, projectId)) {
    return { kind: 'refreshAll' };
  }

  if (event.method === 'session.updated') {
    const session = payloadSession(event.payload);
    if (!session) {
      return { kind: 'ignore' };
    }
    return { kind: 'patch', projectId, session };
  }

  if (event.method === 'session.message') {
    const sessionId = payloadSessionId(event.payload);
    if (!sessionId) {
      return { kind: 'ignore' };
    }
    return sessionKnown(state, projectId, sessionId)
      ? { kind: 'ignore' }
      : { kind: 'refreshProject', projectId };
  }

  return { kind: 'ignore' };
}

export function requestChatIndexFullRefresh(state: ChatIndexState): ChatIndexState {
  if (state.refresh.fullRefreshInFlight) {
    return {
      ...state,
      refresh: {
        ...state.refresh,
        fullRefreshDirty: true,
      },
    };
  }
  return {
    ...state,
    refresh: {
      ...state.refresh,
      fullRefreshInFlight: true,
      fullRefreshDirty: false,
    },
  };
}

export function finishChatIndexFullRefresh(
  state: ChatIndexState,
  error = '',
): ChatIndexState {
  return {
    ...state,
    refresh: {
      ...state.refresh,
      fullRefreshInFlight: state.refresh.fullRefreshDirty,
      fullRefreshDirty: false,
      projectErrors: error
        ? {
            ...state.refresh.projectErrors,
            __all__: error,
          }
        : state.refresh.projectErrors,
    },
  };
}

export function requestChatIndexProjectRefresh(
  state: ChatIndexState,
  projectId: string,
): ChatIndexState {
  if (!projectId) {
    return state;
  }
  if (state.refresh.projectRefreshInFlight[projectId]) {
    return {
      ...state,
      refresh: {
        ...state.refresh,
        projectRefreshDirty: {
          ...state.refresh.projectRefreshDirty,
          [projectId]: true,
        },
      },
    };
  }
  return {
    ...state,
    refresh: {
      ...state.refresh,
      projectRefreshInFlight: {
        ...state.refresh.projectRefreshInFlight,
        [projectId]: true,
      },
      projectRefreshDirty: {
        ...state.refresh.projectRefreshDirty,
        [projectId]: false,
      },
    },
  };
}

export function finishChatIndexProjectRefresh(
  state: ChatIndexState,
  projectId: string,
  error = '',
): ChatIndexState {
  if (!projectId) {
    return state;
  }
  const keepInFlight = !!state.refresh.projectRefreshDirty[projectId];
  const nextErrors = { ...state.refresh.projectErrors };
  if (error) {
    nextErrors[projectId] = error;
  } else {
    delete nextErrors[projectId];
  }
  return {
    ...state,
    refresh: {
      ...state.refresh,
      projectRefreshInFlight: {
        ...state.refresh.projectRefreshInFlight,
        [projectId]: keepInFlight,
      },
      projectRefreshDirty: {
        ...state.refresh.projectRefreshDirty,
        [projectId]: false,
      },
      projectErrors: nextErrors,
    },
  };
}
