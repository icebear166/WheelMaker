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

  const actions = (
    <>
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
        aria-label={detail ? 'Show simple model efficiency' : 'Show model efficiency details'}
        title={detail ? 'Simple model efficiency' : 'Show model efficiency details'}
        onClick={() => setDetail(value => !value)}
      >
        <span className={`codicon ${detail ? 'codicon-table' : 'codicon-list-flat'}`} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="chat-function-action"
        aria-label="Refresh model efficiency"
        title="Refresh model efficiency"
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
      side="right"
      className="model-efficiency-surface"
    >
      <div className="model-efficiency-body">
        <ModelEfficiencySnapshotContent
          snapshot={snapshot}
          mode={detail ? 'detail' : 'simple'}
          onRetry={onRefresh}
        />
        <footer className="model-efficiency-footer">
          <span>{snapshot.refreshing
            ? 'Refreshing…'
            : formatModelEfficiencyUpdatedAt(snapshot.updatedAt) || 'Not updated'}</span>
          <a href="https://codexradar.com/" target="_blank" rel="noreferrer">Data from CodexRadar</a>
        </footer>
      </div>
    </ChatFunctionSurface>
  );
}
