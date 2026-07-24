import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import fs from 'fs';
import path from 'path';
import {UsageCompactContent, UsageDetailContent} from '../web/src/usage/UsageFeatureSurface';
import {MonitorSurface} from '../web/src/usage/MonitorSurface';
import {MobileUsageDialog} from '../web/src/usage/MobileUsageDialog';
import type {UsageViewSnapshot} from '../web/src/usage/usageTypes';
import type {ModelEfficiencySnapshot} from '../web/src/modelEfficiency/modelEfficiencyTypes';
import {AppConfirmDialog, type ConfirmTarget} from '../web/src/shell/AppDialogs';

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

const efficiencySnapshot: ModelEfficiencySnapshot = {
  status: 'ready',
  refreshing: false,
  updatedAt: '2026-07-22T09:30:00Z',
  items: [
    {family: 'gpt-5.6-sol', effort: 'max', score: 142, averageCostUsd: 3.2, averageTaskSeconds: 410},
    {family: 'gpt-5.6-terra', effort: 'high', score: 130, averageCostUsd: 1.9, averageTaskSeconds: 300},
    {family: 'gpt-5.6-luna', effort: 'low', score: 104, averageCostUsd: 0.2, averageTaskSeconds: 80},
  ],
};

function renderedText(node: TestRenderer.ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : renderedText(child)).join('');
}

describe('MonitorSurface module', () => {
  it('has a dedicated shared desktop surface', () => {
    expect(fs.existsSync(path.join(
      __dirname,
      '..',
      'web',
      'src',
      'usage',
      'MonitorSurface.tsx',
    ))).toBe(true);
  });

  it('shares one detail mode across the Limits and IQ tabs', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <MonitorSurface
          usageSnapshot={fixtureSnapshot}
          efficiencySnapshot={efficiencySnapshot}
          onRefreshLimits={jest.fn()}
          onRefreshIq={jest.fn()}
          onRequestHide={jest.fn()}
        />,
      );
    });

    expect(view!.root.findByProps({'aria-label': 'Monitor'}).props['data-mode']).toBe('compact');
    expect(view!.root.findByProps({role: 'tab', 'aria-label': 'Limits'}).props['aria-selected']).toBe(true);
    expect(view!.root.findByProps({role: 'tab', 'aria-label': 'IQ'}).props['aria-selected']).toBe(false);
    expect(view!.root.findAllByProps({'aria-label': 'Data from CodexRadar'})).toHaveLength(0);

    act(() => view!.root.findByProps({'aria-label': 'Show monitor details'}).props.onClick());
    act(() => view!.root.findByProps({role: 'tab', 'aria-label': 'IQ'}).props.onClick());
    expect(view!.root.findByProps({'aria-label': 'Monitor'}).props['data-mode']).toBe('detail');
    expect(view!.root.findByProps({'aria-label': 'Sol model efficiency'})).toBeDefined();
  });

  it('refreshes both data sources from one action', () => {
    const onRefreshLimits = jest.fn();
    const onRefreshIq = jest.fn();
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <MonitorSurface
          usageSnapshot={fixtureSnapshot}
          efficiencySnapshot={efficiencySnapshot}
          onRefreshLimits={onRefreshLimits}
          onRefreshIq={onRefreshIq}
          onRequestHide={jest.fn()}
        />,
      );
    });

    act(() => view!.root.findByProps({'aria-label': 'Refresh monitor'}).props.onClick());
    expect(onRefreshLimits).toHaveBeenCalledTimes(1);
    expect(onRefreshIq).toHaveBeenCalledTimes(1);
  });

  it('spins when either source refreshes and disables only when both refresh', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <MonitorSurface
          usageSnapshot={{...fixtureSnapshot, refreshing: true}}
          efficiencySnapshot={efficiencySnapshot}
          onRefreshLimits={jest.fn()}
          onRefreshIq={jest.fn()}
          onRequestHide={jest.fn()}
        />,
      );
    });

    let refresh = view!.root.findByProps({'aria-label': 'Refresh monitor'});
    expect(refresh.props.disabled).toBe(false);
    expect(refresh.findByProps({'aria-hidden': 'true'}).props.className).toContain('spinning');
    expect(refresh.props.title).toContain('Limits: Hub cache');
    expect(refresh.props.title).toContain('IQ: 2026-07-22 09:30 UTC');

    act(() => view!.update(
      <MonitorSurface
        usageSnapshot={{...fixtureSnapshot, refreshing: true}}
        efficiencySnapshot={{...efficiencySnapshot, refreshing: true}}
        onRefreshLimits={jest.fn()}
        onRefreshIq={jest.fn()}
        onRequestHide={jest.fn()}
      />,
    ));
    refresh = view!.root.findByProps({'aria-label': 'Refresh monitor'});
    expect(refresh.props.disabled).toBe(true);
  });

  it('keeps tabs and shared actions available while collapsed', () => {
    const onRequestHide = jest.fn();
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <MonitorSurface
          usageSnapshot={fixtureSnapshot}
          efficiencySnapshot={efficiencySnapshot}
          onRefreshLimits={jest.fn()}
          onRefreshIq={jest.fn()}
          onRequestHide={onRequestHide}
        />,
      );
    });

    act(() => view!.root.findByProps({'aria-label': 'Collapse Monitor'}).props.onClick());
    expect(view!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('monitor-body')))
      .toHaveLength(0);
    act(() => view!.root.findByProps({role: 'tab', 'aria-label': 'IQ'}).props.onClick());
    expect(view!.root.findByProps({role: 'tab', 'aria-label': 'IQ'}).props['aria-selected']).toBe(true);
    act(() => view!.root.findByProps({'aria-label': 'Hide monitor'}).props.onClick());
    expect(onRequestHide).toHaveBeenCalledTimes(1);
  });
});

describe('UsageFeatureSurface', () => {
  it('renders reusable account details without unavailable account noise', () => {
    const snapshot: UsageViewSnapshot = {
      ...fixtureSnapshot,
      providers: [...fixtureSnapshot.providers, {
        id: 'kimi', name: 'Kimi', status: 'unavailable', accountCount: 1,
        accounts: [{
          localId: 'opencode', identity: {kind: 'source', label: 'OpenCode'}, status: 'unavailable',
          message: 'not authenticated', limits: [], hubIds: ['hub-a'],
        }],
      }],
    };
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<UsageDetailContent snapshot={snapshot} />);
    });

    const codex = view!.root.findByProps({'data-usage-account': 'codex:acct-a'});
    expect(renderedText(codex)).toContain('Codex / a@example.com');
    expect(codex.findAllByProps({'data-usage-hub': true}).map(renderedText)).toEqual(['hub-a', 'hub-b']);
    expect(renderedText(codex)).toContain('Reset');
    expect(renderedText(view!.root)).toContain('CNY');
    expect(renderedText(view!.root)).toContain('12.50');
    expect(renderedText(view!.root)).not.toContain('not authenticated');
  });

  it('renders two compact quota columns and a one-line balance', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<UsageCompactContent snapshot={fixtureSnapshot} />);
    });
    const codex = view!.root.findByProps({'data-usage-provider': 'codex'});
    expect(renderedText(codex.findByProps({className: 'usage-provider-name'}))).toBe('Codex');
    const metrics = codex.findAllByProps({'data-usage-compact-limit': true});
    expect(metrics).toHaveLength(2);
    expect(renderedText(metrics[0])).toBe('37%');
    expect(renderedText(metrics[1])).toContain('90% / 1W');
    expect(metrics[0].findByProps({'data-usage-rail-fill': true}).props.style.width).toBe('37%');
    expect(metrics[1].findByProps({'data-usage-rail-fill': true}).props.style.width).toBe('90%');

    const deepSeek = view!.root.findByProps({'data-usage-provider': 'deepseek'});
    expect(renderedText(deepSeek.findByProps({className: 'usage-provider-name'}))).toBe('DeepSeek');
    expect(renderedText(deepSeek)).toContain('CNY 12.50');
    expect(renderedText(deepSeek)).not.toContain('OpenCode');
  });

  it('omits providers without a usable account from compact mode', () => {
    const snapshot: UsageViewSnapshot = {
      ...fixtureSnapshot,
      providers: [...fixtureSnapshot.providers, {
        id: 'kimi', name: 'Kimi', status: 'unavailable', accountCount: 1,
        accounts: [{
          localId: 'opencode', identity: {kind: 'source', label: 'OpenCode'}, status: 'unavailable',
          message: 'not authenticated', limits: [], hubIds: ['hub-a'],
        }],
      }, {
        id: 'zai', name: 'ZAI', status: 'error', accountCount: 0, accounts: [],
      }],
    };
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <UsageCompactContent snapshot={snapshot} />,
      );
    });

    expect(view!.root.findAllByProps({'data-usage-provider': 'codex'})).toHaveLength(1);
    expect(view!.root.findAllByProps({'data-usage-provider': 'deepseek'})).toHaveLength(1);
    expect(view!.root.findAllByProps({'data-usage-provider': 'kimi'})).toHaveLength(0);
    expect(view!.root.findAllByProps({'data-usage-provider': 'zai'})).toHaveLength(0);
  });

  it('renders every usable account as its own compact row', () => {
    const snapshot: UsageViewSnapshot = {
      refreshing: false,
      providers: [{
        id: 'kimi', name: 'Kimi', status: 'ok', accountCount: 2, remainingPercent: 15,
        accounts: [{
          localId: 'kimi-a', identity: {kind: 'email', value: 'first@example.com', label: 'first@example.com'},
          status: 'ok', hubIds: ['hub-a'],
          limits: [
            {id: '5h', label: '5 hours', remainingPercent: 15},
            {id: 'week', label: 'Week', remainingPercent: 80},
          ],
        }, {
          localId: 'kimi-b', identity: {kind: 'email', value: 'second@example.com', label: 'second@example.com'},
          status: 'ok', hubIds: ['hub-b'],
          limits: [
            {id: '5h', label: '5 hours', remainingPercent: 74},
            {id: 'week', label: 'Week', remainingPercent: 33},
          ],
        }],
      }],
    };
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <UsageCompactContent snapshot={snapshot} />,
      );
    });

    const first = view!.root.findByProps({'data-usage-compact-account': 'kimi:kimi-a'});
    const second = view!.root.findByProps({'data-usage-compact-account': 'kimi:kimi-b'});
    expect(renderedText(first.findByProps({className: 'usage-provider-name'}))).toBe('Kimi-1');
    expect(renderedText(first)).toContain('15%');
    expect(renderedText(first)).not.toContain('/ 5h');
    expect(renderedText(first)).toContain('80% / 1W');
    expect(renderedText(second.findByProps({className: 'usage-provider-name'}))).toBe('Kimi-2');
    expect(renderedText(second)).toContain('74%');
    expect(renderedText(second)).not.toContain('/ 5h');
    expect(renderedText(second)).toContain('33% / 1W');
    expect(view!.root.findAllByProps({'data-usage-provider': 'kimi'})).toHaveLength(2);
  });

  it('renders a missing five-hour quota as an empty compact rail', () => {
    const weeklyOnly: UsageViewSnapshot = {
      refreshing: false,
      providers: [{
        id: 'codex', name: 'Codex', status: 'ok', accountCount: 1, remainingPercent: 64,
        accounts: [{
          localId: 'current', identity: {kind: 'email', value: 'a@example.com', label: 'a@example.com'},
          status: 'ok', hubIds: ['hub-a'],
          limits: [{id: 'week', label: 'Week', remainingPercent: 64}],
        }],
      }],
    };
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<UsageCompactContent snapshot={weeklyOnly} />);
    });

    const metrics = view!.root.findAllByProps({'data-usage-compact-limit': true});
    expect(metrics).toHaveLength(2);
    expect(renderedText(metrics[0])).toBe('-/-');
    expect(metrics[0].findByProps({'data-usage-rail-fill': true}).props.style.width).toBe('0%');
    expect(renderedText(metrics[1])).toContain('64% / 1W');
  });

  it('renders MyFlicker monthly credit in the second compact slot', () => {
    const flicker: UsageViewSnapshot = {
      refreshing: false,
      providers: [{
        id: 'flicker', name: 'MyFlicker', status: 'ok', accountCount: 1, remainingPercent: 50.38,
        accounts: [{
          localId: 'user-1', identity: {kind: 'user', value: 'user-1', label: 'Account'},
          status: 'ok', hubIds: ['hub-a'],
          limits: [{id: 'month', label: 'Month', remainingPercent: 50.38}],
        }],
      }],
    };
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<UsageCompactContent snapshot={flicker} />);
    });

    const metrics = view!.root.findAllByProps({'data-usage-compact-limit': true});
    expect(metrics).toHaveLength(2);
    expect(renderedText(metrics[0])).toBe('-/-');
    expect(renderedText(metrics[1])).toContain('50% / 1M');
    expect(metrics[1].findByProps({'data-usage-rail-fill': true}).props.style.width).toBe('50.38%');
  });

  it('omits unauthenticated providers and accounts from detail mode', () => {
    const unavailable: UsageViewSnapshot = {
      ...fixtureSnapshot,
      providers: [...fixtureSnapshot.providers, {
        id: 'kimi', name: 'Kimi', status: 'unavailable', accountCount: 1,
        accounts: [{
          localId: 'opencode', identity: {kind: 'source', label: 'OpenCode'}, status: 'unavailable',
          message: 'not authenticated', limits: [], hubIds: ['hub-a'],
        }],
        hubs: [{hubId: 'hub-a', status: 'unavailable', message: 'not authenticated'}],
      }],
    };
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<UsageDetailContent snapshot={unavailable} />);
    });

    expect(renderedText(view!.root)).not.toContain('not authenticated');
    expect(renderedText(view!.root)).not.toContain('Not authenticated');
    expect(view!.root.findAllByProps({'data-usage-account': 'kimi:opencode'})).toHaveLength(0);
  });

  it('renders mobile details and handles refresh, card, backdrop, and close actions', () => {
    const onRefresh = jest.fn();
    const onRefreshEfficiency = jest.fn();
    const onClose = jest.fn();
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <MobileUsageDialog
          snapshot={fixtureSnapshot}
          efficiencySnapshot={efficiencySnapshot}
          onRefresh={onRefresh}
          onRefreshEfficiency={onRefreshEfficiency}
          onClose={onClose}
        />,
      );
    });

    const overlay = view!.root.findByProps({'data-mobile-usage-overlay': true});
    expect(overlay.props.role).toBe('dialog');
    expect(overlay.props['aria-modal']).toBe('true');
    expect(overlay.props['aria-label']).toBe('Monitor');
    const header = view!.root.findByProps({className: 'usage-mobile-header'});
    expect(renderedText(header.findByProps({className: 'usage-mobile-title'}))).toBe('Monitor');
    expect(header.findByProps({role: 'tablist', 'aria-label': 'Usage views'})).toBeDefined();
    expect(view!.root.findByProps({'data-usage-account': 'codex:acct-a'})).toBeDefined();
    expect(view!.root.findByProps({role: 'tab', 'aria-label': 'Limits'}).props['aria-selected']).toBe(true);

    act(() => view!.root.findByProps({'aria-label': 'Refresh monitor'}).props.onClick());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefreshEfficiency).toHaveBeenCalledTimes(1);

    act(() => view!.root.findByProps({role: 'tab', 'aria-label': 'IQ'}).props.onClick());
    expect(view!.root.findByProps({role: 'tab', 'aria-label': 'IQ'}).props['aria-selected']).toBe(true);
    expect(view!.root.findByProps({'aria-label': 'Sol model efficiency'})).toBeDefined();
    expect(view!.root.findAllByProps({'data-usage-account': 'codex:acct-a'})).toHaveLength(0);
    expect(view!.root.findAllByProps({className: 'usage-mobile-footer'})).toHaveLength(0);
    expect(renderedText(view!.root)).not.toContain('Data from CodexRadar');
    expect(view!.root.findAllByProps({'aria-label': 'Show monitor details'})).toHaveLength(0);

    const stopPropagation = jest.fn();
    act(() => view!.root.findByProps({'data-mobile-usage-card': true}).props.onPointerDown({stopPropagation}));
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    act(() => overlay.props.onPointerDown());
    act(() => view!.root.findByProps({'aria-label': 'Close monitor'}).props.onClick());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps mobile refresh available while only one source is active', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <MobileUsageDialog
          snapshot={{...fixtureSnapshot, refreshing: true}}
          efficiencySnapshot={efficiencySnapshot}
          onRefresh={jest.fn()}
          onRefreshEfficiency={jest.fn()}
          onClose={jest.fn()}
        />,
      );
    });

    const refresh = view!.root.findByProps({'aria-label': 'Refresh monitor'});
    expect(refresh.props.disabled).toBe(false);
    expect(refresh.findByProps({'aria-hidden': 'true'}).props.className).toContain('spinning');
    expect(renderedText(view!.root)).not.toContain('Refreshing…');
  });

  it('disables mobile refresh only while both sources refresh', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <MobileUsageDialog
          snapshot={{...fixtureSnapshot, refreshing: true}}
          efficiencySnapshot={{...efficiencySnapshot, refreshing: true}}
          onRefresh={jest.fn()}
          onRefreshEfficiency={jest.fn()}
          onClose={jest.fn()}
        />,
      );
    });

    const refresh = view!.root.findByProps({'aria-label': 'Refresh monitor'});
    expect(refresh.props.disabled).toBe(true);
    expect(refresh.findByProps({'aria-hidden': 'true'}).props.className).toContain('spinning');
    expect(view!.root.findByProps({role: 'tab', 'aria-label': 'Limits'}).props['aria-selected']).toBe(true);
  });

  it('uses a safe-area-aware full-screen mobile Monitor card', () => {
    const projectRoot = path.join(__dirname, '..');
    const usageStyles = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles', 'usage.css'), 'utf8').replace(/\r\n/g, '\n');
    const overlayRule = usageStyles.match(/\.usage-mobile-overlay \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const cardRule = usageStyles.match(/\.usage-mobile-dialog \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const bodyRule = usageStyles.match(/\.usage-mobile-body \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const tabsRule = usageStyles.match(/\.usage-mobile-tabs \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(overlayRule).toContain('position: fixed;');
    expect(overlayRule).toContain('inset: 0;');
    expect(overlayRule).toContain('env(safe-area-inset-top)');
    expect(overlayRule).toContain('env(safe-area-inset-bottom)');
    expect(cardRule).toContain('max-height:');
    expect(cardRule).toContain('max-width: 100%;');
    expect(cardRule).toContain('min-width: 0;');
    expect(cardRule).toContain('100vw - 24px');
    expect(cardRule).toContain('env(safe-area-inset-left)');
    expect(cardRule).toContain('env(safe-area-inset-right)');
    expect(bodyRule).toContain('overflow: auto;');
    expect(tabsRule).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');

    const efficiencyStyles = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles', 'modelEfficiency.css'), 'utf8').replace(/\r\n/g, '\n');
    const detailTableRule = efficiencyStyles.match(/\.model-efficiency-detail-family table \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(detailTableRule).toContain('table-layout: fixed;');
  });

  it('renders Monitor tabs as visible segmented toggles on desktop and mobile', () => {
    const projectRoot = path.join(__dirname, '..');
    const styles = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles', 'usage.css'), 'utf8').replace(/\r\n/g, '\n');
    const desktopTrack = styles.match(/\.monitor-tabs \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const desktopSelected = styles.match(/\.monitor-tabs button\[aria-selected='true'\] \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const mobileTrack = styles.match(/\.usage-mobile-tabs \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const mobileSelected = styles.match(/\.usage-mobile-tabs button\[aria-selected='true'\] \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(desktopTrack).toContain('background: color-mix(in srgb, var(--surface-root) 68%, transparent);');
    expect(desktopSelected).toContain('inset 0 0 0 1px');
    expect(desktopSelected).toContain('color: var(--accent-primary);');
    expect(desktopSelected).toContain('var(--accent-primary) 18%');
    expect(mobileTrack).toContain('border: 1px solid');
    expect(mobileSelected).toContain('inset 0 0 0 1px');
    expect(mobileSelected).toContain('color: var(--accent-primary);');
    expect(mobileSelected).toContain('var(--accent-primary) 18%');
  });

  it('explains how to restore the monitor before hiding it', () => {
    const onPrimary = jest.fn();
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <AppConfirmDialog
          target={{kind: 'hideMonitor'} as ConfirmTarget}
          busy={false}
          error=""
          onCancel={jest.fn()}
          onPrimary={onPrimary}
        />,
      );
    });

    const text = renderedText(view!.root);
    expect(text).toContain('Hide monitor?');
    expect(text).toContain('Settings > Chat');
    const primary = view!.root.findAllByType('button').find(button => renderedText(button).includes('Hide'));
    expect(primary).toBeDefined();
    act(() => primary!.props.onClick());
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('shares the desktop edge width and keeps detail expansion vertical', () => {
    const projectRoot = path.join(__dirname, '..');
    const chatStyles = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'), 'utf8').replace(/\r\n/g, '\n');
    const usageStyles = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles', 'usage.css'), 'utf8').replace(/\r\n/g, '\n');
    const compactRule = usageStyles.match(/\.chat-function-surface\.desktop \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const detailRule = usageStyles.match(/\.chat-function-surface\.desktop\.detail \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const fixedRule = usageStyles.match(/\.chat-view-width-fixed-800 \.chat-function-surface\.desktop \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const stackItemRule = chatStyles.match(/\.chat-edge-surface-stack > \.chat-recent-sessions-surface\.desktop,\n\.chat-edge-surface-stack > \.chat-plan-surface\.desktop,\n\.chat-edge-surface-stack > \.chat-function-surface\.desktop \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const metricsRule = usageStyles.match(/\.usage-provider-metrics \{([^}]*)\}/)?.[1] ?? '';
    const hubRule = usageStyles.match(/\.usage-account-hub \{([^}]*)\}/)?.[1] ?? '';
    const headerRule = chatStyles.match(/\.chat-edge-surface-header \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const compactValueRule = usageStyles.match(/\.usage-compact-limit-value \{([^}]*)\}/)?.[1] ?? '';

    expect(chatStyles).toContain('--chat-edge-surface-width: var(--chat-session-panel-width);');
    expect(chatStyles).toContain('--chat-edge-surface-stack-width: var(--chat-edge-surface-width);');
    expect(chatStyles).toContain('--chat-recent-sessions-width: var(--chat-edge-surface-width);');
    expect(chatStyles).toContain('--chat-plan-desktop-width: var(--chat-edge-surface-width);');
    expect(compactRule).toContain('--chat-function-width: var(--chat-edge-surface-width);');
    expect(compactRule).not.toContain('position: absolute;');
    expect(compactRule).not.toContain('bottom:');
    expect(compactRule).toContain('border-radius: 8px;');
    expect(fixedRule).toBe('');
    expect(stackItemRule).toContain('position: relative;');
    expect(stackItemRule).toContain('bottom: auto;');
    expect(stackItemRule).toContain('width: 100%;');
    expect(detailRule).not.toContain('--chat-function-width:');
    expect(detailRule).toContain('--usage-surface-max-height: min(48vh, 420px);');
    expect(metricsRule).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(hubRule).toContain('border-radius: 999px;');
    expect(headerRule).toContain('grid-template-columns: 22px auto minmax(0, 1fr) auto auto;');
    expect(headerRule).toContain('min-height: 36px;');
    expect(compactValueRule).toContain('justify-content: flex-end;');
    expect(chatStyles).toContain('.chat-recent-sessions-surface.desktop .chat-edge-surface-glass,');
    expect(chatStyles).toContain('.chat-function-surface.desktop .chat-edge-surface-glass,');
  });
});
