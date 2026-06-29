import type {RegistryFileIndexSearchResult, RegistryFsEntry} from '../registry/registryTypes';

export type FileSearchResultTreeNode =
  | {
      kind: 'dir';
      name: string;
      path: string;
      children: FileSearchResultTreeNode[];
    }
  | {
      kind: 'file';
      name: string;
      path: string;
      result: RegistryFileIndexSearchResult;
    };

type MutableFileSearchResultDirectory = {
  kind: 'dir';
  name: string;
  path: string;
  children: FileSearchResultTreeNode[];
  childDirs: Map<string, MutableFileSearchResultDirectory>;
};

type NormalizedFileSearchResult = {
  path: string;
  name: string;
  result: RegistryFileIndexSearchResult;
};

type BuildFileSearchResultTreeOptions = {
  dirEntries?: Record<string, RegistryFsEntry[]>;
};

type FlattenFileSearchResultTreeOptions = {
  collapsedDirPaths?: ReadonlySet<string> | readonly string[];
};

function createDirectory(name: string, path: string): MutableFileSearchResultDirectory {
  return {
    kind: 'dir',
    name,
    path,
    children: [],
    childDirs: new Map(),
  };
}

function normalizeResultPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function normalizeDirectoryPath(path: string): string {
  const normalized = normalizeResultPath(path);
  return normalized === '.' ? '' : normalized;
}

function normalizeResults(results: RegistryFileIndexSearchResult[]): NormalizedFileSearchResult[] {
  const seenFiles = new Set<string>();
  const normalizedResults: NormalizedFileSearchResult[] = [];

  results.forEach(result => {
    const normalizedPath = normalizeResultPath(result.path);
    if (!normalizedPath || seenFiles.has(normalizedPath)) {
      return;
    }
    seenFiles.add(normalizedPath);

    const parts = normalizedPath.split('/').filter(Boolean);
    if (parts.length === 0) {
      return;
    }

    const fileName = result.name || parts[parts.length - 1] || normalizedPath;
    normalizedResults.push({
      path: normalizedPath,
      name: fileName,
      result: {...result, path: normalizedPath, name: fileName},
    });
  });

  return normalizedResults;
}

function createFileNode(result: NormalizedFileSearchResult): FileSearchResultTreeNode {
  return {
    kind: 'file',
    name: result.name,
    path: result.path,
    result: result.result,
  };
}

function toPublicNode(node: FileSearchResultTreeNode): FileSearchResultTreeNode {
  if (node.kind === 'file') {
    return node;
  }
  return {
    kind: 'dir',
    name: node.name,
    path: node.path,
    children: node.children.map(toPublicNode),
  };
}

function buildTreeFromNormalizedResults(
  results: NormalizedFileSearchResult[],
  basePath = '',
): FileSearchResultTreeNode[] {
  const root = createDirectory('', '');

  results.forEach(result => {
    const relativePath = basePath && result.path.startsWith(`${basePath}/`)
      ? result.path.slice(basePath.length + 1)
      : result.path;
    const parts = relativePath.split('/').filter(Boolean);
    if (parts.length === 0) {
      return;
    }

    let directory = root;
    parts.slice(0, -1).forEach(part => {
      const childPath = directory.path
        ? `${directory.path}/${part}`
        : basePath
          ? `${basePath}/${part}`
          : part;
      let child = directory.childDirs.get(part);
      if (!child) {
        child = createDirectory(part, childPath);
        directory.childDirs.set(part, child);
        directory.children.push(child);
      }
      directory = child;
    });

    directory.children.push(createFileNode(result));
  });

  return root.children.map(toPublicNode);
}

function resultIsInDirectory(resultPath: string, directoryPath: string): boolean {
  if (!directoryPath) {
    return true;
  }
  return resultPath.startsWith(`${directoryPath}/`);
}

function compareNormalizedPath(a: NormalizedFileSearchResult, b: NormalizedFileSearchResult): number {
  return a.path.localeCompare(b.path);
}

function buildTreeFromSourceOrder(
  results: NormalizedFileSearchResult[],
  dirEntries: Record<string, RegistryFsEntry[]>,
): FileSearchResultTreeNode[] {
  const resultByPath = new Map(results.map(result => [result.path, result]));
  const seen = new Set<string>();

  const markSeen = (nodes: FileSearchResultTreeNode[]) => {
    nodes.forEach(node => {
      if (node.kind === 'file') {
        seen.add(node.path);
        return;
      }
      markSeen(node.children);
    });
  };

  const buildDirectory = (directoryPath: string): FileSearchResultTreeNode[] => {
    const entries = dirEntries[directoryPath || '.'];
    if (!entries) {
      const fallbackResults = results
        .filter(result => !seen.has(result.path) && resultIsInDirectory(result.path, directoryPath))
        .sort(compareNormalizedPath);
      const nodes = buildTreeFromNormalizedResults(fallbackResults, directoryPath);
      markSeen(nodes);
      return nodes;
    }

    const nodes: FileSearchResultTreeNode[] = [];
    entries.forEach(entry => {
      const normalizedEntryPath = normalizeResultPath(entry.path);
      if (entry.kind === 'file') {
        const result = resultByPath.get(normalizedEntryPath);
        if (result && !seen.has(result.path)) {
          seen.add(result.path);
          nodes.push(createFileNode(result));
        }
        return;
      }

      const childPath = normalizeDirectoryPath(entry.path);
      const children = buildDirectory(childPath);
      if (children.length > 0) {
        nodes.push({
          kind: 'dir',
          name: entry.name,
          path: childPath,
          children,
        });
      }
    });
    return nodes;
  };

  const orderedNodes = buildDirectory('');
  const remainingResults = results
    .filter(result => !seen.has(result.path))
    .sort(compareNormalizedPath);

  return [
    ...orderedNodes,
    ...buildTreeFromNormalizedResults(remainingResults),
  ];
}

export function buildFileSearchResultTree(
  results: RegistryFileIndexSearchResult[],
  options: BuildFileSearchResultTreeOptions = {},
): FileSearchResultTreeNode[] {
  const normalizedResults = normalizeResults(results);
  if (options.dirEntries) {
    return buildTreeFromSourceOrder(normalizedResults, options.dirEntries);
  }
  return buildTreeFromNormalizedResults(normalizedResults);
}

export function flattenFileSearchResultTree(
  nodes: FileSearchResultTreeNode[],
  options: FlattenFileSearchResultTreeOptions = {},
): RegistryFileIndexSearchResult[] {
  const collapsedDirPaths = options.collapsedDirPaths instanceof Set
    ? options.collapsedDirPaths
    : new Set(options.collapsedDirPaths ?? []);
  const results: RegistryFileIndexSearchResult[] = [];
  nodes.forEach(node => {
    if (node.kind === 'file') {
      results.push(node.result);
      return;
    }
    if (!collapsedDirPaths.has(node.path)) {
      results.push(...flattenFileSearchResultTree(node.children, {collapsedDirPaths}));
    }
  });
  return results;
}
