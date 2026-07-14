import type {RegistryFsInfo, RegistrySessionPromptArtifactFile} from '../registry/registryTypes';

export type PreviewWorkbenchTabType = 'file' | 'prompt-diff' | 'attachment' | 'port-relay';

export type PreviewWorkbenchTabBase = {
  id: string;
  type: PreviewWorkbenchTabType;
  projectId: string;
  title: string;
  loading: boolean;
  error: string;
  requestId: number;
};

export type FilePreviewTab = PreviewWorkbenchTabBase & {
  type: 'file';
  path: string;
  targetLine: number | null;
  content: string;
  info: RegistryFsInfo | null;
};

export type PromptDiffPreviewFile = RegistrySessionPromptArtifactFile & {
  diff: string;
  expanded: boolean;
};

export type PromptDiffPreviewTab = PreviewWorkbenchTabBase & {
  type: 'prompt-diff';
  sessionId: string;
  artifactId: string;
  promptText: string;
  promptSummary: string;
  files: PromptDiffPreviewFile[];
};

export type AttachmentPreviewTab = PreviewWorkbenchTabBase & {
  type: 'attachment';
  sessionId: string;
  attachmentKey: string;
  meta: string;
  mimeType: string;
  kind: 'image' | 'file';
  src: string;
  content?: string;
  isBinary?: boolean;
};

export type PortRelayPreviewTab = PreviewWorkbenchTabBase & {
  type: 'port-relay';
  hubId: string;
  targetPort: number;
  framePath: string;
  url: string;
  reloadKey: number;
};

export type PreviewWorkbenchTab =
  | FilePreviewTab
  | PromptDiffPreviewTab
  | AttachmentPreviewTab
  | PortRelayPreviewTab;

export type PreviewWorkbenchOpenInput =
  | {
      type: 'file';
      projectId: string;
      path: string;
      targetLine: number | null;
      title: string;
    }
  | {
      type: 'prompt-diff';
      projectId: string;
      sessionId: string;
      artifactId: string;
      title: string;
      promptText?: string;
      promptSummary?: string;
      files: PromptDiffPreviewFile[];
    }
  | {
      type: 'attachment';
      projectId: string;
      sessionId: string;
      attachmentKey: string;
      title: string;
      meta: string;
      mimeType: string;
      kind: 'image' | 'file';
      src: string;
    }
  | {
      type: 'port-relay';
      projectId: string;
      hubId: string;
      targetPort: number;
      framePath: string;
      title: string;
      url?: string;
      reloadKey?: number;
    };

export type PreviewWorkbenchTabIdInput =
  | {type: 'file'; path?: string}
  | {type: 'prompt-diff'; sessionId?: string; artifactId?: string}
  | {type: 'attachment'; sessionId?: string; attachmentKey?: string}
  | {type: 'port-relay'; hubId?: string; targetPort?: number; framePath?: string};

export type PreviewWorkbenchState = {
  activeProjectId: string;
  tabsByProjectId: Record<string, PreviewWorkbenchTab[]>;
  activeTabIdByProjectId: Record<string, string>;
  renderedTabIdsByProjectId: Record<string, string[]>;
  treeOpen: boolean;
};

export const PREVIEW_WORKBENCH_SNAPSHOT_VERSION = 1;

export type PreviewWorkbenchSnapshotFileTab = {
  type: 'file';
  projectId: string;
  path: string;
  targetLine: number | null;
  title: string;
};

export type PreviewWorkbenchSnapshotPromptDiffTab = {
  type: 'prompt-diff';
  projectId: string;
  sessionId: string;
  artifactId: string;
  title: string;
  promptText: string;
  promptSummary: string;
  files: Array<RegistrySessionPromptArtifactFile & {expanded: boolean}>;
};

export type PreviewWorkbenchSnapshotAttachmentTab = {
  type: 'attachment';
  projectId: string;
  sessionId: string;
  attachmentKey: string;
  title: string;
  meta: string;
  mimeType: string;
  kind: 'image' | 'file';
};

export type PreviewWorkbenchSnapshotPortRelayTab = {
  type: 'port-relay';
  projectId: string;
  hubId: string;
  targetPort: number;
  framePath: string;
  title: string;
  url: string;
  reloadKey: number;
};

export type PreviewWorkbenchSnapshotTab =
  | PreviewWorkbenchSnapshotFileTab
  | PreviewWorkbenchSnapshotPromptDiffTab
  | PreviewWorkbenchSnapshotAttachmentTab
  | PreviewWorkbenchSnapshotPortRelayTab;

export type PreviewWorkbenchSnapshot = {
  version: typeof PREVIEW_WORKBENCH_SNAPSHOT_VERSION;
  activeProjectId: string;
  tabsByProjectId: Record<string, PreviewWorkbenchSnapshotTab[]>;
  activeTabIdByProjectId: Record<string, string>;
  renderedTabIdsByProjectId: Record<string, string[]>;
  treeOpen: boolean;
};

export type PreviewSearchMatch =
  | {
      kind: 'file';
      line: number;
      text: string;
    }
  | {
      kind: 'diff';
      path: string;
      line: number;
      text: string;
    };

const normalizeLine = (line: number | null): number | null =>
  typeof line === 'number' && Number.isFinite(line) && line > 0
    ? Math.trunc(line)
    : null;

const normalizeFramePath = (path: string): string => path || '';

const hasText = (value: string | undefined): value is string => !!value;

function compactLabel(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...` : normalized;
}

function fileCountLabel(fileCount: number): string {
  return `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
}

function portRelayLabel(tab: Pick<PortRelayPreviewTab, 'hubId' | 'targetPort' | 'framePath'>): string {
  return `${tab.hubId}:${tab.targetPort}${tab.framePath || ''}`;
}

export function previewTabId(input: PreviewWorkbenchTabIdInput): string {
  if (input.type === 'file') {
    return `file:${input.path || ''}`;
  }
  if (input.type === 'prompt-diff') {
    return `prompt-diff:${input.sessionId || ''}:${input.artifactId || ''}`;
  }
  if (input.type === 'attachment') {
    return `attachment:${input.sessionId || ''}:${input.attachmentKey || ''}`;
  }
  return `port-relay:${input.hubId || ''}:${input.targetPort || 0}:${normalizeFramePath(input.framePath || '')}`;
}

export function cyclePreviewTabId(
  tabs: PreviewWorkbenchTab[],
  activeTabId: string,
  direction: 1 | -1,
): string {
  if (tabs.length === 0) {
    return '';
  }
  const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === activeTabId));
  const nextIndex = (activeIndex + direction + tabs.length) % tabs.length;
  return tabs[nextIndex]?.id ?? '';
}

export function previewWorkbenchTabTooltip(tab: PreviewWorkbenchTab): string {
  if (tab.type === 'file') {
    return tab.path || tab.title;
  }
  if (tab.type === 'prompt-diff') {
    const paths = tab.files.map(file => file.path).filter(Boolean);
    return [
      tab.promptText || tab.promptSummary || 'Prompt diff',
      fileCountLabel(tab.files.length),
      paths.join(', '),
    ].filter(Boolean).join(' - ');
  }
  if (tab.type === 'attachment') {
    return [tab.title, tab.mimeType, tab.meta, tab.attachmentKey].filter(Boolean).join(' - ');
  }
  return tab.url || portRelayLabel(tab);
}

export function previewWorkbenchHeaderTitle(tab: PreviewWorkbenchTab | null): string {
  if (!tab) {
    return 'Preview';
  }
  if (tab.type === 'file') {
    return tab.path || tab.title;
  }
  if (tab.type === 'prompt-diff') {
    const summary = tab.promptSummary || compactLabel(tab.promptText, 48);
    return summary
      ? `Prompt diff · "${summary}" · ${fileCountLabel(tab.files.length)}`
      : `Prompt diff · ${fileCountLabel(tab.files.length)}`;
  }
  if (tab.type === 'attachment') {
    return ['Attachment', tab.title, tab.mimeType].filter(Boolean).join(' · ');
  }
  return `Port Relay · ${portRelayLabel(tab)}`;
}

export function buildPreviewSearchMatches(
  tab: PreviewWorkbenchTab | null,
  query: string,
): PreviewSearchMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!tab || !normalizedQuery) {
    return [];
  }
  if (tab.type === 'file') {
    return tab.content
      .split('\n')
      .map((text, index) => ({kind: 'file' as const, line: index + 1, text}))
      .filter(match => match.text.toLocaleLowerCase().includes(normalizedQuery));
  }
  if (tab.type === 'prompt-diff') {
    return tab.files.flatMap(file =>
      file.diff
        .split('\n')
        .map((text, index) => ({kind: 'diff' as const, path: file.path, line: index + 1, text}))
        .filter(match => match.text.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }
  return [];
}

export function previewSearchDocumentKey(tab: PreviewWorkbenchTab | null): string {
  if (!tab) {
    return '';
  }
  if (tab.type === 'file') {
    return tab.content;
  }
  if (tab.type === 'prompt-diff') {
    return tab.files
      .map(file => `${file.path}\0${file.diff}`)
      .join('\u0001');
  }
  return '';
}

function validPreviewInput(input: PreviewWorkbenchOpenInput): boolean {
  if (!input.projectId) {
    return false;
  }
  if (input.type === 'file') {
    return hasText(input.path);
  }
  if (input.type === 'prompt-diff') {
    return hasText(input.sessionId) && hasText(input.artifactId);
  }
  if (input.type === 'attachment') {
    return hasText(input.sessionId) && hasText(input.attachmentKey);
  }
  return hasText(input.hubId) && Number.isInteger(input.targetPort) && input.targetPort > 0;
}

export function createPreviewWorkbenchState(activeProjectId = ''): PreviewWorkbenchState {
  return {
    activeProjectId,
    tabsByProjectId: activeProjectId ? {[activeProjectId]: []} : {},
    activeTabIdByProjectId: {},
    renderedTabIdsByProjectId: activeProjectId ? {[activeProjectId]: []} : {},
    treeOpen: false,
  };
}

function previewSnapshotTab(tab: PreviewWorkbenchTab): PreviewWorkbenchSnapshotTab {
  if (tab.type === 'file') {
    return {
      type: 'file',
      projectId: tab.projectId,
      path: tab.path,
      targetLine: tab.targetLine,
      title: tab.title,
    };
  }
  if (tab.type === 'prompt-diff') {
    return {
      type: 'prompt-diff',
      projectId: tab.projectId,
      sessionId: tab.sessionId,
      artifactId: tab.artifactId,
      title: tab.title,
      promptText: tab.promptText,
      promptSummary: tab.promptSummary,
      files: tab.files.map(file => ({
        path: file.path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        expanded: file.expanded,
      })),
    };
  }
  if (tab.type === 'attachment') {
    return {
      type: 'attachment',
      projectId: tab.projectId,
      sessionId: tab.sessionId,
      attachmentKey: tab.attachmentKey,
      title: tab.title,
      meta: tab.meta,
      mimeType: tab.mimeType,
      kind: tab.kind,
    };
  }
  return {
    type: 'port-relay',
    projectId: tab.projectId,
    hubId: tab.hubId,
    targetPort: tab.targetPort,
    framePath: tab.framePath,
    title: tab.title,
    url: tab.url,
    reloadKey: tab.reloadKey,
  };
}

export function previewWorkbenchSnapshotFromState(
  state: PreviewWorkbenchState,
): PreviewWorkbenchSnapshot {
  const tabsByProjectId = Object.fromEntries(
    Object.entries(state.tabsByProjectId)
      .map(([projectId, tabs]) => [
        projectId,
        tabs.map(previewSnapshotTab),
      ])
      .filter(([, tabs]) => Array.isArray(tabs) && tabs.length > 0),
  );
  return {
    version: PREVIEW_WORKBENCH_SNAPSHOT_VERSION,
    activeProjectId: state.activeProjectId,
    tabsByProjectId,
    activeTabIdByProjectId: {...state.activeTabIdByProjectId},
    renderedTabIdsByProjectId: Object.fromEntries(
      Object.entries(state.renderedTabIdsByProjectId)
        .map(([projectId, ids]) => [projectId, ids.filter(Boolean)])
        .filter(([, ids]) => Array.isArray(ids) && ids.length > 0),
    ),
    treeOpen: state.treeOpen,
  };
}

function previewSnapshotInput(tab: PreviewWorkbenchSnapshotTab): PreviewWorkbenchOpenInput {
  if (tab.type === 'file') {
    return {
      type: 'file',
      projectId: tab.projectId,
      path: tab.path,
      targetLine: tab.targetLine,
      title: tab.title,
    };
  }
  if (tab.type === 'prompt-diff') {
    return {
      type: 'prompt-diff',
      projectId: tab.projectId,
      sessionId: tab.sessionId,
      artifactId: tab.artifactId,
      title: tab.title,
      promptText: tab.promptText,
      promptSummary: tab.promptSummary,
      files: tab.files.map(file => ({
        path: file.path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        expanded: file.expanded,
        diff: '',
      })),
    };
  }
  if (tab.type === 'attachment') {
    return {
      type: 'attachment',
      projectId: tab.projectId,
      sessionId: tab.sessionId,
      attachmentKey: tab.attachmentKey,
      title: tab.title,
      meta: tab.meta,
      mimeType: tab.mimeType,
      kind: tab.kind,
      src: '',
    };
  }
  return {
    type: 'port-relay',
    projectId: tab.projectId,
    hubId: tab.hubId,
    targetPort: tab.targetPort,
    framePath: tab.framePath,
    title: tab.title,
    url: tab.url,
    reloadKey: tab.reloadKey,
  };
}

function restorePreviewSnapshotTab(tab: PreviewWorkbenchSnapshotTab): PreviewWorkbenchTab | null {
  const input = previewSnapshotInput(tab);
  return validPreviewInput(input) ? createTab(input) : null;
}

export function previewWorkbenchStateFromSnapshot(
  snapshot: PreviewWorkbenchSnapshot | null | undefined,
): PreviewWorkbenchState {
  if (!snapshot || snapshot.version !== PREVIEW_WORKBENCH_SNAPSHOT_VERSION) {
    return createPreviewWorkbenchState();
  }
  const tabsByProjectId: Record<string, PreviewWorkbenchTab[]> = {};
  for (const [projectId, tabs] of Object.entries(snapshot.tabsByProjectId ?? {})) {
    const restoredTabs = tabs
      .map(restorePreviewSnapshotTab)
      .filter((tab): tab is PreviewWorkbenchTab => !!tab);
    if (projectId && restoredTabs.length > 0) {
      tabsByProjectId[projectId] = restoredTabs;
    }
  }
  const availableIdsByProject: Record<string, Set<string>> = {};
  for (const [projectId, tabs] of Object.entries(tabsByProjectId)) {
    availableIdsByProject[projectId] = new Set(tabs.map(tab => tab.id));
  }
  const activeTabIdByProjectId = Object.fromEntries(
    Object.entries(snapshot.activeTabIdByProjectId ?? {})
      .filter(([projectId, tabId]) => availableIdsByProject[projectId]?.has(tabId)),
  );
  const renderedTabIdsByProjectId = Object.fromEntries(
    Object.entries(snapshot.renderedTabIdsByProjectId ?? {})
      .map(([projectId, ids]) => [
        projectId,
        ids.filter(id => availableIdsByProject[projectId]?.has(id)),
      ])
      .filter(([projectId, ids]) => !!projectId && ids.length > 0),
  );
  const projectIds = Object.keys(tabsByProjectId);
  const activeProjectId =
    snapshot.activeProjectId && projectIds.includes(snapshot.activeProjectId)
      ? snapshot.activeProjectId
      : projectIds[0] ?? '';
  return {
    activeProjectId,
    tabsByProjectId,
    activeTabIdByProjectId,
    renderedTabIdsByProjectId,
    treeOpen: snapshot.treeOpen === true,
  };
}

function addRenderedTabId(state: PreviewWorkbenchState, projectId: string, tabId: string): PreviewWorkbenchState {
  if (!projectId || !tabId) {
    return state;
  }
  const renderedIds = state.renderedTabIdsByProjectId[projectId] ?? [];
  if (renderedIds.includes(tabId)) {
    return state;
  }
  return {
    ...state,
    renderedTabIdsByProjectId: {
      ...state.renderedTabIdsByProjectId,
      [projectId]: [...renderedIds, tabId],
    },
  };
}

function removeRenderedTabId(state: PreviewWorkbenchState, projectId: string, tabId: string): PreviewWorkbenchState {
  const renderedIds = state.renderedTabIdsByProjectId[projectId] ?? [];
  if (!renderedIds.includes(tabId)) {
    return state;
  }
  return {
    ...state,
    renderedTabIdsByProjectId: {
      ...state.renderedTabIdsByProjectId,
      [projectId]: renderedIds.filter(id => id !== tabId),
    },
  };
}

export function selectPreviewProject(
  state: PreviewWorkbenchState,
  projectId: string,
): PreviewWorkbenchState {
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
    renderedTabIdsByProjectId: {
      ...state.renderedTabIdsByProjectId,
      [projectId]: state.renderedTabIdsByProjectId[projectId] ?? [],
    },
  };
}

export function ensurePreviewProjectVisible(
  state: PreviewWorkbenchState,
  visibleProjectIds: string[],
  preferredProjectId = '',
): PreviewWorkbenchState {
  if (state.activeProjectId && visibleProjectIds.includes(state.activeProjectId)) {
    return state;
  }
  const nextProjectId =
    preferredProjectId && visibleProjectIds.includes(preferredProjectId)
      ? preferredProjectId
      : visibleProjectIds[0] ?? '';
  return nextProjectId ? selectPreviewProject(state, nextProjectId) : state;
}

function createTab(input: PreviewWorkbenchOpenInput): PreviewWorkbenchTab {
  const id = previewTabId(input);
  const base = {
    id,
    type: input.type,
    projectId: input.projectId,
    title: input.title,
    loading: false,
    error: '',
    requestId: 0,
  };
  if (input.type === 'file') {
    return {
      ...base,
      type: 'file',
      path: input.path,
      targetLine: normalizeLine(input.targetLine),
      content: '',
      info: null,
    };
  }
  if (input.type === 'prompt-diff') {
    return {
      ...base,
      type: 'prompt-diff',
      sessionId: input.sessionId,
      artifactId: input.artifactId,
      promptText: input.promptText ?? '',
      promptSummary: input.promptSummary ?? compactLabel(input.promptText ?? '', 48),
      files: input.files,
    };
  }
  if (input.type === 'attachment') {
    return {
      ...base,
      type: 'attachment',
      sessionId: input.sessionId,
      attachmentKey: input.attachmentKey,
      meta: input.meta,
      mimeType: input.mimeType,
      kind: input.kind,
      src: input.src,
    };
  }
  return {
    ...base,
    type: 'port-relay',
    hubId: input.hubId,
    targetPort: input.targetPort,
    framePath: normalizeFramePath(input.framePath),
    url: input.url ?? '',
    reloadKey: input.reloadKey ?? 0,
  };
}

function mergeTab(existing: PreviewWorkbenchTab, input: PreviewWorkbenchOpenInput): PreviewWorkbenchTab {
  if (existing.type === 'file' && input.type === 'file') {
    return {...existing, title: input.title, targetLine: normalizeLine(input.targetLine)};
  }
  if (existing.type === 'prompt-diff' && input.type === 'prompt-diff') {
    return {
      ...existing,
      title: input.title,
      promptText: input.promptText ?? existing.promptText,
      promptSummary: input.promptSummary ?? existing.promptSummary,
      files: input.files,
    };
  }
  if (existing.type === 'attachment' && input.type === 'attachment') {
    return {
      ...existing,
      title: input.title,
      meta: input.meta,
      mimeType: input.mimeType,
      kind: input.kind,
      src: input.src,
    };
  }
  if (existing.type === 'port-relay' && input.type === 'port-relay') {
    return {
      ...existing,
      title: input.title,
      framePath: normalizeFramePath(input.framePath),
      url: input.url ?? existing.url,
      reloadKey: input.reloadKey ?? existing.reloadKey,
    };
  }
  return existing;
}

export function openPreviewTab(
  state: PreviewWorkbenchState,
  input: PreviewWorkbenchOpenInput,
): PreviewWorkbenchState {
  if (!validPreviewInput(input)) {
    return state;
  }
  const id = previewTabId(input);
  const projectState = selectPreviewProject(state, input.projectId);
  const tabs = projectState.tabsByProjectId[input.projectId] ?? [];
  const existing = tabs.find(tab => tab.id === id);
  const nextTabs = existing
    ? tabs.map(tab => (tab.id === id ? mergeTab(tab, input) : tab))
    : [...tabs, createTab(input)];
  return addRenderedTabId({
    ...projectState,
    tabsByProjectId: {...projectState.tabsByProjectId, [input.projectId]: nextTabs},
    activeTabIdByProjectId: {...projectState.activeTabIdByProjectId, [input.projectId]: id},
  }, input.projectId, id);
}

export function selectPreviewTab(
  state: PreviewWorkbenchState,
  projectId: string,
  tabId: string,
): PreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  if (!tabs.some(tab => tab.id === tabId)) {
    return state;
  }
  return addRenderedTabId({
    ...state,
    activeTabIdByProjectId: {
      ...state.activeTabIdByProjectId,
      [projectId]: tabId,
    },
  }, projectId, tabId);
}

export function beginPreviewTabLoad(
  state: PreviewWorkbenchState,
  projectId: string,
  tabId: string,
  requestId: number,
): PreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  return {
    ...state,
    tabsByProjectId: {
      ...state.tabsByProjectId,
      [projectId]: tabs.map(tab =>
        tab.id === tabId ? {...tab, loading: true, error: '', requestId} : tab,
      ),
    },
  };
}

export function updatePreviewTab(
  state: PreviewWorkbenchState,
  projectId: string,
  tabId: string,
  updater: (tab: PreviewWorkbenchTab) => PreviewWorkbenchTab,
): PreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  return {
    ...state,
    tabsByProjectId: {
      ...state.tabsByProjectId,
      [projectId]: tabs.map(tab => (tab.id === tabId ? updater(tab) : tab)),
    },
  };
}

export function updatePreviewTabAfterLoad(
  state: PreviewWorkbenchState,
  projectId: string,
  tabId: string,
  requestId: number,
  updater: (tab: PreviewWorkbenchTab) => PreviewWorkbenchTab,
): PreviewWorkbenchState {
  return updatePreviewTab(state, projectId, tabId, tab =>
    tab.requestId === requestId ? updater(tab) : tab,
  );
}

export function failPreviewTabLoad(
  state: PreviewWorkbenchState,
  projectId: string,
  tabId: string,
  requestId: number,
  error: string,
): PreviewWorkbenchState {
  return updatePreviewTabAfterLoad(state, projectId, tabId, requestId, tab => ({
    ...tab,
    loading: false,
    error,
  }));
}

export function closePreviewTab(
  state: PreviewWorkbenchState,
  projectId: string,
  tabId: string,
): PreviewWorkbenchState {
  const tabs = state.tabsByProjectId[projectId] ?? [];
  const closingIndex = tabs.findIndex(tab => tab.id === tabId);
  if (closingIndex < 0) {
    return state;
  }
  const nextTabs = tabs.filter(tab => tab.id !== tabId);
  const currentActiveId = state.activeTabIdByProjectId[projectId] ?? '';
  const nextActiveId =
    currentActiveId === tabId
      ? nextTabs[Math.min(closingIndex, Math.max(0, nextTabs.length - 1))]?.id ?? ''
      : currentActiveId;
  const closedState = removeRenderedTabId({
    ...state,
    tabsByProjectId: {...state.tabsByProjectId, [projectId]: nextTabs},
    activeTabIdByProjectId: {...state.activeTabIdByProjectId, [projectId]: nextActiveId},
  }, projectId, tabId);
  return nextActiveId ? addRenderedTabId(closedState, projectId, nextActiveId) : closedState;
}

export function activePreviewTab(state: PreviewWorkbenchState): PreviewWorkbenchTab | null {
  const projectId = state.activeProjectId;
  const activeTabId = state.activeTabIdByProjectId[projectId] ?? '';
  return (state.tabsByProjectId[projectId] ?? []).find(tab => tab.id === activeTabId) ?? null;
}

export function previewRenderedTabs(state: PreviewWorkbenchState): PreviewWorkbenchTab[] {
  const projectId = state.activeProjectId;
  const tabs = state.tabsByProjectId[projectId] ?? [];
  const activeTabId = state.activeTabIdByProjectId[projectId] ?? '';
  const renderedIds = new Set([
    ...(state.renderedTabIdsByProjectId[projectId] ?? []),
    ...(activeTabId ? [activeTabId] : []),
  ]);
  return tabs.filter(tab => renderedIds.has(tab.id));
}

export const isFilePreviewTab = (tab: PreviewWorkbenchTab | null): tab is FilePreviewTab =>
  tab?.type === 'file';

export const isPromptDiffPreviewTab = (tab: PreviewWorkbenchTab | null): tab is PromptDiffPreviewTab =>
  tab?.type === 'prompt-diff';

export const isAttachmentPreviewTab = (tab: PreviewWorkbenchTab | null): tab is AttachmentPreviewTab =>
  tab?.type === 'attachment';

export const isPortRelayPreviewTab = (tab: PreviewWorkbenchTab | null): tab is PortRelayPreviewTab =>
  tab?.type === 'port-relay';
