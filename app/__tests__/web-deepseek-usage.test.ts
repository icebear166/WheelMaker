import {
  deepSeekDayCost,
  deepSeekHitRate,
  deepSeekMonthKey,
  deepSeekMonthLabel,
  deepSeekTodayCost,
  normalizeDeepSeekUsage,
  previousDeepSeekMonth,
  type RegistryDeepSeekUsageCost,
} from '../web/src/usage/deepSeekUsage';

test('computes cache hit rate from hit and miss tokens', () => {
  expect(deepSeekHitRate({hitTokens: 300, missTokens: 100})).toBeCloseTo(0.75);
  expect(deepSeekHitRate({hitTokens: 0, missTokens: 0})).toBe(0);
});

test('finds the cost for a day in the primary currency', () => {
  const costs: RegistryDeepSeekUsageCost[] = [{
    currency: 'CNY',
    monthlyCost: 8.8,
    todayCost: 0.02,
    daily: [{date: '2026-08-01', amount: 0.02}],
  }];
  expect(deepSeekDayCost('2026-08-01', costs)).toBeCloseTo(0.02);
  expect(deepSeekDayCost('2026-08-02', costs)).toBe(0);
});

test('picks today cost from the current month', () => {
  const now = new Date('2026-08-01T12:00:00Z');
  expect(deepSeekTodayCost(now, [{date: '2026-08-01', amount: 0.02}])).toBeCloseTo(0.02);
});

test('normalizes a response into a view with merged costs', () => {
  const view = normalizeDeepSeekUsage({
    hubId: 'hub-a',
    status: 'ok',
    month: {year: 2026, month: 8},
    balance: [{currency: 'CNY', total: '3.24'}],
    days: [{date: '2026-08-01', request: 3, outputTokens: 120, hitTokens: 300, missTokens: 100, totalTokens: 520}],
    costs: [{currency: 'CNY', monthlyCost: 8.8, todayCost: 0.02, daily: [{date: '2026-08-01', amount: 0.02}]}],
  }, new Date('2026-08-01T12:00:00Z'));
  expect(view.days[0].cacheHitRate).toBeCloseTo(0.75);
  expect(view.days[0].cost).toBeCloseTo(0.02);
  expect(view.monthlyCost).toBeCloseTo(8.8);
  expect(view.todayCost).toBeCloseTo(0.02);
  expect(view.currency).toBe('CNY');
});

test('month helpers round-trip', () => {
  expect(deepSeekMonthKey(2026, 8)).toBe('2026-08');
  expect(deepSeekMonthLabel(2026, 8)).toBe('2026-08');
  expect(previousDeepSeekMonth(2026, 1)).toEqual({year: 2025, month: 12});
});
