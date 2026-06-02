export type HubVisibilityState = 'checked' | 'mixed' | 'unchecked';

export type HubProjectPreferenceItem = {
  projectId: string;
  hubId?: string;
};

export const HUB_COLOR_PRESETS = [
  '#00a6a6',
  '#2f9e44',
  '#bc6c25',
  '#4f86c6',
  '#c879ff',
  '#ff6b6b',
  '#f9c74f',
  '#7b6cb8',
  '#038c7f',
  '#d9480f',
];

export const HUB_DEFAULT_COLORS = [
  '#00a6a6',
  '#2f9e44',
  '#bc6c25',
  '#4f86c6',
  '#c879ff',
  '#d9480f',
  '#038c7f',
  '#7b6cb8',
];

const HUB_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function sanitizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter(item => typeof item === 'string' && item)))
    : [];
}

export function sanitizeHubColor(value: unknown): string {
  return typeof value === 'string' && HUB_COLOR_PATTERN.test(value)
    ? value.toLowerCase()
    : '';
}

export function resolveHubColorVariantIndex(hubId: string): number {
  const normalized = hubId.trim().toLowerCase();
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash * 31) + normalized.charCodeAt(index)) >>> 0;
  }
  return hash % HUB_DEFAULT_COLORS.length;
}

export function resolveDefaultHubColor(hubId: string): string {
  return HUB_DEFAULT_COLORS[resolveHubColorVariantIndex(hubId)] ?? HUB_DEFAULT_COLORS[0];
}

export function resolveHubColor(hubColors: Record<string, unknown>, hubId: string): string {
  return sanitizeHubColor(hubColors[hubId]) || resolveDefaultHubColor(hubId);
}

export function sanitizeHubColorMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [hubId, color] of Object.entries(value as Record<string, unknown>)) {
    if (!hubId) continue;
    const sanitized = sanitizeHubColor(color);
    if (sanitized) {
      next[hubId] = sanitized;
    }
  }
  return next;
}

export function setHubColorPreference(
  current: Record<string, string>,
  hubId: string,
  color: string,
): Record<string, string> {
  if (!hubId) {
    return current;
  }
  const next = sanitizeHubColorMap(current);
  const sanitized = sanitizeHubColor(color);
  if (!sanitized) {
    delete next[hubId];
    return next;
  }
  next[hubId] = sanitized;
  return next;
}

export function splitProjectsByVisibility<T extends HubProjectPreferenceItem>(
  projects: T[],
  hiddenProjectIds: string[],
): {visibleProjects: T[]; hiddenProjects: T[]} {
  const hidden = new Set(hiddenProjectIds);
  const visibleProjects: T[] = [];
  const hiddenProjects: T[] = [];
  for (const project of projects) {
    if (hidden.has(project.projectId)) {
      hiddenProjects.push(project);
    } else {
      visibleProjects.push(project);
    }
  }
  return {visibleProjects, hiddenProjects};
}

export function toggleProjectVisibility(
  currentHiddenProjectIds: string[],
  projectId: string,
  visible: boolean,
): string[] {
  if (!projectId) {
    return currentHiddenProjectIds;
  }
  const current = sanitizeStringList(currentHiddenProjectIds);
  if (visible) {
    return current.filter(item => item !== projectId);
  }
  return current.includes(projectId) ? current : [...current, projectId];
}

export function toggleHubVisibility<T extends HubProjectPreferenceItem>(
  currentHiddenProjectIds: string[],
  hubProjects: T[],
  visible: boolean,
): string[] {
  const projectIds = hubProjects.map(project => project.projectId).filter(Boolean);
  if (projectIds.length === 0) {
    return sanitizeStringList(currentHiddenProjectIds);
  }
  const projectIdSet = new Set(projectIds);
  const current = sanitizeStringList(currentHiddenProjectIds);
  if (visible) {
    return current.filter(projectId => !projectIdSet.has(projectId));
  }
  const next = [...current];
  for (const projectId of projectIds) {
    if (!next.includes(projectId)) {
      next.push(projectId);
    }
  }
  return next;
}

export function resolveHubVisibilityState<T extends HubProjectPreferenceItem>(
  hubProjects: T[],
  hiddenProjectIds: string[],
): HubVisibilityState {
  if (hubProjects.length === 0) {
    return 'checked';
  }
  const hidden = new Set(hiddenProjectIds);
  const hiddenCount = hubProjects.reduce(
    (count, project) => count + (hidden.has(project.projectId) ? 1 : 0),
    0,
  );
  if (hiddenCount === 0) {
    return 'checked';
  }
  return hiddenCount === hubProjects.length ? 'unchecked' : 'mixed';
}

export function findNextVisibleProject<T extends HubProjectPreferenceItem>(
  projects: T[],
  hiddenProjectIds: string[],
  currentProjectId: string,
): T | null {
  const hidden = new Set(hiddenProjectIds);
  const visibleProjects = projects.filter(project => !hidden.has(project.projectId));
  if (visibleProjects.length === 0) {
    return null;
  }
  const currentIndex = projects.findIndex(project => project.projectId === currentProjectId);
  const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
  for (let offset = 0; offset < projects.length; offset += 1) {
    const index = (startIndex + offset) % projects.length;
    const project = projects[index];
    if (project && !hidden.has(project.projectId)) {
      return project;
    }
  }
  return null;
}
