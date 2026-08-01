import React from 'react';

import {formatResetCountdown, formatResetLocalSecond, formatResetUTC, tightnessTone, type UsageLimit, type UsageProviderView, type UsageViewAccount, type UsageViewSnapshot} from './usageTypes';

export type UsageOpenHistory = (
  provider: UsageProviderView,
  account: UsageViewAccount,
  trigger: HTMLElement,
) => void;

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

function AccountRail({
  provider,
  account,
  displayName,
  onOpenHistory,
}: {
  provider: UsageProviderView;
  account: UsageViewAccount;
  displayName: string;
  onOpenHistory?: UsageOpenHistory;
}) {
  const limits = compactLimits(account);
  const balance = balanceSummary(account);
  const content = (
    <>
      <span className="usage-provider-name" title={displayName}>{displayName}</span>
      {limits.some(limit => limit !== null) ? (
        <span className="usage-provider-metrics">
          {limits.map((limit, index) => (
            <span
              className={`usage-compact-limit ${limit ? `tone-${tightnessTone(limit.remainingPercent)}` : ''}`}
              data-usage-compact-limit={true}
              key={limit?.id ?? `empty-${index}`}
            >
              <span className="usage-compact-limit-header">
                <span className="usage-compact-limit-label">{limit ? shortLimitLabel(limit) : '—'}</span>
                <span className="usage-compact-limit-value">
                  {limit ? <strong>{Math.round(limit.remainingPercent)}%</strong> : <strong>-/-</strong>}
                </span>
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
    </>
  );
  if (account.limits.length > 0 && onOpenHistory) {
    return (
      <button
        type="button"
        role="button"
        className="usage-provider-row usage-account-trigger"
        data-usage-provider={provider.id}
        data-usage-compact-account={`${provider.id}:${account.localId}`}
        data-usage-account-trigger={`${provider.id}:${account.localId}`}
        onClick={event => onOpenHistory(provider, account, event.currentTarget)}
      >
        {content}
      </button>
    );
  }
  return (
    <div
      className="usage-provider-row"
      data-usage-provider={provider.id}
      data-usage-compact-account={`${provider.id}:${account.localId}`}
    >
      {content}
    </div>
  );
}

function AccountDetails({
  provider,
  account,
}: {
  provider: UsageProviderView;
  account: UsageViewAccount;
}) {
  return (
    <>
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
      {account.resetCredits?.credits?.length ? (
        <div className="usage-reset-credits" data-usage-reset-credits={true}>
          <div className="usage-reset-credits-heading">
            <span className="usage-reset-credits-label">Reset credits</span>
            <span className="usage-reset-credits-count">{account.resetCredits.availableCount} available</span>
          </div>
          {account.resetCredits.credits
            .filter(credit => credit.expiresAt)
            .sort((a, b) => String(a.expiresAt).localeCompare(String(b.expiresAt)))
            .map((credit, index) => (
              <div className="usage-reset-credit-row" key={credit.id ?? index}>
                <span className="usage-reset-credit-label">Expires</span>
                <time dateTime={credit.expiresAt}>{formatResetLocalSecond(credit.expiresAt)}</time>
              </div>
            ))}
        </div>
      ) : null}
    </>
  );
}

function ProviderDetails({
  provider,
  onOpenHistory,
}: {
  provider: UsageProviderView;
  onOpenHistory?: UsageOpenHistory;
}) {
  const accounts = provider.accounts.filter(account => account.status === 'ok');
  return (
    <section className="usage-detail-provider">
      {accounts.map(account => {
        const key = `${account.localId}:${account.hubIds.join(',')}`;
        return account.limits.length > 0 && onOpenHistory ? (
          <div
            role="button"
            tabIndex={0}
            className="usage-account-card usage-account-trigger"
            data-usage-account={`${provider.id}:${account.localId}`}
            data-usage-account-trigger={`${provider.id}:${account.localId}`}
            key={key}
            onClick={event => onOpenHistory(provider, account, event.currentTarget)}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onOpenHistory(provider, account, event.currentTarget);
            }}
          >
            <AccountDetails provider={provider} account={account} />
          </div>
        ) : (
          <div
            className="usage-account-card"
            data-usage-account={`${provider.id}:${account.localId}`}
            key={key}
          >
            <AccountDetails provider={provider} account={account} />
          </div>
        );
      })}
    </section>
  );
}

export function UsageDetailContent({
  snapshot,
  onOpenHistory,
}: {
  snapshot: UsageViewSnapshot;
  onOpenHistory?: UsageOpenHistory;
}) {
  if (snapshot.providers.length === 0) {
    return <div className="usage-feature-empty">Waiting for Hub limits</div>;
  }
  const providers = snapshot.providers.filter(provider => provider.accounts.some(account => account.status === 'ok'));
  if (providers.length === 0) {
    return <div className="usage-detail-empty">No limit details</div>;
  }
  return (
    <div className="usage-detail-list">
      {providers.map(provider => (
        <ProviderDetails key={provider.id} provider={provider} onOpenHistory={onOpenHistory} />
      ))}
    </div>
  );
}

export function UsageCompactContent({
  snapshot,
  onOpenHistory,
}: {
  snapshot: UsageViewSnapshot;
  onOpenHistory?: UsageOpenHistory;
}) {
  if (snapshot.providers.length === 0) {
    return <div className="usage-feature-empty">Waiting for Hub limits</div>;
  }
  const compactAccounts = snapshot.providers.flatMap(provider => {
    const accounts = provider.accounts.filter(account => account.status === 'ok');
    return accounts.map((account, index) => ({
      provider,
      account,
      displayName: accounts.length > 1 ? `${provider.name}-${index + 1}` : provider.name,
    }));
  });
  return (
    <div className="usage-provider-list">
      {compactAccounts.map(({provider, account, displayName}) => (
        <AccountRail
          key={`${provider.id}:${account.localId}:${account.hubIds.join(',')}`}
          provider={provider}
          account={account}
          displayName={displayName}
          onOpenHistory={onOpenHistory}
        />
      ))}
    </div>
  );
}
