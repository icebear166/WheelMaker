export type WorkspaceSearchTarget = 'current' | 'preview' | 'sessions';

export type WorkspaceSearchShortcutEvent = {
  altKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
  shiftKey?: boolean;
};

export type WorkspaceSearchShortcutContext = {
  previewFocused: boolean;
  previewSearchable: boolean;
};

export function resolveWorkspaceSearchShortcutTarget(
  event: WorkspaceSearchShortcutEvent,
  context: WorkspaceSearchShortcutContext,
): WorkspaceSearchTarget | null {
  if (
    event.key.toLowerCase() !== 'f' ||
    event.altKey ||
    (!event.ctrlKey && !event.metaKey)
  ) {
    return null;
  }

  if (event.shiftKey) {
    return 'sessions';
  }

  return context.previewFocused && context.previewSearchable ? 'preview' : 'current';
}

export type SessionSearchExpansion = 'focus-only' | 'open-slideout';

export function resolveSessionSearchExpansion({
  sessionPanelPinned,
  slideOutOpen,
}: {
  sessionPanelPinned: boolean;
  slideOutOpen: boolean;
}): SessionSearchExpansion {
  return sessionPanelPinned || slideOutOpen ? 'focus-only' : 'open-slideout';
}
