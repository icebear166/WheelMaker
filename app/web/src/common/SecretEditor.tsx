import React from 'react';

import {Icon} from './Icon';

interface SecretEditorProps {
  label: string;
  configured: boolean;
  updatedAt?: string;
  busy: boolean;
  /** Single-row layout: status icon + label + inline input + set/clear. */
  compact?: boolean;
  onSet: (value: string) => Promise<void>;
  onClear: () => Promise<void>;
}

/**
 * Shared password-input editor for secret values (API keys, tokens). The
 * backend only reports configured/updatedAt markers, so the editor always
 * starts empty: Set stores a new value, Replace overwrites, Clear removes.
 */
export function SecretEditor({label, configured, updatedAt, busy, compact = false, onSet, onClear}: SecretEditorProps): React.JSX.Element {
  const [draft, setDraft] = React.useState('');
  const submit = async () => {
    const value = draft.trim();
    if (!value) {
      return;
    }
    try {
      await onSet(value);
      setDraft('');
    } catch {
      // Parent exposes the failure while keeping this draft available for retry.
    }
  };
  const clear = () => void onClear().catch(() => undefined);
  if (compact) {
    const configuredAt = configured && updatedAt ? new Date(updatedAt).toLocaleString() : '';
    return (
      <div className="secret-compact-row">
        <span
          className={`secret-compact-status${configured ? ' configured' : ''}`}
          role="img"
          aria-label={configured ? 'Configured' : 'Not configured'}
          title={configured ? `Configured${configuredAt ? ` · ${configuredAt}` : ''}` : 'Not configured'}
        >
          <Icon name={configured ? 'check' : 'x'} />
        </span>
        <span className="secret-compact-label">{label}</span>
        <input
          type="password"
          autoComplete="new-password"
          className="secret-compact-input"
          placeholder={configured ? 'Replace secret' : 'Enter secret'}
          value={draft}
          disabled={busy}
          onChange={event => setDraft(event.target.value)}
          aria-label={`${label} secret`}
        />
        <button
          type="button"
          className="secret-compact-set"
          disabled={busy || !draft.trim()}
          onClick={() => void submit()}
        >
          {configured ? 'Replace' : 'Set'}
        </button>
        {configured ? (
          <button
            type="button"
            className="secret-compact-clear"
            aria-label={`Clear ${label}`}
            disabled={busy}
            onClick={clear}
          >
            <Icon name="x" />
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="voice-input-settings-nested">
      <div className="settings-row sidebar-setting-row voice-input-settings-child-row">
        <span>
          <Icon name="keyRound" className="settings-row-icon" />
          {label}
          <span className="settings-metadata-line set-mono">
            {configured ? 'Configured' : 'Not configured'}
            {updatedAt ? ` · ${new Date(updatedAt).toLocaleString()}` : ''}
          </span>
        </span>
      </div>
      <div className="settings-row sidebar-setting-row voice-input-settings-child-row">
        <input
          type="password"
          autoComplete="new-password"
          placeholder="Enter a new secret"
          value={draft}
          disabled={busy}
          onChange={event => setDraft(event.target.value)}
          aria-label={`${label} secret`}
        />
        <button type="button" className="set-btn" disabled={busy || !draft.trim()} onClick={() => void submit()}>
          {configured ? 'Replace' : 'Set'}
        </button>
        {configured ? (
          <button
            type="button"
            className="set-btn set-btn--danger"
            disabled={busy}
            onClick={clear}
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
