import React from 'react';

import {samePortRelayTarget, type PortRelayTarget} from '../portRelay/portRelayTargets';
import type {RegistryPortRelaySnapshot} from '../types/registry';

type PortRelaySettingsPatch = {
  listenPort?: number;
};

type PortRelaySettingsDetailProps = {
  hubIds: string[];
  portRelaySnapshot: RegistryPortRelaySnapshot;
  portRelayError: string;
  portRelayLoading: boolean;
  portRelayListenPort: string;
  setPortRelayListenPort: (value: string) => void;
  persistPortRelaySettings: (patch: PortRelaySettingsPatch) => void;
  portRelayAccessCodeUnknown: boolean;
  portRelayAccessCode: string;
  regeneratePortRelayAccessCode: () => Promise<void>;
  copyPortRelayAccessCode: () => Promise<void>;
  portRelayCodeCopied: boolean;
  portRelayTargets: PortRelayTarget[];
  selectedPortRelayTarget: PortRelayTarget | null;
  selectPortRelayTarget: (target: PortRelayTarget) => Promise<void>;
  deletePortRelayTarget: (target: PortRelayTarget) => Promise<void>;
  portRelayDraftHubId: string;
  setPortRelayDraftHubId: (value: string) => void;
  portRelayDraftPort: string;
  setPortRelayDraftPort: (value: string) => void;
  commitPortRelayDraftTarget: () => PortRelayTarget | null;
  enablePortRelay: () => Promise<void>;
  disablePortRelay: () => Promise<void>;
};

export function PortRelaySettingsDetail({
  hubIds,
  portRelaySnapshot,
  portRelayError,
  portRelayLoading,
  portRelayListenPort,
  setPortRelayListenPort,
  persistPortRelaySettings,
  portRelayAccessCodeUnknown,
  portRelayAccessCode,
  regeneratePortRelayAccessCode,
  copyPortRelayAccessCode,
  portRelayCodeCopied,
  portRelayTargets,
  selectedPortRelayTarget,
  selectPortRelayTarget,
  deletePortRelayTarget,
  portRelayDraftHubId,
  setPortRelayDraftHubId,
  portRelayDraftPort,
  setPortRelayDraftPort,
  commitPortRelayDraftTarget,
  enablePortRelay,
  disablePortRelay,
}: PortRelaySettingsDetailProps) {
  const selectedTarget = selectedPortRelayTarget ?? portRelayTargets[0] ?? null;
  const statusClass = String(portRelaySnapshot.status || 'Disabled').toLowerCase();
  const portRelayTargetDisplay = selectedTarget ? `${selectedTarget.hubId} -> 127.0.0.1:${selectedTarget.targetPort}` : 'No target';
  const listenPortNumber = Number(portRelayListenPort);
  const hasPendingListenPortChange =
    portRelaySnapshot.enabled &&
    typeof portRelaySnapshot.listenPort === 'number' &&
    Number.isInteger(listenPortNumber) &&
    listenPortNumber !== portRelaySnapshot.listenPort;

  return (
    <div className="port-relay-panel port-relay-panel-shell">
      <div className="port-relay-section port-relay-status-section">
        <div className="port-relay-header">
          <span className="port-relay-section-title">
            <span className="codicon codicon-radio-tower" aria-hidden="true" />
            Relay
          </span>
          <span className={`port-relay-status-pill ${statusClass}`}>{portRelaySnapshot.status}</span>
          <code className="port-relay-target-inline" title={portRelayTargetDisplay}>
            {portRelayTargetDisplay}
          </code>
        </div>
        {hasPendingListenPortChange ? (
          <div className="port-relay-pending-note">Listen port change applies on Enable.</div>
        ) : null}
      </div>
      {portRelayError || portRelaySnapshot.error ? (
        <div className="settings-metadata-error">{portRelayError || portRelaySnapshot.error}</div>
      ) : null}
      <div className="port-relay-section port-relay-control-section">
        <div className="port-relay-section-title">
          <span className="codicon codicon-key" aria-hidden="true" />
          Access
        </div>
        <div className="port-relay-form-grid">
          <label>
            <span>Listen Port</span>
            <input
              value={portRelayListenPort}
              inputMode="numeric"
              onChange={event => {
                const nextValue = event.target.value.replace(/[^\d]/g, '').slice(0, 5);
                const nextPort = Number(nextValue);
                setPortRelayListenPort(nextValue);
                if (Number.isInteger(nextPort) && nextPort >= 1 && nextPort <= 65535) {
                  persistPortRelaySettings({listenPort: nextPort});
                }
              }}
            />
          </label>
        </div>
        <div className="port-relay-code-row">
          <input
            value={portRelayAccessCodeUnknown ? '' : portRelayAccessCode}
            placeholder={portRelayAccessCodeUnknown ? 'Unknown' : ''}
            readOnly
            aria-label="Port relay access code"
          />
          <button
            type="button"
            className="settings-detail-action-btn"
            onClick={() => regeneratePortRelayAccessCode().catch(() => undefined)}
            disabled={portRelayLoading}
          >
            {portRelayAccessCodeUnknown ? 'Reset Code' : 'Generate'}
          </button>
          <button
            type="button"
            className="settings-detail-action-btn port-relay-copy-btn"
            onClick={() => copyPortRelayAccessCode().catch(() => undefined)}
            disabled={portRelayAccessCodeUnknown || !portRelayAccessCode}
            aria-label="Copy port relay access code"
          >
            <span className={`codicon ${portRelayCodeCopied ? 'codicon-check' : 'codicon-copy'}`} aria-hidden="true" />
            {portRelayCodeCopied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="port-relay-section port-relay-targets-section">
        <div className="port-relay-targets-header">
          <span className="port-relay-section-title">
            <span className="codicon codicon-server-process" aria-hidden="true" />
            Targets
          </span>
          <span>{'Hub -> 127.0.0.1:Port'}</span>
        </div>
        <div className="port-relay-target-list">
          {portRelayTargets.map(target => {
            const selected = samePortRelayTarget(selectedTarget, target);
            return (
              <div
                key={`${target.hubId}:${target.targetPort}`}
                className={`port-relay-target-list-row${selected ? ' selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={event => {
                    if (!event.target.checked) {
                      return;
                    }
                    selectPortRelayTarget(target).catch(() => undefined);
                  }}
                  aria-label={`Use ${target.hubId}:${target.targetPort}`}
                />
                <span className="port-relay-target-hub">{target.hubId}</span>
                <code className="port-relay-target-port">{target.targetPort}</code>
                <button
                  type="button"
                  className="port-relay-target-delete"
                  onClick={() => deletePortRelayTarget(target).catch(() => undefined)}
                  disabled={portRelayLoading}
                  title="Delete target"
                  aria-label={`Delete ${target.hubId}:${target.targetPort}`}
                >
                  <span className="codicon codicon-close" />
                </button>
              </div>
            );
          })}
          <div className="port-relay-target-list-row draft">
            <span className="port-relay-target-check-spacer" aria-hidden="true" />
            <select
              value={portRelayDraftHubId}
              onChange={event => setPortRelayDraftHubId(event.target.value)}
              disabled={hubIds.length === 0}
              aria-label="New relay target hub"
            >
              <option value="">{hubIds.length === 0 ? 'No hub' : 'Hub'}</option>
              {hubIds.map(hubId => (
                <option key={hubId} value={hubId}>{hubId}</option>
              ))}
            </select>
            <input
              value={portRelayDraftPort}
              inputMode="numeric"
              onChange={event => setPortRelayDraftPort(event.target.value.replace(/[^\d]/g, '').slice(0, 5))}
              onBlur={() => {
                commitPortRelayDraftTarget();
              }}
              onKeyDown={event => {
                if (event.key !== 'Enter') {
                  return;
                }
                event.preventDefault();
                commitPortRelayDraftTarget();
              }}
              aria-label="New relay target port"
            />
            <span className="port-relay-target-delete-spacer" aria-hidden="true" />
          </div>
        </div>
      </div>
      <div className="port-relay-actions">
        <button
          type="button"
          className="settings-detail-action-btn"
          onClick={() => enablePortRelay().catch(() => undefined)}
          disabled={portRelayLoading || !selectedTarget}
        >
          {portRelayLoading ? 'Working...' : 'Enable'}
        </button>
        <button
          type="button"
          className="settings-detail-action-btn danger"
          onClick={() => disablePortRelay().catch(() => undefined)}
          disabled={portRelayLoading || !portRelaySnapshot.enabled}
        >
          Disable
        </button>
      </div>
    </div>
  );
}
