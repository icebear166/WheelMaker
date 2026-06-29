export type GitRefreshPlan = {
  shouldLoadGit: boolean;
  shouldRefreshGitStatusOnly: boolean;
  shouldInvalidateGitView: boolean;
  nextKnownGitRev: string;
  nextKnownWorktreeRev: string;
};

export function resolveGitRefreshForSync({
  activeTab,
  staleDomains,
  gitRev,
  worktreeRev,
}: {
  activeTab: string;
  staleDomains: string[];
  gitRev: string;
  worktreeRev: string;
}): GitRefreshPlan {
  const stale = new Set(staleDomains);
  const gitMetadataStale = stale.has('git') || stale.has('project');
  const worktreeStale = stale.has('worktree') || stale.has('project');
  const gitSurfaceStale = gitMetadataStale || worktreeStale;
  const gitVisible = activeTab === 'git';

  return {
    shouldLoadGit: gitVisible && gitMetadataStale,
    shouldRefreshGitStatusOnly: gitVisible && !gitMetadataStale && worktreeStale,
    shouldInvalidateGitView: gitSurfaceStale,
    nextKnownGitRev: gitRev || '',
    nextKnownWorktreeRev: worktreeRev || '',
  };
}
