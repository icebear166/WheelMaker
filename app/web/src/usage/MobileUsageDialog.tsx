import React from 'react';

import {ModelEfficiencySnapshotContent} from '../modelEfficiency/ModelEfficiencyContent';
import type {ModelEfficiencySnapshot} from '../modelEfficiency/modelEfficiencyTypes';
import type {UsageViewSnapshot} from './usageTypes';
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
  const [activeTab, setActiveTab] = React.useState<'limits' | 'iq'>('limits');
  const showingLimits = activeTab === 'limits';
  const refreshing = snapshot.refreshing || efficiencySnapshot.refreshing;
  const refreshDisabled = snapshot.refreshing && efficiencySnapshot.refreshing;
  const handleRefresh = () => {
    onRefresh();
    onRefreshEfficiency();
  };

  return (
    <div
      className="usage-mobile-overlay"
      data-mobile-usage-overlay={true}
      role="dialog"
      aria-modal="true"
      aria-label="Monitor"
      onPointerDown={onClose}
    >
      <section
        className="usage-mobile-dialog"
        data-mobile-usage-card={true}
        onPointerDown={event => event.stopPropagation()}
      >
        <header className="usage-mobile-header">
          <span className="usage-mobile-title">Monitor</span>
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
              id="mobile-usage-iq-tab"
              aria-label="IQ"
              aria-selected={!showingLimits}
              aria-controls="mobile-usage-iq-panel"
              tabIndex={showingLimits ? -1 : 0}
              onClick={() => setActiveTab('iq')}
            >
              IQ
            </button>
          </div>
          <span className="usage-mobile-actions">
            <button
              type="button"
              className="usage-mobile-action"
              aria-label="Refresh monitor"
              title="Refresh monitor"
              disabled={refreshDisabled}
              onClick={handleRefresh}
            >
              <span className={`codicon codicon-refresh${refreshing ? ' spinning' : ''}`} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="usage-mobile-action"
              aria-label="Close monitor"
              title="Close monitor"
              onClick={onClose}
            >
              <span className="codicon codicon-close" aria-hidden="true" />
            </button>
          </span>
        </header>
        <div
          className="usage-mobile-body"
          role="tabpanel"
          id={showingLimits ? 'mobile-usage-limits-panel' : 'mobile-usage-iq-panel'}
          aria-labelledby={showingLimits ? 'mobile-usage-limits-tab' : 'mobile-usage-iq-tab'}
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
      </section>
    </div>
  );
}
