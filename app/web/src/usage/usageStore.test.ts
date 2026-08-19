import {UsageStore} from './usageStore';
import type {UsageHubSnapshot} from './usageTypes';

function qwenHub(hubId: string, remaining: string): UsageHubSnapshot {
  return {
    hubId,
    generation: 1,
    status: 'ready',
    updatedAt: '2026-08-19T12:00:00Z',
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
  it('keeps Qwen rows and credentials scoped to each Hub', () => {
    const store = new UsageStore();
    store.replaceHub('hub-a', qwenHub('hub-a', '600'));
    store.replaceHub('hub-b', qwenHub('hub-b', '500'));

    const qwen = store.snapshot().providers.filter(provider => provider.id === 'qwen');
    expect(qwen).toHaveLength(2);
    expect(qwen.map(provider => provider.hubId).sort()).toEqual(['hub-a', 'hub-b']);
    expect(qwen.map(provider => provider.accounts[0].qwen?.fiveHour.remaining).sort()).toEqual(['500', '600']);
    expect(qwen[0].accounts[0].hubIds).toHaveLength(1);
    expect(qwen[0].authenticated).toBe(true);
  });
});
