import React from 'react';
import {UsageAccount, remainingPercent, tightnessColor} from './usageTypes';
import type {UsageSnapshot} from './usageStream';

interface Props {
  snapshot: UsageSnapshot;
  onExpand: () => void;
}

function labelForProvider(provider: string): string {
  switch (provider) {
    case 'codex': return 'Codex';
    case 'kimi': return 'Kimi';
    case 'zai': return 'ZAI';
    case 'deepseek': return 'DeepSeek';
    default: return provider;
  }
}

function labelForLimitId(id: string): string {
  switch (id) {
    case '5h': return '5h';
    case 'week': return '周';
    case 'mcp-month': return 'MCP';
    default: return id;
  }
}

function renderAccountRow(account: UsageAccount): React.ReactNode {
  if (account.status === 'error') {
    return (
      <div className="usage-compact-row usage-compact-row-error" title={account.message}>
        <span className="usage-compact-provider">{labelForProvider(account.provider)}</span>
        <span className="usage-compact-value usage-compact-value-dash">—</span>
      </div>
    );
  }
  if (account.balance) {
    const balanceText = account.balance.items
      .map(item => `${item.currency} ${item.total}`)
      .join(' · ');
    const danger = !account.balance.isAvailable;
    return (
      <div className={`usage-compact-row${danger ? ' usage-compact-row-danger' : ''}`}>
        <span className="usage-compact-provider">{labelForProvider(account.provider)}</span>
        <span className="usage-compact-value">{balanceText}</span>
      </div>
    );
  }
  return (
    <div className="usage-compact-row">
      <span className="usage-compact-provider">{labelForProvider(account.provider)}</span>
      <span className="usage-compact-limits">
        {account.limits.map(limit => {
          const remaining = remainingPercent(limit);
          const tone = tightnessColor(remaining);
          return (
            <span key={limit.id} className={`usage-compact-limit usage-compact-limit-${tone}`}>
              {labelForLimitId(limit.id)} {remaining}%
            </span>
          );
        })}
      </span>
    </div>
  );
}

export function UsageCompactBar({snapshot, onExpand}: Props): React.ReactElement {
  return (
    <div
      className="usage-compact-bar"
      data-testid="usage-compact-bar"
      role="button"
      tabIndex={0}
      onClick={onExpand}
      onKeyDown={e => { if (e.key === 'Enter') onExpand(); }}
    >
      {snapshot.accounts.map(account => (
        <React.Fragment key={`${account.provider}:${JSON.stringify(account.identity)}`}>
          {renderAccountRow(account)}
        </React.Fragment>
      ))}
      {snapshot.accounts.length === 0 ? <div className="usage-compact-empty">Loading usage…</div> : null}
    </div>
  );
}
