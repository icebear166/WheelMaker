import React from 'react';

import {ChatFunctionSurface} from '../chat/ChatFunctionSurface';
import {Icon} from '../common/Icon';
import type {GitDiffFileMeta, GitDiffSource} from '../preview/previewWorkbenchState';
import type {GitWorkingTreeScope} from './gitBrowserModel';
import type {GitBrowserProjectSnapshot} from './gitBrowserStore';

export type GitStatusSurfaceProps = {
  snapshot: GitBrowserProjectSnapshot;
  onRefresh: () => void;
  onRetry: () => void;
  onFileOpen: (source: GitDiffSource, file: GitDiffFileMeta) => void;
};

const GROUPS: Array<{scope: GitWorkingTreeScope; label: string}> = [
  {scope: 'staged', label: 'Staged'},
  {scope: 'unstaged', label: 'Unstaged'},
  {scope: 'untracked', label: 'Untracked'},
];

function splitPath(path: string): {name: string; parent: string} {
  const normalized = path.replace(/\\/g, '/');
  const separator = normalized.lastIndexOf('/');
  return separator < 0
    ? {name: normalized, parent: ''}
    : {name: normalized.slice(separator + 1), parent: normalized.slice(0, separator)};
}

export function GitStatusSurface({
  snapshot,
  onRefresh,
  onRetry,
  onFileOpen,
}: GitStatusSurfaceProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const total = GROUPS.reduce(
    (count, group) => count + snapshot.worktree[group.scope].length,
    0,
  );
  const changeLabel = `${total} ${total === 1 ? 'change' : 'changes'}`;
  const toolbar = (
    <>
      <span className="git-status-summary" title={`${snapshot.currentBranch} · ${changeLabel}`}>
        <Icon name="gitBranch" />
        <span>{snapshot.currentBranch || 'Detached HEAD'} · {changeLabel}</span>
      </span>
      <button
        type="button"
        className="chat-function-action"
        aria-label="Refresh Git status"
        title="Refresh Git status"
        disabled={!snapshot.online || snapshot.statusLoading}
        onClick={onRefresh}
      >
        <Icon name="refreshCw" spin={snapshot.statusLoading} />
      </button>
    </>
  );

  return (
    <ChatFunctionSurface
      title="Git"
      collapsed={collapsed}
      mode="compact"
      toolbar={toolbar}
      onToggleCollapsed={() => setCollapsed(value => !value)}
      className="git-status-surface"
      revealOnHover
    >
      <div className="git-status-body">
        {snapshot.statusError ? (
          <div className="git-status-error" role="alert">
            <span>{snapshot.statusError}</span>
            <button
              type="button"
              aria-label="Retry Git status"
              disabled={!snapshot.online}
              onClick={onRetry}
            >
              Retry
            </button>
          </div>
        ) : null}
        {snapshot.statusLoading && !snapshot.statusLoaded ? (
          <div className="git-status-state">Loading Git status...</div>
        ) : total === 0 ? (
          <div className="git-status-state clean">Working tree clean</div>
        ) : (
          <div className="git-status-groups">
            {GROUPS.map(group => {
              const files = snapshot.worktree[group.scope];
              if (files.length === 0) return null;
              return (
                <section key={group.scope} className="git-status-group">
                  <div className="git-status-group-heading">
                    <span>{group.label}</span>
                    <span>{files.length}</span>
                  </div>
                  {files.map(file => {
                    const {name, parent} = splitPath(file.path);
                    const meta: GitDiffFileMeta = {
                      path: file.path,
                      status: file.status,
                      additions: 0,
                      deletions: 0,
                    };
                    return (
                      <button
                        key={`${group.scope}:${file.path}`}
                        type="button"
                        className="git-status-file"
                        aria-label={`Open ${file.path} diff`}
                        title={`${group.label} · ${file.path}`}
                        onClick={() => onFileOpen(
                          {kind: 'worktree', scope: group.scope, path: file.path},
                          meta,
                        )}
                      >
                        <span className="git-status-file-code">{file.status}</span>
                        <span className="git-status-file-path">
                          <span>{name || file.path}</span>
                          {parent ? <span className="git-status-file-parent">{parent}</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </ChatFunctionSurface>
  );
}
