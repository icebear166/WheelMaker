import React from 'react';

import {Icon} from '../common/Icon';
import {nativeQwenLoginAvailable, requestNativeQwenLogin} from './qwenLogin';
import {UsageHistoryStateContent, type UsageHistoryDialogState} from './UsageHistoryDialog';
import type {UsageQwenCreditsWindow, UsageViewAccount} from './usageTypes';

interface QwenUsageDialogProps {
  account: UsageViewAccount;
  historyState: UsageHistoryDialogState;
  providerStatus?: 'ok' | 'unavailable' | 'error';
  providerAuthenticated?: boolean;
  providerMessage?: string;
  triggerElement?: HTMLElement | null;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onLogin: (credential: Awaited<ReturnType<typeof requestNativeQwenLogin>>) => Promise<void>;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
  onHistoryRetry: () => void;
  exiting?: boolean;
}

export function QwenUsageDialog({
  account,
  historyState,
  providerStatus = account.status,
  providerAuthenticated,
  providerMessage,
  triggerElement,
  busy = false,
  error,
  onClose,
  onLogin,
  onRefresh,
  onLogout,
  onHistoryRetry,
  exiting = false,
}: QwenUsageDialogProps) {
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

  const data = account.qwen;
  const nativeAvailable = nativeQwenLoginAvailable();
  const statsUnavailable = !data && providerAuthenticated === true;
  const loginRequired = data && providerAuthenticated === false && providerStatus !== 'ok';
  const [loginError, setLoginError] = React.useState('');
  const runLogin = async () => {
    try {
      setLoginError('');
      await onLogin(await requestNativeQwenLogin());
    } catch (cause) {
      setLoginError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div
      className={`usage-history-overlay${exiting ? ' usage-overlay-exit' : ''}`}
      data-qwen-usage-overlay={true}
      onPointerDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`usage-history-dialog qwen-usage-dialog${exiting ? ' usage-dialog-exit' : ''}`}
        role="dialog"
        aria-modal={true}
        aria-labelledby="qwen-usage-dialog-title"
        data-qwen-usage-dialog={true}
      >
        <header className="usage-history-header">
          <div className="usage-history-title">
            <span className="usage-history-title-icon"><Icon name="activity" size={16} /></span>
            <div className="usage-history-heading">
              <h2 id="qwen-usage-dialog-title">
                <span>Qwen</span>
                <span className="usage-history-window">Bailian Token Plan</span>
              </h2>
              <p>5-hour and 7-day Credits windows</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="usage-history-close"
            aria-label="Close Qwen usage"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="usage-history-body">
          <div className="qwen-usage-toolbar">
            <span>
              {providerStatus === 'error'
                ? `Showing last successful snapshot${providerMessage ? ` · ${providerMessage}` : ''}`
                : data?.updatedAt ? `Updated ${formatTime(data.updatedAt)}` : providerMessage || 'Not connected'}
            </span>
            <div>
              <button type="button" className="deepseek-usage-icon-button" aria-label="Refresh Qwen usage" disabled={busy} onClick={() => { void onRefresh(); }}>
                <Icon name="refreshCw" />
              </button>
              {data ? (
                <button type="button" className="deepseek-usage-icon-button" aria-label="Disconnect Qwen" disabled={busy} onClick={() => { void onLogout(); }}>
                  <Icon name="logOut" />
                </button>
              ) : null}
            </div>
          </div>
          {data ? <QwenUsageReady data={data} /> : statsUnavailable ? (
            <div className="deepseek-usage-login" data-qwen-stats-unavailable={true}>
              <strong>Usage unavailable</strong>
              <p>{providerMessage || 'Bailian returned no usage data. Try again.'}</p>
              <button type="button" className="deepseek-usage-primary-action" disabled={busy} onClick={() => { void onRefresh(); }}>
                {busy ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          ) : (
            <div className="deepseek-usage-login" data-qwen-usage-login={true}>
              <strong>Login to view Bailian Token Plan</strong>
              <p>Sign in with your Alibaba Cloud Console account in the native login window.</p>
              {nativeAvailable ? (
                <button type="button" className="deepseek-usage-primary-action" disabled={busy} onClick={() => { void runLogin(); }}>
                  {busy ? 'Logging in…' : 'Login in window'}
                </button>
          ) : (
                <p className="deepseek-usage-login-error" role="status">Native login is unavailable in this browser.</p>
              )}
            </div>
          )}
          {loginRequired ? (
            <div className="deepseek-usage-login" data-qwen-login-required={true}>
              <strong>Login expired</strong>
              <p>Reconnect the Alibaba Cloud Console account to refresh Qwen usage.</p>
              {nativeAvailable ? (
                <button type="button" className="deepseek-usage-primary-action" disabled={busy} onClick={() => { void runLogin(); }}>
                  {busy ? 'Logging in…' : 'Login in window'}
                </button>
              ) : <p className="deepseek-usage-login-error" role="status">Native login is unavailable in this browser.</p>}
            </div>
          ) : null}
          {data ? (
            <section className="qwen-usage-trend" data-qwen-local-trend={true}>
              <h3>Local usage trend</h3>
              <UsageHistoryStateContent state={historyState} onRetry={onHistoryRetry} />
            </section>
          ) : null}
          {error || loginError ? <p className="deepseek-usage-login-error" role="alert">{error || loginError}</p> : null}
        </div>
      </section>
    </div>
  );
}

function QwenUsageReady({data}: {data: NonNullable<UsageViewAccount['qwen']>}) {
  return (
    <>
      <div className="usage-qwen-credits qwen-usage-summary">
        <QwenWindowCard label="5 hours" window={data.fiveHour} />
        <QwenWindowCard label="7 days" window={data.week} />
      </div>
      {data.subscription?.specCode ? (
        <div className="usage-qwen-plan">Plan <strong>{data.subscription.specCode}</strong></div>
      ) : null}
    </>
  );
}

function QwenWindowCard({label, window}: {label: string; window: UsageQwenCreditsWindow}) {
  const value = window.state === 'limited' && window.remaining && window.total
    ? `${window.remaining} / ${window.total} Credits`
    : window.state === 'unlimited'
      ? 'Unlimited'
      : 'Credits unavailable';
  return (
    <div className="usage-qwen-credit-line">
      <span>{label}</span>
      <strong>{value}</strong>
      {window.used ? <em>Used {window.used}</em> : null}
      {window.resetsAt ? <time dateTime={window.resetsAt}>{formatTime(window.resetsAt)}</time> : null}
    </div>
  );
}

function formatTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
