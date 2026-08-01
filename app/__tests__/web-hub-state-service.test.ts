import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import type {RegistryClient} from '../web/src/registry/RegistryClient';
import {RegistryMethods} from '../web/src/registry/registryMethods';
import fs from 'fs';
import path from 'path';

describe('hub state registry service', () => {
  test('Workspace projects operational UI directly from HubStore without legacy poll caches', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(source).toContain('deriveHubOperationalViews(hubStoreSnapshot)');
    expect(source).not.toMatch(/set(?:WheelMakerUpdateHubs|AgentPackageHubs|ProjectIndexByHubId|SkillHubs|ChatHubFlickerBridgeStatuses)/);
    expect(source).not.toMatch(/wheelMakerUpdatePoll|projectIndexPoll|handleWheelMakerUpdatePending|handleProjectIndexPending/);
    expect(source).not.toMatch(/service\.(?:queryWheelMakerUpdate|scanSkills|getFileIndexStatus|scanNpmPackages)/);
  });

  test('gets hub state with envelope hubId', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          state: {hubId: 'hub-a', instanceId: 'instance-a', sections: {}},
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
          state: {hubId: 'hub-a', instanceId: 'instance-a', sections: {}},
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
          accepted: true,
          result: {operation: {id: 'npm-1'}},
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    const result = await repository.runHubStateAction('hub-a', 'agentPackages', 'install', {
      packageName: '@openai/codex',
      version: 'latest',
    });

    expect(result).toEqual({accepted: true, result: {operation: {id: 'npm-1'}}});
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
            instanceId: 'instance-a',
            sections: {
              tokenStats: null,
              skills: {data: {ok: true}},
              fileIndex: {availability: 123, updateStatus: 5, revision: 'old'},
            },
          },
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    const state = await repository.getHubState('hub-a');

    expect(state.instanceId).toBe('instance-a');
    expect(state.sections.tokenStats.availability).toBe('empty');
    expect(state.sections.tokenStats.updateStatus).toBe('idle');
    expect(state.sections.tokenStats.revision).toBe(0);
    expect(state.sections.skills.availability).toBe('empty');
    expect(state.sections.skills.data).toEqual({ok: true});
    expect(state.sections.fileIndex.availability).toBe('empty');
    expect(state.sections.fileIndex.updateStatus).toBe('idle');
    expect(state.sections.fileIndex.lastError).toBeUndefined();
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

  test('requests deepseek usage with month params', async () => {
    const client = {
      request: jest.fn().mockResolvedValue({
        type: 'response',
        payload: {
          hubId: 'hub-a',
          status: 'ok',
          month: {year: 2026, month: 8},
          balance: [{currency: 'CNY', total: '3.24'}],
          days: [{date: '2026-08-01', request: 3, outputTokens: 120, hitTokens: 300, missTokens: 100, totalTokens: 520}],
          costs: [{currency: 'CNY', monthlyCost: 8.8, todayCost: 0.02, daily: [{date: '2026-08-01', amount: 0.02}]}],
        },
      }),
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    const result = await repository.getDeepSeekUsage('hub-a', 2026, 8, true);

    expect(client.request).toHaveBeenCalledWith({
      method: 'deepseek.usage.get',
      hubId: 'hub-a',
      payload: {year: 2026, month: 8, force: true},
      timeoutMs: 30000,
    });
    expect(result.status).toBe('ok');
    expect(result.days?.[0]?.totalTokens).toBe(520);
  });
});
