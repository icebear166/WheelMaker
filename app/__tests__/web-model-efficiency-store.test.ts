import {
  CODEX_RADAR_CURRENT_URL,
  ModelEfficiencyStore,
  type ModelEfficiencyFetcher,
} from '../web/src/modelEfficiency/modelEfficiencyStore';

const successfulPayload = {
  model_iq: {
    updated_at: '2026-07-22T09:30:00Z',
    latest: {
      model: 'gpt-5.6-sol',
      reasoning_effort: 'max',
      score: 142,
      average_cost_usd: 3.2,
      average_task_seconds: 410,
    },
  },
};

function response(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

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
  test('loads and normalizes the current CodexRadar snapshot', async () => {
    const fetcher = jest.fn<ModelEfficiencyFetcher>(async () => response(successfulPayload));
    const store = new ModelEfficiencyStore(fetcher);

    const refresh = store.refresh();
    expect(store.snapshot()).toEqual({
      status: 'loading',
      refreshing: true,
      items: [],
    });

    await refresh;

    expect(fetcher).toHaveBeenCalledWith(CODEX_RADAR_CURRENT_URL);
    expect(store.snapshot()).toEqual({
      status: 'ready',
      refreshing: false,
      updatedAt: '2026-07-22T09:30:00Z',
      items: [{
        family: 'gpt-5.6-sol',
        effort: 'max',
        score: 142,
        averageCostUsd: 3.2,
        averageTaskSeconds: 410,
      }],
    });
  });

  test('notifies subscribers immediately and after each request transition', async () => {
    const store = new ModelEfficiencyStore(async () => response(successfulPayload));
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
    const pending = deferred<ReturnType<typeof response>>();
    const fetcher = jest.fn<ModelEfficiencyFetcher>(() => pending.promise);
    const store = new ModelEfficiencyStore(fetcher);

    const first = store.refresh();
    const second = store.refresh();
    expect(fetcher).toHaveBeenCalledTimes(1);

    pending.resolve(response(successfulPayload));
    await Promise.all([first, second]);
    expect(store.snapshot().status).toBe('ready');
  });

  test('exposes a retryable error when the first request fails', async () => {
    const fetcher = jest.fn<ModelEfficiencyFetcher>(async () => response({}, false, 503));
    const store = new ModelEfficiencyStore(fetcher);

    await store.refresh();

    expect(store.snapshot()).toEqual({
      status: 'error',
      refreshing: false,
      items: [],
      error: 'CodexRadar request failed (503).',
    });

    fetcher.mockImplementationOnce(async () => response(successfulPayload));
    await store.refresh();
    expect(store.snapshot().status).toBe('ready');
  });

  test('retains stale data and source time when manual refresh fails', async () => {
    const fetcher = jest.fn<ModelEfficiencyFetcher>()
      .mockResolvedValueOnce(response(successfulPayload))
      .mockRejectedValueOnce(new Error('Network offline'));
    const store = new ModelEfficiencyStore(fetcher);
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
