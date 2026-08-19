import {
  calculateUsageForecast,
  loadUsageHistoryFromSources,
  selectBestHistory,
  selectLongestLimit,
  type UsageHistoryCandidate,
  type UsageHistoryLimit,
} from '../web/src/usage/usageHistory';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const hour = (value: number) => value * HOUR;

function limit(
  id: string,
  windowKind: UsageHistoryLimit['windowKind'],
  windowDurationMins: number | undefined,
  samples: Array<[number, number]> = [],
): UsageHistoryLimit {
  return {
    id,
    label: id,
    windowKind,
    windowDurationMins,
    resetsAt: new Date(hour(200)).toISOString(),
    samples: samples.map(([observedAtMillis, remainingPercent]) => ({observedAtMillis, remainingPercent})),
  };
}

describe('usage history selection', () => {
  test('prefers a calendar month over a week and a week over five hours', () => {
    const fiveHour = limit('5h', 'fixed', 5 * 60);
    const week = limit('week', 'fixed', 7 * 24 * 60);
    const month = limit('month', 'calendarMonth', undefined);
    expect(selectLongestLimit([fiveHour, week, month])?.id).toBe('month');
    expect(selectLongestLimit([fiveHour, week])?.id).toBe('week');
  });

  test('chooses fresh sufficient history by span, count, then newest sample', () => {
    const now = hour(100);
    const candidates: UsageHistoryCandidate[] = [
      {hubId: 'hub-dense', limit: limit('week', 'fixed', 10080, [
        [hour(95), 90], [hour(96), 89], [hour(97), 88], [now - MINUTE, 87],
      ])},
      {hubId: 'hub-wide', limit: limit('week', 'fixed', 10080, [
        [hour(80), 95], [hour(90), 90], [now - 2 * MINUTE, 85],
      ])},
      {hubId: 'hub-stale', limit: limit('week', 'fixed', 10080, [
        [hour(10), 95], [hour(20), 90], [hour(70), 85],
      ])},
    ];
    expect(selectBestHistory(candidates, now)?.hubId).toBe('hub-wide');
  });

  test('falls back to the newest sample when no candidate is sufficient and breaks ties deterministically', () => {
    const candidates: UsageHistoryCandidate[] = [
      {hubId: 'hub-z', limit: limit('week', 'fixed', 10080, [[hour(9), 80]])},
      {hubId: 'hub-b', limit: limit('week', 'fixed', 10080, [[hour(10), 79]])},
      {hubId: 'hub-a', limit: limit('week', 'fixed', 10080, [[hour(10), 78]])},
    ];
    expect(selectBestHistory(candidates, hour(100))?.hubId).toBe('hub-a');
  });
});

describe('usage forecast', () => {
  test('includes flat intervals and excludes increases', () => {
    const forecast = calculateUsageForecast({
      samples: [
        {observedAtMillis: hour(0), remainingPercent: 80},
        {observedAtMillis: hour(1), remainingPercent: 80},
        {observedAtMillis: hour(2), remainingPercent: 90},
        {observedAtMillis: hour(3), remainingPercent: 70},
      ],
      resetsAtMillis: hour(10),
      lookbackMillis: 24 * HOUR,
    });
    expect(forecast.validIntervalCount).toBe(2);
    expect(forecast.speedPerHour).toBeGreaterThan(0);
  });

  test('requires at least three points inside the lookback window', () => {
    const samples = [
      {observedAtMillis: hour(0), remainingPercent: 90},
      {observedAtMillis: hour(30), remainingPercent: 80},
      {observedAtMillis: hour(31), remainingPercent: 70},
    ];
    expect(calculateUsageForecast({
      samples,
      resetsAtMillis: hour(100),
      lookbackMillis: 24 * HOUR,
    }).status).toBe('insufficient');
    expect(calculateUsageForecast({
      samples,
      resetsAtMillis: hour(100),
      lookbackMillis: 72 * HOUR,
    }).status).not.toBe('insufficient');
  });

  test('reports zero speed as safe with unchanged remaining at reset', () => {
    const forecast = calculateUsageForecast({
      samples: [
        {observedAtMillis: hour(0), remainingPercent: 80},
        {observedAtMillis: hour(1), remainingPercent: 80},
        {observedAtMillis: hour(2), remainingPercent: 80},
      ],
      resetsAtMillis: hour(10),
      lookbackMillis: 24 * HOUR,
    });
    expect(forecast.status).toBe('safeUntilReset');
    expect(forecast.speedPerHour).toBe(0);
    expect(forecast.remainingAtReset).toBe(80);
  });

  test('weights recent intervals more heavily than older intervals', () => {
    const forecast = calculateUsageForecast({
      samples: [
        {observedAtMillis: hour(0), remainingPercent: 100},
        {observedAtMillis: hour(1), remainingPercent: 80},
        {observedAtMillis: hour(23), remainingPercent: 80},
        {observedAtMillis: hour(24), remainingPercent: 70},
      ],
      resetsAtMillis: hour(30),
      lookbackMillis: 24 * HOUR,
    });
    expect(forecast.speedPerHour).toBeGreaterThan(0);
    expect(forecast.speedPerHour).toBeLessThan(10);
  });

  test('projects an early depletion without extending beyond it', () => {
    const forecast = calculateUsageForecast({
      samples: [
        {observedAtMillis: hour(0), remainingPercent: 30},
        {observedAtMillis: hour(1), remainingPercent: 20},
        {observedAtMillis: hour(2), remainingPercent: 10},
      ],
      resetsAtMillis: hour(10),
      lookbackMillis: 24 * HOUR,
    });
    expect(forecast.status).toBe('depletesBeforeReset');
    expect(forecast.depletionAtMillis).toBeCloseTo(hour(3));
    expect(forecast.projection.at(-1)).toEqual({
      observedAtMillis: forecast.depletionAtMillis,
      remainingPercent: 0,
    });
  });

  test('projects only to reset when quota remains', () => {
    const forecast = calculateUsageForecast({
      samples: [
        {observedAtMillis: hour(0), remainingPercent: 90},
        {observedAtMillis: hour(1), remainingPercent: 89},
        {observedAtMillis: hour(2), remainingPercent: 88},
      ],
      resetsAtMillis: hour(10),
      lookbackMillis: 24 * HOUR,
    });
    expect(forecast.status).toBe('safeUntilReset');
    expect(forecast.remainingAtReset).toBeCloseTo(80);
    expect(forecast.projection.at(-1)?.observedAtMillis).toBe(hour(10));
  });

  test('deduplicates timestamps and discards invalid sample values', () => {
    const forecast = calculateUsageForecast({
      samples: [
        {observedAtMillis: hour(0), remainingPercent: 80},
        {observedAtMillis: hour(1), remainingPercent: 70},
        {observedAtMillis: hour(1), remainingPercent: 65},
        {observedAtMillis: Number.NaN, remainingPercent: 64},
        {observedAtMillis: hour(1.5), remainingPercent: 101},
        {observedAtMillis: hour(2), remainingPercent: 60},
      ],
      resetsAtMillis: hour(10),
      lookbackMillis: 24 * HOUR,
    });
    expect(forecast.validIntervalCount).toBe(2);
    expect(Number.isFinite(forecast.speedPerHour)).toBe(true);
  });
});

describe('usage history loading', () => {
  test('keeps a successful Hub when another source fails', async () => {
    const resetAt = '2026-08-01T00:00:00Z';
    const request = jest.fn().mockImplementation((source: {hubId: string; accountLocalId: string}) => {
      if (source.hubId === 'hub-b') return Promise.reject(new Error('old Hub'));
      return Promise.resolve({
        hubId: source.hubId,
        providerId: 'codex',
        accountLocalId: source.accountLocalId,
        limits: [{
          id: 'week',
          label: 'W',
          windowKind: 'fixed' as const,
          windowDurationMins: 10080,
          resetsAt: resetAt,
          samples: [
            {observedAtMillis: Date.parse('2026-07-27T23:40:00Z'), remainingPercent: 84},
            {observedAtMillis: Date.parse('2026-07-27T23:50:00Z'), remainingPercent: 83},
            {observedAtMillis: Date.parse('2026-07-28T00:00:00Z'), remainingPercent: 82},
          ],
        }],
      });
    });

    const result = await loadUsageHistoryFromSources({
      providerId: 'codex',
      sources: [
        {hubId: 'hub-a', accountLocalId: 'local-a'},
        {hubId: 'hub-b', accountLocalId: 'local-b'},
      ],
      nowMillis: Date.parse('2026-07-28T00:05:00Z'),
      request,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({status: 'ready', hubId: 'hub-a', limit: {id: 'week'}});
  });
});
