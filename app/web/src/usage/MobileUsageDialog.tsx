import React from 'react';

import {
  formatModelEfficiencyUpdatedAt,
  ModelEfficiencySnapshotContent,
} from '../modelEfficiency/ModelEfficiencyContent';
import type {ModelEfficiencySnapshot} from '../modelEfficiency/modelEfficiencyTypes';
import {formatUpdatedAgo, type UsageViewSnapshot} from './usageTypes';
import {UsageDetailContent} from './UsageFeatureSurface';

type Props = {
  snapshot: UsageViewSnapshot;
  efficiencySnapshot: ModelEfficiencySnapshot;
  onRefresh: () => void;
  onRefreshEfficiency: () => void;
  onClose: () => void;
};

export function MobileUsageDialog({
  snapshot,
  efficiencySnapshot,
  onRefresh,
  onRefreshEfficiency,
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = React.useState<'limits' | 'model-efficiency'>('limits');
  const showingLimits = activeTab === 'limits';
  const refreshing = showingLimits ? snapshot.refreshing : efficiencySnapshot.refreshing;
  const refreshLabel = showingLimits ? 'Refresh limits' : 'Refresh model efficiency';
  const handleRefresh = showingLimits ? onRefresh : onRefreshEfficiency;

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
              aria-label={refreshLabel}
              title={refreshLabel}
              disabled={refreshing}
              onClick={handleRefresh}
            >
              <span className={`codicon codicon-refresh${refreshing ? ' spinning' : ''}`} aria-hidden="true" />
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
        <div className="usage-mobile-tabs" role="tablist" aria-label="Usage views">
          <button
            type="button"
            role="tab"
            id="mobile-usage-limits-tab"
            aria-label="Limits"
            aria-selected={showingLimits}
            aria-controls="mobile-usage-limits-panel"
            tabIndex={showingLimits ? 0 : -1}
            onClick={() => setActiveTab('limits')}
          >
            Limits
          </button>
          <button
            type="button"
            role="tab"
            id="mobile-usage-efficiency-tab"
            aria-label="Model efficiency"
            aria-selected={!showingLimits}
            aria-controls="mobile-usage-efficiency-panel"
            tabIndex={showingLimits ? -1 : 0}
            onClick={() => setActiveTab('model-efficiency')}
          >
            Model efficiency
          </button>
        </div>
        <div
          className="usage-mobile-body"
          role="tabpanel"
          id={showingLimits ? 'mobile-usage-limits-panel' : 'mobile-usage-efficiency-panel'}
          aria-labelledby={showingLimits ? 'mobile-usage-limits-tab' : 'mobile-usage-efficiency-tab'}
        >
          {showingLimits ? (
            <UsageDetailContent snapshot={snapshot} />
          ) : (
            <ModelEfficiencySnapshotContent
              snapshot={efficiencySnapshot}
              mode="detail"
              onRetry={onRefreshEfficiency}
            />
          )}
        </div>
        <footer className="usage-mobile-footer">
          {showingLimits ? (
            <>
              <span>{snapshot.refreshing ? 'Refreshing…' : formatUpdatedAgo(snapshot.updatedAt) || 'Hub cache'}</span>
              <span>10 min cadence</span>
            </>
          ) : (
            <>
              <span>{efficiencySnapshot.refreshing
                ? 'Refreshing…'
                : formatModelEfficiencyUpdatedAt(efficiencySnapshot.updatedAt) || 'Not updated'}</span>
              <a href="https://codexradar.com/" target="_blank" rel="noreferrer">Data from CodexRadar</a>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
