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
});
