import React from 'react';

import {ShikiDiffPane} from '../code/ShikiCodeBlock';
import type {CodeFontId, CodeThemeId} from '../code/shikiSettings';
import {detectCodeLanguage} from '../code/codeLanguage';
import {Icon} from '../common/Icon';

export type UnifiedDiffPreviewFile = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  diff: string;
  expanded: boolean;
  isBinary?: boolean;
  truncated?: boolean;
};

export type UnifiedDiffPreviewProps = {
  files: UnifiedDiffPreviewFile[];
  activeFilePath: string;
  loading: boolean;
  error: string;
  overviewLabel: string;
  onToggleFile: (path: string) => void;
  themeMode: 'dark' | 'light';
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontFamily: string;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
};

function splitPathForDisplay(path: string): {fileName: string; parentPath: string} {
  const normalized = path.replace(/\\/g, '/');
  const separator = normalized.lastIndexOf('/');
  return separator < 0
    ? {fileName: normalized, parentPath: ''}
    : {fileName: normalized.slice(separator + 1), parentPath: normalized.slice(0, separator)};
}

export function UnifiedDiffPreview({
  files,
  activeFilePath,
  loading,
  error,
  overviewLabel,
  onToggleFile,
  themeMode,
  codeTheme,
  codeFont,
  codeFontFamily,
  codeFontSize,
  codeLineHeight,
  codeTabSize,
}: UnifiedDiffPreviewProps) {
  if (loading) {
    return <div className="muted block">Loading diff...</div>;
  }
  if (error) {
    return (
      <div className="chat-file-peek-error" role="alert">
        <Icon name="x" />
        <span>{error}</span>
      </div>
    );
  }
  if (files.length === 0) {
    return <div className="muted block">No diff available</div>;
  }

  return (
    <div className="chat-prompt-diff-preview">
      <div className="chat-prompt-diff-overview">
        <Icon name="fileDiff" />
        <span>{overviewLabel}</span>
      </div>
      {files.map(file => {
        const {fileName, parentPath} = splitPathForDisplay(file.path);
        const active = file.path === activeFilePath;
        return (
          <section
            key={file.path}
            className={`chat-prompt-diff-file${file.expanded ? ' expanded' : ''}${active ? ' active' : ''}`}
            data-preview-diff-path={file.path}
          >
            <button
              type="button"
              className="chat-prompt-diff-file-header"
              onClick={() => onToggleFile(file.path)}
              aria-expanded={file.expanded}
              aria-current={active || undefined}
              data-tooltip={file.path}
            >
              <Icon name={file.expanded ? 'chevronDown' : 'chevronRight'} />
              <span className={`chat-prompt-artifact-file-status status-${file.status.toLowerCase()}`}>
                {file.status}
              </span>
              <span className="chat-prompt-diff-file-title">
                <span className="chat-prompt-diff-file-name">{fileName || file.path}</span>
                {parentPath ? <span className="chat-prompt-diff-file-path">{parentPath}</span> : null}
              </span>
              <span className="chat-prompt-diff-file-counts">
                {file.additions > 0 ? <span className="additions">+{file.additions}</span> : null}
                {file.deletions > 0 ? <span className="deletions">-{file.deletions}</span> : null}
              </span>
            </button>
            {file.expanded ? (
              <div className="chat-prompt-diff-file-body">
                {file.isBinary ? (
                  <div className="git-diff-notice muted">Binary diff is not rendered</div>
                ) : null}
                {file.truncated ? (
                  <div className="git-diff-notice muted">Diff was truncated</div>
                ) : null}
                {!file.isBinary && file.diff ? (
                  <ShikiDiffPane
                    content={file.diff}
                    language={detectCodeLanguage(file.path)}
                    wrap={false}
                    lineNumbers={true}
                    themeMode={themeMode}
                    codeTheme={codeTheme}
                    codeFont={codeFont}
                    codeFontFamily={codeFontFamily}
                    codeFontSize={codeFontSize}
                    codeLineHeight={codeLineHeight}
                    codeTabSize={codeTabSize}
                  />
                ) : !file.isBinary ? (
                  <div className="muted block">File diff unavailable</div>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
