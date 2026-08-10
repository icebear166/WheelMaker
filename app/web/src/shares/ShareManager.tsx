import React, {useCallback, useEffect, useState} from 'react';
import {Icon} from '../common/Icon';
import {writeTextToClipboard} from '../platform/clipboard';
import type {
  RegistryShareCreatePayload,
  RegistryShareCreateResponse,
  RegistryShareExpiry,
  RegistryShareListResponse,
  RegistryShareRecord,
} from '../registry/registryTypes';
import {compressShareContent, preflightShareEnvelope} from './shareCompression';
import type {ShareDocumentKind, ShareSnapshot} from './shareSnapshot';

export type ShareManagerSource = {
  projectId: string;
  path: string;
  kind: ShareDocumentKind;
  title: string;
  content?: string;
};

export type ShareManagerService = {
  listShares: (payload?: {cursor?: string; limit?: number}) => Promise<RegistryShareListResponse>;
  createShare: (payload: RegistryShareCreatePayload) => Promise<RegistryShareCreateResponse>;
  deleteShare: (token: string) => Promise<{ok: boolean}>;
};

export type ShareManagerProps = {
  service: ShareManagerService;
  initialSource?: ShareManagerSource | null;
  captureSnapshot: (source: ShareManagerSource) => Promise<ShareSnapshot>;
  onBack: () => void;
};

const EXPIRY_OPTIONS: Array<{value: RegistryShareExpiry; label: string}> = [
  {value: '1h', label: '1 hour'},
  {value: '1d', label: '1 day'},
  {value: '7d', label: '7 days'},
  {value: '30d', label: '30 days'},
  {value: 'permanent', label: 'Permanent'},
];

export function ShareManager({service, initialSource = null, captureSnapshot, onBack}: ShareManagerProps) {
  const [records, setRecords] = useState<RegistryShareRecord[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');
  const [nextCursor, setNextCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [source, setSource] = useState<ShareManagerSource | null>(initialSource);
  const [titleDraft, setTitleDraft] = useState(initialSource?.title ?? '');
  const [expiry, setExpiry] = useState<RegistryShareExpiry>('1d');
  const [pendingSnapshot, setPendingSnapshot] = useState<ShareSnapshot | null>(null);
  const [createdUrl, setCreatedUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyToken, setBusyToken] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadRecords = useCallback(async (cursor = '', append = false) => {
    setLoading(true);
    setListError('');
    try {
      const result = await service.listShares({cursor: cursor || undefined, limit: 50});
      setEnabled(result.enabled);
      setPublicUrl(result.publicUrl ?? '');
      setNextCursor(result.nextCursor ?? '');
      setRecords(current => append ? [...current, ...result.items] : result.items);
    } catch (loadError) {
      setListError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    setSource(initialSource ?? null);
    setTitleDraft(initialSource?.title ?? '');
    setPendingSnapshot(null);
    setCreatedUrl('');
    setError('');
    setNotice('');
  }, [initialSource]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (!source) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onBack, source]);

  const submitSnapshot = useCallback(async (snapshot: ShareSnapshot, currentSource: ShareManagerSource) => {
    setBusy(true);
    setError('');
    try {
      const compressed = await compressShareContent(snapshot.html);
      const payload: RegistryShareCreatePayload = {
        projectId: currentSource.projectId,
        path: currentSource.path,
        kind: currentSource.kind,
        title: titleDraft.trim(),
        expiry,
        encoding: 'gzip+base64',
        content: compressed.content,
      };
      preflightShareEnvelope(payload);
      const result = await service.createShare(payload);
      const nextUrl = result.url ?? '';
      setCreatedUrl(nextUrl);
      setPendingSnapshot(null);
      if (!nextUrl) {
        setNotice('Share created.');
        return;
      }
      try {
        await writeTextToClipboard(nextUrl);
        setNotice('Share link copied.');
      } catch (copyError) {
        const reason = copyError instanceof Error ? copyError.message : String(copyError);
        setError(`Share created, but automatic copy failed: ${reason}`);
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setBusy(false);
    }
  }, [expiry, service, titleDraft]);

  const beginCreate = async () => {
    if (!source || busy || loading || !enabled || !titleDraft.trim()) return;
    setError('');
    setNotice('');
    try {
      const snapshot = pendingSnapshot ?? await captureSnapshot(source);
      if (!pendingSnapshot && snapshot.warnings.length > 0) {
        setPendingSnapshot(snapshot);
        return;
      }
      await submitSnapshot(snapshot, source);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    }
  };

  const copyCreatedLink = async () => {
    if (!createdUrl) return;
    setError('');
    try {
      await writeTextToClipboard(createdUrl);
      setNotice('Share link copied.');
    } catch (copyError) {
      const reason = copyError instanceof Error ? copyError.message : String(copyError);
      setError(`Failed to copy share link: ${reason}`);
    }
  };

  const copyLink = async (record: RegistryShareRecord) => {
    if (!record.url) {
      setError('Sharing is disabled; the public URL is not currently available.');
      return;
    }
    try {
      await writeTextToClipboard(record.url);
      setNotice('Share link copied.');
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  };

  const stopSharing = async (record: RegistryShareRecord) => {
    if (busyToken) return;
    setBusyToken(record.token);
    setError('');
    try {
      await service.deleteShare(record.token);
      setRecords(current => current.filter(item => item.token !== record.token));
      setNotice('Share stopped.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setBusyToken('');
    }
  };

  if (source) {
    const createDisabled = busy || loading || !enabled || !titleDraft.trim();
    return (
      <div
        className="app-confirm-backdrop share-create-backdrop"
        role="presentation"
        onPointerDown={() => {
          if (!busy) onBack();
        }}
      >
        <section
          className="app-confirm-dialog share-create-dialog"
          role="dialog"
          aria-modal={true}
          aria-labelledby="share-create-dialog-title"
          onPointerDown={event => event.stopPropagation()}
        >
          <div className="app-confirm-icon">
            <Icon name="share" size={17} />
          </div>
          <div className="app-confirm-content share-create-content">
            <div id="share-create-dialog-title" className="app-confirm-title">Create public share</div>
            <div className="app-confirm-name">{source.path}</div>

            <div className="share-create-server">
              <div>
                <span>Share server</span>
                {publicUrl ? <span className="share-create-server-url">{publicUrl}</span> : null}
              </div>
              <span
                className={`share-manager-status${enabled ? ' enabled' : ''}`}
                data-share-enabled={enabled ? 'true' : 'false'}
              >
                {loading ? 'Checking…' : enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>

            {createdUrl ? (
              <div className="share-create-success">
                <strong>Share ready</strong>
                <span data-share-created-link={createdUrl}>{createdUrl}</span>
              </div>
            ) : (
              <div className="share-create-fields">
                <label className="share-create-field">
                  <span>Name</span>
                  <input
                    className="app-rename-input share-create-name-input"
                    type="text"
                    aria-label="Share name"
                    value={titleDraft}
                    maxLength={512}
                    autoFocus
                    disabled={busy}
                    onChange={event => {
                      setTitleDraft(event.target.value);
                      setError('');
                    }}
                  />
                </label>
                <label className="share-create-field">
                  <span>Expires</span>
                  <select
                    aria-label="Share expiry"
                    value={expiry}
                    onChange={event => setExpiry(event.target.value as RegistryShareExpiry)}
                    disabled={busy}
                  >
                    {EXPIRY_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                {pendingSnapshot?.warnings.length ? (
                  <div className="share-manager-warning" role="alert">
                    <strong>Some dependencies may not load from this public origin.</strong>
                    <ul>
                      {pendingSnapshot.warnings.map(warning => (
                        <li key={`${warning.source}:${warning.message}`}>{warning.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {!loading && !enabled ? (
                  <p className="share-manager-muted">Set a Share public URL in Config to create new links.</p>
                ) : null}
              </div>
            )}

            {error ? <div className="app-confirm-error" role="alert">{error}</div> : null}
            {notice ? <div className="share-manager-notice" role="status">{notice}</div> : null}
            {listError ? <div className="app-confirm-error" role="alert">{listError}</div> : null}
          </div>
          <div className="app-confirm-actions">
            <button type="button" className="app-confirm-btn secondary" onClick={onBack} disabled={busy}>
              {createdUrl ? 'Done' : 'Cancel'}
            </button>
            {createdUrl ? (
              <button
                type="button"
                className="app-confirm-btn primary"
                aria-label="Copy share link"
                onClick={() => void copyCreatedLink()}
              >
                <Icon name="copy" /> Copy link
              </button>
            ) : (
              <button
                type="button"
                className="app-confirm-btn primary"
                onClick={() => void beginCreate()}
                disabled={createDisabled}
              >
                {busy ? 'Creating…' : pendingSnapshot?.warnings.length ? 'Continue anyway' : 'Create public share'}
              </button>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="share-manager" data-share-manager="true">
      <section className="share-manager-intro">
        <div>
          <h2>Public shares</h2>
          <p>Immutable HTML snapshots. Anyone with a link can view them until they expire.</p>
        </div>
        <span className={`share-manager-status${enabled ? ' enabled' : ''}`} data-share-enabled={enabled ? 'true' : 'false'}>
          {enabled ? 'Enabled' : 'Disabled'}
        </span>
      </section>

      {error ? <div className="share-manager-error" role="alert">{error}</div> : null}
      {notice ? <div className="share-manager-notice" role="status">{notice}</div> : null}
      {listError ? <div className="share-manager-error" role="alert">{listError}</div> : null}
      {publicUrl ? <p className="share-manager-origin">Origin: {publicUrl}</p> : null}

      <section className="share-manager-list" aria-label="Current public shares">
        <div className="share-manager-section-heading">
          <h3>Current links</h3>
          <button type="button" className="share-manager-subtle-button" onClick={() => void loadRecords()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {loading && records.length === 0 ? <p className="share-manager-muted">Loading shares…</p> : null}
        {!loading && records.length === 0 ? <p className="share-manager-muted">No active shares.</p> : null}
        <div className="share-manager-records">
          {records.map(record => (
            <article key={record.token} className="share-manager-record" data-share-token={record.token}>
              <div className="share-manager-record-main">
                <strong>{record.title || record.path}</strong>
                <span>{record.path} · {record.expiresAt ? `expires ${formatExpiry(record.expiresAt)}` : 'permanent'}</span>
              </div>
              <div className="share-manager-record-actions">
                <button type="button" onClick={() => void copyLink(record)} disabled={!record.url}>
                  <Icon name="copy" /> Copy link
                </button>
                <button type="button" className="share-manager-danger-button" onClick={() => void stopSharing(record)} disabled={busyToken === record.token}>
                  {busyToken === record.token ? 'Stopping…' : 'Stop sharing'}
                </button>
              </div>
            </article>
          ))}
        </div>
        {nextCursor ? (
          <button type="button" className="share-manager-load-more" onClick={() => void loadRecords(nextCursor, true)} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        ) : null}
      </section>

      <button type="button" className="share-manager-back-button" onClick={onBack}>Back</button>
    </div>
  );
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString();
}
