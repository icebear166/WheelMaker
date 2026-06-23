import type {RegistryFsInfo} from '../registry/registryTypes';

export type FilePreviewWorkbenchTab = {
  path: string;
  targetLine: number | null;
  content: string;
  info: RegistryFsInfo | null;
  loading: boolean;
  error: string;
  requestId: number;
};

export type FilePreviewWorkbenchState = {
  activeProjectId: string;
  tabsByProjectId: Record<string, FilePreviewWorkbenchTab[]>;
  activePathByProjectId: Record<string, string>;
  treeOpen: boolean;
};

const normalizeLine = (line: number | null): number | null =>
  typeof line === 'number' && Number.isFinite(line) && line > 0
    ? Math.trunc(line)
    : null;

const emptyTab = (path: string, targetLine: number | null): FilePreviewWorkbenchTab => ({
  path,
  targetLine: normalizeLine(targetLine),
  content: '',
  info: null,
  loading: false,
  error: '',
  requestId: 0,
});

export function createFilePreviewWorkbenchState(activeProjectId = ''): FilePreviewWorkbenchState {
  return {
    activeProjectId,
    tabsByProjectId: activeProjectId ? {[activeProjectId]: []} : {},
    activePathByProjectId: {},
    treeOpen: false,
  };
}

export function selectFilePreviewProject(
  state: FilePreviewWorkbenchState,
  projectId: string,
): FilePreviewWorkbenchState {
  if (!projectId || projectId === state.activeProjectId) {
    return state;
  }
  return {
    ...state,
    activeProjectId: projectId,
    tabsByProjectId: {
      ...state.tabsByProjectId,
      [projectId]: state.tabsByProjectId[projectId] ?? [],
    },
  };
}

export function ensureFilePreviewProjectVisible(
  state: FilePreviewWorkbenchState,
  visibleProjectIds: string[],
  preferredProjectId = '',
): FilePreviewWorkbenchState {
  if (state.activeProjectId && visibleProjectIds.includes(state.activeProjectId)) {
    return state;
  }
  const nextProjectId =
    preferredProjectId && visibleProjectIds.includes(preferredProjectId)
      ? preferredProjectId
      : visibleProjectIds[0] ?? '';
  return nextProjectId ? selectFilePreviewProject(state, nextProjectId) : state;
}

export function openFilePreviewTab(
  state: FilePreviewWorkbenchState,
  projectId: string,
  path: string,
  targetLine: number | null,
): FilePreviewWorkbenchState {
  if (!projectId || !path) {
    return state;
  }
  const projectState = selectFilePreviewProject(state, projectId);
  const tabs = projectState.tabsByProjectId[projectId] ?? [];
  const normalizedLine = normalizeLine(targetLine);
  const existing = tabs.find(tab => tab.path === path);
  const nextTabs = existing
    ? tabs.map(tab => (tab.path === path ? {...tab, targetLine: normalizedLine} : tab))
    : [...tabs, emptyTab(path, normalizedLine)];
  return {
    ...projectState,
    tabsByProjectId: {...projectState.tabsByProjectId, [projectId]: nextTabs},
    activePathByProjectId: {...projectState.activePathByProjectId, [projectId]: path},
  };
}

export function beginFilePreviewTabLoad(
  state: FilePreviewWorkbenchState,
  projectId: string,
  path: string,
  requestId: number,
): FilePreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  return {
    ...state,
    tabsByProjectId: {
      ...state.tabsByProjectId,
      [projectId]: tabs.map(tab =>
        tab.path === path ? {...tab, loading: true, error: '', requestId} : tab,
      ),
    },
  };
}

export function completeFilePreviewTabLoad(
  state: FilePreviewWorkbenchState,
  projectId: string,
  path: string,
  requestId: number,
  info: RegistryFsInfo,
  content: string,
): FilePreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  return {
    ...state,
    tabsByProjectId: {
      ...state.tabsByProjectId,
      [projectId]: tabs.map(tab =>
        tab.path === path && tab.requestId === requestId
          ? {...tab, info, content, loading: false, error: ''}
          : tab,
      ),
    },
  };
}

export function failFilePreviewTabLoad(
  state: FilePreviewWorkbenchState,
  projectId: string,
  path: string,
  requestId: number,
  error: string,
): FilePreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  return {
    ...state,
    tabsByProjectId: {
      ...state.tabsByProjectId,
      [projectId]: tabs.map(tab =>
        tab.path === path && tab.requestId === requestId
          ? {...tab, content: '', info: null, loading: false, error}
          : tab,
      ),
    },
  };
}

export function closeFilePreviewTab(
  state: FilePreviewWorkbenchState,
  projectId: string,
  path: string,
): FilePreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  const closingIndex = tabs.findIndex(tab => tab.path === path);
  if (closingIndex < 0) {
    return state;
  }
  const nextTabs = tabs.filter(tab => tab.path !== path);
  const currentActivePath = state.activePathByProjectId[projectId] ?? '';
  const nextActivePath =
    currentActivePath === path
      ? nextTabs[Math.min(closingIndex, Math.max(0, nextTabs.length - 1))]?.path ?? ''
      : currentActivePath;
  return {
    ...state,
    tabsByProjectId: {...state.tabsByProjectId, [projectId]: nextTabs},
    activePathByProjectId: {...state.activePathByProjectId, [projectId]: nextActivePath},
  };
}

export function activeFilePreviewTab(
  state: FilePreviewWorkbenchState,
): FilePreviewWorkbenchTab | null {
  const projectId = state.activeProjectId;
  const activePath = state.activePathByProjectId[projectId] ?? '';
  return (state.tabsByProjectId[projectId] ?? []).find(tab => tab.path === activePath) ?? null;
}
