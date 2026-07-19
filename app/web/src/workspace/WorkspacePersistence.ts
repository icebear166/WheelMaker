import type {RegistryChatSession, RegistryGitCommit, RegistryGitCommitFile, RegistrySessionTurn} from '../registry/registryTypes';
import {obsoleteBrowserCredentialRows} from '../compatibility/browserCredentialCleanup';
import {
  DEFAULT_CODE_FONT,
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_CODE_LINE_HEIGHT,
  DEFAULT_CODE_TAB_SIZE,
  DEFAULT_CODE_THEME,
  isCodeFontId,
  isCodeThemeId,
  type CodeFontId,
  type CodeThemeId,
} from '../code/shikiSettings';
import {
  DEFAULT_CHAT_VIEW_WIDTH,
  normalizeChatViewWidth,
  type ChatViewWidth,
} from '../chat/chatViewWidth';
import {
  DEFAULT_SESSION_LIST_DENSITY,
  normalizeSessionListDensity,
  type SessionListDensity,
} from '../chat/sessionListDensity';
import {
  DEFAULT_MOBILE_ENTER_KEY_BEHAVIOR,
  normalizeMobileEnterKeyBehavior,
  type MobileEnterKeyBehavior,
} from '../chat/mobileEnterKeyBehavior';
import {
  normalizePortRelayListenPort,
  normalizePortRelayTarget,
  normalizePortRelayTargets,
  type PortRelayTarget,
} from '../portRelay/portRelayTargets';
import {
  PREVIEW_WORKBENCH_SNAPSHOT_VERSION,
  type PreviewWorkbenchSnapshot,
} from '../preview/previewWorkbenchState';
import {
  FLOATING_CONTROL_DEFAULT_Y_RATIO,
  floatingControlYRatioFromLegacySlot,
  sanitizeFloatingControlYRatio,
} from '../preferences/floatingControlPreferences';
import { sanitizeHubColorMap } from './hubProjectPreferences';

export type PersistedTab = 'chat' | 'file' | 'git';
export type PersistedThemeMode = 'dark' | 'light';
export type PersistedFloatingControlSide = 'left' | 'right';
export type PersistedLogLevel = 'debug' | 'info' | 'warning' | 'error';

export type DiffCacheEntry = {
  diff: string;
  isBinary: boolean;
  truncated: boolean;
  updatedAt: number;
};

export type FileCacheEntry = {
  hash: string;
  value: string;
  updatedAt: number;
};

export type PersistedProjectState = {
  expandedDirs: string[];
  selectedFile: string;
  pinnedFiles: string[];
  gitCurrentBranch: string;
  selectedCommit: string;
  selectedDiff: string;
  selectedChatSessionId: string;
};

export type PersistedProjectCommitsState = {
  commits: RegistryGitCommit[];
  commitFilesBySha: Record<string, RegistryGitCommitFile[]>;
};

export type PersistedGlobalState = {
  themeMode: PersistedThemeMode;
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
  chatViewWidth: ChatViewWidth;
  sessionListDensity: SessionListDensity;
  mobileEnterKeyBehavior: MobileEnterKeyBehavior;
  wrapLines: boolean;
  showLineNumbers: boolean;
  showLimitsMonitor: boolean;
  messageViewerEnabled: boolean;
  logLevel: PersistedLogLevel;
  disableFileCache: boolean;
  promptCompletionNotificationsEnabled: boolean;
  tab: PersistedTab;
  selectedProjectId: string;
  selectedChatProjectId: string;
  selectedChatSessionId: string;
  floatingControlYRatio: number;
  floatingControlSide: PersistedFloatingControlSide;
  desktopSidebarWidth: number;
  sessionPanelPinned: boolean;
  collapsedProjectIds: string[];
  desktopCollapsedProjectIds: string[];
  pinnedProjectIds: string[];
  hubColors: Record<string, string>;
  hiddenProjectIds: string[];
  expandedHubIds: string[];
  portRelayTargets: PortRelayTarget[];
  selectedPortRelayTarget: PortRelayTarget | null;
  portRelayListenPort: number;
  previewWorkbenchSnapshot: PreviewWorkbenchSnapshot | null;
};

export type PersistedChatCursor = {
  turnIndex: number;
};

export type PersistedChatSessionEntry = {
  session: RegistryChatSession;
  cursor: PersistedChatCursor;
};

export type PersistedChatSessionContent = {
  turns: RegistrySessionTurn[];
};

type PersistedWorkspaceState = {
  global: PersistedGlobalState;
  projects: Record<string, PersistedProjectState>;
};

export type WorkspaceDatabaseDump = {
  global: Array<{k: string; v: string; updatedAt: number}>;
  projects: Array<{projectId: string; stateJson: string; updatedAt: number}>;
  projectCommits: Array<{projectId: string; commitsJson: string; commitFilesByShaJson: string; updatedAt: number}>;
  chatSessionIndex: Array<{k: string; projectId: string; sessionId: string; sessionJson: string; cursorJson: string; updatedAt: number}>;
  chatSessionContent: Array<{k: string; projectId: string; sessionId: string; turnsJson: string; updatedAt: number}>;
  fileCache: Array<{k: string; hash: string; v: string; updatedAt: number}>;
  diffCache: Array<{k: string; v: string; updatedAt: number}>;
  meta: Array<{k: string; v: string; updatedAt: number}>;
  storage: WorkspaceDatabaseStorageStats;
  storageError: WorkspaceStorageError | null;
};

export type WorkspaceDatabaseStoreStorageStats = {
  store: string;
  rows: number;
  approximateBytes: number;
};

export type WorkspaceBrowserStorageEstimate = {
  usage?: number;
  quota?: number;
  usageDetails?: Record<string, number | undefined>;
};

export type WorkspaceDatabaseStorageStats = {
  usageBytes: number | null;
  quotaBytes: number | null;
  persisted: boolean | null;
  usageDetails: Record<string, number>;
  totalApproximateStoreBytes: number;
  stores: WorkspaceDatabaseStoreStorageStats[];
};

export type WorkspaceStorageError = {
  operation: string;
  name: string;
  message: string;
  quotaExceeded: boolean;
  occurredAt: string;
};

const WORKSPACE_DB_NAME = 'wheelmaker.workspace.db';
const WORKSPACE_DB_VERSION = 6;
const TABLE_GLOBAL_KV = 'wm_global_kv';
const TABLE_PROJECT_STATE = 'wm_project_state';
const TABLE_PROJECT_COMMITS = 'wm_project_commits';
const TABLE_CHAT_SESSION_INDEX = 'wm_chat_session_index';
const TABLE_CHAT_SESSION_CONTENT = 'wm_chat_session_content';
const TABLE_FILE_CACHE = 'wm_file_cache';
const TABLE_DIFF_CACHE = 'wm_diff_cache';
const TABLE_META = 'wm_meta';
const DIFF_CACHE_LIMIT = 120;
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FILE_CACHE_MAX_ENTRIES = 1500;
const FILE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const DIFF_CACHE_MAX_ENTRIES = 600;
const DIFF_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const CHAT_CONTENT_CACHE_MAX_ENTRIES = 250;
const CHAT_CONTENT_CACHE_MAX_BYTES = 48 * 1024 * 1024;
const PROJECT_COMMITS_CACHE_MAX_ENTRIES = 40;
const PROJECT_COMMITS_CACHE_MAX_BYTES = 24 * 1024 * 1024;

export type CacheBudgetEntry = {
  key: string;
  updatedAt: number;
  approximateBytes: number;
};

export type CacheBudgetLimits = {
  now: number;
  maxAgeMs: number;
  maxEntries: number;
  maxBytes: number;
};

export function selectCacheEvictionKeys(
  entries: CacheBudgetEntry[],
  limits: CacheBudgetLimits,
): string[] {
  const expiredKeys = new Set(
    entries
      .filter(item => limits.now - item.updatedAt > limits.maxAgeMs)
      .map(item => item.key),
  );
  const survivors = entries.filter(item => !expiredKeys.has(item.key));
  const evicted = [...expiredKeys];
  let remainingCount = survivors.length;
  let bytes = survivors.reduce((sum, item) => sum + item.approximateBytes, 0);
  const oldestFirst = [...survivors].sort(
    (left, right) => left.updatedAt - right.updatedAt || left.key.localeCompare(right.key),
  );
  for (const item of oldestFirst) {
    if (remainingCount <= limits.maxEntries && bytes <= limits.maxBytes) break;
    evicted.push(item.key);
    remainingCount -= 1;
    bytes -= item.approximateBytes;
  }
  return evicted;
}

function approximateTextBytes(value: string): number {
  return value.length * 2;
}

function errorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error) {
    return String((error as {name?: unknown}).name || 'Error');
  }
  return 'Error';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isQuotaExceededError(error: unknown): boolean {
  const name = errorName(error);
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

function approximateJsonBytes(value: unknown): number {
  const json = JSON.stringify(value);
  if (typeof Blob !== 'undefined') {
    return new Blob([json]).size;
  }
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(json).length;
  }
  return json.length;
}

function finiteStorageBytes(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

export function buildWorkspaceDatabaseStorageStats(
  stores: Record<string, unknown[]>,
  estimate?: WorkspaceBrowserStorageEstimate | null,
  persisted?: boolean | null,
): WorkspaceDatabaseStorageStats {
  const storeStats = Object.entries(stores)
    .map(([store, rows]) => ({
      store,
      rows: rows.length,
      approximateBytes: approximateJsonBytes(rows),
    }))
    .sort((left, right) => {
      const sizeDelta = right.approximateBytes - left.approximateBytes;
      return sizeDelta !== 0 ? sizeDelta : left.store.localeCompare(right.store);
    });
  const usageDetails: Record<string, number> = {};
  for (const [key, value] of Object.entries(estimate?.usageDetails ?? {})) {
    const bytes = finiteStorageBytes(value);
    if (bytes != null) {
      usageDetails[key] = bytes;
    }
  }
  return {
    usageBytes: finiteStorageBytes(estimate?.usage),
    quotaBytes: finiteStorageBytes(estimate?.quota),
    persisted: typeof persisted === 'boolean' ? persisted : null,
    usageDetails,
    totalApproximateStoreBytes: storeStats.reduce(
      (total, item) => total + item.approximateBytes,
      0,
    ),
    stores: storeStats,
  };
}

const GLOBAL_KEYS = {
  themeMode: 'themeMode',
  codeTheme: 'codeTheme',
  codeFont: 'codeFont',
  codeFontSize: 'codeFontSize',
  codeLineHeight: 'codeLineHeight',
  codeTabSize: 'codeTabSize',
  chatViewWidth: 'chatViewWidth',
  sessionListDensity: 'sessionListDensity',
  mobileEnterKeyBehavior: 'mobileEnterKeyBehavior',
  wrapLines: 'wrapLines',
  showLineNumbers: 'showLineNumbers',
  showLimitsMonitor: 'showLimitsMonitor',
  messageViewerEnabled: 'messageViewerEnabled',
  logLevel: 'logLevel',
  disableFileCache: 'disableFileCache',
  promptCompletionNotificationsEnabled: 'promptCompletionNotificationsEnabled',
  tab: 'tab',
  selectedProjectId: 'selectedProjectId',
  selectedChatProjectId: 'selectedChatProjectId',
  selectedChatSessionId: 'selectedChatSessionId',
  floatingControlYRatio: 'floatingControlYRatio',
  floatingControlSlot: 'floatingControlSlot',
  floatingControlSide: 'floatingControlSide',
  desktopSidebarWidth: 'desktopSidebarWidth',
  sessionPanelPinned: 'sessionPanelPinned',
  collapsedProjectIds: 'collapsedProjectIds',
  desktopCollapsedProjectIds: 'desktopCollapsedProjectIds',
  pinnedProjectIds: 'pinnedProjectIds',
  hubColors: 'hubColors',
  hiddenProjectIds: 'hiddenProjectIds',
  expandedHubIds: 'expandedHubIds',
  portRelayTargets: 'portRelayTargets',
  selectedPortRelayTarget: 'selectedPortRelayTarget',
  portRelayListenPort: 'portRelayListenPort',
  previewWorkbenchSnapshot: 'previewWorkbenchSnapshot',
} as const;

function defaultGlobalState(): PersistedGlobalState {
  return {
    themeMode: 'dark',
    codeTheme: DEFAULT_CODE_THEME,
    codeFont: DEFAULT_CODE_FONT,
    codeFontSize: DEFAULT_CODE_FONT_SIZE,
    codeLineHeight: DEFAULT_CODE_LINE_HEIGHT,
    codeTabSize: DEFAULT_CODE_TAB_SIZE,
    chatViewWidth: DEFAULT_CHAT_VIEW_WIDTH,
    sessionListDensity: DEFAULT_SESSION_LIST_DENSITY,
    mobileEnterKeyBehavior: DEFAULT_MOBILE_ENTER_KEY_BEHAVIOR,
    wrapLines: false,
    showLineNumbers: true,
    showLimitsMonitor: true,
    messageViewerEnabled: false,
    logLevel: 'warning',
    disableFileCache: false,
    promptCompletionNotificationsEnabled: true,
    tab: 'chat',
    selectedProjectId: '',
    selectedChatProjectId: '',
    selectedChatSessionId: '',
    floatingControlYRatio: FLOATING_CONTROL_DEFAULT_Y_RATIO,
    floatingControlSide: 'right',
    desktopSidebarWidth: 380,
    sessionPanelPinned: false,
    collapsedProjectIds: [],
    desktopCollapsedProjectIds: [],
    pinnedProjectIds: [],
    hubColors: {},
    hiddenProjectIds: [],
    expandedHubIds: [],
    portRelayTargets: [],
    selectedPortRelayTarget: null,
    portRelayListenPort: 28810,
    previewWorkbenchSnapshot: null,
  };
}

function defaultProjectState(): PersistedProjectState {
  return {
    expandedDirs: ['.'],
    selectedFile: '',
    pinnedFiles: [],
    gitCurrentBranch: '',
    selectedCommit: '',
    selectedDiff: '',
    selectedChatSessionId: '',
  };
}

function defaultProjectCommitsState(): PersistedProjectCommitsState {
  return {
    commits: [],
    commitFilesBySha: {},
  };
}

function defaultWorkspaceState(): PersistedWorkspaceState {
  return {
    global: defaultGlobalState(),
    projects: {},
  };
}

function defaultChatCursor(): PersistedChatCursor {
  return {
    turnIndex: 0,
  };
}

function sanitizeChatCursor(input: Partial<PersistedChatCursor> | undefined): PersistedChatCursor {
  const base = defaultChatCursor();
  if (!input) return base;
  const turnIndex = Number.isFinite(input.turnIndex) ? Math.max(0, Math.floor(Number(input.turnIndex))) : base.turnIndex;
  return {turnIndex};
}

function sanitizePersistedTurns(input: unknown): RegistrySessionTurn[] {
  if (!Array.isArray(input)) return [];
  const byIndex = new Map<number, RegistrySessionTurn>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Partial<RegistrySessionTurn>;
    const turnIndex = Number.isFinite(item.turnIndex)
      ? Math.trunc(Number(item.turnIndex))
      : 0;
    if (turnIndex <= 0 || typeof item.content !== 'string' || item.content === '') continue;
    byIndex.set(turnIndex, {
      turnIndex,
      content: item.content,
      finished: item.finished === true,
    });
  }
  return Array.from(byIndex.values()).sort((a, b) => a.turnIndex - b.turnIndex);
}

function persistedFinishedPrefixTurnIndex(turns: RegistrySessionTurn[]): number {
  const finished = new Set<number>();
  for (const turn of turns) {
    if (turn.finished === true && turn.turnIndex > 0) {
      finished.add(Math.trunc(turn.turnIndex));
    }
  }
  let turnIndex = 0;
  while (finished.has(turnIndex + 1)) {
    turnIndex += 1;
  }
  return turnIndex;
}

function persistedTurnPrefix(turns: RegistrySessionTurn[], cursor: PersistedChatCursor): RegistrySessionTurn[] {
  const maxTurnIndex = Math.max(0, Math.trunc(cursor.turnIndex ?? 0));
  const byIndex = new Map<number, RegistrySessionTurn>();
  for (const turn of sanitizePersistedTurns(turns)) {
    if (turn.finished === true) {
      byIndex.set(turn.turnIndex, turn);
    }
  }
  const out: RegistrySessionTurn[] = [];
  for (let turnIndex = 1; turnIndex <= maxTurnIndex; turnIndex += 1) {
    const turn = byIndex.get(turnIndex);
    if (!turn) break;
    out.push({...turn});
  }
  return out;
}

function sessionLatestTurnIndex(session: RegistryChatSession): number | null {
  if (!Number.isFinite(session.latestTurnIndex)) {
    return null;
  }
  return Math.max(0, Math.trunc(Number(session.latestTurnIndex)));
}

function samePersistedTurns(left: RegistrySessionTurn[], right: RegistrySessionTurn[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.turnIndex !== b.turnIndex ||
      a.content !== b.content ||
      a.finished !== b.finished
    ) {
      return false;
    }
  }
  return true;
}

function normalizePersistedLogLevel(value: unknown, fallback: PersistedLogLevel): PersistedLogLevel {
  if (value === 'debug' || value === 'info' || value === 'warning' || value === 'error') {
    return value;
  }
  if (value === 'warn') {
    return 'warning';
  }
  return fallback;
}

export function reconcilePersistedChatSessionCache(
  session: RegistryChatSession,
  cursor: Partial<PersistedChatCursor> | undefined,
  turns: RegistrySessionTurn[],
): {cursor: PersistedChatCursor; turns: RegistrySessionTurn[]; stale: boolean} {
  const safeCursor = sanitizeChatCursor(cursor);
  const sanitizedTurns = sanitizePersistedTurns(turns);
  const latest = sessionLatestTurnIndex(session);
  if (latest != null && latest < safeCursor.turnIndex) {
    return {cursor: defaultChatCursor(), turns: [], stale: true};
  }
  const actualPrefix = persistedFinishedPrefixTurnIndex(sanitizedTurns);
  const repairedCursor = {turnIndex: Math.min(safeCursor.turnIndex, actualPrefix)};
  return {
    cursor: repairedCursor,
    turns: persistedTurnPrefix(sanitizedTurns, repairedCursor),
    stale: false,
  };
}

function sanitizeProjectState(input: Partial<PersistedProjectState> | undefined): PersistedProjectState {
  const base = defaultProjectState();
  if (!input) return base;
  return {
    expandedDirs: Array.isArray(input.expandedDirs) && input.expandedDirs.length > 0 ? input.expandedDirs : base.expandedDirs,
    selectedFile: typeof input.selectedFile === 'string' ? input.selectedFile : base.selectedFile,
    pinnedFiles: Array.isArray(input.pinnedFiles) ? input.pinnedFiles.filter(item => typeof item === 'string') : base.pinnedFiles,
    gitCurrentBranch: typeof input.gitCurrentBranch === 'string' ? input.gitCurrentBranch : base.gitCurrentBranch,
    selectedCommit: typeof input.selectedCommit === 'string' ? input.selectedCommit : base.selectedCommit,
    selectedDiff: typeof input.selectedDiff === 'string' ? input.selectedDiff : base.selectedDiff,
    selectedChatSessionId: typeof input.selectedChatSessionId === 'string' ? input.selectedChatSessionId : base.selectedChatSessionId,
  };
}

function sanitizeProjectCommitsState(input: Partial<PersistedProjectCommitsState> | undefined): PersistedProjectCommitsState {
  const base = defaultProjectCommitsState();
  if (!input) return base;
  return {
    commits: Array.isArray(input.commits) ? input.commits : base.commits,
    commitFilesBySha: typeof input.commitFilesBySha === 'object' && input.commitFilesBySha ? input.commitFilesBySha : base.commitFilesBySha,
  };
}

function sanitizeStringList(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter(item => typeof item === 'string' && item)))
    : fallback;
}

function sanitizePreviewWorkbenchSnapshot(input: unknown): PreviewWorkbenchSnapshot | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const value = input as Partial<PreviewWorkbenchSnapshot>;
  return value.version === PREVIEW_WORKBENCH_SNAPSHOT_VERSION ? value as PreviewWorkbenchSnapshot : null;
}

type PersistedGlobalStateInput = Partial<PersistedGlobalState> & {
  floatingControlSlot?: unknown;
};

function sanitizeGlobalState(input: PersistedGlobalStateInput | undefined): PersistedGlobalState {
  const base = defaultGlobalState();
  if (!input) return base;
  const collapsedProjectIds = Array.isArray(input.collapsedProjectIds)
    ? Array.from(new Set(input.collapsedProjectIds.filter(item => typeof item === 'string' && item)))
    : Array.isArray(input.desktopCollapsedProjectIds)
      ? Array.from(new Set(input.desktopCollapsedProjectIds.filter(item => typeof item === 'string' && item)))
      : base.collapsedProjectIds;
  const pinnedProjectIds = Array.isArray(input.pinnedProjectIds)
    ? Array.from(new Set(input.pinnedProjectIds.filter(item => typeof item === 'string' && item)))
    : base.pinnedProjectIds;
  const hiddenProjectIds = sanitizeStringList(input.hiddenProjectIds, base.hiddenProjectIds);
  const expandedHubIds = sanitizeStringList(input.expandedHubIds, base.expandedHubIds);
  const legacyFloatingControlYRatio = floatingControlYRatioFromLegacySlot(input.floatingControlSlot);
  const floatingControlYRatio = sanitizeFloatingControlYRatio(
    input.floatingControlYRatio,
    legacyFloatingControlYRatio ?? base.floatingControlYRatio,
  );
  const sanitizeDesktopSidebarWidth = (value: unknown, fallback: number): number => {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.min(560, Math.max(320, Math.round(numeric)));
  };
  const sanitizeFloatingControlSide = (value: unknown, fallback: PersistedFloatingControlSide): PersistedFloatingControlSide =>
    value === 'left' || value === 'right' ? value : fallback;
  return {
    themeMode: input.themeMode === 'light' ? 'light' : 'dark',
    codeTheme: typeof input.codeTheme === 'string' && isCodeThemeId(input.codeTheme) ? input.codeTheme : base.codeTheme,
    codeFont: typeof input.codeFont === 'string' && isCodeFontId(input.codeFont) ? input.codeFont : base.codeFont,
    codeFontSize: typeof input.codeFontSize === 'number' && Number.isFinite(input.codeFontSize) ? input.codeFontSize : base.codeFontSize,
    codeLineHeight: typeof input.codeLineHeight === 'number' && Number.isFinite(input.codeLineHeight) ? input.codeLineHeight : base.codeLineHeight,
    codeTabSize: typeof input.codeTabSize === 'number' && Number.isFinite(input.codeTabSize) ? input.codeTabSize : base.codeTabSize,
    chatViewWidth: normalizeChatViewWidth(input.chatViewWidth, base.chatViewWidth),
    sessionListDensity: normalizeSessionListDensity(input.sessionListDensity, base.sessionListDensity),
    mobileEnterKeyBehavior: normalizeMobileEnterKeyBehavior(input.mobileEnterKeyBehavior, base.mobileEnterKeyBehavior),
    wrapLines: typeof input.wrapLines === 'boolean' ? input.wrapLines : base.wrapLines,
    showLineNumbers: typeof input.showLineNumbers === 'boolean' ? input.showLineNumbers : base.showLineNumbers,
    showLimitsMonitor: typeof input.showLimitsMonitor === 'boolean' ? input.showLimitsMonitor : base.showLimitsMonitor,
    messageViewerEnabled: typeof input.messageViewerEnabled === 'boolean' ? input.messageViewerEnabled : base.messageViewerEnabled,
    logLevel: normalizePersistedLogLevel(input.logLevel, base.logLevel),
    disableFileCache: typeof input.disableFileCache === 'boolean' ? input.disableFileCache : base.disableFileCache,
    promptCompletionNotificationsEnabled: typeof input.promptCompletionNotificationsEnabled === 'boolean' ? input.promptCompletionNotificationsEnabled : base.promptCompletionNotificationsEnabled,
    tab: input.tab === 'file' || input.tab === 'git' ? input.tab : 'chat',
    selectedProjectId: typeof input.selectedProjectId === 'string' ? input.selectedProjectId : base.selectedProjectId,
    selectedChatProjectId: typeof input.selectedChatProjectId === 'string' ? input.selectedChatProjectId : base.selectedChatProjectId,
    selectedChatSessionId: typeof input.selectedChatSessionId === 'string' ? input.selectedChatSessionId : base.selectedChatSessionId,
    floatingControlYRatio,
    floatingControlSide: sanitizeFloatingControlSide(input.floatingControlSide, base.floatingControlSide),
    desktopSidebarWidth: sanitizeDesktopSidebarWidth(input.desktopSidebarWidth, base.desktopSidebarWidth),
    sessionPanelPinned: typeof input.sessionPanelPinned === 'boolean'
      ? input.sessionPanelPinned
      : base.sessionPanelPinned,
    collapsedProjectIds,
    desktopCollapsedProjectIds: collapsedProjectIds,
    pinnedProjectIds,
    hubColors: sanitizeHubColorMap(input.hubColors),
    hiddenProjectIds,
    expandedHubIds,
    portRelayTargets: normalizePortRelayTargets(input.portRelayTargets),
    selectedPortRelayTarget: normalizePortRelayTarget(input.selectedPortRelayTarget),
    portRelayListenPort: normalizePortRelayListenPort(input.portRelayListenPort, base.portRelayListenPort),
    previewWorkbenchSnapshot: sanitizePreviewWorkbenchSnapshot(input.previewWorkbenchSnapshot),
  };
}

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function tryParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function fileCacheKey(projectId: string, kind: 'file' | 'dir', path: string): string {
  return `fc:${projectId}:${kind}:${path}`;
}

function diffCacheKey(projectId: string, key: string): string {
  return `dc:${projectId}:${key}`;
}

function chatSessionKey(projectId: string, sessionId: string): string {
  return `cs:${projectId}:${sessionId}`;
}

function chatProjectPrefix(projectId: string): string {
  return `cs:${projectId}:`;
}


function parseChatSessionKey(key: string): {projectId: string; sessionId: string} | null {
  if (!key.startsWith('cs:')) return null;
  const payload = key.slice(3);
  const splitAt = payload.lastIndexOf(':');
  if (splitAt <= 0 || splitAt >= payload.length - 1) {
    return null;
  }
  return {
    projectId: payload.slice(0, splitAt),
    sessionId: payload.slice(splitAt + 1),
  };
}

type RawKVRow = {
  k: string;
  v: string;
  updatedAt: number;
};

function globalRowsForPatch(
  patch: Partial<PersistedGlobalState>,
  state: PersistedGlobalState,
  updatedAt: number,
): RawKVRow[] {
  const storageKeys = GLOBAL_KEYS as Partial<Record<keyof PersistedGlobalState, string>>;
  const rows: RawKVRow[] = [];
  for (const key of Object.keys(patch) as Array<keyof PersistedGlobalState>) {
    const storageKey = storageKeys[key];
    if (!storageKey) continue;
    rows.push({k: storageKey, v: serialize(state[key]), updatedAt});
  }
  return rows;
}

function redactGlobalDumpRows(rows: RawKVRow[]): RawKVRow[] {
  const obsolete = new Set(obsoleteBrowserCredentialRows(rows));
  return rows.filter(row => !obsolete.has(row.k));
}

type RawProjectStateRow = {
  projectId: string;
  stateJson: string;
  updatedAt: number;
};

type RawProjectCommitsRow = {
  projectId: string;
  commitsJson: string;
  commitFilesByShaJson: string;
  updatedAt: number;
};

type RawChatSessionIndexRow = {
  k: string;
  projectId: string;
  sessionId: string;
  sessionJson: string;
  cursorJson: string;
  updatedAt: number;
};

type RawChatSessionContentRow = {
  k: string;
  projectId: string;
  sessionId: string;
  turnsJson?: string;
  updatedAt: number;
};

type RawFileCacheRow = {
  k: string;
  hash: string;
  v: string;
  updatedAt: number;
};

type RawDiffCacheRow = {
  k: string;
  v: string;
  updatedAt: number;
};

export type WorkspaceDatabaseMutation = {
  storeName: string;
  clear?: boolean;
  puts?: unknown[];
  deletes?: IDBValidKey[];
};

export interface WorkspaceDatabaseAdapter {
  getAllRows<T>(storeName: string): Promise<T[]>;
  mutateStores(mutations: WorkspaceDatabaseMutation[]): Promise<void>;
  putRow(storeName: string, row: unknown): Promise<void>;
  deleteRow(storeName: string, key: IDBValidKey): Promise<void>;
  clearStores(storeNames: string[]): Promise<void>;
}

class WorkspaceDatabase implements WorkspaceDatabaseAdapter {
  private openPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!globalThis.indexedDB) {
      return Promise.reject(new Error('IndexedDB is unavailable in this environment.'));
    }
    if (this.openPromise) {
      return this.openPromise;
    }
    this.openPromise = new Promise((resolve, reject) => {
      const req = globalThis.indexedDB.open(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TABLE_GLOBAL_KV)) {
          db.createObjectStore(TABLE_GLOBAL_KV, {keyPath: 'k'});
        }
        if (!db.objectStoreNames.contains(TABLE_PROJECT_STATE)) {
          db.createObjectStore(TABLE_PROJECT_STATE, {keyPath: 'projectId'});
        }
        if (!db.objectStoreNames.contains(TABLE_PROJECT_COMMITS)) {
          db.createObjectStore(TABLE_PROJECT_COMMITS, {keyPath: 'projectId'});
        }
        if (!db.objectStoreNames.contains(TABLE_CHAT_SESSION_INDEX)) {
          db.createObjectStore(TABLE_CHAT_SESSION_INDEX, {keyPath: 'k'});
        }
        if (!db.objectStoreNames.contains(TABLE_CHAT_SESSION_CONTENT)) {
          db.createObjectStore(TABLE_CHAT_SESSION_CONTENT, {keyPath: 'k'});
        }
        if (!db.objectStoreNames.contains(TABLE_FILE_CACHE)) {
          db.createObjectStore(TABLE_FILE_CACHE, {keyPath: 'k'});
        }
        if (!db.objectStoreNames.contains(TABLE_DIFF_CACHE)) {
          db.createObjectStore(TABLE_DIFF_CACHE, {keyPath: 'k'});
        }
        if (!db.objectStoreNames.contains(TABLE_META)) {
          db.createObjectStore(TABLE_META, {keyPath: 'k'});
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('open workspace db failed'));
    });
    return this.openPromise;
  }

  private request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('workspace db request failed'));
    });
  }

  private async run<T>(
    stores: string | string[],
    mode: IDBTransactionMode,
    action: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      action(tx)
        .then(result => {
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error ?? new Error('workspace db transaction failed'));
          tx.onabort = () => reject(tx.error ?? new Error('workspace db transaction aborted'));
        })
        .catch(error => {
          reject(error);
          try {
            tx.abort();
          } catch {
            // ignore
          }
        });
    });
  }

  async getAllRows<T>(storeName: string): Promise<T[]> {
    return this.run(storeName, 'readonly', async tx => {
      const store = tx.objectStore(storeName);
      return this.request(store.getAll() as IDBRequest<T[]>);
    });
  }

  async putRow(storeName: string, row: unknown): Promise<void> {
    await this.mutateStores([{storeName, puts: [row]}]);
  }

  async deleteRow(storeName: string, key: IDBValidKey): Promise<void> {
    await this.mutateStores([{storeName, deletes: [key]}]);
  }

  async clearStores(storeNames: string[]): Promise<void> {
    await this.mutateStores(storeNames.map(storeName => ({storeName, clear: true})));
  }

  async mutateStores(mutations: WorkspaceDatabaseMutation[]): Promise<void> {
    if (mutations.length === 0) return;
    const storeNames = Array.from(new Set(mutations.map(mutation => mutation.storeName)));
    await this.run(storeNames, 'readwrite', async tx => {
      for (const mutation of mutations) {
        const store = tx.objectStore(mutation.storeName);
        if (mutation.clear) {
          await this.request(store.clear());
        }
        for (const key of mutation.deletes ?? []) {
          await this.request(store.delete(key));
        }
        for (const row of mutation.puts ?? []) {
          await this.request(store.put(row));
        }
      }
    });
  }
}

function sortByKey<T extends {k: string}>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.k.localeCompare(b.k));
}

function sortByProjectId<T extends {projectId: string}>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.projectId.localeCompare(b.projectId));
}

function compareUpdatedAtDesc(a: string, b: string): number {
  const aTime = Date.parse(a || '');
  const bTime = Date.parse(b || '');
  const safeA = Number.isFinite(aTime) ? aTime : 0;
  const safeB = Number.isFinite(bTime) ? bTime : 0;
  if (safeA === safeB) return 0;
  return safeA > safeB ? -1 : 1;
}

export class WorkspacePersistenceRepository {
  private state: PersistedWorkspaceState;
  private readonly projectCommits: Record<string, PersistedProjectCommitsState> = {};
  private readonly projectCommitUpdatedAt = new Map<string, number>();
  private readonly chatSessionIndex = new Map<string, PersistedChatSessionEntry>();
  private readonly chatSessionContent = new Map<string, PersistedChatSessionContent>();
  private readonly chatSessionContentUpdatedAt = new Map<string, number>();
  private readonly diffCache = new Map<string, DiffCacheEntry>();
  private readonly fileCache = new Map<string, FileCacheEntry>();
  private readonly readyPromise: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();
  private lastStorageError: WorkspaceStorageError | null = null;
  private readonly storageErrorListeners = new Set<(error: WorkspaceStorageError) => void>();

  constructor(private readonly db: WorkspaceDatabaseAdapter = new WorkspaceDatabase()) {
    this.state = defaultWorkspaceState();
    this.readyPromise = this.initialize();
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  async flushPendingWrites(): Promise<void> {
    await this.readyPromise;
    await this.writeQueue;
  }

  subscribeStorageErrors(listener: (error: WorkspaceStorageError) => void): () => void {
    this.storageErrorListeners.add(listener);
    if (this.lastStorageError) {
      listener(this.lastStorageError);
    }
    return () => this.storageErrorListeners.delete(listener);
  }

  private async initialize(): Promise<void> {
    const [globalRows, projectRows, projectCommitRows, chatIndexRows, chatContentRows, diffRows, fileRows] = await Promise.all([
      this.db.getAllRows<RawKVRow>(TABLE_GLOBAL_KV),
      this.db.getAllRows<RawProjectStateRow>(TABLE_PROJECT_STATE),
      this.db.getAllRows<RawProjectCommitsRow>(TABLE_PROJECT_COMMITS),
      this.db.getAllRows<RawChatSessionIndexRow>(TABLE_CHAT_SESSION_INDEX),
      this.db.getAllRows<RawChatSessionContentRow>(TABLE_CHAT_SESSION_CONTENT),
      this.db.getAllRows<RawDiffCacheRow>(TABLE_DIFF_CACHE),
      this.db.getAllRows<RawFileCacheRow>(TABLE_FILE_CACHE),
    ]);

    const obsoleteRows = obsoleteBrowserCredentialRows(globalRows);
    if (obsoleteRows.length > 0) {
      await this.db.mutateStores([{
        storeName: TABLE_GLOBAL_KV,
        deletes: obsoleteRows,
      }]);
      const deleted = new Set(obsoleteRows);
      const scrubbed = globalRows.filter(row => !deleted.has(row.k));
      globalRows.splice(0, globalRows.length, ...scrubbed);
    }

    const hasPersisted =
      globalRows.length > 0 ||
      projectRows.length > 0 ||
      projectCommitRows.length > 0 ||
      chatIndexRows.length > 0 ||
      chatContentRows.length > 0 ||
      diffRows.length > 0 ||
      fileRows.length > 0;

    if (!hasPersisted) {
      this.state = defaultWorkspaceState();
      await this.seedInitialStateToDb();
      return;
    }

    this.state = this.fromDbRows(globalRows, projectRows);
    this.restoreProjectCommits(projectCommitRows);
    if (this.hasIncompatibleChatContentRows(chatContentRows)) {
      await this.resetPersistentCacheAfterIncompatibleSchema();
      return;
    }

    const repairedChatCache = this.restoreChatSessions(chatIndexRows, chatContentRows);
    this.restoreDiffCache(diffRows);
    this.restoreFileCache(fileRows);
    if (repairedChatCache) {
      try {
        await this.persistRepairedChatCache();
      } catch (error) {
        this.reportStorageError('repair chat cache', error);
      }
    }
    try {
      await this.pruneCachesAfterRestore();
    } catch (error) {
      this.reportStorageError('prune restored caches', error);
    }
  }

  private fromDbRows(globalRows: RawKVRow[], projectRows: RawProjectStateRow[]): PersistedWorkspaceState {
    const base = defaultWorkspaceState();
    const globalPatch: Partial<PersistedGlobalState> = {};
    for (const row of globalRows) {
      if (!(row.k in GLOBAL_KEYS)) continue;
      (globalPatch as Record<string, unknown>)[row.k] = tryParse(row.v, row.v);
    }

    const projects: Record<string, PersistedProjectState> = {};
    for (const row of projectRows) {
      const raw = tryParse<Partial<PersistedProjectState>>(row.stateJson, defaultProjectState());
      projects[row.projectId] = sanitizeProjectState(raw);
    }

    return {
      global: sanitizeGlobalState({...base.global, ...globalPatch}),
      projects,
    };
  }

  private restoreProjectCommits(rows: RawProjectCommitsRow[]): void {
    for (const key of Object.keys(this.projectCommits)) {
      delete this.projectCommits[key];
    }
    this.projectCommitUpdatedAt.clear();
    for (const row of rows) {
      const commits = tryParse<RegistryGitCommit[]>(row.commitsJson, []);
      const commitFilesBySha = tryParse<Record<string, RegistryGitCommitFile[]>>(row.commitFilesByShaJson, {});
      this.projectCommits[row.projectId] = sanitizeProjectCommitsState({
        commits,
        commitFilesBySha,
      });
      this.projectCommitUpdatedAt.set(row.projectId, row.updatedAt);
    }
  }

  private restoreChatSessions(indexRows: RawChatSessionIndexRow[], contentRows: RawChatSessionContentRow[]): boolean {
    this.chatSessionIndex.clear();
    this.chatSessionContent.clear();
    this.chatSessionContentUpdatedAt.clear();
    let repaired = false;

    for (const row of indexRows) {
      const session = tryParse<RegistryChatSession>(row.sessionJson, {
        sessionId: row.sessionId,
        title: row.sessionId,
        preview: '',
        updatedAt: '',
        messageCount: 0,
      });
      const cursor = sanitizeChatCursor(tryParse<Partial<PersistedChatCursor>>(row.cursorJson, defaultChatCursor()));
      this.chatSessionIndex.set(row.k, {
        session,
        cursor,
      });
    }

    for (const row of contentRows) {
      const turns = tryParse<RegistrySessionTurn[]>(row.turnsJson ?? '[]', []);
      this.chatSessionContent.set(row.k, {
        turns: sanitizePersistedTurns(turns),
      });
      this.chatSessionContentUpdatedAt.set(row.k, row.updatedAt);
    }

    for (const [key, entry] of this.chatSessionIndex.entries()) {
      const existingContent = this.chatSessionContent.get(key) ?? {turns: []};
      const nextCache = reconcilePersistedChatSessionCache(entry.session, entry.cursor, existingContent.turns);
      if (
        nextCache.cursor.turnIndex !== entry.cursor.turnIndex ||
        !samePersistedTurns(existingContent.turns, nextCache.turns)
      ) {
        repaired = true;
      }
      this.chatSessionIndex.set(key, {
        session: entry.session,
        cursor: nextCache.cursor,
      });
      this.chatSessionContent.set(key, {
        turns: nextCache.turns,
      });
    }

    return repaired;
  }

  private hasIncompatibleChatContentRows(rows: RawChatSessionContentRow[]): boolean {
    return rows.some(row => typeof row.turnsJson !== 'string');
  }

  private async resetPersistentCacheAfterIncompatibleSchema(): Promise<void> {
    this.chatSessionIndex.clear();
    this.chatSessionContent.clear();
    this.chatSessionContentUpdatedAt.clear();
    this.diffCache.clear();
    this.fileCache.clear();
    const now = Date.now();
    await this.db.clearStores([
      TABLE_CHAT_SESSION_INDEX,
      TABLE_CHAT_SESSION_CONTENT,
      TABLE_DIFF_CACHE,
      TABLE_FILE_CACHE,
    ]);
    await this.db.putRow(TABLE_META, {
      k: 'schemaVersion',
      v: serialize(WORKSPACE_DB_VERSION),
      updatedAt: now,
    });
    await this.db.putRow(TABLE_META, {
      k: 'incompatibleChatCacheClearedAt',
      v: serialize(new Date(now).toISOString()),
      updatedAt: now,
    });
  }
  private restoreDiffCache(rows: RawDiffCacheRow[]): void {
    this.diffCache.clear();
    for (const row of rows) {
      const payload = tryParse<{diff?: string; isBinary?: boolean; truncated?: boolean}>(row.v, {});
      this.diffCache.set(row.k, {
        diff: typeof payload.diff === 'string' ? payload.diff : '',
        isBinary: !!payload.isBinary,
        truncated: !!payload.truncated,
        updatedAt: row.updatedAt,
      });
    }
  }

  private restoreFileCache(rows: RawFileCacheRow[]): void {
    this.fileCache.clear();
    for (const row of rows) {
      this.fileCache.set(row.k, {
        hash: row.hash || '',
        value: row.v || '',
        updatedAt: row.updatedAt,
      });
    }
  }

  private projectCommitBudgetEntries(): CacheBudgetEntry[] {
    return Object.entries(this.projectCommits).map(([projectId, state]) => ({
      key: projectId,
      updatedAt: this.projectCommitUpdatedAt.get(projectId) ?? 0,
      approximateBytes: approximateTextBytes(serialize(state)),
    }));
  }

  private chatContentBudgetEntries(): CacheBudgetEntry[] {
    return [...this.chatSessionContent.entries()].map(([key, content]) => ({
      key,
      updatedAt: this.chatSessionContentUpdatedAt.get(key) ?? 0,
      approximateBytes: approximateTextBytes(serialize(content.turns)),
    }));
  }

  private diffBudgetEntries(): CacheBudgetEntry[] {
    return [...this.diffCache.entries()].map(([key, entry]) => ({
      key,
      updatedAt: entry.updatedAt,
      approximateBytes: approximateTextBytes(serialize(entry)),
    }));
  }

  private fileBudgetEntries(): CacheBudgetEntry[] {
    return [...this.fileCache.entries()].map(([key, entry]) => ({
      key,
      updatedAt: entry.updatedAt,
      approximateBytes: approximateTextBytes(key) + approximateTextBytes(entry.hash) + approximateTextBytes(entry.value),
    }));
  }

  private cacheEvictionKeys(
    entries: CacheBudgetEntry[],
    maxEntries: number,
    maxBytes: number,
    now: number,
  ): string[] {
    return selectCacheEvictionKeys(entries, {
      now,
      maxAgeMs: CACHE_MAX_AGE_MS,
      maxEntries,
      maxBytes,
    });
  }

  private evictProjectCommitEntries(now: number): string[] {
    const keys = this.cacheEvictionKeys(
      this.projectCommitBudgetEntries(),
      PROJECT_COMMITS_CACHE_MAX_ENTRIES,
      PROJECT_COMMITS_CACHE_MAX_BYTES,
      now,
    );
    for (const projectId of keys) {
      delete this.projectCommits[projectId];
      this.projectCommitUpdatedAt.delete(projectId);
    }
    return keys;
  }

  private evictChatContentEntries(now: number): {keys: string[]; indexRows: RawChatSessionIndexRow[]} {
    const keys = this.cacheEvictionKeys(
      this.chatContentBudgetEntries(),
      CHAT_CONTENT_CACHE_MAX_ENTRIES,
      CHAT_CONTENT_CACHE_MAX_BYTES,
      now,
    );
    const indexRows: RawChatSessionIndexRow[] = [];
    for (const key of keys) {
      this.chatSessionContent.delete(key);
      this.chatSessionContentUpdatedAt.delete(key);
      const indexEntry = this.chatSessionIndex.get(key);
      if (!indexEntry) continue;
      const resetEntry = {...indexEntry, cursor: defaultChatCursor()};
      this.chatSessionIndex.set(key, resetEntry);
      const parsed = parseChatSessionKey(key);
      indexRows.push({
        k: key,
        projectId: parsed?.projectId || '',
        sessionId: parsed?.sessionId || resetEntry.session.sessionId,
        sessionJson: serialize(resetEntry.session),
        cursorJson: serialize(resetEntry.cursor),
        updatedAt: now,
      });
    }
    return {keys, indexRows};
  }

  private evictDiffEntries(now: number): string[] {
    const keys = this.cacheEvictionKeys(
      this.diffBudgetEntries(),
      DIFF_CACHE_MAX_ENTRIES,
      DIFF_CACHE_MAX_BYTES,
      now,
    );
    for (const key of keys) this.diffCache.delete(key);
    return keys;
  }

  private evictFileEntries(now: number): string[] {
    const keys = this.cacheEvictionKeys(
      this.fileBudgetEntries(),
      FILE_CACHE_MAX_ENTRIES,
      FILE_CACHE_MAX_BYTES,
      now,
    );
    for (const key of keys) this.fileCache.delete(key);
    return keys;
  }

  private async pruneCachesAfterRestore(): Promise<void> {
    const now = Date.now();
    const projectCommitKeys = this.evictProjectCommitEntries(now);
    const chatEvictions = this.evictChatContentEntries(now);
    const diffKeys = this.evictDiffEntries(now);
    const fileKeys = this.evictFileEntries(now);
    const mutations: WorkspaceDatabaseMutation[] = [];

    if (projectCommitKeys.length > 0) {
      mutations.push({storeName: TABLE_PROJECT_COMMITS, deletes: projectCommitKeys});
    }

    if (chatEvictions.keys.length > 0) {
      mutations.push({storeName: TABLE_CHAT_SESSION_CONTENT, deletes: chatEvictions.keys});
    }
    if (chatEvictions.indexRows.length > 0) {
      mutations.push({storeName: TABLE_CHAT_SESSION_INDEX, puts: chatEvictions.indexRows});
    }

    if (diffKeys.length > 0) {
      mutations.push({storeName: TABLE_DIFF_CACHE, deletes: diffKeys});
    }

    if (fileKeys.length > 0) {
      mutations.push({storeName: TABLE_FILE_CACHE, deletes: fileKeys});
    }

    if (mutations.length > 0) {
      await this.db.mutateStores(mutations);
    }
  }

  private globalRows(updatedAt: number): RawKVRow[] {
    return [
      {k: GLOBAL_KEYS.themeMode, v: serialize(this.state.global.themeMode), updatedAt},
      {k: GLOBAL_KEYS.codeTheme, v: serialize(this.state.global.codeTheme), updatedAt},
      {k: GLOBAL_KEYS.codeFont, v: serialize(this.state.global.codeFont), updatedAt},
      {k: GLOBAL_KEYS.codeFontSize, v: serialize(this.state.global.codeFontSize), updatedAt},
      {k: GLOBAL_KEYS.codeLineHeight, v: serialize(this.state.global.codeLineHeight), updatedAt},
      {k: GLOBAL_KEYS.codeTabSize, v: serialize(this.state.global.codeTabSize), updatedAt},
      {k: GLOBAL_KEYS.chatViewWidth, v: serialize(this.state.global.chatViewWidth), updatedAt},
      {k: GLOBAL_KEYS.sessionListDensity, v: serialize(this.state.global.sessionListDensity), updatedAt},
      {k: GLOBAL_KEYS.mobileEnterKeyBehavior, v: serialize(this.state.global.mobileEnterKeyBehavior), updatedAt},
      {k: GLOBAL_KEYS.wrapLines, v: serialize(this.state.global.wrapLines), updatedAt},
      {k: GLOBAL_KEYS.showLineNumbers, v: serialize(this.state.global.showLineNumbers), updatedAt},
      {k: GLOBAL_KEYS.showLimitsMonitor, v: serialize(this.state.global.showLimitsMonitor), updatedAt},
      {k: GLOBAL_KEYS.messageViewerEnabled, v: serialize(this.state.global.messageViewerEnabled), updatedAt},
      {k: GLOBAL_KEYS.logLevel, v: serialize(this.state.global.logLevel), updatedAt},
      {k: GLOBAL_KEYS.disableFileCache, v: serialize(this.state.global.disableFileCache), updatedAt},
      {k: GLOBAL_KEYS.promptCompletionNotificationsEnabled, v: serialize(this.state.global.promptCompletionNotificationsEnabled), updatedAt},
      {k: GLOBAL_KEYS.tab, v: serialize(this.state.global.tab), updatedAt},
      {k: GLOBAL_KEYS.selectedProjectId, v: serialize(this.state.global.selectedProjectId), updatedAt},
      {k: GLOBAL_KEYS.selectedChatProjectId, v: serialize(this.state.global.selectedChatProjectId), updatedAt},
      {k: GLOBAL_KEYS.selectedChatSessionId, v: serialize(this.state.global.selectedChatSessionId), updatedAt},
      {k: GLOBAL_KEYS.floatingControlYRatio, v: serialize(this.state.global.floatingControlYRatio), updatedAt},
      {k: GLOBAL_KEYS.floatingControlSide, v: serialize(this.state.global.floatingControlSide), updatedAt},
      {k: GLOBAL_KEYS.desktopSidebarWidth, v: serialize(this.state.global.desktopSidebarWidth), updatedAt},
      {k: GLOBAL_KEYS.sessionPanelPinned, v: serialize(this.state.global.sessionPanelPinned), updatedAt},
      {k: GLOBAL_KEYS.collapsedProjectIds, v: serialize(this.state.global.collapsedProjectIds), updatedAt},
      {k: GLOBAL_KEYS.desktopCollapsedProjectIds, v: serialize(this.state.global.desktopCollapsedProjectIds), updatedAt},
      {k: GLOBAL_KEYS.pinnedProjectIds, v: serialize(this.state.global.pinnedProjectIds), updatedAt},
      {k: GLOBAL_KEYS.hubColors, v: serialize(this.state.global.hubColors), updatedAt},
      {k: GLOBAL_KEYS.hiddenProjectIds, v: serialize(this.state.global.hiddenProjectIds), updatedAt},
      {k: GLOBAL_KEYS.expandedHubIds, v: serialize(this.state.global.expandedHubIds), updatedAt},
      {k: GLOBAL_KEYS.portRelayTargets, v: serialize(this.state.global.portRelayTargets), updatedAt},
      {k: GLOBAL_KEYS.selectedPortRelayTarget, v: serialize(this.state.global.selectedPortRelayTarget), updatedAt},
      {k: GLOBAL_KEYS.portRelayListenPort, v: serialize(this.state.global.portRelayListenPort), updatedAt},
      {k: GLOBAL_KEYS.previewWorkbenchSnapshot, v: serialize(this.state.global.previewWorkbenchSnapshot), updatedAt},
    ];
  }

  private chatIndexRows(updatedAt: number): RawChatSessionIndexRow[] {
    return [...this.chatSessionIndex.entries()].map(([k, entry]) => {
      const parsed = parseChatSessionKey(k);
      const projectId = parsed?.projectId || '';
      const sessionId = parsed?.sessionId || entry.session.sessionId;
      return {
        k,
        projectId,
        sessionId,
        sessionJson: serialize(entry.session),
        cursorJson: serialize(entry.cursor),
        updatedAt,
      };
    });
  }

  private chatContentRows(updatedAt: number): RawChatSessionContentRow[] {
    return [...this.chatSessionContent.entries()].map(([k, content]) => {
      const parsed = parseChatSessionKey(k);
      const projectId = parsed?.projectId || '';
      const sessionId = parsed?.sessionId || '';
      return {
        k,
        projectId,
        sessionId,
        turnsJson: serialize(content.turns),
        updatedAt,
      };
    });
  }

  private async seedInitialStateToDb(): Promise<void> {
    const now = Date.now();
    await this.db.mutateStores([
      {storeName: TABLE_GLOBAL_KV, puts: this.globalRows(now)},
      {
        storeName: TABLE_META,
        puts: [{
          k: 'schemaVersion',
          v: serialize(WORKSPACE_DB_VERSION),
          updatedAt: now,
        }],
      },
    ]);
  }

  private async persistRepairedChatCache(): Promise<void> {
    const now = Date.now();
    await this.db.mutateStores([
      {storeName: TABLE_CHAT_SESSION_INDEX, clear: true, puts: this.chatIndexRows(now)},
      {storeName: TABLE_CHAT_SESSION_CONTENT, clear: true, puts: this.chatContentRows(now)},
    ]);
  }

  private reportStorageError(
    operation: string,
    error: unknown,
    quotaExceeded = isQuotaExceededError(error),
  ): void {
    const storageError: WorkspaceStorageError = {
      operation,
      name: errorName(error),
      message: errorMessage(error),
      quotaExceeded,
      occurredAt: new Date().toISOString(),
    };
    this.lastStorageError = storageError;
    console.error(`[workspace-persistence] ${operation}: ${storageError.message}`);
    for (const listener of this.storageErrorListeners) {
      listener(storageError);
    }
  }

  private enqueueCacheMutation(operation: string, mutations: WorkspaceDatabaseMutation[]): void {
    if (mutations.length === 0) return;
    this.writeQueue = this.writeQueue
      .then(() => this.readyPromise)
      .then(() => this.db.mutateStores(mutations))
      .catch(error => this.reportStorageError(operation, error));
  }

  private enqueueBoundedChatContentWrite(
    key: string,
    projectId: string,
    sessionId: string,
    payload: PersistedChatSessionContent,
    updatedAt: number,
    indexRows: RawChatSessionIndexRow[] = [],
  ): void {
    this.chatSessionContent.set(key, payload);
    this.chatSessionContentUpdatedAt.set(key, updatedAt);
    const evictions = this.evictChatContentEntries(updatedAt);
    const retained = this.chatSessionContent.get(key);
    const mutations: WorkspaceDatabaseMutation[] = [{
      storeName: TABLE_CHAT_SESSION_CONTENT,
      deletes: evictions.keys,
      puts: retained ? [{
        k: key,
        projectId,
        sessionId,
        turnsJson: serialize(retained.turns),
        updatedAt,
      }] : [],
    }];
    const nextIndexRows = [...indexRows, ...evictions.indexRows];
    if (nextIndexRows.length > 0) {
      mutations.push({storeName: TABLE_CHAT_SESSION_INDEX, puts: nextIndexRows});
    }
    this.enqueueCacheMutation('save chat content cache', mutations);
  }

  private async clearRebuildableCachesForStoragePressure(): Promise<void> {
    for (const projectId of Object.keys(this.projectCommits)) {
      delete this.projectCommits[projectId];
    }
    this.projectCommitUpdatedAt.clear();
    this.chatSessionIndex.clear();
    this.chatSessionContent.clear();
    this.chatSessionContentUpdatedAt.clear();
    this.diffCache.clear();
    this.fileCache.clear();
    await this.db.mutateStores([
      {storeName: TABLE_PROJECT_COMMITS, clear: true},
      {storeName: TABLE_CHAT_SESSION_INDEX, clear: true},
      {storeName: TABLE_CHAT_SESSION_CONTENT, clear: true},
      {storeName: TABLE_DIFF_CACHE, clear: true},
      {storeName: TABLE_FILE_CACHE, clear: true},
    ]);
  }

  private async persistGlobalRowsWithQuotaRecovery(rows: RawKVRow[]): Promise<void> {
    const mutation: WorkspaceDatabaseMutation[] = [{storeName: TABLE_GLOBAL_KV, puts: rows}];
    let quotaExceeded = false;
    try {
      await this.db.mutateStores(mutation);
      return;
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        this.reportStorageError('save global settings', error);
        return;
      }
      quotaExceeded = true;
    }

    try {
      await this.clearRebuildableCachesForStoragePressure();
      await this.db.mutateStores(mutation);
    } catch (error) {
      this.reportStorageError('save global settings after cache cleanup', error, quotaExceeded);
    }
  }

  private ensureProject(projectId: string): PersistedProjectState {
    if (!this.state.projects[projectId]) {
      this.state.projects[projectId] = defaultProjectState();
    }
    return this.state.projects[projectId];
  }

  private ensureProjectCommits(projectId: string): PersistedProjectCommitsState {
    if (!this.projectCommits[projectId]) {
      this.projectCommits[projectId] = defaultProjectCommitsState();
    }
    return this.projectCommits[projectId];
  }

  getGlobalState(): PersistedGlobalState {
    return cloneState(this.state.global);
  }

  getProjectState(projectId: string): PersistedProjectState {
    return cloneState(this.state.projects[projectId] ?? defaultProjectState());
  }

  getProjectCommitsState(projectId: string): PersistedProjectCommitsState {
    return cloneState(this.projectCommits[projectId] ?? defaultProjectCommitsState());
  }

  getProjectChatSessions(projectId: string): PersistedChatSessionEntry[] {
    if (!projectId) return [];
    const prefix = chatProjectPrefix(projectId);
    const entries: PersistedChatSessionEntry[] = [];
    for (const [key, value] of this.chatSessionIndex.entries()) {
      if (!key.startsWith(prefix)) continue;
      entries.push(cloneState(value));
    }
    return entries.sort((a, b) => {
      const updatedAtDelta = compareUpdatedAtDesc(a.session.updatedAt || '', b.session.updatedAt || '');
      if (updatedAtDelta !== 0) return updatedAtDelta;
      return (a.session.title || '').localeCompare(b.session.title || '');
    });
  }

  getProjectChatSessionContent(projectId: string, sessionId: string): PersistedChatSessionContent | null {
    if (!projectId || !sessionId) return null;
    const entry = this.chatSessionContent.get(chatSessionKey(projectId, sessionId));
    return entry ? cloneState(entry) : null;
  }

  replaceProjectChatSessions(projectId: string, sessions: PersistedChatSessionEntry[]): void {
    if (!projectId) return;
    const prefix = chatProjectPrefix(projectId);
    const keepKeys = new Set<string>();
    const now = Date.now();

    for (const sessionEntry of sessions) {
      const sessionId = sessionEntry.session.sessionId;
      if (!sessionId) continue;
      const key = chatSessionKey(projectId, sessionId);
      keepKeys.add(key);
      const existingContent = this.chatSessionContent.get(key) ?? {turns: []};
      const nextCache = reconcilePersistedChatSessionCache(
        sessionEntry.session,
        sessionEntry.cursor,
        existingContent.turns,
      );
      const entry: PersistedChatSessionEntry = {
        session: sessionEntry.session,
        cursor: nextCache.cursor,
      };
      this.chatSessionIndex.set(key, entry);
      const contentChanged = !samePersistedTurns(existingContent.turns, nextCache.turns);
      const indexRow: RawChatSessionIndexRow = {
        k: key,
        projectId,
        sessionId,
        sessionJson: serialize(entry.session),
        cursorJson: serialize(entry.cursor),
        updatedAt: now,
      };
      if (contentChanged) {
        this.enqueueBoundedChatContentWrite(
          key,
          projectId,
          sessionId,
          {turns: nextCache.turns},
          now,
          [indexRow],
        );
      } else {
        void this.ready().then(() => this.db.putRow(TABLE_CHAT_SESSION_INDEX, indexRow)).catch(() => undefined);
      }
    }

    const deleteKeys: string[] = [];
    for (const key of this.chatSessionIndex.keys()) {
      if (!key.startsWith(prefix)) continue;
      if (keepKeys.has(key)) continue;
      deleteKeys.push(key);
    }

    for (const key of deleteKeys) {
      this.chatSessionIndex.delete(key);
      this.chatSessionContent.delete(key);
      this.chatSessionContentUpdatedAt.delete(key);
      void this.ready().then(async () => {
        await this.db.deleteRow(TABLE_CHAT_SESSION_INDEX, key);
        await this.db.deleteRow(TABLE_CHAT_SESSION_CONTENT, key);
      }).catch(() => undefined);
    }
  }

  patchProjectChatSession(projectId: string, session: RegistryChatSession, cursor: PersistedChatCursor): void {
    const sessionId = (session.sessionId || '').trim();
    if (!projectId || !sessionId) return;
    const key = chatSessionKey(projectId, sessionId);
    const now = Date.now();
    const existingContent = this.chatSessionContent.get(key) ?? {turns: []};
    const nextCache = reconcilePersistedChatSessionCache(session, cursor, existingContent.turns);
    const entry: PersistedChatSessionEntry = {
      session,
      cursor: nextCache.cursor,
    };
    this.chatSessionIndex.set(key, entry);
    const contentChanged = !samePersistedTurns(existingContent.turns, nextCache.turns);
    const indexRow: RawChatSessionIndexRow = {
      k: key,
      projectId,
      sessionId,
      sessionJson: serialize(entry.session),
      cursorJson: serialize(entry.cursor),
      updatedAt: now,
    };
    if (contentChanged) {
      this.enqueueBoundedChatContentWrite(
        key,
        projectId,
        sessionId,
        {turns: nextCache.turns},
        now,
        [indexRow],
      );
    } else {
      void this.ready().then(() => this.db.putRow(TABLE_CHAT_SESSION_INDEX, indexRow)).catch(() => undefined);
    }
  }

  patchProjectChatSessionContent(
    projectId: string,
    sessionId: string,
    turns: RegistrySessionTurn[],
  ): void {
    if (!projectId || !sessionId) return;
    const key = chatSessionKey(projectId, sessionId);
    const now = Date.now();
    const sanitizedTurns = sanitizePersistedTurns(turns);
    const proposedCursor = {turnIndex: persistedFinishedPrefixTurnIndex(sanitizedTurns)};
    const existingIndex = this.chatSessionIndex.get(key);
    const repairedCache = existingIndex
      ? reconcilePersistedChatSessionCache(existingIndex.session, proposedCursor, sanitizedTurns)
      : {
          cursor: proposedCursor,
          turns: persistedTurnPrefix(sanitizedTurns, proposedCursor),
          stale: false,
        };
    const payload: PersistedChatSessionContent = {
      turns: repairedCache.turns,
    };
    const indexRows: RawChatSessionIndexRow[] = [];
    if (existingIndex && existingIndex.cursor.turnIndex !== repairedCache.cursor.turnIndex) {
      const nextIndex = {
        session: existingIndex.session,
        cursor: repairedCache.cursor,
      };
      this.chatSessionIndex.set(key, nextIndex);
      indexRows.push({
        k: key,
        projectId,
        sessionId,
        sessionJson: serialize(nextIndex.session),
        cursorJson: serialize(nextIndex.cursor),
        updatedAt: now,
      });
    }
    this.enqueueBoundedChatContentWrite(key, projectId, sessionId, payload, now, indexRows);
  }

  deleteProjectChatSession(projectId: string, sessionId: string): void {
    if (!projectId || !sessionId) return;
    const key = chatSessionKey(projectId, sessionId);
    this.chatSessionIndex.delete(key);
    this.chatSessionContent.delete(key);
    this.chatSessionContentUpdatedAt.delete(key);
    void this.ready().then(async () => {
      await this.db.deleteRow(TABLE_CHAT_SESSION_INDEX, key);
      await this.db.deleteRow(TABLE_CHAT_SESSION_CONTENT, key);
    }).catch(() => undefined);
  }
  patchGlobalState(patch: Partial<PersistedGlobalState>): void {
    this.state.global = sanitizeGlobalState({...this.state.global, ...patch});
    const now = Date.now();
    const next = cloneState(this.state.global);
    const rows = globalRowsForPatch(patch, next, now);
    if (rows.length === 0) return;
    this.writeQueue = this.writeQueue
      .then(() => this.readyPromise)
      .then(() => this.persistGlobalRowsWithQuotaRecovery(rows));
  }

  patchProjectState(projectId: string, patch: Partial<PersistedProjectState>): void {
    if (!projectId) return;
    const current = this.ensureProject(projectId);
    this.state.projects[projectId] = sanitizeProjectState({...current, ...patch});
    const now = Date.now();
    const nextState = cloneState(this.state.projects[projectId]);
    void this.ready().then(() => this.db.putRow(TABLE_PROJECT_STATE, {
      projectId,
      stateJson: serialize(nextState),
      updatedAt: now,
    })).catch(() => undefined);
  }

  patchProjectCommitsState(projectId: string, patch: Partial<PersistedProjectCommitsState>): void {
    if (!projectId) return;
    const current = this.ensureProjectCommits(projectId);
    this.projectCommits[projectId] = sanitizeProjectCommitsState({...current, ...patch});
    const now = Date.now();
    this.projectCommitUpdatedAt.set(projectId, now);
    const evictedKeys = this.evictProjectCommitEntries(now);
    const retained = this.projectCommits[projectId];
    this.enqueueCacheMutation('save project commit cache', [{
      storeName: TABLE_PROJECT_COMMITS,
      deletes: evictedKeys,
      puts: retained ? [{
        projectId,
        commitsJson: serialize(retained.commits),
        commitFilesByShaJson: serialize(retained.commitFilesBySha),
        updatedAt: now,
      }] : [],
    }]);
  }

  getProjectDiff(projectId: string, key: string): DiffCacheEntry | null {
    if (!projectId || !key) return null;
    const entry = this.diffCache.get(diffCacheKey(projectId, key));
    return entry ? cloneState(entry) : null;
  }

  putProjectDiff(projectId: string, key: string, entry: Omit<DiffCacheEntry, 'updatedAt'>): void {
    if (!projectId || !key) return;
    const now = Date.now();
    const k = diffCacheKey(projectId, key);
    this.diffCache.set(k, {
      ...entry,
      updatedAt: now,
    });

    const prefix = `dc:${projectId}:`;
    const keysByNewest = [...this.diffCache.entries()]
      .filter(([cacheKey]) => cacheKey.startsWith(prefix))
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, DIFF_CACHE_LIMIT)
      .map(item => item[0]);

    const keepSet = new Set(keysByNewest);
    const evictedKeys = new Set<string>();
    for (const cacheKey of [...this.diffCache.keys()]) {
      if (!cacheKey.startsWith(prefix)) continue;
      if (keepSet.has(cacheKey)) continue;
      this.diffCache.delete(cacheKey);
      evictedKeys.add(cacheKey);
    }

    for (const cacheKey of this.evictDiffEntries(now)) evictedKeys.add(cacheKey);

    const payload = this.diffCache.get(k);
    this.enqueueCacheMutation('save diff cache', [{
      storeName: TABLE_DIFF_CACHE,
      deletes: [...evictedKeys],
      puts: payload ? [{
        k,
        v: serialize({
          diff: payload.diff,
          isBinary: payload.isBinary,
          truncated: payload.truncated,
        }),
        updatedAt: payload.updatedAt,
      }] : [],
    }]);
  }

  getCachedFile(projectId: string, kind: 'file' | 'dir', path: string): FileCacheEntry | null {
    if (!projectId || !path) return null;
    const entry = this.fileCache.get(fileCacheKey(projectId, kind, path));
    return entry ? cloneState(entry) : null;
  }

  putCachedFile(projectId: string, kind: 'file' | 'dir', path: string, hash: string, value: string): void {
    if (!projectId || !path) return;
    const now = Date.now();
    const k = fileCacheKey(projectId, kind, path);
    this.fileCache.set(k, {
      hash: hash || '',
      value,
      updatedAt: now,
    });
    const evictedKeys = this.evictFileEntries(now);
    const payload = this.fileCache.get(k);
    this.enqueueCacheMutation('save file cache', [{
      storeName: TABLE_FILE_CACHE,
      deletes: evictedKeys,
      puts: payload ? [{
        k,
        hash: payload.hash,
        v: payload.value,
        updatedAt: payload.updatedAt,
      }] : [],
    }]);
  }

  clearFileCache(): void {
    this.fileCache.clear();
    this.enqueueCacheMutation('clear file cache', [{storeName: TABLE_FILE_CACHE, clear: true}]);
  }

  clearCache(): void {
    for (const key of Object.keys(this.projectCommits)) {
      delete this.projectCommits[key];
    }
    this.projectCommitUpdatedAt.clear();
    this.chatSessionIndex.clear();
    this.chatSessionContent.clear();
    this.chatSessionContentUpdatedAt.clear();
    this.diffCache.clear();
    this.fileCache.clear();

    const now = Date.now();
    this.enqueueCacheMutation('clear local cache', [
      {storeName: TABLE_PROJECT_COMMITS, clear: true},
      {storeName: TABLE_CHAT_SESSION_INDEX, clear: true},
      {storeName: TABLE_CHAT_SESSION_CONTENT, clear: true},
      {storeName: TABLE_DIFF_CACHE, clear: true},
      {storeName: TABLE_FILE_CACHE, clear: true},
      {
        storeName: TABLE_META,
        puts: [{
          k: 'cacheClearedAt',
          v: serialize(new Date(now).toISOString()),
          updatedAt: now,
        }],
      },
    ]);
  }

  async dumpDatabase(): Promise<WorkspaceDatabaseDump> {
    await this.flushPendingWrites();
    const [global, projects, projectCommits, chatSessionIndex, chatSessionContent, fileCache, diffCache, meta] = await Promise.all([
      this.db.getAllRows<{k: string; v: string; updatedAt: number}>(TABLE_GLOBAL_KV),
      this.db.getAllRows<{projectId: string; stateJson: string; updatedAt: number}>(TABLE_PROJECT_STATE),
      this.db.getAllRows<{projectId: string; commitsJson: string; commitFilesByShaJson: string; updatedAt: number}>(TABLE_PROJECT_COMMITS),
      this.db.getAllRows<{k: string; projectId: string; sessionId: string; sessionJson: string; cursorJson: string; updatedAt: number}>(TABLE_CHAT_SESSION_INDEX),
      this.db.getAllRows<{k: string; projectId: string; sessionId: string; turnsJson: string; updatedAt: number}>(TABLE_CHAT_SESSION_CONTENT),
      this.db.getAllRows<{k: string; hash: string; v: string; updatedAt: number}>(TABLE_FILE_CACHE),
      this.db.getAllRows<{k: string; v: string; updatedAt: number}>(TABLE_DIFF_CACHE),
      this.db.getAllRows<{k: string; v: string; updatedAt: number}>(TABLE_META),
    ]);
    const storageManager = globalThis.navigator?.storage;
    const [estimate, persisted] = await Promise.all([
      storageManager?.estimate
        ? storageManager.estimate().catch(() => null)
        : Promise.resolve(null),
      storageManager?.persisted
        ? storageManager.persisted().catch(() => null)
        : Promise.resolve(null),
    ]);
    const storage = buildWorkspaceDatabaseStorageStats(
      {
        [TABLE_GLOBAL_KV]: global,
        [TABLE_PROJECT_STATE]: projects,
        [TABLE_PROJECT_COMMITS]: projectCommits,
        [TABLE_CHAT_SESSION_INDEX]: chatSessionIndex,
        [TABLE_CHAT_SESSION_CONTENT]: chatSessionContent,
        [TABLE_FILE_CACHE]: fileCache,
        [TABLE_DIFF_CACHE]: diffCache,
        [TABLE_META]: meta,
      },
      estimate as WorkspaceBrowserStorageEstimate | null,
      persisted,
    );
    return {
      global: sortByKey(redactGlobalDumpRows(global)),
      projects: sortByProjectId(projects),
      projectCommits: sortByProjectId(projectCommits),
      chatSessionIndex: sortByKey(chatSessionIndex),
      chatSessionContent: sortByKey(chatSessionContent),
      fileCache: sortByKey(fileCache),
      diffCache: sortByKey(diffCache),
      meta: sortByKey(meta),
      storage,
      storageError: this.lastStorageError ? cloneState(this.lastStorageError) : null,
    };
  }
}

