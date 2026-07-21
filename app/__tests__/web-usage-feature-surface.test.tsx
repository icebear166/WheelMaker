import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import fs from 'fs';
import path from 'path';
import {UsageDetailContent, UsageFeatureSurface} from '../web/src/usage/UsageFeatureSurface';
import {MobileUsageDialog} from '../web/src/usage/MobileUsageDialog';
import type {UsageViewSnapshot} from '../web/src/usage/usageTypes';
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

function renderedText(node: TestRenderer.ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : renderedText(child)).join('');
}

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
      view = TestRenderer.create(<UsageFeatureSurface snapshot={fixtureSnapshot} onRefresh={jest.fn()} onRequestHide={jest.fn()} />);
    });
    const codex = view!.root.findByProps({'data-usage-provider': 'codex'});
    const metrics = codex.findAllByProps({'data-usage-compact-limit': true});
    expect(metrics).toHaveLength(2);
    expect(renderedText(metrics[0])).toBe('37%');
    expect(renderedText(metrics[1])).toContain('90% / 1W');
    expect(metrics[0].findByProps({'data-usage-rail-fill': true}).props.style.width).toBe('37%');
    expect(metrics[1].findByProps({'data-usage-rail-fill': true}).props.style.width).toBe('90%');

    const deepSeek = view!.root.findByProps({'data-usage-provider': 'deepseek'});
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
        <UsageFeatureSurface snapshot={snapshot} onRefresh={jest.fn()} onRequestHide={jest.fn()} />,
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
        <UsageFeatureSurface snapshot={snapshot} onRefresh={jest.fn()} onRequestHide={jest.fn()} />,
      );
    });

    const first = view!.root.findByProps({'data-usage-compact-account': 'kimi:kimi-a'});
    const second = view!.root.findByProps({'data-usage-compact-account': 'kimi:kimi-b'});
    expect(renderedText(first)).toContain('Kimi / first@example.com');
    expect(renderedText(first)).toContain('15%');
    expect(renderedText(first)).not.toContain('/ 5h');
    expect(renderedText(first)).toContain('80% / 1W');
    expect(renderedText(second)).toContain('Kimi / second@example.com');
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
      view = TestRenderer.create(<UsageFeatureSurface snapshot={weeklyOnly} onRefresh={jest.fn()} onRequestHide={jest.fn()} />);
    });

    const metrics = view!.root.findAllByProps({'data-usage-compact-limit': true});
    expect(metrics).toHaveLength(2);
    expect(renderedText(metrics[0])).toBe('--/--');
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
      view = TestRenderer.create(<UsageFeatureSurface snapshot={flicker} onRefresh={jest.fn()} onRequestHide={jest.fn()} />);
    });

    const metrics = view!.root.findAllByProps({'data-usage-compact-limit': true});
    expect(metrics).toHaveLength(2);
    expect(renderedText(metrics[0])).toBe('--/--');
    expect(renderedText(metrics[1])).toContain('50% / 1M');
    expect(metrics[1].findByProps({'data-usage-rail-fill': true}).props.style.width).toBe('50.38%');
  });

  it('toggles detail mode in place and keeps refresh separate', () => {
    const onRefresh = jest.fn();
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(<UsageFeatureSurface snapshot={fixtureSnapshot} onRefresh={onRefresh} onRequestHide={jest.fn()} />);
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
      view = TestRenderer.create(<UsageFeatureSurface snapshot={unavailable} onRefresh={jest.fn()} onRequestHide={jest.fn()} />);
    });
    act(() => view!.root.findByProps({'aria-label': 'Show limit details'}).props.onClick());

    expect(renderedText(view!.root)).not.toContain('not authenticated');
    expect(renderedText(view!.root)).not.toContain('Not authenticated');
    expect(view!.root.findAllByProps({'data-usage-account': 'kimi:opencode'})).toHaveLength(0);
  });

  it('requests confirmation from the title-bar eye action', () => {
    const onRequestHide = jest.fn();
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <UsageFeatureSurface snapshot={fixtureSnapshot} onRefresh={jest.fn()} onRequestHide={onRequestHide} />,
      );
    });

    act(() => view!.root.findByProps({'aria-label': 'Hide limits monitor'}).props.onClick());
    expect(onRequestHide).toHaveBeenCalledTimes(1);
  });

  it('uses the shared Limits header and collapses to the same title row', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <UsageFeatureSurface snapshot={fixtureSnapshot} onRefresh={jest.fn()} onRequestHide={jest.fn()} />,
      );
    });

    expect(view!.root.findByProps({className: 'chat-edge-surface-title'}).children).toEqual(['Limits']);
    act(() => view!.root.findByProps({'aria-label': 'Collapse Limits'}).props.onClick());
    expect(view!.root.findAllByProps({className: 'usage-feature-body'})).toHaveLength(0);
    const expand = view!.root.findByProps({'aria-label': 'Expand Limits'});
    expect(expand.findByProps({'aria-hidden': 'true'}).props.className).toContain('codicon-chevron-right');
  });

  it('renders mobile details and handles refresh, card, backdrop, and close actions', () => {
    const onRefresh = jest.fn();
    const onClose = jest.fn();
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <MobileUsageDialog snapshot={fixtureSnapshot} onRefresh={onRefresh} onClose={onClose} />,
      );
    });

    const overlay = view!.root.findByProps({'data-mobile-usage-overlay': true});
    expect(overlay.props.role).toBe('dialog');
    expect(overlay.props['aria-modal']).toBe('true');
    expect(overlay.props['aria-label']).toBe('Limits');
    expect(view!.root.findByProps({'data-usage-account': 'codex:acct-a'})).toBeDefined();

    act(() => view!.root.findByProps({'aria-label': 'Refresh limits'}).props.onClick());
    expect(onRefresh).toHaveBeenCalledTimes(1);

    const stopPropagation = jest.fn();
    act(() => view!.root.findByProps({'data-mobile-usage-card': true}).props.onPointerDown({stopPropagation}));
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    act(() => overlay.props.onPointerDown());
    act(() => view!.root.findByProps({'aria-label': 'Close limits'}).props.onClick());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('disables and animates mobile refresh while a scan is active', () => {
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <MobileUsageDialog
          snapshot={{...fixtureSnapshot, refreshing: true}}
          onRefresh={jest.fn()}
          onClose={jest.fn()}
        />,
      );
    });

    const refresh = view!.root.findByProps({'aria-label': 'Refresh limits'});
    expect(refresh.props.disabled).toBe(true);
    expect(refresh.findByProps({'aria-hidden': 'true'}).props.className).toContain('spinning');
    expect(renderedText(view!.root)).toContain('Refreshing…');
  });

  it('uses a safe-area-aware full-screen mobile limits card', () => {
    const projectRoot = path.join(__dirname, '..');
    const usageStyles = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles', 'usage.css'), 'utf8').replace(/\r\n/g, '\n');
    const overlayRule = usageStyles.match(/\.usage-mobile-overlay \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const cardRule = usageStyles.match(/\.usage-mobile-dialog \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const bodyRule = usageStyles.match(/\.usage-mobile-body \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(overlayRule).toContain('position: fixed;');
    expect(overlayRule).toContain('inset: 0;');
    expect(overlayRule).toContain('env(safe-area-inset-top)');
    expect(overlayRule).toContain('env(safe-area-inset-bottom)');
    expect(cardRule).toContain('max-height:');
    expect(bodyRule).toContain('overflow: auto;');
  });

  it('explains how to restore the monitor before hiding it', () => {
    const onPrimary = jest.fn();
    let view: TestRenderer.ReactTestRenderer;
    act(() => {
      view = TestRenderer.create(
        <AppConfirmDialog
          target={{kind: 'hideLimitsMonitor'} as ConfirmTarget}
          busy={false}
          error=""
          onCancel={jest.fn()}
          onPrimary={onPrimary}
        />,
      );
    });

    const text = renderedText(view!.root);
    expect(text).toContain('Hide limits monitor?');
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
