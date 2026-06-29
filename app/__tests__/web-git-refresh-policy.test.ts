import {shouldLoadGitForRev} from '../web/src/git/gitRefreshPolicy';

describe('git refresh policy', () => {
  test('loads full git data on first Git tab open for a project', () => {
    const shouldLoad = shouldLoadGitForRev({
      projectId: 'hub-a:proj1',
      loadedProjectId: '',
      currentRev: {gitRev: '', worktreeRev: ''},
      nextRev: {gitRev: 'git-1', worktreeRev: 'worktree-1'},
      hasGitError: false,
    });

    expect(shouldLoad).toBe(true);
  });

  test('skips full git load when the same project rev was already loaded', () => {
    const shouldLoad = shouldLoadGitForRev({
      projectId: 'hub-a:proj1',
      loadedProjectId: 'hub-a:proj1',
      currentRev: {gitRev: 'git-1', worktreeRev: 'worktree-1'},
      nextRev: {gitRev: 'git-1', worktreeRev: 'worktree-1'},
      hasGitError: false,
    });

    expect(shouldLoad).toBe(false);
  });

  test('loads full git data when refs or worktree rev changed', () => {
    const shouldLoadForGitRev = shouldLoadGitForRev({
      projectId: 'hub-a:proj1',
      loadedProjectId: 'hub-a:proj1',
      currentRev: {gitRev: 'git-1', worktreeRev: 'worktree-1'},
      nextRev: {gitRev: 'git-2', worktreeRev: 'worktree-1'},
      hasGitError: false,
    });
    const shouldLoadForWorktreeRev = shouldLoadGitForRev({
      projectId: 'hub-a:proj1',
      loadedProjectId: 'hub-a:proj1',
      currentRev: {gitRev: 'git-1', worktreeRev: 'worktree-1'},
      nextRev: {gitRev: 'git-1', worktreeRev: 'worktree-2'},
      hasGitError: false,
    });

    expect(shouldLoadForGitRev).toBe(true);
    expect(shouldLoadForWorktreeRev).toBe(true);
  });
});
