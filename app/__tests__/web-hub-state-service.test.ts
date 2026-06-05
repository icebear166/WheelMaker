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
});
