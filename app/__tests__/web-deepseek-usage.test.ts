import {deepSeekHitRate, normalizeDeepSeekUsage} from '../web/src/usage/deepSeekUsage';
import type {RegistryDeepSeekUsageResponse} from '../web/src/registry/registryTypes';

function makeResponse(overrides: Partial<RegistryDeepSeekUsageResponse> = {}): RegistryDeepSeekUsageResponse {
  return {
    hubId: 'hub-1',
    status: 'ok',
    month: {year: 2026, month: 8},
    balance: [{currency: 'CNY', total: '1.25', granted: '0.00', toppedUp: '1.25'}],
    days: [
      {date: '2026-08-01', request: 800000, outputTokens: 700000, hitTokens: 500000, missTokens: 600000, totalTokens: 1800000},
      {date: '2026-08-02', request: 0, outputTokens: 0, hitTokens: 0, missTokens: 0, totalTokens: 0},
    ],
    costs: [
      {
        currency: 'CNY',
        monthlyCost: 12.75,
        todayCost: 21.75,
        daily: [{date: '2026-08-01', amount: 21.75}],
      },
      {
        currency: 'USD',
        monthlyCost: 1.5,
        todayCost: 0.5,
        daily: [{date: '2026-08-01', amount: 0.5}],
      },
    ],
    cachedAt: '2026-08-01T12:00:00Z',
    ...overrides,
  };
}

describe('deepSeekHitRate', () => {
  it('computes hit / (hit + miss) and handles zero input', () => {
    expect(deepSeekHitRate({hitTokens: 500000, missTokens: 600000})).toBeCloseTo(500000 / 1100000, 6);
    expect(deepSeekHitRate({hitTokens: 0, missTokens: 0})).toBe(0);
  });
});

describe('normalizeDeepSeekUsage', () => {
  const now = new Date(2026, 7, 1, 12, 0, 0);

  it('maps per-currency daily costs onto days', () => {
    const view = normalizeDeepSeekUsage(makeResponse(), now);
    expect(view.days[0].costs).toEqual([
      {currency: 'CNY', amount: 21.75},
      {currency: 'USD', amount: 0.5},
    ]);
    expect(view.days[1].costs).toEqual([
      {currency: 'CNY', amount: 0},
      {currency: 'USD', amount: 0},
    ]);
  });

  it('keeps one spend row per currency with today cost for the current month', () => {
    const view = normalizeDeepSeekUsage(makeResponse(), now);
    expect(view.isCurrentMonth).toBe(true);
    expect(view.spend).toEqual([
      {currency: 'CNY', monthlyCost: 12.75, todayCost: 21.75},
      {currency: 'USD', monthlyCost: 1.5, todayCost: 0.5},
    ]);
  });

  it('drops today cost for past months', () => {
    const past = new Date(2026, 8, 1, 12, 0, 0);
    const view = normalizeDeepSeekUsage(makeResponse(), past);
    expect(view.isCurrentMonth).toBe(false);
    expect(view.spend.map(item => item.todayCost)).toEqual([null, null]);
  });

  it('marks months without any usage as empty', () => {
    const view = normalizeDeepSeekUsage(makeResponse({
      days: [{date: '2026-08-01', request: 0, outputTokens: 0, hitTokens: 0, missTokens: 0, totalTokens: 0}],
    }), now);
    expect(view.isEmpty).toBe(true);
    const nonEmpty = normalizeDeepSeekUsage(makeResponse(), now);
    expect(nonEmpty.isEmpty).toBe(false);
  });

  it('defaults missing sections', () => {
    const view = normalizeDeepSeekUsage({hubId: 'hub-1', status: 'expired', month: {year: 2026, month: 8}}, now);
    expect(view.balance).toEqual([]);
    expect(view.days).toEqual([]);
    expect(view.spend).toEqual([]);
    expect(view.isEmpty).toBe(true);
  });
});
