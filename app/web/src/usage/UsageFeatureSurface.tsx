import React from 'react';

import {ChatFunctionSurface} from '../chat/ChatFunctionSurface';
import {formatResetCountdown, formatResetUTC, formatUpdatedAgo, tightnessTone, type UsageProviderView, type UsageViewSnapshot} from './usageTypes';

type Props = {
  snapshot: UsageViewSnapshot;
  onRefresh: () => void;
};

function accountLabel(account: UsageProviderView['accounts'][number]): string {
  return account.identity.label || account.identity.value || account.localId;
}

function ProviderRail({provider}: {provider: UsageProviderView}) {
  const remaining = provider.remainingPercent;
  const tone = remaining === undefined ? 'muted' : tightnessTone(remaining);
  return (
    <div className={`usage-provider-row tone-${tone}`}>
      <span className="usage-provider-name">{provider.name}</span>
      <span className="usage-provider-meta">
        {provider.accountCount > 1 ? `${provider.accountCount} accounts` : provider.status === 'unavailable' ? 'Not connected' : ''}
      </span>
      <span className="usage-provider-value">{remaining === undefined ? '—' : `${Math.round(remaining)}%`}</span>
      <span className="usage-quota-rail" aria-hidden="true">
        <span style={{width: `${remaining ?? 0}%`}} />
      </span>
    </div>
  );
}

function ProviderDetails({provider}: {provider: UsageProviderView}) {
  return (
    <section className="usage-detail-provider">
      <div className="usage-detail-provider-heading">
        <strong>{provider.name}</strong>
        <span>{provider.accountCount} {provider.accountCount === 1 ? 'account' : 'accounts'}</span>
      </div>
      {provider.hubs?.filter(hub => hub.status !== 'ok').map(hub => (
        <div className="usage-detail-hub-state" key={hub.hubId}>
          <span>{hub.hubId}</span>
          <span>{hub.message || (hub.status === 'error' ? 'Scan failed' : 'Not authenticated')}</span>
        </div>
      ))}
      {provider.accounts.length === 0 ? (
        <div className="usage-detail-empty">{provider.status === 'error' ? 'Scan failed' : 'Not authenticated on this Hub'}</div>
      ) : provider.accounts.map(account => (
        <div className="usage-account-card" key={`${account.localId}:${account.hubIds.join(',')}`}>
          <div className="usage-account-heading">
            <span>{accountLabel(account)}</span>
            <span>{account.plan || account.hubIds.join(', ')}</span>
          </div>
          {account.message ? <div className="usage-account-message">{account.message}</div> : null}
          {account.limits.map(limit => (
            <div className="usage-limit-line" key={limit.id}>
              <span>{limit.label}</span>
              <strong>{Math.round(limit.remainingPercent)}%</strong>
              <span title={limit.resetsAt}>{limit.resetsAt ? `${formatResetCountdown(limit.resetsAt)} · ${formatResetUTC(limit.resetsAt)}` : 'No reset time'}</span>
            </div>
          ))}
          {account.balance?.items.map(item => (
            <div className="usage-limit-line balance" key={item.currency}>
              <span>{item.currency}</span>
              <strong>{item.total}</strong>
              <span>available balance</span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

export function UsageFeatureSurface({snapshot, onRefresh}: Props) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [detail, setDetail] = React.useState(false);
  const mode = detail ? 'detail' : 'compact';
  const actions = (
    <>
      <button
        type="button"
        className="chat-function-action"
        aria-label={detail ? 'Hide limit details' : 'Show limit details'}
        title={detail ? 'Compact limits' : 'Show limit details'}
        onClick={() => setDetail(value => !value)}
      >
        <span className={`codicon ${detail ? 'codicon-list-flat' : 'codicon-layout'}`} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="chat-function-action"
        aria-label="Refresh limits"
        title="Refresh limits"
        disabled={snapshot.refreshing}
        onClick={onRefresh}
      >
        <span className={`codicon codicon-refresh${snapshot.refreshing ? ' spinning' : ''}`} aria-hidden="true" />
      </button>
    </>
  );
  return (
    <ChatFunctionSurface
      title="Limits"
      collapsed={collapsed}
      mode={mode}
      actions={actions}
      onToggleCollapsed={() => setCollapsed(value => !value)}
    >
      <div className="usage-feature-body">
        {snapshot.providers.length === 0 ? (
          <div className="usage-feature-empty">Waiting for Hub limits</div>
        ) : detail ? (
          <div className="usage-detail-list">{snapshot.providers.map(provider => <ProviderDetails key={provider.id} provider={provider} />)}</div>
        ) : (
          <div className="usage-provider-list">{snapshot.providers.map(provider => <ProviderRail key={provider.id} provider={provider} />)}</div>
        )}
        <footer className="usage-feature-footer">
          <span>{snapshot.refreshing ? 'Refreshing…' : formatUpdatedAgo(snapshot.updatedAt) || 'Hub cache'}</span>
          <span>10 min cadence</span>
        </footer>
      </div>
    </ChatFunctionSurface>
  );
}
