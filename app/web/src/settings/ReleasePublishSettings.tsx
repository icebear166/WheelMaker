import React from 'react';

import {Icon} from '../common/Icon';
import {AppConfirmDialog, type ConfirmTarget} from '../shell/AppDialogs';
import {WHEELMAKER_RELEASE_BASE_URL} from './releaseChannel';
import type {RegistryReleasePublishResponse, RegistryReleaseStorageInfo, RegistryReleaseStorageResponse} from '../registry/registryTypes';

type Settings = {
  publisherHubId: string;
  sourcePath: string;
  serverHubId: string;
  autoPull: boolean;
  desktop: boolean;
  android: boolean;
  gateway: boolean;
  jobId: string;
  jobHubId: string;
};
const key = 'wheelmaker.settings.release-publish.v1';
const empty: Settings = {
  publisherHubId: '',
  sourcePath: '',
  serverHubId: '',
  autoPull: false,
  desktop: false,
  android: false,
  gateway: false,
  jobId: '',
  jobHubId: '',
};

function load(): Settings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '{}') as Record<string, unknown>;
    const merged = {...empty, ...parsed} as Settings & {webHubId?: string};
    if (!merged.serverHubId && typeof merged.webHubId === 'string' && merged.webHubId) {
      merged.serverHubId = merged.webHubId;
    }
    delete merged.webHubId;
    return merged;
  } catch {
    return empty;
  }
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function formatByteSize(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? size : size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function resolveJobStatusVariant(job: NonNullable<RegistryReleasePublishResponse['job']>): string {
  if (job.targetState === 'success' || /success/i.test(job.status)) return 'is-ok';
  if (job.targetState === 'failed' || job.errorCode || /fail|error/i.test(job.status)) return 'is-error';
  if (job.targetState === 'accepted' || /running|publish|working|pending|queued|start/i.test(job.status)) return 'is-running';
  return 'is-idle';
}

export function ReleasePublishSettings({hubIds, start, query, subscribe, queryStorage, pruneStorage}: {
  hubIds: string[];
  start: (hubId: string, input: Record<string, unknown>) => Promise<RegistryReleasePublishResponse>;
  query: (hubId: string, jobId: string) => Promise<RegistryReleasePublishResponse>;
  subscribe?: (listener: (hubId: string, job: NonNullable<RegistryReleasePublishResponse['job']>) => void) => () => void;
  queryStorage: (hubId: string, sourcePath: string) => Promise<RegistryReleaseStorageResponse>;
  pruneStorage: (hubId: string, sourcePath: string) => Promise<RegistryReleaseStorageResponse>;
}) {
  const [settings, setSettings] = React.useState<Settings>(load);
  const [job, setJob] = React.useState<RegistryReleasePublishResponse['job']>();
  const [error, setError] = React.useState('');
  const [storageError, setStorageError] = React.useState('');
  const [pendingKind, setPendingKind] = React.useState<'version' | 'debugWeb' | null>(null);
  const [confirmTarget, setConfirmTarget] = React.useState<ConfirmTarget | null>(null);
  const [storage, setStorage] = React.useState<RegistryReleaseStorageInfo | null>(null);
  const [storageLoading, setStorageLoading] = React.useState(false);
  const [pruning, setPruning] = React.useState(false);
  const storageRequestVersion = React.useRef(0);

  const canQueryStorage = Boolean(settings.publisherHubId && settings.sourcePath);

  const refreshStorage = React.useCallback(async () => {
    const requestVersion = ++storageRequestVersion.current;
    const publisherHubId = settings.publisherHubId;
    const sourcePath = settings.sourcePath;
    if (!publisherHubId || !sourcePath) {
      setStorageLoading(false);
      return;
    }
    setStorageLoading(true);
    try {
      const result = await queryStorage(publisherHubId, sourcePath);
      if (requestVersion !== storageRequestVersion.current) return;
      if (result.ok && result.storage) {
        setStorage(result.storage);
        setStorageError('');
      } else {
        setStorageError(result.error || result.status);
      }
    } catch (value) {
      if (requestVersion === storageRequestVersion.current) {
        setStorageError(value instanceof Error ? value.message : String(value));
      }
    } finally {
      if (requestVersion === storageRequestVersion.current) {
        setStorageLoading(false);
      }
    }
  }, [queryStorage, settings.publisherHubId, settings.sourcePath]);

  React.useEffect(() => {
    setStorage(null);
    setStorageError('');
    void refreshStorage();
    return () => {
      storageRequestVersion.current += 1;
    };
  }, [refreshStorage]);

  React.useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(settings));
  }, [settings]);

  React.useEffect(() => {
    if (!settings.jobId || !settings.jobHubId) return undefined;
    let stopped = false;
    const refresh = async () => {
      try {
        const result = await query(settings.jobHubId, settings.jobId);
        if (!stopped) {
          setJob(result.job);
          setError(result.ok ? '' : result.error || result.status);
        }
      } catch (value) {
        if (!stopped) setError(value instanceof Error ? value.message : String(value));
      }
    };
    void refresh();
    if (job?.finishedAt) {
      return () => {
        stopped = true;
      };
    }
    const timer = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [job?.finishedAt, query, settings.jobHubId, settings.jobId]);

  React.useEffect(() => subscribe?.((hubId, nextJob) => {
    if (hubId === settings.jobHubId && nextJob.id === settings.jobId) {
      setJob(nextJob);
      setError('');
    }
  }), [settings.jobHubId, settings.jobId, subscribe]);

  const update = (patch: Partial<Settings>) => setSettings(current => ({...current, ...patch}));

  const submit = async (kind: 'version' | 'debugWeb') => {
    if (!settings.publisherHubId || !settings.sourcePath || pendingKind) return;
    setPendingKind(kind);
    setError('');
    try {
      const input = kind === 'version'
        ? {kind, sourcePath: settings.sourcePath, baseUrl: WHEELMAKER_RELEASE_BASE_URL, desktop: settings.desktop, android: settings.android, gateway: settings.gateway, targetHubId: settings.serverHubId || undefined, autoPull: Boolean(settings.serverHubId && settings.autoPull)}
        : {kind, sourcePath: settings.sourcePath, webHubId: settings.serverHubId};
      const result = await start(settings.publisherHubId, input);
      if (!result.ok || !result.job) throw new Error(result.error || result.status || 'publish task was rejected');
      setJob(result.job);
      update({jobId: result.job.id, jobHubId: settings.publisherHubId});
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setPendingKind(null);
    }
  };

  const requestPublish = (kind: 'version' | 'debugWeb') => {
    if (!settings.publisherHubId || !settings.sourcePath || pendingKind) return;
    if (kind === 'debugWeb' && !settings.serverHubId) return;
    setConfirmTarget({
      kind: 'releasePublish',
      action: kind,
      publisherHubId: settings.publisherHubId,
      sourcePath: settings.sourcePath,
      serverHubId: settings.serverHubId,
      webHubId: settings.serverHubId,
      desktop: settings.desktop,
      android: settings.android,
      gateway: settings.gateway,
      autoPull: settings.autoPull,
    });
  };

  const confirmPublish = () => {
    if (!confirmTarget || confirmTarget.kind !== 'releasePublish') return;
    const kind = confirmTarget.action;
    setConfirmTarget(null);
    void submit(kind);
  };

  const requestPrune = () => {
    if (!storage || storage.orphanCount === 0 || pruning) return;
    setConfirmTarget({
      kind: 'releaseStoragePrune',
      publisherHubId: settings.publisherHubId,
      sourcePath: settings.sourcePath,
      orphanCount: storage.orphanCount,
      reclaimableLabel: formatByteSize(storage.reclaimableBytes),
    });
  };

  const confirmPrune = async () => {
    if (!confirmTarget || confirmTarget.kind !== 'releaseStoragePrune') return;
    const target = confirmTarget;
    setConfirmTarget(null);
    setPruning(true);
    setStorageError('');
    try {
      const result = await pruneStorage(target.publisherHubId, target.sourcePath);
      if (!result.ok) throw new Error(result.error || result.status || 'prune was rejected');
      await refreshStorage();
    } catch (value) {
      setStorageError(value instanceof Error ? value.message : String(value));
    } finally {
      setPruning(false);
    }
  };

  const pending = pendingKind !== null;
  const canStartVersion = Boolean(settings.publisherHubId && settings.sourcePath) && !pending;
  const canStartDebugWeb = Boolean(settings.publisherHubId && settings.sourcePath && settings.serverHubId) && !pending;
  const jobVariant = job ? resolveJobStatusVariant(job) : 'is-idle';

  return (
    <div className="release-publish-page">
      <section className="set-card" aria-label="Publishing source">
        <div className="set-card-head">
          <Icon name="folder" size={15} className="port-relay-section-icon" />
          <span className="set-card-title">Publishing source</span>
        </div>
        <div className="set-card-body">
          <div className="set-field">
            <span className="set-field-label">Publishing Hub</span>
            <select
              className="set-field-control"
              value={settings.publisherHubId}
              onChange={event => update({publisherHubId: event.target.value})}
            >
              <option value="">Select Hub</option>
              {hubIds.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <div className="set-field">
            <span className="set-field-label">Source path</span>
            <input
              className="set-field-control"
              value={settings.sourcePath}
              onChange={event => update({sourcePath: event.target.value})}
              placeholder="Absolute source checkout path"
            />
          </div>
          <div className="set-field">
            <span className="set-field-label">Server Hub</span>
            <select
              className="set-field-control"
              value={settings.serverHubId}
              onChange={event => update({serverHubId: event.target.value, autoPull: event.target.value ? settings.autoPull : false})}
            >
              <option value="">No automatic apply</option>
              {hubIds.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <label className="release-publish-check">
            <input
              type="checkbox"
              checked={settings.autoPull}
              disabled={!settings.serverHubId}
              onChange={event => update({autoPull: event.target.checked})}
            />
            Auto pull after publish
          </label>
        </div>
      </section>

      <section className="set-card" aria-label="Version release">
        <div className="set-card-head">
          <Icon name="cloudDownload" size={15} className="port-relay-section-icon" />
          <span className="set-card-title">Version release</span>
        </div>
        <div className="set-card-body">
          <div className="release-publish-options">
            <label>
              <input
                type="checkbox"
                checked={settings.desktop}
                onChange={event => update({desktop: event.target.checked})}
              />
              Include Desktop
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.android}
                onChange={event => update({android: event.target.checked})}
              />
              Include Android
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.gateway}
                onChange={event => update({gateway: event.target.checked})}
              />
              Include Gateway
            </label>
          </div>
          <div className="release-publish-actions">
            <button
              type="button"
              className="set-btn set-btn--primary"
              disabled={!canStartVersion}
              onClick={() => requestPublish('version')}
            >
              <Icon name={pendingKind === 'version' ? 'loader' : 'cloudDownload'} spin={pendingKind === 'version'} size={13} />
              {pendingKind === 'version' ? 'Publishing...' : 'Publish version'}
            </button>
          </div>
        </div>
      </section>

      <section className="set-card" aria-label="Temporary Web">
        <div className="set-card-head">
          <Icon name="externalLink" size={15} className="port-relay-section-icon" />
          <span className="set-card-title">Temporary Web</span>
        </div>
        <div className="set-card-body">
          <p className="set-muted">Build Web only and apply it directly to an online Hub. Stable release metadata is not changed.</p>
          <div className="release-publish-actions">
            <button
              type="button"
              className="set-btn set-btn--primary"
              disabled={!canStartDebugWeb}
              onClick={() => requestPublish('debugWeb')}
            >
              <Icon name={pendingKind === 'debugWeb' ? 'loader' : 'externalLink'} spin={pendingKind === 'debugWeb'} size={13} />
              {pendingKind === 'debugWeb' ? 'Publishing...' : 'Publish temporary Web'}
            </button>
          </div>
        </div>
      </section>

      <section className="set-card" aria-label="Release storage">
        <div className="set-card-head">
          <Icon name="database" size={15} className="port-relay-section-icon" />
          <span className="set-card-title">Release storage</span>
          <span className="set-card-spacer" />
          <button
            type="button"
            className="set-btn"
            disabled={!canQueryStorage || storageLoading}
            onClick={() => void refreshStorage()}
          >
            <Icon name="refreshCw" size={13} spin={storageLoading} />
            Refresh
          </button>
        </div>
        <div className="set-card-body">
          <div className="set-kv">
            <span className="set-kv-key">Total</span>
            <span className="set-kv-value set-num">{storage ? formatByteSize(storage.totalBytes) : '-'}</span>
          </div>
          <div className="set-kv">
            <span className="set-kv-key">Reclaimable</span>
            <span className="set-kv-value set-num">{storage ? formatByteSize(storage.reclaimableBytes) : '-'}</span>
          </div>
          <div className="release-publish-actions">
            <button
              type="button"
              className="set-btn set-btn--primary"
              disabled={!storage || storage.orphanCount === 0 || pruning || storageLoading}
              onClick={requestPrune}
            >
              <Icon name={pruning ? 'loader' : 'trash'} spin={pruning} size={13} />
              {pruning ? 'Cleaning...' : 'Clean up old versions'}
            </button>
          </div>
        </div>
      </section>

      {job ? (
        <section className="set-card" aria-label="Publish task">
          <div className="set-card-head">
            <Icon name="history" size={15} className="port-relay-section-icon" />
            <span className="set-card-title">Publish task</span>
            <span className={`set-status ${jobVariant}`}>{job.status}</span>
            <span className="set-card-spacer" />
          </div>
          <div className="set-card-body">
            <div className="set-kv">
              <span className="set-kv-key">Started</span>
              <span className="set-kv-value set-num">{formatDate(job.startedAt)}</span>
            </div>
            <div className="set-kv">
              <span className="set-kv-key">Updated</span>
              <span className="set-kv-value set-num">{formatDate(job.updatedAt)}</span>
            </div>
            {job.targetState ? (
              <div className="set-kv">
                <span className="set-kv-key">Target</span>
                <span className="set-kv-value">
                  {job.kind === 'debugWeb' ? 'Web Hub' : 'Server Hub'}: {job.targetState}
                </span>
              </div>
            ) : null}
            {job.log ? (
              <pre className="release-publish-job-log">{job.log}</pre>
            ) : null}
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="set-error" role="alert">{error}</div>
      ) : null}
      {storageError ? (
        <div className="set-error" role="alert">{storageError}</div>
      ) : null}

      <AppConfirmDialog
        target={confirmTarget}
        busy={false}
        error=""
        onCancel={() => setConfirmTarget(null)}
        onPrimary={() => {
          if (confirmTarget?.kind === 'releaseStoragePrune') {
            void confirmPrune();
          } else {
            confirmPublish();
          }
        }}
      />
    </div>
  );
}
