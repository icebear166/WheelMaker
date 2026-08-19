import type {RegistryClient} from '../web/src/registry/RegistryClient';
import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import {RegistryMethods} from '../web/src/registry/registryMethods';

function createClient(): RegistryClient {
  return {
    request: jest.fn().mockResolvedValue({
      type: 'response',
      payload: {
        state: {
          hubId: 'hub-a',
          status: 'ready',
          sections: {
            skills: {
              status: 'ready',
              data: {ok: true, hubId: 'hub-a', hubSkills: {scope: 'hub', skills: []}, projects: []},
            },
          },
        },
      },
    }),
  } as unknown as RegistryClient;
}

describe('skill management registry service', () => {
  test.each([
    {
      name: 'refreshes skills state',
      action: 'scanSkills',
      run: (repository: RegistryRepository) => repository.scanSkills('hub-a'),
      expected: {
        method: RegistryMethods.HubStateRefresh,
        hubId: 'hub-a',
        payload: {sections: ['skills']},
        timeoutMs: 60000,
      },
    },
    {
      name: 'reindexes one hub',
      action: 'reindexSkills',
      run: (repository: RegistryRepository) => repository.reindexSkills('hub-a'),
      expected: {
        method: RegistryMethods.HubStateAction,
        hubId: 'hub-a',
        payload: {section: 'skills', action: 'reindex', params: {}},
        timeoutMs: 60000,
      },
    },
  ])('$name', async ({run, expected}) => {
    const client = createClient();
    await run(new RegistryRepository(client));
    expect(client.request).toHaveBeenCalledWith(expected);
  });
});
