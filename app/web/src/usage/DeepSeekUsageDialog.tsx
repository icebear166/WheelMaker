import React from 'react';

import {Icon} from '../common/Icon';
import {nativeDeepSeekLoginAvailable, requestNativeDeepSeekLogin} from './deepSeekLogin';
import type {DeepSeekUsageView} from './deepSeekUsage';

const LazyDeepSeekUsageChart = React.lazy(() => import(
  /* webpackChunkName: "deepseek-usage-chart" */
  './DeepSeekUsageChart'
));

export type DeepSeekUsageDialogState =
  | {status: 'loading'; month: {year: number; month: number}}
  | {status: 'error'; message: string; month: {year: number; month: number}}
  | {status: 'notConnected'; month: {year: number; month: number}}
  | {status: 'expired'; month: {year: number; month: number}; view?: DeepSeekUsageView}
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
  const view = state.status === 'ready' || state.status === 'expired' ? state.view : undefined;

  return (
    <div
      className="usage-history-overlay"
      data-deepseek-usage-overlay={true}
      onPointerDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="deepseek-usage-dialog"
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
        <div className="usage-history-body deepseek-usage-body">
          <div className="deepseek-usage-toolbar">
            <MonthSwitcher month={month} onMonthChange={onMonthChange} />
            <button type="button" className="chat-function-action" aria-label="Refresh DeepSeek usage" onClick={onRetry}>
              <Icon name="refreshCw" />
            </button>
          </div>
          {state.status === 'loading' ? (
            <div className="usage-history-loading" aria-live="polite">
              <strong>Loading DeepSeek usage…</strong>
            </div>
          ) : null}
          {state.status === 'error' ? (
            <div className="usage-history-error" role="alert">
              <strong>Usage unavailable</strong>
              <p>{state.message}</p>
              <button type="button" onClick={onRetry}>Retry</button>
            </div>
          ) : null}
          {state.status === 'notConnected' ? <DeepSeekLoginPanel onSaveToken={onSaveToken} /> : null}
          {state.status === 'expired' ? (
            <>
              <div className="deepseek-usage-expired" role="alert">
                <strong>Session expired</strong>
                <span>Re-login to refresh. Last successful data is kept below.</span>
              </div>
              {view ? <DeepSeekUsageReady view={view} /> : <DeepSeekLoginPanel onSaveToken={onSaveToken} />}
            </>
          ) : null}
          {state.status === 'ready' && view ? <DeepSeekUsageReady view={view} /> : null}
        </div>
      </section>
    </div>
  );
}

function MonthSwitcher({
  month,
  onMonthChange,
}: {
  month: {year: number; month: number};
  onMonthChange: (year: number, month: number) => void;
}) {
  const previous = month.month === 1 ? {year: month.year - 1, month: 12} : {year: month.year, month: month.month - 1};
  return (
    <div className="deepseek-usage-months">
      <button
        type="button"
        className="chat-function-action"
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
        className="chat-function-action"
        aria-label="Current month"
        onClick={() => onMonthChange(new Date().getFullYear(), new Date().getMonth() + 1)}
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
        Sign in to platform.deepseek.com to fetch official spend and token usage.
      </p>
      {nativeAvailable ? (
        <button
          type="button"
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
        <span>Or paste the platform session token</span>
        <input
          type="password"
          value={token}
          disabled={busy}
          placeholder="Bearer token from platform.deepseek.com"
          onChange={event => setToken(event.target.value)}
        />
      </label>
      <button type="button" disabled={busy || token.trim() === ''} onClick={() => void save(token.trim())}>
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
        <span><strong>{view.currency} {view.monthlyCost.toFixed(2)}</strong><em>This month</em></span>
        <span><strong>{view.currency} {view.todayCost.toFixed(2)}</strong><em>Today</em></span>
        <span>
          <strong>
            {(view.balance ?? []).map(item => `${item.currency} ${item.total}`).join(' · ') || '—'}
          </strong>
          <em>Balance</em>
        </span>
      </div>
      <React.Suspense fallback={(
        <div className="usage-history-chart-loading" aria-live="polite">Loading chart…</div>
      )}>
        <LazyDeepSeekUsageChart view={view} />
      </React.Suspense>
    </>
  );
}
