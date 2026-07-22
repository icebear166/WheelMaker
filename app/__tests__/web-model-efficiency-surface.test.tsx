import fs from 'fs';
import path from 'path';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {
  ModelEfficiencyDetailContent,
  ModelEfficiencySimpleContent,
} from '../web/src/modelEfficiency/ModelEfficiencyContent';
import {ModelEfficiencySurface} from '../web/src/modelEfficiency/ModelEfficiencySurface';
import type {
  ModelEfficiencyItem,
  ModelEfficiencySnapshot,
} from '../web/src/modelEfficiency/modelEfficiencyTypes';

const items: ModelEfficiencyItem[] = [
  {family: 'gpt-5.6-sol', effort: 'max', score: 142, averageCostUsd: 3.2, averageTaskSeconds: 410},
  {family: 'gpt-5.6-sol', effort: 'xhigh', score: 140, averageCostUsd: 2.4, averageTaskSeconds: 360},
  {family: 'gpt-5.6-sol', effort: 'high', score: 135, averageCostUsd: 1.4, averageTaskSeconds: 270},
  {family: 'gpt-5.6-sol', effort: 'medium', score: 130, averageCostUsd: 0.9, averageTaskSeconds: 210},
  {family: 'gpt-5.6-sol', effort: 'low', score: 118, averageCostUsd: 0.5, averageTaskSeconds: 120},
  {family: 'gpt-5.6-terra', effort: 'xhigh', score: 134, averageCostUsd: 2.1, averageTaskSeconds: 360},
  {family: 'gpt-5.6-terra', effort: 'medium', score: 124, averageCostUsd: 0.9, averageTaskSeconds: 210},
  {family: 'gpt-5.6-terra', effort: 'low', score: 110, averageCostUsd: 0.35, averageTaskSeconds: 90},
  {family: 'gpt-5.6-luna', effort: 'max', score: 128, averageCostUsd: 1.8, averageTaskSeconds: 330},
  {family: 'gpt-5.6-luna', effort: 'high', score: 120},
  {family: 'gpt-5.6-luna', effort: 'low', score: 104, averageCostUsd: 0.2, averageTaskSeconds: 80},
];

const snapshot: ModelEfficiencySnapshot = {
  status: 'ready',
  refreshing: false,
  items,
  updatedAt: '2026-07-22T09:30:00Z',
};

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
    expect(renderedText(rows[0])).toContain('142');
    expect(renderedText(rows[0])).not.toContain('IQ');
    expect(renderedText(rows[0])).toContain('$3.20');
    expect(renderedText(rows[0])).toContain('6m 50s');
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
    expect(renderedText(lunaHigh)).toBe('high120——');
  });
});

describe('ModelEfficiencySurface', () => {
  test('defaults to Simple and toggles Detail, refresh, hide, and collapse independently', () => {
    const onRefresh = jest.fn();
    const onRequestHide = jest.fn();
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <ModelEfficiencySurface
          snapshot={snapshot}
          onRefresh={onRefresh}
          onRequestHide={onRequestHide}
        />,
      );
    });

    const surface = view!.root.findByProps({'aria-label': 'Model efficiency'});
    expect(surface.props['data-mode']).toBe('compact');
    expect(surface.props['data-side']).toBe('left');
    expect(surface.props.className).toContain('model-efficiency-surface');
    expect(view!.root.findByProps({'aria-label': 'Model efficiency top scores'})).toBeDefined();

    const modeButton = view!.root.findByProps({'aria-label': 'Show model efficiency details'});
    expect(modeButton.findByProps({'aria-hidden': 'true'}).props.className).toContain('codicon-layout');
    act(() => modeButton.props.onClick());
    expect(view!.root.findByProps({'aria-label': 'Model efficiency'}).props['data-mode']).toBe('detail');
    expect(view!.root.findByProps({'aria-label': 'Sol model efficiency'})).toBeDefined();
    expect(view!.root.findByProps({'aria-label': 'Hide model efficiency details'})
      .findByProps({'aria-hidden': 'true'}).props.className).toContain('codicon-list-flat');

    act(() => view!.root.findByProps({'aria-label': 'Refresh model efficiency'}).props.onClick());
    act(() => view!.root.findByProps({'aria-label': 'Hide model efficiency'}).props.onClick());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRequestHide).toHaveBeenCalledTimes(1);

    act(() => view!.root.findByProps({'aria-label': 'Collapse Model efficiency'}).props.onClick());
    expect(view!.root.findAllByProps({className: 'model-efficiency-body'})).toHaveLength(0);
  });

  test('shows loading, first-load error, stale error, source time, and attribution', () => {
    const onRefresh = jest.fn();
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <ModelEfficiencySurface
          snapshot={{status: 'loading', refreshing: true, items: []}}
          onRefresh={onRefresh}
          onRequestHide={jest.fn()}
        />,
      );
    });
    expect(renderedText(view!.root)).toContain('Loading CodexRadar data…');
    expect(view!.root.findByProps({'aria-label': 'Refresh model efficiency'}).props.disabled).toBe(true);

    act(() => view!.update(
      <ModelEfficiencySurface
        snapshot={{status: 'error', refreshing: false, items: [], error: 'Network offline'}}
        onRefresh={onRefresh}
        onRequestHide={jest.fn()}
      />,
    ));
    expect(renderedText(view!.root)).toContain('Network offline');
    act(() => view!.root.findByProps({'aria-label': 'Retry model efficiency'}).props.onClick());
    expect(onRefresh).toHaveBeenCalledTimes(1);

    act(() => view!.update(
      <ModelEfficiencySurface
        snapshot={{...snapshot, error: 'Latest refresh failed'}}
        onRefresh={onRefresh}
        onRequestHide={jest.fn()}
      />,
    ));
    expect(renderedText(view!.root)).toContain('Latest refresh failed');
    expect(renderedText(view!.root)).toContain('Updated 2026-07-22 09:30 UTC');
    const source = view!.root.findByType('a');
    expect(renderedText(source)).toBe('Data from CodexRadar');
    expect(source.props.href).toBe('https://codexradar.com/');
    expect(source.props.target).toBe('_blank');
  });

  test('uses compact source-inspired score cards without right-edge positioning', () => {
    const projectRoot = path.join(__dirname, '..');
    const styles = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'styles', 'modelEfficiency.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    const surfaceRule = styles.match(/\.model-efficiency-surface\.desktop \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const recommendationRule = styles.match(/\.model-efficiency-recommendation \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const familyRule = styles.match(/\.model-efficiency-family-row \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const modelNameRule = styles.match(/\.model-efficiency-model-name \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const scoreRule = styles.match(/\.model-efficiency-score \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const metaRule = styles.match(/\.model-efficiency-meta span \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(surfaceRule).not.toContain('position: absolute;');
    expect(surfaceRule).not.toContain('right: 0;');
    expect(recommendationRule).toContain('grid-template-areas:');
    expect(recommendationRule).toContain('grid-template-rows: 18px 31px;');
    expect(recommendationRule).toContain('grid-template-columns: minmax(0, 1fr) 40px;');
    expect(recommendationRule).toContain('var(--model-efficiency-family-color) 24%');
    expect(recommendationRule).toContain('var(--model-efficiency-family-color) 4%');
    expect(recommendationRule).toContain('inset 0 2px 0');
    expect(familyRule).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(modelNameRule).toContain('font-size: 9px;');
    expect(scoreRule).toContain('font-size: clamp(17px, 1.35vw, 20px);');
    expect(scoreRule).toContain('var(--model-efficiency-family-color) 72%');
    expect(metaRule).toContain('font-size: 8.5px;');
  });
});
