import type { LayoutMode } from './responsiveLayout';
import type {
  PersistedFloatingControlSide,
} from '../../workspace/WorkspacePersistence';
import { sanitizeFloatingControlYRatio } from '../../preferences/floatingControlPreferences';
import { sanitizeHubColorMap } from '../../workspace/hubProjectPreferences';

export type WorkspaceUiStateValue<T> = T | ((current: T) => T);

export const DESKTOP_SIDEBAR_WIDTH_MIN = 320;
export const DESKTOP_SIDEBAR_WIDTH_DEFAULT = 380;
export const DESKTOP_SIDEBAR_WIDTH_MAX = 560;

export type WorkspaceFloatingDragState = {
  active: boolean;
  pressing: boolean;
  pointerId: number;
  originX: number;
  originY: number;
  startSide: PersistedFloatingControlSide;
  currentX: number;
  startTop: number;
  currentTop: number;
  cooldownUntil: number;
};

export type WorkspaceUiState = {
  shared: {
    settingsOpen: boolean;
    collapsedProjectIds: string[];
    pinnedProjectIds: string[];
    hiddenProjectIds: string[];
    expandedHubIds: string[];
    hubColors: Record<string, string>;
  };
  desktop: {
    sidebarCollapsed: boolean;
    sidebarWidth: number;
  };
  mobile: {
    drawerOpen: boolean;
    floatingControlYRatio: number;
    floatingControlSide: PersistedFloatingControlSide;
  };
  transient: {
    chatKeyboardInset: number;
    floatingKeyboardOffset: number;
    floatingDragState: WorkspaceFloatingDragState | null;
  };
};

export type WorkspaceUiStateInput = {
  settingsOpen?: unknown;
  sessionPanelPinned?: unknown;
  sidebarCollapsed?: unknown;
  desktopSidebarWidth?: unknown;
  collapsedProjectIds?: unknown;
  desktopCollapsedProjectIds?: unknown;
  pinnedProjectIds?: unknown;
  hiddenProjectIds?: unknown;
  expandedHubIds?: unknown;
  hubColors?: unknown;
  drawerOpen?: unknown;
  floatingControlYRatio?: unknown;
  floatingControlSide?: unknown;
  chatKeyboardInset?: unknown;
  floatingKeyboardOffset?: unknown;
  floatingDragState?: WorkspaceFloatingDragState | null;
};

export type WorkspaceUiAction =
  | { type: 'shared/setSettingsOpen'; next: WorkspaceUiStateValue<boolean> }
  | { type: 'shared/setCollapsedProjectIds'; next: WorkspaceUiStateValue<string[]> }
  | { type: 'shared/setPinnedProjectIds'; next: WorkspaceUiStateValue<string[]> }
  | { type: 'shared/setHiddenProjectIds'; next: WorkspaceUiStateValue<string[]> }
  | { type: 'shared/setExpandedHubIds'; next: WorkspaceUiStateValue<string[]> }
  | { type: 'shared/setHubColors'; next: WorkspaceUiStateValue<Record<string, string>> }
  | { type: 'desktop/setSidebarCollapsed'; next: WorkspaceUiStateValue<boolean> }
  | { type: 'desktop/setSidebarWidth'; next: WorkspaceUiStateValue<number> }
  | { type: 'mobile/setDrawerOpen'; next: WorkspaceUiStateValue<boolean> }
  | {
      type: 'mobile/setFloatingControlYRatio';
      next: WorkspaceUiStateValue<number>;
    }
  | {
      type: 'mobile/setFloatingControlSide';
      next: WorkspaceUiStateValue<PersistedFloatingControlSide>;
    }
  | { type: 'transient/setChatKeyboardInset'; next: WorkspaceUiStateValue<number> }
  | {
      type: 'transient/setFloatingKeyboardOffset';
      next: WorkspaceUiStateValue<number>;
    }
  | {
      type: 'transient/setFloatingDragState';
      next: WorkspaceUiStateValue<WorkspaceFloatingDragState | null>;
    }
  | { type: 'layout/modeChanged'; from: LayoutMode; to: LayoutMode };

function resolveNext<T>(current: T, next: WorkspaceUiStateValue<T>): T {
  return typeof next === 'function'
    ? (next as (current: T) => T)(current)
    : next;
}

function sanitizeFloatingControlSide(value: unknown): PersistedFloatingControlSide {
  return value === 'left' || value === 'right' ? value : 'right';
}

function sanitizeInset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

export function sanitizeDesktopSidebarWidth(
  value: unknown,
  fallback = DESKTOP_SIDEBAR_WIDTH_DEFAULT,
): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(
    DESKTOP_SIDEBAR_WIDTH_MAX,
    Math.max(DESKTOP_SIDEBAR_WIDTH_MIN, Math.round(numeric)),
  );
}

function sanitizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter(item => typeof item === 'string' && item)))
    : [];
}

function resetTransientState(): WorkspaceUiState['transient'] {
  return {
    chatKeyboardInset: 0,
    floatingKeyboardOffset: 0,
    floatingDragState: null,
  };
}

export function createWorkspaceUiState(input: WorkspaceUiStateInput = {}): WorkspaceUiState {
  return {
    shared: {
      settingsOpen: typeof input.settingsOpen === 'boolean' ? input.settingsOpen : false,
      collapsedProjectIds: sanitizeStringList(
        Array.isArray(input.collapsedProjectIds)
          ? input.collapsedProjectIds
          : input.desktopCollapsedProjectIds,
      ),
      pinnedProjectIds: sanitizeStringList(input.pinnedProjectIds),
      hiddenProjectIds: sanitizeStringList(input.hiddenProjectIds),
      expandedHubIds: sanitizeStringList(input.expandedHubIds),
      hubColors: sanitizeHubColorMap(input.hubColors),
    },
    desktop: {
      sidebarCollapsed:
        typeof input.sessionPanelPinned === 'boolean'
          ? !input.sessionPanelPinned
          : typeof input.sidebarCollapsed === 'boolean'
            ? input.sidebarCollapsed
            : true,
      sidebarWidth: sanitizeDesktopSidebarWidth(input.desktopSidebarWidth),
    },
    mobile: {
      drawerOpen: typeof input.drawerOpen === 'boolean' ? input.drawerOpen : false,
      floatingControlYRatio: sanitizeFloatingControlYRatio(input.floatingControlYRatio),
      floatingControlSide: sanitizeFloatingControlSide(input.floatingControlSide),
    },
    transient: {
      chatKeyboardInset: sanitizeInset(input.chatKeyboardInset),
      floatingKeyboardOffset: sanitizeInset(input.floatingKeyboardOffset),
      floatingDragState: input.floatingDragState ?? null,
    },
  };
}

export function workspaceUiReducer(
  state: WorkspaceUiState,
  action: WorkspaceUiAction,
): WorkspaceUiState {
  switch (action.type) {
    case 'shared/setSettingsOpen':
      return {
        ...state,
        shared: {
          ...state.shared,
          settingsOpen: !!resolveNext(state.shared.settingsOpen, action.next),
        },
      };
    case 'shared/setCollapsedProjectIds':
      return {
        ...state,
        shared: {
          ...state.shared,
          collapsedProjectIds: sanitizeStringList(
            resolveNext(state.shared.collapsedProjectIds, action.next),
          ),
        },
      };
    case 'shared/setPinnedProjectIds':
      return {
        ...state,
        shared: {
          ...state.shared,
          pinnedProjectIds: sanitizeStringList(
            resolveNext(state.shared.pinnedProjectIds, action.next),
          ),
        },
      };
    case 'desktop/setSidebarCollapsed':
      return {
        ...state,
        desktop: {
          ...state.desktop,
          sidebarCollapsed: !!resolveNext(state.desktop.sidebarCollapsed, action.next),
        },
      };
    case 'desktop/setSidebarWidth':
      return {
        ...state,
        desktop: {
          ...state.desktop,
          sidebarWidth: sanitizeDesktopSidebarWidth(
            resolveNext(state.desktop.sidebarWidth, action.next),
            state.desktop.sidebarWidth,
          ),
        },
      };
    case 'mobile/setDrawerOpen':
      return {
        ...state,
        mobile: {
          ...state.mobile,
          drawerOpen: !!resolveNext(state.mobile.drawerOpen, action.next),
        },
      };
    case 'mobile/setFloatingControlYRatio':
      return {
        ...state,
        mobile: {
          ...state.mobile,
          floatingControlYRatio: sanitizeFloatingControlYRatio(
            resolveNext(state.mobile.floatingControlYRatio, action.next),
          ),
        },
      };
    case 'shared/setHiddenProjectIds':
      return {
        ...state,
        shared: {
          ...state.shared,
          hiddenProjectIds: sanitizeStringList(
            resolveNext(state.shared.hiddenProjectIds, action.next),
          ),
        },
      };
    case 'shared/setExpandedHubIds':
      return {
        ...state,
        shared: {
          ...state.shared,
          expandedHubIds: sanitizeStringList(
            resolveNext(state.shared.expandedHubIds, action.next),
          ),
        },
      };
    case 'shared/setHubColors':
      return {
        ...state,
        shared: {
          ...state.shared,
          hubColors: sanitizeHubColorMap(
            resolveNext(state.shared.hubColors, action.next),
          ),
        },
      };
    case 'mobile/setFloatingControlSide':
      return {
        ...state,
        mobile: {
          ...state.mobile,
          floatingControlSide: sanitizeFloatingControlSide(
            resolveNext(state.mobile.floatingControlSide, action.next),
          ),
        },
      };
    case 'transient/setChatKeyboardInset':
      return {
        ...state,
        transient: {
          ...state.transient,
          chatKeyboardInset: sanitizeInset(
            resolveNext(state.transient.chatKeyboardInset, action.next),
          ),
        },
      };
    case 'transient/setFloatingKeyboardOffset':
      return {
        ...state,
        transient: {
          ...state.transient,
          floatingKeyboardOffset: sanitizeInset(
            resolveNext(state.transient.floatingKeyboardOffset, action.next),
          ),
        },
      };
    case 'transient/setFloatingDragState':
      return {
        ...state,
        transient: {
          ...state.transient,
          floatingDragState: resolveNext(state.transient.floatingDragState, action.next),
        },
      };
    case 'layout/modeChanged':
      if (action.from === action.to) {
        return state;
      }
      return {
        ...state,
        mobile: {
          ...state.mobile,
          drawerOpen: false,
        },
        transient: resetTransientState(),
      };
    default:
      return state;
  }
}
