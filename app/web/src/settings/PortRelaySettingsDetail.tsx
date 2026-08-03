import React from 'react';

import {Icon} from '../common/Icon';
import {samePortRelayTarget, type PortRelayTarget} from '../portRelay/portRelayTargets';
import type {RegistryPortRelaySnapshot} from '../registry/registryTypes';

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
  clearPortRelaySiteData: () => Promise<void>;
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

function relayStatusVariant(statusClass: string): string {
  if (statusClass === 'up') return 'is-ok';
  if (statusClass === 'opening') return 'is-running';
  if (statusClass === 'error') return 'is-error';
  return 'is-idle';
}

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
  clearPortRelaySiteData,
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
  const [addingTarget, setAddingTarget] = React.useState(false);
  const [listenPortError, setListenPortError] = React.useState('');
  const selectedTarget = selectedPortRelayTarget ?? portRelayTargets[0] ?? null;
  const statusClass = String(portRelaySnapshot.status || 'Disabled').toLowerCase();
  const statusVariant = relayStatusVariant(statusClass);
  const portRelayTargetDisplay = selectedTarget ? `${selectedTarget.hubId} → 127.0.0.1:${selectedTarget.targetPort}` : 'No target';
  const listenPortNumber = Number(portRelayListenPort);
  const hasPendingListenPortChange =
    portRelaySnapshot.enabled &&
    typeof portRelaySnapshot.listenPort === 'number' &&
    Number.isInteger(listenPortNumber) &&
    listenPortNumber !== portRelaySnapshot.listenPort;

  const commitDraft = () => {
    const committed = commitPortRelayDraftTarget();
    if (committed) {
      setAddingTarget(false);
    }
  };

  return (
    <div className="port-relay-stack">
      <section className="set-card set-card--tight port-relay-status">
        <div className="set-card-head">
          <Icon name="radioTower" size={15} className="port-relay-section-icon" />
          <span className="set-card-title">Relay</span>
          <span className={`set-status ${statusVariant}`}>{portRelaySnapshot.status}</span>
          <span className="set-card-spacer" />
        </div>
        <code className="port-relay-target-display set-mono" data-tooltip={portRelayTargetDisplay}>
          {portRelayTargetDisplay}
        </code>
        {hasPendingListenPortChange ? (
          <div className="set-status is-warn port-relay-pending-note">Listen port change applies on Enable.</div>
        ) : null}
      </section>

      {portRelayError || portRelaySnapshot.error ? (
        <div className="set-error">{portRelayError || portRelaySnapshot.error}</div>
      ) : null}

      <section className="set-card">
        <div className="set-card-head">
          <Icon name="keyRound" size={15} className="port-relay-section-icon" />
          <span className="set-card-title">Access</span>
        </div>
        <div className="set-field">
          <span className="set-field-label">Listen Port</span>
          <input
            className="set-field-control"
            value={portRelayListenPort}
            inputMode="numeric"
            onChange={event => {
              const nextValue = event.target.value.replace(/[^\d]/g, '').slice(0, 5);
              const nextPort = Number(nextValue);
              setPortRelayListenPort(nextValue);
              if (nextValue && (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535)) {
                setListenPortError('Listen port must be 1-65535.');
              } else {
                setListenPortError('');
              }
              if (Number.isInteger(nextPort) && nextPort >= 1 && nextPort <= 65535) {
                persistPortRelaySettings({listenPort: nextPort});
              }
            }}
          />
          {listenPortError ? (
            <div className="set-error">{listenPortError}</div>
          ) : null}
        </div>
        <div className="set-field">
          <span className="set-field-label">Access Code</span>
          <div className="port-relay-code-row">
            <input
              className="set-field-control port-relay-code-input set-mono"
              value={portRelayAccessCodeUnknown ? '' : portRelayAccessCode}
              placeholder={portRelayAccessCodeUnknown ? 'Unknown' : ''}
              readOnly
              aria-label="Port relay access code"
            />
            <button
              type="button"
              className="set-btn"
              onClick={() => regeneratePortRelayAccessCode().catch(() => undefined)}
              disabled={portRelayLoading}
            >
              {portRelayAccessCodeUnknown ? 'Reset' : 'Generate'}
            </button>
            <button
              type="button"
              className="set-btn"
              onClick={() => copyPortRelayAccessCode().catch(() => undefined)}
              disabled={portRelayAccessCodeUnknown || !portRelayAccessCode}
              aria-label="Copy port relay access code"
            >
              <Icon name={portRelayCodeCopied ? 'check' : 'copy'} size={13} />
              {portRelayCodeCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </section>

      <section className="set-card">
        <div className="set-card-head">
          <Icon name="serverCog" size={15} className="port-relay-section-icon" />
          <span className="set-card-title">Targets</span>
          <span className="set-card-subtitle set-mono">Hub → 127.0.0.1:Port</span>
          <span className="set-card-spacer" />
        </div>
        <div className="port-relay-target-list">
          {portRelayTargets.map(target => {
            const selected = samePortRelayTarget(selectedTarget, target);
            return (
              <div
                key={`${target.hubId}:${target.targetPort}`}
                className={`port-relay-target-row${selected ? ' selected' : ''}`}
                onClick={event => {
                  if ((event.target as HTMLElement).tagName === 'INPUT') {
                    return;
                  }
                  if (!selected) {
                    selectPortRelayTarget(target).catch(() => undefined);
                  }
                }}
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
                <span className="port-relay-target-hub" data-tooltip={target.hubId}>{target.hubId}</span>
                <code className="port-relay-target-port set-mono">{target.targetPort}</code>
                <button
                  type="button"
                  className="set-btn set-btn--icon set-btn--danger"
                  onClick={() => deletePortRelayTarget(target).catch(() => undefined)}
                  disabled={portRelayLoading}
                  data-tooltip="Delete target"
                  aria-label={`Delete ${target.hubId}:${target.targetPort}`}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            );
          })}
          {portRelayTargets.length === 0 ? (
            <div className="set-muted port-relay-target-empty">No targets yet. Add one to enable Port Relay.</div>
          ) : null}
        </div>

        {addingTarget ? (
          <div className="port-relay-add-form">
            <select
              className="set-field-control"
              value={portRelayDraftHubId}
              onChange={event => setPortRelayDraftHubId(event.target.value)}
              disabled={hubIds.length === 0}
              aria-label="New relay target hub"
              onKeyDown={event => {
                if (event.key !== 'Enter') {
                  return;
                }
                event.preventDefault();
                commitDraft();
              }}
            >
              <option value="">{hubIds.length === 0 ? 'No hub' : 'Hub'}</option>
              {hubIds.map(hubId => (
                <option key={hubId} value={hubId}>{hubId}</option>
              ))}
            </select>
            <input
              className="set-field-control port-relay-add-port set-mono"
              value={portRelayDraftPort}
              inputMode="numeric"
              placeholder="Port"
              autoFocus
              onChange={event => setPortRelayDraftPort(event.target.value.replace(/[^\d]/g, '').slice(0, 5))}
              onKeyDown={event => {
                if (event.key !== 'Enter') {
                  return;
                }
                event.preventDefault();
                commitDraft();
              }}
              aria-label="New relay target port"
            />
            <button
              type="button"
              className="set-btn set-btn--primary"
              disabled={!portRelayDraftHubId || !portRelayDraftPort}
              onClick={commitDraft}
            >
              Add
            </button>
            <button
              type="button"
              className="set-btn"
              onClick={() => setAddingTarget(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="set-btn port-relay-add-btn"
            onClick={() => setAddingTarget(true)}
            disabled={hubIds.length === 0}
          >
            <Icon name="plus" size={14} />
            Add target
          </button>
        )}
      </section>

      <div className="port-relay-actions">
        <button
          type="button"
          className="set-btn set-btn--primary set-btn--lg"
          onClick={() => enablePortRelay().catch(() => undefined)}
          disabled={portRelayLoading || !selectedTarget}
        >
          {portRelayLoading ? 'Working...' : 'Enable'}
        </button>
        <button
          type="button"
          className="set-btn"
          onClick={() => clearPortRelaySiteData().catch(() => undefined)}
          disabled={portRelayLoading || !portRelaySnapshot.enabled}
          aria-label="Clear relay cache and service worker data"
        >
          <Icon name="eraser" size={14} />
          Clear Cache
        </button>
        <button
          type="button"
          className="set-btn set-btn--danger"
          onClick={() => disablePortRelay().catch(() => undefined)}
          disabled={portRelayLoading || !portRelaySnapshot.enabled}
        >
          Disable
        </button>
      </div>
    </div>
  );
}
