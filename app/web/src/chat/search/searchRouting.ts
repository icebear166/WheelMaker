export type WorkspaceSearchTarget = 'current' | 'preview';

export type WorkspaceSearchShortcutContext = {
  previewFocused: boolean;
  previewSearchable: boolean;
};

export function resolveWorkspaceSearchTarget(
  context: WorkspaceSearchShortcutContext,
): WorkspaceSearchTarget {
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
