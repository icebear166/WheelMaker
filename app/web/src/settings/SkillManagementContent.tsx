import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {Icon} from '../common/Icon';
import type {
  RegistrySkillDetail,
  RegistrySkillSupportingFile,
} from '../registry/registryTypes';

const SKILL_MARKDOWN_REMARK_PLUGINS = [remarkGfm];

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
