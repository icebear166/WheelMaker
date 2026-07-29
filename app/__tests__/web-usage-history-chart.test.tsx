import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

const mockSetOption = jest.fn();
const mockDispose = jest.fn();

jest.mock('echarts/core', () => ({
  __esModule: true,
  graphic: {
    LinearGradient: class MockLinearGradient {
      constructor(..._args: unknown[]) {}
    },
  },
  init: jest.fn(() => ({
    dispose: mockDispose,
    resize: jest.fn(),
    setOption: mockSetOption,
  })),
  use: jest.fn(),
}), {virtual: true});
jest.mock('echarts/charts', () => ({LineChart: {}}), {virtual: true});
jest.mock('echarts/components', () => ({
  GridComponent: {},
  MarkLineComponent: {},
  TooltipComponent: {},
}), {virtual: true});
jest.mock('echarts/renderers', () => ({CanvasRenderer: {}}), {virtual: true});

import UsageHistoryChart from '../web/src/usage/UsageHistoryChart';
import type {UsageForecast, UsageHistoryLimit} from '../web/src/usage/usageHistory';

const HOUR = 60 * 60 * 1000;
const base = Date.parse('2026-07-28T00:00:00Z');
const resetAtMillis = base + 12 * HOUR;

const limit: UsageHistoryLimit = {
  id: 'week',
  label: 'W',
  windowKind: 'fixed',
  windowDurationMins: 7 * 24 * 60,
  resetsAt: new Date(resetAtMillis).toISOString(),
  samples: [
    {observedAtMillis: base, remainingPercent: 86},
    {observedAtMillis: base + HOUR, remainingPercent: 84},
    {observedAtMillis: base + 2 * HOUR, remainingPercent: 82},
  ],
};

const forecast: UsageForecast = {
  status: 'depletesBeforeReset',
  speedPerHour: 8,
  depletionAtMillis: base + 8 * HOUR,
  projection: [
    limit.samples.at(-1)!,
    {observedAtMillis: base + 8 * HOUR, remainingPercent: 0},
  ],
  validIntervalCount: 2,
};

describe('UsageHistoryChart', () => {
  const originalGetComputedStyle = globalThis.getComputedStyle;

  beforeAll(() => {
    Object.defineProperty(globalThis, 'getComputedStyle', {
      configurable: true,
      value: () => ({
        getPropertyValue: () => '',
      }),
    });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'getComputedStyle', {
      configurable: true,
      value: originalGetComputedStyle,
    });
  });

  beforeEach(() => {
    mockSetOption.mockClear();
    mockDispose.mockClear();
  });

  test('keeps observed and projected lines visible during pointer emphasis', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <UsageHistoryChart
          limit={limit}
          forecast={forecast}
          resetAtMillis={resetAtMillis}
        />,
        {createNodeMock: () => ({})},
      );
    });

    const option = mockSetOption.mock.calls[0]?.[0] as {
      series?: Array<{emphasis?: {disabled?: boolean}}>;
    };
    expect(option.series).toHaveLength(2);
    expect(option.series?.[0]?.emphasis).toEqual({disabled: true});
    expect(option.series?.[1]?.emphasis).toEqual({disabled: true});

    act(() => view!.unmount());
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });

  test('breaks the observed line when remaining quota increases', () => {
    const refilledLimit: UsageHistoryLimit = {
      ...limit,
      samples: [
        {observedAtMillis: base, remainingPercent: 86},
        {observedAtMillis: base + HOUR, remainingPercent: 84},
        {observedAtMillis: base + 2 * HOUR, remainingPercent: 100},
        {observedAtMillis: base + 3 * HOUR, remainingPercent: 98},
      ],
    };
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <UsageHistoryChart
          limit={refilledLimit}
          forecast={forecast}
          resetAtMillis={resetAtMillis}
        />,
        {createNodeMock: () => ({})},
      );
    });

    const option = mockSetOption.mock.calls[0]?.[0] as {
      series?: Array<{
        connectNulls?: boolean;
        data?: Array<[number, number | null]>;
      }>;
    };
    expect(option.series?.[0]?.connectNulls).toBe(false);
    expect(option.series?.[0]?.data).toEqual([
      [base, 86],
      [base + HOUR, 84],
      [base + 1.5 * HOUR, null],
      [base + 2 * HOUR, 100],
      [base + 3 * HOUR, 98],
    ]);

    act(() => view!.unmount());
  });
});
