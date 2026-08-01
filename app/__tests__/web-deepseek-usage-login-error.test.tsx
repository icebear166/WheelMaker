import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {DeepSeekUsageDialog} from '../web/src/usage/DeepSeekUsageDialog';
import {requestNativeDeepSeekLogin} from '../web/src/usage/deepSeekLogin';

jest.mock('../web/src/usage/deepSeekLogin', () => ({
  nativeDeepSeekLoginAvailable: () => true,
  requestNativeDeepSeekLogin: jest.fn(),
}));

jest.mock('../web/src/usage/DeepSeekUsageChart', () => ({
  __esModule: true,
  default: () => null,
}), {virtual: true});

function renderedText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(renderedText).join('');
  if (value && typeof value === 'object' && 'children' in value) {
    return renderedText((value as {children?: unknown}).children);
  }
  return '';
}

describe('DeepSeekUsageDialog native login failures', () => {
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

  test('surfaces a native login failure instead of staying silent', async () => {
    const requestMock = requestNativeDeepSeekLogin as jest.Mock;
    requestMock.mockRejectedValueOnce(new Error('native_action_failed'));

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

    const loginButton = view!.root.findAllByProps({children: 'Login in window'})[0];
    act(() => {
      loginButton.props.onClick();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(renderedText(view!.toJSON())).toContain('native_action_failed');
  });
});
