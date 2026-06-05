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

  test('runs tokenStats providers action', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          state: {
            hubId: 'hub-a',
            status: 'ready',
            sections: {
              tokenStats: {
                status: 'ready',
                data: {ok: true, providers: [{id: 'deepseek', name: 'DeepSeek', authMode: 'api_key'}]},
              },
            },
          },
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    const providers = await repository.listTokenProviders('hub-a:project-a');

    expect(providers).toEqual([{id: 'deepseek', name: 'DeepSeek', authMode: 'api_key'}]);
    expect(client.request).toHaveBeenCalledWith({
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {section: 'tokenStats', action: 'providers', params: {}},
      timeoutMs: 60000,
    });
  });

  test('runs tokenStats deepseekStats action', async () => {
    const response = {
      ok: true,
      provider: 'deepseek',
      rangeType: 'month' as const,
      month: '2026-06',
      updatedAt: '2026-06-05T00:00:00Z',
      balance: {isAvailable: true, items: []},
      usage: {rangeType: 'month' as const, month: '2026-06', rows: []},
      usageUnavailable: false,
    };
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          state: {
            hubId: 'hub-a',
            status: 'ready',
            sections: {
              tokenStats: {status: 'ready', data: response},
            },
          },
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    const stats = await repository.fetchDeepSeekTokenStats('hub-a:project-a', {
      apiKey: 'sk-test',
      rangeType: 'month',
      month: '2026-06',
    });

    expect(stats).toEqual(response);
    expect(client.request).toHaveBeenCalledWith({
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {
        section: 'tokenStats',
        action: 'deepseekStats',
        params: {apiKey: 'sk-test', rangeType: 'month', month: '2026-06'},
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
});
