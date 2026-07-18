import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import fs from 'fs';
import path from 'path';
import {UsageFeatureSurface} from '../web/src/usage/UsageFeatureSurface';
import type {UsageViewSnapshot} from '../web/src/usage/usageTypes';

const fixtureSnapshot: UsageViewSnapshot = {
  refreshing: false,
  providers: [{
    id: 'codex', name: 'Codex', status: 'ok', accountCount: 1, remainingPercent: 37,
    accounts: [{
      localId: 'acct-a', identity: {kind: 'email', value: 'a@example.com', label: 'a@example.com'},
      status: 'ok', hubIds: ['hub-a', 'hub-b'],
      limits: [
        {id: '5h', label: '5 hours', remainingPercent: 37, resetsAt: '2027-01-01T05:00:00Z'},
        {id: 'week', label: 'Week', remainingPercent: 90, resetsAt: '2027-01-08T05:00:00Z'},
      ],
    }],
  }, {
    id: 'deepseek', name: 'DeepSeek', status: 'ok', accountCount: 1,
    accounts: [{
      localId: 'opencode', identity: {kind: 'source', label: 'OpenCode'},
      status: 'ok', hubIds: ['hub-a'], limits: [],
      balance: {isAvailable: true, items: [{currency: 'CNY', total: '12.50'}]},
    }],
  }],
};

function renderedText(node: TestRenderer.ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : renderedText(child)).join('');
}

describe('UsageFeatureSurface', () => {
  it('renders two compact quota columns and a one-line balance', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<UsageFeatureSurface snapshot={fixtureSnapshot} onRefresh={jest.fn()} />);
    });
    const codex = view!.root.findByProps({'data-usage-provider': 'codex'});
    const metrics = codex.findAllByProps({'data-usage-compact-limit': true});
    expect(metrics).toHaveLength(2);
    expect(renderedText(metrics[0])).toContain('37% / 5h');
    expect(renderedText(metrics[1])).toContain('90% / 1W');
    expect(metrics[0].findByProps({'data-usage-rail-fill': true}).props.style.width).toBe('37%');
    expect(metrics[1].findByProps({'data-usage-rail-fill': true}).props.style.width).toBe('90%');

    const deepSeek = view!.root.findByProps({'data-usage-provider': 'deepseek'});
    expect(renderedText(deepSeek)).toContain('CNY 12.50');
    expect(renderedText(deepSeek)).not.toContain('OpenCode');
  });

  it('toggles detail mode in place and keeps refresh separate', () => {
    const onRefresh = jest.fn();
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<UsageFeatureSurface snapshot={fixtureSnapshot} onRefresh={onRefresh} />);
    });
    act(() => view!.root.findByProps({'aria-label': 'Show limit details'}).props.onClick());
    expect(view!.root.findByProps({'data-mode': 'detail'})).toBeDefined();
    const codexAccount = view!.root.findByProps({'data-usage-account': 'codex:acct-a'});
    expect(renderedText(codexAccount)).toContain('Codex / a@example.com');
    expect(codexAccount.findAllByProps({'data-usage-hub': true}).map(item => renderedText(item))).toEqual(['hub-a', 'hub-b']);
    expect(codexAccount.findAllByProps({'data-usage-detail-limit': true})).toHaveLength(2);
    expect(renderedText(codexAccount)).toContain('Reset');

    const deepSeekAccount = view!.root.findByProps({'data-usage-account': 'deepseek:opencode'});
    expect(renderedText(deepSeekAccount)).toContain('DeepSeek / Account');
    expect(renderedText(deepSeekAccount)).not.toContain('OpenCode');
    act(() => view!.root.findByProps({'aria-label': 'Refresh limits'}).props.onClick());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shares the desktop edge width and keeps detail expansion vertical', () => {
    const projectRoot = path.join(__dirname, '..');
    const chatStyles = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'), 'utf8').replace(/\r\n/g, '\n');
    const usageStyles = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles', 'usage.css'), 'utf8').replace(/\r\n/g, '\n');
    const compactRule = usageStyles.match(/\.chat-function-surface\.desktop \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const detailRule = usageStyles.match(/\.chat-function-surface\.desktop\.detail \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const fixedRule = usageStyles.match(/\.chat-view-width-fixed-800 \.chat-function-surface\.desktop \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const metricsRule = usageStyles.match(/\.usage-provider-metrics \{([^}]*)\}/)?.[1] ?? '';
    const hubRule = usageStyles.match(/\.usage-account-hub \{([^}]*)\}/)?.[1] ?? '';

    expect(chatStyles).toContain('--chat-edge-surface-width: 360px;');
    expect(chatStyles).toContain('--chat-edge-surface-stack-width: var(--chat-edge-surface-width);');
    expect(chatStyles).toContain('--chat-recent-sessions-width: var(--chat-edge-surface-width);');
    expect(chatStyles).toContain('--chat-plan-desktop-width: var(--chat-edge-surface-width);');
    expect(compactRule).toContain('--chat-function-width: var(--chat-edge-surface-width);');
    expect(fixedRule).toContain('left: var(--chat-function-edge-gap);');
    expect(fixedRule).not.toContain('(100% - 800px) / 2');
    expect(detailRule).not.toContain('--chat-function-width:');
    expect(detailRule).toContain('--usage-surface-max-height: min(48vh, 420px);');
    expect(metricsRule).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(hubRule).toContain('border-radius: 999px;');
    expect(chatStyles).toContain('.chat-recent-sessions-surface.desktop .chat-edge-surface-glass,');
    expect(chatStyles).toContain('.chat-function-surface.desktop .chat-edge-surface-glass,');
  });
});
