# Read-Only Git Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-scoped, read-only Git browser with Preview history and Diff tabs plus a desktop working-tree card above Monitor.

**Architecture:** Keep all Git requests behind explicit project-scoped `RegistryWorkspaceService` methods and a shared `GitBrowserStore` whose snapshots are keyed by `projectId`. Extend Preview Workbench with a mutually exclusive Files/Git drawer mode and a persisted `git-diff` tab, while extracting Prompt Done's Diff body into one reusable renderer. Render Git history and desktop status as focused components; `WorkspaceApp` only wires project snapshots, store actions, Preview tabs, and the existing edge-surface stack.

**Tech Stack:** React 19, TypeScript 5.8, Jest 30, react-test-renderer, existing Registry `project.git.*` methods, Shiki, `gitdiff-parser`, webpack.

---

## File structure

- Create `app/web/src/git/gitBrowserModel.ts` for Git availability, branch normalization, working-tree grouping, pagination, revision classification, and display formatting.
- Create `app/web/src/git/gitBrowserModel.test.ts` for pure model behavior.
- Create `app/web/src/git/gitBrowserStore.ts` for project-keyed async Git state, lazy loads, request generations, stale-data preservation, and revision-driven refresh.
- Create `app/web/src/git/gitBrowserStore.test.ts` for project isolation, pagination races, selective revision invalidation, and retry behavior.
- Create `app/web/src/git/GitHistoryPanel.tsx` and `GitHistoryPanel.test.tsx` for branch selection, Working Tree, commit expansion/details, file activation, and load-more states.
- Create `app/web/src/git/GitStatusSurface.tsx` and `GitStatusSurface.test.tsx` for the desktop card above Monitor.
- Create `app/web/src/preview/UnifiedDiffPreview.tsx` and `UnifiedDiffPreview.test.tsx` for the shared Prompt/Git Diff body.
- Create `app/web/src/code/codeLanguage.ts` and `codeLanguage.test.ts` to move path-to-Shiki-language resolution out of `WorkspaceApp.tsx`.
- Create `app/web/src/styles/git.css` for Git history, status card, and Git-specific Diff banners.
- Create `app/__tests__/web-git-browser-service.test.ts` for Registry pagination/request payloads and the explicit project-scoped service boundary.
- Create `app/__tests__/web-git-browser-workspace.test.tsx` for the end-to-end source/rendering boundary in `WorkspaceApp`.
- Modify `app/web/src/registry/RegistryWorkspaceService.ts` to expose explicit project-scoped Git reads while keeping selected-project compatibility wrappers.
- Modify `app/web/src/preview/previewWorkbenchState.ts` and `app/__tests__/web-preview-workbench-state.test.ts` for `git-diff` tabs and `closed/files/git` drawer state.
- Modify `app/web/src/preview/PreviewWorkbenchChrome.tsx` and `app/__tests__/web-chat-file-peek-viewer.test.ts` for sibling Files/Git buttons and one shared drawer.
- Modify `app/web/src/app/WorkspaceApp.tsx` for store subscription, project revision ingestion, Git Diff loading, and component wiring.
- Modify `app/web/src/styles/index.css`, `file.css`, and `chat.css` only where shared Preview/edge-surface geometry must recognize the new UI.
- Modify `app/__tests__/web-workspace-tab-removal.test.ts`, `web-ui-design-system.test.ts`, `web-main-surface-boundary.test.ts`, and `web-git-diff-startup-boundary.test.ts` so they continue banning the retired top-level Git page while allowing the new browser modules.

### Task 1: Add project-scoped Registry Git reads and pure Git browser rules

**Files:**
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Create: `app/__tests__/web-git-browser-service.test.ts`
- Create: `app/web/src/git/gitBrowserModel.ts`
- Create: `app/web/src/git/gitBrowserModel.test.ts`

- [x] **Step 1: Write failing Registry and model tests**

```ts
// app/__tests__/web-git-browser-service.test.ts
import fs from 'fs';
import path from 'path';
import {RegistryRepository} from '../web/src/registry/RegistryRepository';

test('git log forwards project, refs, cursor, and limit', async () => {
  const request = jest.fn(async () => ({payload: {commits: [{sha: 'abc'}]}}));
  const repository = new RegistryRepository({request} as never);

  await expect(repository.gitLog('p2', 'HEAD', '50', 50, ['main', 'origin/main']))
    .resolves.toEqual([{sha: 'abc'}]);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    method: 'project.git.log',
    projectId: 'p2',
    payload: {ref: 'HEAD', refs: ['main', 'origin/main'], cursor: '50', limit: 50},
  }));
});

test('workspace service exposes explicit project-scoped git methods', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../web/src/registry/RegistryWorkspaceService.ts'),
    'utf8',
  );
  expect(source).toContain('async listProjectGitCommits(');
  expect(source).toContain('async listProjectGitBranches(');
  expect(source).toContain('async getProjectGitStatus(');
  expect(source).toContain('async readProjectWorkingTreeFileDiff(');
});
```

```ts
// app/web/src/git/gitBrowserModel.test.ts
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
```

- [x] **Step 2: Run the focused tests and confirm the new API/model are missing**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-git-browser-service.test.ts web/src/git/gitBrowserModel.test.ts
```

Expected: FAIL because `gitBrowserModel.ts` and the explicit project-scoped service methods do not exist.

- [x] **Step 3: Implement project-scoped service methods and model types**

Add these option and wrapper signatures to `RegistryWorkspaceService.ts`; compatibility methods must delegate to them rather than duplicate request logic:

```ts
export type ProjectGitLogOptions = {
  ref?: string;
  refs?: string[];
  cursor?: string;
  limit?: number;
};

async listProjectGitCommits(
  projectId: string,
  options: ProjectGitLogOptions = {},
): Promise<RegistryGitCommit[]> {
  if (!this.repository || !projectId) return [];
  return this.repository.gitLog(
    projectId,
    options.ref ?? 'HEAD',
    options.cursor ?? '',
    options.limit ?? 50,
    options.refs ?? [],
  );
}

async getProjectGitRev(projectId: string): Promise<RegistryGitRev> {
  if (!this.repository || !projectId) return {gitRev: '', worktreeRev: ''};
  return this.repository.gitRev(projectId);
}

async listProjectGitBranches(projectId: string) {
  if (!this.repository || !projectId) {
    return {current: '', branches: [], remoteBranches: []};
  }
  return this.repository.gitBranches(projectId);
}

async listProjectGitCommitFiles(projectId: string, sha: string): Promise<RegistryGitCommitFile[]> {
  if (!this.repository || !projectId) return [];
  return this.repository.gitCommitFiles(projectId, sha);
}

async readProjectGitFileDiff(projectId: string, sha: string, path: string): Promise<RegistryGitFileDiff> {
  if (!this.repository || !projectId) {
    return {sha, path, isBinary: false, diff: '', truncated: false};
  }
  return this.repository.gitCommitFileDiff(projectId, sha, path, 3);
}

async getProjectGitStatus(projectId: string): Promise<RegistryGitStatus> {
  if (!this.repository || !projectId) {
    return {dirty: false, worktreeRev: '', staged: [], unstaged: [], untracked: []};
  }
  return this.repository.gitStatus(projectId);
}

async readProjectWorkingTreeFileDiff(
  projectId: string,
  path: string,
  scope: 'staged' | 'unstaged' | 'untracked',
): Promise<RegistryWorkingTreeFileDiff> {
  if (!this.repository || !projectId) {
    return {path, scope, isBinary: false, diff: '', truncated: false};
  }
  return this.repository.gitWorkingTreeFileDiff(projectId, path, scope, 3);
}
```

Implement the pure model with these exported contracts:

```ts
// app/web/src/git/gitBrowserModel.ts
import type {
  RegistryGitCommit,
  RegistryGitStatus,
  RegistryProjectGitState,
} from '../registry/registryTypes';

export const GIT_HISTORY_PAGE_SIZE = 50;
export type GitWorkingTreeScope = 'staged' | 'unstaged' | 'untracked';
export type GitWorkingTreeFile = {path: string; status: string; scope: GitWorkingTreeScope};
export type GitWorkingTreeGroups = Record<GitWorkingTreeScope, GitWorkingTreeFile[]>;
export type GitBranchOption = {name: string; kind: 'local' | 'remote'; current: boolean};
export type GitRevisionPair = {gitRev: string; worktreeRev: string};

export function gitProjectAvailable(git: RegistryProjectGitState | undefined): boolean {
  return !!git && !!(git.gitRev || git.worktreeRev || git.branch || git.headSha);
}

export function buildWorkingTreeGroups(status: RegistryGitStatus): GitWorkingTreeGroups {
  const map = (scope: GitWorkingTreeScope) =>
    (status[scope] ?? []).filter(item => item.path).map(item => ({...item, scope}));
  return {staged: map('staged'), unstaged: map('unstaged'), untracked: map('untracked')};
}

export function normalizeGitBranchOptions(input: {
  current: string;
  branches: string[];
  remoteBranches: string[];
}): GitBranchOption[] {
  const local = [input.current, ...input.branches].filter(Boolean);
  const uniqueLocal = [...new Set(local)];
  const uniqueRemote = [...new Set(input.remoteBranches.filter(Boolean))];
  return [
    ...uniqueLocal.map(name => ({name, kind: 'local' as const, current: name === input.current})),
    ...uniqueRemote.map(name => ({name, kind: 'remote' as const, current: false})),
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
    if (!seen.has(commit.sha)) {
      seen.add(commit.sha);
      commits.push(commit);
    }
  }
  return {
    commits,
    nextCursor: String(previous.length + page.length),
    done: page.length < pageSize,
  };
}
```

- [x] **Step 4: Run the focused tests**

Run the Step 2 command. Expected: PASS.

- [x] **Step 5: Commit the service/model slice**

```powershell
git add app/web/src/registry/RegistryWorkspaceService.ts app/web/src/git/gitBrowserModel.ts app/web/src/git/gitBrowserModel.test.ts app/__tests__/web-git-browser-service.test.ts docs/scope/2026-08-03-git-browser docs/wiki/features
git commit -m "feat(git): add project-scoped browser model"
```

### Task 2: Build the shared project-keyed GitBrowserStore

**Files:**
- Create: `app/web/src/git/gitBrowserStore.ts`
- Create: `app/web/src/git/gitBrowserStore.test.ts`

- [x] **Step 1: Write failing store tests for lazy loading, paging, races, and revisions**

```ts
import {GitBrowserStore, type GitBrowserGateway} from './gitBrowserStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return {promise, resolve};
}

function gateway(overrides: Partial<GitBrowserGateway> = {}): GitBrowserGateway {
  return {
    getRev: jest.fn(async () => ({gitRev: 'g1', worktreeRev: 'w1'})),
    getRefs: jest.fn(async () => ({current: 'main', branches: ['main'], remoteBranches: ['origin/main']})),
    getLog: jest.fn(async () => []),
    getCommitFiles: jest.fn(async () => []),
    getStatus: jest.fn(async () => ({dirty: false, worktreeRev: 'w1', staged: [], unstaged: [], untracked: []})),
    ...overrides,
  };
}

test('loads status and history independently and keeps state by project', async () => {
  const api = gateway({
    getLog: jest.fn(async projectId => [{sha: `${projectId}-sha`, author: '', email: '', time: '', title: ''}]),
  });
  const store = new GitBrowserStore(api);
  await store.syncProjects([
    {projectId: 'p1', name: 'One', path: '', online: true, git: {branch: 'main', headSha: '1', dirty: false, gitRev: 'g1', worktreeRev: 'w1'}},
    {projectId: 'p2', name: 'Two', path: '', online: true, git: {branch: 'main', headSha: '2', dirty: false, gitRev: 'g2', worktreeRev: 'w2'}},
  ]);
  await store.ensureHistory('p1');
  expect(store.project('p1').commits[0].sha).toBe('p1-sha');
  expect(store.project('p2').commits).toEqual([]);
});

test('ignores an old branch request after selection changes', async () => {
  const first = deferred<never[]>();
  const api = gateway({getLog: jest.fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce([{sha: 'new', author: '', email: '', time: '', title: ''}])});
  const store = new GitBrowserStore(api);
  await store.syncProjects([{projectId: 'p1', name: 'One', path: '', online: true, git: {branch: 'main', headSha: '1', dirty: false, gitRev: 'g1', worktreeRev: 'w1'}}]);
  const oldLoad = store.ensureHistory('p1');
  const newLoad = store.setSelectedRefs('p1', ['origin/main']);
  first.resolve([]);
  await Promise.all([oldLoad, newLoad]);
  expect(store.project('p1').commits.map(item => item.sha)).toEqual(['new']);
});

test('refreshes only the loaded slice affected by a revision change', async () => {
  const api = gateway();
  const store = new GitBrowserStore(api);
  await store.syncProjects([{projectId: 'p1', name: 'One', path: '', online: true, git: {branch: 'main', headSha: '1', dirty: false, gitRev: 'g1', worktreeRev: 'w1'}}]);
  await store.ensureStatus('p1');
  await store.syncProjects([{projectId: 'p1', name: 'One', path: '', online: true, git: {branch: 'main', headSha: '1', dirty: true, gitRev: 'g1', worktreeRev: 'w2'}}]);
  expect(api.getStatus).toHaveBeenCalledTimes(2);
  expect(api.getLog).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run the store test and confirm it fails**

```powershell
npm --prefix app test -- --runInBand web/src/git/gitBrowserStore.test.ts
```

Expected: FAIL because `GitBrowserStore` does not exist.

- [x] **Step 3: Implement the store public contract and request-generation guards**

The production file must export this exact gateway and snapshot surface so later tasks do not invent parallel state:

```ts
export type GitBrowserGateway = {
  getRev(projectId: string): Promise<RegistryGitRev>;
  getRefs(projectId: string): Promise<{current: string; branches: string[]; remoteBranches: string[]}>;
  getLog(projectId: string, options: ProjectGitLogOptions): Promise<RegistryGitCommit[]>;
  getCommitFiles(projectId: string, sha: string): Promise<RegistryGitCommitFile[]>;
  getStatus(projectId: string): Promise<RegistryGitStatus>;
};

export type GitBrowserProjectSnapshot = {
  projectId: string;
  available: boolean;
  online: boolean;
  currentBranch: string;
  headSha: string;
  branches: GitBranchOption[];
  selectedRefs: string[];
  commits: RegistryGitCommit[];
  commitFilesBySha: Record<string, RegistryGitCommitFile[]>;
  expandedCommitSha: string;
  worktree: GitWorkingTreeGroups;
  gitRev: string;
  worktreeRev: string;
  refsLoaded: boolean;
  historyLoaded: boolean;
  statusLoaded: boolean;
  historyDone: boolean;
  historyCursor: string;
  historyLoading: boolean;
  historyMoreLoading: boolean;
  statusLoading: boolean;
  commitFilesLoadingSha: string;
  historyError: string;
  statusError: string;
  commitFilesError: string;
};
```

Implement `subscribe`, `snapshot`, `project`, `syncProjects`, `ensureStatus`, `ensureHistory`, `loadMore`, `setSelectedRefs`, `toggleCommit`, and `refresh`. `syncProjects(projects)` returns `Promise<void>` for the automatic refresh work it starts, so UI callers can fire-and-forget while tests and integration points can await real product behavior. Use a monotonically increasing generation per `{projectId, operation}`; every async completion must verify its generation before writing. `syncProjects` must:

```ts
const reportedAvailable = gitProjectAvailable(project.git);
const nextRevision = reportedAvailable
  ? {gitRev: project.git?.gitRev ?? '', worktreeRev: project.git?.worktreeRev ?? ''}
  : {gitRev: existing.gitRev, worktreeRev: existing.worktreeRev};
const changes = revisionChange(
  {gitRev: existing.gitRev, worktreeRev: existing.worktreeRev},
  nextRevision,
);
next.available = project.online ? reportedAvailable : existing.available || reportedAvailable;
next.online = project.online;
next.currentBranch = reportedAvailable ? project.git?.branch ?? '' : next.currentBranch;
next.headSha = reportedAvailable ? project.git?.headSha ?? '' : next.headSha;
next.gitRev = nextRevision.gitRev;
next.worktreeRev = nextRevision.worktreeRev;
if (project.online && changes.history && existing.historyLoaded) void this.reloadHistory(project.projectId);
if (project.online && changes.worktree && existing.statusLoaded) void this.reloadStatus(project.projectId);
```

`setSelectedRefs` must never allow an empty selection when `currentBranch` exists, reset commits/cursor/done, increment the history generation, and call `ensureHistory`. `toggleCommit` must use one expanded SHA at a time and load files only if that SHA has no cache entry. Errors must leave existing commits/status/files in place and populate the matching error field.

- [x] **Step 4: Run store and model tests**

```powershell
npm --prefix app test -- --runInBand web/src/git/gitBrowserModel.test.ts web/src/git/gitBrowserStore.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit the store slice**

```powershell
git add app/web/src/git/gitBrowserStore.ts app/web/src/git/gitBrowserStore.test.ts
git commit -m "feat(git): add shared browser store"
```

### Task 3: Extend Preview state with drawer modes and persisted Git Diff tabs

**Files:**
- Modify: `app/web/src/preview/previewWorkbenchState.ts`
- Modify: `app/__tests__/web-preview-workbench-state.test.ts`

- [x] **Step 1: Add failing state tests**

```ts
test('creates stable commit and worktree git diff tab ids', () => {
  expect(previewTabId({type: 'git-diff', source: {kind: 'commit', sha: 'abc', path: 'src/a.ts'}}))
    .toBe('git-diff:commit:abc:src/a.ts');
  expect(previewTabId({type: 'git-diff', source: {kind: 'worktree', scope: 'staged', path: 'src/a.ts'}}))
    .toBe('git-diff:worktree:staged:src/a.ts');
});

test('round trips git diff descriptors without persisting content', () => {
  const state = openPreviewTab(createPreviewWorkbenchState('p1'), {
    type: 'git-diff',
    projectId: 'p1',
    title: 'a.ts',
    source: {kind: 'commit', sha: 'abc', path: 'src/a.ts'},
    file: {path: 'src/a.ts', status: 'M', additions: 2, deletions: 1},
  });
  const snapshot = previewWorkbenchSnapshotFromState({...state, drawerMode: 'git'});
  expect(JSON.stringify(snapshot)).not.toContain('diff --git');
  expect(previewWorkbenchStateFromSnapshot(snapshot)).toMatchObject({drawerMode: 'git'});
  expect(activePreviewTab(previewWorkbenchStateFromSnapshot(snapshot))).toMatchObject({
    type: 'git-diff',
    source: {kind: 'commit', sha: 'abc', path: 'src/a.ts'},
  });
});

test('migrates the legacy treeOpen snapshot to the files drawer', () => {
  const restored = previewWorkbenchStateFromSnapshot({
    version: 1,
    activeProjectId: '',
    tabsByProjectId: {},
    activeTabIdByProjectId: {},
    renderedTabIdsByProjectId: {},
    treeOpen: true,
  });
  expect(restored.drawerMode).toBe('files');
});
```

- [x] **Step 2: Run the Preview state test and confirm it fails**

```powershell
npm --prefix app test -- --runInBand __tests__/web-preview-workbench-state.test.ts
```

Expected: FAIL on the missing `git-diff` union member and `drawerMode`.

- [x] **Step 3: Add the exact state contracts and backward-compatible snapshot mapping**

```ts
export type PreviewWorkbenchDrawerMode = 'closed' | 'files' | 'git';
export type GitDiffSource =
  | {kind: 'commit'; sha: string; path: string}
  | {kind: 'worktree'; scope: GitWorkingTreeScope; path: string};

export type GitDiffFileMeta = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
};

export type GitDiffPreviewFile = GitDiffFileMeta & {
  diff: string;
  expanded: boolean;
  isBinary: boolean;
  truncated: boolean;
};

export type GitDiffPreviewTab = PreviewWorkbenchTabBase & {
  type: 'git-diff';
  source: GitDiffSource;
  file: GitDiffPreviewFile;
  loadedWorktreeRev: string;
};
```

Replace runtime `treeOpen` with `drawerMode`. Keep `treeOpen?: boolean` only on the snapshot type for version-1 migration. Serialize `drawerMode`, source, file metadata, and `loadedWorktreeRev: ''`; never serialize `file.diff`. Extend `previewTabId`, input validation, `createTab`, `mergeTab`, tooltip/title, desktop path, search matches/document key, snapshot restore, and the `isGitDiffPreviewTab` type guard.

For legacy restore, use:

```ts
const drawerMode: PreviewWorkbenchDrawerMode =
  snapshot.drawerMode === 'files' || snapshot.drawerMode === 'git'
    ? snapshot.drawerMode
    : snapshot.treeOpen === true
      ? 'files'
      : 'closed';
```

- [x] **Step 4: Run state tests**

Run the Step 2 command. Expected: PASS, including legacy snapshot coverage.

- [x] **Step 5: Commit the Preview state slice**

```powershell
git add app/web/src/preview/previewWorkbenchState.ts app/__tests__/web-preview-workbench-state.test.ts
git commit -m "feat(preview): persist git diff tabs"
```

### Task 4: Extract one reusable unified Diff renderer

**Files:**
- Create: `app/web/src/code/codeLanguage.ts`
- Create: `app/web/src/code/codeLanguage.test.ts`
- Create: `app/web/src/preview/UnifiedDiffPreview.tsx`
- Create: `app/web/src/preview/UnifiedDiffPreview.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/__tests__/web-git-diff-startup-boundary.test.ts`

- [x] **Step 1: Write failing extraction/component tests**

```ts
// app/web/src/code/codeLanguage.test.ts
import {detectCodeLanguage} from './codeLanguage';

test.each([
  ['src/a.ts', 'typescript'],
  ['src/a.tsx', 'tsx'],
  ['script.ps1', 'powershell'],
  ['README.md', 'markdown'],
  ['unknown.bin', 'clike'],
])('maps %s to %s', (path, language) => {
  expect(detectCodeLanguage(path)).toBe(language);
});
```

```tsx
// app/web/src/preview/UnifiedDiffPreview.test.tsx
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {UnifiedDiffPreview} from './UnifiedDiffPreview';

test('renders binary and truncated states without losing file metadata', () => {
  const view = TestRenderer.create(
    <UnifiedDiffPreview
      files={[{
        path: 'asset.bin', status: 'M', additions: 0, deletions: 0,
        diff: '', expanded: true, isBinary: true, truncated: true,
      }]}
      activeFilePath="asset.bin"
      loading={false}
      error=""
      overviewLabel="1 changed file"
      onToggleFile={() => undefined}
      themeMode="dark"
      codeTheme="auto-plus"
      codeFont="jetbrains-mono"
      codeFontFamily="JetBrains Mono"
      codeFontSize={13}
      codeLineHeight={1.5}
      codeTabSize={2}
    />,
  );
  const text = JSON.stringify(view.toJSON());
  expect(text).toContain('Binary diff is not rendered');
  expect(text).toContain('Diff was truncated');
});
```

- [x] **Step 2: Run the new and existing Diff tests and confirm failure**

```powershell
npm --prefix app test -- --runInBand web/src/code/codeLanguage.test.ts web/src/preview/UnifiedDiffPreview.test.tsx __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-git-diff-startup-boundary.test.ts
```

Expected: FAIL because the extracted modules do not exist and Prompt Diff still renders inline in `WorkspaceApp.tsx`.

- [x] **Step 3: Move language detection and implement the shared renderer**

Move the complete existing extension switch from `WorkspaceApp.tsx` to:

```ts
// app/web/src/code/codeLanguage.ts
export function detectCodeLanguage(path: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  const ext = match ? match[1].toLowerCase() : '';
  switch (ext) {
    case 'ts': return 'typescript';
    case 'tsx': return 'tsx';
    case 'js':
    case 'cjs':
    case 'mjs': return 'javascript';
    case 'jsx': return 'jsx';
    case 'json': return 'json';
    case 'go': return 'go';
    case 'c': return 'c';
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'h':
    case 'hh':
    case 'hpp': return 'cpp';
    case 'rs': return 'rust';
    case 'lua': return 'lua';
    case 'hlsl':
    case 'fx':
    case 'fxh': return 'hlsl';
    case 'glsl':
    case 'vert':
    case 'frag':
    case 'geom':
    case 'comp': return 'glsl';
    case 'sh':
    case 'bash': return 'shellscript';
    case 'ps1':
    case 'psm1': return 'powershell';
    case 'py': return 'python';
    case 'yml':
    case 'yaml': return 'yaml';
    case 'md':
    case 'markdown': return 'markdown';
    case 'diff':
    case 'patch': return 'diff';
    case 'html': return 'markup';
    default: return 'clike';
  }
}
```

`UnifiedDiffPreview` must accept `files`, `activeFilePath`, load/error labels, `onToggleFile`, and the existing Shiki theme/font props. Move the complete `.chat-prompt-diff-*` markup into this component, add binary/truncated notices before the `ShikiDiffPane`, and keep `wrap={false}` plus `lineNumbers={true}`. Change `ChatPromptArtifactPreviewViewer` to only adapt its `PromptDiffPreviewFile[]` into `UnifiedDiffPreview`; do not duplicate file-row markup.

- [x] **Step 4: Run the focused tests**

Run the Step 2 command. Expected: PASS. Confirm the startup-boundary test still finds the dynamic import of `../git/diffRows` only in `ShikiCodeBlock.tsx`.

- [x] **Step 5: Commit the shared renderer**

```powershell
git add app/web/src/code/codeLanguage.ts app/web/src/code/codeLanguage.test.ts app/web/src/preview/UnifiedDiffPreview.tsx app/web/src/preview/UnifiedDiffPreview.test.tsx app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-file-peek-viewer.test.ts app/__tests__/web-git-diff-startup-boundary.test.ts
git commit -m "refactor(preview): share unified diff rendering"
```

### Task 5: Generalize Preview Chrome to sibling Files and Git drawers

**Files:**
- Modify: `app/web/src/preview/PreviewWorkbenchChrome.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/file.css`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [x] **Step 1: Add failing Chrome boundary tests**

Add assertions that `PreviewWorkbenchChrome` receives `drawerMode`, `fileDrawer`, `gitDrawer`, and `onDrawerModeChange`; renders `Toggle files` and `Toggle Git history` buttons together; uses one shared panel ref; closes the active drawer on outside pointer/Escape; and exposes the file drawer even when the active tab is Prompt Diff or attachment.

```ts
expect(chromeTsx).toContain("drawerMode: PreviewWorkbenchDrawerMode;");
expect(chromeTsx).toContain('aria-label="Toggle files"');
expect(chromeTsx).toContain('aria-label="Toggle Git history"');
expect(chromeTsx).toContain("onDrawerModeChange(drawerMode === 'git' ? 'closed' : 'git')");
expect(mainTsx).toContain('fileDrawer={chatFilePreviewTreeContent}');
expect(mainTsx).not.toContain("!activeWorkbenchTab || activeWorkbenchTab.type === 'file'");
```

- [x] **Step 2: Run the Preview Chrome test and confirm failure**

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-file-peek-viewer.test.ts
```

Expected: FAIL because Chrome still has a boolean file-tree API.

- [x] **Step 3: Replace the boolean tree API with one drawer API**

Use this prop contract:

```ts
type PreviewWorkbenchChromeProps = {
  mode: PreviewWorkbenchChromeMode;
  activeTab: PreviewWorkbenchTab | null;
  tabs: PreviewWorkbenchTab[];
  drawerMode: PreviewWorkbenchDrawerMode;
  fileDrawer: React.ReactNode;
  fileDrawerSearch?: React.ReactNode;
  gitDrawer: React.ReactNode;
  onDrawerModeChange: (mode: PreviewWorkbenchDrawerMode) => void;
  actions?: React.ReactNode;
  actionsMenuOpen: boolean;
  onClose: () => void;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onActionsMenuToggle: () => void;
  onActionsMenuClose: () => void;
  onWorkbenchKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  onSearch?: () => void;
  searchActive?: boolean;
  searchDisabled?: boolean;
  onMobilePortRelayRefresh?: () => void;
  mobileFullscreen?: boolean;
  onMobileFullscreenChange?: (fullscreen: boolean) => void;
  children: React.ReactNode;
};
```

Render both buttons in `.preview-workbench-body-tools` when their content exists. Render `fileDrawerSearch` only for `drawerMode === 'files'`. Put either drawer body into one `.preview-workbench-drawer-panel`, so outside-click and Escape logic need one panel ref. Update all `WorkspaceApp` setters to write `drawerMode`; opening Files/Git must be mutually exclusive. Root directory loading depends on `drawerMode === 'files'`; Git loading will be added in Task 8.

- [x] **Step 4: Update shared drawer geometry without Git-specific styling**

Rename only the generic selectors in `file.css`:

```css
.preview-workbench-drawer-panel {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 9;
  width: min(360px, calc(100% - 56px));
  min-width: 0;
  overflow: hidden;
}

.preview-workbench-surface.mobile .preview-workbench-drawer-panel {
  width: min(88vw, 360px);
}
```

Keep `.preview-workbench-file-tree-content` for Files-only content. Make the two FABs a vertical two-button rail with the existing dimensions, focus ring, hover, active state, and mobile safe-area offsets.

- [x] **Step 5: Run Preview and state regressions**

```powershell
npm --prefix app test -- --runInBand __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-preview-workbench-state.test.ts __tests__/web-preview-file-regressions.test.tsx
```

Expected: PASS.

- [x] **Step 6: Commit the generic drawer**

```powershell
git add app/web/src/preview/PreviewWorkbenchChrome.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/file.css app/__tests__/web-chat-file-peek-viewer.test.ts
git commit -m "feat(preview): add files and git drawers"
```

### Task 6: Build the Git history drawer

**Files:**
- Create: `app/web/src/git/GitHistoryPanel.tsx`
- Create: `app/web/src/git/GitHistoryPanel.test.tsx`
- Create: `app/web/src/styles/git.css`
- Modify: `app/web/src/styles/index.css`
- Modify: `app/__tests__/web-ui-design-system.test.ts`

- [x] **Step 1: Write failing component tests for the complete interaction**

```tsx
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {GitHistoryPanel} from './GitHistoryPanel';
import type {GitBrowserProjectSnapshot} from './gitBrowserStore';

test('selects refs, expands commit details, opens files, and loads more', () => {
  const onSelectedRefsChange = jest.fn();
  const onToggleCommit = jest.fn();
  const onFileOpen = jest.fn();
  const onLoadMore = jest.fn();
  const snapshot = {
    projectId: 'p1', available: true, online: true,
    currentBranch: 'main', headSha: 'abc',
    branches: [
      {name: 'main', kind: 'local', current: true},
      {name: 'origin/main', kind: 'remote', current: false},
    ],
    selectedRefs: ['main'],
    commits: [{sha: 'abc', author: 'Ada', email: 'ada@example.com', time: '2026-08-03T10:00:00Z', title: 'Ship Git'}],
    commitFilesBySha: {abc: [{path: 'src/a.ts', status: 'M', additions: 2, deletions: 1}]},
    expandedCommitSha: 'abc',
    worktree: {staged: [], unstaged: [], untracked: []},
    gitRev: 'g1', worktreeRev: 'w1', refsLoaded: true, historyLoaded: true, statusLoaded: true,
    historyDone: false, historyCursor: '50', historyLoading: false, historyMoreLoading: false,
    statusLoading: false, commitFilesLoadingSha: '', historyError: '', statusError: '', commitFilesError: '',
  } satisfies GitBrowserProjectSnapshot;
  const view = TestRenderer.create(
    <GitHistoryPanel
      snapshot={snapshot}
      onSelectedRefsChange={onSelectedRefsChange}
      onToggleCommit={onToggleCommit}
      onFileOpen={onFileOpen}
      onRefresh={() => undefined}
      onLoadMore={onLoadMore}
      onRetry={() => undefined}
    />,
  );
  const root = view.root;
  expect(root.findByProps({'aria-label': 'Git branches'})).toBeTruthy();
  expect(JSON.stringify(view.toJSON())).toContain('Ada');
  expect(JSON.stringify(view.toJSON())).toContain('ada@example.com');
  act(() => root.findByProps({'aria-label': 'Open src/a.ts diff'}).props.onClick());
  expect(onFileOpen).toHaveBeenCalledWith({kind: 'commit', sha: 'abc', path: 'src/a.ts'}, expect.objectContaining({path: 'src/a.ts'}));
  act(() => root.findByProps({'aria-label': 'Load more commits'}).props.onClick());
  expect(onLoadMore).toHaveBeenCalled();
});
```

Add separate cases for Working Tree scope rows, no changes, no commits, initial loading, stale data plus error, offline disabled controls, current HEAD label, binary/truncated status being deferred to the Diff tab, and `historyDone` hiding Load more.

- [x] **Step 2: Run the history component test and confirm failure**

```powershell
npm --prefix app test -- --runInBand web/src/git/GitHistoryPanel.test.tsx
```

Expected: FAIL because the component and stylesheet do not exist.

- [x] **Step 3: Implement accessible branch, worktree, and commit sections**

The component props must remain UI-only:

```ts
type GitHistoryPanelProps = {
  snapshot: GitBrowserProjectSnapshot;
  onSelectedRefsChange: (refs: string[]) => void;
  onToggleCommit: (sha: string) => void;
  onFileOpen: (
    source: GitDiffSource,
    file: {path: string; status: string; additions: number; deletions: number},
  ) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
};
```

Use an accessible popover/menu for multi-select refs; toggling the last selected ref must fall back to `currentBranch`. Put Working Tree first and group files by scope; adapt status-only rows to `GitDiffFileMeta` with `additions: 0` and `deletions: 0`. Commit row activation calls `onToggleCommit`; the expanded body renders author/email, absolute and relative time, full SHA, a current-HEAD label only when `commit.sha === snapshot.headSha`, the active ref filters as query context, computed file/addition/deletion totals, and file buttons. Do not infer other ref tips. Keep one expanded commit through `snapshot.expandedCommitSha`.

- [x] **Step 4: Add intentional Git visual styling**

Create `git.css`, import it after `file.css`, and use existing tokens only. The panel should read as a compact repository timeline: a single hairline lane, 6px commit nodes, restrained ref pills, 28px toolbar controls, filename-first rows with muted parent paths, green/red numeric stats, and 36px minimum touch targets on mobile. Do not restore the deleted top-level `.git-sidebar`, `.git-surface`, or old popover geometry.

- [x] **Step 5: Run history, design-system, and mobile boundary tests**

```powershell
npm --prefix app test -- --runInBand web/src/git/GitHistoryPanel.test.tsx __tests__/web-ui-design-system.test.ts __tests__/web-mobile-floating-nav.test.tsx
```

Expected: PASS; mobile Floating Nav IDs remain unchanged.

- [x] **Step 6: Commit the history UI**

```powershell
git add app/web/src/git/GitHistoryPanel.tsx app/web/src/git/GitHistoryPanel.test.tsx app/web/src/styles/git.css app/web/src/styles/index.css app/__tests__/web-ui-design-system.test.ts
git commit -m "feat(git): add preview history panel"
```

### Task 7: Build the desktop Git status card above Monitor

**Files:**
- Create: `app/web/src/git/GitStatusSurface.tsx`
- Create: `app/web/src/git/GitStatusSurface.test.tsx`
- Modify: `app/web/src/styles/git.css`

- [x] **Step 1: Write failing card tests**

```tsx
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {GitStatusSurface} from './GitStatusSurface';
import type {GitBrowserProjectSnapshot} from './gitBrowserStore';

function snapshotWith(overrides: Partial<GitBrowserProjectSnapshot> = {}): GitBrowserProjectSnapshot {
  return {
    projectId: 'p1', available: true, online: true,
    currentBranch: 'main', headSha: 'abc', branches: [], selectedRefs: ['main'], commits: [],
    commitFilesBySha: {}, expandedCommitSha: '',
    worktree: {
      staged: [{path: 'src/a.ts', status: 'M', scope: 'staged'}],
      unstaged: [{path: 'src/a.ts', status: 'M', scope: 'unstaged'}],
      untracked: [],
    },
    gitRev: 'g1', worktreeRev: 'w1', refsLoaded: true, historyLoaded: false, statusLoaded: true,
    historyDone: false, historyCursor: '', historyLoading: false, historyMoreLoading: false,
    statusLoading: false, commitFilesLoadingSha: '', historyError: '', statusError: '', commitFilesError: '',
    ...overrides,
  };
}

function renderGitStatusSurface(snapshot: GitBrowserProjectSnapshot) {
  let view!: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(
      <GitStatusSurface
        snapshot={snapshot}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onFileOpen={() => undefined}
      />,
    );
  });
  return view;
}

test('defaults expanded and opens the exact worktree scope', () => {
  const onFileOpen = jest.fn();
  let view!: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(
      <GitStatusSurface
        snapshot={snapshotWith()}
        onRefresh={() => undefined}
        onRetry={() => undefined}
        onFileOpen={onFileOpen}
      />,
    );
  });
  expect(view.root.findByProps({'aria-label': 'Git'}).props.className).not.toContain('collapsed');
  const rows = view.root.findAllByProps({'aria-label': 'Open src/a.ts diff'});
  act(() => rows[1].props.onClick());
  expect(onFileOpen).toHaveBeenCalledWith(
    {kind: 'worktree', scope: 'unstaged', path: 'src/a.ts'},
    expect.objectContaining({path: 'src/a.ts'}),
  );
});

test('collapsed header keeps branch and total count visible', () => {
  const view = renderGitStatusSurface(snapshotWith({currentBranch: 'main'}));
  act(() => view.root.findByProps({'aria-label': 'Collapse Git'}).props.onClick());
  const text = JSON.stringify(view.toJSON());
  expect(text).toContain('main');
  expect(text).toContain('2 changes');
});
```

Add loading, clean worktree, stale error/retry, refresh spinner, and offline-disabled cases.

- [x] **Step 2: Run the card test and confirm failure**

```powershell
npm --prefix app test -- --runInBand web/src/git/GitStatusSurface.test.tsx
```

Expected: FAIL because the card does not exist.

- [x] **Step 3: Implement the card with a persistent header toolbar**

`GitStatusSurface` must own only `const [collapsed, setCollapsed] = React.useState(false)`, compute the total from all three groups, and put the branch/count summary plus refresh action inside the existing `toolbar` slot so both stay visible when collapsed:

```tsx
const toolbar = (
  <>
    <span className="git-status-summary">{snapshot.currentBranch} · {changeLabel}</span>
    <button
      type="button"
      className="chat-function-action"
      aria-label="Refresh Git status"
      disabled={!snapshot.online || snapshot.statusLoading}
      onClick={onRefresh}
    >
      <Icon name="refreshCw" spin={snapshot.statusLoading} />
    </button>
  </>
);

<ChatFunctionSurface
  title="Git"
  collapsed={collapsed}
  mode="compact"
  toolbar={toolbar}
  onToggleCollapsed={() => setCollapsed(value => !value)}
  className="git-status-surface"
  revealOnHover
>
  <div className="git-status-groups">{groups}</div>
</ChatFunctionSurface>
```

Render Staged, Unstaged, Untracked only when non-empty; clean state says `Working tree clean`. File button keys must include `${scope}:${path}` and callbacks must preserve that scope.

- [x] **Step 4: Style the card within existing edge-surface geometry**

Add only `.git-status-*` descendants to `git.css`. Keep the existing card width/radius/glass/shadow rules from `chat.css`; constrain the expanded body with `max-height` and internal scrolling so Git cannot starve Monitor. Ensure collapsed summary ellipsizes branch names.

- [x] **Step 5: Run card and edge-surface regressions**

```powershell
npm --prefix app test -- --runInBand web/src/git/GitStatusSurface.test.tsx app/web/src/chat/ChatEdgeSurfaceHeader.test.tsx __tests__/web-chat-edge-surface-geometry.test.ts __tests__/web-chat-session-panel-layout.test.tsx
```

Expected: PASS.

- [x] **Step 6: Commit the card**

```powershell
git add app/web/src/git/GitStatusSurface.tsx app/web/src/git/GitStatusSurface.test.tsx app/web/src/styles/git.css
git commit -m "feat(git): add desktop status card"
```

### Task 8: Wire Git store, history, status, and Diff loading into WorkspaceApp

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/preview/PreviewWorkbenchChrome.tsx`
- Modify: `app/web/src/styles/git.css`
- Create: `app/__tests__/web-git-browser-workspace.test.tsx`
- Modify: `app/__tests__/web-workspace-tab-removal.test.ts`
- Modify: `app/__tests__/web-main-surface-boundary.test.ts`
- Modify: `app/__tests__/web-chat-plan-surface.test.tsx`
- Modify: `app/__tests__/web-git-diff-startup-boundary.test.ts`
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: Write failing workspace integration assertions**

```ts
test('wires the shared store into Preview and desktop edge surfaces without restoring a top-level Git tab', () => {
  const main = readWorkspaceApp();
  expect(main).toContain("import {GitBrowserStore}");
  expect(main).toContain('<GitHistoryPanel');
  expect(main).toContain('<GitStatusSurface');
  expect(main.indexOf('<GitStatusSurface')).toBeLessThan(main.indexOf('<MonitorSurface'));
  expect(main).toContain("drawerMode={previewWorkbench.drawerMode}");
  expect(main).toContain("type === 'git-diff'");
  expect(main).not.toContain("tab === 'git'");
  expect(main).not.toContain('../git/GitSidebar');
});

test('loads commit and worktree diffs with explicit project ids', () => {
  const main = readWorkspaceApp();
  expect(main).toContain('service.readProjectGitFileDiff(tab.projectId, tab.source.sha, tab.source.path)');
  expect(main).toContain('service.readProjectWorkingTreeFileDiff(');
  expect(main).toContain('loadedWorktreeRev: projectGitSnapshot.worktreeRev');
});

test('keeps Git off mobile Floating Nav', () => {
  expect(readMobileFloatingNavModel()).not.toContain("id: 'git'");
});
```

Add assertions for `gitProjectAvailable`, offline retention, history load only when `drawerMode === 'git'`, status load only for the desktop card, revision ingestion from `projects`, worktree Diff reload, Prompt Diff still using `UnifiedDiffPreview`, `gitdiff-parser` remaining dynamically loaded, and absence of `setInterval`/poll timers in the Git browser path.

- [ ] **Step 2: Run the workspace integration/boundary tests and confirm failure**

```powershell
npm --prefix app test -- --runInBand __tests__/web-git-browser-workspace.test.tsx __tests__/web-workspace-tab-removal.test.ts __tests__/web-main-surface-boundary.test.ts __tests__/web-chat-plan-surface.test.tsx __tests__/web-git-diff-startup-boundary.test.ts
```

Expected: FAIL because no components/store are wired and retired-boundary tests still ban all new Git UI modules/styles.

- [ ] **Step 3: Instantiate one store and subscribe once**

Create the gateway beside the existing module-level `service`. Implement `GitBrowserStore.subscribe` and `snapshot` as arrow properties so they are stable `useSyncExternalStore` callbacks:

```ts
const gitBrowserStore = new GitBrowserStore({
  getRev: projectId => service.getProjectGitRev(projectId),
  getRefs: projectId => service.listProjectGitBranches(projectId),
  getLog: (projectId, options) => service.listProjectGitCommits(projectId, options),
  getCommitFiles: (projectId, sha) => service.listProjectGitCommitFiles(projectId, sha),
  getStatus: projectId => service.getProjectGitStatus(projectId),
});
```

Inside `App`, use `useSyncExternalStore` with stable bound callbacks, call `void gitBrowserStore.syncProjects(projects)` in an effect, and select two snapshots: Preview uses `previewWorkbench.activeProjectId`; the desktop card uses the current selected Chat/project ID. Do not add Git data to `WorkspacePersistence`.

- [ ] **Step 4: Wire lazy history/status loads and manual actions**

Use effects with explicit visibility:

```ts
useEffect(() => {
  if (previewWorkbench.drawerMode !== 'git' || !previewGitSnapshot.available || !previewGitSnapshot.online) return;
  void gitBrowserStore.ensureHistory(previewGitSnapshot.projectId);
  void gitBrowserStore.ensureStatus(previewGitSnapshot.projectId);
}, [previewWorkbench.drawerMode, previewGitSnapshot.projectId, previewGitSnapshot.available, previewGitSnapshot.online]);

useEffect(() => {
  if (!isWide || archivedMode || !desktopGitSnapshot.available || !desktopGitSnapshot.online) return;
  void gitBrowserStore.ensureStatus(desktopGitSnapshot.projectId);
}, [isWide, archivedMode, desktopGitSnapshot.projectId, desktopGitSnapshot.available, desktopGitSnapshot.online]);
```

`refresh` calls store refresh; branch selection, commit expansion, and load more call their store methods. The Git entry exists when `available` is true even if `online` is false; disable requests and keep stale content while offline. Hide both entry points when `available` is false.

- [ ] **Step 5: Implement Git Diff open/load/reload handlers**

Open one tab from both components with:

```ts
const openGitDiffPreview = useCallback((
  targetProjectId: string,
  source: GitDiffSource,
  file: GitDiffFileMeta,
) => {
  if (!targetProjectId) return;
  setChatPreviewManualOpen(false);
  setChatPreviewManualCollapsed(false);
  setPreviewWorkbench(current => openPreviewTab(current, {
    type: 'git-diff',
    projectId: targetProjectId,
    title: file.path.split('/').pop() || file.path,
    source,
    file,
  }));
}, []);
```

Bind each host with its own project ID:

```tsx
<GitHistoryPanel
  snapshot={previewGitSnapshot}
  onFileOpen={(source, file) => openGitDiffPreview(previewGitSnapshot.projectId, source, file)}
/>
<GitStatusSurface
  snapshot={desktopGitSnapshot}
  onFileOpen={(source, file) => openGitDiffPreview(desktopGitSnapshot.projectId, source, file)}
/>
```

Add `loadGitDiffPreviewTab(tab)` and call it from the existing restored-active-tab loader. It must use `beginPreviewTabLoad` and `updatePreviewTabAfterLoad`, read commit/worktree data through the explicit project service methods, and fill `diff`, `isBinary`, `truncated`, `loading`, `error`, and `loadedWorktreeRev`. A worktree tab reloads only when it is active and its `loadedWorktreeRev !== projectGitSnapshot.worktreeRev`; a commit tab with populated Diff never reloads because SHA content is stable. Request IDs must prevent a late load from overwriting a reopened/reloaded tab.

- [ ] **Step 6: Render the dedicated Git Diff tab with the shared viewer**

Add `git-diff` to `previewWorkbenchTabIcon`, `renderPreviewWorkbenchTabBody`, Preview search availability, desktop path actions, and rendered-tab caching. Render:

```tsx
<UnifiedDiffPreview
  files={[tab.file]}
  activeFilePath={tab.file.path}
  loading={tab.loading}
  error={tab.error}
  overviewLabel={`${tab.source.kind === 'commit' ? tab.source.sha.slice(0, 7) : tab.source.scope} · ${tab.file.path}`}
  onToggleFile={() => undefined}
  themeMode={themeMode}
  codeTheme={codeTheme}
  codeFont={codeFont}
  codeFontFamily={codeFontFamily}
  codeFontSize={codeFontSize}
  codeLineHeight={codeLineHeight}
  codeTabSize={codeTabSize}
/>
```

- [ ] **Step 7: Insert History and the desktop card in their exact hosts**

Pass `GitHistoryPanel` as `gitDrawer` to `PreviewWorkbenchChrome`. Insert `GitStatusSurface` immediately after `ChatPlanSurface` and before `MonitorSurface`. Update `showChatEdgeSurfaces` so an available desktop Git project reserves the existing left edge-surface geometry even if Recent/Plan/Monitor are absent. Do not render `GitStatusSurface` outside `isWide && !archivedMode`, and do not change mobile navigation.

Both `onFileOpen` bindings must leave `previewWorkbench.drawerMode` unchanged, so selecting a file switches Preview content while the Git drawer stays open.

- [ ] **Step 8: Update retirement/design boundaries to distinguish old page from new browser**

Keep assertions banning `GitSurface`, `GitSidebar`, `type Tab = ... 'git'`, `tab === 'git'`, old `.git-sidebar`, and top-level navigation. Replace assertions banning any `git.css`/Git component with positive assertions for `GitHistoryPanel`, `GitStatusSurface`, and `git-diff` Preview tabs. Keep the parser lazy-load assertion unchanged.

- [ ] **Step 9: Run the focused integration set and TypeScript**

```powershell
npm --prefix app test -- --runInBand __tests__/web-git-browser-workspace.test.tsx __tests__/web-workspace-tab-removal.test.ts __tests__/web-main-surface-boundary.test.ts __tests__/web-chat-plan-surface.test.tsx __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-preview-workbench-state.test.ts __tests__/web-preview-file-regressions.test.tsx __tests__/web-git-diff-startup-boundary.test.ts web/src/git/GitHistoryPanel.test.tsx web/src/git/GitStatusSurface.test.tsx
npm --prefix app run tsc:web
```

Expected: all Jest suites PASS and TypeScript exits 0.

- [ ] **Step 10: Commit the workspace integration**

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/web/src/preview/PreviewWorkbenchChrome.tsx app/web/src/styles/chat.css app/web/src/styles/git.css app/__tests__/web-git-browser-workspace.test.tsx app/__tests__/web-workspace-tab-removal.test.ts app/__tests__/web-main-surface-boundary.test.ts app/__tests__/web-chat-plan-surface.test.tsx app/__tests__/web-git-diff-startup-boundary.test.ts
git commit -m "feat(git): integrate browser into workspace"
```

### Task 9: Polish, verify, rebase, and deliver

**Files:**
- Modify if verification exposes defects: files already listed in Tasks 1-8
- Modify: `docs/scope/2026-08-03-git-browser/plan-git-browser.md`

- [ ] **Step 1: Perform a focused visual-language review**

Review desktop and mobile CSS against `docs/wiki/frontend-interaction/visual-language.md`, `workbench-chrome.md`, and `pc-chat-sidebar-modes.md`. Verify:

```text
Files/Git FABs: same size, same material, one active state
History drawer: filename-first rows, no restored VS Code clone chrome
Git card: same 360px edge-surface width/radius as Monitor
Mobile: drawer respects safe-area and no Git Floating Nav item exists
Keyboard: visible focus, Escape closes drawer/menu, buttons have aria labels
```

Apply only corrections required by this checklist, then run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-ui-design-system.test.ts __tests__/web-chat-edge-surface-geometry.test.ts __tests__/web-chat-session-panel-layout.test.tsx __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-mobile-floating-nav.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the complete frontend verification gate**

```powershell
npm --prefix app run tsc:web
npm --prefix app test -- --runInBand
npm --prefix app run build:web
```

Expected: TypeScript exits 0, every Jest suite passes, and webpack production build exits 0. The build writes to the configured `~/.wheelmaker/web` target; do not scan or add generated output.

- [ ] **Step 3: Inspect scope and protocol boundaries**

```powershell
rg -n --glob '!**/dist/**' "GitSurface|GitSidebar|tab === 'git'|setTab\('git'\)|stage|unstage|checkout|git push" app/web/src app/__tests__
git diff --name-only origin/main...HEAD -- server/internal/protocol docs/wiki/protocols
git diff --check
git status --short --branch
```

Expected: no retired top-level Git page/navigation or Git write controls; matches for `stage/unstage` are only read-only scope labels/tests; the protocol-path diff command prints nothing, proving protocol version and Registry protocol docs were unchanged; `git diff --check` exits 0.

- [ ] **Step 4: Rebase the feature branch onto the latest remote baseline**

First make the task commits clean, then run:

```powershell
git fetch origin
git rebase origin/main
```

Expected: rebase completes without semantic conflicts. If conflicts are mechanically clear, resolve them and rerun the focused/full verification affected by the resolution; if intent is ambiguous, stop and ask the user.

- [ ] **Step 5: Rerun the full verification after rebase**

```powershell
npm --prefix app run tsc:web
npm --prefix app test -- --runInBand
npm --prefix app run build:web
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Record verification in this plan and run the exact completion tail**

Mark every completed checkbox in this plan and append one concise verification line below this task with actual suite/test counts and build result. Then execute this exact final command sequence with no intervening command:

```powershell
git add -A
git commit -m "chore(git): record browser verification"
git push origin feature/git-browser
```

Expected: commit succeeds and `feature/git-browser` is pushed. Because the root `main` worktree contained unrelated user edits when this worktree was created, do not merge into `main`, delete the branch, or remove the worktree unless the root worktree is clean at delivery time; report the preserved state instead.
