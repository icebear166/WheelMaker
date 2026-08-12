// @ts-nocheck
import {RegistryRepository} from './RegistryRepository';

test('returns a failed release publish job response', async () => {
  const repository = new RegistryRepository({
    request: async () => ({
      payload: {
        ok: false,
        status: 'failed',
        error: 'release token is not configured',
      },
    }),
  } as any);

  await expect(repository.startReleasePublish('publisher', {})).resolves.toEqual({
    ok: false,
    status: 'failed',
    error: 'release token is not configured',
  });
});

test('queries release storage through the registry', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const repository = new RegistryRepository({
    request: async (input: Record<string, unknown>) => {
      requests.push(input);
      return {payload: {ok: true, status: 'success', storage: {totalBytes: 600, reclaimableBytes: 200, orphanCount: 1}}};
    },
  } as any);

  const result = await repository.queryReleaseStorage('publisher', '/src/WheelMaker');
  expect(result.ok).toBe(true);
  expect(result.storage).toEqual({totalBytes: 600, reclaimableBytes: 200, orphanCount: 1});
  expect(requests[0]).toMatchObject({
    method: 'release.storage.get',
    hubId: 'publisher',
    payload: {sourcePath: '/src/WheelMaker'},
  });
});

test('prunes release storage through the registry', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const repository = new RegistryRepository({
    request: async (input: Record<string, unknown>) => {
      requests.push(input);
      return {payload: {ok: true, status: 'success', removedCount: 2}};
    },
  } as any);

  const result = await repository.pruneReleaseStorage('publisher', '/src/WheelMaker');
  expect(result.ok).toBe(true);
  expect(result.removedCount).toBe(2);
  expect(requests[0]).toMatchObject({
    method: 'release.storage.prune',
    hubId: 'publisher',
    payload: {sourcePath: '/src/WheelMaker'},
  });
});

test('requests a Gateway update through its dedicated HubState section', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const repository = new RegistryRepository({
    request: async (input: Record<string, unknown>) => {
      requests.push(input);
      return {payload: {
        accepted: true,
        result: {ok: true, accepted: true, status: 'update_pending', hubId: 'hub-a', canRequestUpdate: false},
      }};
    },
  } as any);

  const result = await repository.requestGatewayUpdate('hub-a');
  expect(result.status).toBe('update_pending');
  expect(requests[0]).toMatchObject({
    method: 'hub.state.action',
    hubId: 'hub-a',
    payload: {section: 'gatewayUpdate', action: 'requestUpdate', params: {}},
  });
});
