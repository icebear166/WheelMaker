import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {Icon} from '../common/Icon';
import type {
  RegistrySkillDetail,
  RegistrySkillSourcePreview,
  RegistrySkillSupportingFile,
} from '../registry/registryTypes';

export const SKILLS_MARKETPLACE_URL = 'https://www.skills.sh/';
const SKILL_MARKDOWN_REMARK_PLUGINS = [remarkGfm];

export type SkillInstallContentProps = {
  sourceInput: string;
  onSourceInputChange: (value: string) => void;
  sourceLoading: boolean;
  sourceError: string;
  preview: RegistrySkillSourcePreview | null;
  requestedSkillNames: string[];
  onPreview: () => Promise<void>;
  onApply: (previewId: string) => void;
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
      <span data-tooltip={value}>{value}</span>
    </div>
  );
}

function renderSupportingFile(file: RegistrySkillSupportingFile) {
  return (
    <div key={file.relativePath} className="settings-skills-detail-file">
      <Icon name={file.directory ? 'folder' : 'file'} size={13} />
      <span data-tooltip={file.relativePath}>{file.relativePath}</span>
      <span>{file.directory ? 'Folder' : formatSkillFileSize(file.size)}</span>
    </div>
  );
}

export function SkillInstallContent({
  sourceInput,
  onSourceInputChange,
  sourceLoading,
  sourceError,
  preview,
  requestedSkillNames,
  onPreview,
  onApply,
}: SkillInstallContentProps) {
  const explicitNames = preview?.skills?.length ? preview.skills : requestedSkillNames;
  const explicit = explicitNames.length > 0 || preview?.kind === 'previewInstall';
  const previewNames = explicit
    ? explicitNames
    : preview?.skillList.map(skill => skill.name) ?? [];

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
              onPreview().catch(() => undefined);
            }
          }}
          placeholder="owner/repo, Git URL, or npx skills add --skill name"
        />
        <button
          type="button"
          className="set-btn"
          aria-label="Preview skill source"
          disabled={sourceLoading}
          onClick={() => onPreview().catch(() => undefined)}
        >
          {sourceLoading ? 'Checking...' : 'Preview'}
        </button>
      </div>
      {sourceError ? <div className="set-error">{sourceError}</div> : null}
      {preview ? (
        <div className="skill-install-preview-summary">
          <span className="skill-install-preview-mode">
            {explicit ? `${explicitNames.length} skill${explicitNames.length === 1 ? '' : 's'}` : 'Source only'}
          </span>
          <span className="skill-install-preview-source" data-tooltip={preview.source}>{preview.sourceKey}</span>
          <span className="skill-install-preview-revision">{preview.resolvedCommit.slice(0, 8)}</span>
        </div>
      ) : null}
      {previewNames.length > 0 ? (
        <div className="settings-skills-candidates">
          {previewNames.map(skillName => (
            <div key={`candidate:${skillName}`} className="settings-skill-row settings-skill-candidate-row">
              <span className="settings-skill-row-main">
                <span className="settings-skill-name">{skillName}</span>
              </span>
              <span className="settings-skill-meta">{explicit ? 'Install' : 'Available after save'}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="settings-skills-install-actions">
        <span className="settings-skill-meta">
          {preview
            ? explicit
              ? `Pinned at ${preview.resolvedCommit.slice(0, 8)}`
              : `${preview.skillList.length} skills discovered`
            : 'Preview resolves and pins the source before any write.'}
        </span>
        <button
          type="button"
          className="set-btn set-btn--primary"
          aria-label={explicit ? `Install ${explicitNames.length} skills` : 'Save skill source'}
          disabled={!preview || sourceLoading}
          onClick={() => preview && onApply(preview.id)}
        >
          {explicit ? 'Install' : 'Save source'}
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
