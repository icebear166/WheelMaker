import React from 'react';
import {UsageAccount, remainingPercent} from './usageTypes';
import type {UsageSnapshot} from './usageStream';

interface Props {
  snapshot: UsageSnapshot;
  onClose: () => void;
  onRefresh?: () => void;
}

function Card({account}: {account: UsageAccount}): React.ReactElement {
  return (
    <div className={`usage-card${account.status === 'error' ? ' usage-card-error' : ''}`}>
      <div className="usage-card-header">
        <span className="usage-card-provider">{account.provider}</span>
        {account.identity.email ? <span className="usage-card-email">{account.identity.email}</span> : null}
        <span className="usage-card-hubs">{account.hubIds.join(', ')}</span>
      </div>
      {account.status === 'error' ? (
        <div className="usage-card-error-message">{account.message}</div>
      ) : account.balance ? (
        <div className="usage-card-balance">
          {account.balance.items.map(item => (
            <div key={item.currency}>{item.currency}: {item.total} (granted {item.granted}, topped up {item.toppedUp})</div>
          ))}
        </div>
      ) : (
        <div className="usage-card-limits">
          {account.limits.map(limit => {
            const remaining = remainingPercent(limit);
            return (
              <div key={limit.id} className="app-session-status-limit">
                <div className="app-session-status-limit-heading">
                  <span>{limit.label}</span>
                  <strong>{remaining}% remaining</strong>
                </div>
                <div className="app-session-status-limit-track" role="progressbar" aria-valuenow={remaining} aria-valuemin={0} aria-valuemax={100}>
                  <span className="app-session-status-limit-fill" style={{width: `${remaining}%`}} />
                </div>
                {limit.resetsAt ? <div className="app-session-status-muted">Resets {new Date(limit.resetsAt * 1000).toLocaleString()}</div> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function UsageCardPanel({snapshot, onClose, onRefresh}: Props): React.ReactElement {
  return (
    <div className="app-confirm-backdrop" role="presentation" onPointerDown={onClose}>
      <div className="usage-card-panel" role="dialog" aria-modal="true" onPointerDown={e => e.stopPropagation()}>
        <div className="usage-card-panel-header">
          <span>Agent Usage</span>
          <div>
            {onRefresh ? <button type="button" className="app-confirm-btn secondary" onClick={onRefresh}>Refresh</button> : null}
            <button type="button" className="app-confirm-btn primary" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="usage-card-panel-body">
          {snapshot.accounts.map(account => (
            <Card key={`${account.provider}:${JSON.stringify(account.identity)}`} account={account} />
          ))}
        </div>
      </div>
    </div>
  );
}
