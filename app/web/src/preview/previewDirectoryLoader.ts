import type {RegistryFsEntry} from '../registry/registryTypes';

export type PreviewDirectoryResult = {
  entries: RegistryFsEntry[];
  hash?: string;
  notModified: boolean;
};

export async function fetchPreviewDirectoryEntries(options: {
  cachedEntries?: RegistryFsEntry[];
  knownHash?: string;
  forceRefresh?: boolean;
  request: (knownHash?: string) => Promise<PreviewDirectoryResult>;
}): Promise<{entries: RegistryFsEntry[]; hash: string}> {
  const cachedEntries = !options.forceRefresh && Array.isArray(options.cachedEntries)
    ? options.cachedEntries
    : undefined;
  const validatedHash = !options.forceRefresh && cachedEntries && options.knownHash
    ? options.knownHash
    : undefined;
  let result = await options.request(validatedHash);

  if (result.notModified && cachedEntries) {
    return {
      entries: cachedEntries,
      hash: result.hash || validatedHash || '',
    };
  }

  if (result.notModified) {
    result = await options.request(undefined);
    if (result.notModified) {
      throw new Error('Directory listing was not modified but no cached entries are available.');
    }
  }

  return {
    entries: result.entries,
    hash: result.hash || '',
  };
}

export function togglePreviewDirectoryExpansion(
  expandedByProject: Record<string, string[]>,
  projectId: string,
  path: string,
): Record<string, string[]> {
  if (!projectId || !path) {
    return expandedByProject;
  }
  const expanded = expandedByProject[projectId] ?? ['.'];
  const nextExpanded = expanded.includes(path)
    ? expanded.filter(item => item !== path)
    : [...expanded, path];
  return {
    ...expandedByProject,
    [projectId]: nextExpanded,
  };
}
