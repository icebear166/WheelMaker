import React from 'react';
import * as echarts from 'echarts/core';
import {BarChart, LineChart} from 'echarts/charts';
import {GridComponent, LegendComponent, TooltipComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';

import type {DeepSeekUsageView} from './deepSeekUsage';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export default function DeepSeekUsageChart({view}: {view: DeepSeekUsageView}) {
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
    const output = cssToken(styles, '--accent-primary', '#2784c7');
    const miss = cssToken(styles, '--state-info', '#65a3d8');
    const hit = cssToken(styles, '--state-success', '#58a86d');
    const hitRate = cssToken(styles, '--state-warning', '#d0a24f');
    const textPrimary = cssToken(styles, '--text-primary', '#dedede');
    const textSecondary = cssToken(styles, '--text-secondary', '#a3a3a3');
    const border = cssToken(styles, '--border-subtle', '#363636');
    chart.setOption({
      animation: false,
      legend: {
        textStyle: {color: textSecondary, fontSize: 10},
        top: 0,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: cssToken(styles, '--surface-overlay', '#2e2e2e'),
        borderColor: border,
        textStyle: {color: textPrimary, fontSize: 11},
        formatter: (params: unknown) => formatTooltip(params, view),
      },
      grid: {left: 46, right: 46, top: 28, bottom: 28},
      xAxis: {
        type: 'category',
        data: view.days.map(day => day.date),
        axisLabel: {
          color: textSecondary,
          fontSize: 10,
          formatter: (value: string) => value.slice(5),
        },
        axisLine: {lineStyle: {color: border}},
        axisTick: {show: false},
      },
      yAxis: [
        {
          type: 'value',
          name: 'Tokens',
          axisLabel: {color: textSecondary, fontSize: 10},
          axisLine: {show: false},
          axisTick: {show: false},
          splitLine: {lineStyle: {color: withAlpha(border, 0.68)}},
        },
        {
          type: 'value',
          min: 0,
          max: 100,
          name: 'Hit %',
          axisLabel: {color: textSecondary, fontSize: 10, formatter: '{value}%'},
          axisLine: {show: false},
          axisTick: {show: false},
          splitLine: {show: false},
        },
      ],
      series: [
        {
          name: 'Output',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 14,
          data: view.days.map(day => day.outputTokens),
          itemStyle: {color: output},
          emphasis: {disabled: true},
        },
        {
          name: 'Cache miss',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 14,
          data: view.days.map(day => day.missTokens),
          itemStyle: {color: miss},
          emphasis: {disabled: true},
        },
        {
          name: 'Cache hit',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 14,
          data: view.days.map(day => day.hitTokens),
          itemStyle: {color: hit},
          emphasis: {disabled: true},
        },
        {
          name: 'Hit rate',
          type: 'line',
          yAxisIndex: 1,
          data: view.days.map(day => Number((day.cacheHitRate * 100).toFixed(1))),
          showSymbol: false,
          smooth: 0.2,
          lineStyle: {color: hitRate, width: 2},
          itemStyle: {color: hitRate},
          emphasis: {disabled: true},
        },
      ],
    }, {notMerge: true});
  }, [view]);

  return (
    <div
      ref={containerRef}
      className="usage-history-chart deepseek-usage-chart"
      role="img"
      aria-label="Daily token usage, cache hit rate, and spend chart"
    />
  );
}

function cssToken(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

function withAlpha(color: string, alpha: number): string {
  const hex = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (hex) {
    return `rgb(${parseInt(hex[1], 16)} ${parseInt(hex[2], 16)} ${parseInt(hex[3], 16)} / ${alpha})`;
  }
  return color;
}

function trimMoney(amount: number): string {
  return amount.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
}

function formatTooltip(params: unknown, view: DeepSeekUsageView): string {
  const items = Array.isArray(params) ? params : [];
  const first = items[0] as {name?: unknown} | undefined;
  const date = String(first?.name ?? '');
  const day = view.days.find(entry => entry.date === date);
  if (!day) return '';
  const hitPercent = Math.round(day.cacheHitRate * 1000) / 10;
  const spend = day.costs
    .filter(item => item.amount > 0)
    .map(item => `${item.currency} ${trimMoney(item.amount)}`)
    .join(' · ') || '—';
  const rows = [
    `<strong>${date}</strong>`,
    `Total: ${day.totalTokens.toLocaleString()} tokens`,
    `Hit rate: ${hitPercent}%`,
    `Spend: ${spend}`,
    `Output: ${day.outputTokens.toLocaleString()}`,
    `Cache hit: ${day.hitTokens.toLocaleString()}`,
    `Cache miss: ${day.missTokens.toLocaleString()}`,
  ];
  return rows.join('<br/>');
}
