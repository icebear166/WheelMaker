import {
  buildContextMenuModel,
  type ContextMenuModel,
  type ContextMenuOptions,
  type FileMenuAction,
} from './fileMenuModel';

type FileMenuOptions = Extract<ContextMenuOptions, {surface: 'file'}>;

function actions(model: ContextMenuModel): FileMenuAction[] {
  return model.groups.flatMap(group => group.items.map(item => item.action));
}

function labels(model: ContextMenuModel): string[] {
  return model.groups.flatMap(group => group.items.map(item => item.label));
}

function option(overrides: Partial<FileMenuOptions['target']> = {}): FileMenuOptions {
  return {
    surface: 'file',
    platform: 'desktop',
    target: {
      kind: 'project-file',
      path: 'README.md',
      available: true,
      downloadAvailable: true,
      ...overrides,
    },
    capabilities: {
      canOpenInVSCode: true,
      canShowInExplorer: true,
      canCopyFile: true,
    },
  };
}

describe('file menu model', () => {
  test('returns fixed grouped order and short labels for a capable project Markdown file', () => {
    const model = buildContextMenuModel(option());

    expect(model.groups.map(group => group.id)).toEqual([
      'open',
      'transfer-share-export',
      'path',
      'tab',
    ].slice(0, 3));
    expect(actions(model)).toEqual([
      'preview',
      'vscode',
      'folder',
      'download',
      'copy-file',
      'share',
      'export-html',
      'copy-relative',
      'copy-absolute',
    ]);
    expect(labels(model)).toEqual([
      'Preview',
      'Open in VS Code',
      'Show in Explorer',
      'Download',
      'Copy file',
      'Share MD/HTML',
      'Export as HTML',
      'Copy relative path',
      'Copy absolute path',
    ]);
    expect(model.groups.map(group => group.items.map(item => item.icon))).toEqual([
      ['eye', 'code', 'folderOpen'],
      ['arrowDown', 'copy', 'share', 'fileCode'],
      ['fileSymlink', 'clipboard'],
    ]);
  });

  test('removes desktop-only actions and keeps browser delivery labels', () => {
    const model = buildContextMenuModel({
      ...option(),
      platform: 'browser',
      capabilities: {
        canOpenInVSCode: true,
        canShowInExplorer: true,
        canCopyFile: true,
      },
    });

    expect(actions(model)).toEqual([
      'preview',
      'download',
      'share',
      'export-html',
      'copy-relative',
      'copy-absolute',
    ]);
    expect(labels(model)).toContain('Export as HTML');
    expect(labels(model)).not.toContain('Copy file as HTML');
  });

  test('limits an external file to preview, download, and absolute path', () => {
    const model = buildContextMenuModel({
      ...option({
        kind: 'external-file',
        path: 'D:/outside/report.txt',
      }),
      platform: 'browser',
    });

    expect(actions(model)).toEqual(['preview', 'download', 'copy-absolute']);
    expect(model.groups.map(group => group.id)).toEqual(['open', 'transfer-share-export', 'path']);
  });

  test('keeps desktop file-copy available for an external file', () => {
    const model = buildContextMenuModel({
      ...option({
        kind: 'external-file',
        path: 'D:/outside/report.txt',
      }),
      capabilities: {
        canOpenInVSCode: true,
        canShowInExplorer: true,
        canCopyFile: true,
      },
    });

    expect(actions(model)).toEqual([
      'preview',
      'vscode',
      'folder',
      'download',
      'copy-file',
      'copy-absolute',
    ]);
  });

  test('offers share and HTML export for an external Markdown file', () => {
    const model = buildContextMenuModel({
      ...option({
        kind: 'external-file',
        path: 'D:/outside/notes.md',
      }),
      platform: 'browser',
    });

    expect(actions(model)).toEqual([
      'preview',
      'download',
      'share',
      'export-html',
      'copy-absolute',
    ]);
  });

  test('offers share and HTML export for an external Markdown file at a POSIX path', () => {
    const model = buildContextMenuModel({
      ...option({
        kind: 'external-file',
        path: '/home/user/notes.markdown',
      }),
      platform: 'browser',
    });

    expect(actions(model)).toContain('share');
    expect(actions(model)).toContain('export-html');
  });

  test('offers only share for an external HTML file', () => {
    const model = buildContextMenuModel({
      ...option({
        kind: 'external-file',
        path: '/home/user/page.html',
      }),
      platform: 'browser',
    });

    expect(actions(model)).toContain('share');
    expect(actions(model)).not.toContain('export-html');
  });

  test('hides share and export for an unavailable external Markdown file', () => {
    const model = buildContextMenuModel({
      ...option({
        kind: 'external-file',
        path: '/home/user/notes.md',
        available: false,
      }),
      platform: 'browser',
    });

    expect(labels(model)).not.toContain('Share MD/HTML');
    expect(labels(model)).not.toContain('Export as HTML');
  });

  test('keeps an attachment preview/download menu without path actions', () => {
    const model = buildContextMenuModel({
      ...option({
        kind: 'attachment',
        path: undefined,
      }),
      platform: 'android',
    });

    expect(actions(model)).toEqual(['preview', 'download']);
    expect(model.groups.map(group => group.id)).toEqual(['open', 'transfer-share-export']);
  });

  test('hides unavailable transfer actions while retaining available paths for a changed file', () => {
    const model = buildContextMenuModel(option({
      kind: 'changed-file',
      available: false,
      downloadAvailable: false,
    }));

    expect(actions(model)).toEqual(['preview', 'copy-relative', 'copy-absolute']);
    expect(labels(model)).not.toContain('Share MD/HTML');
    expect(labels(model)).not.toContain('Export as HTML');
  });

  test('uses the same grouped model for a Preview file tab and adds Refresh', () => {
    const model = buildContextMenuModel({
      surface: 'preview-tab',
      platform: 'desktop',
      target: {
        kind: 'preview-file',
        path: 'README.md',
        available: true,
        downloadAvailable: true,
        refreshAvailable: true,
        refreshDisabled: false,
      },
      capabilities: {
        canOpenInVSCode: true,
        canShowInExplorer: true,
        canCopyFile: true,
      },
    });

    expect(actions(model)).toEqual([
      'vscode',
      'folder',
      'download',
      'copy-file',
      'share',
      'export-html',
      'copy-relative',
      'copy-absolute',
      'refresh',
    ]);
    expect(model.groups.map(group => group.id)).toEqual([
      'open',
      'transfer-share-export',
      'path',
      'tab',
    ]);
    expect(model.groups.at(-1)?.items[0]).toMatchObject({
      action: 'refresh',
      label: 'Refresh',
      icon: 'refreshCw',
      disabled: false,
    });
  });

  test('does not expose ordinary file actions for attachment, diff, or relay tabs', () => {
    const attachment = buildContextMenuModel({
      surface: 'preview-tab',
      platform: 'browser',
      target: {kind: 'preview-attachment', available: true, downloadAvailable: true},
    });
    const diff = buildContextMenuModel({
      surface: 'preview-tab',
      platform: 'desktop',
      target: {kind: 'git-diff'},
    });
    const relay = buildContextMenuModel({
      surface: 'preview-tab',
      platform: 'browser',
      target: {kind: 'relay'},
    });

    expect(actions(attachment)).toEqual(['download']);
    expect(actions(diff)).toEqual([]);
    expect(actions(relay)).toEqual(['open-relay']);
    expect(labels(relay)).toEqual(['Open relay page in browser']);
  });

  test('limits an external Preview file tab to native/file-transfer actions and absolute path', () => {
    const model = buildContextMenuModel({
      surface: 'preview-tab',
      platform: 'browser',
      target: {
        kind: 'preview-external-file',
        path: 'D:/outside/report.txt',
        available: true,
        downloadAvailable: true,
      },
    });

    expect(actions(model)).toEqual(['download', 'copy-absolute']);
    expect(labels(model)).not.toContain('Share MD/HTML');
    expect(labels(model)).not.toContain('Copy relative path');
  });

  test('keeps desktop file-copy available for an external Preview file tab', () => {
    const model = buildContextMenuModel({
      surface: 'preview-tab',
      platform: 'desktop',
      target: {
        kind: 'preview-external-file',
        path: 'D:/outside/report.txt',
        available: true,
        downloadAvailable: true,
      },
      capabilities: {canCopyFile: true},
    });

    expect(actions(model)).toEqual(['download', 'copy-file', 'copy-absolute']);
  });

  test('offers share and HTML export for an external Preview Markdown tab', () => {
    const model = buildContextMenuModel({
      surface: 'preview-tab',
      platform: 'browser',
      target: {
        kind: 'preview-external-file',
        path: '/home/user/notes.md',
        available: true,
        downloadAvailable: true,
      },
    });

    expect(actions(model)).toEqual(['download', 'share', 'export-html', 'copy-absolute']);
  });

  test('offers only share for an external Preview HTML tab', () => {
    const model = buildContextMenuModel({
      surface: 'preview-tab',
      platform: 'browser',
      target: {
        kind: 'preview-external-file',
        path: '/home/user/page.htm',
        available: true,
        downloadAvailable: true,
      },
    });

    expect(actions(model)).toContain('share');
    expect(actions(model)).not.toContain('export-html');
  });

  test('returns a separate Copy action for text selection', () => {
    const model = buildContextMenuModel({
      surface: 'selection',
      platform: 'browser',
      target: {kind: 'selection'},
    });

    expect(actions(model)).toEqual(['copy-selection']);
    expect(model.groups).toEqual([
      {
        id: 'selection',
        items: [{action: 'copy-selection', icon: 'copy', label: 'Copy'}],
      },
    ]);
  });
});
