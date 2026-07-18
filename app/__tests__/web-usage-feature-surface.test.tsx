import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import fs from 'fs';
import path from 'path';
import {UsageFeatureSurface} from '../web/src/usage/UsageFeatureSurface';
import type {UsageViewSnapshot} from '../web/src/usage/usageTypes';

const fixtureSnapshot: UsageViewSnapshot = {
  refreshing: false,
  providers: [{
    id: 'codex', name: 'Codex', status: 'ok', accountCount: 3, remainingPercent: 9,
    accounts: [{
      localId: 'acct-a', identity: {kind: 'email', value: 'a@example.com', label: 'a@example.com'},
      status: 'ok', hubIds: ['hub-a'],
      limits: [{id: '5h', label: '5h', remainingPercent: 9, resetsAt: '2027-01-01T05:00:00Z'}],
    }],
  }],
};

describe('UsageFeatureSurface', () => {
  it('renders one compact row per Provider and the worst account summary', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<UsageFeatureSurface snapshot={fixtureSnapshot} onRefresh={jest.fn()} />);
    });
    const json = JSON.stringify(view!.toJSON());
    expect(json).toContain('Codex');
    expect(json).toContain('9%');
    expect(json).toContain('3 accounts');
  });

  it('toggles detail mode in place and keeps refresh separate', () => {
    const onRefresh = jest.fn();
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<UsageFeatureSurface snapshot={fixtureSnapshot} onRefresh={onRefresh} />);
    });
    act(() => view!.root.findByProps({'aria-label': 'Show limit details'}).props.onClick());
    expect(view!.root.findByProps({'data-mode': 'detail'})).toBeDefined();
    act(() => view!.root.findByProps({'aria-label': 'Refresh limits'}).props.onClick());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shares the desktop edge width and keeps detail expansion vertical', () => {
    const projectRoot = path.join(__dirname, '..');
    const chatStyles = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'), 'utf8').replace(/\r\n/g, '\n');
    const usageStyles = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles', 'usage.css'), 'utf8').replace(/\r\n/g, '\n');
    const compactRule = usageStyles.match(/\.chat-function-surface\.desktop \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const detailRule = usageStyles.match(/\.chat-function-surface\.desktop\.detail \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(chatStyles).toContain('--chat-edge-surface-width: 360px;');
    expect(chatStyles).toContain('--chat-edge-surface-stack-width: var(--chat-edge-surface-width);');
    expect(chatStyles).toContain('--chat-recent-sessions-width: var(--chat-edge-surface-width);');
    expect(chatStyles).toContain('--chat-plan-desktop-width: var(--chat-edge-surface-width);');
    expect(compactRule).toContain('--chat-function-width: var(--chat-edge-surface-width);');
    expect(detailRule).not.toContain('--chat-function-width:');
  });
});
