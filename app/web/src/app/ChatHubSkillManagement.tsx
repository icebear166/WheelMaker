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
  readSkillShowUninstalled,
  shouldShowSkillCatalogRow,
  skillScopeSelectionKey,
  writeSkillShowUninstalled,
  type SkillDetailTarget,
  type SkillInstallTarget,
  type SkillScopeTarget,
  type SkillSourceSkillTarget,
  type SkillSourceTarget,
  type SkillUninstallTarget,
} from '../settings/skillManagementView';

export interface ChatHubSkillActions {
  onAdd: (target: SkillInstallTarget) => void;
  onDetail: (target: SkillDetailTarget) => void;
  onRefreshSource: (target: SkillSourceTarget) => void;
  onChangeSourceRef: (target: SkillSourceTarget) => void;
  onDeleteSource: (target: SkillSourceTarget) => void;
  onInstallSkill: (target: SkillSourceSkillTarget) => void;
  onUpdateSkill: (target: SkillSourceSkillTarget) => void;
  onUpdateAll: (target: SkillScopeTarget) => void;
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
};

function sourceTarget(target: SkillScopeTarget, source: RegistrySkillSourceSnapshot): SkillSourceTarget {
  return {
    ...target,
    source: source.source,
    sourceKey: source.sourceKey,
    ref: source.ref,
  };
}

function SkillCatalogRow({
  target,
  source,
  skill,
  busy,
  stale,
  actions,
}: {
  target: SkillScopeTarget;
  source?: RegistrySkillSourceSnapshot;
  skill: RegistrySkillCatalogItem;
  busy: boolean;
  stale: boolean;
  actions: ChatHubSkillActions;
}) {
  const conflicted = skill.conflict || skill.status === 'conflict';
  const removed = skill.status === 'removed_upstream' || skill.status === 'pending_removal';
  const uninstalled = skill.status === 'uninstalled';
  const canOpenDetail = skill.installed && !conflicted;
  const actionTarget = source ? {...sourceTarget(target, source), skillName: skill.name} : null;
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
        <span
          className="chat-hub-skill-status"
          data-tooltip={skill.error || STATUS_COPY[skill.status] || skill.status}
        >
          {STATUS_COPY[skill.status] || skill.status}
        </span>
      </span>
      <span className="chat-hub-skill-row-actions">
        {actionTarget && skill.canInstall && !conflicted ? (
          <button
            type="button"
            aria-label={`Install ${skill.name}`}
            disabled={busy || stale}
            onClick={() => actions.onInstallSkill(actionTarget)}
          >
            <Icon name="cloudDownload" />
          </button>
        ) : null}
        {actionTarget && skill.canUpdate && !conflicted ? (
          <button
            type="button"
            aria-label={`Update ${skill.name}`}
            disabled={busy || stale}
            onClick={() => actions.onUpdateSkill(actionTarget)}
          >
            <Icon name="refreshCw" />
          </button>
        ) : null}
        {skill.canUninstall && !conflicted ? (
          <button
            type="button"
            className="is-danger"
            aria-label={`Uninstall ${skill.name}`}
            disabled={busy}
            onClick={() => actions.onUninstall({...target, skillName: skill.name})}
          >
            <Icon name="trash" />
          </button>
        ) : null}
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
  const [refDraft, setRefDraft] = useState(source.ref);
  const stale = source.status === 'stale';
  const visibleSkills = useMemo(
    () => [...source.skills]
      .filter(skill => shouldShowSkillCatalogRow(skill, showUninstalled))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [showUninstalled, source.skills],
  );

  useEffect(() => setRefDraft(source.ref), [source.ref, source.sourceKey]);

  const baseTarget = sourceTarget(target, source);
  const statusCopy = source.status.replaceAll('_', ' ');
  return (
    <section
      className={`chat-hub-skill-source is-${source.status.replaceAll('_', '-')}`}
      data-source-key={source.sourceKey}
    >
      <header className="chat-hub-skill-source-header">
        <span className="chat-hub-skill-source-identity">
          <strong data-tooltip={source.source}>{source.sourceKey}</strong>
          <span className={`chat-hub-skill-source-state is-${source.status}`}>{statusCopy}</span>
        </span>
        <span className="chat-hub-skill-source-meta">
          <label className="chat-hub-skill-source-ref">
            <span>ref</span>
            <input
              className="chat-hub-skill-source-ref-input"
              aria-label={`Ref for ${source.sourceKey}`}
              value={refDraft}
              disabled={busy}
              onChange={event => setRefDraft(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="chat-hub-skill-source-ref-apply"
            aria-label={`Apply ref for ${source.sourceKey}`}
            disabled={busy || stale || !refDraft || refDraft === source.ref}
            onClick={() => actions.onChangeSourceRef({...baseTarget, ref: refDraft})}
          >
            Apply
          </button>
          <span className="chat-hub-skill-source-commit" data-tooltip={source.resolvedCommit || 'Not resolved'}>
            {source.resolvedCommit ? source.resolvedCommit.slice(0, 8) : 'unresolved'}
          </span>
          <span className="chat-hub-skill-source-counts">
            {source.installedCount} installed · {source.updateCount} updates
          </span>
        </span>
        <span className="chat-hub-skill-source-actions">
          <button
            type="button"
            aria-label={`Refresh ${source.sourceKey}`}
            disabled={busy}
            onClick={() => actions.onRefreshSource(baseTarget)}
          >
            <Icon name="scanLine" />
          </button>
          <button
            type="button"
            aria-label={`Update ${source.sourceKey} skills`}
            disabled={busy || stale || source.updateCount === 0}
            onClick={() => actions.onUpdateAll(baseTarget)}
          >
            <Icon name="refreshCw" />
          </button>
          <button
            type="button"
            className="is-danger"
            aria-label={`Delete ${source.sourceKey} source`}
            disabled={busy}
            onClick={() => actions.onDeleteSource(baseTarget)}
          >
            <Icon name="trash" />
          </button>
        </span>
      </header>
      {source.error ? <div className="chat-hub-skill-source-error">{source.error}</div> : null}
      <div className="chat-hub-skill-list">
        {visibleSkills.map(skill => (
          <SkillCatalogRow
            key={`${source.sourceKey}:${skill.name}`}
            target={target}
            source={source}
            skill={skill}
            busy={busy}
            stale={stale}
            actions={actions}
          />
        ))}
        {visibleSkills.length === 0 ? (
          <div className="chat-hub-skill-source-empty">
            {showUninstalled ? 'No skills in this source.' : 'No installed skills. Show uninstalled to browse this source.'}
          </div>
        ) : null}
      </div>
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
  const updateCount = sources.reduce((total, source) => total + source.updateCount, 0);
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
        <strong className="chat-hub-skill-toolbar-label">{label}</strong>
        <div className="chat-hub-skill-toolbar-actions">
          <label className="chat-hub-skill-uninstalled-toggle">
            <input
              type="checkbox"
              aria-label={`Show uninstalled ${scopeLabel} skills`}
              checked={showUninstalled}
              onChange={event => toggleUninstalled(event.target.checked)}
            />
            <span>Show uninstalled</span>
          </label>
          <button
            type="button"
            className="chat-hub-skill-icon-button"
            aria-label={`Add ${scopeLabel} skill source`}
            disabled={busy}
            onClick={() => actions.onAdd(target)}
          >
            <Icon name="plus" />
          </button>
          <button
            type="button"
            className="chat-hub-skill-update-all"
            aria-label={`Update all ${scopeLabel} skill sources`}
            disabled={busy || sources.length === 0 || updateCount === 0}
            onClick={() => actions.onUpdateAll(target)}
          >
            <Icon name={operationRunning ? 'loader' : 'refreshCw'} spin={operationRunning} />
            <span>{operationRunning ? 'Updating…' : 'Update all sources'}</span>
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
        <div className="chat-hub-skill-state">No skill sources. Add a Git repository to begin.</div>
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
                  stale={false}
                  actions={actions}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
