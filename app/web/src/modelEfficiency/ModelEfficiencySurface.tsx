import React from 'react';

import {ChatFunctionSurface} from '../chat/ChatFunctionSurface';
import {
  formatModelEfficiencyUpdatedAt,
  ModelEfficiencySnapshotContent,
} from './ModelEfficiencyContent';
import type {ModelEfficiencySnapshot} from './modelEfficiencyTypes';

type Props = {
  snapshot: ModelEfficiencySnapshot;
  onRefresh: () => void;
  onRequestHide: () => void;
};

export function ModelEfficiencySurface({snapshot, onRefresh, onRequestHide}: Props) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [detail, setDetail] = React.useState(false);
  const mode = detail ? 'detail' : 'compact';
  const freshness = formatModelEfficiencyUpdatedAt(snapshot.updatedAt) || 'Not updated';

  const actions = (
    <>
      <a
        className="chat-function-action"
        aria-label="Data from CodexRadar"
        title="Data from CodexRadar"
        href="https://codexradar.com/"
        target="_blank"
        rel="noreferrer"
      >
        <span className="codicon codicon-link-external" aria-hidden="true" />
      </a>
      <button
        type="button"
        className="chat-function-action"
        aria-label="Hide model efficiency"
        title="Hide model efficiency"
        onClick={onRequestHide}
      >
        <span className="codicon codicon-eye-closed" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="chat-function-action"
        aria-label={detail ? 'Hide model efficiency details' : 'Show model efficiency details'}
        title={detail ? 'Compact model efficiency' : 'Show model efficiency details'}
        onClick={() => setDetail(value => !value)}
      >
        <span className={`codicon ${detail ? 'codicon-list-flat' : 'codicon-layout'}`} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="chat-function-action"
        aria-label="Refresh model efficiency"
        title={snapshot.refreshing
          ? 'Refreshing model efficiency'
          : `Refresh model efficiency · ${freshness}`}
        disabled={snapshot.refreshing}
        onClick={onRefresh}
      >
        <span className={`codicon codicon-refresh${snapshot.refreshing ? ' spinning' : ''}`} aria-hidden="true" />
      </button>
    </>
  );

  return (
    <ChatFunctionSurface
      title="Model efficiency"
      collapsed={collapsed}
      mode={mode}
      actions={actions}
      onToggleCollapsed={() => setCollapsed(value => !value)}
      className="model-efficiency-surface"
    >
      <div className="model-efficiency-body">
        <ModelEfficiencySnapshotContent
          snapshot={snapshot}
          mode={detail ? 'detail' : 'simple'}
          onRetry={onRefresh}
        />
      </div>
    </ChatFunctionSurface>
  );
}
