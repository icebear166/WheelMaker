import {
  buildSessionSearchFilter,
  isSessionSearchPollingReady,
  mergeSessionSearchResultsByProject,
  resolveSessionSearchPollDelay,
  resolveSessionSearchProjects,
} from '../web/src/chat/session/sessionSearchState';
import type {RegistryChatSession, RegistryProject, RegistrySessionSearchResult} from '../web/src/registry/registryTypes';

function session(sessionId: string, title: string): RegistryChatSession {
  return {
    sessionId,
    title,
    preview: '',
    updatedAt: '',
    messageCount: 0,
  };
}

const projects: RegistryProject[] = [
  {projectId: 'p1', name: 'One', online: true, path: '/one'},
  {projectId: 'p2', name: 'Two', online: true, path: '/two'},
];

describe('session search state helpers', () => {
  test('does not poll until the active search start has completed', () => {
    expect(isSessionSearchPollingReady('search-1', '')).toBe(false);
    expect(isSessionSearchPollingReady('search-1', 'search-2')).toBe(false);
    expect(isSessionSearchPollingReady('', 'search-1')).toBe(false);
    expect(isSessionSearchPollingReady('search-1', 'search-1')).toBe(true);
  });

  test('resolves all visible projects or one selected visible project', () => {
    expect(resolveSessionSearchProjects(projects, '')).toEqual(projects);
    expect(resolveSessionSearchProjects(projects, 'p2')).toEqual([projects[1]]);
    expect(resolveSessionSearchProjects(projects, 'hidden')).toEqual([]);
  });

  test('backs off polling after three unchanged query responses', () => {
    expect(resolveSessionSearchPollDelay({changed: true, unchangedPolls: 0})).toBe(300);
    expect(resolveSessionSearchPollDelay({changed: false, unchangedPolls: 2})).toBe(300);
    expect(resolveSessionSearchPollDelay({changed: false, unchangedPolls: 3})).toBe(800);
  });

  test('compares result sets by session identity rather than match metadata', () => {
    const first: RegistrySessionSearchResult[] = [
      {projectId: 'p1', sessionId: 's1', source: 'title'},
    ];
    const second: RegistrySessionSearchResult[] = [
      {projectId: 'p1', sessionId: 's1', source: 'prompt', turnIndex: 7},
    ];

    const afterFirst = mergeSessionSearchResultsByProject({}, 'p1', first);
    const afterSame = mergeSessionSearchResultsByProject(afterFirst.resultsByProjectId, 'p1', first);
    const afterSecond = mergeSessionSearchResultsByProject(afterFirst.resultsByProjectId, 'p1', second);

    expect(afterFirst.changed).toBe(true);
    expect(afterSame.changed).toBe(false);
    expect(afterSecond.changed).toBe(false);
    expect(afterSecond.resultsByProjectId).toBe(afterFirst.resultsByProjectId);
  });

  test('builds one filtered row per session in normal project and session order', () => {
    const filtered = buildSessionSearchFilter({
      projects,
      sessionsByProjectId: {
        p1: [session('s2', 'Second'), session('s1', 'First')],
        p2: [session('s3', 'Third')],
      },
      resultsByProjectId: {
        p1: [
          {projectId: 'p1', sessionId: 's1', source: 'title'},
          {projectId: 'p1', sessionId: 's2', source: 'prompt', turnIndex: 4},
          {projectId: 'p1', sessionId: 's2', source: 'title'},
        ],
        p2: [],
      },
    });

    expect(filtered.projects.map(project => project.projectId)).toEqual(['p1']);
    expect(filtered.sessionsByProjectId.p1.map(item => item.sessionId)).toEqual(['s2', 's1']);
    expect(filtered.sessionsByProjectId.p2).toEqual([]);
  });
});
