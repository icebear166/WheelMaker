import {
  calculateCombinedCost,
  normalizeModelEfficiencyPayload,
  readModelEfficiencyUpdatedAt,
  selectModelRecommendations,
} from '../web/src/modelEfficiency/modelEfficiencyModel';
import type {ModelEfficiencyItem} from '../web/src/modelEfficiency/modelEfficiencyTypes';

function item(
  effort: ModelEfficiencyItem['effort'],
  score: number,
  averageCostUsd?: number,
  averageTaskSeconds?: number,
): ModelEfficiencyItem {
  return {
    family: 'gpt-5.6-sol',
    effort,
    score,
    averageCostUsd,
    averageTaskSeconds,
  };
}

describe('model efficiency normalization', () => {
  test('reads the webpage efficiency feed and filters its 19 points to 17 supported rows', () => {
    const point = (
      model: string,
      effort: string,
      iq: number,
      averagePriceUsd: number,
      averageMinutes: number,
    ) => ({
      model,
      effort,
      iq,
      average_price_usd: averagePriceUsd,
      average_minutes: averageMinutes,
    });
    const payload = {
      source_updated_at: '2026-07-22T13:58:55+08:00',
      points: [
        point('gpt-5.6-sol', 'low', 76.34, 2.06, 12.42),
        point('gpt-5.6-sol', 'medium', 89.73, 3.62, 17.58),
        point('gpt-5.6-sol', 'high', 91.07, 4.89, 22.11),
        point('gpt-5.6-sol', 'xhigh', 93.75, 6.85, 27.75),
        point('gpt-5.6-sol', 'max', 103.12, 8.87, 34.1),
        point('gpt-5.6-sol', 'ultra', 101.79, 26.09, 53.76),
        point('gpt-5.6-terra', 'low', 44.2, 0.55, 8.27),
        point('gpt-5.6-terra', 'medium', 56.25, 0.76, 9.91),
        point('gpt-5.6-terra', 'high', 61.61, 1.3, 13.77),
        point('gpt-5.6-terra', 'xhigh', 93.75, 2.4, 19.91),
        point('gpt-5.6-terra', 'max', 101.79, 4.62, 33.47),
        point('gpt-5.6-terra', 'ultra', 103.12, 13.25, 42.47),
        point('gpt-5.6-luna', 'low', 6.7, 0.15, 7.79),
        point('gpt-5.6-luna', 'medium', 36.16, 0.43, 11.21),
        point('gpt-5.6-luna', 'high', 72.32, 1.03, 19.03),
        point('gpt-5.6-luna', 'xhigh', 81.7, 1.57, 24.73),
        point('gpt-5.6-luna', 'max', 95.09, 2.51, 35.79),
        point('gpt-5.5', 'high', 80.36, 3.58, 15.55),
        point('gpt-5.5', 'xhigh', 97.77, 5.83, 22.35),
      ],
    };

    const normalized = normalizeModelEfficiencyPayload(payload);
    expect(normalized).toHaveLength(17);
    expect(normalized.filter(entry => entry.family === 'gpt-5.6-sol')).toHaveLength(6);
    expect(normalized.filter(entry => entry.family === 'gpt-5.6-terra')).toHaveLength(6);
    expect(normalized.filter(entry => entry.family === 'gpt-5.6-luna')).toHaveLength(5);
    expect(normalized[0]).toEqual(item('ultra', 101.79, 26.09, 3225.6));
    expect(normalized.at(-1)).toEqual({
      family: 'gpt-5.6-luna',
      effort: 'low',
      score: 6.7,
      averageCostUsd: 0.15,
      averageTaskSeconds: 467.4,
    });
    expect(readModelEfficiencyUpdatedAt(payload)).toBe('2026-07-22T13:58:55+08:00');
  });

  test('requires a supported family, recognized effort, and finite score', () => {
    const payload = {
      points: [
        {model: 'gpt-5.6-sol', effort: 'max', iq: Number.NaN},
        {model: 'gpt-6', effort: 'max', iq: 150},
        {model: 'gpt-5.6-sol', effort: 'extreme', iq: 150},
        {model: 'gpt-5.6-terra', effort: 'high', iq: 129},
      ],
    };

    expect(normalizeModelEfficiencyPayload(payload)).toEqual([
      {family: 'gpt-5.6-terra', effort: 'high', score: 129},
    ]);
    expect(readModelEfficiencyUpdatedAt({source_updated_at: 42})).toBeUndefined();
  });
});

describe('model efficiency recommendations', () => {
  test('calculates the approved duration-weighted combined cost', () => {
    expect(calculateCombinedCost(item('max', 100, 2, 600))).toBeCloseTo(2);
    expect(calculateCombinedCost(item('max', 100, 2, 810))).toBeCloseTo(5);
    expect(calculateCombinedCost(item('max', 100, undefined, 600))).toBeUndefined();
    expect(calculateCombinedCost(item('max', 100, 2, undefined))).toBeUndefined();
  });

  test('selects unique quality, economy, and Pareto-balanced efforts', () => {
    const recommendations = selectModelRecommendations([
      item('max', 100, 20, 600),
      item('xhigh', 80, 5, 600),
      item('high', 95, 4, 600),
      item('medium', 70, 2, 600),
      item('low', 60, 1, 600),
    ]);

    expect(recommendations.quality?.effort).toBe('max');
    expect(recommendations.balanced?.effort).toBe('high');
    expect(recommendations.economy?.effort).toBe('low');
    expect(new Set(Object.values(recommendations).map((entry) => entry?.effort)).size).toBe(3);
    expect(Object.values(recommendations).some((entry) => entry?.effort === 'xhigh')).toBe(false);
  });

  test('uses lower cost, higher IQ, then stronger effort as deterministic tie breakers', () => {
    const qualityTie = selectModelRecommendations([
      item('max', 100, 3, 600),
      item('xhigh', 100, 4, 600),
      item('high', 90, 2, 600),
      item('low', 80, 1, 600),
    ]);
    expect(qualityTie.quality?.effort).toBe('max');

    const strengthTie = selectModelRecommendations([
      item('max', 100, 5, 600),
      item('xhigh', 90, 2, 600),
      item('high', 90, 2, 600),
      item('low', 80, 1, 600),
    ]);
    expect(strengthTie.balanced?.effort).toBe('xhigh');
  });

  test('does not fill recommendation roles from incomplete or duplicate rows', () => {
    expect(selectModelRecommendations([
      item('max', 100, 5, 600),
      item('high', 90),
    ])).toEqual({
      quality: expect.objectContaining({effort: 'max'}),
      balanced: null,
      economy: null,
    });
  });
});
