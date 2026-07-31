import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {DeepSeekUsageDialog, type DeepSeekUsageDialogState} from '../web/src/usage/DeepSeekUsageDialog';

jest.mock('../web/src/usage/DeepSeekUsageChart', () => ({
  __esModule: true,
  default: () => <div aria-label="Rendered deepseek chart" />,
}), {virtual: true});

function renderedText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(renderedText).join('');
  if (value && typeof value === 'object' && 'children' in value) {
    return renderedText((value as {children?: unknown}).children);
  }
  return '';
}

describe('DeepSeekUsageDialog', () => {
  const originalDocument = globalThis.document;

  beforeAll(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: new EventTarget(),
    });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
  });

  test('ready state renders summary and month label', async () => {
    const state: DeepSeekUsageDialogState = {
      status: 'ready',
      view: {
        status: 'ok',
        month: {year: 2026, month: 8},
        balance: [{currency: 'CNY', total: '3.24'}],
        days: [{
          date: '2026-08-01',
          request: 3,
          outputTokens: 120,
          hitTokens: 300,
          missTokens: 100,
          totalTokens: 520,
          cacheHitRate: 0.75,
          cost: 0.02,
        }],
        costs: [{currency: 'CNY', monthlyCost: 8.8, todayCost: 0.02, daily: [{date: '2026-08-01', amount: 0.02}]}],
        monthlyCost: 8.8,
        todayCost: 0.02,
        currency: 'CNY',
      },
    };
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <DeepSeekUsageDialog
          state={state}
          onClose={jest.fn()}
          onRetry={jest.fn()}
          onMonthChange={jest.fn()}
          onSaveToken={jest.fn()}
          onClearToken={jest.fn()}
        />,
      );
    });
    const dialog = view!.root.findByProps({'data-deepseek-usage-dialog': true});
    expect(dialog.props.role).toBe('dialog');
    expect(dialog.props['aria-modal']).toBe(true);
    expect(renderedText(view!.toJSON())).toContain('2026-08');
    expect(renderedText(view!.toJSON())).toContain('3.24');
    await act(async () => {
      await Promise.resolve();
    });
  });

  test('notConnected state offers login and paste form', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <DeepSeekUsageDialog
          state={{status: 'notConnected', month: {year: 2026, month: 8}}}
          onClose={jest.fn()}
          onRetry={jest.fn()}
          onMonthChange={jest.fn()}
          onSaveToken={jest.fn()}
          onClearToken={jest.fn()}
        />,
      );
    });
    expect(renderedText(view!.toJSON())).toContain('Login DeepSeek');
  });

  test('expired state keeps stale data and offers re-login', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <DeepSeekUsageDialog
          state={{
            status: 'expired',
            month: {year: 2026, month: 8},
            view: {
              status: 'expired',
              month: {year: 2026, month: 8},
              balance: [{currency: 'CNY', total: '3.24'}],
              days: [],
              costs: [],
              monthlyCost: 8.8,
              todayCost: 0,
              currency: 'CNY',
            },
          }}
          onClose={jest.fn()}
          onRetry={jest.fn()}
          onMonthChange={jest.fn()}
          onSaveToken={jest.fn()}
          onClearToken={jest.fn()}
        />,
      );
    });
    expect(renderedText(view!.toJSON())).toContain('Session expired');
    expect(renderedText(view!.toJSON())).toContain('8.8');
  });
});
