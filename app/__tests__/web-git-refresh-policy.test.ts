import {resolveGitRefreshForSync} from '../web/src/git/gitRefreshPolicy';

describe('git refresh policy', () => {
  test('invalidates cached git view without loading refs and log while outside Git tab', () => {
    const plan = resolveGitRefreshForSync({
      activeTab: 'chat',
      staleDomains: ['worktree'],
      gitRev: 'git-2',
      worktreeRev: 'worktree-2',
    });

    expect(plan).toEqual({
      shouldLoadGit: false,
      shouldRefreshGitStatusOnly: false,
      shouldInvalidateGitView: true,
      nextKnownGitRev: 'git-2',
      nextKnownWorktreeRev: 'worktree-2',
    });
  });

  test('refreshes only status for worktree changes when the Git tab is visible', () => {
    const plan = resolveGitRefreshForSync({
      activeTab: 'git',
      staleDomains: ['worktree'],
      gitRev: 'git-2',
      worktreeRev: 'worktree-2',
    });

    expect(plan.shouldRefreshGitStatusOnly).toBe(true);
    expect(plan.shouldLoadGit).toBe(false);
  });

  test('loads full git data when refs changed and Git tab is visible', () => {
    const plan = resolveGitRefreshForSync({
      activeTab: 'git',
      staleDomains: ['git'],
      gitRev: 'git-2',
      worktreeRev: 'worktree-2',
    });

    expect(plan.shouldLoadGit).toBe(true);
    expect(plan.shouldRefreshGitStatusOnly).toBe(false);
  });
});
