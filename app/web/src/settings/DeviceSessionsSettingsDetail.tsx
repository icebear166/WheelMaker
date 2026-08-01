import React from 'react';

import {Icon} from '../common/Icon';
import type {RegistryDeviceSession} from '../registry/registryTypes';

type DeviceSessionsSettingsDetailProps = {
  sessions: RegistryDeviceSession[];
  loading: boolean;
  error: string;
  onRevoke: (deviceId: string) => Promise<void>;
  onRevokeAll: () => Promise<void>;
  onCurrentRevoked: () => void;
  onRefresh?: () => Promise<void>;
};

const formatDate = (value: string): string => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
};

const sessionCountLabel = (count: number): string =>
  `${count} ${count === 1 ? 'session' : 'sessions'}`;

export function DeviceSessionsSettingsDetail({
  sessions,
  loading,
  error,
  onRevoke,
  onRevokeAll,
  onCurrentRevoked,
  onRefresh,
}: DeviceSessionsSettingsDetailProps) {
  const revoke = async (session: RegistryDeviceSession) => {
    if (!window.confirm(`Revoke ${session.deviceName}?`)) return;
    await onRevoke(session.deviceId);
    if (session.current) onCurrentRevoked();
  };
  const revokeAll = async () => {
    if (!window.confirm('Revoke all device sessions? You will need to log in again.')) return;
    await onRevokeAll();
    onCurrentRevoked();
  };
  const refresh = async () => {
    if (!onRefresh) return;
    await onRefresh();
  };

  return (
    <div className="device-sessions-stack" aria-busy={loading}>
      {error ? (
        <div className="set-error" role="alert">{error}</div>
      ) : null}

      <section className="set-card">
        <div className="set-card-head device-sessions-head">
          <Icon name="laptop" size={16} className="device-sessions-overview-icon" />
          <span className="set-card-title">Devices</span>
          <span className="set-card-subtitle set-num">{sessionCountLabel(sessions.length)}</span>
          <span className="set-card-spacer" />
          {onRefresh ? (
            <button
              type="button"
              className="set-btn"
              onClick={() => refresh().catch(() => undefined)}
              disabled={loading}
              aria-label="Refresh device sessions"
            >
              <Icon name="refreshCw" size={13} />
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          ) : null}
          <button
            type="button"
            className="set-btn set-btn--danger"
            onClick={() => revokeAll().catch(() => undefined)}
            disabled={loading || sessions.length === 0}
            aria-label="Revoke all device sessions"
          >
            <Icon name="trash" size={13} />
            Revoke All
          </button>
        </div>
      </section>

      {loading && sessions.length === 0 ? (
        <div className="set-card device-sessions-skeleton" aria-hidden="true">
          <span className="device-sessions-skeleton-line device-sessions-skeleton-title" />
          <span className="device-sessions-skeleton-line" />
          <span className="device-sessions-skeleton-line device-sessions-skeleton-short" />
        </div>
      ) : null}

      {!loading && !error && sessions.length === 0 ? (
        <div className="set-card device-sessions-empty">
          <Icon name="laptop" size={20} className="device-sessions-empty-icon" />
          <div className="device-sessions-empty-copy">
            <span className="set-card-title">No device sessions</span>
            <span className="set-muted">Sessions appear here after you sign in from another device or browser.</span>
          </div>
          {onRefresh ? (
            <button
              type="button"
              className="set-btn"
              onClick={() => refresh().catch(() => undefined)}
              disabled={loading}
              aria-label="Refresh device sessions"
            >
              <Icon name="refreshCw" size={13} />
              Refresh
            </button>
          ) : null}
        </div>
      ) : null}

      {sessions.map(session => (
        <section className="set-card device-session-card" key={session.deviceId}>
          <div className="set-card-head device-sessions-head">
            <Icon name="laptop" size={16} className="device-sessions-overview-icon" />
            <span className="set-card-title device-session-name" title={session.deviceName}>
              {session.deviceName}
            </span>
            {session.current ? (
              <span className="set-status is-running">Current</span>
            ) : null}
            <span className="set-card-spacer" />
            <button
              type="button"
              className="set-btn set-btn--danger"
              onClick={() => revoke(session).catch(() => undefined)}
              disabled={loading}
              aria-label={`Revoke ${session.deviceName}`}
            >
              <Icon name="trash" size={13} />
              Revoke
            </button>
          </div>
          <div className="set-card-body device-session-meta">
            <div className="set-kv">
              <span className="set-kv-key">Last login IP</span>
              <code className="set-kv-value set-mono">{session.lastLoginIp || 'Unknown'}</code>
            </div>
            <div className="set-kv">
              <span className="set-kv-key">Location</span>
              <span className="set-kv-value">{session.lastLoginLocation || 'Unknown'}</span>
            </div>
            <div className="set-kv">
              <span className="set-kv-key">Created</span>
              <span className="set-kv-value set-num">{formatDate(session.createdAt)}</span>
            </div>
            <div className="set-kv">
              <span className="set-kv-key">Last seen</span>
              <span className="set-kv-value set-num">{formatDate(session.lastSeenAt)}</span>
            </div>
            <div className="set-kv">
              <span className="set-kv-key">Expires</span>
              <span className="set-kv-value set-num">{formatDate(session.expiresAt)}</span>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
