import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import type {RegistryClient} from '../web/src/registry/RegistryClient';
import {RegistryMethods} from '../web/src/registry/registryMethods';

describe('hub state registry service', () => {
  test('gets hub state with envelope hubId', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          state: {hubId: 'hub-a', status: 'empty', sections: {}},
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    const state = await repository.getHubState('hub-a', ['agentPackages']);

    expect(state.hubId).toBe('hub-a');
    expect(client.request).toHaveBeenCalledWith({
      method: RegistryMethods.HubStateGet,
      hubId: 'hub-a',
      payload: {sections: ['agentPackages']},
      timeoutMs: 15000,
    });
  });

  test('refreshes selected hub state sections', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          state: {hubId: 'hub-a', status: 'refreshing', sections: {}},
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    await repository.refreshHubState('hub-a', ['tokenStats'], {force: true});

    expect(client.request).toHaveBeenCalledWith({
      method: RegistryMethods.HubStateRefresh,
      hubId: 'hub-a',
      payload: {sections: ['tokenStats'], force: true},
      timeoutMs: 60000,
    });
  });

  test('runs hub state section action', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          state: {hubId: 'hub-a', status: 'ready', sections: {}},
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    await repository.runHubStateAction('hub-a', 'agentPackages', 'install', {
      packageName: '@openai/codex',
      version: 'latest',
    });

    expect(client.request).toHaveBeenCalledWith({
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {
        section: 'agentPackages',
        action: 'install',
        params: {packageName: '@openai/codex', version: 'latest'},
      },
      timeoutMs: 60000,
    });
  });

  test('normalizes malformed hub state sections', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          state: {
            hubId: 'hub-a',
            status: 'ready',
            sections: {
              tokenStats: null,
              skills: {data: {ok: true}},
              fileIndex: {status: 123, error: 5},
            },
          },
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    const state = await repository.getHubState('hub-a');

    expect(state.sections.tokenStats.status).toBe('empty');
    expect(state.sections.skills.status).toBe('empty');
    expect(state.sections.skills.data).toEqual({ok: true});
    expect(state.sections.fileIndex.status).toBe('empty');
    expect(state.sections.fileIndex.error).toBeUndefined();
  });

  test('gets and normalizes compact usage history samples', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          hubId: 'hub-a',
          providerId: 'codex',
          accountLocalId: 'current',
          limits: [{
            id: 'week',
            label: 'W',
            windowKind: 'fixed',
            windowDurationMins: 10080,
            resetsAt: '2026-08-01T00:00:00Z',
            samples: [[1722124800000, 80], [1722125400000, 78.5]],
          }],
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    const history = await repository.getUsageHistory('hub-a', 'codex', 'current');

    expect(history.limits[0].samples).toEqual([
      {observedAtMillis: 1722124800000, remainingPercent: 80},
      {observedAtMillis: 1722125400000, remainingPercent: 78.5},
    ]);
    expect(client.request).toHaveBeenCalledWith({
      method: 'usage.history.get',
      hubId: 'hub-a',
      payload: {providerId: 'codex', accountLocalId: 'current'},
      timeoutMs: 15000,
    });
  });

  test('rejects malformed compact usage history samples', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          hubId: 'hub-a',
          providerId: 'codex',
          accountLocalId: 'current',
          limits: [{
            id: 'week',
            label: 'W',
            windowKind: 'fixed',
            windowDurationMins: 10080,
            resetsAt: '2026-08-01T00:00:00Z',
            samples: [[1722124800000, 101]],
          }],
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    await expect(repository.getUsageHistory('hub-a', 'codex', 'current'))
      .rejects.toThrow('invalid usage history response');
  });
});
