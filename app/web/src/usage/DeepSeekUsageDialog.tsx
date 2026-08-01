import React from 'react';

import {Icon} from '../common/Icon';
import {nativeDeepSeekLoginAvailable, requestNativeDeepSeekLogin} from './deepSeekLogin';
import type {DeepSeekUsageView} from './deepSeekUsage';

const LazyDeepSeekUsageChart = React.lazy(() => import(
  /* webpackChunkName: "deepseek-usage-chart" */
  './DeepSeekUsageChart'
));

export interface DeepSeekUsageMonth {
  year: number;
  month: number;
}

export type DeepSeekUsageDialogState =
  | {status: 'loading'; month: DeepSeekUsageMonth}
  | {status: 'error'; message: string; month: DeepSeekUsageMonth; view?: DeepSeekUsageView}
  | {status: 'notConnected'; month: DeepSeekUsageMonth}
  | {status: 'expired'; month: DeepSeekUsageMonth; view?: DeepSeekUsageView}
  | {status: 'ready'; view: DeepSeekUsageView};

interface DeepSeekUsageDialogProps {
  state: DeepSeekUsageDialogState;
  triggerElement?: HTMLElement | null;
  onClose: () => void;
  onRetry: () => void;
  onMonthChange: (year: number, month: number) => void;
  onSaveToken: (token: string) => Promise<void>;
  onClearToken: () => Promise<void>;
}

export function DeepSeekUsageDialog({
  state,
  triggerElement,
  onClose,
  onRetry,
  onMonthChange,
  onSaveToken,
  onClearToken,
}: DeepSeekUsageDialogProps) {
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

  const month = state.status === 'ready' ? state.view.month : state.month;
  const view = state.status === 'ready' || state.status === 'expired' || state.status === 'error'
    ? state.view
    : undefined;
  const hasData = Boolean(view && (view.days.length > 0 || view.balance.length > 0));

  return (
    <div
      className="usage-history-overlay"
      data-deepseek-usage-overlay={true}
      onPointerDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="usage-history-dialog deepseek-usage-dialog"
        role="dialog"
        aria-modal={true}
        aria-labelledby="deepseek-usage-dialog-title"
        data-deepseek-usage-dialog={true}
      >
        <header className="usage-history-header">
          <div className="usage-history-title">
            <span className="usage-history-title-icon">
              <Icon name="activity" size={16} />
            </span>
            <div className="usage-history-heading">
              <h2 id="deepseek-usage-dialog-title">
                <span>DeepSeek</span>
                <span className="usage-history-window">Platform usage</span>
              </h2>
              <p>Monthly and daily token usage · data lags about 5 minutes</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="usage-history-close"
            aria-label="Close DeepSeek usage"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="usage-history-body">
          <div className="deepseek-usage-toolbar">
            <MonthSwitcher month={month} onMonthChange={onMonthChange} />
            <div className="deepseek-usage-toolbar-side">
              {view?.cachedAt ? (
                <span className="deepseek-usage-updated">Updated {formatCachedAt(view.cachedAt)}</span>
              ) : null}
              <button
                type="button"
                className="deepseek-usage-icon-button"
                aria-label="Refresh DeepSeek usage"
                onClick={onRetry}
              >
                <Icon name="refreshCw" />
              </button>
              {view ? (
                <button
                  type="button"
                  className="deepseek-usage-icon-button"
                  aria-label="Disconnect DeepSeek platform"
                  onClick={() => { void onClearToken(); }}
                >
                  <Icon name="logOut" />
                </button>
              ) : null}
            </div>
          </div>
          {state.status === 'loading' ? <DeepSeekUsageLoading /> : null}
          {state.status === 'notConnected' ? <DeepSeekLoginPanel onSaveToken={onSaveToken} /> : null}
          {state.status === 'expired' ? (
            <>
              <div className="deepseek-usage-banner tone-warning" role="alert">
                <strong>Session expired</strong>
                <p>Sign in again to refresh.{hasData ? ' Last successful data is shown below.' : ''}</p>
              </div>
              {view && hasData ? <DeepSeekUsageReady view={view} /> : null}
              <DeepSeekLoginPanel onSaveToken={onSaveToken} />
            </>
          ) : null}
          {state.status === 'error' ? (
            <>
              <div className="deepseek-usage-banner tone-danger" role="alert">
                <strong>Usage unavailable</strong>
                <p>{state.message}</p>
                <div>
                  <button type="button" className="deepseek-usage-banner-action" onClick={onRetry}>Retry</button>
                </div>
              </div>
              {view && hasData ? <DeepSeekUsageReady view={view} /> : null}
            </>
          ) : null}
          {state.status === 'ready' && view ? <DeepSeekUsageReady view={view} /> : null}
        </div>
      </section>
    </div>
  );
}

function formatCachedAt(cachedAt: string): string {
  const parsed = new Date(cachedAt);
  if (Number.isNaN(parsed.getTime())) return cachedAt;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
}

function DeepSeekUsageLoading() {
  return (
    <div className="usage-history-loading" aria-live="polite">
      <div className="usage-history-loading-copy">
        <strong>Loading DeepSeek usage</strong>
        <span>Fetching monthly spend and daily tokens from the platform…</span>
      </div>
      <div className="usage-history-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function MonthSwitcher({
  month,
  onMonthChange,
}: {
  month: DeepSeekUsageMonth;
  onMonthChange: (year: number, month: number) => void;
}) {
  const now = new Date();
  const atCurrentMonth = month.year === now.getFullYear() && month.month === now.getMonth() + 1;
  const previous = month.month === 1
    ? {year: month.year - 1, month: 12}
    : {year: month.year, month: month.month - 1};
  const next = month.month === 12
    ? {year: month.year + 1, month: 1}
    : {year: month.year, month: month.month + 1};
  return (
    <div className="deepseek-usage-months">
      <button
        type="button"
        className="deepseek-usage-icon-button"
        aria-label="Previous month"
        onClick={() => onMonthChange(previous.year, previous.month)}
      >
        <Icon name="arrowLeft" />
      </button>
      <span className="deepseek-usage-month-label">
        {String(month.year)}-{String(month.month).padStart(2, '0')}
      </span>
      <button
        type="button"
        className="deepseek-usage-icon-button"
        aria-label="Next month"
        disabled={atCurrentMonth}
        onClick={() => onMonthChange(next.year, next.month)}
      >
        <Icon name="chevronRight" />
      </button>
    </div>
  );
}

function DeepSeekLoginPanel({onSaveToken}: {onSaveToken: (token: string) => Promise<void>}) {
  const [token, setToken] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const nativeAvailable = nativeDeepSeekLoginAvailable();

  const save = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      await onSaveToken(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save token');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="deepseek-usage-login" data-deepseek-usage-login={true}>
      <strong>Login DeepSeek</strong>
      <p>
        Sign in on{' '}
        <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer">
          platform.deepseek.com
        </a>{' '}
        to fetch official spend and token usage.
      </p>
      {nativeAvailable ? (
        <button
          type="button"
          className="deepseek-usage-primary-action"
          disabled={busy}
          onClick={() => {
            void requestNativeDeepSeekLogin()
              .then(save)
              .catch(cause => setError(cause instanceof Error ? cause.message : 'Failed to start native login'));
          }}
        >
          Login in window
        </button>
      ) : null}
      <label>
        <span>Paste the platform session token</span>
        <input
          type="password"
          value={token}
          disabled={busy}
          placeholder="Bearer token from platform.deepseek.com"
          onChange={event => setToken(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="deepseek-usage-primary-action"
        disabled={busy || token.trim() === ''}
        onClick={() => void save(token.trim())}
      >
        Save token
      </button>
      {error ? <p className="deepseek-usage-login-error" role="alert">{error}</p> : null}
    </div>
  );
}

function DeepSeekUsageReady({view}: {view: DeepSeekUsageView}) {
  return (
    <>
      <div className="deepseek-usage-summary">
        <span>
          <strong>{view.spend.map(item => `${item.currency} ${item.monthlyCost.toFixed(2)}`).join(' · ') || '—'}</strong>
          <em>This month</em>
        </span>
        <span>
          <strong>
            {view.isCurrentMonth
              ? view.spend.map(item => `${item.currency} ${(item.todayCost ?? 0).toFixed(2)}`).join(' · ') || '—'
              : '—'}
          </strong>
          <em>Today</em>
        </span>
        <span>
          <strong>{view.balance.map(item => `${item.currency} ${item.total}`).join(' · ') || '—'}</strong>
          <em>Balance</em>
        </span>
      </div>
      {view.isEmpty ? (
        <div className="usage-history-empty">
          <strong>No usage recorded this month</strong>
          <p>Days with DeepSeek API spend will appear here.</p>
        </div>
      ) : (
        <React.Suspense fallback={(
          <div className="usage-history-chart-loading" aria-live="polite">Loading chart…</div>
        )}>
          <LazyDeepSeekUsageChart view={view} />
        </React.Suspense>
      )}
    </>
  );
}
