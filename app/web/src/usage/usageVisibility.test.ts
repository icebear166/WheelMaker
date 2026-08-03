import {filterUnavailableUsageSnapshot} from './usageVisibility';
import type {UsageProviderView, UsageViewSnapshot} from './usageTypes';

function provider(id: UsageProviderView['id']): UsageProviderView {
  return {
    id,
    name: id,
    status: 'ok',
    accountCount: 0,
    accounts: [],
  };
}

describe('usage visibility', () => {
  it('hides only MyFlicker when its package is unavailable', () => {
    const snapshot: UsageViewSnapshot = {
      refreshing: false,
      providers: [provider('flicker'), provider('codex')],
      updatedAt: '2026-08-03T00:00:00Z',
    };

    expect(filterUnavailableUsageSnapshot(snapshot, false)).toEqual({
      ...snapshot,
      providers: [provider('codex')],
    });
  });

  it('keeps all providers when MyFlicker is available', () => {
    const snapshot: UsageViewSnapshot = {
      refreshing: false,
      providers: [provider('flicker'), provider('codex')],
    };

    expect(filterUnavailableUsageSnapshot(snapshot, true)).toBe(snapshot);
  });
});
