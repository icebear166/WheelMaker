import React, {useMemo, useState} from 'react';

import {
  SHORTCUT_COMMANDS,
  assignShortcutBinding,
  clearShortcutBinding,
  findShortcutConflict,
  formatShortcutBinding,
  normalizeShortcutEvent,
  replaceShortcutConflict,
  resetShortcutOverrides,
  resolveEffectiveShortcutBindings,
  restoreShortcutDefault,
  validateShortcutCandidate,
  type ShortcutActionId,
  type ShortcutBinding,
  type ShortcutOverrides,
  type ShortcutPlatform,
} from '../shortcuts/keyboardShortcuts';

export type KeyboardShortcutsSettingsDetailProps = {
  platform: ShortcutPlatform;
  overrides: ShortcutOverrides;
  onChange: (next: ShortcutOverrides) => void;
};

type Feedback = {
  kind: 'info' | 'warning' | 'error';
  message: string;
};

type PendingConflict = {
  actionId: ShortcutActionId;
  conflictActionId: ShortcutActionId;
  binding: ShortcutBinding;
};

const GROUPS = ['Navigation', 'Workbench', 'Search'] as const;

function commandName(actionId: ShortcutActionId): string {
  return SHORTCUT_COMMANDS.find(command => command.id === actionId)?.name ?? actionId;
}

function previewModifierKeys(
  event: React.KeyboardEvent<HTMLElement>,
  platform: ShortcutPlatform,
): string[] {
  const binding: ShortcutBinding = {key: ''};
  if (platform === 'mac') {
    if (event.metaKey) binding.primary = true;
    if (event.ctrlKey) binding.ctrl = true;
  } else {
    if (event.ctrlKey) binding.primary = true;
    if (event.metaKey) binding.meta = true;
  }
  if (event.altKey) binding.alt = true;
  if (event.shiftKey) binding.shift = true;
  return formatShortcutBinding(binding, platform).filter(Boolean);
}

function Keycaps({keys}: {keys: string[]}) {
  return (
    <span className="keyboard-shortcut-keycaps" aria-hidden="true">
      {keys.map((key, index) => (
        <React.Fragment key={`${key}-${index}`}>
          {index > 0 ? <span className="keyboard-shortcut-plus">+</span> : null}
          <kbd>{key}</kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

export function KeyboardShortcutsSettingsDetail({
  platform,
  overrides,
  onChange,
}: KeyboardShortcutsSettingsDetailProps) {
  const effective = useMemo(() => resolveEffectiveShortcutBindings(overrides), [overrides]);
  const customCount = Object.keys(overrides).length;
  const [recordingActionId, setRecordingActionId] = useState<ShortcutActionId | null>(null);
  const [recordingKeys, setRecordingKeys] = useState<string[]>([]);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const startRecording = (actionId: ShortcutActionId) => {
    setPendingConflict(null);
    setRecordingActionId(actionId);
    setRecordingKeys([]);
    setFeedback({kind: 'info', message: `Recording ${commandName(actionId)}. Press a shortcut or Escape to cancel.`});
  };

  const finishAssignment = (
    actionId: ShortcutActionId,
    binding: ShortcutBinding,
    warning: string,
  ) => {
    onChange(assignShortcutBinding(overrides, actionId, binding));
    setRecordingActionId(null);
    setRecordingKeys([]);
    setFeedback(warning
      ? {kind: 'warning', message: warning}
      : {kind: 'info', message: `${commandName(actionId)} updated.`});
  };

  const recordKeyDown = (
    actionId: ShortcutActionId,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setRecordingActionId(null);
      setRecordingKeys([]);
      setFeedback({kind: 'info', message: `${commandName(actionId)} recording cancelled.`});
      return;
    }

    const candidate = normalizeShortcutEvent(event.nativeEvent ?? event, platform);
    if (!candidate) {
      setRecordingKeys(previewModifierKeys(event, platform));
      return;
    }
    setRecordingKeys(formatShortcutBinding(candidate, platform));
    const validation = validateShortcutCandidate(candidate, platform);
    if (validation.kind === 'blocked') {
      setFeedback({kind: 'error', message: validation.message});
      return;
    }
    const conflictActionId = findShortcutConflict(effective, actionId, candidate);
    if (conflictActionId) {
      setPendingConflict({actionId, conflictActionId, binding: candidate});
      setRecordingActionId(null);
      setFeedback({
        kind: 'warning',
        message: `${formatShortcutBinding(candidate, platform).join(' + ')} is assigned to ${commandName(conflictActionId)}.`,
      });
      return;
    }
    finishAssignment(actionId, candidate, validation.kind === 'warning' ? validation.message : '');
  };

  const confirmConflictReplacement = () => {
    if (!pendingConflict) return;
    onChange(replaceShortcutConflict(
      overrides,
      pendingConflict.actionId,
      pendingConflict.binding,
      pendingConflict.conflictActionId,
    ));
    setFeedback({
      kind: 'info',
      message: `${commandName(pendingConflict.actionId)} updated; ${commandName(pendingConflict.conflictActionId)} is now unassigned.`,
    });
    setPendingConflict(null);
    setRecordingKeys([]);
  };

  return (
    <div className="keyboard-shortcuts-detail">
      <div className="keyboard-shortcuts-summary">
        <div>
          <strong>{SHORTCUT_COMMANDS.length} commands</strong>
          <span>{customCount} customized</span>
        </div>
        <button
          type="button"
          className="keyboard-shortcuts-reset"
          aria-label="Reset all shortcuts"
          disabled={customCount === 0}
          onClick={() => setResetConfirmOpen(true)}
        >
          Reset all
        </button>
      </div>

      {resetConfirmOpen ? (
        <div className="keyboard-shortcuts-reset-confirm" role="group" aria-label="Reset all shortcuts confirmation">
          <span>Restore all default shortcuts?</span>
          <button
            type="button"
            aria-label="Confirm reset all shortcuts"
            onClick={() => {
              onChange(resetShortcutOverrides(overrides));
              setResetConfirmOpen(false);
              setFeedback({kind: 'info', message: 'All shortcuts restored to defaults.'});
            }}
          >
            Reset
          </button>
          <button type="button" onClick={() => setResetConfirmOpen(false)}>Cancel</button>
        </div>
      ) : null}

      <div className="keyboard-shortcuts-groups">
        {GROUPS.map(group => (
          <section key={group} className="keyboard-shortcuts-group" aria-label={`${group} shortcuts`}>
            <h3>{group}</h3>
            <div className="keyboard-shortcuts-command-list">
              {SHORTCUT_COMMANDS.filter(command => command.group === group).map(command => {
                const binding = effective[command.id];
                const isRecording = recordingActionId === command.id;
                const isCustomized = Object.prototype.hasOwnProperty.call(overrides, command.id);
                return (
                  <div className={`keyboard-shortcut-command${isRecording ? ' is-recording' : ''}`} key={command.id}>
                    <div className="keyboard-shortcut-command-copy">
                      <strong>{command.name}</strong>
                      <span>{command.description}</span>
                      <small>{command.condition}</small>
                    </div>
                    <div className="keyboard-shortcut-command-controls">
                      {isRecording ? (
                        <button
                          type="button"
                          className="keyboard-shortcut-recorder"
                          aria-label={`Recording shortcut for ${command.name}`}
                          autoFocus
                          onKeyDown={event => recordKeyDown(command.id, event)}
                        >
                          <span className="keyboard-shortcut-recorder-label">Press keys</span>
                          <span className="keyboard-shortcut-recorder-keys">
                            {recordingKeys.length > 0 ? <Keycaps keys={recordingKeys} /> : 'Waiting…'}
                          </span>
                          <span className="keyboard-shortcut-recorder-cancel">Esc to cancel</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="keyboard-shortcut-binding keyboard-shortcut-record-button"
                          aria-label={`Record ${command.name} shortcut`}
                          onClick={() => startRecording(command.id)}
                        >
                          {binding ? <Keycaps keys={formatShortcutBinding(binding, platform)} /> : 'Unassigned'}
                        </button>
                      )}
                      <div className="keyboard-shortcut-row-actions">
                        {binding ? (
                          <button
                            type="button"
                            aria-label={`Clear ${command.name} shortcut`}
                            onClick={() => {
                              onChange(clearShortcutBinding(overrides, command.id));
                              setFeedback({kind: 'info', message: `${command.name} cleared.`});
                            }}
                          >
                            Clear
                          </button>
                        ) : null}
                        {isCustomized ? (
                          <button
                            type="button"
                            aria-label={`Restore ${command.name} default`}
                            onClick={() => {
                              onChange(restoreShortcutDefault(overrides, command.id));
                              setFeedback({kind: 'info', message: `${command.name} restored.`});
                            }}
                          >
                            Restore
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {pendingConflict?.actionId === command.id ? (
                      <div className="keyboard-shortcut-conflict">
                        <span>{`Already assigned to ${commandName(pendingConflict.conflictActionId)}.`}</span>
                        <button
                          type="button"
                          aria-label={`Replace ${commandName(pendingConflict.conflictActionId)} binding`}
                          onClick={confirmConflictReplacement}
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingConflict(null);
                            setRecordingKeys([]);
                            setFeedback({kind: 'info', message: 'Shortcut replacement cancelled.'});
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {feedback ? (
        <div className={`keyboard-shortcut-feedback is-${feedback.kind}`}>{feedback.message}</div>
      ) : null}
      <div className="keyboard-shortcuts-live-region" role="status" aria-live="polite" aria-atomic="true">
        {feedback?.message ?? ''}
      </div>
    </div>
  );
}
