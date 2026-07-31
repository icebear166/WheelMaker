import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {writeTextToClipboard} from '../web/src/platform/clipboard';
import {AppSessionStatusDialog} from '../web/src/shell/AppDialogs';

jest.mock('../web/src/platform/clipboard', () => ({
  writeTextToClipboard: jest.fn(() => Promise.resolve()),
}));

const mockedWriteTextToClipboard = writeTextToClipboard as jest.MockedFunction<
  typeof writeTextToClipboard
>;

function renderedText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(renderedText).join('');
  if (value && typeof value === 'object' && 'children' in value) {
    return renderedText((value as {children?: unknown}).children);
  }
  return '';
}

describe('session status dialog', () => {
  beforeEach(() => {
    mockedWriteTextToClipboard.mockClear();
  });

  test('shows cached context immediately while status is loading', () => {
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
    expect(renderedText(renderer!.toJSON())).toContain('Refreshing status…');
  });

  test('renders the same session-local fields and ignores legacy provider data', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AppSessionStatusDialog
          sessionId="stable-session"
          cachedUsage={{used: 1, size: 2}}
          status={{
            ok: true,
            sessionId: 'stable-session',
            agentType: 'codex',
            context: {used: 50000, size: 258400},
            limits: [
              {id: 'legacy', name: 'Legacy limit', usedPercent: 37, remainingPercent: 63},
            ],
            account: {
              planType: 'legacy-plan',
              credits: {hasCredits: true, unlimited: false, balance: '12.50'},
            },
            updatedAt: '',
          }}
          loading={false}
          error="Refresh failed; showing the last result."
          onClose={() => undefined}
          onRefresh={() => undefined}
        />,
      );
    });
    const text = renderedText(renderer!.toJSON());
    expect(text).toContain('stable-session');
    expect(text).toContain('codex');
    expect(text).toContain('50,000');
    expect(text).toContain('Refresh failed; showing the last result.');
    expect(text).not.toContain('Legacy limit');
    expect(text).not.toContain('legacy-plan');
    expect(text).not.toContain('12.50');
    expect(text).not.toContain('Rate limits');
    expect(text).not.toContain('Account');
    expect(renderer!.root.findByProps({'data-testid': 'session-status-agent'})).toBeTruthy();
  });

  test('copies the exact session id from an accessible icon button', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AppSessionStatusDialog
          sessionId="stable-session"
          status={null}
          loading={false}
          error=""
          onClose={() => undefined}
          onRefresh={() => undefined}
        />,
      );
    });

    const copyButton = renderer!.root.findByProps({'aria-label': 'Copy session ID'});
    act(() => {
      copyButton.props.onClick();
    });
    expect(mockedWriteTextToClipboard).toHaveBeenCalledTimes(1);
    expect(mockedWriteTextToClipboard).toHaveBeenCalledWith('stable-session');
  });
});
