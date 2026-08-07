import React from 'react';

import {Icon} from '../common/Icon';
import type {GitDiffFileMeta, GitDiffSource} from '../preview/previewWorkbenchState';
import type {RegistryGitCommitFile} from '../registry/registryTypes';
import type {GitWorkingTreeFile, GitWorkingTreeScope} from './gitBrowserModel';
import type {GitBrowserProjectSnapshot} from './gitBrowserStore';

export type GitHistoryPanelProps = {
  snapshot: GitBrowserProjectSnapshot;
  onSelectedRefsChange: (refs: string[]) => void;
  onToggleCommit: (sha: string) => void;
  onFileOpen: (source: GitDiffSource, file: GitDiffFileMeta) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onCopyCommitSha: (sha: string) => void;
  resolveFileIcon: (name: string) => {glyph: string; color: string};
  /** Drawer pin state; when both are provided a pin button renders next to refresh. */
  drawerPinned?: boolean;
  onToggleDrawerPin?: () => void;
};

const WORKTREE_SCOPES: Array<{scope: GitWorkingTreeScope; label: string}> = [
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

function commitTimeLabels(value: string): {absolute: string; relative: string} {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return {absolute: value, relative: ''};
  const absolute = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
  const deltaMinutes = Math.round((timestamp - Date.now()) / 60_000);
  const relative = Math.abs(deltaMinutes) < 90
    ? new Intl.RelativeTimeFormat(undefined, {numeric: 'auto'}).format(deltaMinutes, 'minute')
    : Math.abs(deltaMinutes) < 2_880
      ? new Intl.RelativeTimeFormat(undefined, {numeric: 'auto'}).format(Math.round(deltaMinutes / 60), 'hour')
      : new Intl.RelativeTimeFormat(undefined, {numeric: 'auto'}).format(Math.round(deltaMinutes / 1_440), 'day');
  return {absolute, relative};
}

function fileStats(files: RegistryGitCommitFile[]) {
  return files.reduce(
    (total, file) => ({
      additions: total.additions + file.additions,
      deletions: total.deletions + file.deletions,
    }),
    {additions: 0, deletions: 0},
  );
}

function GitFileRow({
  file,
  ariaLabel,
  resolveFileIcon,
  onClick,
}: {
  file: GitDiffFileMeta;
  ariaLabel: string;
  resolveFileIcon: GitHistoryPanelProps['resolveFileIcon'];
  onClick: () => void;
}) {
  const {name, parent} = splitPath(file.path);
  const fileIcon = resolveFileIcon(name || file.path);
  return (
    <button
      type="button"
      className="git-file-row"
      aria-label={ariaLabel}
      data-tooltip={file.path}
      onClick={onClick}
    >
      <span className="node-icon seti-icon" style={{color: fileIcon.color}}>
        <span className="seti-glyph">{fileIcon.glyph}</span>
      </span>
      <span className="git-file-path">
        <span className="git-file-name">{name || file.path}</span>
        {parent ? <span className="git-file-parent">{parent}</span> : null}
      </span>
      <span className="git-file-stats" aria-label={`${file.additions} additions, ${file.deletions} deletions`}>
        {file.additions > 0 ? <span className="additions">+{file.additions}</span> : null}
        {file.deletions > 0 ? <span className="deletions">-{file.deletions}</span> : null}
      </span>
    </button>
  );
}

function WorktreeGroup({
  scope,
  label,
  files,
  onFileOpen,
  resolveFileIcon,
}: {
  scope: GitWorkingTreeScope;
  label: string;
  files: GitWorkingTreeFile[];
  onFileOpen: GitHistoryPanelProps['onFileOpen'];
  resolveFileIcon: GitHistoryPanelProps['resolveFileIcon'];
}) {
  if (files.length === 0) return null;
  return (
    <div className="git-worktree-group">
      <div className="git-worktree-group-label">
        <span>{label}</span>
        <span className="git-count">{files.length}</span>
      </div>
      {files.map(file => {
        const meta: GitDiffFileMeta = {
          path: file.path,
          status: file.status,
          additions: 0,
          deletions: 0,
        };
        return (
          <GitFileRow
            key={`${scope}:${file.path}`}
            file={meta}
            ariaLabel={`Open ${file.path} ${scope} diff`}
            resolveFileIcon={resolveFileIcon}
            onClick={() => onFileOpen(
              {kind: 'worktree', scope, path: file.path},
              meta,
            )}
          />
        );
      })}
    </div>
  );
}

export function GitHistoryPanel({
  snapshot,
  onSelectedRefsChange,
  onToggleCommit,
  onFileOpen,
  onRefresh,
  onLoadMore,
  onRetry,
  onCopyCommitSha,
  resolveFileIcon,
  drawerPinned = false,
  onToggleDrawerPin,
}: GitHistoryPanelProps) {
  const [branchMenuOpen, setBranchMenuOpen] = React.useState(false);
  const branchMenuRef = React.useRef<HTMLDivElement | null>(null);
  const worktreeCount = WORKTREE_SCOPES.reduce(
    (count, item) => count + snapshot.worktree[item.scope].length,
    0,
  );

  React.useEffect(() => {
    if (!branchMenuOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && !branchMenuRef.current?.contains(target)) setBranchMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBranchMenuOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [branchMenuOpen]);

  if (!snapshot.available) {
    return <div className="git-history-empty">Git is not available for this project.</div>;
  }

  const toggleRef = (name: string) => {
    const selected = snapshot.selectedRefs.includes(name);
    let next = selected
      ? snapshot.selectedRefs.filter(ref => ref !== name)
      : [...snapshot.selectedRefs, name];
    if (next.length === 0 && snapshot.currentBranch) next = [snapshot.currentBranch];
    onSelectedRefsChange(next);
  };

  return (
    <div className="git-history-panel">
      <div className="git-history-toolbar">
        <div ref={branchMenuRef} className="git-branch-picker">
          <button
            type="button"
            className="git-toolbar-button git-branch-trigger"
            aria-label="Git branches"
            aria-haspopup="menu"
            aria-expanded={branchMenuOpen}
            disabled={!snapshot.online || !snapshot.refsLoaded}
            onClick={() => setBranchMenuOpen(open => !open)}
          >
            <Icon name="gitBranch" />
            <span>{snapshot.selectedRefs.length === 1 ? snapshot.selectedRefs[0] : `${snapshot.selectedRefs.length} refs`}</span>
            <Icon name="chevronDown" />
          </button>
          {branchMenuOpen ? (
            <div className="git-branch-menu" role="menu" aria-label="Select Git branches">
              {snapshot.branches.map(branch => {
                const selected = snapshot.selectedRefs.includes(branch.name);
                return (
                  <button
                    key={`${branch.kind}:${branch.name}`}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={selected}
                    aria-label={`Toggle ${branch.name}`}
                    className="git-branch-option"
                    onClick={() => toggleRef(branch.name)}
                  >
                    <span className={`git-branch-check${selected ? ' selected' : ''}`}>
                      {selected ? <Icon name="check" /> : null}
                    </span>
                    <span className="git-branch-option-name">{branch.name}</span>
                    <span className="git-ref-kind">{branch.kind}</span>
                    {branch.current ? <span className="git-head-pill">HEAD</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="git-toolbar-button icon-only"
          aria-label="Refresh Git history"
          data-tooltip="Refresh Git history"
          disabled={!snapshot.online || snapshot.historyLoading || snapshot.statusLoading}
          onClick={onRefresh}
        >
          <Icon name="refreshCw" spin={snapshot.historyLoading || snapshot.statusLoading} />
        </button>
        {onToggleDrawerPin ? (
          <button
            type="button"
            className={`git-toolbar-button icon-only${drawerPinned ? ' active' : ''}`}
            aria-label={drawerPinned ? 'Unpin drawer' : 'Pin drawer open'}
            data-tooltip={drawerPinned ? 'Unpin drawer' : 'Pin drawer open'}
            aria-pressed={drawerPinned}
            onClick={onToggleDrawerPin}
          >
            <Icon name="pin" filled={drawerPinned} />
          </button>
        ) : null}
        {!snapshot.online ? <span className="git-offline-pill">Offline</span> : null}
      </div>

      <section className="git-history-section git-worktree-section" aria-labelledby="git-working-tree-title">
        <div className="git-section-heading" id="git-working-tree-title">
          <span>Working Tree</span>
          {snapshot.statusLoaded ? <span className="git-count">{worktreeCount}</span> : null}
        </div>
        {snapshot.statusError ? (
          <div className="git-inline-error" role="alert">
            <span>{snapshot.statusError}</span>
            <button type="button" aria-label="Retry Git status" disabled={!snapshot.online} onClick={onRetry}>Retry</button>
          </div>
        ) : null}
        {snapshot.statusLoading && !snapshot.statusLoaded ? (
          <div className="git-history-state">Loading working tree...</div>
        ) : snapshot.statusLoaded && worktreeCount === 0 ? (
          <div className="git-history-state">No working tree changes</div>
        ) : (
          WORKTREE_SCOPES.map(item => (
            <WorktreeGroup
              key={item.scope}
              {...item}
              files={snapshot.worktree[item.scope]}
              onFileOpen={onFileOpen}
              resolveFileIcon={resolveFileIcon}
            />
          ))
        )}
      </section>

      <section className="git-history-section git-commit-section" aria-labelledby="git-history-title">
        <div className="git-section-heading" id="git-history-title">
          <span>History</span>
          {snapshot.historyLoaded ? <span className="git-count">{snapshot.commits.length}</span> : null}
        </div>
        {snapshot.historyError ? (
          <div className="git-inline-error" role="alert">
            <span>{snapshot.historyError}</span>
            <button type="button" aria-label="Retry Git history" disabled={!snapshot.online} onClick={onRetry}>Retry</button>
          </div>
        ) : null}
        {snapshot.historyLoading && !snapshot.historyLoaded ? (
          <div className="git-history-state">Loading Git history...</div>
        ) : snapshot.historyLoaded && snapshot.commits.length === 0 ? (
          <div className="git-history-state">No commits found</div>
        ) : (
          <div className="git-timeline">
            {snapshot.commits.map(commit => {
              const expanded = snapshot.expandedCommitSha === commit.sha;
              const files = snapshot.commitFilesBySha[commit.sha] ?? [];
              const stats = fileStats(files);
              const time = commitTimeLabels(commit.time);
              return (
                <article key={commit.sha} className={`git-commit${expanded ? ' expanded' : ''}`}>
                  <span className="git-commit-node" aria-hidden="true" />
                  <div className="git-commit-head">
                    <button
                      type="button"
                      className="git-commit-trigger"
                      aria-label={`Toggle commit ${commit.sha}`}
                      aria-expanded={expanded}
                      onClick={() => onToggleCommit(commit.sha)}
                    >
                      <span className="git-commit-title">{commit.title || '(untitled commit)'}</span>
                    </button>
                    <div className="git-commit-summary">
                      <span data-tooltip={commit.email || undefined}>{commit.author || commit.email || 'Unknown author'}</span>
                      <span className="git-short-sha">{commit.sha.slice(0, 8)}</span>
                      <button
                        type="button"
                        className="git-commit-copy"
                        aria-label={`Copy full SHA ${commit.sha}`}
                        data-tooltip="Copy full SHA"
                        onClick={() => onCopyCommitSha(commit.sha)}
                      >
                        <Icon name="copy" />
                      </button>
                      {time.relative ? <span data-tooltip={time.absolute || undefined}>{time.relative}</span> : null}
                    </div>
                  </div>
                  {expanded ? (
                    <div className="git-commit-details">
                      {snapshot.commitFilesLoadingSha === commit.sha ? (
                        <div className="git-history-state">Loading changed files...</div>
                      ) : snapshot.commitFilesError ? (
                        <div className="git-inline-error" role="alert">{snapshot.commitFilesError}</div>
                      ) : (
                        <>
                          <div className="git-commit-file-summary">
                            <span>{files.length} {files.length === 1 ? 'file' : 'files'}</span>
                            {stats.additions > 0 ? <span className="additions">+{stats.additions}</span> : null}
                            {stats.deletions > 0 ? <span className="deletions">-{stats.deletions}</span> : null}
                          </div>
                          <div className="git-commit-files">
                            {files.map(file => (
                              <GitFileRow
                                key={file.path}
                                file={file}
                                ariaLabel={`Open ${file.path} diff`}
                                resolveFileIcon={resolveFileIcon}
                                onClick={() => onFileOpen(
                                  {kind: 'commit', sha: commit.sha, path: file.path},
                                  file,
                                )}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
        {snapshot.historyLoaded && snapshot.commits.length > 0 && !snapshot.historyDone ? (
          <button
            type="button"
            className="git-load-more"
            aria-label="Load more commits"
            disabled={!snapshot.online || snapshot.historyMoreLoading}
            onClick={onLoadMore}
          >
            {snapshot.historyMoreLoading ? 'Loading...' : 'Load more'}
          </button>
        ) : null}
      </section>
    </div>
  );
}
