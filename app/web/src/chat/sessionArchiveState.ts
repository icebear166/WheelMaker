import {parseUpdatedAtMs} from '../sessionTime';
import type {RegistryChatSession, RegistryProject} from '../types/registry';

export const OLDER_SESSION_DAYS = 5;
export const OLDER_SESSIONS_EXPANDED_KEY = 'wheelmaker.chat.olderSessionsExpanded.v1';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_COLLAPSED_VISIBLE_SESSIONS = 3;

export type OlderProjectSessions = {
  visibleSessions: RegistryChatSession[];
  hiddenOlderSessions: RegistryChatSession[];
  hiddenOlderCount: number;
  showToggle: boolean;
  expanded: boolean;
};

export type ArchiveCandidate = {
  project: RegistryProject;
  session: RegistryChatSession;
};

export type ArchivedSessionLike = {
  sessionId: string;
  archivedAt: string;
  updatedAt?: string;
};

export type ArchivedSessionSection<TSession extends ArchivedSessionLike = ArchivedSessionLike> = {
  project: RegistryProject;
  rows: Array<{session: TSession}>;
};

export type ArchiveBatchFailure = {
  projectName: string;
  sessionTitle: string;
  sessionId: string;
  error: string;
};

export type ArchiveBatchProgress = {
  total: number;
  completed: number;
  archived: number;
  failed: number;
  currentLabel?: string;
  failures: ArchiveBatchFailure[];
};

export type ArchiveBatchResult = {
  candidate: ArchiveCandidate;
  ok: boolean;
  error?: string;
};

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function splitOlderProjectSessions(input: {
  sessions: RegistryChatSession[];
  nowMs: number;
  olderThanDays?: number;
  expanded: boolean;
}): OlderProjectSessions {
  const olderThanDays = input.olderThanDays ?? OLDER_SESSION_DAYS;
  const recent: RegistryChatSession[] = [];
  const older: RegistryChatSession[] = [];
  for (const session of input.sessions) {
    if (isOlderThanDays(session.updatedAt, input.nowMs, olderThanDays)) {
      older.push(session);
    } else {
      recent.push(session);
    }
  }

  if (older.length <= 1) {
    return {
      visibleSessions: [...recent, ...older],
      hiddenOlderSessions: [],
      hiddenOlderCount: 0,
      showToggle: false,
      expanded: false,
    };
  }
  if (input.expanded) {
    return {
      visibleSessions: [...recent, ...older],
      hiddenOlderSessions: [],
      hiddenOlderCount: 0,
      showToggle: true,
      expanded: true,
    };
  }
  const visibleOlderCount = Math.max(0, MIN_COLLAPSED_VISIBLE_SESSIONS - recent.length);
  const visibleOlder = older.slice(0, visibleOlderCount);
  const hiddenOlderSessions = older.slice(visibleOlderCount);
  if (hiddenOlderSessions.length === 0) {
    return {
      visibleSessions: [...recent, ...visibleOlder],
      hiddenOlderSessions: [],
      hiddenOlderCount: 0,
      showToggle: false,
      expanded: false,
    };
  }
  return {
    visibleSessions: [...recent, ...visibleOlder],
    hiddenOlderSessions,
    hiddenOlderCount: hiddenOlderSessions.length,
    showToggle: true,
    expanded: false,
  };
}

export function readOlderSessionsExpanded(storage: StorageLike | null | undefined): Record<string, boolean> {
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(OLDER_SESSIONS_EXPANDED_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const [projectId, value] of Object.entries(parsed)) {
      if (value === true) {
        out[projectId] = true;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeOlderSessionsExpanded(storage: StorageLike | null | undefined, state: Record<string, boolean>): void {
  if (!storage) {
    return;
  }
  const out: Record<string, boolean> = {};
  for (const [projectId, expanded] of Object.entries(state)) {
    if (expanded === true) {
      out[projectId] = true;
    }
  }
  storage.setItem(OLDER_SESSIONS_EXPANDED_KEY, JSON.stringify(out));
}

export function collectArchiveCandidates(input: {
  projects: RegistryProject[];
  sessionsByProjectId: Record<string, RegistryChatSession[]>;
  nowMs: number;
  olderThanDays: number;
}): ArchiveCandidate[] {
  const out: ArchiveCandidate[] = [];
  for (const project of input.projects) {
    const sessions = input.sessionsByProjectId[project.projectId] ?? [];
    for (const session of sessions) {
      if (session.running === true) {
        continue;
      }
      if (!isOlderThanDays(session.updatedAt, input.nowMs, input.olderThanDays)) {
        continue;
      }
      out.push({project, session});
    }
  }
  return out;
}

export function buildArchivedSessionSections<TSession extends ArchivedSessionLike>(input: {
  projects: RegistryProject[];
  archivedByProjectId: Record<string, TSession[]>;
}): Array<ArchivedSessionSection<TSession>> {
  return input.projects
    .map(project => {
      const sessions = input.archivedByProjectId[project.projectId] ?? [];
      if (sessions.length === 0) {
        return null;
      }
      return {
        project,
        rows: sessions.map(session => ({session})),
      };
    })
    .filter((section): section is ArchivedSessionSection<TSession> => section !== null);
}

export function nextArchiveBatchProgress(
  previous: ArchiveBatchProgress,
  result: ArchiveBatchResult,
): ArchiveBatchProgress {
  const currentLabel = archiveCandidateLabel(result.candidate);
  const failures = result.ok
    ? previous.failures
    : [
        ...previous.failures,
        {
          projectName: result.candidate.project.name || result.candidate.project.projectId,
          sessionTitle: sessionTitle(result.candidate.session),
          sessionId: result.candidate.session.sessionId,
          error: result.error || 'Archive failed',
        },
      ];
  return {
    total: previous.total,
    completed: previous.completed + 1,
    archived: previous.archived + (result.ok ? 1 : 0),
    failed: previous.failed + (result.ok ? 0 : 1),
    currentLabel,
    failures,
  };
}

function isOlderThanDays(updatedAt: string | undefined, nowMs: number, days: number): boolean {
  const updatedAtMs = parseUpdatedAtMs(updatedAt ?? '');
  if (updatedAtMs <= 0) {
    return false;
  }
  return nowMs - updatedAtMs > days * DAY_MS;
}

function archiveCandidateLabel(candidate: ArchiveCandidate): string {
  return sessionTitle(candidate.session) || candidate.session.sessionId;
}

function sessionTitle(session: RegistryChatSession): string {
  return session.title || session.sessionId;
}
