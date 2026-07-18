import fs from 'fs';
import path from 'path';
import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import type {RegistryClient} from '../web/src/registry/RegistryClient';
import {RegistryMethods} from '../web/src/registry/registryMethods';

describe('agent package update registry service', () => {
  test('reads registry project list hubs without depending on online state', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          projects: [{projectId: 'hub-b:app', name: 'app', online: true, path: '/app'}],
          hubs: [{hubId: 'hub-b', online: true}, {hubId: ' '}],
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    const result = await repository.listProjectSnapshot();

    expect(result.projects).toEqual([
      expect.objectContaining({projectId: 'hub-b:app', hubId: 'hub-b'}),
    ]);
    expect(result.hubs).toEqual([{hubId: 'hub-b'}]);
    expect(client.request).toHaveBeenCalledWith({
      method: RegistryMethods.RegistryProjectList,
      payload: {},
    });
  });

  test('refreshes agentPackages HubState section with hubId and 60 second timeout', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          state: {
            hubId: 'hub-b',
            status: 'ready',
            sections: {
              agentPackages: {
                status: 'ready',
                data: {
                  ok: true,
                  updatedAt: '2026-05-19T10:00:00Z',
                  hub: {hubId: 'hub-b', packages: []},
                  operation: null,
                },
              },
            },
          },
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    const result = await repository.scanNpmPackages('hub-b');

    expect(result.ok).toBe(true);
    expect(client.request).toHaveBeenCalledWith({
      method: RegistryMethods.HubStateRefresh,
      hubId: 'hub-b',
      payload: {sections: ['agentPackages']},
      timeoutMs: 60000,
    });
  });

  test('normalizes nullable package agent types from deprecated package rows', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          state: {
            hubId: 'hub-b',
            status: 'ready',
            sections: {
              agentPackages: {
                status: 'ready',
                data: {
                  ok: true,
                  updatedAt: '2026-05-19T10:00:00Z',
                  hub: {
                    hubId: 'hub-b',
                    packages: [{
                      packageName: '@zed-industries/codex-acp',
                      displayName: 'Deprecated Codex ACP',
                      agentTypes: null,
                      kind: 'deprecated',
                      installed: true,
                      installedVersion: '0.1.0',
                      latestVersion: '',
                      status: 'deprecated',
                      error: '',
                      canInstall: false,
                      canUpdate: false,
                      canUninstall: true,
                    }],
                  },
                  operation: null,
                },
              },
            },
          },
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    const result = await repository.scanNpmPackages('hub-b');

    expect(result.hub?.packages[0].agentTypes).toEqual([]);
  });

  test('runs agentPackages HubState actions with controlled payloads', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          state: {
            hubId: 'hub-a',
            status: 'ready',
            sections: {
              agentPackages: {
                status: 'ready',
                data: {ok: true, accepted: true, operation: null},
              },
            },
          },
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    await repository.installNpmPackage('hub-a', '@openai/codex', 'latest');
    await repository.uninstallNpmPackage('hub-a', '@zed-industries/claude-agent-acp');
    await repository.installNpmPackages('hub-a', ['@openai/codex', '@anthropic-ai/claude-code'], 'latest');

    expect(client.request).toHaveBeenNthCalledWith(1, {
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {section: 'agentPackages', action: 'install', params: {packageName: '@openai/codex', version: 'latest'}},
      timeoutMs: 60000,
    });
    expect(client.request).toHaveBeenNthCalledWith(2, {
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {section: 'agentPackages', action: 'uninstall', params: {packageName: '@zed-industries/claude-agent-acp'}},
      timeoutMs: 60000,
    });
    expect(client.request).toHaveBeenNthCalledWith(3, {
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {
        section: 'agentPackages',
        action: 'installMany',
        params: {packageNames: ['@openai/codex', '@anthropic-ai/claude-code'], version: 'latest'},
      },
      timeoutMs: 60000,
    });
    expect(client.request).toHaveBeenCalledTimes(3);
  });

  test('uses wheelmakerUpdate HubState refresh and requestUpdate action', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          state: {
            hubId: 'hub-a',
            status: 'ready',
            sections: {
              wheelmakerUpdate: {
                status: 'ready',
                data: {
                  ok: true,
                  accepted: true,
                  jobId: 'job-a',
                  hubId: 'hub-a',
                  status: 'update_pending',
                  job: {
                    schema: 1,
                    jobId: 'job-a',
                    state: 'queued',
                    startedAt: '2026-07-16T09:00:00Z',
                    updatedAt: '2026-07-16T09:00:00Z',
                  },
                  canRequestUpdate: false,
                },
              },
            },
          },
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    await repository.queryWheelMakerUpdate('hub-a');
    await repository.requestWheelMakerUpdate('hub-a');

    expect(client.request).toHaveBeenNthCalledWith(1, {
      method: RegistryMethods.HubStateRefresh,
      hubId: 'hub-a',
      payload: {sections: ['wheelmakerUpdate']},
      timeoutMs: 60000,
    });
    expect(client.request).toHaveBeenNthCalledWith(2, {
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {section: 'wheelmakerUpdate', action: 'requestUpdate', params: {}},
      timeoutMs: 60000,
    });
  });

  test('keeps the Registry WheelMaker response local-only', () => {
    const registryTypes = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'registry', 'registryTypes.ts'), 'utf8');

    expect(registryTypes).toContain('installed?: RegistryWheelMakerInstalledRelease;');
    expect(registryTypes).toContain('job?: RegistryWheelMakerUpdateJob;');
    expect(registryTypes).toContain('canRequestUpdate: boolean;');
    expect(registryTypes).not.toContain('stable?: RegistryWheelMakerStableRelease;');
    expect(registryTypes).not.toContain('publishStatus?: RegistryWheelMakerPublishStatus;');
    expect(registryTypes).not.toContain('remoteRefreshRunning?: boolean;');
  });

});
