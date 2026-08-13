import {
  ModelEfficiencyStore,
} from '../web/src/modelEfficiency/modelEfficiencyStore';
import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import {RegistryWorkspaceService} from '../web/src/registry/RegistryWorkspaceService';
import {RegistryMethods} from '../web/src/registry/registryMethods';

const successfulPayload = {
  source_updated_at: '2026-08-13T04:00:24Z',
  points: [{
    model: 'gpt-5.6-sol',
    effort: 'max',
    iq: 103.12,
    average_price_usd: 8.87,
    average_minutes: 34.1,
  }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

describe('ModelEfficiencyStore', () => {
  test('loads a normalized snapshot from an injected Registry payload loader', async () => {
    const loader = jest.fn(async () => successfulPayload);
    const store = new ModelEfficiencyStore(loader);

    await store.refresh();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(store.snapshot().status).toBe('ready');
    expect(store.snapshot().updatedAt).toBe('2026-08-13T04:00:24Z');
  });

  test('loads and normalizes the current CodexRadar snapshot', async () => {
    const loader = jest.fn(async () => successfulPayload);
    const store = new ModelEfficiencyStore(loader);

    const refresh = store.refresh();
    expect(store.snapshot()).toEqual({
      status: 'loading',
      refreshing: true,
      items: [],
    });

    await refresh;

    expect(loader).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toEqual({
      status: 'ready',
      refreshing: false,
      updatedAt: '2026-08-13T04:00:24Z',
      items: [{
        family: 'gpt-5.6-sol',
        effort: 'max',
        score: 103.12,
        averageCostUsd: 8.87,
        averageTaskSeconds: 2046,
      }],
    });
  });

  test('notifies subscribers immediately and after each request transition', async () => {
    const store = new ModelEfficiencyStore(async () => successfulPayload);
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    await store.refresh();

    expect(listener.mock.calls.map(([snapshot]) => snapshot.status)).toEqual([
      'idle',
      'loading',
      'ready',
    ]);
    unsubscribe();
    await store.refresh();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  test('coalesces concurrent refreshes into one request', async () => {
    const pending = deferred<unknown>();
    const loader = jest.fn(() => pending.promise);
    const store = new ModelEfficiencyStore(loader);

    const first = store.refresh();
    const second = store.refresh();
    expect(loader).toHaveBeenCalledTimes(1);

    pending.resolve(successfulPayload);
    await Promise.all([first, second]);
    expect(store.snapshot().status).toBe('ready');
  });

  test('exposes a retryable error when the first request fails', async () => {
    const loader = jest.fn(async () => {
      throw new Error('CodexRadar request failed (503).');
    });
    const store = new ModelEfficiencyStore(loader);

    await store.refresh();

    expect(store.snapshot()).toEqual({
      status: 'error',
      refreshing: false,
      items: [],
      error: 'CodexRadar request failed (503).',
    });

    loader.mockImplementationOnce(async () => successfulPayload);
    await store.refresh();
    expect(store.snapshot().status).toBe('ready');
  });

  test('retains stale data and source time when manual refresh fails', async () => {
    const loader = jest.fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(successfulPayload)
      .mockRejectedValueOnce(new Error('Network offline'));
    const store = new ModelEfficiencyStore(loader);
    await store.refresh();
    const ready = store.snapshot();

    const refresh = store.refresh();
    expect(store.snapshot()).toMatchObject({
      status: 'ready',
      refreshing: true,
      items: ready.items,
      updatedAt: ready.updatedAt,
    });
    await refresh;

    expect(store.snapshot()).toEqual({
      status: 'ready',
      refreshing: false,
      items: ready.items,
      updatedAt: ready.updatedAt,
      error: 'Network offline',
    });
  });

  test('uses a stable fallback message for non-Error failures', async () => {
    const store = new ModelEfficiencyStore(async () => {
      throw 'offline';
    });

    await store.refresh();
    expect(store.snapshot().error).toBe('Unable to refresh CodexRadar data.');
  });
});

describe('RegistryRepository CodexRadar access', () => {
  test('requests the live efficiency snapshot through Registry server data', async () => {
    const request = jest.fn(async () => ({
      payload: successfulPayload,
    }));
    const repository = new RegistryRepository({request} as never);

    await repository.getCodexRadarEfficiency();

    expect(request).toHaveBeenCalledWith({
      method: RegistryMethods.CodexRadarEfficiencyGet,
      payload: {},
      timeoutMs: 15000,
    });
  });

  test('exposes the Repository method through the connected Workspace service', async () => {
    const payload = {source_updated_at: '2026-08-13T04:00:24Z', points: []};
    const repository = {
      getCodexRadarEfficiency: jest.fn().mockResolvedValue(payload),
    };
    const service = new RegistryWorkspaceService();
    Object.assign(service as unknown as {repository: unknown}, {repository});

    await expect(service.getCodexRadarEfficiency()).resolves.toBe(payload);
    expect(repository.getCodexRadarEfficiency).toHaveBeenCalledTimes(1);
  });
});
