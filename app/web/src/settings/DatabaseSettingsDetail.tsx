import React from 'react';

import {Icon} from '../common/Icon';
import type {WorkspaceDatabaseStorageStats} from '../workspace/WorkspacePersistence';

type DatabaseSettingsDetailProps = {
  loading: boolean;
  error: string;
  dumpText: string;
  storageStats: WorkspaceDatabaseStorageStats | null;
  onClearDatabase: () => void;
};

function formatStorageBytes(bytes: number | null): string {
  if (bytes == null) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatStoragePercent(usageBytes: number | null, quotaBytes: number | null): string {
  if (usageBytes == null || quotaBytes == null || quotaBytes <= 0) return '';
  return `${((usageBytes / quotaBytes) * 100).toFixed(2)}%`;
}

export function DatabaseSettingsDetail({
  loading,
  error,
  dumpText,
  storageStats,
  onClearDatabase,
}: DatabaseSettingsDetailProps) {
  const storagePercent = storageStats
    ? formatStoragePercent(storageStats.usageBytes, storageStats.quotaBytes)
    : '';
  return (
    <>
      {loading ? (
        <div className="muted block">Loading database...</div>
      ) : null}
      {error ? (
        <div className="error">Database error: {error}</div>
      ) : null}
      {!loading && !error && storageStats ? (
        <div className="settings-database-storage-summary">
          <div className="settings-database-storage-metrics" aria-label="Browser storage summary">
            <div className="settings-database-storage-metric">
              <span className="settings-database-storage-label">Usage</span>
              <strong>{formatStorageBytes(storageStats.usageBytes)}</strong>
              {storagePercent ? (
                <span className="settings-database-storage-note">{storagePercent} of quota</span>
              ) : null}
            </div>
            <div className="settings-database-storage-metric">
              <span className="settings-database-storage-label">Quota</span>
              <strong>{formatStorageBytes(storageStats.quotaBytes)}</strong>
              <span className="settings-database-storage-note">Origin estimate</span>
            </div>
            <div className="settings-database-storage-metric">
              <span className="settings-database-storage-label">Persisted</span>
              <strong>{storageStats.persisted == null ? 'Unknown' : storageStats.persisted ? 'Yes' : 'No'}</strong>
              <span className="settings-database-storage-note">Browser eviction mode</span>
            </div>
            <div className="settings-database-storage-metric">
              <span className="settings-database-storage-label">Approx DB</span>
              <strong>{formatStorageBytes(storageStats.totalApproximateStoreBytes)}</strong>
              <span className="settings-database-storage-note">JSON size estimate</span>
            </div>
          </div>
          <div className="settings-database-store-list" aria-label="IndexedDB stores">
            <div className="settings-database-store-list-header">
              <span>IndexedDB stores</span>
              <span>Rows</span>
              <span>Approx</span>
            </div>
            {storageStats.stores.map(store => (
              <div className="settings-database-store-row" key={store.store}>
                <span className="settings-database-store-name">{store.store}</span>
                <span>{store.rows}</span>
                <span>{formatStorageBytes(store.approximateBytes)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {!loading && !error ? (
        <pre className="settings-database-dump">{dumpText}</pre>
      ) : null}
      <section className="set-card database-clear-card">
        <div className="set-card-head">
          <Icon name="trash" size={15} className="database-clear-icon" />
          <span className="set-card-title">Clear Database</span>
          <span className="set-card-spacer" />
          <button
            type="button"
            className="set-btn set-btn--danger"
            onClick={onClearDatabase}
            disabled={loading}
            aria-label="Clear database"
          >
            <Icon name="trash" size={13} />
            Clear Database
          </button>
        </div>
        <p className="set-muted database-clear-note">
          Deletes every store in the local workspace database, including settings, projects, chat history and file
          cache. The app reloads and you must sign in again.
        </p>
      </section>
    </>
  );
}
