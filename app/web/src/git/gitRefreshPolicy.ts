export type GitRevSnapshot = {
  gitRev: string;
  worktreeRev: string;
};

export function sameGitRev(left: GitRevSnapshot, right: GitRevSnapshot): boolean {
  return left.gitRev === right.gitRev && left.worktreeRev === right.worktreeRev;
}

export function shouldLoadGitForRev({
  projectId,
  loadedProjectId,
  currentRev,
  nextRev,
  hasGitError,
}: {
  projectId: string;
  loadedProjectId: string;
  currentRev: GitRevSnapshot;
  nextRev: GitRevSnapshot;
  hasGitError: boolean;
}): boolean {
  if (!projectId) {
    return false;
  }
  if (loadedProjectId !== projectId) {
    return true;
  }
  if (hasGitError) {
    return true;
  }
  return !sameGitRev(currentRev, nextRev);
}
