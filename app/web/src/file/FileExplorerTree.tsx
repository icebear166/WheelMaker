import React from 'react';
import type { RegistryFsEntry } from '../registry/registryTypes';

type FileResolvedIcon = {
  glyph: string;
  color: string;
};

type FileExplorerTreeProps = {
  showSectionTitle?: boolean;
  dirEntries: Record<string, RegistryFsEntry[]>;
  loadingDirs: Record<string, boolean>;
  selectedFile: string;
  isExpanded: (path: string) => boolean;
  toggleDirectory: (path: string) => void;
  resolveFileIcon: (name: string) => FileResolvedIcon;
  onFileSelect: (path: string) => void;
  depthIndent?: number;
  rootState?: 'ready' | 'loading' | 'error' | 'empty';
  rootError?: string;
  onRetryRoot?: () => void;
};

export function FileExplorerTree({
  showSectionTitle = true,
  dirEntries,
  loadingDirs,
  selectedFile,
  isExpanded,
  toggleDirectory,
  resolveFileIcon,
  onFileSelect,
  depthIndent = 14,
  rootState = 'ready',
  rootError = '',
  onRetryRoot,
}: FileExplorerTreeProps) {
  const renderFileTree = (path: string, depth: number): React.ReactNode => {
    const entries = dirEntries[path] ?? [];
    return entries.map(entry => {
      if (entry.kind === 'dir') {
        const expanded = isExpanded(entry.path);
        return (
          <div key={entry.path}>
            <div
              className="item"
              style={{ paddingLeft: 10 + depth * depthIndent }}
              onClick={() => {
                toggleDirectory(entry.path);
              }}
            >
              <span
                className={`caret codicon ${
                  expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'
                }`}
              />
              <span
                className={`node-icon codicon ${
                  expanded ? 'codicon-folder-opened' : 'codicon-folder'
                }`}
              />
              <span className="label">{entry.name}</span>
              {loadingDirs[entry.path] ? (
                <span className="muted">...</span>
              ) : null}
            </div>
            {expanded ? renderFileTree(entry.path, depth + 1) : null}
          </div>
        );
      }

      const fileIcon = resolveFileIcon(entry.name);
      return (
        <div
          key={entry.path}
          className={`item ${selectedFile === entry.path ? 'selected' : ''}`}
          style={{ paddingLeft: 10 + depth * depthIndent }}
          onClick={() => {
            onFileSelect(entry.path);
          }}
        >
          <span className="caret placeholder" aria-hidden="true" />
          <span
            className="node-icon seti-icon"
            style={{ color: fileIcon.color }}
          >
            <span className="seti-glyph">{fileIcon.glyph}</span>
          </span>
          <span className="label">{entry.name}</span>
        </div>
      );
    });
  };

  return (
    <>
      {showSectionTitle ? <div className="section-title">EXPLORER</div> : null}
      <div className="list">
        {rootState === 'loading' ? (
          <div className="file-tree-root-state" role="status">Loading files...</div>
        ) : rootState === 'error' ? (
          <div className="file-tree-root-state error" role="alert">
            <span>{rootError || 'Failed to load files.'}</span>
            {onRetryRoot ? (
              <button type="button" onClick={onRetryRoot}>Retry</button>
            ) : null}
          </div>
        ) : rootState === 'empty' ? (
          <div className="file-tree-root-state" role="status">No files found</div>
        ) : (
          renderFileTree('.', 0)
        )}
      </div>
    </>
  );
}
