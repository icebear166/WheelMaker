import React from 'react';
import {
  UsageAccount,
  UsageLimit,
  formatResetCountdown,
  labelForProvider,
  remainingPercent,
  tightnessColor,
} from './usageTypes';
import {UsageMeter} from './UsageMeter';
import type {UsageSnapshot} from './usageStream';

interface Props {
  snapshot: UsageSnapshot;
  onExpand: () => void;
}

function labelForLimitId(id: string): string {
  switch (id) {
    case '5h': return '5h';
    case 'week': return '周';
    case 'mcp-month': return 'MCP';
    default: return id;
  }
}

function limitTitle(limit: UsageLimit): string {
  const remaining = remainingPercent(limit);
  const countdown = formatResetCountdown(limit.resetsAt, Date.now());
  return `${limit.label} — ${remaining}% remaining${countdown ? `, resets ${countdown}` : ''}`;
}

function LimitChip({limit}: {limit: UsageLimit}): React.ReactElement {
  const remaining = remainingPercent(limit);
  const tone = tightnessColor(remaining);
  return (
    <span className="usage-chip-limit" title={limitTitle(limit)}>
      <span className="usage-chip-label">{labelForLimitId(limit.id)}</span>
      <UsageMeter remaining={remaining} tone={tone} label={limit.label} compact />
      <span className={`usage-chip-pct usage-tone-${tone}`}>{remaining}%</span>
    </span>
  );
}

function AccountChip({account}: {account: UsageAccount}): React.ReactElement {
  const provider = labelForProvider(account.provider);
  if (account.status === 'error') {
    return (
      <span className="usage-chip usage-chip--error" title={account.message ?? `${provider} usage unavailable`}>
        <span className="usage-chip-provider">{provider}</span>
        <span className="usage-chip-dash" aria-hidden="true">—</span>
      </span>
    );
  }
  if (account.balance) {
    const balance = account.balance;
    const text = balance.items.map(item => `${item.currency} ${item.total}`).join(' · ');
    return (
      <span
        className={`usage-chip${balance.isAvailable ? '' : ' usage-chip--danger'}`}
        title={balance.isAvailable ? text : 'Balance unavailable'}
      >
        <span className="usage-chip-provider">{provider}</span>
        <span className={`usage-chip-balance${balance.isAvailable ? '' : ' usage-tone-danger'}`}>{text}</span>
      </span>
    );
  }
  return (
    <span className="usage-chip">
      <span className="usage-chip-provider">{provider}</span>
      <span className="usage-chip-limits">
        {account.limits.map(limit => <LimitChip key={limit.id} limit={limit} />)}
      </span>
    </span>
  );
}

export function UsageCompactBar({snapshot, onExpand}: Props): React.ReactElement {
  return (
    <div
      className="usage-compact-bar"
      data-testid="usage-compact-bar"
      role="button"
      tabIndex={0}
      title="Agent usage — open details"
      onClick={onExpand}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onExpand();
        }
      }}
    >
      {snapshot.accounts.map(account => (
        <AccountChip key={`${account.provider}:${JSON.stringify(account.identity)}`} account={account} />
      ))}
      {snapshot.accounts.length === 0 ? (
        <span className="usage-compact-empty">
          {snapshot.updatedAt === 0 ? 'Loading usage…' : 'No agent accounts reported'}
        </span>
      ) : null}
    </div>
  );
}
