import React from 'react';

import {ChatFunctionSurface} from '../chat/ChatFunctionSurface';
import {formatResetCountdown, formatResetUTC, formatUpdatedAgo, tightnessTone, type UsageLimit, type UsageProviderView, type UsageViewAccount, type UsageViewSnapshot} from './usageTypes';

type Props = {
  snapshot: UsageViewSnapshot;
  onRefresh: () => void;
  onRequestHide: () => void;
};

function accountLabel(account: UsageProviderView['accounts'][number]): string {
  const label = account.identity.label || account.identity.value || account.localId;
  return account.identity.kind === 'source' || label.toLowerCase() === 'opencode' ? 'Account' : label;
}

function shortLimitLabel(limit: UsageLimit): string {
  if (limit.id === '5h') return '5h';
  if (limit.id === 'week') return '1W';
  if (limit.id === 'month') return '1M';
  if (limit.id === 'mcp-month') return 'MCP';
  return limit.label;
}

type CompactLimit = UsageLimit | null;

function compactLimits(account: UsageViewAccount): CompactLimit[] {
  const limits = new Map<string, UsageLimit>();
  for (const limit of account.limits) {
    const existing = limits.get(limit.id);
    if (!existing || limit.remainingPercent < existing.remainingPercent) limits.set(limit.id, limit);
  }
  const secondary = limits.get('week') ?? limits.get('month') ?? limits.get('mcp-month') ?? null;
  return [limits.get('5h') ?? null, secondary];
}

function balanceSummary(account: UsageViewAccount): string {
  const items = account.balance?.items ?? [];
  return items.map(item => `${item.currency} ${item.total}`).join(' · ');
}

function QuotaRail({remainingPercent}: {remainingPercent: number}) {
  return (
    <span className="usage-quota-rail" aria-hidden="true">
      <span data-usage-rail-fill={true} style={{width: `${remainingPercent}%`}} />
    </span>
  );
}

function AccountRail({provider, account}: {provider: UsageProviderView; account: UsageViewAccount}) {
  const limits = compactLimits(account);
  const balance = balanceSummary(account);
  const label = `${provider.name} / ${accountLabel(account)}`;
  return (
    <div
      className="usage-provider-row"
      data-usage-provider={provider.id}
      data-usage-compact-account={`${provider.id}:${account.localId}`}
    >
      <span className="usage-provider-name" title={label}>{label}</span>
      {limits.some(limit => limit !== null) ? (
        <span className="usage-provider-metrics">
          {limits.map((limit, index) => (
            <span
              className={`usage-compact-limit ${limit ? `tone-${tightnessTone(limit.remainingPercent)}` : ''}`}
              data-usage-compact-limit={true}
              key={limit?.id ?? `empty-${index}`}
            >
              <span className="usage-compact-limit-value">
                {limit ? (
                  <>
                    <strong>{Math.round(limit.remainingPercent)}%</strong>
                    {index === 1 ? <span>{` / ${shortLimitLabel(limit)}`}</span> : null}
                  </>
                ) : <strong>--/--</strong>}
              </span>
              <QuotaRail remainingPercent={limit?.remainingPercent ?? 0} />
            </span>
          ))}
        </span>
      ) : balance ? (
        <span className="usage-provider-balance">{balance}</span>
      ) : (
        <span className="usage-provider-empty">{provider.status === 'error' ? 'Scan failed' : 'Not connected'}</span>
      )}
    </div>
  );
}

function ProviderDetails({provider}: {provider: UsageProviderView}) {
  const accounts = provider.accounts.filter(account => account.status === 'ok');
  return (
    <section className="usage-detail-provider">
      {accounts.map(account => (
        <div
          className="usage-account-card"
          data-usage-account={`${provider.id}:${account.localId}`}
          key={`${account.localId}:${account.hubIds.join(',')}`}
        >
          <div className="usage-account-heading">
            <span className="usage-account-title">
              <strong>{provider.name}</strong>
              <span> / </span>
              <span>{accountLabel(account)}</span>
            </span>
            <span className="usage-account-hubs">
              {account.hubIds.map(hubId => <span className="usage-account-hub" data-usage-hub={true} key={hubId}>{hubId}</span>)}
            </span>
          </div>
          {account.message ? <div className="usage-account-message">{account.message}</div> : null}
          {account.limits.map(limit => (
            <div
              className={`usage-limit-line tone-${tightnessTone(limit.remainingPercent)}`}
              data-usage-detail-limit={true}
              key={limit.id}
            >
              <span className="usage-limit-label">{shortLimitLabel(limit)}</span>
              <QuotaRail remainingPercent={limit.remainingPercent} />
              <strong>{Math.round(limit.remainingPercent)}%</strong>
              <span className="usage-limit-reset" title={formatResetUTC(limit.resetsAt)}>
                {limit.resetsAt ? `Reset ${formatResetCountdown(limit.resetsAt)}` : 'No reset'}
              </span>
            </div>
          ))}
          {account.balance?.items.map(item => (
            <div className="usage-limit-line balance" key={item.currency}>
              <span className="usage-limit-label">{item.currency}</span>
              <strong>{item.total}</strong>
              <span className="usage-limit-reset">Balance</span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

export function UsageDetailContent({snapshot}: {snapshot: UsageViewSnapshot}) {
  if (snapshot.providers.length === 0) {
    return <div className="usage-feature-empty">Waiting for Hub limits</div>;
  }
  const providers = snapshot.providers.filter(provider => provider.accounts.some(account => account.status === 'ok'));
  if (providers.length === 0) {
    return <div className="usage-detail-empty">No limit details</div>;
  }
  return (
    <div className="usage-detail-list">
      {providers.map(provider => <ProviderDetails key={provider.id} provider={provider} />)}
    </div>
  );
}

export function UsageFeatureSurface({snapshot, onRefresh, onRequestHide}: Props) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [detail, setDetail] = React.useState(false);
  const mode = detail ? 'detail' : 'compact';
  const compactAccounts = snapshot.providers.flatMap(provider =>
    provider.accounts
      .filter(account => account.status === 'ok')
      .map(account => ({provider, account})),
  );
  const actions = (
    <>
      <button
        type="button"
        className="chat-function-action"
        aria-label="Hide limits monitor"
        title="Hide limits monitor"
        onClick={onRequestHide}
      >
        <span className="codicon codicon-eye-closed" aria-hidden="true" />
      </button>
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
          <UsageDetailContent snapshot={snapshot} />
        ) : (
          <div className="usage-provider-list">
            {compactAccounts.map(({provider, account}) => (
              <AccountRail
                key={`${provider.id}:${account.localId}:${account.hubIds.join(',')}`}
                provider={provider}
                account={account}
              />
            ))}
          </div>
        )}
        <footer className="usage-feature-footer">
          <span>{snapshot.refreshing ? 'Refreshing…' : formatUpdatedAgo(snapshot.updatedAt) || 'Hub cache'}</span>
          <span>10 min cadence</span>
        </footer>
      </div>
    </ChatFunctionSurface>
  );
}
