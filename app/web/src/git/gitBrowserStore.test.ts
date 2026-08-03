import type {RegistryGitCommit, RegistryProject} from '../registry/registryTypes';
import {GitBrowserStore, type GitBrowserGateway} from './gitBrowserStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return {promise, resolve};
}

function commit(sha: string): RegistryGitCommit {
  return {sha, author: '', email: '', time: '', title: sha};
}

function project(
  projectId: string,
  overrides: Partial<RegistryProject> = {},
): RegistryProject {
  return {
    projectId,
    name: projectId,
    path: '',
    online: true,
    git: {
      branch: 'main',
      headSha: `${projectId}-head`,
      dirty: false,
      gitRev: `${projectId}-g1`,
      worktreeRev: `${projectId}-w1`,
    },
    ...overrides,
  };
}

function gateway(overrides: Partial<GitBrowserGateway> = {}): GitBrowserGateway {
  return {
    getRev: jest.fn(async () => ({gitRev: 'g1', worktreeRev: 'w1'})),
    getRefs: jest.fn(async () => ({
      current: 'main',
      branches: ['main'],
      remoteBranches: ['origin/main'],
    })),
    getLog: jest.fn(async () => []),
    getCommitFiles: jest.fn(async () => []),
    getStatus: jest.fn(async () => ({
      dirty: false,
      worktreeRev: 'w1',
      staged: [],
      unstaged: [],
      untracked: [],
    })),
    ...overrides,
  };
}

test('loads status and history independently and keeps state by project', async () => {
  const api = gateway({
    getLog: jest.fn(async projectId => [commit(`${projectId}-sha`)]),
  });
  const store = new GitBrowserStore(api);
  await store.syncProjects([project('p1'), project('p2')]);

  expect(api.getLog).not.toHaveBeenCalled();
  expect(api.getStatus).not.toHaveBeenCalled();
  await store.ensureHistory('p1');

  expect(store.project('p1').commits[0].sha).toBe('p1-sha');
  expect(store.project('p2').commits).toEqual([]);
  expect(api.getStatus).not.toHaveBeenCalled();
});

test('ignores an old branch request after selection changes', async () => {
  const first = deferred<RegistryGitCommit[]>();
  const api = gateway({
    getLog: jest.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([commit('new')]),
  });
  const store = new GitBrowserStore(api);
  await store.syncProjects([project('p1')]);

  const oldLoad = store.ensureHistory('p1');
  const newLoad = store.setSelectedRefs('p1', ['origin/main']);
  first.resolve([]);
  await Promise.all([oldLoad, newLoad]);

  expect(store.project('p1').commits.map(item => item.sha)).toEqual(['new']);
  expect(store.project('p1').selectedRefs).toEqual(['origin/main']);
});

test('refreshes only the loaded slice affected by a revision change', async () => {
  const api = gateway();
  const store = new GitBrowserStore(api);
  await store.syncProjects([project('p1')]);
  await store.ensureStatus('p1');

  await store.syncProjects([project('p1', {
    git: {
      branch: 'main',
      headSha: 'p1-head',
      dirty: true,
      gitRev: 'p1-g1',
      worktreeRev: 'p1-w2',
    },
  })]);

  expect(api.getStatus).toHaveBeenCalledTimes(2);
  expect(api.getLog).not.toHaveBeenCalled();
});

test('paginates with the raw cursor and removes duplicate commits', async () => {
  const firstPage = Array.from({length: 50}, (_, index) => commit(`sha-${index}`));
  const api = gateway({
    getLog: jest.fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([commit('sha-49'), commit('sha-50')]),
  });
  const store = new GitBrowserStore(api);
  await store.syncProjects([project('p1')]);

  await store.ensureHistory('p1');
  await store.loadMore('p1');

  expect(store.project('p1').commits).toHaveLength(51);
  expect(store.project('p1').historyCursor).toBe('52');
  expect(store.project('p1').historyDone).toBe(true);
  expect(api.getLog).toHaveBeenLastCalledWith('p1', expect.objectContaining({cursor: '50'}));
});

test('keeps the current branch selected when refs are cleared', async () => {
  const api = gateway();
  const store = new GitBrowserStore(api);
  await store.syncProjects([project('p1')]);

  await store.setSelectedRefs('p1', []);

  expect(store.project('p1').selectedRefs).toEqual(['main']);
  expect(api.getLog).toHaveBeenCalledWith('p1', expect.objectContaining({refs: ['main']}));
});

test('expands one commit at a time and reuses loaded file lists', async () => {
  const api = gateway({
    getCommitFiles: jest.fn(async (_projectId, sha) => [{
      path: `${sha}.ts`,
      status: 'M',
      additions: 1,
      deletions: 0,
    }]),
  });
  const store = new GitBrowserStore(api);
  await store.syncProjects([project('p1')]);

  await store.toggleCommit('p1', 'a');
  await store.toggleCommit('p1', 'b');
  await store.toggleCommit('p1', 'a');

  expect(store.project('p1').expandedCommitSha).toBe('a');
  expect(store.project('p1').commitFilesBySha.a[0].path).toBe('a.ts');
  expect(api.getCommitFiles).toHaveBeenCalledTimes(2);
});

test('preserves known Git state while a project is offline', async () => {
  const store = new GitBrowserStore(gateway());
  await store.syncProjects([project('p1')]);
  await store.ensureStatus('p1');

  await store.syncProjects([project('p1', {online: false, git: undefined})]);

  expect(store.project('p1')).toMatchObject({
    available: true,
    online: false,
    currentBranch: 'main',
    statusLoaded: true,
  });
});
