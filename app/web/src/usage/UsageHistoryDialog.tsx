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
}

export function UsageHistoryDialog({
  state,
  triggerElement,
  onClose,
  onRetry,
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

  const heading = state.status === 'ready'
    ? `${state.providerName} · ${state.limit.label}`
    : `${state.providerName} usage history`;

  return (
    <div
      className="usage-history-overlay"
      data-usage-history-overlay={true}
      onPointerDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="usage-history-dialog"
        role="dialog"
        aria-modal={true}
        aria-labelledby="usage-history-dialog-title"
      >
        <header className="usage-history-header">
          <div className="usage-history-heading">
            <h2 id="usage-history-dialog-title">{heading}</h2>
            <p>{state.accountLabel}</p>
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
      <div className="usage-history-summary" aria-label="Usage history summary">
        <div className="usage-history-current">
          <span>Current</span>
          <strong>{formatPercent(latest.remainingPercent)} remaining</strong>
        </div>
        <dl>
          <div>
            <dt>Observed</dt>
            <dd>{formatLocalTime(first.observedAtMillis)} – {formatLocalTime(latest.observedAtMillis)}</dd>
          </div>
          <div>
            <dt>Forecast</dt>
            <dd>{forecastSummary(forecast)}</dd>
          </div>
          <div>
            <dt>Resets</dt>
            <dd>{formatLocalTime(resetAtMillis)}</dd>
          </div>
        </dl>
      </div>
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

function forecastSummary(forecast: UsageForecast): string {
  if (forecast.status === 'depletesBeforeReset' && forecast.depletionAtMillis !== undefined) {
    return `Expected to run out ${formatLocalTime(forecast.depletionAtMillis)}`;
  }
  if (forecast.status === 'safeUntilReset' && forecast.remainingAtReset !== undefined) {
    return `${formatPercent(forecast.remainingAtReset)} expected at reset`;
  }
  return 'Collecting trend data';
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatLocalTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}
