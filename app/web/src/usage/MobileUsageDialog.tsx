import React from 'react';

import {formatUpdatedAgo, type UsageViewSnapshot} from './usageTypes';
import {UsageDetailContent} from './UsageFeatureSurface';

type Props = {
  snapshot: UsageViewSnapshot;
  onRefresh: () => void;
  onClose: () => void;
};

export function MobileUsageDialog({snapshot, onRefresh, onClose}: Props) {
  return (
    <div
      className="usage-mobile-overlay"
      data-mobile-usage-overlay={true}
      role="dialog"
      aria-modal="true"
      aria-label="Limits"
      onPointerDown={onClose}
    >
      <section
        className="usage-mobile-dialog"
        data-mobile-usage-card={true}
        onPointerDown={event => event.stopPropagation()}
      >
        <header className="usage-mobile-header">
          <span className="usage-mobile-title">Limits</span>
          <span className="usage-mobile-actions">
            <button
              type="button"
              className="usage-mobile-action"
              aria-label="Refresh limits"
              title="Refresh limits"
              disabled={snapshot.refreshing}
              onClick={onRefresh}
            >
              <span className={`codicon codicon-refresh${snapshot.refreshing ? ' spinning' : ''}`} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="usage-mobile-action"
              aria-label="Close limits"
              title="Close limits"
              onClick={onClose}
            >
              <span className="codicon codicon-close" aria-hidden="true" />
            </button>
          </span>
        </header>
        <div className="usage-mobile-body">
          <UsageDetailContent snapshot={snapshot} />
        </div>
        <footer className="usage-mobile-footer">
          <span>{snapshot.refreshing ? 'Refreshing…' : formatUpdatedAgo(snapshot.updatedAt) || 'Hub cache'}</span>
          <span>10 min cadence</span>
        </footer>
      </section>
    </div>
  );
}
