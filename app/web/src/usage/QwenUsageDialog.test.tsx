import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import fs from 'fs';
import path from 'path';

import {QwenUsageDialog} from './QwenUsageDialog';

test('starts native login directly from the Login button event', () => {
  const source = fs.readFileSync(path.join(__dirname, 'QwenUsageDialog.tsx'), 'utf8');
  expect(source).toContain('onClick={startLogin}');
  expect(source).not.toContain('onClick={() => { void runLogin(); }}');
});

const account = {
  localId: 'bailian-token-plan',
  identity: {kind: 'source', label: 'Bailian Token Plan'},
  status: 'ok' as const,
  limits: [],
  hubIds: ['hub-qwen'],
  sources: [{hubId: 'hub-qwen', accountLocalId: 'bailian-token-plan'}],
  qwen: {
    fiveHour: {state: 'limited' as const, remainingPercent: 80},
    week: {state: 'limited' as const, remainingPercent: 60},
  },
};

test('Qwen details use the local usage-history trend instead of an official trend status', () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <QwenUsageDialog
        account={account}
        historyState={{
          status: 'loading',
          providerName: 'Qwen',
          accountLabel: 'Bailian Token Plan',
        }}
        triggerElement={null}
        onClose={jest.fn()}
        onLogin={jest.fn()}
        onRefresh={jest.fn(async () => {})}
        onLogout={jest.fn(async () => {})}
        onHistoryRetry={jest.fn()}
      />,
    );
  });

  const text = JSON.stringify(renderer.toJSON());
  expect(text).toContain('Local usage trend');
  expect(text).not.toContain('Official 7-day trend');
});

test('Qwen details show retry state when OAuth is valid but usage is unavailable', () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <QwenUsageDialog
        account={{...account, qwen: undefined, status: 'unavailable'}}
        providerAuthenticated={true}
        providerMessage="subscription unavailable"
        historyState={{
          status: 'empty',
          providerName: 'Qwen',
          accountLabel: 'Bailian Token Plan',
        }}
        triggerElement={null}
        onClose={jest.fn()}
        onLogin={jest.fn()}
        onRefresh={jest.fn(async () => {})}
        onLogout={jest.fn(async () => {})}
        onHistoryRetry={jest.fn()}
      />,
    );
  });

  const text = JSON.stringify(renderer.toJSON());
  expect(text).toContain('Usage unavailable');
  expect(text).toContain('Retry');
  expect(text).not.toContain('Login to view Bailian Token Plan');
});
