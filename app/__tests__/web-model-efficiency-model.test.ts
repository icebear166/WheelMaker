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
  test('merges root and comparison records in fixed family and effort order', () => {
    const payload = {
      model_iq: {
        updated_at: '2026-07-22T09:30:00Z',
        latest: {
          model: 'gpt-5.6-sol',
          reasoning_effort: 'max',
          score: 142,
          average_cost_usd: 3.2,
          average_task_seconds: 410,
          date: '2026-07-21',
        },
        comparisons: {
          solLow: {
            latest: {
              model: 'gpt-5.6-sol',
              reasoning_effort: 'low',
              score: 118,
              average_cost_usd: 0.8,
              average_task_seconds: 180,
              date: '2026-07-20',
            },
          },
          terra: {
            latest: {
              model: 'gpt-5.6-terra',
              reasoning_effort: 'high',
              score: 130,
              average_cost_usd: 1.9,
              average_task_seconds: 300,
            },
          },
          luna: {
            latest: {
              model: 'gpt-5.6-luna',
              reasoning_effort: 'medium',
              score: 121,
              average_cost_usd: 1.1,
              average_task_seconds: 240,
            },
          },
          excluded: {
            latest: {
              model: 'gpt-5.5-codex',
              reasoning_effort: 'xhigh',
              score: 140,
              average_cost_usd: 1,
              average_task_seconds: 100,
            },
          },
        },
      },
    };

    expect(normalizeModelEfficiencyPayload(payload)).toEqual([
      item('max', 142, 3.2, 410),
      item('low', 118, 0.8, 180),
      {
        family: 'gpt-5.6-terra',
        effort: 'high',
        score: 130,
        averageCostUsd: 1.9,
        averageTaskSeconds: 300,
      },
      {
        family: 'gpt-5.6-luna',
        effort: 'medium',
        score: 121,
        averageCostUsd: 1.1,
        averageTaskSeconds: 240,
      },
    ]);
    expect(readModelEfficiencyUpdatedAt(payload)).toBe('2026-07-22T09:30:00Z');
  });

  test('uses the newer duplicate and lets root win equal or missing dates', () => {
    const makePayload = (rootDate?: string, comparisonDate?: string) => ({
      model_iq: {
        latest: {
          model: 'gpt-5.6-sol',
          reasoning_effort: 'max',
          score: 142,
          date: rootDate,
        },
        comparisons: {
          duplicate: {
            latest: {
              model: 'gpt-5.6-sol',
              reasoning_effort: 'max',
              score: 999,
              date: comparisonDate,
            },
          },
        },
      },
    });

    expect(normalizeModelEfficiencyPayload(makePayload('2026-07-20', '2026-07-21'))[0].score)
      .toBe(999);
    expect(normalizeModelEfficiencyPayload(makePayload('2026-07-21', '2026-07-21'))[0].score)
      .toBe(142);
    expect(normalizeModelEfficiencyPayload(makePayload())[0].score).toBe(142);
  });

  test('requires a supported family, recognized effort, and finite score', () => {
    const payload = {
      model_iq: {
        latest: {model: 'gpt-5.6-sol', reasoning_effort: 'max', score: Number.NaN},
        comparisons: {
          unknownModel: {latest: {model: 'gpt-6', reasoning_effort: 'max', score: 150}},
          unknownEffort: {latest: {model: 'gpt-5.6-sol', reasoning_effort: 'extreme', score: 150}},
          validWithoutAverages: {
            latest: {model: 'gpt-5.6-terra', reasoning_effort: 'high', score: 129},
          },
        },
      },
    };

    expect(normalizeModelEfficiencyPayload(payload)).toEqual([
      {family: 'gpt-5.6-terra', effort: 'high', score: 129},
    ]);
    expect(readModelEfficiencyUpdatedAt({model_iq: {updated_at: 42}})).toBeUndefined();
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
