import TestRenderer, {act} from 'react-test-renderer';
import React from 'react';
import {UsageCompactBar} from '../UsageCompactBar';
import {UsageSnapshot} from '../usageStream';

const snap: UsageSnapshot = {
  updatedAt: 0,
  accounts: [
    {provider: 'codex', identity: {email: 'a@b.c'}, status: 'ok', hubIds: ['h1'],
     limits: [{id: '5h', label: '5h', usedPercent: 95}, {id: 'week', label: 'Week', usedPercent: 50}]},
    {provider: 'deepseek', identity: {}, status: 'ok', hubIds: ['h1'],
     balance: {isAvailable: true, items: [{currency: 'CNY', total: '110', granted: '10', toppedUp: '100'}]}, limits: []},
    {provider: 'kimi', identity: {userId: 'u1'}, status: 'error', message: 'token expired', hubIds: ['h1'], limits: []},
  ],
};

function renderJSON(snap: UsageSnapshot) {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  act(() => {
    renderer = TestRenderer.create(<UsageCompactBar snapshot={snap} onExpand={() => {}} />);
  });
  return JSON.stringify(renderer ? renderer.toJSON() : null);
}

describe('UsageCompactBar', () => {
  it('renders all three providers', () => {
    const json = renderJSON(snap);
    expect(json).toContain('Codex');
    expect(json).toContain('Kimi');
    expect(json).toContain('DeepSeek');
  });
  it('renders limit percentages with tightness classes', () => {
    const json = renderJSON(snap);
    // codex 5h: 95% used → 5% remaining → danger
    expect(json).toContain('usage-compact-limit-danger');
    expect(json).toContain('usage-compact-limit-default');
    expect(json).toContain('"5h"');   // 5h label node
    expect(json).toContain('"周"');   // week label node (Chinese)
  });
  it('renders DeepSeek balance text', () => {
    const json = renderJSON(snap);
    expect(json).toContain('CNY');
    expect(json).toContain('110');
  });
  it('renders error dash for failed provider', () => {
    const json = renderJSON(snap);
    expect(json).toContain('usage-compact-value-dash');
  });
  it('renders empty state when no accounts', () => {
    const json = renderJSON({accounts: [], updatedAt: 0});
    expect(json).toContain('Loading usage');
  });
});
