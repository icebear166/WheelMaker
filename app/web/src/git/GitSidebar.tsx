import type React from 'react';
import type {
  RegistryGitCommit,
  RegistryGitCommitFile,
  RegistryProject,
} from '../types/registry';
import { WorkspaceProjectSelector } from '../file/FileExplorerTree';
import {
  WORKING_TREE_COMMIT_ID,
  formatGitCommitDateTime,
  formatRelativeTime,
  pickPreferredPath,
  splitPathForDisplay,
  type GitCommitPopoverState,
  type GitDiffSource,
  type WorkingTreeFileEntry,
} from './gitView';

type GitDiffScope = WorkingTreeFileEntry['scope'];

type GitSidebarProps = {
  isWide: boolean;
  projects: RegistryProject[];
  projectId: string;
  currentProjectName: string;
  sortedProjectItems: RegistryProject[];
  workspaceProjectMenuOpen: boolean;
  setWorkspaceProjectMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  syncWorkspaceProject: (projectId: string, options: {reason: 'manual'}) => Promise<void>;
  gitBranchMenuRef: React.RefObject<HTMLDivElement | null>;
  gitBranchPickerOpen: boolean;
  setGitBranchPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  gitBranches: string[];
  gitCurrentBranch: string;
  gitSelectedBranches: string[];
  toggleGitBranchSelection: (branch: string) => void;
  loadGit: () => Promise<boolean>;
  gitLoading: boolean;
  gitError: string;
  workingTreeFiles: WorkingTreeFileEntry[];
  worktreeExpanded: boolean;
  setWorktreeExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  selectedDiff: string;
  selectedDiffScope: GitDiffScope;
  selectedDiffSource: GitDiffSource;
  setSelectedDiff: React.Dispatch<React.SetStateAction<string>>;
  setSelectedDiffScope: React.Dispatch<React.SetStateAction<GitDiffScope>>;
  setSelectedDiffSource: React.Dispatch<React.SetStateAction<GitDiffSource>>;
  setDrawerOpen: (next: boolean) => void;
  commits: RegistryGitCommit[];
  selectedCommit: string;
  setSelectedCommit: React.Dispatch<React.SetStateAction<string>>;
  expandedCommitShas: string[];
  setExpandedCommitShas: React.Dispatch<React.SetStateAction<string[]>>;
  commitFilesBySha: Record<string, RegistryGitCommitFile[]>;
  commitPopover: GitCommitPopoverState | null;
  setCommitPopover: React.Dispatch<React.SetStateAction<GitCommitPopoverState | null>>;
  commitPopoverRef: React.RefObject<HTMLDivElement | null>;
};

export function GitSidebar({
  isWide,
  projects,
  projectId,
  currentProjectName,
  sortedProjectItems,
  workspaceProjectMenuOpen,
  setWorkspaceProjectMenuOpen,
  syncWorkspaceProject,
  gitBranchMenuRef,
  gitBranchPickerOpen,
  setGitBranchPickerOpen,
  gitBranches,
  gitCurrentBranch,
  gitSelectedBranches,
  toggleGitBranchSelection,
  loadGit,
  gitLoading,
  gitError,
  workingTreeFiles,
  worktreeExpanded,
  setWorktreeExpanded,
  selectedDiff,
  selectedDiffScope,
  selectedDiffSource,
  setSelectedDiff,
  setSelectedDiffScope,
  setSelectedDiffSource,
  setDrawerOpen,
  commits,
  selectedCommit,
  setSelectedCommit,
  expandedCommitShas,
  setExpandedCommitShas,
  commitFilesBySha,
  commitPopover,
  setCommitPopover,
  commitPopoverRef,
}: GitSidebarProps) {
  const popoverFiles = commitPopover
    ? commitFilesBySha[commitPopover.commit.sha] ?? []
    : [];
  const popoverFileCount = popoverFiles.length;
  const popoverAdditions = popoverFiles.reduce(
    (sum, item) => sum + (item.additions || 0),
    0,
  );
  const popoverDeletions = popoverFiles.reduce(
    (sum, item) => sum + (item.deletions || 0),
    0,
  );
  const graphItemsCount =
    commits.length + (workingTreeFiles.length > 0 ? 1 : 0);
  const headCommitSha = commits[0]?.sha ?? '';
  const branchOptions =
    gitBranches.length > 0
      ? gitBranches
      : gitCurrentBranch
      ? [gitCurrentBranch]
      : [];
  const branchFilterLabel =
    gitSelectedBranches.length <= 1
      ? gitSelectedBranches[0] ?? gitCurrentBranch ?? 'branch'
      : `${gitSelectedBranches.length} branches`;
  const worktreeActive = selectedDiffSource === 'worktree';

  return (
    <>
      {isWide ? (
        <WorkspaceProjectSelector
          projects={projects}
          projectId={projectId}
          currentProjectName={currentProjectName}
          sortedProjectItems={sortedProjectItems}
          workspaceProjectMenuOpen={workspaceProjectMenuOpen}
          setWorkspaceProjectMenuOpen={setWorkspaceProjectMenuOpen}
          syncWorkspaceProject={syncWorkspaceProject}
        />
      ) : null}
      <div className="section-title git-section-title">
        <span className="git-section-main">GRAPH</span>
        <span className="git-section-meta">{`${graphItemsCount} items`}</span>
        <div className="git-section-actions">
          <div className="git-branch-picker" ref={gitBranchMenuRef}>
            <button
              type="button"
              className={`git-section-btn git-branch-picker-btn ${
                gitBranchPickerOpen ? 'open' : ''
              }`}
              onClick={() => setGitBranchPickerOpen(prev => !prev)}
              title="Select branches to display"
            >
              <span className="codicon codicon-git-branch" />
              <span className="git-branch-picker-btn-text">{branchFilterLabel}</span>
              <span className="codicon codicon-chevron-down" />
            </button>
            {gitBranchPickerOpen && isWide ? (
              <div className="git-branch-picker-menu">
                {branchOptions.length === 0 ? (
                  <div className="git-branch-picker-empty">No branches</div>
                ) : (
                  branchOptions.map(branch => {
                    const selected = gitSelectedBranches.includes(branch);
                    return (
                      <button
                        key={branch}
                        type="button"
                        className={`git-branch-picker-item ${
                          selected ? 'selected' : ''
                        }`}
                        onClick={() => toggleGitBranchSelection(branch)}
                      >
                        <span className="git-branch-picker-check" aria-hidden="true">
                          {selected ? '✓' : ''}
                        </span>
                        <span className="git-branch-picker-name">{branch}</span>
                        {branch === gitCurrentBranch ? (
                          <span className="git-branch-picker-current">current</span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="git-section-btn"
            onClick={() => {
              setCommitPopover(null);
              loadGit().catch(() => undefined);
            }}
            title="Refresh git view"
          >
            <span className="codicon codicon-refresh" />
          </button>
        </div>
      </div>
      <div className="list half">
        {gitLoading ? (
          <div className="muted block">Loading commits...</div>
        ) : null}
        {gitError ? <div className="error block">{gitError}</div> : null}

        {workingTreeFiles.length > 0 ? (
          <>
            <div
              className={`item git-row git-worktree-row ${
                worktreeActive ? 'selected' : ''
              }`}
              onClick={() => {
                setSelectedDiffSource('worktree');
                setExpandedCommitShas([]);
                setCommitPopover(null);
                setWorktreeExpanded(prev => !prev);
                if (workingTreeFiles[0]) {
                  const preferredPath = pickPreferredPath(workingTreeFiles);
                  const preferredFile =
                    workingTreeFiles.find(
                      item => item.path === preferredPath,
                    ) ?? workingTreeFiles[0];
                  setSelectedDiff(preferredFile.path);
                  setSelectedDiffScope(preferredFile.scope);
                }
              }}
            >
              <span className="git-graph-lane" aria-hidden="true">
                <span className="git-graph-line" />
                <span className={`git-graph-dot ${worktreeActive ? 'active' : ''}`} />
              </span>
              <span className="git-row-spacer" aria-hidden="true" />
              <span className="label git-commit-label">
                <span className="git-commit-title">Working Tree</span>
                <span className="git-commit-sha">
                  {`${workingTreeFiles.length} files`}
                </span>
              </span>
            </div>
            {worktreeExpanded
              ? workingTreeFiles.map(file => {
                  const { fileName, parentPath } = splitPathForDisplay(file.path);
                  return (
                    <div
                      key={`${WORKING_TREE_COMMIT_ID}:${file.scope}:${file.path}`}
                      className={`item git-row git-file-row git-tree-child ${
                        selectedDiff === file.path &&
                        selectedDiffScope === file.scope &&
                        selectedDiffSource === 'worktree'
                          ? 'selected'
                          : ''
                      }`}
                      onClick={() => {
                        setSelectedDiff(file.path);
                        setSelectedDiffSource('worktree');
                        setSelectedDiffScope(file.scope);
                        if (!isWide) setDrawerOpen(false);
                      }}
                    >
                      <span className="git-graph-lane child" aria-hidden="true">
                        <span className="git-graph-line" />
                      </span>
                      <span className="git-row-spacer" aria-hidden="true" />
                      <span className={`status-tag status-git-${file.status}`}>
                        {file.status}
                      </span>
                      <span className="muted git-file-scope">{file.scope}</span>
                      <span className="label git-file-label">
                        <span className="git-file-name">{fileName || file.path}</span>
                        {parentPath ? (
                          <span className="git-file-path">{parentPath}</span>
                        ) : null}
                      </span>
                    </div>
                  );
                })
              : null}
          </>
        ) : !gitLoading ? (
          <div className="muted block">No local changes</div>
        ) : null}

        {commits.map(commit => {
          const expanded = expandedCommitShas.includes(commit.sha);
          const selected = !worktreeActive && selectedCommit === commit.sha;
          const filesLoaded = Object.prototype.hasOwnProperty.call(
            commitFilesBySha,
            commit.sha,
          );
          const files = commitFilesBySha[commit.sha] ?? [];
          const showBranchTags =
            headCommitSha !== '' && commit.sha === headCommitSha;
          const inlineBranchTags = showBranchTags
            ? gitSelectedBranches.slice(0, 2)
            : [];
          return (
            <div key={commit.sha}>
              <div
                className={`item git-row git-commit-row ${
                  selected ? 'selected' : ''
                }`}
                onClick={event => {
                  const nextExpanded = !expanded;
                  const currentFiles = commitFilesBySha[commit.sha] ?? [];
                  setSelectedCommit(commit.sha);
                  setSelectedDiffSource('commit');
                  setSelectedDiffScope('unstaged');
                  setWorktreeExpanded(false);
                  setExpandedCommitShas(nextExpanded ? [commit.sha] : []);
                  if (nextExpanded) {
                    if (currentFiles[0]) {
                      setSelectedDiff(pickPreferredPath(currentFiles));
                    } else {
                      setSelectedDiff('');
                    }
                  }

                  const rect = (
                    event.currentTarget as HTMLDivElement
                  ).getBoundingClientRect();
                  const popoverHeight = 250;
                  const safePadding = 8;
                  let popoverWidth = Math.min(
                    460,
                    Math.max(320, Math.round(window.innerWidth * 0.42)),
                  );
                  let x = safePadding;
                  let y = safePadding;

                  if (isWide) {
                    const maxX = window.innerWidth - popoverWidth - safePadding;
                    const rightCandidate = rect.right + 12;
                    const leftCandidate = rect.left - popoverWidth - 12;
                    x = rightCandidate;
                    if (x > maxX) {
                      x = leftCandidate >= safePadding ? leftCandidate : maxX;
                    }
                    x = Math.max(safePadding, Math.min(maxX, x));
                    y = Math.max(
                      52,
                      Math.min(
                        window.innerHeight - popoverHeight - safePadding,
                        rect.top - 8,
                      ),
                    );
                  } else {
                    popoverWidth = Math.max(
                      260,
                      Math.min(
                        window.innerWidth - safePadding * 2,
                        Math.round(window.innerWidth * 0.92),
                      ),
                    );
                    x = Math.max(
                      safePadding,
                      Math.round((window.innerWidth - popoverWidth) / 2),
                    );
                    const clickMidY = rect.top + rect.height / 2;
                    const listPanel = (
                      event.currentTarget as HTMLDivElement
                    ).closest('.list');
                    const panelRect =
                      listPanel instanceof HTMLElement
                        ? listPanel.getBoundingClientRect()
                        : null;
                    const panelMidY = panelRect
                      ? panelRect.top + panelRect.height / 2
                      : window.innerHeight / 2;
                    const preferBelow = clickMidY <= panelMidY;
                    const topZoneY = panelRect
                      ? Math.max(52, Math.round(panelRect.top + 8))
                      : 52;
                    const bottomZoneY = panelRect
                      ? Math.min(
                          window.innerHeight - popoverHeight - safePadding,
                          Math.round(panelRect.bottom - popoverHeight - 8),
                        )
                      : window.innerHeight - popoverHeight - safePadding;
                    if (bottomZoneY <= topZoneY) {
                      y = Math.max(
                        52,
                        Math.min(
                          window.innerHeight - popoverHeight - safePadding,
                          topZoneY,
                        ),
                      );
                    } else {
                      y = preferBelow ? bottomZoneY : topZoneY;
                    }
                  }

                  setCommitPopover({ commit, x, y, width: popoverWidth });
                }}
              >
                <span className="git-graph-lane" aria-hidden="true">
                  <span className="git-graph-line" />
                  <span className={`git-graph-dot ${selected ? 'active' : ''}`} />
                </span>
                <span className="git-row-spacer" aria-hidden="true" />
                <span className="label git-commit-label">
                  <span className="git-commit-title">
                    {commit.title || commit.sha.slice(0, 7)}
                  </span>
                  <span className="git-commit-meta">
                    {formatRelativeTime(commit.time)}
                  </span>
                  {inlineBranchTags.length > 0 ? (
                    <span className="git-commit-tags">
                      {inlineBranchTags.map(branch => (
                        <span key={`${commit.sha}:${branch}`} className="git-commit-tag">
                          {branch}
                        </span>
                      ))}
                      {gitSelectedBranches.length > inlineBranchTags.length ? (
                        <span className="git-commit-tag git-commit-tag-muted">
                          +{gitSelectedBranches.length - inlineBranchTags.length}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              </div>
              {expanded ? (
                filesLoaded ? (
                  files.length > 0 ? (
                    files.map(file => {
                      const { fileName, parentPath } = splitPathForDisplay(file.path);
                      return (
                        <div
                          key={`${commit.sha}:${file.path}`}
                          className={`item git-row git-file-row git-tree-child ${
                            selectedDiffSource === 'commit' &&
                            selectedCommit === commit.sha &&
                            selectedDiff === file.path
                              ? 'selected'
                              : ''
                          }`}
                          onClick={() => {
                            setSelectedCommit(commit.sha);
                            setSelectedDiff(file.path);
                            setSelectedDiffSource('commit');
                            setSelectedDiffScope('unstaged');
                            if (!isWide) setDrawerOpen(false);
                          }}
                        >
                          <span className="git-graph-lane child" aria-hidden="true">
                            <span className="git-graph-line" />
                          </span>
                          <span className="git-row-spacer" aria-hidden="true" />
                          <span className={`status-tag status-git-${file.status}`}>
                            {file.status}
                          </span>
                          <span className="label git-file-label">
                            <span className="git-file-name">{fileName || file.path}</span>
                            {parentPath ? (
                              <span className="git-file-path">{parentPath}</span>
                            ) : null}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div className="item git-row git-file-row git-tree-child muted">
                      <span className="git-graph-lane child" aria-hidden="true">
                        <span className="git-graph-line" />
                      </span>
                      <span className="git-row-spacer" aria-hidden="true" />
                      <span className="label">No changed files</span>
                    </div>
                  )
                ) : (
                  <div className="item git-row git-file-row git-tree-child muted">
                    <span className="git-graph-lane child" aria-hidden="true">
                      <span className="git-graph-line" />
                    </span>
                    <span className="git-row-spacer" aria-hidden="true" />
                    <span className="label">Loading files...</span>
                  </div>
                )
              ) : null}
            </div>
          );
        })}

        {commits.length === 0 && !gitLoading ? (
          <div className="muted block">No commits found</div>
        ) : null}
      </div>

      {commitPopover ? (
        <div
          ref={commitPopoverRef}
          className="git-commit-popover"
          style={{
            left: `${commitPopover.x}px`,
            top: `${commitPopover.y}px`,
            width: `${commitPopover.width}px`,
          }}
        >
          <div className="git-commit-popover-header">
            <div className="git-commit-popover-meta">
              <span className="git-commit-popover-avatar">
                {(commitPopover.commit.author || 'U').slice(0, 1).toLowerCase()}
              </span>
              <span className="git-commit-popover-meta-line">
                {commitPopover.commit.author || 'Unknown'}, {' '}
                {formatRelativeTime(commitPopover.commit.time)}
                {' '}({formatGitCommitDateTime(commitPopover.commit.time)})
              </span>
            </div>
            <button
              type="button"
              className="git-commit-popover-close"
              onClick={() => setCommitPopover(null)}
              aria-label="Close commit details"
            >
              <span className="codicon codicon-close" />
            </button>
          </div>
          <div className="git-commit-popover-body">
            <div className="git-commit-popover-title-text">
              {commitPopover.commit.title || '(no title)'}
            </div>
            <div className="git-commit-popover-stats">
              <span>{`${popoverFileCount} files changed,`}</span>
              <span className="insertions">{`${popoverAdditions} insertions(+)`}</span>
              <span className="deletions">{`${popoverDeletions} deletions(-)`}</span>
            </div>
            <div className="git-commit-popover-branches">
              {gitCurrentBranch ? (
                <span className="git-branch-pill local">{gitCurrentBranch}</span>
              ) : null}
              {gitCurrentBranch ? (
                <span className="git-branch-pill remote">
                  {`origin/${gitCurrentBranch}`}
                </span>
              ) : null}
            </div>
            <div className="git-commit-popover-sha">
              <span className="codicon codicon-git-commit" />
              <code>{commitPopover.commit.sha}</code>
            </div>
          </div>
        </div>
      ) : null}

      {gitBranchPickerOpen && !isWide ? (
        <div className="git-branch-sheet-backdrop" onClick={() => setGitBranchPickerOpen(false)}>
          <div
            className="git-branch-sheet"
            onClick={event => event.stopPropagation()}
          >
            <div className="git-branch-sheet-header">
              <span>Select Branches</span>
              <button
                type="button"
                className="git-section-btn"
                onClick={() => setGitBranchPickerOpen(false)}
                aria-label="Close branch selector"
              >
                <span className="codicon codicon-close" />
              </button>
            </div>
            <div className="git-branch-sheet-body">
              {branchOptions.length === 0 ? (
                <div className="git-branch-picker-empty">No branches</div>
              ) : (
                branchOptions.map(branch => {
                  const selected = gitSelectedBranches.includes(branch);
                  return (
                    <button
                      key={`sheet:${branch}`}
                      type="button"
                      className={`git-branch-picker-item ${
                        selected ? 'selected' : ''
                      }`}
                      onClick={() => toggleGitBranchSelection(branch)}
                    >
                      <span className="git-branch-picker-check" aria-hidden="true">
                        {selected ? '✓' : ''}
                      </span>
                      <span className="git-branch-picker-name">{branch}</span>
                      {branch === gitCurrentBranch ? (
                        <span className="git-branch-picker-current">current</span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
