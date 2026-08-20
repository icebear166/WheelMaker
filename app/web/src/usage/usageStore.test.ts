import {UsageStore} from './usageStore';
import type {UsageHubSnapshot} from './usageTypes';

function qwenHub(
  hubId: string,
  remaining: string,
  updatedAt = '2026-08-19T12:00:00Z',
): UsageHubSnapshot {
  return {
    hubId,
    generation: 1,
    status: 'ready',
    updatedAt,
    providers: [{
      id: 'qwen',
      name: 'Qwen',
      status: 'ok',
      authenticated: true,
      accounts: [{
        localId: 'bailian-token-plan',
        identity: {kind: 'source', label: '阿里云百炼 Token Plan'},
        status: 'ok',
        plan: 'lite',
        limits: [{id: 'week', label: '7 days', remainingPercent: 60, windowKind: 'fixed', windowDurationMins: 10080}],
        qwen: {
          fiveHour: {state: 'limited', total: '700', used: '100', remaining},
          week: {state: 'limited', total: '2500', used: '500', remaining},
        },
      }],
    }],
  };
}

describe('UsageStore Qwen aggregation', () => {
  it('aggregates one Qwen row while retaining every Hub source', () => {
    const store = new UsageStore();
    store.replaceHub('hub-a', qwenHub('hub-a', '600', '2026-08-19T12:00:00Z'));
    store.replaceHub('hub-b', qwenHub('hub-b', '500', '2026-08-19T12:01:00Z'));

    const qwen = store.snapshot().providers.filter(provider => provider.id === 'qwen');
    expect(qwen).toHaveLength(1);
    expect(qwen[0].hubId).toBeUndefined();
    expect(qwen[0].accounts).toHaveLength(1);
    expect(qwen[0].accounts[0].qwen?.fiveHour.remaining).toBe('500');
    expect(qwen[0].accounts[0].hubIds).toEqual(['hub-a', 'hub-b']);
    expect(qwen[0].accounts[0].sources?.map(source => `${source.hubId}:${source.accountLocalId}`)).toEqual([
      'hub-a:bailian-token-plan',
      'hub-b:bailian-token-plan',
    ]);
    expect(qwen[0].authenticated).toBe(true);
  });

  it('keeps the newest valid Qwen data when a newer Hub has no snapshot', () => {
    const store = new UsageStore();
    store.replaceHub('hub-a', qwenHub('hub-a', '600', '2026-08-19T12:00:00Z'));
    const unavailable = qwenHub('hub-b', '0', '2026-08-19T12:01:00Z');
    unavailable.providers[0].status = 'error';
    unavailable.providers[0].accounts[0].status = 'error';
    unavailable.providers[0].accounts[0].qwen = undefined;
    store.replaceHub('hub-b', unavailable);

    const account = store.snapshot().providers.find(provider => provider.id === 'qwen')!.accounts[0];
    expect(account.qwen?.fiveHour.remaining).toBe('600');
    expect(account.hubIds).toEqual(['hub-a', 'hub-b']);
  });
});
