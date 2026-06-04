import {
  OLDER_SESSIONS_EXPANDED_KEY,
  buildArchivedSessionSections,
  collectArchiveCandidates,
  nextArchiveBatchProgress,
  readOlderSessionsExpanded,
  splitOlderProjectSessions,
  writeOlderSessionsExpanded,
} from '../web/src/chat/sessionArchiveState';
import type {RegistryChatSession, RegistryProject} from '../web/src/registry/registryTypes';

function session(sessionId: string, updatedAt: string, flags: Partial<RegistryChatSession> = {}): RegistryChatSession {
  return {
    sessionId,
    title: sessionId,
    preview: '',
    updatedAt,
    messageCount: 0,
    ...flags,
  };
}

const nowMs = Date.parse('2026-06-03T00:00:00.000Z');

const projects: RegistryProject[] = [
  {projectId: 'p1', name: 'One', online: true, path: '/one'},
  {projectId: 'p2', name: 'Two', online: true, path: '/two'},
];

class MemoryStorage {
  values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('session archive state helpers', () => {
  test('collapses multiple older sessions behind one toggle', () => {
    const split = splitOlderProjectSessions({
      sessions: [
        session('recent', '2026-06-02T00:00:00.000Z'),
        session('older-a', '2026-05-20T00:00:00.000Z'),
        session('older-b', '2026-05-19T00:00:00.000Z'),
        session('older-c', '2026-05-18T00:00:00.000Z'),
        session('older-d', '2026-05-17T00:00:00.000Z'),
      ],
      nowMs,
      olderThanDays: 5,
      expanded: false,
    });

    expect(split.visibleSessions.map(item => item.sessionId)).toEqual(['recent', 'older-a', 'older-b']);
    expect(split.hiddenOlderSessions.map(item => item.sessionId)).toEqual(['older-c', 'older-d']);
    expect(split.hiddenOlderCount).toBe(2);
    expect(split.showToggle).toBe(true);
  });

  test('keeps at least three sessions visible before hiding older sessions', () => {
    const split = splitOlderProjectSessions({
      sessions: [
        session('older-a', '2026-05-20T00:00:00.000Z'),
        session('older-b', '2026-05-19T00:00:00.000Z'),
        session('older-c', '2026-05-18T00:00:00.000Z'),
      ],
      nowMs,
      olderThanDays: 5,
      expanded: false,
    });

    expect(split.visibleSessions.map(item => item.sessionId)).toEqual(['older-a', 'older-b', 'older-c']);
    expect(split.hiddenOlderSessions).toEqual([]);
    expect(split.hiddenOlderCount).toBe(0);
    expect(split.showToggle).toBe(false);
  });

  test('keeps a single older session visible', () => {
    const split = splitOlderProjectSessions({
      sessions: [
        session('recent', '2026-06-02T00:00:00.000Z'),
        session('only-old', '2026-05-20T00:00:00.000Z'),
      ],
      nowMs,
      olderThanDays: 5,
      expanded: false,
    });

    expect(split.visibleSessions.map(item => item.sessionId)).toEqual(['recent', 'only-old']);
    expect(split.hiddenOlderCount).toBe(0);
    expect(split.showToggle).toBe(false);
  });

  test('persists older expanded state and ignores invalid storage JSON', () => {
    const storage = new MemoryStorage();

    storage.setItem(OLDER_SESSIONS_EXPANDED_KEY, '{bad json');
    expect(readOlderSessionsExpanded(storage)).toEqual({});

    writeOlderSessionsExpanded(storage, {p1: true, p2: false});
    expect(readOlderSessionsExpanded(storage)).toEqual({p1: true});
  });

  test('collects archive candidates from all projects and skips running or invalid sessions', () => {
    const candidates = collectArchiveCandidates({
      projects,
      sessionsByProjectId: {
        p1: [
          session('old', '2026-05-20T00:00:00.000Z'),
          session('running-old', '2026-05-20T00:00:00.000Z', {running: true}),
          session('invalid', 'not-a-date'),
        ],
        p2: [session('hidden-project-old', '2026-05-19T00:00:00.000Z')],
      },
      nowMs,
      olderThanDays: 7,
    });

    expect(candidates.map(item => `${item.project.projectId}:${item.session.sessionId}`)).toEqual([
      'p1:old',
      'p2:hidden-project-old',
    ]);
  });

  test('builds archived sections in project order and drops empty projects', () => {
    const sections = buildArchivedSessionSections({
      projects,
      archivedByProjectId: {
        p2: [{sessionId: 'archived-2', archivedAt: '2026-05-21T00:00:00.000Z'}],
        p1: [],
      },
    });

    expect(sections).toHaveLength(1);
    expect(sections[0].project.projectId).toBe('p2');
    expect(sections[0].rows.map(row => row.session.sessionId)).toEqual(['archived-2']);
  });

  test('advances archive progress without stopping on failures', () => {
    const candidate = {project: projects[0], session: session('old', '2026-05-20T00:00:00.000Z')};
    const first = nextArchiveBatchProgress(
      {total: 2, completed: 0, archived: 0, failed: 0, failures: []},
      {candidate, ok: true},
    );
    const second = nextArchiveBatchProgress(first, {candidate, ok: false, error: 'denied'});

    expect(second).toEqual({
      total: 2,
      completed: 2,
      archived: 1,
      failed: 1,
      currentLabel: 'old',
      failures: [{projectName: 'One', sessionTitle: 'old', sessionId: 'old', error: 'denied'}],
    });
  });
});
