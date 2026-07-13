import React from 'react';

import type {RegistryDeviceSession} from '../registry/registryTypes';

type DeviceSessionsSettingsDetailProps = {
  sessions: RegistryDeviceSession[];
  loading: boolean;
  error: string;
  onRevoke: (deviceId: string) => Promise<void>;
  onRevokeAll: () => Promise<void>;
  onCurrentRevoked: () => void;
};

const formatDate = (value: string): string => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
};

export function DeviceSessionsSettingsDetail({
  sessions,
  loading,
  error,
  onRevoke,
  onRevokeAll,
  onCurrentRevoked,
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

  return (
    <div className="settings-metadata-list">
      {loading ? <div className="settings-metadata-line">Loading devices...</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}
      {sessions.map(session => (
        <div className="settings-metadata-card" key={session.deviceId}>
          <div className="settings-metadata-line settings-metadata-line-tags">
            <span className="settings-metadata-title">{session.deviceName}</span>
            {session.current ? <span className="agent-package-status">Current</span> : null}
          </div>
          <div className="settings-metadata-line">Last login IP: {session.lastLoginIp || 'Unknown'}</div>
          <div className="settings-metadata-line">Location: {session.lastLoginLocation || 'Unknown'}</div>
          <div className="settings-metadata-line">Created: {formatDate(session.createdAt)}</div>
          <div className="settings-metadata-line">Last seen: {formatDate(session.lastSeenAt)}</div>
          <button type="button" disabled={loading} onClick={() => revoke(session).catch(() => undefined)}>
            Revoke
          </button>
        </div>
      ))}
      <button type="button" disabled={loading || sessions.length === 0} onClick={() => revokeAll().catch(() => undefined)}>
        Revoke all
      </button>
    </div>
  );
}
