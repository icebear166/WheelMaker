import type {
  RegistryGitCommit,
  RegistryGitStatus,
  RegistryProjectGitState,
} from '../registry/registryTypes';

export const GIT_HISTORY_PAGE_SIZE = 50;

export type GitWorkingTreeScope = 'staged' | 'unstaged' | 'untracked';
export type GitWorkingTreeFile = {
  path: string;
  status: string;
  scope: GitWorkingTreeScope;
};
export type GitWorkingTreeGroups = Record<GitWorkingTreeScope, GitWorkingTreeFile[]>;
export type GitBranchOption = {
  name: string;
  kind: 'local' | 'remote';
  current: boolean;
};
export type GitRevisionPair = {gitRev: string; worktreeRev: string};

export function gitProjectAvailable(git: RegistryProjectGitState | undefined): boolean {
  return !!git && !!(git.gitRev || git.worktreeRev || git.branch || git.headSha);
}

export function buildWorkingTreeGroups(status: RegistryGitStatus): GitWorkingTreeGroups {
  const map = (scope: GitWorkingTreeScope) => (
    (status[scope] ?? [])
      .filter(item => item.path)
      .map(item => ({...item, scope}))
  );
  return {
    staged: map('staged'),
    unstaged: map('unstaged'),
    untracked: map('untracked'),
  };
}

export function normalizeGitBranchOptions(input: {
  current: string;
  branches: string[];
  remoteBranches: string[];
}): GitBranchOption[] {
  const uniqueLocal = [...new Set([input.current, ...input.branches].filter(Boolean))];
  const uniqueRemote = [...new Set(input.remoteBranches.filter(Boolean))];
  return [
    ...uniqueLocal.map(name => ({
      name,
      kind: 'local' as const,
      current: name === input.current,
    })),
    ...uniqueRemote.map(name => ({
      name,
      kind: 'remote' as const,
      current: false,
    })),
  ];
}

export function revisionChange(previous: GitRevisionPair, next: GitRevisionPair) {
  return {
    history: previous.gitRev !== next.gitRev,
    worktree: previous.worktreeRev !== next.worktreeRev,
  };
}

export function mergeGitCommitPage(
  previous: RegistryGitCommit[],
  page: RegistryGitCommit[],
  pageSize: number,
) {
  const commits = [...previous];
  const seen = new Set(commits.map(commit => commit.sha));
  for (const commit of page) {
    if (seen.has(commit.sha)) continue;
    seen.add(commit.sha);
    commits.push(commit);
  }
  return {
    commits,
    nextCursor: String(previous.length + page.length),
    done: page.length < pageSize,
  };
}
