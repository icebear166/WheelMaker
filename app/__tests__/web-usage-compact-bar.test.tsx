import TestRenderer, {act} from 'react-test-renderer';
import React from 'react';
import {UsageCompactBar} from '../web/src/usage/UsageCompactBar';
import {UsageSnapshot} from '../web/src/usage/usageStream';

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
    expect(json).toContain('usage-meter--danger');
    expect(json).toContain('usage-tone-danger');
    expect(json).toContain('usage-meter--default');
    expect(json).toContain('"5h"');   // 5h label node
    expect(json).toContain('"周"');   // week label node (Chinese)
  });
  it('renders meter ticks for each limit', () => {
    const json = renderJSON(snap);
    expect(json).toContain('usage-meter-tick--lit');
    // 5% remaining → 1 lit tick; 50% remaining → 3 lit ticks (5 ticks per meter)
    expect(json).toContain('"aria-valuenow":5');
    expect(json).toContain('"aria-valuenow":50');
  });
  it('renders DeepSeek balance text', () => {
    const json = renderJSON(snap);
    expect(json).toContain('CNY');
    expect(json).toContain('110');
  });
  it('renders error dash for failed provider', () => {
    const json = renderJSON(snap);
    expect(json).toContain('usage-chip-dash');
  });
  it('renders empty state when no accounts', () => {
    const json = renderJSON({accounts: [], updatedAt: 0});
    expect(json).toContain('Loading usage');
  });
});
