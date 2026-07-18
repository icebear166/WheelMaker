import React, {useEffect, useRef, useState} from 'react';
import {
  UsageAccount,
  UsageLimit,
  formatResetCountdown,
  formatUpdatedAgo,
  labelForProvider,
  remainingPercent,
  tightnessColor,
} from './usageTypes';
import {UsageMeter} from './UsageMeter';
import type {UsageSnapshot} from './usageStream';

interface Props {
  snapshot: UsageSnapshot;
  onClose: () => void;
  onRefresh?: () => void;
}

function LimitRow({limit, now}: {limit: UsageLimit; now: number}): React.ReactElement {
  const remaining = remainingPercent(limit);
  const tone = tightnessColor(remaining);
  const countdown = formatResetCountdown(limit.resetsAt, now);
  return (
    <div className="usage-limit-row">
      <span className="usage-limit-label">{limit.label}</span>
      <UsageMeter remaining={remaining} tone={tone} label={limit.label} />
      <span className={`usage-limit-value usage-tone-${tone}`}>
        <strong>{remaining}%</strong>
        <span className="usage-limit-value-word">remaining</span>
      </span>
      <span className="usage-limit-reset">{countdown ? `Resets ${countdown}` : ''}</span>
    </div>
  );
}

function AccountCard({account, now}: {account: UsageAccount; now: number}): React.ReactElement {
  const balance = account.balance;
  return (
    <section className={`usage-account${account.status === 'error' ? ' usage-account--error' : ''}`}>
      <header className="usage-account-head">
        <span className="usage-account-provider">{labelForProvider(account.provider)}</span>
        {account.identity.email ? <span className="usage-account-email">{account.identity.email}</span> : null}
        <span className="usage-account-hubs">{account.hubIds.join(' · ')}</span>
      </header>
      {account.status === 'error' ? (
        <p className="usage-account-error-message">{account.message ?? 'Usage scan failed.'}</p>
      ) : balance ? (
        <div className="usage-balance">
          {balance.items.map(item => (
            <div className="usage-balance-row" key={item.currency}>
              <span className={`usage-balance-total${balance.isAvailable ? '' : ' usage-tone-danger'}`}>
                {item.currency} {item.total}
              </span>
              <span className="usage-balance-breakdown">granted {item.granted} · topped up {item.toppedUp}</span>
            </div>
          ))}
          {balance.isAvailable ? null : (
            <p className="usage-account-error-message">Balance unavailable — top up before assigning more tasks.</p>
          )}
        </div>
      ) : (
        <div className="usage-limits">
          {account.limits.map(limit => <LimitRow key={limit.id} limit={limit} now={now} />)}
        </div>
      )}
    </section>
  );
}

export function UsageCardPanel({snapshot, onClose, onRefresh}: Props): React.ReactElement {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.clearInterval(timer);
      previouslyFocused?.focus();
    };
  }, []);

  const updatedAgo = formatUpdatedAgo(snapshot.updatedAt, now);

  return (
    <div className="app-confirm-backdrop usage-panel-backdrop" role="presentation" onPointerDown={onClose}>
      <div
        className="usage-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Agent usage"
        tabIndex={-1}
        ref={panelRef}
        onPointerDown={e => e.stopPropagation()}
      >
        <header className="usage-panel-header">
          <h2 className="usage-panel-title">Agent usage</h2>
          {updatedAgo ? <span className="usage-panel-updated">Updated {updatedAgo}</span> : null}
          <div className="usage-panel-actions">
            {onRefresh ? <button type="button" className="app-confirm-btn secondary" onClick={onRefresh}>Refresh</button> : null}
            <button type="button" className="app-confirm-btn secondary" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="usage-panel-body">
          {snapshot.accounts.length === 0 ? (
            <div className="usage-panel-empty">
              <p>No agent accounts reported yet.</p>
              <p className="usage-panel-empty-hint">Usage appears here after the first provider scan.</p>
            </div>
          ) : (
            snapshot.accounts.map(account => (
              <AccountCard key={`${account.provider}:${JSON.stringify(account.identity)}`} account={account} now={now} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
