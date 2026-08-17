import React from 'react';

import {Icon} from '../common/Icon';
import type {
  RegistryHubConfig,
  RegistryHubConfigUpdatePayload,
  RegistryHubMCPImportPreview,
  RegistryHubMCPRuntimeStatusData,
  RegistryHubMCPRuntimeState,
  RegistryHubMCPServerSnapshot,
  RegistryHubMCPTransport,
} from '../registry/registryTypes';

export interface ChatHubMcpConfigView {
  loading: boolean;
  error: string;
  data: RegistryHubConfig | null;
  busyField: string;
}

interface MCPValueDraft {
  key: string;
  originalKey?: string;
  value: string;
  secret: boolean;
  configured: boolean;
}

interface MCPFormState {
  id?: string;
  name: string;
  enabled: boolean;
  transport: RegistryHubMCPTransport;
  command: string;
  args: string;
  cwd: string;
  originalCwd: string;
  url: string;
  values: MCPValueDraft[];
  clearValues: string[];
  importedFrom?: string;
}

export interface ChatHubMcpDetailProps {
  hubId: string;
  configView: ChatHubMcpConfigView | undefined;
  preview: RegistryHubMCPImportPreview | undefined;
  statuses: RegistryHubMCPRuntimeStatusData | undefined;
  onUpdateHubConfig: (hubId: string, update: RegistryHubConfigUpdatePayload) => Promise<void>;
  onRequestRestart: () => void;
}

function emptyMCPForm(): MCPFormState {
  return {
    name: '',
    enabled: true,
    transport: 'stdio',
    command: '',
    args: '',
    cwd: '',
    originalCwd: '',
    url: '',
    values: [],
    clearValues: [],
  };
}

function draftFromServer(server: RegistryHubMCPServerSnapshot): MCPFormState {
  const source = server.transport === 'stdio' ? server.env : server.headers;
  const values = Object.entries(source ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, snapshot]) => ({
      key,
      originalKey: key,
      value: snapshot.secret ? '' : snapshot.value ?? '',
      secret: snapshot.secret,
      configured: snapshot.configured,
    }));
  return {
    id: server.id,
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command ?? '',
    args: (server.args ?? []).join('\n'),
    cwd: server.cwd ?? '',
    originalCwd: server.cwd ?? '',
    url: server.url ?? '',
    values,
    clearValues: [],
    importedFrom: server.importedFrom,
  };
}

function statusLabel(state: RegistryHubMCPRuntimeState): string {
  switch (state) {
    case 'not_started':
      return 'Not started';
    case 'starting':
      return 'Starting';
    case 'connected':
      return 'Connected';
    case 'failed':
      return 'Failed';
    case 'disabled':
      return 'Disabled';
    default:
      return state;
  }
}

function valueMap(values: MCPValueDraft[]): Record<string, {value: string; secret: boolean}> | undefined {
  const output: Record<string, {value: string; secret: boolean}> = {};
  for (const item of values) {
    const key = item.key.trim();
    if (!key) continue;
    // A configured secret is intentionally omitted when its editor is blank;
    // the Hub merges omitted values and keeps the existing secret.
    if (item.configured && item.secret && !item.value) continue;
    output[key] = {value: item.value, secret: item.secret};
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function formPayload(form: MCPFormState): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...(form.id ? {id: form.id} : {}),
    name: form.name.trim(),
    transport: form.transport,
    ...(form.id ? {} : {enabled: form.enabled}),
  };
  if (form.transport === 'stdio') {
    payload.command = form.command.trim();
    const args = form.args.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    payload.args = args;
    if (form.cwd.trim()) {
      payload.cwd = form.cwd.trim();
    } else if (form.id && form.originalCwd.trim()) {
      payload.clearCwd = true;
    }
    const env = valueMap(form.values);
    if (env) payload.env = env;
    if (form.id && form.clearValues.length > 0) payload.clearEnv = form.clearValues;
    if (form.id) {
      const renameEnv = form.values
        .map(item => ({from: item.originalKey?.trim() ?? '', to: item.key.trim()}))
        .filter(item => item.from && item.to && item.from !== item.to);
      if (renameEnv.length > 0) payload.renameEnv = renameEnv;
    }
  } else {
    payload.url = form.url.trim();
    const headers = valueMap(form.values);
    if (headers) payload.headers = headers;
    if (form.id && form.clearValues.length > 0) payload.clearHeaders = form.clearValues;
    if (form.id) {
      const renameHeaders = form.values
        .map(item => ({from: item.originalKey?.trim() ?? '', to: item.key.trim()}))
        .filter(item => item.from && item.to && item.from !== item.to);
      if (renameHeaders.length > 0) payload.renameHeaders = renameHeaders;
    }
  }
  if (form.importedFrom) payload.importedFrom = form.importedFrom;
  return payload;
}

export function ChatHubMcpDetail({
  hubId,
  configView,
  preview,
  statuses,
  onUpdateHubConfig,
  onRequestRestart,
}: ChatHubMcpDetailProps): React.JSX.Element {
  const config = configView?.data ?? null;
  const servers = config?.mcpServers ?? [];
  const statusById = React.useMemo(
    () => new Map((statuses?.servers ?? []).map(status => [status.serverId, status])),
    [statuses],
  );
  const [form, setForm] = React.useState<MCPFormState | null>(null);
  const [formError, setFormError] = React.useState('');
  const [importError, setImportError] = React.useState('');
  const [importBusy, setImportBusy] = React.useState(false);
  const [pendingImportValue, setPendingImportValue] = React.useState<string | null>(null);
  const [previewDismissed, setPreviewDismissed] = React.useState(false);
  const importInputRef = React.useRef<HTMLInputElement | null>(null);
  const importSourceRef = React.useRef<'codex' | 'claude'>('codex');
  const configBusy = configView?.busyField.startsWith('mcpServers') === true;

  const updateForm = (patch: Partial<MCPFormState>) => {
    setForm(current => current ? {...current, ...patch} : current);
  };

  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form || !form.name.trim()) {
      setFormError('A server name is required.');
      return;
    }
    if (form.transport === 'stdio' && !form.command.trim()) {
      setFormError('A STDIO command is required.');
      return;
    }
    if (form.transport === 'http' && !form.url.trim()) {
      setFormError('An HTTP URL is required.');
      return;
    }
    setFormError('');
    const action = form.id ? 'update' : 'add';
    try {
      await onUpdateHubConfig(hubId, {
        section: 'mcpServers',
        field: form.id,
        action,
        value: JSON.stringify(formPayload(form)),
      });
      setForm(null);
    } catch {
      // The parent keeps the server error visible in the menu.
    }
  };

  const beginImport = (source: 'codex' | 'claude') => {
    importSourceRef.current = source;
    importInputRef.current?.click();
  };

  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const source = importSourceRef.current;
    setImportBusy(true);
    setImportError('');
    setPreviewDismissed(false);
    try {
      const value = JSON.stringify({source, raw: await file.text()});
      await onUpdateHubConfig(hubId, {
        section: 'mcpServers',
        action: 'preview',
        value,
      });
      setPendingImportValue(value);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImportBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!pendingImportValue || !preview || preview.issues.length > 0 || preview.conflicts.length > 0) return;
    setImportBusy(true);
    setImportError('');
    try {
      await onUpdateHubConfig(hubId, {
        section: 'mcpServers',
        action: 'import',
        value: pendingImportValue,
      });
      setPendingImportValue(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImportBusy(false);
    }
  };

  const addValue = () => {
    updateForm({values: [...(form?.values ?? []), {key: '', value: '', secret: false, configured: false}]});
  };

  const updateValue = (index: number, patch: Partial<MCPValueDraft>) => {
    if (!form) return;
    updateForm({values: form.values.map((item, itemIndex) => itemIndex === index ? {...item, ...patch} : item)});
  };

  const removeValue = (index: number) => {
    if (!form) return;
    const value = form.values[index];
    const keys = [value?.key.trim() ?? '', value?.originalKey?.trim() ?? '']
      .filter((key, keyIndex, all) => key && all.indexOf(key) === keyIndex);
    updateForm({
      values: form.values.filter((_, itemIndex) => itemIndex !== index),
      clearValues: value?.configured
        ? [...form.clearValues, ...keys.filter(key => !form.clearValues.includes(key))]
        : form.clearValues,
    });
  };

  return (
    <div className="chat-hub-detail chat-hub-mcp-detail">
      <div className="chat-hub-detail-toolbar">
        <span className="chat-hub-detail-title">MCP servers</span>
        <span className="chat-hub-mcp-toolbar-actions">
          <button
            type="button"
            className="chat-hub-detail-action"
            aria-label="Import Codex MCP servers"
            disabled={!config || configBusy || importBusy}
            onClick={() => beginImport('codex')}
          >
            Import Codex
          </button>
          <button
            type="button"
            className="chat-hub-detail-action"
            aria-label="Import Claude MCP servers"
            disabled={!config || configBusy || importBusy}
            onClick={() => beginImport('claude')}
          >
            Import Claude
          </button>
          <button
            type="button"
            className="chat-hub-detail-action"
            aria-label="Add MCP server"
            disabled={!config || configBusy || importBusy}
            onClick={() => {
              setForm(emptyMCPForm());
              setFormError('');
            }}
          >
            <Icon name="plus" />
            Add
          </button>
          <button
            type="button"
            className="chat-hub-detail-action"
            aria-label="Restart MCP runtime"
            disabled={!config || configBusy || importBusy}
            onClick={onRequestRestart}
          >
            Restart
          </button>
        </span>
      </div>
      <input
        ref={importInputRef}
        className="chat-hub-mcp-import-input"
        type="file"
        accept=".toml,.json,application/json,application/toml"
        aria-hidden="true"
        tabIndex={-1}
        onChange={event => void importFile(event)}
      />
      {configView?.loading && !config ? <div className="chat-hub-detail-empty">Loading MCP configuration…</div> : null}
      {configView?.error ? <div className="chat-hub-ops-error">{configView.error}</div> : null}
      {importError ? <div className="chat-hub-ops-error">{importError}</div> : null}
      {pendingImportValue && preview && !previewDismissed ? (
        <div className="chat-hub-mcp-import-preview">
          <div className="chat-hub-mcp-import-preview-title">
            Import preview · {preview.source === 'codex' ? 'Codex' : 'Claude'}
          </div>
          <div className="chat-hub-mcp-import-preview-summary">
            {preview.servers.length} server{preview.servers.length === 1 ? '' : 's'} available
          </div>
          {preview.servers.length > 0 ? (
            <div className="chat-hub-mcp-import-preview-list">
              {preview.servers.map(server => (
                <span key={server.name} className="chat-hub-mcp-import-preview-chip">
                  {server.name} · {server.transport.toUpperCase()}
                </span>
              ))}
            </div>
          ) : null}
          {preview.conflicts.length > 0 ? (
            <div className="chat-hub-ops-error">Conflicts: {preview.conflicts.join(', ')}</div>
          ) : null}
          {preview.issues.length > 0 ? (
            <div className="chat-hub-ops-error">
              Unsupported: {preview.issues.map(issue => `${issue.name} (${issue.reason})`).join('; ')}
            </div>
          ) : null}
          <div className="chat-hub-mcp-form-actions">
            <button
              type="button"
              className="chat-hub-detail-action"
              aria-label="Cancel MCP import"
              disabled={importBusy}
              onClick={() => {
                setPreviewDismissed(true);
                setPendingImportValue(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="chat-hub-detail-action accent"
              aria-label="Confirm MCP import"
              disabled={importBusy || preview.servers.length === 0 || preview.issues.length > 0 || preview.conflicts.length > 0}
              onClick={() => void confirmImport()}
            >
              {importBusy ? 'Importing…' : 'Import available'}
            </button>
          </div>
        </div>
      ) : null}
      {form ? (
        <form className="chat-hub-mcp-form" onSubmit={event => void submitForm(event)}>
          <div className="chat-hub-mcp-form-grid">
            <label>
              <span>Name</span>
              <input
                aria-label="MCP server name"
                value={form.name}
                onChange={event => updateForm({name: event.target.value})}
                autoFocus
              />
            </label>
            <label>
              <span>Transport</span>
              <select
                aria-label="MCP transport"
                value={form.transport}
                onChange={event => {
                  const transport = event.target.value === 'http' ? 'http' : 'stdio';
                  updateForm({
                    transport,
                    command: transport === 'stdio' ? form.command : '',
                    args: transport === 'stdio' ? form.args : '',
                    cwd: transport === 'stdio' ? form.cwd : '',
                    url: transport === 'http' ? form.url : '',
                    values: [],
                  });
                }}
              >
                <option value="stdio">STDIO</option>
                <option value="http">Streamable HTTP</option>
              </select>
            </label>
          </div>
          {form.transport === 'stdio' ? (
            <>
              <label>
                <span>Command</span>
                <input
                  aria-label="MCP command"
                  value={form.command}
                  onChange={event => updateForm({command: event.target.value})}
                  placeholder="python"
                />
              </label>
              <label>
                <span>Arguments <small>(one per line)</small></span>
                <textarea
                  aria-label="MCP arguments"
                  rows={2}
                  value={form.args}
                  onChange={event => updateForm({args: event.target.value})}
                />
              </label>
              <label>
                <span>Working directory <small>(optional)</small></span>
                <input
                  aria-label="MCP working directory"
                  value={form.cwd}
                  onChange={event => updateForm({cwd: event.target.value})}
                />
              </label>
            </>
          ) : (
            <label>
              <span>URL</span>
              <input
                aria-label="MCP URL"
                value={form.url}
                onChange={event => updateForm({url: event.target.value})}
                placeholder="https://example.com/mcp"
              />
            </label>
          )}
          <div className="chat-hub-mcp-values">
            <div className="chat-hub-mcp-values-toolbar">
              <span>{form.transport === 'stdio' ? 'Environment variables' : 'HTTP headers'}</span>
              <button type="button" className="chat-hub-icon-btn" aria-label="Add MCP value" onClick={addValue}>
                <Icon name="plus" />
              </button>
            </div>
            {form.values.map((item, index) => (
              <div className="chat-hub-mcp-value-row" key={`${item.key}:${index}`}>
                <input
                  aria-label={`MCP value name ${index + 1}`}
                  value={item.key}
                  placeholder="NAME"
                  onChange={event => updateValue(index, {key: event.target.value})}
                />
                <input
                  aria-label={`MCP value ${index + 1}`}
                  type={item.secret ? 'password' : 'text'}
                  value={item.value}
                  placeholder={item.configured && item.secret ? 'Configured; leave blank to preserve' : 'Value'}
                  onChange={event => updateValue(index, {value: event.target.value})}
                />
                <label className="chat-hub-mcp-secret-toggle">
                  <input
                    type="checkbox"
                    checked={item.secret}
                    onChange={event => updateValue(index, {secret: event.target.checked})}
                  />
                  Secret
                </label>
                <button
                  type="button"
                  className="chat-hub-icon-btn danger"
                  aria-label={`Remove MCP value ${index + 1}`}
                  onClick={() => removeValue(index)}
                >
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </div>
          {formError ? <div className="chat-hub-ops-error">{formError}</div> : null}
          <div className="chat-hub-mcp-form-actions">
            <button type="button" className="chat-hub-detail-action" onClick={() => setForm(null)}>Cancel</button>
            <button type="submit" className="chat-hub-detail-action accent" disabled={configBusy}>
              {configBusy ? 'Saving…' : form.id ? 'Save changes' : 'Add server'}
            </button>
          </div>
        </form>
      ) : null}
      {!configView?.loading && !configView?.error && servers.length === 0 && !form ? (
        <div className="chat-hub-detail-empty">No MCP servers configured.</div>
      ) : null}
      {config ? servers.map(server => {
        const status = statusById.get(server.id);
        const state: RegistryHubMCPRuntimeState = status?.state ?? (server.enabled ? 'not_started' : 'disabled');
        return (
          <div key={server.id} className="chat-hub-mcp-row">
            <span className="chat-hub-mcp-copy">
              <span className="chat-hub-mcp-name">{server.name}</span>
              <span className="chat-hub-mcp-meta">
                {server.transport === 'stdio' ? server.command : server.url}
                {server.importedFrom ? ` · imported from ${server.importedFrom}` : ''}
              </span>
            </span>
            <span
              className={`chat-hub-mcp-status state-${state}`}
              data-tooltip={status?.error}
            >
              {statusLabel(state)}
            </span>
            <span className="chat-hub-mcp-actions">
              <button
                type="button"
                className="chat-hub-icon-btn"
                aria-label={`Edit ${server.name}`}
                disabled={configBusy || importBusy}
                onClick={() => {
                  setForm(draftFromServer(server));
                  setFormError('');
                }}
              >
                <Icon name="pencil" />
              </button>
              <button
                type="button"
                className="chat-hub-icon-btn"
                aria-label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`}
                disabled={configBusy || importBusy}
                onClick={() => void onUpdateHubConfig(hubId, {
                  section: 'mcpServers',
                  field: server.id,
                  action: server.enabled ? 'disable' : 'enable',
                }).catch(() => undefined)}
              >
                <Icon name={server.enabled ? 'pause' : 'play'} />
              </button>
              <button
                type="button"
                className="chat-hub-icon-btn danger"
                aria-label={`Delete ${server.name}`}
                disabled={configBusy || importBusy}
                onClick={() => {
                  if (typeof window !== 'undefined' && !window.confirm(`Delete MCP server ${server.name}?`)) return;
                  void onUpdateHubConfig(hubId, {
                    section: 'mcpServers',
                    field: server.id,
                    action: 'delete',
                  }).catch(() => undefined);
                }}
              >
                <Icon name="trash" />
              </button>
            </span>
          </div>
        );
      }) : null}
    </div>
  );
}
