import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import type {RegistryClient} from '../web/src/registry/RegistryClient';
import {RegistryMethods} from '../web/src/registry/registryMethods';

describe('skill management registry service', () => {
  test('refreshes skills HubState section with hubId and bounded timeout', async () => {
    const client = {
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
    const repository = new RegistryRepository(client);

    await repository.scanSkills('hub-a');

    expect(client.request).toHaveBeenCalledWith({
      method: RegistryMethods.HubStateRefresh,
      hubId: 'hub-a',
      payload: {sections: ['skills']},
      timeoutMs: 60000,
    });
  });

  test('runs skills source list HubState action with controlled source payload', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          state: {
            hubId: 'hub-a',
            status: 'ready',
            sections: {
              skills: {
                status: 'ready',
                data: {ok: true, hubId: 'hub-a', source: 'mattpocock/skills', candidates: []},
              },
            },
          },
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    await repository.listSkillsSource('hub-a', 'mattpocock/skills');

    expect(client.request).toHaveBeenCalledWith({
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {section: 'skills', action: 'listSource', params: {source: 'mattpocock/skills'}},
      timeoutMs: 60000,
    });
  });

  test('runs skills reindex HubState action for one hub', async () => {
    const client = {
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
    const repository = new RegistryRepository(client);

    await repository.reindexSkills('hub-a');

    expect(client.request).toHaveBeenCalledWith({
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {section: 'skills', action: 'reindex', params: {}},
      timeoutMs: 60000,
    });
  });

  test('sends install uninstall and update without paths or raw args', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          state: {
            hubId: 'hub-a',
            status: 'ready',
            sections: {
              skills: {
                status: 'ready',
                data: {ok: true, hubId: 'hub-a', skills: []},
              },
            },
          },
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    await repository.installSkills({
      hubId: 'hub-a',
      scope: 'project',
      projectName: 'WheelMaker',
      source: 'mattpocock/skills',
      skills: ['tdd'],
    });
    await repository.uninstallSkills({hubId: 'hub-a', scope: 'hub', skills: ['tdd']});
    await repository.updateSkills({hubId: 'hub-a', scope: 'project', projectName: 'WheelMaker'});
    await repository.updateSkills({hubId: 'hub-a', scope: 'hub'});
    await repository.getSkillDetail({hubId: 'hub-a', scope: 'hub', skillName: 'tdd'});

    expect(client.request).toHaveBeenNthCalledWith(1, {
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {
        action: 'install',
        section: 'skills',
        params: {
          scope: 'project',
          projectName: 'WheelMaker',
          source: 'mattpocock/skills',
          skills: ['tdd'],
        },
      },
      timeoutMs: 60000,
    });
    expect(client.request).toHaveBeenNthCalledWith(2, {
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {section: 'skills', action: 'uninstall', params: {scope: 'hub', skills: ['tdd']}},
      timeoutMs: 60000,
    });
    expect(client.request).toHaveBeenNthCalledWith(3, {
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {section: 'skills', action: 'update', params: {scope: 'project', projectName: 'WheelMaker'}},
      timeoutMs: 60000,
    });
    expect(client.request).toHaveBeenNthCalledWith(4, {
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {section: 'skills', action: 'update', params: {scope: 'hub'}},
      timeoutMs: 60000,
    });
    expect(client.request).toHaveBeenNthCalledWith(5, {
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {section: 'skills', action: 'detail', params: {scope: 'hub', skillName: 'tdd'}},
      timeoutMs: 60000,
    });
  });

  test('routes source previews and apply through the existing Skills HubState action', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {result: {ok: true, hubId: 'hub-a', preview: {id: 'preview-1'}}},
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);
    const target = {
      hubId: 'hub-a', scope: 'project' as const, projectName: 'WheelMaker',
      source: 'https://github.com/example/catalog.git', ref: 'main',
    };

    await repository.previewSkillSource(target);
    await repository.previewSkillInstall({...target, skills: ['alpha']});
    await repository.previewSkillUpdate(target);
    await repository.previewSkillDeleteSource(target);
    await repository.applySkillPreview('hub-a', 'preview-1');

    const params = {
      scope: 'project', projectName: 'WheelMaker',
      source: 'https://github.com/example/catalog.git', ref: 'main',
    };

    for (const [index, action] of ['previewSource', 'previewInstall', 'previewUpdate', 'previewDeleteSource'].entries()) {
      expect(client.request).toHaveBeenNthCalledWith(index + 1, {
        method: RegistryMethods.HubStateAction,
        hubId: 'hub-a',
        payload: {
          section: 'skills', action,
          params: index === 1 ? {...params, skills: ['alpha']} : params,
        },
        timeoutMs: 60000,
      });
    }
    expect(client.request).toHaveBeenNthCalledWith(5, {
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {section: 'skills', action: 'applyPreview', params: {previewId: 'preview-1'}},
      timeoutMs: 60000,
    });
  });
});
