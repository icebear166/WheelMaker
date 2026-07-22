import fs from 'fs';
import path from 'path';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {
  ModelEfficiencyDetailContent,
  ModelEfficiencySimpleContent,
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
];

function renderedText(node: TestRenderer.ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : renderedText(child)).join('');
}

describe('ModelEfficiencyContent', () => {
  test('renders each family as three score-ranked cards without a model column or role headers', () => {
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
    ]);
    const solCards = rows[0].findAll(node => node.props['data-model-efficiency-card']);
    expect(solCards).toHaveLength(3);
    expect(solCards.map(card => card.findByProps({className: 'model-efficiency-model-name'}).children.join('')))
      .toEqual(['Sol Max', 'Sol Xhigh', 'Sol High']);
    expect(solCards.map(card => renderedText(card.findByProps({className: 'model-efficiency-score'}))))
      .toEqual(['142', '140', '135']);
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
    expect(rows).toHaveLength(3);
    expect(rows[0].findAll(node => node.props['data-model-efficiency-card'])).toHaveLength(0);
    expect(rows[2].findAll(node => node.props['data-model-efficiency-card'])).toHaveLength(1);
    expect(renderedText(rows[2])).not.toContain('—');
  });

  test('renders Detail tables in fixed family and effort order with missing values', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<ModelEfficiencyDetailContent items={items} />);
    });

    const tables = view!.root.findAllByType('table');
    expect(tables.map(table => table.props['aria-label'])).toEqual([
      'Sol model efficiency',
      'Terra model efficiency',
      'Luna model efficiency',
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
  });
});

describe('ModelEfficiency styling', () => {
  test('uses compact split score cards with muted side accents', () => {
    const projectRoot = path.join(__dirname, '..');
    const styles = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'styles', 'modelEfficiency.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    const recommendationRule = styles.match(/\.model-efficiency-recommendation \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const familyRule = styles.match(/\.model-efficiency-family-row \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const modelNameRule = styles.match(/\.model-efficiency-model-name \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const scoreRule = styles.match(/\.model-efficiency-score \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const metaRule = styles.match(/\.model-efficiency-meta span \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(recommendationRule).toContain('grid-template-areas:');
    expect(recommendationRule).toContain('grid-template-rows: 20px 34px;');
    expect(recommendationRule).toContain('grid-template-columns: minmax(0, 1fr) 47px;');
    expect(recommendationRule).toContain('var(--model-efficiency-family-color) 20%');
    expect(recommendationRule).toContain('var(--model-efficiency-family-color) 5%');
    expect(recommendationRule).toContain('inset 3px 0 0');
    expect(familyRule).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(modelNameRule).toContain('padding: 7px 3px 1px 6px;');
    expect(modelNameRule).toContain('font-size: 9.5px;');
    expect(modelNameRule).not.toContain('text-overflow: ellipsis;');
    expect(scoreRule).toContain('font-size: clamp(18px, 1.35vw, 20px);');
    expect(scoreRule).toContain('var(--model-efficiency-family-color) 58%');
    expect(metaRule).toContain('font-size: 10.5px;');
  });
});
