import {
  activeFilePreviewTab,
  beginFilePreviewTabLoad,
  closeFilePreviewTab,
  createFilePreviewWorkbenchState,
  ensureFilePreviewProjectVisible,
  openFilePreviewTab,
  selectFilePreviewProject,
} from '../web/src/file/filePreviewWorkbenchState';

describe('file preview workbench state', () => {
  test('reuses an existing path within the same project and updates the target line', () => {
    const first = openFilePreviewTab(createFilePreviewWorkbenchState('p1'), 'p1', 'src/a.ts', 4);
    const second = openFilePreviewTab(first, 'p1', 'src/b.ts', null);
    const reused = openFilePreviewTab(second, 'p1', 'src/a.ts', 9);

    expect(reused.activeProjectId).toBe('p1');
    expect(reused.tabsByProjectId.p1.map(tab => tab.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(activeFilePreviewTab(reused)?.path).toBe('src/a.ts');
    expect(activeFilePreviewTab(reused)?.targetLine).toBe(9);
  });

  test('keeps tabs partitioned by project and restores them when project changes', () => {
    const state = openFilePreviewTab(
      openFilePreviewTab(createFilePreviewWorkbenchState('p1'), 'p1', 'src/a.ts', null),
      'p2',
      'README.md',
      2,
    );

    const p1 = selectFilePreviewProject(state, 'p1');
    expect(activeFilePreviewTab(p1)?.path).toBe('src/a.ts');
    const p2 = selectFilePreviewProject(p1, 'p2');
    expect(activeFilePreviewTab(p2)?.path).toBe('README.md');
  });

  test('closes the active tab to a neighboring tab and keeps an empty project state', () => {
    const state = openFilePreviewTab(
      openFilePreviewTab(createFilePreviewWorkbenchState('p1'), 'p1', 'one.ts', null),
      'p1',
      'two.ts',
      null,
    );

    const afterClose = closeFilePreviewTab(state, 'p1', 'two.ts');
    expect(activeFilePreviewTab(afterClose)?.path).toBe('one.ts');
    const empty = closeFilePreviewTab(afterClose, 'p1', 'one.ts');
    expect(empty.tabsByProjectId.p1).toEqual([]);
    expect(activeFilePreviewTab(empty)).toBeNull();
    expect(empty.activeProjectId).toBe('p1');
  });

  test('switches to a visible preferred project when the active project is hidden', () => {
    const state = selectFilePreviewProject(createFilePreviewWorkbenchState('hidden'), 'hidden');
    const next = ensureFilePreviewProjectVisible(state, ['p2', 'p3'], 'p3');

    expect(next.activeProjectId).toBe('p3');
  });

  test('updates only the matching project tab during async load completion', () => {
    const state = openFilePreviewTab(
      openFilePreviewTab(createFilePreviewWorkbenchState('p1'), 'p1', 'src/a.ts', null),
      'p2',
      'src/a.ts',
      null,
    );

    const loading = beginFilePreviewTabLoad(state, 'p1', 'src/a.ts', 7);

    expect(loading.tabsByProjectId.p1[0].loading).toBe(true);
    expect(loading.tabsByProjectId.p2[0].loading).toBe(false);
  });
});
