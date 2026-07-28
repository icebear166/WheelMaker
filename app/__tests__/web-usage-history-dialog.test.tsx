import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {
  UsageHistoryDialog,
  type UsageHistoryDialogState,
} from '../web/src/usage/UsageHistoryDialog';
import type {UsageForecast, UsageHistoryLimit} from '../web/src/usage/usageHistory';

jest.mock('../web/src/usage/UsageHistoryChart', () => ({
  __esModule: true,
  default: () => <div aria-label="Rendered quota chart" />,
}), {virtual: true});

const HOUR = 60 * 60 * 1000;
const base = Date.parse('2026-07-28T00:00:00Z');
const resetAtMillis = base + 12 * HOUR;

const historyLimit: UsageHistoryLimit = {
  id: 'week',
  label: 'W',
  windowKind: 'fixed',
  windowDurationMins: 7 * 24 * 60,
  resetsAt: new Date(resetAtMillis).toISOString(),
  samples: [
    {observedAtMillis: base, remainingPercent: 86},
    {observedAtMillis: base + HOUR, remainingPercent: 84},
    {observedAtMillis: base + 2 * HOUR, remainingPercent: 82.4},
  ],
};

function readyState(forecast: UsageForecast): UsageHistoryDialogState {
  return {
    status: 'ready',
    providerName: 'Codex',
    accountLabel: 'user@example.com',
    limit: historyLimit,
    forecast,
  };
}

function renderedText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(renderedText).join('');
  if (value && typeof value === 'object' && 'children' in value) {
    return renderedText((value as {children?: unknown}).children);
  }
  return '';
}

describe('UsageHistoryDialog', () => {
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

  test('exposes modal semantics and history loading state', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <UsageHistoryDialog
          state={{status: 'loading', providerName: 'Codex', accountLabel: 'user@example.com'}}
          onClose={jest.fn()}
          onRetry={jest.fn()}
        />,
      );
    });
    const dialog = view!.root.findByProps({className: 'usage-history-dialog'});
    expect(dialog.props.role).toBe('dialog');
    expect(dialog.props['aria-modal']).toBe(true);
    expect(renderedText(view!.toJSON())).toContain('Loading history');
  });

  test('shows accessible observed and early-depletion summaries outside the chart', async () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <UsageHistoryDialog
          state={readyState({
            status: 'depletesBeforeReset',
            speedPerHour: 8,
            depletionAtMillis: base + 8 * HOUR,
            projection: [
              historyLimit.samples.at(-1)!,
              {observedAtMillis: base + 8 * HOUR, remainingPercent: 0},
            ],
            validIntervalCount: 2,
          })}
          onClose={jest.fn()}
          onRetry={jest.fn()}
        />,
      );
    });
    expect(renderedText(view!.toJSON())).toContain('82.4% remaining');
    expect(renderedText(view!.toJSON())).toContain('Observed');
    expect(renderedText(view!.toJSON())).toContain('Expected to run out');
    expect(renderedText(view!.toJSON())).toContain('Resets');
    expect(renderedText(view!.toJSON())).toContain('Loading chart');
    expect(renderedText(
      view!.root.findByProps({className: 'usage-history-window'}).children,
    )).toBe('W');
    expect(view!.root.findAllByProps({'data-icon-name': 'history'})).toHaveLength(1);
    expect(view!.root.findAllByProps({'data-icon-name': 'activity'})).toHaveLength(2);
    expect(view!.root.findAllByProps({'data-icon-name': 'clock'})).toHaveLength(1);
    await act(async () => {
      await Promise.resolve();
    });
  });

  test('shows safe-at-reset and insufficient-sample conclusions', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <UsageHistoryDialog
          state={readyState({
            status: 'safeUntilReset',
            speedPerHour: 1,
            remainingAtReset: 72.4,
            projection: [
              historyLimit.samples.at(-1)!,
              {observedAtMillis: resetAtMillis, remainingPercent: 72.4},
            ],
            validIntervalCount: 2,
          })}
          onClose={jest.fn()}
          onRetry={jest.fn()}
        />,
      );
    });
    expect(renderedText(view!.toJSON())).toContain('72.4% expected at reset');

    act(() => {
      view!.update(
        <UsageHistoryDialog
          state={readyState({status: 'insufficient', projection: [], validIntervalCount: 0})}
          onClose={jest.fn()}
          onRetry={jest.fn()}
        />,
      );
    });
    expect(renderedText(view!.toJSON())).toContain('at least 3 recent samples');
  });

  test('shows an all-Hub error and retries next to it', () => {
    const onRetry = jest.fn();
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <UsageHistoryDialog
          state={{
            status: 'error',
            providerName: 'Codex',
            accountLabel: 'user@example.com',
            message: 'History could not be read from any online Hub.',
          }}
          onClose={jest.fn()}
          onRetry={onRetry}
        />,
      );
    });
    expect(renderedText(view!.toJSON())).toContain('History could not be read from any online Hub.');
    act(() => view!.root.findByProps({'aria-label': 'Retry usage history'}).props.onClick());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('closes from its button, Escape, and backdrop only', () => {
    const onClose = jest.fn();
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <UsageHistoryDialog
          state={{status: 'empty', providerName: 'Codex', accountLabel: 'user@example.com'}}
          onClose={onClose}
          onRetry={jest.fn()}
        />,
      );
    });
    act(() => view!.root.findByProps({'aria-label': 'Close usage history'}).props.onClick());
    expect(onClose).toHaveBeenCalledTimes(1);

    const escape = new Event('keydown');
    Object.defineProperty(escape, 'key', {value: 'Escape'});
    act(() => document.dispatchEvent(escape));
    expect(onClose).toHaveBeenCalledTimes(2);

    const overlay = view!.root.findByProps({'data-usage-history-overlay': true});
    act(() => overlay.props.onPointerDown({target: overlay, currentTarget: overlay}));
    expect(onClose).toHaveBeenCalledTimes(3);
    act(() => overlay.props.onPointerDown({target: {}, currentTarget: overlay}));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  test('focuses close on mount and restores the account trigger on unmount', () => {
    const closeNode = {focus: jest.fn()};
    const trigger = {focus: jest.fn()} as unknown as HTMLElement;
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <UsageHistoryDialog
          state={{status: 'empty', providerName: 'Codex', accountLabel: 'user@example.com'}}
          triggerElement={trigger}
          onClose={jest.fn()}
          onRetry={jest.fn()}
        />,
        {
          createNodeMock: element =>
            element.props['aria-label'] === 'Close usage history' ? closeNode : {},
        },
      );
    });
    expect(closeNode.focus).toHaveBeenCalledTimes(1);
    act(() => view!.unmount());
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });
});
