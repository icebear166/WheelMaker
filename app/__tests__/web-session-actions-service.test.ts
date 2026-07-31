import fs from 'fs';
import path from 'path';

import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import {RegistryMethods, RegistryProtocolVersion} from '../web/src/registry/registryMethods';
import {RegistryWorkspaceService} from '../web/src/registry/RegistryWorkspaceService';

describe('web session action protocol', () => {
  test('requests and normalizes status without leaking provider fields', async () => {
    const request = jest.fn().mockResolvedValue({
      payload: {
        ok: true,
        sessionId: 'runtime-thread-must-not-win',
        agentType: ' codex ',
        context: {used: 42000.8, size: 258400.2, updatedAt: '2026-07-14T10:00:00Z', private: true},
        limits: [],
        updatedAt: '',
        runtimeThreadId: 'hidden',
      },
    });
    const repository = new RegistryRepository({request} as never);

    await expect(repository.statusSession('project-a', 'stable-session')).resolves.toEqual({
      ok: true,
      sessionId: 'stable-session',
      agentType: 'codex',
      context: {used: 42000, size: 258400, updatedAt: '2026-07-14T10:00:00Z'},
      limits: [],
      account: undefined,
      updatedAt: '',
    });
    expect(request).toHaveBeenCalledWith({
      method: RegistryMethods.SessionStatus,
      projectId: 'project-a',
      payload: {sessionId: 'stable-session'},
      timeoutMs: 30000,
    });
  });

  test('uses one session.queue method for every queue action', async () => {
    const request = jest.fn().mockResolvedValue({
      payload: {
        ok: true,
        sessionId: 'runtime-thread',
        session: {
          sessionId: 'stable-session',
          title: 'Queue',
          updatedAt: '2026-07-31T10:00:00Z',
          queue: {
            generation: 'generation-1',
            revision: 3.9,
            activeKind: 'prompt',
            waitingCount: 1.8,
            waitingItems: [{
              itemId: 'item-1',
              kind: 'prompt',
              status: 'queued',
              createdAt: '2026-07-31T10:00:00Z',
              blocks: [{type: 'text', text: 'hello'}],
              cancelSupported: true,
            }],
          },
        },
      },
    });
    const repository = new RegistryRepository({request} as never);

    await repository.mutateSessionQueue('project-a', {
      sessionId: 'stable-session',
      action: 'enqueue',
      item: {
        itemId: 'item-1',
        kind: 'prompt',
        createdAt: '2026-07-31T10:00:00Z',
        blocks: [{type: 'text', text: 'hello'}],
      },
    });
    for (const action of ['cancel', 'prioritize', 'steer'] as const) {
      await repository.mutateSessionQueue('project-a', {
        sessionId: 'stable-session',
        action,
        itemId: 'item-1',
      });
    }

    expect(request.mock.calls.map(([input]) => [input.method, input.payload])).toEqual([
      ['session.queue', expect.objectContaining({sessionId: 'stable-session', action: 'enqueue'})],
      ['session.queue', {sessionId: 'stable-session', action: 'cancel', itemId: 'item-1'}],
      ['session.queue', {sessionId: 'stable-session', action: 'prioritize', itemId: 'item-1'}],
      ['session.queue', {sessionId: 'stable-session', action: 'steer', itemId: 'item-1'}],
    ]);
    await expect(repository.mutateSessionQueue('project-a', {
      sessionId: 'stable-session',
      action: 'cancel',
      itemId: 'item-1',
    })).resolves.toMatchObject({
      ok: true,
      sessionId: 'stable-session',
      session: {
        queue: {
          generation: 'generation-1',
          revision: 3,
          waitingCount: 1,
        },
      },
    });
    expect(RegistryProtocolVersion).toBe('2.6');
    expect(RegistryMethods.SessionQueue).toBe('session.queue');
    expect(RegistryMethods).not.toHaveProperty('SessionSend');
    expect(RegistryMethods).not.toHaveProperty('SessionCompact');
    expect(RegistryMethods).not.toHaveProperty('SessionCancel');
    expect(RegistryMethods).not.toHaveProperty('SessionSteer');
    expect(RegistryMethods.SessionPin).toBe('session.pin');
    expect(RegistryMethods.SessionMark).toBe('session.mark');
  });

  test('allows session fork requests the same long timeout as session creation', async () => {
    const request = jest.fn().mockResolvedValue({
      payload: {
        ok: true,
        session: {
          sessionId: 'forked-session',
          title: 'Forked session',
          preview: '',
          updatedAt: '',
          messageCount: 1,
        },
      },
    });
    const repository = new RegistryRepository({request} as never);

    await repository.forkSession('project-a', 'source-session', 7);

    expect(request).toHaveBeenCalledWith({
      method: RegistryMethods.SessionFork,
      projectId: 'project-a',
      payload: {sessionId: 'source-session', turnIndex: 7},
      timeoutMs: 120000,
    });
  });

  test('warns that a timed out session fork may still complete', () => {
    const projectRoot = path.join(__dirname, '..');
    const workspaceSource = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(workspaceSource).toContain(
      'Session branch request timed out; creation may still complete in the background. Check the session list before retrying.',
    );
  });

  test('requests session pin and normalizes shared pin state', async () => {
    const request = jest.fn().mockResolvedValue({
      payload: {
        ok: true,
        sessionId: 's1',
        session: {
          sessionId: 's1',
          title: 'One',
          preview: '',
          updatedAt: '2026-07-22T10:00:00Z',
          messageCount: 1,
          pinned: true,
        },
      },
    });
    const repository = new RegistryRepository({request} as never);

    const result = await repository.pinSession('project-a', 's1', true);

    expect(request).toHaveBeenCalledWith({
      method: RegistryMethods.SessionPin,
      projectId: 'project-a',
      payload: {sessionId: 's1', pinned: true},
      timeoutMs: 15000,
    });
    expect(result.session.pinned).toBe(true);
  });

  test('defaults a missing session pin field to false', async () => {
    const request = jest.fn().mockResolvedValue({
      payload: {
        ok: true,
        session: {
          sessionId: 's1',
          title: 'One',
          preview: '',
          updatedAt: '2026-07-22T10:00:00Z',
          messageCount: 1,
        },
      },
    });
    const repository = new RegistryRepository({request} as never);

    const result = await repository.pinSession('project-a', 's1', false);

    expect(result.session.pinned).toBe(false);
  });

  test('requests session mark and normalizes the four shared colors', async () => {
    const request = jest.fn().mockResolvedValue({
      payload: {
        ok: true,
        sessionId: 's1',
        session: {
          sessionId: 's1',
          title: 'One',
          preview: '',
          updatedAt: '2026-07-26T10:00:00Z',
          messageCount: 1,
          pinned: false,
          markColor: 'blue',
        },
      },
    });
    const repository = new RegistryRepository({request} as never);

    const result = await repository.markSession('project-a', 's1', 'blue');

    expect(request).toHaveBeenCalledWith({
      method: RegistryMethods.SessionMark,
      projectId: 'project-a',
      payload: {sessionId: 's1', markColor: 'blue'},
      timeoutMs: 15000,
    });
    expect(result.session.markColor).toBe('blue');
    expect(result.session.pinned).toBe(false);
    expect(RegistryProtocolVersion).toBe('2.6');
  });

  test('normalizes cleared and unknown session marks to undefined', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({
        payload: {
          ok: true,
          session: {sessionId: 's1', title: 'One', preview: '', updatedAt: '', messageCount: 1},
        },
      })
      .mockResolvedValueOnce({
        payload: {
          ok: true,
          session: {sessionId: 's1', title: 'One', preview: '', updatedAt: '', messageCount: 1, markColor: 'purple'},
        },
      });
    const repository = new RegistryRepository({request} as never);

    await expect(repository.markSession('project-a', 's1', '')).resolves.toMatchObject({
      session: {markColor: undefined},
    });
    await expect(repository.markSession('project-a', 's1', 'red')).resolves.toMatchObject({
      session: {markColor: undefined},
    });
  });

  test('workspace delegates named queue actions to one repository mutation', async () => {
    const repository = {
      statusSession: jest.fn().mockResolvedValue({ok: true, sessionId: 's1', limits: [], updatedAt: ''}),
      mutateSessionQueue: jest.fn().mockResolvedValue({ok: true, sessionId: 's1', session: {sessionId: 's1'}}),
      pinSession: jest.fn().mockResolvedValue({ok: true, sessionId: 's1', session: {sessionId: 's1', pinned: true}}),
      markSession: jest.fn().mockResolvedValue({ok: true, sessionId: 's1', session: {sessionId: 's1', markColor: 'green'}}),
    };
    const service = new RegistryWorkspaceService();
    Object.assign(service as unknown as {repository: unknown}, {repository});

    await service.statusProjectSession('project-a', 's1');
    await service.enqueueProjectSessionItem('project-a', 's1', {
      itemId: 'item-1',
      kind: 'compact',
      createdAt: '2026-07-31T10:00:00Z',
    });
    await service.cancelProjectSessionQueueItem('project-a', 's1', 'item-1');
    await service.prioritizeProjectSessionQueueItem('project-a', 's1', 'item-1');
    await service.steerProjectSessionQueueItem('project-a', 's1', 'item-1');
    await service.pinProjectSession('project-a', 's1', true);
    await service.markProjectSession('project-a', 's1', 'green');

    expect(repository.statusSession).toHaveBeenCalledWith('project-a', 's1');
    expect(repository.mutateSessionQueue.mock.calls).toEqual([
      ['project-a', {sessionId: 's1', action: 'enqueue', item: expect.objectContaining({itemId: 'item-1'})}],
      ['project-a', {sessionId: 's1', action: 'cancel', itemId: 'item-1'}],
      ['project-a', {sessionId: 's1', action: 'prioritize', itemId: 'item-1'}],
      ['project-a', {sessionId: 's1', action: 'steer', itemId: 'item-1'}],
    ]);
    expect(repository.pinSession).toHaveBeenCalledWith('project-a', 's1', true);
    expect(repository.markSession).toHaveBeenCalledWith('project-a', 's1', 'green');
  });
});
