import React from 'react';
import * as echarts from 'echarts/core';
import {LineChart} from 'echarts/charts';
import {GridComponent, MarkLineComponent, TooltipComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';

import type {UsageForecast, UsageHistoryLimit} from './usageHistory';

echarts.use([LineChart, GridComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

const DAY_MILLIS = 24 * 60 * 60 * 1000;

interface UsageHistoryChartProps {
  limit: UsageHistoryLimit;
  forecast: UsageForecast;
  resetAtMillis: number;
}

export default function UsageHistoryChart({
  limit,
  forecast,
  resetAtMillis,
}: UsageHistoryChartProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<echarts.ECharts | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container, undefined, {renderer: 'canvas'});
    chartRef.current = chart;
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => chart.resize());
    resizeObserver?.observe(container);
    return () => {
      resizeObserver?.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return;
    const styles = getComputedStyle(container);
    const accent = cssToken(styles, '--accent-primary', '#2784c7');
    const textPrimary = cssToken(styles, '--text-primary', '#dedede');
    const textSecondary = cssToken(styles, '--text-secondary', '#a3a3a3');
    const border = cssToken(styles, '--border-subtle', '#363636');
    const danger = cssToken(styles, '--state-danger', '#e2767f');
    const observed: Array<[number, number | null]> = [];
    limit.samples.forEach((sample, index) => {
      const remaining = clampPercent(sample.remainingPercent);
      const previous = limit.samples[index - 1];
      if (previous && remaining > clampPercent(previous.remainingPercent)) {
        observed.push([
          previous.observedAtMillis + (sample.observedAtMillis - previous.observedAtMillis) / 2,
          null,
        ]);
      }
      observed.push([sample.observedAtMillis, remaining]);
    });
    const projected = forecast.projection.map(sample => [
      sample.observedAtMillis,
      clampPercent(sample.remainingPercent),
    ]);
    const firstMillis = limit.samples[0]?.observedAtMillis ?? resetAtMillis;
    const markLineData: Array<Record<string, unknown>> = [{
      name: 'Reset',
      xAxis: resetAtMillis,
      lineStyle: {color: textSecondary, type: 'dashed', width: 1},
      label: {formatter: 'Reset', color: textSecondary},
    }];
    if (forecast.depletionAtMillis !== undefined) {
      markLineData.push({
        name: 'Expected depletion',
        xAxis: forecast.depletionAtMillis,
        lineStyle: {color: danger, type: 'dashed', width: 1},
        label: {formatter: 'Runs out', color: danger},
      });
    }
    chart.setOption({
      animation: false,
      grid: {left: 42, right: 18, top: 28, bottom: 32, containLabel: false},
      tooltip: {
        trigger: 'axis',
        backgroundColor: cssToken(styles, '--surface-overlay', '#2e2e2e'),
        borderColor: border,
        textStyle: {color: textPrimary, fontSize: 11},
        formatter: formatTooltip,
      },
      xAxis: {
        type: 'time',
        min: firstMillis,
        max: resetAtMillis,
        minInterval: DAY_MILLIS,
        axisLabel: {
          color: textSecondary,
          fontSize: 10,
          hideOverlap: true,
          formatter: (value: number) => formatAxisDate(value),
        },
        axisLine: {lineStyle: {color: border}},
        splitLine: {show: false},
        axisTick: {show: false},
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        interval: 25,
        axisLabel: {color: textSecondary, fontSize: 10, formatter: '{value}%'},
        axisLine: {show: false},
        axisTick: {show: false},
        splitLine: {lineStyle: {color: withAlpha(border, 0.68)}},
      },
      series: [
        {
          name: 'Observed',
          type: 'line',
          data: observed,
          connectNulls: false,
          showSymbol: false,
          smooth: 0.2,
          smoothMonotone: 'x',
          lineStyle: {color: accent, width: 2},
          itemStyle: {color: accent},
          emphasis: {disabled: true},
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              {offset: 0, color: withAlpha(accent, 0.22)},
              {offset: 1, color: withAlpha(accent, 0)},
            ]),
          },
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            data: markLineData,
          },
        },
        {
          name: 'Projected',
          type: 'line',
          data: projected,
          showSymbol: false,
          smooth: 0.2,
          smoothMonotone: 'x',
          lineStyle: {color: accent, width: 2, type: 'dashed'},
          itemStyle: {color: accent},
          emphasis: {disabled: true},
        },
      ],
    }, {notMerge: true});
  }, [forecast, limit, resetAtMillis]);

  return (
    <div
      ref={containerRef}
      className="usage-history-chart"
      role="img"
      aria-label="Remaining quota history and projection chart"
    />
  );
}

function cssToken(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function withAlpha(color: string, alpha: number): string {
  const hex = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (hex) {
    return `rgb(${parseInt(hex[1], 16)} ${parseInt(hex[2], 16)} ${parseInt(hex[3], 16)} / ${alpha})`;
  }
  const rgb = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) return `rgb(${rgb[1]} ${rgb[2]} ${rgb[3]} / ${alpha})`;
  return color;
}

function formatAxisDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'numeric',
    day: 'numeric',
  }).format(value);
}

function formatTooltip(params: unknown): string {
  const items = Array.isArray(params) ? params : [];
  const first = items[0] as {value?: unknown} | undefined;
  const firstValue = Array.isArray(first?.value) ? first.value : [];
  const timestamp = typeof firstValue[0] === 'number' ? firstValue[0] : Number(firstValue[0]);
  const lines = items.flatMap(item => {
    const entry = item as {seriesName?: unknown; value?: unknown};
    const value = Array.isArray(entry.value) ? Number(entry.value[1]) : Number.NaN;
    return Number.isFinite(value)
      ? [`${String(entry.seriesName ?? '')}: ${value.toFixed(1)}%`]
      : [];
  });
  const heading = Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(timestamp)
    : '';
  return [heading, ...lines].filter(Boolean).join('<br/>');
}
