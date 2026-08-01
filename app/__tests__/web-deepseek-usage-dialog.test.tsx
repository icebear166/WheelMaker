import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {DeepSeekUsageDialog, type DeepSeekUsageDialogState} from '../web/src/usage/DeepSeekUsageDialog';
import type {DeepSeekUsageView} from '../web/src/usage/deepSeekUsage';

jest.mock('../web/src/usage/deepSeekLogin', () => ({
  nativeDeepSeekLoginAvailable: jest.fn(() => false),
  requestNativeDeepSeekLogin: jest.fn(),
}));

jest.mock('../web/src/usage/DeepSeekUsageChart', () => ({
  __esModule: true,
  default: () => <div data-chart-stub={true} />,
}), {virtual: true});

import {nativeDeepSeekLoginAvailable, requestNativeDeepSeekLogin} from '../web/src/usage/deepSeekLogin';

const MONTH = {year: 2026, month: 8};

function makeView(overrides: Partial<DeepSeekUsageView> = {}): DeepSeekUsageView {
  return {
    status: 'ok',
    month: MONTH,
    balance: [{currency: 'CNY', total: '1.25'}],
    days: [{
      date: '2026-08-01', request: 800000, outputTokens: 700000, hitTokens: 500000, missTokens: 600000,
      totalTokens: 1800000, cacheHitRate: 500000 / 1100000,
      costs: [{currency: 'CNY', amount: 21.75}],
    }],
    spend: [{currency: 'CNY', monthlyCost: 12.75, todayCost: 21.75}],
    cachedAt: '2026-08-01T12:00:00Z',
    isCurrentMonth: true,
    isEmpty: false,
    ...overrides,
  };
}

function renderDialog(state: DeepSeekUsageDialogState, handlers: Record<string, jest.Mock> = {}) {
  const props = {
    state,
    onClose: jest.fn(),
    onRetry: jest.fn(),
    onMonthChange: jest.fn(),
    onSaveToken: jest.fn(async () => {}),
    onClearToken: jest.fn(async () => {}),
    ...handlers,
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<DeepSeekUsageDialog {...props} />);
  });
  return {renderer, props};
}

function text(renderer: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

describe('DeepSeekUsageDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the login panel with the official site link when not connected', () => {
    const {renderer} = renderDialog({status: 'notConnected', month: MONTH});
    const output = text(renderer);
    expect(output).toContain('Login DeepSeek');
    expect(output).toContain('platform.deepseek.com');
    const link = renderer.root.findByType('a');
    expect(link.props.href).toBe('https://platform.deepseek.com');
    expect(link.props.target).toBe('_blank');
  });

  it('saves a pasted token', async () => {
    const onSaveToken = jest.fn(async () => {});
    const {renderer} = renderDialog({status: 'notConnected', month: MONTH}, {onSaveToken});
    const input = renderer.root.findByType('input');
    await act(async () => {
      input.props.onChange({target: {value: '  token-abc  '}});
    });
    const saveButton = renderer.root.findAllByType('button').find(node => node.props.children === 'Save token');
    expect(saveButton).toBeDefined();
    await act(async () => {
      saveButton!.props.onClick();
    });
    expect(onSaveToken).toHaveBeenCalledWith('token-abc');
  });

  it('keeps stale data and offers re-login when expired', () => {
    const {renderer} = renderDialog({status: 'expired', month: MONTH, view: makeView()});
    const output = text(renderer);
    expect(output).toContain('Session expired');
    expect(output).toContain('CNY 12.75');
    expect(output).toContain('Login DeepSeek');
  });

  it('keeps stale data and offers retry on platform error', () => {
    const onRetry = jest.fn();
    const {renderer} = renderDialog(
      {status: 'error', message: 'platform request failed', month: MONTH, view: makeView()},
      {onRetry},
    );
    const output = text(renderer);
    expect(output).toContain('platform request failed');
    expect(output).toContain('CNY 12.75');
    const retry = renderer.root.findAllByType('button').find(node => node.props.children === 'Retry');
    expect(retry).toBeDefined();
    act(() => {
      retry!.props.onClick();
    });
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows per-currency spend, balance, updated time when ready', () => {
    const {renderer} = renderDialog({status: 'ready', view: makeView()});
    const output = text(renderer);
    expect(output).toContain('CNY 12.75');
    expect(output).toContain('CNY 21.75');
    expect(output).toContain('CNY 1.25');
    expect(output).toContain('Updated');
  });

  it('shows an empty state for months without usage', () => {
    const {renderer} = renderDialog({status: 'ready', view: makeView({isEmpty: true, days: []})});
    expect(text(renderer)).toContain('No usage recorded this month');
  });

  it('navigates months backward and forward but not past the current month', () => {
    const onMonthChange = jest.fn();
    const now = new Date();
    const current = {year: now.getFullYear(), month: now.getMonth() + 1};
    const {renderer} = renderDialog({status: 'loading', month: current}, {onMonthChange});
    const next = renderer.root.findAllByType('button').find(node => node.props['aria-label'] === 'Next month');
    expect(next!.props.disabled).toBe(true);
    const previous = renderer.root.findAllByType('button').find(node => node.props['aria-label'] === 'Previous month');
    act(() => {
      previous!.props.onClick();
    });
    const expected = current.month === 1
      ? [current.year - 1, 12]
      : [current.year, current.month - 1];
    expect(onMonthChange).toHaveBeenCalledWith(expected[0], expected[1]);
  });

  it('offers the native login button only when the bridge exists and surfaces its errors', async () => {
    (nativeDeepSeekLoginAvailable as jest.Mock).mockReturnValue(true);
    (requestNativeDeepSeekLogin as jest.Mock).mockRejectedValue(new Error('login window closed'));
    const {renderer} = renderDialog({status: 'notConnected', month: MONTH});
    const nativeButton = renderer.root.findAllByType('button').find(node => node.props.children === 'Login in window');
    expect(nativeButton).toBeDefined();
    await act(async () => {
      nativeButton!.props.onClick();
    });
    expect(text(renderer)).toContain('login window closed');
  });

  it('disconnects through onClearToken', () => {
    const onClearToken = jest.fn(async () => {});
    const {renderer} = renderDialog({status: 'ready', view: makeView()}, {onClearToken});
    const disconnect = renderer.root.findAllByType('button').find(node =>
      node.props['aria-label'] === 'Disconnect DeepSeek platform');
    expect(disconnect).toBeDefined();
    act(() => {
      disconnect!.props.onClick();
    });
    expect(onClearToken).toHaveBeenCalled();
  });
});
