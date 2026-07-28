import React from 'react';

import type {
  RegistryFlickerBridgeMode,
  RegistryFlickerBridgeStatus,
} from '../registry/registryTypes';
import {flickerBridgeActions, flickerBridgeLabel} from './flickerBridgeState';

interface FlickerBridgeControlProps {
  status?: RegistryFlickerBridgeStatus;
  busy: boolean;
  onLifecycle(action: 'start' | 'stop' | 'restart'): void;
  onSwitchMode(mode: RegistryFlickerBridgeMode): void;
}

const flickerBridgeModes: RegistryFlickerBridgeMode[] = ['v1', 'v2'];

export function FlickerBridgeControl({
  status,
  busy,
  onLifecycle,
  onSwitchMode,
}: FlickerBridgeControlProps): React.JSX.Element {
  const state = status?.state ?? 'loading';
  const {canStart, canStop, canRestart} = flickerBridgeActions(status);

  return (
    <div className={`chat-hub-flicker-bridge state-${state}`} aria-live="polite">
      <div className="chat-hub-flicker-bridge-summary">
        <span className="chat-hub-flicker-bridge-dot" aria-hidden="true" />
        <span className="chat-hub-flicker-bridge-name">Flicker Bridge</span>
        <span className="chat-hub-flicker-bridge-state" title={status?.endpoint}>
          {flickerBridgeLabel(status)}
        </span>
      </div>
      <div className="chat-hub-flicker-bridge-actions">
        <div className="chat-hub-flicker-bridge-modes" role="group" aria-label="Flicker Bridge mode">
          {flickerBridgeModes.map(mode => {
            const selected = status?.mode === mode;
            const available = status?.availableModes.includes(mode) === true;
            return (
              <button
                key={mode}
                type="button"
                className={selected ? 'selected' : ''}
                aria-label={`Use Flicker Bridge ${mode.toUpperCase()}`}
                aria-pressed={selected}
                title={status?.modeErrors[mode]}
                disabled={busy || selected || !available}
                onClick={() => onSwitchMode(mode)}
              >
                {mode.toUpperCase()}
              </button>
            );
          })}
        </div>
        {canStop ? (
          <button
            type="button"
            aria-label="Stop Flicker Bridge"
            disabled={busy}
            onClick={() => onLifecycle('stop')}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            aria-label="Start Flicker Bridge"
            disabled={!canStart || busy}
            onClick={() => onLifecycle('start')}
          >
            Start
          </button>
        )}
        {canRestart ? (
          <button
            type="button"
            aria-label="Restart Flicker Bridge"
            disabled={busy}
            onClick={() => onLifecycle('restart')}
          >
            Restart
          </button>
        ) : null}
      </div>
      {status?.error ? (
        <span className="chat-hub-flicker-bridge-error" title={status.error}>
          {status.error}
        </span>
      ) : null}
    </div>
  );
}
