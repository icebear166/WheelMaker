import {
  buildWorkingTreeGroups,
  gitProjectAvailable,
  mergeGitCommitPage,
  normalizeGitBranchOptions,
  revisionChange,
} from './gitBrowserModel';

test('keeps the same path in distinct worktree scopes', () => {
  const groups = buildWorkingTreeGroups({
    dirty: true,
    worktreeRev: 'w1',
    staged: [{path: 'src/a.ts', status: 'M'}],
    unstaged: [{path: 'src/a.ts', status: 'M'}],
    untracked: [{path: 'src/new.ts', status: 'U'}],
  });
  expect(groups.staged[0]).toMatchObject({path: 'src/a.ts', scope: 'staged'});
  expect(groups.unstaged[0]).toMatchObject({path: 'src/a.ts', scope: 'unstaged'});
  expect(groups.untracked[0]).toMatchObject({path: 'src/new.ts', scope: 'untracked'});
});

test('normalizes local and remote refs without losing the current branch', () => {
  expect(normalizeGitBranchOptions({
    current: 'main',
    branches: ['feature/a', 'main'],
    remoteBranches: ['origin/main'],
  })).toEqual([
    {name: 'main', kind: 'local', current: true},
    {name: 'feature/a', kind: 'local', current: false},
    {name: 'origin/main', kind: 'remote', current: false},
  ]);
});

test('classifies git and worktree revision changes independently', () => {
  expect(revisionChange(
    {gitRev: 'g1', worktreeRev: 'w1'},
    {gitRev: 'g2', worktreeRev: 'w1'},
  )).toEqual({history: true, worktree: false});
});

test('marks a short final page done and preserves unique commits', () => {
  const result = mergeGitCommitPage(
    [{sha: 'a'} as never],
    [{sha: 'a'} as never, {sha: 'b'} as never],
    50,
  );
  expect(result.commits.map(commit => commit.sha)).toEqual(['a', 'b']);
  expect(result.done).toBe(true);
  expect(result.nextCursor).toBe('3');
});

test('requires stable Git metadata before showing the entry', () => {
  expect(gitProjectAvailable({branch: '', headSha: '', dirty: false, gitRev: '', worktreeRev: ''})).toBe(false);
  expect(gitProjectAvailable({branch: 'main', headSha: 'abc', dirty: false, gitRev: 'g1', worktreeRev: 'w1'})).toBe(true);
});
