import React from 'react';

import {
  groupSkillsByCategory,
  isSkillActionPendingForHub,
  skillOperationStatusLabel,
  skillScopeLabel,
  sortSkillProjects,
} from './skills/skillManagementView';
import type {
  RegistrySkillCommandResponse,
  RegistrySkillScope,
  RegistrySkillSnapshot,
  RegistrySkillSourceCandidate,
} from '../types/registry';

const SKILLS_MARKETPLACE_URL = 'https://www.skills.sh/';

type SkillInstallTarget = {
  hubId: string;
  scope: RegistrySkillScope;
  projectName?: string;
};

type SkillHubView = {
  hubId: string;
  loading: boolean;
  error: string;
  data: RegistrySkillCommandResponse | null;
};

type SkillUninstallTarget = SkillInstallTarget & {
  skillName: string;
};

type SkillUpdateTarget = SkillInstallTarget & {
  includeProjects?: boolean;
};

type SkillPendingKeyInput = {
  hubId: string;
  scope: RegistrySkillScope;
  projectName?: string;
  skillName?: string;
  action: string;
};

type SkillsSettingsDetailProps = {
  skillHubs: Record<string, SkillHubView>;
  skillsLoading: boolean;
  skillsError: string;
  skillsPendingKey: string;
  skillInstallTarget: SkillInstallTarget | null;
  sameSkillInstallTarget: (left: SkillInstallTarget | null, right: SkillInstallTarget) => boolean;
  skillSourceInput: string;
  setSkillSourceInput: (value: string) => void;
  skillSourceLoading: boolean;
  skillSourceError: string;
  skillSourceCandidates: RegistrySkillSourceCandidate[];
  skillSourceSelectedNames: string[];
  closeSkillInstallPanel: () => void;
  listSkillSource: () => Promise<void>;
  toggleAllSkillSourceCandidates: () => void;
  toggleSkillSourceCandidate: (name: string) => void;
  requestSkillInstallConfirm: () => void;
  requestSkillInstall: (target: SkillInstallTarget) => void;
  requestSkillUpdate: (target: SkillUpdateTarget) => void;
  requestSkillUninstall: (target: SkillUninstallTarget) => void;
  skillActionPendingKey: (input: SkillPendingKeyInput) => string;
};

function renderSkillIconButton(options: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      className={`settings-skill-icon-btn${options.danger ? ' danger' : ''}`}
      disabled={options.disabled}
      onClick={options.onClick}
      title={options.label}
      aria-label={options.label}
    >
      <span className={`codicon ${options.pending ? 'codicon-loading codicon-modifier-spin' : options.icon}`} />
    </button>
  );
}

export function SkillsSettingsDetail({
  skillHubs,
  skillsLoading,
  skillsError,
  skillsPendingKey,
  skillInstallTarget,
  sameSkillInstallTarget,
  skillSourceInput,
  setSkillSourceInput,
  skillSourceLoading,
  skillSourceError,
  skillSourceCandidates,
  skillSourceSelectedNames,
  closeSkillInstallPanel,
  listSkillSource,
  toggleAllSkillSourceCandidates,
  toggleSkillSourceCandidate,
  requestSkillInstallConfirm,
  requestSkillInstall,
  requestSkillUpdate,
  requestSkillUninstall,
  skillActionPendingKey,
}: SkillsSettingsDetailProps) {
  const renderSkillInstallPanel = (target: SkillInstallTarget) => {
    const activeInstallTarget = skillInstallTarget;
    if (!activeInstallTarget || !sameSkillInstallTarget(activeInstallTarget, target)) {
      return null;
    }
    const selected = new Set(skillSourceSelectedNames);
    const candidateNames = Array.from(new Set(skillSourceCandidates
      .map(candidate => candidate.name)
      .filter(Boolean)));
    const allCandidatesSelected = candidateNames.length > 0 && candidateNames.every(name => selected.has(name));
    return (
      <section className="settings-skills-install-panel">
        <div className="settings-skills-scope-header">
          <div className="settings-skills-scope-title">{skillScopeLabel(activeInstallTarget)}</div>
          <button
            type="button"
            className="settings-detail-action-btn"
            onClick={closeSkillInstallPanel}
          >
            Close
          </button>
        </div>
        <div className="settings-skills-source-row">
          <input
            className="settings-skills-source-input"
            value={skillSourceInput}
            onChange={event => setSkillSourceInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                listSkillSource().catch(() => undefined);
              }
            }}
            placeholder="owner/repo or npx skills add ... --skill name"
          />
          <button
            type="button"
            className="settings-detail-action-btn"
            disabled={skillSourceLoading}
            onClick={() => listSkillSource().catch(() => undefined)}
          >
            {skillSourceLoading ? 'Listing...' : 'List'}
          </button>
        </div>
        {skillSourceError ? (
          <div className="settings-metadata-error">{skillSourceError}</div>
        ) : null}
        {candidateNames.length > 0 ? (
          <div className="settings-skills-candidates">
            <label className="settings-skill-row settings-skill-candidate-row settings-skill-select-all-row">
              <input
                type="checkbox"
                checked={allCandidatesSelected}
                onChange={toggleAllSkillSourceCandidates}
              />
              <span className="settings-skill-row-main">
                <span className="settings-skill-name">Select all</span>
              </span>
            </label>
            {candidateNames.map(skillName => (
              <label key={`candidate:${skillName}`} className="settings-skill-row settings-skill-candidate-row">
                <input
                  type="checkbox"
                  checked={selected.has(skillName)}
                  onChange={() => toggleSkillSourceCandidate(skillName)}
                />
                <span className="settings-skill-row-main">
                  <span className="settings-skill-name">{skillName}</span>
                </span>
              </label>
            ))}
          </div>
        ) : null}
        <div className="settings-skills-install-actions">
          <span className="settings-skill-meta">Selected: {skillSourceSelectedNames.length}</span>
          <button
            type="button"
            className="settings-detail-action-btn"
            disabled={skillSourceSelectedNames.length === 0}
            onClick={requestSkillInstallConfirm}
          >
            Install
          </button>
        </div>
      </section>
    );
  };

  const renderSkillScopeRows = (
    hubId: string,
    title: string,
    skills: RegistrySkillSnapshot[],
    options: {
      scope: RegistrySkillScope;
      projectName?: string;
      disabled?: boolean;
      error?: string;
      allowUpdate?: boolean;
      operationRunning?: boolean;
      actionsDisabled?: boolean;
      loading?: boolean;
      summary?: string;
      updateIncludeProjects?: boolean;
      updateLabel?: string;
    },
  ) => {
    const groups = groupSkillsByCategory(skills);
    const disabled = options.disabled === true;
    const hubActionPending = isSkillActionPendingForHub(skillsPendingKey, hubId);
    const actionDisabled = disabled || options.actionsDisabled === true || options.operationRunning === true || hubActionPending;
    const skillCount = skills.length;
    const scopeKind = options.scope === 'hub' ? 'Hub' : 'Project';
    return (
      <section className={`settings-skills-scope settings-skills-scope-${options.scope}`}>
        <div className="settings-skills-scope-header">
          <div className="settings-skills-scope-heading">
            <div className="settings-skills-scope-title-wrap">
              <span className="settings-skills-scope-kind">{scopeKind}</span>
              <span className="settings-skills-scope-title" title={title}>{title}</span>
              {options.summary ? null : <span className="settings-skills-count">{skillCount}</span>}
              {disabled ? <span className="agent-package-status status-not_published">Offline</span> : null}
              {options.loading ? <span className="wide-session-agent-tag">Scanning</span> : null}
            </div>
            {options.summary ? <span className="settings-skills-scope-summary">{options.summary}</span> : null}
          </div>
          <div className="settings-skills-scope-actions">
            {options.allowUpdate ? renderSkillIconButton({
              label: options.updateLabel || 'Update skills',
              icon: 'codicon-sync',
              pending: options.updateIncludeProjects ? options.operationRunning : false,
              disabled: actionDisabled,
              onClick: () => requestSkillUpdate(options.updateIncludeProjects
                ? {hubId, scope: options.scope, projectName: options.projectName, includeProjects: true}
                : {hubId, scope: options.scope, projectName: options.projectName}),
            }) : null}
            {renderSkillIconButton({
              label: 'Add skills',
              icon: 'codicon-add',
              disabled: actionDisabled,
              onClick: () => requestSkillInstall({hubId, scope: options.scope, projectName: options.projectName}),
            })}
          </div>
        </div>
        {options.error ? (
          <div className="settings-metadata-error">{options.error}</div>
        ) : null}
        {renderSkillInstallPanel({hubId, scope: options.scope, projectName: options.projectName})}
        <div className="settings-skills-scope-body">
          {groups.length === 0 && !options.error ? (
            <div className="settings-skills-empty">No skills installed.</div>
          ) : null}
          {groups.map(group => (
            <div key={`${hubId}:${title}:${group.categoryKey}`} className="settings-skill-category-block">
              <div className="settings-skill-category">
                <span>{group.category}</span>
                <span>{group.skills.length}</span>
              </div>
              {group.skills.map(skill => {
                const managed = skill.managed !== false;
                const pendingKey = skillActionPendingKey({
                  hubId,
                  scope: options.scope,
                  projectName: options.projectName,
                  skillName: skill.name,
                  action: 'skillUninstall',
                });
                const pending = skillsPendingKey === pendingKey;
                return (
                  <div key={`${hubId}:${title}:${skill.name}`} className="settings-skill-row">
                    <div className="settings-skill-row-main">
                      <span className="settings-skill-name" title={skill.path || skill.name}>{skill.name}</span>
                      {managed ? null : <span className="settings-skill-readonly-tag">External</span>}
                    </div>
                    {managed ? renderSkillIconButton({
                      label: pending ? 'Removing skill' : 'Uninstall skill',
                      icon: 'codicon-trash',
                      danger: true,
                      pending,
                      disabled: actionDisabled,
                      onClick: () => requestSkillUninstall({
                        hubId,
                        scope: options.scope,
                        projectName: options.projectName,
                        skillName: skill.name,
                      }),
                    }) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    );
  };

  return (
    <>
      <a
        className="settings-skills-marketplace-link"
        href={SKILLS_MARKETPLACE_URL}
        target="_blank"
        rel="noreferrer"
      >
        <span className="settings-skills-marketplace-main">
          <span className="settings-skills-marketplace-label">Marketplace</span>
          <span className="settings-skills-marketplace-url">{SKILLS_MARKETPLACE_URL}</span>
        </span>
        <span className="codicon codicon-link-external" aria-hidden="true" />
      </a>
      {skillsLoading && Object.keys(skillHubs).length === 0 ? (
        <div className="muted block">Loading skills...</div>
      ) : null}
      {skillsError ? (
        <div className="muted block settings-metadata-error">{skillsError}</div>
      ) : null}
      {!skillsLoading && Object.keys(skillHubs).length === 0 && !skillsError ? (
        <div className="muted block">No hubs available.</div>
      ) : null}
      <div className="settings-skills-list">
        {Object.values(skillHubs).sort((left, right) => left.hubId.localeCompare(right.hubId)).map(hub => {
          const data = hub.data;
          const operation = data?.operation ?? null;
          const operationRunning = operation?.running === true;
          const projects = sortSkillProjects(data?.projects ?? []);
          const hubSkillCount = data?.hubSkills?.skills.length ?? 0;
          const projectSkillCount = projects.reduce((total, project) => total + project.skills.length, 0);
          return (
            <section className="settings-skills-hub" key={`skills-hub:${hub.hubId}`}>
              {hub.error ? (
                <div className="settings-metadata-error">{hub.error}</div>
              ) : null}
              {operation ? (
                <div className={`agent-package-task ${operation.status === 'failed' ? 'failed' : ''}`}>
                  <span>{skillOperationStatusLabel(operation.status)}</span>
                  <span>{operation.action}</span>
                  {operation.includeProjects ? <span>Hub + projects</span> : null}
                  {operation.message ? <span>{operation.message}</span> : null}
                  {operation.errorSummary ? <span>{operation.errorSummary}</span> : null}
                </div>
              ) : null}
              <div className="settings-skills-scope-grid">
                {renderSkillScopeRows(hub.hubId, hub.hubId, data?.hubSkills?.skills ?? [], {
                  scope: 'hub',
                  operationRunning,
                  actionsDisabled: hub.loading,
                  loading: hub.loading,
                  allowUpdate: true,
                  updateIncludeProjects: true,
                  updateLabel: 'Update hub and project skills',
                  summary: `${hubSkillCount} hub skills / ${projects.length} projects / ${projectSkillCount} project skills`,
                })}
                {projects.map(project => (
                  <div className="settings-skills-project" key={`${hub.hubId}:${project.projectName}`}>
                    {renderSkillScopeRows(hub.hubId, project.projectName, project.skills, {
                      scope: 'project',
                      projectName: project.projectName,
                      disabled: !project.online,
                      error: project.error,
                      allowUpdate: true,
                      operationRunning,
                    })}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
