import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import {RegistryMethods, RegistryProtocolVersion} from '../web/src/registry/registryMethods';
import {RegistryWorkspaceService} from '../web/src/registry/RegistryWorkspaceService';

describe('web session action protocol', () => {
  test('requests and normalizes status without leaking provider fields', async () => {
    const request = jest.fn().mockResolvedValue({
      payload: {
        ok: true,
        sessionId: 'runtime-thread-must-not-win',
        context: {used: 42000.8, size: 258400.2, updatedAt: '2026-07-14T10:00:00Z', private: true},
        limits: [
          {id: ' codex:primary ', name: 'Five hour', usedPercent: 37.8, remainingPercent: 62.2, windowDurationMins: 300.9, resetsAt: '2026-07-14T12:00:00Z'},
          {id: '', name: 'invalid'},
        ],
        account: {
          planType: 'pro',
          credits: {hasCredits: true, unlimited: false, balance: '12.50'},
          individualLimit: {limit: '100', used: '40', remainingPercent: 60.9, resetsAt: '2026-08-01T00:00:00Z'},
          rateLimitReachedType: 'none',
          rateLimitResetCredits: {availableCount: 3.9},
          providerPrivate: 'hidden',
        },
        updatedAt: '2026-07-14T10:00:01Z',
        runtimeThreadId: 'hidden',
      },
    });
    const repository = new RegistryRepository({request} as never);

    await expect(repository.statusSession('project-a', 'stable-session')).resolves.toEqual({
      ok: true,
      sessionId: 'stable-session',
      context: {used: 42000, size: 258400, updatedAt: '2026-07-14T10:00:00Z'},
      limits: [{
        id: 'codex:primary',
        name: 'Five hour',
        usedPercent: 37,
        remainingPercent: 62,
        windowDurationMins: 300,
        resetsAt: '2026-07-14T12:00:00Z',
      }],
      account: {
        planType: 'pro',
        credits: {hasCredits: true, unlimited: false, balance: '12.50'},
        individualLimit: {limit: '100', used: '40', remainingPercent: 60, resetsAt: '2026-08-01T00:00:00Z'},
        rateLimitReachedType: 'none',
        rateLimitResetCredits: {availableCount: 3},
      },
      updatedAt: '2026-07-14T10:00:01Z',
    });
    expect(request).toHaveBeenCalledWith({
      method: RegistryMethods.SessionStatus,
      projectId: 'project-a',
      payload: {sessionId: 'stable-session'},
      timeoutMs: 30000,
    });
  });

  test('requests compact and preserves the requested stable session ID', async () => {
    const request = jest.fn().mockResolvedValue({
      payload: {ok: true, accepted: true, sessionId: 'runtime-thread', operationId: 'op-1'},
    });
    const repository = new RegistryRepository({request} as never);

    await expect(repository.compactSession('project-a', 'stable-session')).resolves.toEqual({
      ok: true,
      accepted: true,
      sessionId: 'stable-session',
      operationId: 'op-1',
    });
    expect(request).toHaveBeenCalledWith({
      method: RegistryMethods.SessionCompact,
      projectId: 'project-a',
      payload: {sessionId: 'stable-session'},
      timeoutMs: 30000,
    });
    expect(RegistryProtocolVersion).toBe('2.6');
    expect(RegistryMethods.SessionPin).toBe('session.pin');
    expect(RegistryMethods.SessionMark).toBe('session.mark');
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

  test('workspace delegates project-scoped status and compact actions', async () => {
    const repository = {
      statusSession: jest.fn().mockResolvedValue({ok: true, sessionId: 's1', limits: [], updatedAt: ''}),
      compactSession: jest.fn().mockResolvedValue({ok: true, accepted: true, sessionId: 's1', operationId: 'op-1'}),
      pinSession: jest.fn().mockResolvedValue({ok: true, sessionId: 's1', session: {sessionId: 's1', pinned: true}}),
      markSession: jest.fn().mockResolvedValue({ok: true, sessionId: 's1', session: {sessionId: 's1', markColor: 'green'}}),
    };
    const service = new RegistryWorkspaceService();
    Object.assign(service as unknown as {repository: unknown}, {repository});

    await service.statusProjectSession('project-a', 's1');
    await service.compactProjectSession('project-a', 's1');
    await service.pinProjectSession('project-a', 's1', true);
    await service.markProjectSession('project-a', 's1', 'green');

    expect(repository.statusSession).toHaveBeenCalledWith('project-a', 's1');
    expect(repository.compactSession).toHaveBeenCalledWith('project-a', 's1');
    expect(repository.pinSession).toHaveBeenCalledWith('project-a', 's1', true);
    expect(repository.markSession).toHaveBeenCalledWith('project-a', 's1', 'green');
  });
});
