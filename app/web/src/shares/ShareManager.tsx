import React, {useCallback, useEffect, useState} from 'react';
import {Icon} from '../common/Icon';
import {writeTextToClipboard} from '../platform/clipboard';
import {AppConfirmDialog} from '../shell/AppDialogs';
import type {
  RegistryShareCreatePayload,
  RegistryShareCreateResponse,
  RegistryShareExpiry,
  RegistryShareListResponse,
  RegistryShareRecord,
} from '../registry/registryTypes';
import {compressShareContent, preflightShareEnvelope} from './shareCompression';
import type {ShareDocumentKind, ShareSnapshot} from './shareSnapshot';
import type {ChatShareSnapshot} from '../chat/share/chatShareSnapshot';

export type ShareManagerProjectSource = {
  sourceType?: 'project_document';
  projectId: string;
  path: string;
  kind: ShareDocumentKind;
  title: string;
  content?: string;
};

export type ShareManagerChatSource =
  | {
      sourceType: 'chat_response';
      projectId: string;
      sessionId: string;
      turnIndex: number;
      sessionTitle: string;
      title: string;
      snapshot: ChatShareSnapshot;
    }
  | {
      sourceType: 'chat_session';
      projectId: string;
      sessionId: string;
      turnIndex?: never;
      sessionTitle: string;
      title: string;
      snapshot: ChatShareSnapshot;
    };

export type ShareManagerSource = ShareManagerProjectSource | ShareManagerChatSource;

export function isShareManagerProjectSource(
  source: ShareManagerSource,
): source is ShareManagerProjectSource {
  return source.sourceType === undefined || source.sourceType === 'project_document';
}

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

function shareManagerSourceDescription(source: ShareManagerSource): string {
  if (source.sourceType === 'chat_response') {
    return `Current response · ${source.sessionTitle}`;
  }
  if (source.sourceType === 'chat_session') {
    return `Full session · ${source.sessionTitle}`;
  }
  return source.path;
}

function shareRecordDescription(record: RegistryShareRecord): string {
  if (record.sourceType === 'chat_response') {
    return `Current response · ${record.title} · turn ${record.turnIndex}`;
  }
  if (record.sourceType === 'chat_session') {
    return `Full session · ${record.title}`;
  }
  return record.path;
}

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
  const [deleteTarget, setDeleteTarget] = useState<RegistryShareRecord | null>(null);
  const [deleteError, setDeleteError] = useState('');
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
    setDeleteTarget(null);
    setDeleteError('');
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
      const common = {
        projectId: currentSource.projectId,
        title: titleDraft.trim(),
        expiry,
        encoding: 'gzip+base64' as const,
        content: compressed.content,
      };
      let payload: RegistryShareCreatePayload;
      if (currentSource.sourceType === 'chat_response') {
        payload = {
          ...common,
          sourceType: 'chat_response',
          sessionId: currentSource.sessionId,
          turnIndex: currentSource.turnIndex,
        };
      } else if (currentSource.sourceType === 'chat_session') {
        payload = {
          ...common,
          sourceType: 'chat_session',
          sessionId: currentSource.sessionId,
        };
      } else if (isShareManagerProjectSource(currentSource)) {
        payload = {
          ...common,
          path: currentSource.path,
          kind: currentSource.kind,
        };
      } else {
        throw new Error('Unsupported public share source.');
      }
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
    setBusy(true);
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
    } finally {
      setBusy(false);
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

  const requestDeleteShare = (record: RegistryShareRecord) => {
    if (busyToken) return;
    setError('');
    setDeleteError('');
    setDeleteTarget(record);
  };

  const deleteShare = async () => {
    const record = deleteTarget;
    if (!record || busyToken) return;
    setBusyToken(record.token);
    setDeleteError('');
    try {
      await service.deleteShare(record.token);
      setRecords(current => current.filter(item => item.token !== record.token));
      setDeleteTarget(null);
      setNotice('Share deleted.');
    } catch (deleteError) {
      setDeleteError(deleteError instanceof Error ? deleteError.message : String(deleteError));
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
            <div className="app-confirm-name">{shareManagerSourceDescription(source)}</div>

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
              <>
                <a
                  className="app-confirm-btn secondary share-link-icon-action"
                  href={createdUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open share link"
                  data-tooltip="Open share link"
                >
                  <Icon name="externalLink" />
                </a>
                <button
                  type="button"
                  className="app-confirm-btn primary share-link-icon-action"
                  aria-label="Copy share link"
                  data-tooltip="Copy share link"
                  onClick={() => void copyCreatedLink()}
                >
                  <Icon name="copy" />
                </button>
              </>
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
                <strong>{record.title || shareRecordDescription(record)}</strong>
                <span>{shareRecordDescription(record)} · {record.expiresAt ? `expires ${formatExpiry(record.expiresAt)}` : 'permanent'}</span>
              </div>
              <div className="share-manager-record-actions">
                {record.url ? (
                  <a
                    className="share-link-icon-action"
                    href={record.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open share link"
                    data-tooltip="Open share link"
                    data-share-action="open"
                  >
                    <Icon name="externalLink" />
                  </a>
                ) : (
                  <button
                    type="button"
                    className="share-link-icon-action"
                    aria-label="Open share link"
                    data-tooltip="Open share link"
                    data-share-action="open"
                    disabled
                  >
                    <Icon name="externalLink" />
                  </button>
                )}
                <button
                  type="button"
                  className="share-link-icon-action"
                  aria-label="Copy share link"
                  data-tooltip="Copy share link"
                  data-share-action="copy"
                  onClick={() => void copyLink(record)}
                  disabled={!record.url}
                >
                  <Icon name="copy" />
                </button>
                <button
                  type="button"
                  className="share-link-icon-action share-manager-danger-button"
                  aria-label="Delete share"
                  data-tooltip="Delete share"
                  data-share-action="delete"
                  onClick={() => requestDeleteShare(record)}
                  disabled={Boolean(busyToken)}
                >
                  <Icon name={busyToken === record.token ? 'loader' : 'trash'} spin={busyToken === record.token} />
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
      <AppConfirmDialog
        target={deleteTarget ? {
          kind: 'shareDelete',
          title: deleteTarget.title || shareRecordDescription(deleteTarget),
        } : null}
        busy={Boolean(deleteTarget && busyToken === deleteTarget.token)}
        error={deleteError}
        onCancel={() => {
          if (busyToken) return;
          setDeleteTarget(null);
          setDeleteError('');
        }}
        onPrimary={() => void deleteShare()}
      />
    </div>
  );
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString();
}
