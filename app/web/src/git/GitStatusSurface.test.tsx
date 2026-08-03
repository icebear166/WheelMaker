import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {GitStatusSurface} from './GitStatusSurface';
import type {GitBrowserProjectSnapshot} from './gitBrowserStore';

function snapshotWith(
  overrides: Partial<GitBrowserProjectSnapshot> = {},
): GitBrowserProjectSnapshot {
  return {
    projectId: 'p1',
    available: true,
    online: true,
    currentBranch: 'main',
    headSha: 'abc',
    branches: [],
    selectedRefs: ['main'],
    commits: [],
    commitFilesBySha: {},
    expandedCommitSha: '',
    worktree: {
      staged: [{path: 'src/a.ts', status: 'M', scope: 'staged'}],
      unstaged: [{path: 'src/a.ts', status: 'M', scope: 'unstaged'}],
      untracked: [],
    },
    gitRev: 'g1',
    worktreeRev: 'w1',
    refsLoaded: true,
    historyLoaded: false,
    statusLoaded: true,
    historyDone: false,
    historyCursor: '',
    historyLoading: false,
    historyMoreLoading: false,
    statusLoading: false,
    commitFilesLoadingSha: '',
    historyError: '',
    statusError: '',
    commitFilesError: '',
    ...overrides,
  };
}

async function renderSurface(
  snapshot: GitBrowserProjectSnapshot,
  overrides: Partial<React.ComponentProps<typeof GitStatusSurface>> = {},
) {
  const handlers = {
    onRefresh: jest.fn(),
    onRetry: jest.fn(),
    onFileOpen: jest.fn(),
  };
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(
      <GitStatusSurface snapshot={snapshot} {...handlers} {...overrides} />,
    );
  });
  return {view, handlers};
}

test('defaults expanded and opens the exact worktree scope', async () => {
  const {view, handlers} = await renderSurface(snapshotWith());
  expect(view.root.findByProps({'aria-label': 'Git'}).props.className).not.toContain('collapsed');

  const rows = view.root.findAllByProps({'aria-label': 'Open src/a.ts diff'});
  await act(async () => rows[1].props.onClick());
  expect(handlers.onFileOpen).toHaveBeenCalledWith(
    {kind: 'worktree', scope: 'unstaged', path: 'src/a.ts'},
    {path: 'src/a.ts', status: 'M', additions: 0, deletions: 0},
  );
});

test('collapsed header keeps branch and total count visible', async () => {
  const {view} = await renderSurface(snapshotWith({currentBranch: 'main'}));
  await act(async () => {
    view.root.findByProps({'aria-label': 'Collapse Git'}).props.onClick();
  });
  const text = JSON.stringify(view.toJSON());
  expect(text).toContain('main');
  expect(text).toContain('2 changes');
  expect(view.root.findByProps({'aria-label': 'Git'}).props.className).toContain('collapsed');
});

test('renders loading, clean, stale error, retry, and offline controls', async () => {
  const {view, handlers} = await renderSurface(snapshotWith({
    statusLoaded: false,
    statusLoading: true,
    worktree: {staged: [], unstaged: [], untracked: []},
  }));
  expect(JSON.stringify(view.toJSON())).toContain('Loading Git status');

  await act(async () => {
    view.update(
      <GitStatusSurface
        snapshot={snapshotWith({
          online: false,
          statusError: 'status failed',
          worktree: {staged: [], unstaged: [], untracked: []},
        })}
        {...handlers}
      />,
    );
  });
  const text = JSON.stringify(view.toJSON());
  expect(text).toContain('Working tree clean');
  expect(text).toContain('status failed');
  expect(view.root.findByProps({'aria-label': 'Refresh Git status'}).props.disabled).toBe(true);
  expect(view.root.findByProps({'aria-label': 'Retry Git status'}).props.disabled).toBe(true);
});
