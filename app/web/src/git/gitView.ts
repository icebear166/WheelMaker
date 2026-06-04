import type {
  RegistryGitCommit,
  RegistryGitStatus,
} from '../registry/registryTypes';

export type GitDiffSource = 'commit' | 'worktree';

export type WorkingTreeFileEntry = {
  path: string;
  status: string;
  scope: 'staged' | 'unstaged' | 'untracked';
};

export type GitCommitPopoverState = {
  commit: RegistryGitCommit;
  x: number;
  y: number;
  width: number;
};

export const WORKING_TREE_COMMIT_ID = '__WORKING_TREE__';

export function buildWorkingTreeFiles(
  status: RegistryGitStatus,
): WorkingTreeFileEntry[] {
  const rows: WorkingTreeFileEntry[] = [];
  for (const item of status.unstaged ?? []) {
    if (!item.path) continue;
    rows.push({ path: item.path, status: item.status, scope: 'unstaged' });
  }
  for (const item of status.staged ?? []) {
    if (!item.path) continue;
    rows.push({ path: item.path, status: item.status, scope: 'staged' });
  }
  for (const item of status.untracked ?? []) {
    if (!item.path) continue;
    rows.push({
      path: item.path,
      status: item.status || 'U',
      scope: 'untracked',
    });
  }
  return rows;
}

export function isHeavyGeneratedDiffPath(path: string): boolean {
  const normalized = (path || '').replace(/\\/g, '/').toLowerCase();
  return (
    normalized.endsWith('/dist/bundle.js') ||
    normalized.endsWith('/dist/bundle.js.map') ||
    normalized.endsWith('/dist/index.html')
  );
}

export function pickPreferredPath<T extends { path: string }>(items: T[]): string {
  if (items.length === 0) return '';
  const preferred = items.find(item => !isHeavyGeneratedDiffPath(item.path));
  return (preferred ?? items[0]).path;
}

export function normalizeGitBranches(branches: string[], current: string): string[] {
  const merged: string[] = [];
  if (current.trim()) {
    merged.push(current.trim());
  }
  for (const branch of branches) {
    const trimmed = branch.trim();
    if (!trimmed) continue;
    merged.push(trimmed);
  }
  return [...new Set(merged)];
}

export function pickGitSelectedBranches(
  previous: string[],
  available: string[],
  current: string,
): string[] {
  const validPrevious = previous.filter(item => available.includes(item));
  if (validPrevious.length > 0) {
    return validPrevious;
  }
  const normalizedCurrent = current.trim();
  if (normalizedCurrent && available.includes(normalizedCurrent)) {
    return [normalizedCurrent];
  }
  if (available.length > 0) {
    return [available[0]];
  }
  return [];
}

export function splitPathForDisplay(path: string): {
  fileName: string;
  parentPath: string;
} {
  const normalized = (path || '').replaceAll('\\', '/');
  const separator = normalized.lastIndexOf('/');
  if (separator < 0) {
    return { fileName: normalized, parentPath: '' };
  }
  return {
    fileName: normalized.slice(separator + 1),
    parentPath: normalized.slice(0, separator),
  };
}

export function formatGitCommitDateTime(value: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function formatRelativeTime(value: string): string {
  if (!value) return 'just now';
  const parsed = new Date(value);
  const ts = parsed.getTime();
  if (Number.isNaN(ts)) return 'just now';
  const deltaMs = Date.now() - ts;
  const deltaMin = Math.max(0, Math.floor(deltaMs / 60000));
  if (deltaMin < 1) return 'just now';
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHour = Math.floor(deltaMin / 60);
  if (deltaHour < 24) return `${deltaHour}h ago`;
  const deltaDay = Math.floor(deltaHour / 24);
  if (deltaDay < 30) return `${deltaDay}d ago`;
  const deltaMonth = Math.floor(deltaDay / 30);
  if (deltaMonth < 12) return `${deltaMonth}mo ago`;
  const deltaYear = Math.floor(deltaMonth / 12);
  return `${deltaYear}y ago`;
}
