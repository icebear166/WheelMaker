import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  groupSkillsByCategory,
  isSkillActionPendingForHub,
  skillDetailCacheKey,
  skillOperationStatusLabel,
  skillScopeLabel,
  sortSkillProjects,
} from './skillManagementView';
import type {
  RegistrySkillCommandResponse,
  RegistrySkillDetail,
  RegistrySkillScope,
  RegistrySkillSnapshot,
  RegistrySkillSourceCandidate,
  RegistrySkillSupportingFile,
} from '../registry/registryTypes';

const SKILLS_MARKETPLACE_URL = 'https://www.skills.sh/';
const SKILL_MARKDOWN_REMARK_PLUGINS = [remarkGfm];

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

type SkillBatchUninstallTarget = SkillInstallTarget & {
  skillNames: string[];
};

type SkillDetailTarget = SkillInstallTarget & {
  skillName: string;
};

type SkillDetailCacheEntry = {
  loading: boolean;
  error: string;
  detail: RegistrySkillDetail | null;
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
  requestSkillBatchUninstall: (target: SkillBatchUninstallTarget) => void;
  requestSkillDetail: (target: SkillDetailTarget) => Promise<void>;
  closeSkillDetail: () => void;
  skillDetailTarget: SkillDetailTarget | null;
  skillDetailCache: Record<string, SkillDetailCacheEntry>;
  skillActionPendingKey: (input: SkillPendingKeyInput) => string;
};

function skillScopeSelectionKey(input: {hubId: string; scope: RegistrySkillScope; projectName?: string}): string {
  return [input.hubId, input.scope, input.projectName || ''].join(':');
}

function formatSkillFileSize(size?: number): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

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
  requestSkillBatchUninstall,
  requestSkillDetail,
  closeSkillDetail,
  skillDetailTarget,
  skillDetailCache,
  skillActionPendingKey,
}: SkillsSettingsDetailProps) {
  const skillHubCards = Object.values(skillHubs).sort((left, right) => left.hubId.localeCompare(right.hubId));
  const skillHubIds = skillHubCards.map(hub => hub.hubId);
  const skillHubIdsKey = skillHubIds.join('\n');
  const [activeSkillHubId, setActiveSkillHubId] = React.useState(skillHubIds[0] ?? '');
  const [skillHubMenuOpen, setSkillHubMenuOpen] = React.useState(false);
  const [selectedSkillKeysByScope, setSelectedSkillKeysByScope] = React.useState<Record<string, string[]>>({});
  const activeSkillHub = skillHubCards.find(hub => hub.hubId === activeSkillHubId) ?? skillHubCards[0] ?? null;
  const selectedSkillHubId = activeSkillHub?.hubId ?? '';
  const skillsScanning = skillsLoading || skillHubCards.some(hub => hub.loading === true);
  const scanningHubCount = skillHubCards.filter(hub => hub.loading === true).length;
  const skillsScanStatusLabel = scanningHubCount > 0
    ? `Scanning skills on ${scanningHubCount} ${scanningHubCount === 1 ? 'hub' : 'hubs'}...`
    : 'Scanning skills...';

  React.useEffect(() => {
    if (skillHubIds.length === 0) {
      if (activeSkillHubId) {
        setActiveSkillHubId('');
      }
      setSkillHubMenuOpen(false);
      return;
    }
    if (!skillHubIds.includes(activeSkillHubId)) {
      setActiveSkillHubId(skillHubIds[0]);
      setSkillHubMenuOpen(false);
    }
  }, [activeSkillHubId, skillHubIdsKey]);

  const toggleScopeSkillSelection = React.useCallback((scopeKey: string, skillName: string) => {
    setSelectedSkillKeysByScope(prev => {
      const current = prev[scopeKey] ?? [];
      const nextNames = current.includes(skillName)
        ? current.filter(name => name !== skillName)
        : [...current, skillName];
      return {...prev, [scopeKey]: nextNames};
    });
  }, []);

  const setScopeSkillSelection = React.useCallback((scopeKey: string, skillNames: string[]) => {
    setSelectedSkillKeysByScope(prev => ({...prev, [scopeKey]: skillNames}));
  }, []);

  const openSkillDetailFromRow = React.useCallback((target: SkillDetailTarget) => {
    requestSkillDetail(target).catch(() => undefined);
  }, [requestSkillDetail]);

  const skillHubSummary = (hub: SkillHubView) => {
    const data = hub.data;
    const projects = sortSkillProjects(data?.projects ?? []);
    const hubSkillCount = data?.hubSkills?.skills.length ?? 0;
    const projectSkillCount = projects.reduce((total, project) => total + project.skills.length, 0);
    return {
      hubSkillCount,
      projectCount: projects.length,
      projectSkillCount,
      operation: data?.operation ?? null,
    };
  };

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
    const scopeKey = skillScopeSelectionKey({hubId, scope: options.scope, projectName: options.projectName});
    const selectedSkillKeys = selectedSkillKeysByScope[scopeKey] ?? [];
    const selectedSkillNames = new Set(selectedSkillKeys);
    const managedSkillNames = skills
      .filter(skill => skill.managed !== false)
      .map(skill => skill.name);
    const selectedManagedNames = selectedSkillKeys.filter(name => managedSkillNames.includes(name));
    const allManagedSelected = managedSkillNames.length > 0 && managedSkillNames.every(name => selectedSkillNames.has(name));
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
          {managedSkillNames.length > 0 ? (
            <div className="settings-skills-bulk-bar">
              <label className="settings-skills-bulk-select">
                <input
                  type="checkbox"
                  checked={allManagedSelected}
                  disabled={actionDisabled}
                  onChange={() => setScopeSkillSelection(scopeKey, allManagedSelected ? [] : managedSkillNames)}
                />
                <span>{selectedManagedNames.length} selected</span>
              </label>
              <div className="settings-skills-bulk-actions">
                <button
                  type="button"
                  className="settings-detail-action-btn"
                  disabled={selectedManagedNames.length === 0}
                  onClick={() => setScopeSkillSelection(scopeKey, [])}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="settings-detail-action-btn danger"
                  disabled={selectedManagedNames.length === 0 || actionDisabled}
                  onClick={() => requestSkillBatchUninstall({
                    hubId,
                    scope: options.scope,
                    projectName: options.projectName,
                    skillNames: selectedManagedNames,
                  })}
                >
                  Uninstall
                </button>
              </div>
            </div>
          ) : null}
          {groups.length === 0 && options.loading ? (
            <div className="settings-skills-empty settings-skills-empty-loading">
              <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
              <span>Scanning skills...</span>
            </div>
          ) : null}
          {groups.length === 0 && !options.error && !options.loading ? (
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
                const selectable = managed && !actionDisabled;
                const selected = selectedSkillNames.has(skill.name);
                const detailActive = skillDetailTarget?.hubId === hubId &&
                  skillDetailTarget.scope === options.scope &&
                  (skillDetailTarget.projectName || '') === (options.projectName || '') &&
                  skillDetailTarget.skillName === skill.name;
                const pendingKey = skillActionPendingKey({
                  hubId,
                  scope: options.scope,
                  projectName: options.projectName,
                  skillName: skill.name,
                  action: 'skillUninstall',
                });
                const pending = skillsPendingKey === pendingKey;
                return (
                  <div key={`${hubId}:${title}:${skill.name}`} className={`settings-skill-row${detailActive ? ' active' : ''}`}>
                    {managed ? (
                      <input
                        className="settings-skill-row-checkbox"
                        type="checkbox"
                        checked={selected}
                        disabled={!selectable}
                        onChange={() => toggleScopeSkillSelection(scopeKey, skill.name)}
                        aria-label={`Select ${skill.name}`}
                      />
                    ) : (
                      <span className="settings-skill-row-checkbox-spacer" aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      className="settings-skill-row-main settings-skill-row-open"
                      onClick={() => openSkillDetailFromRow({
                        hubId,
                        scope: options.scope,
                        projectName: options.projectName,
                        skillName: skill.name,
                      })}
                    >
                      <span className="settings-skill-name" title={skill.path || skill.name}>{skill.name}</span>
                      {managed ? null : <span className="settings-skill-readonly-tag">External</span>}
                    </button>
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

  const renderSkillDetailMetaRow = (label: string, value?: string) => {
    if (!value) {
      return null;
    }
    return (
      <div className="settings-skills-detail-meta-row">
        <span>{label}</span>
        <span title={value}>{value}</span>
      </div>
    );
  };

  const renderSupportingFile = (file: RegistrySkillSupportingFile) => (
    <div key={file.relativePath} className="settings-skills-detail-file">
      <span className={`codicon ${file.directory ? 'codicon-folder' : 'codicon-file'}`} aria-hidden="true" />
      <span title={file.relativePath}>{file.relativePath}</span>
      <span>{file.directory ? 'Folder' : formatSkillFileSize(file.size)}</span>
    </div>
  );

  const renderSkillDetailPanel = () => {
    if (!skillDetailTarget) {
      return null;
    }
    const activeSkillDetailKey = skillDetailCacheKey(skillDetailTarget);
    const activeSkillDetailEntry = skillDetailCache[activeSkillDetailKey];
    const detail = activeSkillDetailEntry?.detail ?? null;
    const loading = activeSkillDetailEntry?.loading === true;
    const error = activeSkillDetailEntry?.error ?? '';
    const pendingKey = skillActionPendingKey({
      hubId: skillDetailTarget.hubId,
      scope: skillDetailTarget.scope,
      projectName: skillDetailTarget.projectName,
      skillName: skillDetailTarget.skillName,
      action: 'skillUninstall',
    });
    const pending = skillsPendingKey === pendingKey;
    const hubActionPending = isSkillActionPendingForHub(skillsPendingKey, skillDetailTarget.hubId);
    const managed = detail?.managed !== false;
    const supportingFiles = [...(detail?.supportingFiles ?? [])]
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

    return (
      <aside className="settings-skills-detail-panel" aria-label="Skill detail">
        <div className="settings-skills-detail-header">
          <div className="settings-skills-detail-title-wrap">
            <span className="settings-skills-scope-kind">Skill</span>
            <h2 className="settings-skills-detail-title">{skillDetailTarget.skillName}</h2>
            <span className="settings-skills-detail-scope">{skillScopeLabel(skillDetailTarget)}</span>
          </div>
          <button
            type="button"
            className="settings-skill-icon-btn"
            onClick={closeSkillDetail}
            title="Close"
            aria-label="Close"
          >
            <span className="codicon codicon-close" />
          </button>
        </div>
        {loading ? (
          <div className="settings-skills-detail-status" role="status">
            <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
            <span>Loading skill detail...</span>
          </div>
        ) : null}
        {error ? <div className="settings-metadata-error">{error}</div> : null}
        {detail ? (
          <div className="settings-skills-detail-body">
            <section className="settings-skills-detail-section">
              <div className="settings-skills-detail-section-title">Install</div>
              <div className="settings-skills-detail-meta">
                {renderSkillDetailMetaRow('Source', detail.source)}
                {renderSkillDetailMetaRow('Source URL', detail.sourceUrl)}
                {renderSkillDetailMetaRow('Source type', detail.sourceType)}
                {renderSkillDetailMetaRow('Ref', detail.ref)}
                {renderSkillDetailMetaRow('Skill path', detail.skillPath)}
                {renderSkillDetailMetaRow('Plugin', detail.pluginName)}
                {renderSkillDetailMetaRow('Installed', detail.installedAt)}
                {renderSkillDetailMetaRow('Updated', detail.updatedAt)}
                {renderSkillDetailMetaRow('Local path', detail.path)}
                {detail.agents?.length ? renderSkillDetailMetaRow('Agents', detail.agents.join(', ')) : null}
                <div className="settings-skills-detail-meta-row">
                  <span>Status</span>
                  <span>{managed ? 'Managed' : 'External'}</span>
                </div>
              </div>
              {managed ? (
                <button
                  type="button"
                  className="settings-detail-action-btn danger"
                  disabled={hubActionPending}
                  onClick={() => requestSkillUninstall({
                    hubId: skillDetailTarget.hubId,
                    scope: skillDetailTarget.scope,
                    projectName: skillDetailTarget.projectName,
                    skillName: skillDetailTarget.skillName,
                  })}
                >
                  {pending ? 'Removing...' : 'Uninstall'}
                </button>
              ) : null}
            </section>
            <section className="settings-skills-detail-section">
              <div className="settings-skills-detail-section-title">Skill.md</div>
              <div className="settings-skills-detail-markdown markdown-preview">
                <ReactMarkdown remarkPlugins={SKILL_MARKDOWN_REMARK_PLUGINS}>
                  {detail.skillMarkdown}
                </ReactMarkdown>
              </div>
            </section>
            <section className="settings-skills-detail-section">
              <div className="settings-skills-detail-section-title">Supporting files</div>
              {supportingFiles.length > 0 ? (
                <div className="settings-skills-detail-files">
                  {supportingFiles.map(renderSupportingFile)}
                </div>
              ) : (
                <div className="settings-skills-empty">No supporting files.</div>
              )}
            </section>
          </div>
        ) : !loading && !error ? (
          <div className="settings-skills-empty">No detail loaded.</div>
        ) : null}
      </aside>
    );
  };

  const renderSkillHubPicker = () => {
    if (!activeSkillHub) {
      return null;
    }
    const activeSummary = skillHubSummary(activeSkillHub);
    return (
      <div
        className="settings-skills-hub-picker"
        onBlur={event => {
          const nextFocus = event.relatedTarget as Node | null;
          if (!nextFocus || !event.currentTarget.contains(nextFocus)) {
            setSkillHubMenuOpen(false);
          }
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            setSkillHubMenuOpen(false);
          }
        }}
      >
        <button
          type="button"
          className="settings-skills-hub-picker-button"
          onClick={() => setSkillHubMenuOpen(!skillHubMenuOpen)}
          aria-haspopup="listbox"
          aria-expanded={skillHubMenuOpen}
          title={selectedSkillHubId}
        >
          <span className="settings-skills-hub-picker-main">
            <span className="settings-skills-hub-picker-label">Hub</span>
            <span className="settings-skills-hub-picker-title">{selectedSkillHubId}</span>
            <span className="settings-skills-hub-picker-meta">
              {activeSummary.hubSkillCount} skills / {activeSummary.projectCount} projects / {activeSummary.projectSkillCount} project skills
            </span>
          </span>
          <span className="settings-skills-hub-picker-state">
            {activeSkillHub.loading ? (
              <span className="codicon codicon-loading codicon-modifier-spin" aria-label="Scanning" />
            ) : activeSkillHub.error ? (
              <span className="codicon codicon-error" aria-label="Error" />
            ) : activeSummary.operation?.running ? (
              <span className="codicon codicon-sync codicon-modifier-spin" aria-label="Running" />
            ) : (
              <span className="codicon codicon-circle-filled" aria-hidden="true" />
            )}
          </span>
          <span className={`codicon ${skillHubMenuOpen ? 'codicon-chevron-up' : 'codicon-chevron-down'}`} aria-hidden="true" />
        </button>
        {skillHubMenuOpen ? (
          <div className="settings-skills-hub-menu" role="listbox" aria-label="Skill hubs">
            {skillHubCards.map(hub => {
              const summary = skillHubSummary(hub);
              const selected = hub.hubId === selectedSkillHubId;
              return (
                <button
                  key={`skills-hub-option:${hub.hubId}`}
                  type="button"
                  className={`settings-skills-hub-option${hub.hubId === selectedSkillHubId ? ' active' : ''}`}
                  role="option"
                  aria-selected={selected}
                  title={hub.hubId}
                  onClick={() => {
                    setActiveSkillHubId(hub.hubId);
                    setSkillHubMenuOpen(false);
                  }}
                >
                  <span className="settings-skills-hub-option-main">
                    <span className="settings-skills-hub-option-title">{hub.hubId}</span>
                    <span className="settings-skills-hub-option-meta">
                      {summary.hubSkillCount} skills / {summary.projectCount} projects / {summary.projectSkillCount} project skills
                    </span>
                  </span>
                  <span className="settings-skills-hub-option-state">
                    {hub.loading ? (
                      <span className="codicon codicon-loading codicon-modifier-spin" aria-label="Scanning" />
                    ) : hub.error ? (
                      <span className="codicon codicon-error" aria-label="Error" />
                    ) : summary.operation?.running ? (
                      <span className="codicon codicon-sync codicon-modifier-spin" aria-label="Running" />
                    ) : selected ? (
                      <span className="codicon codicon-check" aria-hidden="true" />
                    ) : (
                      <span className="codicon codicon-circle-filled" aria-hidden="true" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="settings-skills-page">
      <div className="settings-skills-fixed-controls">
        {renderSkillHubPicker()}
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
      </div>
      <div className="settings-skills-list">
        {skillsScanning ? (
          <div className="settings-skills-scan-status" role="status" aria-live="polite">
            <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
            <span>{skillsScanStatusLabel}</span>
          </div>
        ) : null}
        {skillsError ? (
          <div className="muted block settings-metadata-error">{skillsError}</div>
        ) : null}
        {!skillsScanning && skillHubCards.length === 0 && !skillsError ? (
          <div className="muted block">No hubs available.</div>
        ) : null}
        {activeSkillHub ? (() => {
          const data = activeSkillHub.data;
          const operation = data?.operation ?? null;
          const operationRunning = operation?.running === true;
          const projects = sortSkillProjects(data?.projects ?? []);
          const hubSkillCount = data?.hubSkills?.skills.length ?? 0;
          const projectSkillCount = projects.reduce((total, project) => total + project.skills.length, 0);
          return (
            <section className="settings-skills-hub" key={`skills-hub:${activeSkillHub.hubId}`}>
              {activeSkillHub.error ? (
                <div className="settings-metadata-error">{activeSkillHub.error}</div>
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
                {renderSkillScopeRows(activeSkillHub.hubId, activeSkillHub.hubId, data?.hubSkills?.skills ?? [], {
                  scope: 'hub',
                  operationRunning,
                  actionsDisabled: activeSkillHub.loading,
                  loading: activeSkillHub.loading,
                  allowUpdate: true,
                  updateIncludeProjects: true,
                  updateLabel: 'Update hub and project skills',
                  summary: `${hubSkillCount} hub skills / ${projects.length} projects / ${projectSkillCount} project skills`,
                })}
                {projects.map(project => (
                  <div className="settings-skills-project" key={`${activeSkillHub.hubId}:${project.projectName}`}>
                    {renderSkillScopeRows(activeSkillHub.hubId, project.projectName, project.skills, {
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
        })() : null}
        {renderSkillDetailPanel()}
      </div>
    </div>
  );
}
