import fs from 'fs';
import path from 'path';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {
  ModelEfficiencyDetailContent,
  ModelEfficiencySimpleContent,
  ModelEfficiencySnapshotContent,
} from '../web/src/modelEfficiency/ModelEfficiencyContent';
import type {ModelEfficiencyItem} from '../web/src/modelEfficiency/modelEfficiencyTypes';

const items: ModelEfficiencyItem[] = [
  {family: 'gpt-5.6-sol', effort: 'max', score: 142.4, averageCostUsd: 3.2, averageTaskSeconds: 410},
  {family: 'gpt-5.6-sol', effort: 'xhigh', score: 139.6, averageCostUsd: 2.4, averageTaskSeconds: 360},
  {family: 'gpt-5.6-sol', effort: 'high', score: 135, averageCostUsd: 1.4, averageTaskSeconds: 270},
  {family: 'gpt-5.6-sol', effort: 'medium', score: 130, averageCostUsd: 0.9, averageTaskSeconds: 210},
  {family: 'gpt-5.6-sol', effort: 'low', score: 118, averageCostUsd: 0.5, averageTaskSeconds: 120},
  {family: 'gpt-5.6-terra', effort: 'xhigh', score: 134, averageCostUsd: 2.1, averageTaskSeconds: 360},
  {family: 'gpt-5.6-terra', effort: 'medium', score: 124, averageCostUsd: 0.9, averageTaskSeconds: 210},
  {family: 'gpt-5.6-terra', effort: 'low', score: 110, averageCostUsd: 0.35, averageTaskSeconds: 90},
  {family: 'gpt-5.6-luna', effort: 'max', score: 128, averageCostUsd: 1.8, averageTaskSeconds: 330},
  {family: 'gpt-5.6-luna', effort: 'high', score: 120.6},
  {family: 'gpt-5.6-luna', effort: 'low', score: 104, averageCostUsd: 0.2, averageTaskSeconds: 80},
  {family: 'deepseek-v4-flash', effort: 'max', score: 84.4, averageCostUsd: 0.1, averageTaskSeconds: 1586},
  {family: 'deepseek-v4-flash', effort: 'high', score: 65.6, averageCostUsd: 0.09, averageTaskSeconds: 1649},
  {family: 'deepseek-v4-pro', effort: 'max', score: 83, averageCostUsd: 0.24, averageTaskSeconds: 2336},
  {family: 'deepseek-v4-pro', effort: 'high', score: 87.5, averageCostUsd: 0.17, averageTaskSeconds: 1508},
  {family: 'deepseek-v4-pro', effort: 'low', score: 88.2, averageCostUsd: 0.15, averageTaskSeconds: 1329},
];

function renderedText(node: TestRenderer.ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : renderedText(child)).join('');
}

describe('ModelEfficiencyContent', () => {
  test('renders each family once with its three score-ranked effort comparisons', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<ModelEfficiencySimpleContent items={items} />);
    });

    const list = view!.root.findByProps({'aria-label': 'Model efficiency top scores'});
    expect(list.type).toBe('div');
    expect(list.findAllByType('th')).toHaveLength(0);

    const rows = view!.root.findAll(node => node.props['data-model-efficiency-family']);
    expect(rows.map(row => row.props['data-model-efficiency-family'])).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'deepseek-v4-flash',
      'deepseek-v4-pro',
    ]);
    const solCards = rows[0].findAll(node => node.props['data-model-efficiency-card']);
    expect(solCards).toHaveLength(3);
    expect(renderedText(rows[0].findByProps({className: 'model-efficiency-family-brand'}))).toBe('GPT');
    expect(renderedText(rows[0].findByProps({className: 'model-efficiency-family-name'}))).toBe('Sol');
    expect(renderedText(rows[3].findByProps({className: 'model-efficiency-family-brand'}))).toBe('DeepSeek');
    expect(renderedText(rows[3].findByProps({className: 'model-efficiency-family-name'}))).toBe('V4 Flash');
    expect(solCards.map(card => renderedText(card.findByProps({className: 'model-efficiency-effort'}))))
      .toEqual(['Max', 'Xhigh', 'High']);
    expect(solCards.map(card => renderedText(card.findByProps({className: 'model-efficiency-score'}))))
      .toEqual(['142', '140', '135']);
    expect(solCards.map(card => renderedText(card.findByProps({className: 'model-efficiency-score-line'}))))
      .toEqual(['142Max', '140Xhigh', '135High']);
    expect(renderedText(rows[0])).toContain('142');
    expect(renderedText(rows[0])).not.toContain('142.4');
    expect(renderedText(rows[0])).not.toContain('IQ');
    expect(renderedText(rows[0])).toContain('$3.20');
    expect(renderedText(rows[0])).toContain('7m');
    expect(renderedText(rows[0])).not.toContain('50s');
    expect(renderedText(rows[0])).not.toContain('Medium');
    expect(renderedText(rows[0])).not.toContain('Low');
  });

  test('keeps all families visible without adding placeholder cards', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<ModelEfficiencySimpleContent items={[items.at(-1)!]} />);
    });

    const rows = view!.root.findAll(node => node.props['data-model-efficiency-family']);
    expect(rows).toHaveLength(5);
    expect(rows[0].findAll(node => node.props['data-model-efficiency-card'])).toHaveLength(0);
    expect(rows[0].findAllByProps({className: 'model-efficiency-family-name'})).toHaveLength(0);
    expect(rows[2].findAll(node => node.props['data-model-efficiency-card'])).toHaveLength(0);
    expect(rows[4].findAll(node => node.props['data-model-efficiency-card'])).toHaveLength(1);
    expect(renderedText(rows[4])).not.toContain('—');
  });

  test('renders Detail tables in fixed family and effort order with missing values', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<ModelEfficiencyDetailContent items={items} />);
    });

    const tables = view!.root.findAllByType('table');
    expect(tables.map(table => table.props['aria-label'])).toEqual([
      'GPT Sol model efficiency',
      'GPT Terra model efficiency',
      'GPT Luna model efficiency',
      'DeepSeek V4 Flash model efficiency',
      'DeepSeek V4 Pro model efficiency',
    ]);
    expect(tables[0].findAllByType('th').map(renderedText)).toEqual([
      'Effort',
      'Score',
      'Cost',
      'Time',
    ]);
    const solRows = tables[0].findAll(node => node.props['data-model-efficiency-effort']);
    expect(solRows.map(row => row.props['data-model-efficiency-effort'])).toEqual([
      'max',
      'xhigh',
      'high',
      'medium',
      'low',
    ]);
    const lunaHigh = tables[2].findByProps({'data-model-efficiency-effort': 'high'});
    expect(renderedText(lunaHigh)).toBe('high121——');
    const deepSeekRows = tables[3].findAll(node => node.props['data-model-efficiency-effort']);
    expect(deepSeekRows.map(row => row.props['data-model-efficiency-effort'])).toEqual(['max', 'high']);
    const deepSeekProRows = tables[4].findAll(node => node.props['data-model-efficiency-effort']);
    expect(deepSeekProRows.map(row => row.props['data-model-efficiency-effort'])).toEqual(['max', 'high', 'low']);
  });
});

describe('ModelEfficiency styling', () => {
  test('uses family-led score comparisons without nine independent cards', () => {
    const projectRoot = path.join(__dirname, '..');
    const styles = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'styles', 'modelEfficiency.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    const recommendationRule = styles.match(/\.model-efficiency-recommendation \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const familyRule = styles.match(/\.model-efficiency-family-row \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const familyHeaderRule = styles.match(/\.model-efficiency-family-heading \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const familyNameRule = styles.match(/\.model-efficiency-family-name \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const recommendationsRule = styles.match(/\.model-efficiency-family-recommendations \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const effortRule = styles.match(/\.model-efficiency-effort \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const scoreRule = styles.match(/\.model-efficiency-score \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const scoreLineRule = styles.match(/\.model-efficiency-score-line \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const metaRule = styles.match(/\.model-efficiency-meta span \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(recommendationRule).not.toContain('border:');
    expect(recommendationRule).not.toContain('background:');
    expect(recommendationRule).not.toContain('box-shadow');
    expect(familyRule).toContain('border-left: 2px solid');
    expect(familyRule).toContain('grid-template-columns: 48px minmax(0, 1fr);');
    expect(familyRule).not.toContain('grid-template-rows:');
    expect(familyNameRule).toContain('font-size: 10px;');
    expect(familyHeaderRule).toContain('padding-top: 5px;');
    expect(styles).toContain("[data-model-efficiency-family='deepseek-v4-flash']");
    expect(styles).toContain("[data-model-efficiency-family='deepseek-v4-pro']");
    expect(recommendationsRule).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(recommendationRule).toContain("'score-line'\n    'meta';");
    expect(scoreLineRule).toContain('display: flex;');
    expect(scoreLineRule).toContain('gap: 4px;');
    expect(effortRule).toContain('font-size: 9px;');
    expect(scoreRule).toContain('font-size: 17px;');
    expect(scoreRule).toContain('font-weight: 700;');
    expect(scoreRule).not.toContain('letter-spacing:');
    expect(scoreRule).toContain('var(--model-efficiency-family-color) 62%');
    expect(metaRule).toContain('font-size: 10px;');
    expect(styles).toContain('.model-efficiency-family-row:empty');
    expect(styles).not.toContain('--status-danger');
  });

  test('flattens detail families into hairline groups and shows a skeleton while loading', () => {
    const projectRoot = path.join(__dirname, '..');
    const styles = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'styles', 'modelEfficiency.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    const familyCardRule = styles.match(/\.model-efficiency-detail-family \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(familyCardRule).not.toContain('border: 1px solid');
    expect(familyCardRule).not.toContain('background:');
    expect(styles).toContain('.model-efficiency-detail-family + .model-efficiency-detail-family {');
    const tableRule = styles.match(/\.model-efficiency-detail-family table \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(tableRule).toContain('font-size: 10px;');
    expect(tableRule).toContain("font-family: 'JetBrains Mono', monospace;");
    expect(styles).toContain('.model-efficiency-skeleton-rail {');
  });

  test('renders three skeleton rows while loading', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <ModelEfficiencySnapshotContent
          snapshot={{status: 'loading', refreshing: true, items: []}}
          mode="simple"
          onRetry={jest.fn()}
        />,
      );
    });

    expect(view!.root.findAllByProps({className: 'model-efficiency-skeleton-row'})).toHaveLength(5);
    expect(view!.root.findAllByProps({className: 'model-efficiency-skeleton-family-label'})).toHaveLength(5);
    expect(view!.root.findAllByProps({className: 'model-efficiency-skeleton-rail'})).toHaveLength(15);
    expect(renderedText(view!.root)).not.toContain('Loading CodexRadar');
  });
});
