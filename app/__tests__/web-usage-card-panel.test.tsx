import TestRenderer, {act} from 'react-test-renderer';
import React from 'react';
import {UsageCardPanel} from '../web/src/usage/UsageCardPanel';
import {UsageSnapshot} from '../web/src/usage/usageStream';

const snap: UsageSnapshot = {
  updatedAt: 0,
  accounts: [{
    provider: 'codex', identity: {email: 'a@b.c'}, status: 'ok', hubIds: ['h1'],
    limits: [{id: '5h', label: '5h window', usedPercent: 23, resetsAt: 1784780541}],
  }],
};

function renderJSON(snapshot: UsageSnapshot) {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  act(() => {
    renderer = TestRenderer.create(<UsageCardPanel snapshot={snapshot} onClose={() => {}} />);
  });
  return JSON.stringify(renderer ? renderer.toJSON() : null);
}

describe('UsageCardPanel', () => {
  it('renders provider name + remaining percent', () => {
    const json = renderJSON(snap);
    expect(json).toContain('codex');
    expect(json).toContain('77'); // 100 - 23 = 77 remaining
    expect(json).toContain('remaining');
  });
  it('renders progress bar fill', () => {
    const json = renderJSON(snap);
    expect(json).toContain('app-session-status-limit-fill');
    expect(json).toContain('77%'); // width:77%
  });
  it('renders reset time', () => {
    const json = renderJSON(snap);
    expect(json).toContain('Resets');
  });
  it('renders Close button', () => {
    const json = renderJSON(snap);
    expect(json).toContain('Close');
  });
});
