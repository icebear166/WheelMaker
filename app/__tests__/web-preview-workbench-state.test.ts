import {
  activePreviewTab,
  beginPreviewTabLoad,
  buildPreviewSearchMatches,
  closePreviewTab,
  createPreviewWorkbenchState,
  cyclePreviewTabId,
  ensurePreviewProjectVisible,
  openPreviewTab,
  previewTabId,
  previewWorkbenchTabTooltip,
  selectPreviewProject,
  updatePreviewTabAfterLoad,
} from '../web/src/preview/previewWorkbenchState';

describe('preview workbench state', () => {
  test('reuses the same file resource within a project and updates target line', () => {
    const initial = createPreviewWorkbenchState('p1');
    const first = openPreviewTab(initial, {
      type: 'file',
      projectId: 'p1',
      path: 'src/a.ts',
      targetLine: 4,
      title: 'a.ts',
    });
    const second = openPreviewTab(first, {
      type: 'file',
      projectId: 'p1',
      path: 'src/b.ts',
      targetLine: null,
      title: 'b.ts',
    });
    const reused = openPreviewTab(second, {
      type: 'file',
      projectId: 'p1',
      path: 'src/a.ts',
      targetLine: 9,
      title: 'a.ts',
    });

    expect(reused.tabsByProjectId.p1.map(tab => tab.id)).toEqual([
      'file:src/a.ts',
      'file:src/b.ts',
    ]);
    expect(activePreviewTab(reused)?.id).toBe('file:src/a.ts');
    expect(activePreviewTab(reused)).toMatchObject({type: 'file', targetLine: 9});
  });

  test('partitions tabs by project and restores the active tab per project', () => {
    const state = openPreviewTab(
      openPreviewTab(createPreviewWorkbenchState('p1'), {
        type: 'prompt-diff',
        projectId: 'p1',
        sessionId: 's1',
        artifactId: 'diff-1',
        title: 'Prompt diff',
        files: [],
      }),
      {
        type: 'port-relay',
        projectId: 'p2',
        hubId: 'hub-a',
        targetPort: 5173,
        framePath: '/app',
        title: 'hub-a:5173',
      },
    );

    const p1 = selectPreviewProject(state, 'p1');
    expect(activePreviewTab(p1)?.id).toBe('prompt-diff:s1:diff-1');
    const p2 = selectPreviewProject(p1, 'p2');
    expect(activePreviewTab(p2)?.id).toBe('port-relay:hub-a:5173:/app');
  });

  test('closes the active tab to a neighboring tab and keeps an empty project', () => {
    const state = openPreviewTab(
      openPreviewTab(createPreviewWorkbenchState('p1'), {
        type: 'attachment',
        projectId: 'p1',
        sessionId: 's1',
        attachmentKey: 'image-a',
        title: 'image-a.png',
        meta: '',
        mimeType: 'image/png',
        kind: 'image',
        src: '',
      }),
      {
        type: 'file',
        projectId: 'p1',
        path: 'src/a.ts',
        targetLine: null,
        title: 'a.ts',
      },
    );

    const afterClose = closePreviewTab(state, 'p1', 'file:src/a.ts');
    expect(activePreviewTab(afterClose)?.id).toBe('attachment:s1:image-a');
    const empty = closePreviewTab(afterClose, 'p1', 'attachment:s1:image-a');
    expect(empty.tabsByProjectId.p1).toEqual([]);
    expect(activePreviewTab(empty)).toBeNull();
    expect(empty.activeProjectId).toBe('p1');
  });

  test('switches to a visible preferred project when the active project is hidden', () => {
    const state = selectPreviewProject(createPreviewWorkbenchState('hidden'), 'hidden');
    const next = ensurePreviewProjectVisible(state, ['p2', 'p3'], 'p3');

    expect(next.activeProjectId).toBe('p3');
  });

  test('applies async load completion only to the matching request', () => {
    const state = openPreviewTab(createPreviewWorkbenchState('p1'), {
      type: 'file',
      projectId: 'p1',
      path: 'src/a.ts',
      targetLine: null,
      title: 'a.ts',
    });
    const loading = beginPreviewTabLoad(state, 'p1', 'file:src/a.ts', 7);
    const stale = updatePreviewTabAfterLoad(loading, 'p1', 'file:src/a.ts', 6, tab => ({
      ...tab,
      loading: false,
      error: 'stale',
    }));
    const fresh = updatePreviewTabAfterLoad(loading, 'p1', 'file:src/a.ts', 7, tab => ({
      ...tab,
      loading: false,
      error: '',
    }));

    expect(activePreviewTab(stale)).toMatchObject({loading: true, error: ''});
    expect(activePreviewTab(fresh)).toMatchObject({loading: false, error: ''});
  });

  test('builds stable resource ids for every supported tab type', () => {
    expect(previewTabId({type: 'file', path: 'src/a.ts'})).toBe('file:src/a.ts');
    expect(previewTabId({type: 'prompt-diff', sessionId: 's1', artifactId: 'd1'})).toBe('prompt-diff:s1:d1');
    expect(previewTabId({type: 'attachment', sessionId: 's1', attachmentKey: 'sha256-a'})).toBe('attachment:s1:sha256-a');
    expect(previewTabId({type: 'port-relay', hubId: 'hub-a', targetPort: 3000, framePath: '/x'})).toBe('port-relay:hub-a:3000:/x');
  });

  test('cycles tab ids in both directions with wraparound', () => {
    const state = openPreviewTab(
      openPreviewTab(createPreviewWorkbenchState('p1'), {
        type: 'file',
        projectId: 'p1',
        path: 'src/a.ts',
        targetLine: null,
        title: 'a.ts',
      }),
      {
        type: 'file',
        projectId: 'p1',
        path: 'src/b.ts',
        targetLine: null,
        title: 'b.ts',
      },
    );
    const tabs = state.tabsByProjectId.p1;

    expect(cyclePreviewTabId(tabs, 'file:src/a.ts', 1)).toBe('file:src/b.ts');
    expect(cyclePreviewTabId(tabs, 'file:src/a.ts', -1)).toBe('file:src/b.ts');
    expect(cyclePreviewTabId(tabs, 'file:src/b.ts', 1)).toBe('file:src/a.ts');
  });

  test('uses full resource identity for preview tab hover text', () => {
    const state = openPreviewTab(
      openPreviewTab(createPreviewWorkbenchState('p1'), {
        type: 'file',
        projectId: 'p1',
        path: 'src/deep/a.ts',
        targetLine: null,
        title: 'a.ts',
      }),
      {
        type: 'port-relay',
        projectId: 'p1',
        hubId: 'hub-a',
        targetPort: 5173,
        framePath: '/app',
        title: 'hub-a:5173',
        url: 'http://127.0.0.1:5173/app',
      },
    );

    expect(previewWorkbenchTabTooltip(state.tabsByProjectId.p1[0])).toBe('src/deep/a.ts');
    expect(previewWorkbenchTabTooltip(state.tabsByProjectId.p1[1])).toBe('http://127.0.0.1:5173/app');
  });

  test('builds search matches for file and prompt diff preview tabs only', () => {
    const fileState = openPreviewTab(createPreviewWorkbenchState('p1'), {
      type: 'file',
      projectId: 'p1',
      path: 'src/a.ts',
      targetLine: null,
      title: 'a.ts',
    });
    const fileTab = {
      ...activePreviewTab(fileState)!,
      content: 'alpha\nBeta needle\nneedle again',
    };

    expect(buildPreviewSearchMatches(fileTab, 'needle').map(match => match.line)).toEqual([2, 3]);

    const diffState = openPreviewTab(createPreviewWorkbenchState('p1'), {
      type: 'prompt-diff',
      projectId: 'p1',
      sessionId: 's1',
      artifactId: 'd1',
      title: 'Prompt diff',
      files: [
        {
          path: 'src/a.ts',
          status: 'MODIFIED',
          additions: 1,
          deletions: 0,
          diff: '@@ -1 +1 @@\n+needle',
          expanded: false,
        },
      ],
    });

    expect(buildPreviewSearchMatches(activePreviewTab(diffState), 'needle')).toMatchObject([
      {kind: 'diff', path: 'src/a.ts', line: 2},
    ]);

    const attachmentState = openPreviewTab(createPreviewWorkbenchState('p1'), {
      type: 'attachment',
      projectId: 'p1',
      sessionId: 's1',
      attachmentKey: 'img',
      title: 'img.png',
      meta: '',
      mimeType: 'image/png',
      kind: 'image',
      src: '',
    });

    expect(buildPreviewSearchMatches(activePreviewTab(attachmentState), 'needle')).toEqual([]);
  });
});
