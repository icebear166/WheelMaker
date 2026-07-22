import React from 'react';

import {ChatFunctionSurface} from '../chat/ChatFunctionSurface';
import {
  formatModelEfficiencyUpdatedAt,
  ModelEfficiencySnapshotContent,
} from '../modelEfficiency/ModelEfficiencyContent';
import type {ModelEfficiencySnapshot} from '../modelEfficiency/modelEfficiencyTypes';
import {UsageCompactContent, UsageDetailContent} from './UsageFeatureSurface';
import {formatUpdatedAgo, type UsageViewSnapshot} from './usageTypes';

type MonitorTab = 'limits' | 'iq';

type Props = {
  usageSnapshot: UsageViewSnapshot;
  efficiencySnapshot: ModelEfficiencySnapshot;
  onRefreshLimits: () => void;
  onRefreshIq: () => void;
  onRequestHide: () => void;
};

export function MonitorSurface({
  usageSnapshot,
  efficiencySnapshot,
  onRefreshLimits,
  onRefreshIq,
  onRequestHide,
}: Props) {
  const [activeTab, setActiveTab] = React.useState<MonitorTab>('limits');
  const [collapsed, setCollapsed] = React.useState(false);
  const [detail, setDetail] = React.useState(false);
  const refreshing = usageSnapshot.refreshing || efficiencySnapshot.refreshing;
  const refreshDisabled = usageSnapshot.refreshing && efficiencySnapshot.refreshing;
  const limitsFreshness = formatUpdatedAgo(usageSnapshot.updatedAt) || 'Hub cache';
  const iqFreshness = formatModelEfficiencyUpdatedAt(efficiencySnapshot.updatedAt)
    .replace(/^Updated /, '') || 'Not updated';
  const mode = detail ? 'detail' : 'compact';
  const handleRefresh = () => {
    onRefreshLimits();
    onRefreshIq();
  };

  const toolbar = (
    <div className="monitor-toolbar">
      <div className="monitor-tabs" role="tablist" aria-label="Monitor views">
        <button
          type="button"
          role="tab"
          id="desktop-monitor-limits-tab"
          aria-label="Limits"
          aria-selected={activeTab === 'limits'}
          aria-controls="desktop-monitor-panel"
          tabIndex={activeTab === 'limits' ? 0 : -1}
          onClick={() => setActiveTab('limits')}
        >
          Limits
        </button>
        <button
          type="button"
          role="tab"
          id="desktop-monitor-iq-tab"
          aria-label="IQ"
          aria-selected={activeTab === 'iq'}
          aria-controls="desktop-monitor-panel"
          tabIndex={activeTab === 'iq' ? 0 : -1}
          onClick={() => setActiveTab('iq')}
        >
          IQ
        </button>
      </div>
      <span className="monitor-actions">
        <button
          type="button"
          className="chat-function-action"
          aria-label="Hide monitor"
          title="Hide monitor"
          onClick={onRequestHide}
        >
          <span className="codicon codicon-eye-closed" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="chat-function-action"
          aria-label={detail ? 'Hide monitor details' : 'Show monitor details'}
          title={detail ? 'Compact monitor' : 'Show monitor details'}
          onClick={() => setDetail(value => !value)}
        >
          <span className={`codicon ${detail ? 'codicon-list-flat' : 'codicon-layout'}`} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="chat-function-action"
          aria-label="Refresh monitor"
          title={`${refreshing ? 'Refreshing monitor' : 'Refresh monitor'} · Limits: ${limitsFreshness} · IQ: ${iqFreshness}`}
          disabled={refreshDisabled}
          onClick={handleRefresh}
        >
          <span className={`codicon codicon-refresh${refreshing ? ' spinning' : ''}`} aria-hidden="true" />
        </button>
      </span>
    </div>
  );

  return (
    <ChatFunctionSurface
      title="Monitor"
      collapsed={collapsed}
      mode={mode}
      toolbar={toolbar}
      onToggleCollapsed={() => setCollapsed(value => !value)}
      className="monitor-surface"
    >
      <div
        className={`monitor-body ${activeTab}`}
        role="tabpanel"
        id="desktop-monitor-panel"
        aria-labelledby={activeTab === 'limits' ? 'desktop-monitor-limits-tab' : 'desktop-monitor-iq-tab'}
      >
        {activeTab === 'limits' ? (
          detail
            ? <UsageDetailContent snapshot={usageSnapshot} />
            : <UsageCompactContent snapshot={usageSnapshot} />
        ) : (
          <ModelEfficiencySnapshotContent
            snapshot={efficiencySnapshot}
            mode={detail ? 'detail' : 'simple'}
            onRetry={onRefreshIq}
          />
        )}
      </div>
    </ChatFunctionSurface>
  );
}
