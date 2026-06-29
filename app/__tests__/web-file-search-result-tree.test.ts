import {
  buildFileSearchResultTree,
  flattenFileSearchResultTree,
} from '../web/src/file/fileSearchResultTree';

describe('file search result tree', () => {
  test('groups ranked file search results into a reusable directory tree', () => {
    const tree = buildFileSearchResultTree([
      {path: 'src/app/WorkspaceApp.tsx', name: 'WorkspaceApp.tsx'},
      {path: 'README.md', name: 'README.md'},
      {path: 'src/file/FileExplorerTree.tsx', name: 'FileExplorerTree.tsx'},
    ]);

    expect(tree).toEqual([
      {
        kind: 'dir',
        name: 'src',
        path: 'src',
        children: [
          {
            kind: 'dir',
            name: 'app',
            path: 'src/app',
            children: [
              {
                kind: 'file',
                name: 'WorkspaceApp.tsx',
                path: 'src/app/WorkspaceApp.tsx',
                result: {path: 'src/app/WorkspaceApp.tsx', name: 'WorkspaceApp.tsx'},
              },
            ],
          },
          {
            kind: 'dir',
            name: 'file',
            path: 'src/file',
            children: [
              {
                kind: 'file',
                name: 'FileExplorerTree.tsx',
                path: 'src/file/FileExplorerTree.tsx',
                result: {path: 'src/file/FileExplorerTree.tsx', name: 'FileExplorerTree.tsx'},
              },
            ],
          },
        ],
      },
      {
        kind: 'file',
        name: 'README.md',
        path: 'README.md',
        result: {path: 'README.md', name: 'README.md'},
      },
    ]);
  });

  test('flattens grouped search results in visible tree order', () => {
    const tree = buildFileSearchResultTree([
      {path: 'src/app/WorkspaceApp.tsx', name: 'WorkspaceApp.tsx'},
      {path: 'README.md', name: 'README.md'},
      {path: 'src/file/FileExplorerTree.tsx', name: 'FileExplorerTree.tsx'},
    ]);

    expect(flattenFileSearchResultTree(tree).map(result => result.path)).toEqual([
      'src/app/WorkspaceApp.tsx',
      'src/file/FileExplorerTree.tsx',
      'README.md',
    ]);
  });

  test('orders filtered results by the source file tree order', () => {
    const tree = buildFileSearchResultTree(
      [
        {path: 'README.md', name: 'README.md'},
        {path: 'src/file/FileExplorerTree.tsx', name: 'FileExplorerTree.tsx'},
        {path: 'docs/Guide.md', name: 'Guide.md'},
        {path: 'src/app/WorkspaceApp.tsx', name: 'WorkspaceApp.tsx'},
      ],
      {
        dirEntries: {
          '.': [
            {kind: 'dir', name: 'src', path: 'src'},
            {kind: 'dir', name: 'docs', path: 'docs'},
            {kind: 'file', name: 'README.md', path: 'README.md'},
          ],
          src: [
            {kind: 'dir', name: 'app', path: 'src/app'},
            {kind: 'dir', name: 'file', path: 'src/file'},
          ],
          'src/app': [
            {kind: 'file', name: 'WorkspaceApp.tsx', path: 'src/app/WorkspaceApp.tsx'},
          ],
          'src/file': [
            {kind: 'file', name: 'FileExplorerTree.tsx', path: 'src/file/FileExplorerTree.tsx'},
          ],
          docs: [
            {kind: 'file', name: 'Guide.md', path: 'docs/Guide.md'},
          ],
        },
      },
    );

    expect(flattenFileSearchResultTree(tree).map(result => result.path)).toEqual([
      'src/app/WorkspaceApp.tsx',
      'src/file/FileExplorerTree.tsx',
      'docs/Guide.md',
      'README.md',
    ]);
  });

  test('flattens only files visible under expanded search directories', () => {
    const tree = buildFileSearchResultTree([
      {path: 'src/app/WorkspaceApp.tsx', name: 'WorkspaceApp.tsx'},
      {path: 'README.md', name: 'README.md'},
      {path: 'src/file/FileExplorerTree.tsx', name: 'FileExplorerTree.tsx'},
    ]);

    expect(
      flattenFileSearchResultTree(tree, {collapsedDirPaths: new Set(['src'])}).map(result => result.path),
    ).toEqual(['README.md']);
  });
});
