import type {
  RegistryChatSession,
  RegistryProject,
  RegistrySessionSearchResult,
} from '../../registry/registryTypes';

export const SESSION_SEARCH_FAST_POLL_MS = 300;
export const SESSION_SEARCH_SLOW_POLL_MS = 800;
const SESSION_SEARCH_SLOW_AFTER_UNCHANGED_POLLS = 3;

export type SessionSearchPollDelayInput = {
  changed: boolean;
  unchangedPolls: number;
};

export type SessionSearchResultsByProjectId = Record<string, RegistrySessionSearchResult[]>;

export type SessionSearchFilter = {
  projects: RegistryProject[];
  sessionsByProjectId: Record<string, RegistryChatSession[]>;
};

export function isSessionSearchPollingReady(activeSearchId: string, startedSearchId: string): boolean {
  const activeId = activeSearchId.trim();
  const startedId = startedSearchId.trim();
  return activeId !== '' && activeId === startedId;
}

export function resolveSessionSearchProjects(
  projects: RegistryProject[],
  selectedProjectId: string,
): RegistryProject[] {
  if (!selectedProjectId) {
    return projects;
  }
  return projects.filter(project => project.projectId === selectedProjectId);
}

export function resolveSessionSearchPollDelay(input: SessionSearchPollDelayInput): number {
  if (input.changed || input.unchangedPolls < SESSION_SEARCH_SLOW_AFTER_UNCHANGED_POLLS) {
    return SESSION_SEARCH_FAST_POLL_MS;
  }
  return SESSION_SEARCH_SLOW_POLL_MS;
}

export function sameSessionSearchResults(
  left: RegistrySessionSearchResult[] = [],
  right: RegistrySessionSearchResult[] = [],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.projectId !== b.projectId ||
      a.sessionId !== b.sessionId
    ) {
      return false;
    }
  }
  return true;
}

export function buildSessionSearchFilter(input: {
  projects: RegistryProject[];
  sessionsByProjectId: Record<string, RegistryChatSession[]>;
  resultsByProjectId: SessionSearchResultsByProjectId;
}): SessionSearchFilter {
  const sessionsByProjectId: Record<string, RegistryChatSession[]> = {};
  const projects = input.projects.filter(project => {
    const matchedSessionIds = new Set(
      (input.resultsByProjectId[project.projectId] ?? []).map(result => result.sessionId),
    );
    const sessions = (input.sessionsByProjectId[project.projectId] ?? [])
      .filter(session => matchedSessionIds.has(session.sessionId));
    sessionsByProjectId[project.projectId] = sessions;
    return sessions.length > 0;
  });
  return {projects, sessionsByProjectId};
}

export function mergeSessionSearchResultsByProject(
  current: SessionSearchResultsByProjectId,
  projectId: string,
  results: RegistrySessionSearchResult[],
): {resultsByProjectId: SessionSearchResultsByProjectId; changed: boolean} {
  const previous = current[projectId] ?? [];
  const nextResults = results.map(result => ({...result}));
  const changed = !sameSessionSearchResults(previous, nextResults);
  if (!changed) {
    return {resultsByProjectId: current, changed: false};
  }
  return {
    resultsByProjectId: {
      ...current,
      [projectId]: nextResults,
    },
    changed: true,
  };
}
