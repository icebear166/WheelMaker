import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {Icon} from '../common/Icon';
import type {
  RegistrySkillDetail,
  RegistrySkillSourceCandidate,
  RegistrySkillSupportingFile,
} from '../registry/registryTypes';

export const SKILLS_MARKETPLACE_URL = 'https://www.skills.sh/';
const SKILL_MARKDOWN_REMARK_PLUGINS = [remarkGfm];

export type SkillInstallContentProps = {
  sourceInput: string;
  onSourceInputChange: (value: string) => void;
  sourceLoading: boolean;
  sourceError: string;
  candidates: RegistrySkillSourceCandidate[];
  selectedNames: string[];
  onList: () => Promise<void>;
  onToggleAll: () => void;
  onToggleCandidate: (name: string) => void;
  onInstall: () => void;
};

export type SkillDetailContentProps = {
  loading: boolean;
  error: string;
  detail: RegistrySkillDetail | null;
};

function formatSkillFileSize(size?: number): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderDetailMetaRow(label: string, value?: string) {
  if (!value) return null;
  return (
    <div className="settings-skills-detail-meta-row">
      <span>{label}</span>
      <span title={value}>{value}</span>
    </div>
  );
}

function renderSupportingFile(file: RegistrySkillSupportingFile) {
  return (
    <div key={file.relativePath} className="settings-skills-detail-file">
      <Icon name={file.directory ? 'folder' : 'file'} size={13} />
      <span title={file.relativePath}>{file.relativePath}</span>
      <span>{file.directory ? 'Folder' : formatSkillFileSize(file.size)}</span>
    </div>
  );
}

export function SkillInstallContent({
  sourceInput,
  onSourceInputChange,
  sourceLoading,
  sourceError,
  candidates,
  selectedNames,
  onList,
  onToggleAll,
  onToggleCandidate,
  onInstall,
}: SkillInstallContentProps) {
  const selected = new Set(selectedNames);
  const candidateNames = Array.from(new Set(candidates.map(candidate => candidate.name).filter(Boolean)));
  const allCandidatesSelected = candidateNames.length > 0 &&
    candidateNames.every(name => selected.has(name));

  return (
    <div className="skill-install-content">
      <a
        className="skill-install-marketplace"
        href={SKILLS_MARKETPLACE_URL}
        target="_blank"
        rel="noreferrer"
      >
        <span className="settings-skills-marketplace-main">
          <span className="settings-skills-marketplace-label">Marketplace</span>
          <span className="settings-skills-marketplace-url">{SKILLS_MARKETPLACE_URL}</span>
        </span>
        <Icon name="externalLink" size={13} />
      </a>
      <div className="settings-skills-source-row">
        <input
          className="settings-skills-source-input"
          value={sourceInput}
          onChange={event => onSourceInputChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              onList().catch(() => undefined);
            }
          }}
          placeholder="owner/repo or npx skills add --skill name"
        />
        <button
          type="button"
          className="set-btn"
          aria-label="List source skills"
          disabled={sourceLoading}
          onClick={() => onList().catch(() => undefined)}
        >
          {sourceLoading ? 'Listing...' : 'List'}
        </button>
      </div>
      {sourceError ? <div className="set-error">{sourceError}</div> : null}
      {candidateNames.length > 0 ? (
        <div className="settings-skills-candidates">
          <label className="settings-skill-row settings-skill-candidate-row settings-skill-select-all-row">
            <input
              type="checkbox"
              checked={allCandidatesSelected}
              onChange={onToggleAll}
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
                onChange={() => onToggleCandidate(skillName)}
              />
              <span className="settings-skill-row-main">
                <span className="settings-skill-name">{skillName}</span>
              </span>
            </label>
          ))}
        </div>
      ) : null}
      <div className="settings-skills-install-actions">
        <span className="settings-skill-meta">Selected: {selectedNames.length}</span>
        <button
          type="button"
          className="set-btn set-btn--primary"
          disabled={selectedNames.length === 0}
          onClick={onInstall}
        >
          Install
        </button>
      </div>
    </div>
  );
}

export function SkillDetailContent({
  loading,
  error,
  detail,
}: SkillDetailContentProps) {
  const supportingFiles = [...(detail?.supportingFiles ?? [])]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return (
    <>
      {loading ? (
        <div className="settings-skills-detail-status" role="status">
          <Icon name="loader" spin size={13} />
          <span>Loading skill detail...</span>
        </div>
      ) : null}
      {error ? <div className="set-error">{error}</div> : null}
      {detail ? (
        <div className="settings-skills-detail-body">
          <section className="settings-skills-detail-section">
            <div className="settings-skills-detail-section-title">Install</div>
            <div className="settings-skills-detail-meta">
              {renderDetailMetaRow('Source', detail.source)}
              {renderDetailMetaRow('Source URL', detail.sourceUrl)}
              {renderDetailMetaRow('Source type', detail.sourceType)}
              {renderDetailMetaRow('Ref', detail.ref)}
              {renderDetailMetaRow('Skill path', detail.skillPath)}
              {renderDetailMetaRow('Plugin', detail.pluginName)}
              {renderDetailMetaRow('Installed', detail.installedAt)}
              {renderDetailMetaRow('Updated', detail.updatedAt)}
              {renderDetailMetaRow('Local path', detail.path)}
              {detail.agents?.length ? renderDetailMetaRow('Agents', detail.agents.join(', ')) : null}
              <div className="settings-skills-detail-meta-row">
                <span>Status</span>
                <span className="skill-detail-managed-state">
                  {detail.managed === false ? 'External' : 'Managed'}
                </span>
              </div>
            </div>
          </section>
          <section className="settings-skills-detail-section">
            <div className="settings-skills-detail-section-title">Skill.md</div>
            <div className="skill-detail-markdown markdown-preview">
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
    </>
  );
}
