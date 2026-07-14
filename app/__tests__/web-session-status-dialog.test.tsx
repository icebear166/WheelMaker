import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {AppSessionStatusDialog} from '../web/src/shell/AppDialogs';

function renderedText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(renderedText).join('');
  if (value && typeof value === 'object' && 'children' in value) {
    return renderedText((value as {children?: unknown}).children);
  }
  return '';
}

describe('session status dialog', () => {
  test('shows cached context immediately while refreshed limits are loading', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AppSessionStatusDialog
          sessionId="stable-session"
          cachedUsage={{used: 42000, size: 258400, updatedAt: '2026-07-14T10:00:00Z'}}
          status={null}
          loading
          error=""
          onClose={() => undefined}
          onRefresh={() => undefined}
        />,
      );
    });
    const root = renderer!.root;
    expect(renderedText(root.findByProps({'data-testid': 'session-status-id'}))).toContain('stable-session');
    expect(renderedText(root.findByProps({'data-testid': 'session-status-context'}))).toContain('42,000');
    expect(root.findByProps({'aria-label': 'Refreshing session status'})).toBeTruthy();
  });

  test('renders normalized limit windows, account data, and keeps refresh errors visible', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AppSessionStatusDialog
          sessionId="stable-session"
          cachedUsage={{used: 1, size: 2}}
          status={{
            ok: true,
            sessionId: 'stable-session',
            context: {used: 50000, size: 258400},
            limits: [
              {id: 'primary', name: '5 hour limit', usedPercent: 37, remainingPercent: 63, resetsAt: '2026-07-14T12:00:00Z'},
              {id: 'secondary', name: 'Weekly limit', usedPercent: 15, remainingPercent: 85},
            ],
            account: {
              planType: 'pro',
              credits: {hasCredits: true, unlimited: false, balance: '12.50'},
              individualLimit: {limit: '100', used: '40', remainingPercent: 60},
              rateLimitResetCredits: {availableCount: 3},
            },
            updatedAt: '2026-07-14T10:00:01Z',
          }}
          loading={false}
          error="Refresh failed; showing the last result."
          onClose={() => undefined}
          onRefresh={() => undefined}
        />,
      );
    });
    const text = renderedText(renderer!.toJSON());
    expect(text).toContain('5 hour limit');
    expect(text).toContain('Weekly limit');
    expect(text).toContain('63% remaining');
    expect(text).toContain('Pro');
    expect(text).toContain('12.50');
    expect(text).toContain('Refresh failed; showing the last result.');
    expect(renderer!.root.findAllByProps({className: 'app-session-status-limit-fill'})).toHaveLength(2);
  });
});
