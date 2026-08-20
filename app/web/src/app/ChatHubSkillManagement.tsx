import React, {useEffect, useMemo, useState} from 'react';

import {Icon} from '../common/Icon';
import type {
  RegistrySkillCatalogItem,
  RegistrySkillOperation,
  RegistrySkillSourceScopeSnapshot,
  RegistrySkillSourceSnapshot,
} from '../registry/registryTypes';
import {
  isSkillActionPendingForHub,
  readSkillSourceExpanded,
  readSkillShowUninstalled,
  shouldShowSkillCatalogRow,
  skillSourceDisplayName,
  skillSourceExpandedPreferenceKey,
  skillScopeSelectionKey,
  writeSkillSourceExpanded,
  writeSkillShowUninstalled,
  type SkillDetailTarget,
  type SkillScopeTarget,
  type SkillSourceSkillTarget,
  type SkillSourceTarget,
  type SkillUninstallTarget,
} from '../settings/skillManagementView';

export interface ChatHubSkillActions {
  onAddRepo: (target: SkillScopeTarget, source: string) => void;
  onDetail: (target: SkillDetailTarget) => void;
  onUpdateScope: (target: SkillScopeTarget) => void;
  onRefreshSource: (target: SkillSourceTarget) => void;
  onUpdateSource: (target: SkillSourceTarget) => void;
  onInstallAll: (target: SkillSourceTarget) => void;
  onDeleteSource: (target: SkillSourceTarget) => void;
  onInstallSkill: (target: SkillSourceSkillTarget) => void;
  onUninstall: (target: SkillUninstallTarget) => void;
  onRetry: (hubId: string) => void;
}

interface ChatHubSkillScopeDetailProps {
  target: SkillScopeTarget;
  label: string;
  snapshot: RegistrySkillSourceScopeSnapshot;
  loading: boolean;
  error: string;
  operationRunning: boolean;
  operation?: RegistrySkillOperation | null;
  pendingKey: string;
  actions: ChatHubSkillActions;
}

const STATUS_COPY: Record<string, string> = {
  uninstalled: 'Not installed',
  up_to_date: 'Up to date',
  update_available: 'Update available',
  removed_upstream: 'Removed upstream',
  conflict: 'Conflict',
  error: 'Error',
  pending_removal: 'Pending removal',
  unmanaged: 'Unmanaged',
  copies_differ: 'Copies differ',
  needs_refresh: 'Needs refresh',
  needs_clone: 'Needs clone',
  needs_fetch: 'Needs fetch',
};

const EXCEPTIONAL_SKILL_STATUSES = new Set([
  'copies_differ',
  'conflict',
  'error',
  'needs_refresh',
  'pending_removal',
  'removed_upstream',
  'unmanaged',
]);

function skillStatusCopy(status: string): string {
  return STATUS_COPY[status] || status.replaceAll('_', ' ');
}

function sourceTarget(target: SkillScopeTarget, source: RegistrySkillSourceSnapshot): SkillSourceTarget {
  return {
    ...target,
    source: source.source,
    sourceKey: source.sourceKey,
  };
}

function SkillCatalogRow({
  target,
  source,
  skill,
  busy,
  actions,
}: {
  target: SkillScopeTarget;
  source?: RegistrySkillSourceSnapshot;
  skill: RegistrySkillCatalogItem;
  busy: boolean;
  actions: ChatHubSkillActions;
}) {
  const conflicted = skill.conflict || skill.status === 'conflict';
  const removed = skill.status === 'removed_upstream' || skill.status === 'pending_removal';
  const uninstalled = skill.status === 'uninstalled';
  const canOpenDetail = skill.installed && !conflicted;
  const actionTarget = source ? {...sourceTarget(target, source), skillName: skill.name} : null;
  const showStatus = EXCEPTIONAL_SKILL_STATUSES.has(skill.status);
  const className = [
    'chat-hub-skill-row',
    uninstalled ? 'is-uninstalled' : '',
    removed ? 'is-removed' : '',
    conflicted ? 'is-conflict' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={className} data-skill-name={skill.name}>
      <span className="chat-hub-skill-name-cell">
        {canOpenDetail ? (
          <button
            type="button"
            className="chat-hub-skill-name"
            aria-label={`View ${skill.name} details`}
            data-tooltip={skill.name}
            disabled={busy}
            onClick={() => actions.onDetail({...target, skillName: skill.name})}
          >
            {skill.name}
          </button>
        ) : (
          <span className="chat-hub-skill-name" data-tooltip={skill.name}>{skill.name}</span>
        )}
        {showStatus ? (
          <span
            className="chat-hub-skill-status"
            data-tooltip={skill.error || skillStatusCopy(skill.status)}
          >
            {skillStatusCopy(skill.status)}
          </span>
        ) : null}
      </span>
      <span className="chat-hub-skill-row-actions">
        <span className="chat-hub-skill-action-slot chat-hub-skill-primary-action-slot">
          {actionTarget && !conflicted && skill.canInstall ? (
            <button
              type="button"
              aria-label={`Download ${skill.name}`}
              data-tooltip="Download"
              disabled={busy}
              onClick={() => actions.onInstallSkill(actionTarget)}
            >
              <Icon name="cloudDownload" />
            </button>
          ) : null}
        </span>
        <span className="chat-hub-skill-action-slot chat-hub-skill-uninstall-action-slot">
          {skill.canUninstall && !conflicted ? (
            <button
              type="button"
              className="is-danger"
              aria-label={`Uninstall ${skill.name}`}
              data-tooltip="Uninstall"
              disabled={busy}
              onClick={() => actions.onUninstall({...target, skillName: skill.name})}
            >
              <Icon name="trash" />
            </button>
          ) : null}
        </span>
      </span>
    </div>
  );
}

function SkillSourceLedger({
  target,
  source,
  showUninstalled,
  busy,
  actions,
}: {
  target: SkillScopeTarget;
  source: RegistrySkillSourceSnapshot;
  showUninstalled: boolean;
  busy: boolean;
  actions: ChatHubSkillActions;
}) {
  const visibleSkills = useMemo(
    () => [...(source.skills ?? [])]
      .filter(skill => shouldShowSkillCatalogRow(skill, showUninstalled))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [showUninstalled, source.skills],
  );

  const baseTarget = sourceTarget(target, source);
  const sourcePreferenceKey = skillSourceExpandedPreferenceKey(baseTarget);
  const [expanded, setExpanded] = useState(() => readSkillSourceExpanded(baseTarget));
  const sourceHasUpdate = source.status === 'ready' && source.updateAvailable === true;
  const statusCopy = sourceHasUpdate ? STATUS_COPY.update_available : skillStatusCopy(source.status);
  const sourceStatusClass = sourceHasUpdate ? 'update-available' : source.status.replaceAll('_', '-');
  const displayName = skillSourceDisplayName(source.sourceKey);

  useEffect(() => {
    setExpanded(readSkillSourceExpanded(baseTarget));
  }, [sourcePreferenceKey]);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    writeSkillSourceExpanded(baseTarget, next);
  };

  return (
    <section
      className={`chat-hub-skill-source is-${sourceStatusClass}${expanded ? ' is-expanded' : ' is-collapsed'}`}
      data-source-key={source.sourceKey}
    >
      <header className="chat-hub-skill-source-header">
        <button
          type="button"
          className="chat-hub-skill-source-disclosure"
          aria-label={`Toggle ${displayName} skills`}
          aria-expanded={expanded}
          onClick={toggleExpanded}
        >
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} />
          <span
            className={`chat-hub-skill-source-status-dot is-${sourceStatusClass}`}
            aria-label={`${statusCopy} source`}
            data-tooltip={statusCopy}
          />
          <strong data-tooltip={source.source}>{displayName}</strong>
        </button>
        <span className="chat-hub-skill-source-actions">
          <button
            type="button"
            aria-label={`Update ${displayName}`}
            data-tooltip="Update"
            disabled={busy}
            onClick={() => actions.onUpdateSource(baseTarget)}
          >
            <Icon name="circleArrowUp" />
          </button>
          <button
            type="button"
            aria-label={`Install all ${displayName} skills`}
            data-tooltip="Install all"
            disabled={busy}
            onClick={() => actions.onInstallAll(baseTarget)}
          >
            <Icon name="cloudDownload" />
          </button>
          <button
            type="button"
            className="is-danger"
            aria-label={`Delete ${displayName} source`}
            data-tooltip="Delete source"
            disabled={busy}
            onClick={() => actions.onDeleteSource(baseTarget)}
          >
            <Icon name="trash" />
          </button>
        </span>
      </header>
      {source.error ? <div className="chat-hub-skill-source-error">{source.error}</div> : null}
      {expanded ? (
        <div className="chat-hub-skill-list">
          {visibleSkills.map(skill => (
            <SkillCatalogRow
              key={`${source.sourceKey}:${skill.name}`}
              target={target}
              source={source}
              skill={skill}
              busy={busy}
              actions={actions}
            />
          ))}
          {visibleSkills.length === 0 ? (
            <div className="chat-hub-skill-source-empty">
              {showUninstalled ? 'No skills in this source.' : 'No installed skills. Show all to browse this source.'}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function InlineAddRepository({
  target,
  busy,
  actions,
}: {
  target: SkillScopeTarget;
  busy: boolean;
  actions: ChatHubSkillActions;
}) {
  const [expanded, setExpanded] = useState(false);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');

  const collapse = () => {
    setExpanded(false);
    setSource('');
    setError('');
  };

	const add = () => {
		const value = source.trim();
		if (!value) {
			setError('Skill source is required.');
      return;
    }
    actions.onAddRepo(target, value);
    collapse();
  };

  return (
    <section className={`chat-hub-skill-add-repository${expanded ? ' is-expanded' : ''}`}>
      {!expanded ? (
        <button
          type="button"
          className="chat-hub-skill-add-repository-trigger"
          disabled={busy}
          onClick={() => setExpanded(true)}
        >
          <Icon name="plus" />
			<span>Add skill source</span>
        </button>
      ) : (
        <div className="chat-hub-skill-add-repository-form">
          <div className="chat-hub-skill-add-repository-input-row">
            <input
              autoFocus
              value={source}
				aria-label="Skill source URL"
				placeholder="owner/repo or well-known URL"
              onChange={event => {
                setSource(event.target.value);
                setError('');
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') add();
                if (event.key === 'Escape') collapse();
              }}
            />
            <button type="button" className="chat-hub-detail-action accent" disabled={busy} onClick={add}>Add</button>
            <button type="button" className="chat-hub-detail-action" disabled={busy} onClick={collapse}>Cancel</button>
          </div>
          {error ? <div className="chat-hub-skill-source-error">{error}</div> : null}
          <p className="chat-hub-skill-add-repository-hint">
			Adding a source does not install any skills.
          </p>
        </div>
      )}
    </section>
  );
}

export function ChatHubSkillScopeDetail({
  target,
  label,
  snapshot,
  loading,
  error,
  operationRunning,
  operation,
  pendingKey,
  actions,
}: ChatHubSkillScopeDetailProps) {
  const scopeKey = skillScopeSelectionKey(target);
  const [showUninstalled, setShowUninstalled] = useState(() => readSkillShowUninstalled(target));
  const sources = useMemo(
    () => [...(snapshot.sources ?? [])].sort((left, right) => left.sourceKey.localeCompare(right.sourceKey)),
    [snapshot.sources],
  );
  const unmanaged = useMemo(
    () => [...(snapshot.unmanagedSkills ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
    [snapshot.unmanagedSkills],
  );
  const scopeLabel = target.scope === 'hub' ? 'Hub' : 'Project';
  const busy = loading || operationRunning || isSkillActionPendingForHub(pendingKey, target.hubId);
  const operationInScope = operation?.scope === target.scope
    && (operation.projectName || '') === (target.projectName || '');

  useEffect(() => setShowUninstalled(readSkillShowUninstalled(target)), [scopeKey]);

  const toggleUninstalled = (value: boolean) => {
    setShowUninstalled(value);
    writeSkillShowUninstalled(target, value);
  };

  return (
    <section className="chat-hub-skill-scope" data-skill-scope={target.scope}>
      <div className="chat-hub-skill-toolbar">
        <span className="chat-hub-detail-title">{label}</span>
        <div className="chat-hub-skill-toolbar-actions">
          <button
            type="button"
            className="chat-hub-detail-action"
            aria-label={`Update ${scopeLabel} skills`}
            disabled={busy}
            onClick={() => actions.onUpdateScope(target)}
          >
            <Icon name="circleArrowUp" />
            <span>Update all</span>
          </button>
          <button
            type="button"
            className="chat-hub-detail-action"
            aria-label={`Show all ${scopeLabel} skills`}
            aria-pressed={showUninstalled}
            onClick={() => toggleUninstalled(!showUninstalled)}
          >
            <Icon name="eye" />
            <span>Show all</span>
          </button>
        </div>
      </div>

      {loading && sources.length === 0 && unmanaged.length === 0 ? (
        <div className="chat-hub-skill-state"><Icon name="loader" spin /><span>Loading skills…</span></div>
      ) : null}
      {!loading && error && sources.length === 0 && unmanaged.length === 0 ? (
        <div className="chat-hub-skill-state is-error">
          <span>{error}</span>
          <button type="button" onClick={() => actions.onRetry(target.hubId)}>Retry</button>
        </div>
      ) : null}
      {!loading && !error && sources.length === 0 && unmanaged.length === 0 ? (
		<div className="chat-hub-skill-state">No skill sources. Add a source to begin.</div>
      ) : null}

      {operation && operationInScope && !operation.running && (operation.results?.length ?? 0) > 0 ? (
        <section className={`chat-hub-skill-operation-results is-${operation.status}`} role="status">
          <header>
            <strong>{operation.status === 'partial' ? 'Completed with item failures' : 'Last operation'}</strong>
            <span>{operation.errorSummary || operation.message || operation.status}</span>
          </header>
          <div>
            {operation.results?.map((result, index) => (
              <div
                key={`${result.action}:${result.skill}:${index}`}
                className="chat-hub-skill-operation-result"
                data-result-status={result.status}
                data-tooltip={result.errorSummary}
              >
                <span>{result.skill}</span>
                <span>{result.action}</span>
                <strong>{result.status.charAt(0).toUpperCase() + result.status.slice(1)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="chat-hub-skill-sources">
        {sources.map(source => (
          <SkillSourceLedger
            key={source.sourceKey}
            target={target}
            source={source}
            showUninstalled={showUninstalled}
            busy={busy}
            actions={actions}
          />
        ))}
        {unmanaged.length > 0 ? (
          <section className="chat-hub-skill-source is-unmanaged" data-source-key="unmanaged">
            <header className="chat-hub-skill-source-header">
              <span className="chat-hub-skill-source-identity">
                <strong>Local / unmanaged</strong>
                <span className="chat-hub-skill-source-state is-unmanaged">outside source lock</span>
              </span>
            </header>
            <div className="chat-hub-skill-list">
              {unmanaged.map(skill => (
                <SkillCatalogRow
                  key={`unmanaged:${skill.name}`}
                  target={target}
                  skill={skill}
                  busy={busy}
                  actions={actions}
                />
              ))}
            </div>
          </section>
        ) : null}
        <InlineAddRepository target={target} busy={busy} actions={actions} />
      </div>
    </section>
  );
}
