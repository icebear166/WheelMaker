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
  });

  test('workspace delegates project-scoped status and compact actions', async () => {
    const repository = {
      statusSession: jest.fn().mockResolvedValue({ok: true, sessionId: 's1', limits: [], updatedAt: ''}),
      compactSession: jest.fn().mockResolvedValue({ok: true, accepted: true, sessionId: 's1', operationId: 'op-1'}),
    };
    const service = new RegistryWorkspaceService();
    Object.assign(service as unknown as {repository: unknown}, {repository});

    await service.statusProjectSession('project-a', 's1');
    await service.compactProjectSession('project-a', 's1');

    expect(repository.statusSession).toHaveBeenCalledWith('project-a', 's1');
    expect(repository.compactSession).toHaveBeenCalledWith('project-a', 's1');
  });
});
