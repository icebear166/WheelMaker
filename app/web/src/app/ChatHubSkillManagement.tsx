import React, {useEffect, useMemo, useState} from 'react';

import {Icon} from '../common/Icon';
import type {RegistrySkillSnapshot} from '../registry/registryTypes';
import {
  isSkillActionPendingForHub,
  skillActionPendingKey,
  skillScopeSelectionKey,
  type SkillBatchUninstallTarget,
  type SkillDetailTarget,
  type SkillInstallTarget,
  type SkillScopeTarget,
  type SkillUninstallTarget,
  type SkillUpdateTarget,
} from '../settings/skillManagementView';

export interface ChatHubSkillActions {
  onAdd: (target: SkillInstallTarget) => void;
  onDetail: (target: SkillDetailTarget) => void;
  onUpdate: (target: SkillUpdateTarget) => void;
  onUninstall: (target: SkillUninstallTarget) => void;
  onBatchUninstall: (target: SkillBatchUninstallTarget) => void;
  onRetry: (hubId: string) => void;
}

interface ChatHubSkillScopeDetailProps {
  target: SkillScopeTarget;
  label: string;
  skills: RegistrySkillSnapshot[];
  loading: boolean;
  error: string;
  operationRunning: boolean;
  pendingKey: string;
  actions: ChatHubSkillActions;
}

function actionPending(
  pendingKey: string,
  input: SkillScopeTarget & {skillName?: string; action: string},
): boolean {
  return pendingKey === skillActionPendingKey(input);
}

export function ChatHubSkillScopeDetail({
  target,
  label,
  skills,
  loading,
  error,
  operationRunning,
  pendingKey,
  actions,
}: ChatHubSkillScopeDetailProps) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const selectionKey = skillScopeSelectionKey(target);
  const sortedSkills = useMemo(
    () => [...skills].sort((left, right) => left.name.localeCompare(right.name)),
    [skills],
  );
  const managedSkills = sortedSkills.filter(skill => skill.managed);
  const scopeLabel = target.scope === 'hub' ? 'Hub' : 'Project';
  const hubBusy = operationRunning || isSkillActionPendingForHub(pendingKey, target.hubId);
  const updateAllPending = actionPending(pendingKey, {
    ...target,
    action: 'skillUpdate',
  });

  useEffect(() => {
    setSelectionMode(false);
    setSelectedNames([]);
  }, [selectionKey]);

  const leaveSelectionMode = () => {
    setSelectionMode(false);
    setSelectedNames([]);
  };

  const toggleSelection = (skillName: string) => {
    setSelectedNames(current => (
      current.includes(skillName)
        ? current.filter(name => name !== skillName)
        : [...current, skillName]
    ));
  };

  const uninstallSelected = () => {
    if (selectedNames.length === 0) return;
    actions.onBatchUninstall({...target, skillNames: selectedNames});
    leaveSelectionMode();
  };

  return (
    <section className="chat-hub-skill-scope" data-skill-scope={target.scope}>
      <div className="chat-hub-skill-toolbar">
        <strong className="chat-hub-skill-toolbar-label">
          {selectionMode ? `${selectedNames.length} selected` : label}
        </strong>
        <div className="chat-hub-skill-toolbar-actions">
          {selectionMode ? (
            <>
              <button
                type="button"
                className="chat-hub-skill-toolbar-button"
                onClick={leaveSelectionMode}
              >
                Cancel
              </button>
              <button
                type="button"
                className="chat-hub-skill-toolbar-button is-danger"
                aria-label={`Uninstall selected ${scopeLabel} skills`}
                disabled={selectedNames.length === 0 || hubBusy}
                onClick={uninstallSelected}
              >
                <Icon name="trash" />
                <span>Uninstall</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="chat-hub-skill-icon-button"
                aria-label={`Add ${scopeLabel} skills`}
                disabled={hubBusy}
                onClick={() => actions.onAdd(target)}
              >
                <Icon name="plus" />
              </button>
              <button
                type="button"
                className="chat-hub-skill-icon-button"
                aria-label={`Select ${scopeLabel} skills`}
                disabled={managedSkills.length === 0 || hubBusy}
                onClick={() => setSelectionMode(true)}
              >
                <Icon name="listChecks" />
              </button>
              <button
                type="button"
                className="chat-hub-skill-update-all"
                aria-label={`Update all ${scopeLabel} skills`}
                disabled={managedSkills.length === 0 || hubBusy}
                onClick={() => actions.onUpdate(
                  target.scope === 'hub'
                    ? {...target, includeProjects: false}
                    : target,
                )}
              >
                <Icon name={updateAllPending ? 'loader' : 'refreshCw'} spin={updateAllPending} />
                <span>
                  {managedSkills.length === 0
                    ? 'No managed skills'
                    : updateAllPending
                      ? 'Updating…'
                      : 'Update all'}
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {loading && sortedSkills.length === 0 ? (
        <div className="chat-hub-skill-state">
          <Icon name="loader" spin />
          <span>Loading skills…</span>
        </div>
      ) : null}

      {!loading && error && sortedSkills.length === 0 ? (
        <div className="chat-hub-skill-state is-error">
          <span>{error}</span>
          <button type="button" onClick={() => actions.onRetry(target.hubId)}>Retry</button>
        </div>
      ) : null}

      {!loading && !error && sortedSkills.length === 0 ? (
        <div className="chat-hub-skill-state">No skills installed.</div>
      ) : null}

      {sortedSkills.length > 0 ? (
        <div className="chat-hub-skill-list">
          {sortedSkills.map(skill => {
            const managed = Boolean(skill.managed);
            const selected = selectedNames.includes(skill.name);
            const detailPending = actionPending(pendingKey, {
              ...target,
              skillName: skill.name,
              action: 'skillDetail',
            });
            const updatePending = actionPending(pendingKey, {
              ...target,
              skillName: skill.name,
              action: 'skillUpdate',
            });
            const uninstallPending = actionPending(pendingKey, {
              ...target,
              skillName: skill.name,
              action: 'skillUninstall',
            });

            return (
              <div
                key={skill.name}
                className="chat-hub-skill-row"
                data-skill-name={skill.name}
              >
                <span className="chat-hub-skill-checkbox-slot">
                  {managed ? (
                    <input
                      type="checkbox"
                      aria-label={`Select ${skill.name}`}
                      checked={selected}
                      tabIndex={selectionMode ? 0 : -1}
                      className={selectionMode ? '' : 'is-hidden'}
                      onChange={() => toggleSelection(skill.name)}
                    />
                  ) : null}
                </span>
                <span className="chat-hub-skill-name">{skill.name}</span>
                {!managed ? (
                  <span className="chat-hub-skill-external" title="External skill">
                    <Icon name="link" />
                  </span>
                ) : (
                  <span className="chat-hub-skill-external" aria-hidden="true" />
                )}
                <span
                  className={`chat-hub-skill-row-actions${selectionMode ? ' is-selection-mode' : ''}`}
                >
                  <button
                    type="button"
                    aria-label={`View ${skill.name} details`}
                    disabled={loading || detailPending}
                    onClick={() => actions.onDetail({...target, skillName: skill.name})}
                  >
                    <Icon name={detailPending ? 'loader' : 'info'} spin={detailPending} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Update ${skill.name}`}
                    disabled={!managed || hubBusy}
                    onClick={() => actions.onUpdate({...target, skills: [skill.name]})}
                  >
                    <Icon name={updatePending ? 'loader' : 'refreshCw'} spin={updatePending} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Uninstall ${skill.name}`}
                    disabled={!managed || hubBusy}
                    onClick={() => actions.onUninstall({...target, skillName: skill.name})}
                  >
                    <Icon name={uninstallPending ? 'loader' : 'trash'} spin={uninstallPending} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
