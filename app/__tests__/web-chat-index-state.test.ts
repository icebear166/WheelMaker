import {
  classifyChatSessionEvent,
  createChatIndexState,
  finishChatIndexFullRefresh,
  finishChatIndexProjectRefresh,
  mergeChatSessionList,
  mergeChatIndexSession,
  requestChatIndexFullRefresh,
  requestChatIndexProjectRefresh,
  shouldUpdateCurrentProjectSessions,
  sortChatIndexProjects,
} from '../web/src/chat/session/chatIndexState';
import type { RegistryChatSession, RegistryProject } from '../web/src/registry/registryTypes';

function project(projectId: string, name: string): RegistryProject {
  return {
    projectId,
    name,
    online: true,
    path: `/${projectId}`,
  };
}

function session(sessionId: string, updatedAt: string): RegistryChatSession {
  return {
    sessionId,
    title: sessionId,
    preview: '',
    updatedAt,
    messageCount: 1,
  };
}

describe('chat index state helpers', () => {
  test('sorts projects by pinned, recent chat activity, then name', () => {
    const projects = [
      project('p-old', 'Beta'),
      project('p-new', 'Alpha'),
      project('p-pinned', 'Pinned'),
      project('p-empty', 'Aardvark'),
    ];
    const sorted = sortChatIndexProjects(
      projects,
      {
        'p-old': [session('old', '2026-01-01T00:00:00.000Z')],
        'p-new': [session('new', '2026-05-01T00:00:00.000Z')],
        'p-pinned': [session('pinned', '2025-01-01T00:00:00.000Z')],
      },
      ['p-pinned'],
    );

    expect(sorted.map(item => item.projectId)).toEqual([
      'p-pinned',
      'p-new',
      'p-old',
      'p-empty',
    ]);
  });

  test('patches or inserts session summaries for a known project', () => {
    const state = {
      ...createChatIndexState(),
      projects: [project('p1', 'Project 1')],
    };
    const inserted = mergeChatIndexSession(state, 'p1', session('s1', '2026-01-01T00:00:00.000Z'));
    const patched = mergeChatIndexSession(inserted, 'p1', {
      sessionId: 's1',
      preview: 'new preview',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    expect(inserted.sessionsByProjectId.p1[0].sessionId).toBe('s1');
    expect(patched.sessionsByProjectId.p1[0]).toMatchObject({
      sessionId: 's1',
      title: 's1',
      preview: 'new preview',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  test('preserves config options, commands, and usage when refreshed session list omits them', () => {
    const existing: RegistryChatSession[] = [
      {
        ...session('s1', '2026-01-02T00:00:00.000Z'),
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            currentValue: 'gpt-5.3-codex',
            options: [{ value: 'gpt-5.3-codex', name: 'GPT 5.3 Codex' }],
          },
        ],
        commands: [{ name: '/plan', description: 'Plan' }],
        usage: { used: 19000, size: 258000, updatedAt: '2026-07-07T08:00:00.000Z' },
      },
    ];

    const merged = mergeChatSessionList(existing, [
      {
        ...session('s1', '2026-01-03T00:00:00.000Z'),
        preview: 'new preview',
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      sessionId: 's1',
      preview: 'new preview',
      updatedAt: '2026-01-03T00:00:00.000Z',
      configOptions: existing[0].configOptions,
      commands: existing[0].commands,
      usage: existing[0].usage,
    });
  });

  test('keeps session order when merged summaries do not change updatedAt', () => {
    const existing = [
      session('s-a', '2026-05-01T00:00:00.000Z'),
      session('s-b', '2026-05-01T00:00:00.000Z'),
      session('s-c', '2026-05-01T00:00:00.000Z'),
    ];
    const merged = mergeChatSessionList(existing, [
      {...session('s-c', '2026-05-01T00:00:00.000Z'), preview: 'new preview'},
      session('s-b', '2026-05-01T00:00:00.000Z'),
      session('s-a', '2026-05-01T00:00:00.000Z'),
    ]);

    expect(merged.map(item => item.sessionId)).toEqual(['s-a', 's-b', 's-c']);
    expect(merged[2].preview).toBe('new preview');
  });

  test('re-sorts when a merged summary changes updatedAt', () => {
    const existing = [
      session('s-top', '2026-05-01T00:00:00.000Z'),
      session('s-low', '2026-03-01T00:00:00.000Z'),
    ];
    const merged = mergeChatSessionList(existing, [
      session('s-top', '2026-05-01T00:00:00.000Z'),
      session('s-low', '2026-06-01T00:00:00.000Z'),
    ]);

    expect(merged.map(item => item.sessionId)).toEqual(['s-low', 's-top']);
  });

  test('mergeChatIndexSession keeps position when updatedAt is unchanged', () => {
    const state = {
      ...createChatIndexState(),
      projects: [project('p1', 'Project 1')],
      sessionsByProjectId: {
        p1: [
          session('s-a', '2026-05-01T00:00:00.000Z'),
          session('s-b', '2026-05-01T00:00:00.000Z'),
        ],
      },
    };
    const patched = mergeChatIndexSession(state, 'p1', {
      sessionId: 's-b',
      preview: 'patched',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });

    expect(patched.sessionsByProjectId.p1.map(item => item.sessionId)).toEqual(['s-a', 's-b']);
    expect(patched.sessionsByProjectId.p1[1].preview).toBe('patched');
  });

  test('classifies session events without falling back to workspace project', () => {
    const state = mergeChatIndexSession(
      {
        ...createChatIndexState(),
        projects: [project('p1', 'Project 1')],
      },
      'p1',
      session('known', '2026-01-01T00:00:00.000Z'),
    );

    expect(classifyChatSessionEvent(state, {
      method: 'session.updated',
      projectId: 'p1',
      payload: { session: session('new', '2026-01-02T00:00:00.000Z') },
    })).toEqual({
      kind: 'patch',
      projectId: 'p1',
      session: session('new', '2026-01-02T00:00:00.000Z'),
    });

    expect(classifyChatSessionEvent(state, {
      method: 'session.message',
      projectId: 'p1',
      payload: { sessionId: 'unknown', turnIndex: 1, content: 'hello' },
    })).toEqual({ kind: 'refreshProject', projectId: 'p1' });

    expect(classifyChatSessionEvent(state, {
      method: 'session.updated',
      projectId: 'missing',
      payload: { session: session('new', '2026-01-02T00:00:00.000Z') },
    })).toEqual({ kind: 'refreshAll' });

    expect(classifyChatSessionEvent(state, {
      method: 'session.updated',
      payload: { session: session('new', '2026-01-02T00:00:00.000Z') },
    })).toEqual({ kind: 'ignore' });
  });

  test('coalesces full and project refresh requests', () => {
    let state = createChatIndexState();

    state = requestChatIndexFullRefresh(state);
    state = requestChatIndexFullRefresh(state);
    expect(state.refresh.fullRefreshInFlight).toBe(true);
    expect(state.refresh.fullRefreshDirty).toBe(true);

    state = finishChatIndexFullRefresh(state);
    expect(state.refresh.fullRefreshInFlight).toBe(true);
    expect(state.refresh.fullRefreshDirty).toBe(false);

    state = finishChatIndexFullRefresh(state);
    expect(state.refresh.fullRefreshInFlight).toBe(false);

    state = requestChatIndexProjectRefresh(state, 'p1');
    state = requestChatIndexProjectRefresh(state, 'p1');
    expect(state.refresh.projectRefreshInFlight.p1).toBe(true);
    expect(state.refresh.projectRefreshDirty.p1).toBe(true);

    state = finishChatIndexProjectRefresh(state, 'p1', 'failed');
    expect(state.refresh.projectRefreshInFlight.p1).toBe(true);
    expect(state.refresh.projectRefreshDirty.p1).toBe(false);
    expect(state.refresh.projectErrors.p1).toBe('failed');

    state = finishChatIndexProjectRefresh(state, 'p1');
    expect(state.refresh.projectRefreshInFlight.p1).toBe(false);
    expect(state.refresh.projectErrors.p1).toBeUndefined();
  });

  test('updates legacy current-project sessions only for the workspace project', () => {
    expect(shouldUpdateCurrentProjectSessions('p1', 'p1')).toBe(true);
    expect(shouldUpdateCurrentProjectSessions('p-selected', 'p-workspace')).toBe(false);
    expect(shouldUpdateCurrentProjectSessions('', 'p-workspace')).toBe(false);
  });
});
