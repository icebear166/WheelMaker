import type {RegistryFileIndexSearchResult} from '../registry/registryTypes';

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

function createDirectory(name: string, path: string): MutableFileSearchResultDirectory {
  return {
    kind: 'dir',
    name,
    path,
    children: [],
    childDirs: new Map(),
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

export function buildFileSearchResultTree(
  results: RegistryFileIndexSearchResult[],
): FileSearchResultTreeNode[] {
  const root = createDirectory('', '');
  const seenFiles = new Set<string>();

  results.forEach(result => {
    const normalizedPath = result.path.replace(/\\/g, '/').replace(/^\.?\//, '');
    if (!normalizedPath || seenFiles.has(normalizedPath)) {
      return;
    }
    seenFiles.add(normalizedPath);

    const parts = normalizedPath.split('/').filter(Boolean);
    if (parts.length === 0) {
      return;
    }

    let directory = root;
    parts.slice(0, -1).forEach(part => {
      const childPath = directory.path ? `${directory.path}/${part}` : part;
      let child = directory.childDirs.get(part);
      if (!child) {
        child = createDirectory(part, childPath);
        directory.childDirs.set(part, child);
        directory.children.push(child);
      }
      directory = child;
    });

    const fileName = result.name || parts[parts.length - 1] || normalizedPath;
    directory.children.push({
      kind: 'file',
      name: fileName,
      path: normalizedPath,
      result: {...result, path: normalizedPath, name: fileName},
    });
  });

  return root.children.map(toPublicNode);
}

export function flattenFileSearchResultTree(
  nodes: FileSearchResultTreeNode[],
): RegistryFileIndexSearchResult[] {
  const results: RegistryFileIndexSearchResult[] = [];
  nodes.forEach(node => {
    if (node.kind === 'file') {
      results.push(node.result);
      return;
    }
    results.push(...flattenFileSearchResultTree(node.children));
  });
  return results;
}
