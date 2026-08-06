import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {GitHistoryPanel} from './GitHistoryPanel';
import type {GitBrowserProjectSnapshot} from './gitBrowserStore';

function snapshot(
  overrides: Partial<GitBrowserProjectSnapshot> = {},
): GitBrowserProjectSnapshot {
  return {
    projectId: 'p1',
    available: true,
    online: true,
    currentBranch: 'main',
    headSha: 'abc',
    branches: [
      {name: 'main', kind: 'local', current: true},
      {name: 'origin/main', kind: 'remote', current: false},
    ],
    selectedRefs: ['main'],
    commits: [{
      sha: 'abc',
      author: 'Ada',
      email: 'ada@example.com',
      time: '2026-08-03T10:00:00Z',
      title: 'Ship Git',
    }],
    commitFilesBySha: {
      abc: [{path: 'src/a.ts', status: 'M', additions: 2, deletions: 1}],
    },
    expandedCommitSha: 'abc',
    worktree: {staged: [], unstaged: [], untracked: []},
    gitRev: 'g1',
    worktreeRev: 'w1',
    refsLoaded: true,
    historyLoaded: true,
    statusLoaded: true,
    historyDone: false,
    historyCursor: '50',
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

async function render(
  props: Partial<React.ComponentProps<typeof GitHistoryPanel>> = {},
) {
  const handlers = {
    onSelectedRefsChange: jest.fn(),
    onToggleCommit: jest.fn(),
    onFileOpen: jest.fn(),
    onRefresh: jest.fn(),
    onLoadMore: jest.fn(),
    onRetry: jest.fn(),
    onCopyCommitSha: jest.fn(),
  };
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(
      <GitHistoryPanel snapshot={snapshot()} {...handlers} {...props} />,
    );
  });
  return {view, handlers};
}

test('selects refs, expands commit details, opens files, and loads more', async () => {
  const {view, handlers} = await render();
  const root = view.root;
  const text = JSON.stringify(view.toJSON());

  expect(root.findByProps({'aria-label': 'Git branches'})).toBeTruthy();
  expect(text).toContain('Ada');
  expect(text).toContain('ada@example.com');
  expect(text).toContain('Current HEAD');
  expect(text).toContain('abc');

  await act(async () => {
    root.findByProps({'aria-label': 'Open src/a.ts diff'}).props.onClick();
  });
  expect(handlers.onFileOpen).toHaveBeenCalledWith(
    {kind: 'commit', sha: 'abc', path: 'src/a.ts'},
    expect.objectContaining({path: 'src/a.ts'}),
  );

  await act(async () => {
    root.findByProps({'aria-label': 'Load more commits'}).props.onClick();
  });
  expect(handlers.onLoadMore).toHaveBeenCalled();
});

test('opens scoped Working Tree files and keeps one ref selected', async () => {
  const worktree = {
    staged: [{path: 'src/a.ts', status: 'M', scope: 'staged' as const}],
    unstaged: [{path: 'src/a.ts', status: 'M', scope: 'unstaged' as const}],
    untracked: [{path: 'src/new.ts', status: 'U', scope: 'untracked' as const}],
  };
  const {view, handlers} = await render({snapshot: snapshot({worktree})});
  const root = view.root;

  await act(async () => {
    root.findByProps({'aria-label': 'Open src/a.ts staged diff'}).props.onClick();
  });
  expect(handlers.onFileOpen).toHaveBeenCalledWith(
    {kind: 'worktree', scope: 'staged', path: 'src/a.ts'},
    {path: 'src/a.ts', status: 'M', additions: 0, deletions: 0},
  );

  await act(async () => {
    root.findByProps({'aria-label': 'Git branches'}).props.onClick();
  });
  await act(async () => {
    root.findByProps({'aria-label': 'Toggle main'}).props.onClick();
  });
  expect(handlers.onSelectedRefsChange).toHaveBeenCalledWith(['main']);
});

test('shows loading, empty, stale-error, and completed-history states', async () => {
  const {view, handlers} = await render({
    snapshot: snapshot({
      commits: [],
      historyLoaded: false,
      historyLoading: true,
      statusLoaded: false,
      statusLoading: true,
    }),
  });
  expect(JSON.stringify(view.toJSON())).toContain('Loading Git history');
  expect(JSON.stringify(view.toJSON())).toContain('Loading working tree');

  await act(async () => {
    view.update(
      <GitHistoryPanel
        snapshot={snapshot({
          commits: [],
          historyDone: true,
          historyError: 'network failed',
          statusError: 'status failed',
        })}
        {...handlers}
      />,
    );
  });
  const text = JSON.stringify(view.toJSON());
  expect(text).toContain('No commits found');
  expect(text).toContain('network failed');
  expect(text).toContain('status failed');
  expect(view.root.findAllByProps({'aria-label': 'Load more commits'})).toHaveLength(0);
  await act(async () => {
    view.root.findAllByProps({'aria-label': 'Retry Git history'})[0].props.onClick();
  });
  expect(handlers.onRetry).toHaveBeenCalled();
});

test('copies the full sha from the commit header and keeps file rows free of status letters', async () => {
  const {view, handlers} = await render({
    snapshot: snapshot({
      worktree: {
        staged: [{path: 'src/staged.ts', status: 'M', scope: 'staged' as const}],
        unstaged: [],
        untracked: [{path: 'src/new.ts', status: 'U', scope: 'untracked' as const}],
      },
    }),
  });
  const root = view.root;
  const text = JSON.stringify(view.toJSON());

  expect(text).not.toContain('git-full-sha');
  expect(text).not.toContain('git-file-status');
  expect(root.findAll(node => node.props['data-tooltip'] === 'ada@example.com').length).toBeGreaterThan(0);
  expect(root.findAll(node => typeof node.props['data-tooltip'] === 'string'
    && (node.props['data-tooltip'] as string).includes('2026')).length).toBeGreaterThan(0);

  await act(async () => {
    root.findByProps({'aria-label': 'Copy full SHA abc'}).props.onClick();
  });
  expect(handlers.onCopyCommitSha).toHaveBeenCalledWith('abc');
});

test('keeps stale data visible but disables network controls while offline', async () => {
  const {view} = await render({snapshot: snapshot({online: false})});
  const root = view.root;
  expect(JSON.stringify(view.toJSON())).toContain('Offline');
  expect(root.findByProps({'aria-label': 'Git branches'}).props.disabled).toBe(true);
  expect(root.findByProps({'aria-label': 'Refresh Git history'}).props.disabled).toBe(true);
  expect(JSON.stringify(view.toJSON())).toContain('Ship Git');
});
