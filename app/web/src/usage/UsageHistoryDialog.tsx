import React from 'react';

import {Icon} from '../common/Icon';
import type {UsageForecast, UsageHistoryLimit} from './usageHistory';

const LazyUsageHistoryChart = React.lazy(() => import(
  /* webpackChunkName: "usage-history-chart" */
  './UsageHistoryChart'
));

interface UsageHistoryDialogBase {
  providerName: string;
  accountLabel: string;
}

export type UsageHistoryDialogState =
  | (UsageHistoryDialogBase & {status: 'loading'})
  | (UsageHistoryDialogBase & {status: 'empty'})
  | (UsageHistoryDialogBase & {status: 'error'; message: string})
  | (UsageHistoryDialogBase & {
      status: 'ready';
      limit: UsageHistoryLimit;
      forecast: UsageForecast;
    });

interface UsageHistoryDialogProps {
  state: UsageHistoryDialogState;
  triggerElement?: HTMLElement | null;
  onClose: () => void;
  onRetry: () => void;
  exiting?: boolean;
}

export function UsageHistoryDialog({
  state,
  triggerElement,
  onClose,
  onRetry,
  exiting = false,
}: UsageHistoryDialogProps) {
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const closeRef = React.useRef(onClose);
  const triggerRef = React.useRef(triggerElement);
  closeRef.current = onClose;

  React.useEffect(() => {
    closeButtonRef.current?.focus();
    const eventTarget = typeof document === 'undefined' ? null : document;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
    };
    eventTarget?.addEventListener('keydown', handleKeyDown);
    return () => {
      eventTarget?.removeEventListener('keydown', handleKeyDown);
      triggerRef.current?.focus();
    };
  }, []);

  const windowLabel = state.status === 'ready'
    ? state.limit.label
    : 'Usage history';

  return (
    <div
      className={`usage-history-overlay${exiting ? ' usage-overlay-exit' : ''}`}
      data-usage-history-overlay={true}
      onPointerDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`usage-history-dialog${exiting ? ' usage-dialog-exit' : ''}`}
        role="dialog"
        aria-modal={true}
        aria-labelledby="usage-history-dialog-title"
      >
        <header className="usage-history-header">
          <div className="usage-history-title">
            <span className="usage-history-title-icon">
              <Icon name="activity" size={16} />
            </span>
            <div className="usage-history-heading">
              <h2 id="usage-history-dialog-title">
                <span>{state.providerName}</span>
                <span className="usage-history-window">{windowLabel}</span>
              </h2>
              <p>{state.accountLabel}</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="usage-history-close"
            aria-label="Close usage history"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="usage-history-body">
          {state.status === 'loading' ? <UsageHistoryLoading /> : null}
          {state.status === 'empty' ? (
            <div className="usage-history-empty">
              <strong>No history recorded yet</strong>
              <p>Refresh Limits to add a sample, then check again.</p>
              <button type="button" onClick={onRetry}>Check again</button>
            </div>
          ) : null}
          {state.status === 'error' ? (
            <div className="usage-history-error" role="alert">
              <strong>History unavailable</strong>
              <p>{state.message}</p>
              <button type="button" aria-label="Retry usage history" onClick={onRetry}>Retry</button>
            </div>
          ) : null}
          {state.status === 'ready' ? (
            <UsageHistoryReady limit={state.limit} forecast={state.forecast} />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function UsageHistoryLoading() {
  return (
    <div className="usage-history-loading" aria-live="polite">
      <div className="usage-history-loading-copy">
        <strong>Loading history</strong>
        <span>Reading recent samples from online Hubs…</span>
      </div>
      <div className="usage-history-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function UsageHistoryReady({
  limit,
  forecast,
}: {
  limit: UsageHistoryLimit;
  forecast: UsageForecast;
}) {
  const first = limit.samples[0];
  const latest = limit.samples.at(-1);
  const resetAtMillis = Date.parse(limit.resetsAt ?? '');
  if (!first || !latest || !Number.isFinite(resetAtMillis)) {
    return (
      <div className="usage-history-empty">
        <strong>No usable history</strong>
        <p>Refresh Limits to record a new sample with its reset time.</p>
      </div>
    );
  }

  return (
    <>
      <p className="usage-history-summary" aria-label="Usage history summary">
        <strong>{formatPercent(latest.remainingPercent)}</strong>
        {' Remaining, Resets at '}
        <time dateTime={new Date(resetAtMillis).toISOString()}>
          {formatCompactLocalTime(resetAtMillis)}
        </time>
      </p>
      {forecast.status === 'insufficient' ? (
        <p className="usage-history-note">Trend needs at least 3 recent samples. The observed line is still shown.</p>
      ) : null}
      <React.Suspense fallback={(
        <div className="usage-history-chart-loading" aria-live="polite">Loading chart…</div>
      )}>
        <LazyUsageHistoryChart
          limit={limit}
          forecast={forecast}
          resetAtMillis={resetAtMillis}
        />
      </React.Suspense>
    </>
  );
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatCompactLocalTime(value: number): string {
  const date = new Date(value);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getMonth() + 1}.${date.getDate()} ${hours}:${minutes}`;
}
