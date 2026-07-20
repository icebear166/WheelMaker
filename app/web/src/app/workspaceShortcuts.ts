export type WindowsWorkspaceShortcut = 'sessions' | 'preview' | 'terminal';

export type SessionsShortcutAction =
  | 'open-slideout'
  | 'close-slideout'
  | 'temporarily-unpin'
  | 'restore-pin';

export type SessionsShortcutState = {
  sessionPanelPinned: boolean;
  temporarilyUnpinned: boolean;
  slideOutOpen: boolean;
};

export type WorkspaceShortcutEvent = Pick<
  KeyboardEvent,
  'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'isComposing' | 'defaultPrevented'
>;

export function resolveWindowsWorkspaceShortcut(
  event: WorkspaceShortcutEvent,
  environment: {isWindows: boolean; isWide: boolean},
): WindowsWorkspaceShortcut | null {
  if (
    !environment.isWindows ||
    !environment.isWide ||
    event.defaultPrevented ||
    event.isComposing ||
    !event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.metaKey
  ) {
    return null;
  }
  if (event.code === 'Digit1') return 'sessions';
  if (event.code === 'Digit2') return 'preview';
  if (event.code === 'Backquote') return 'terminal';
  return null;
}

export function resolveSessionsShortcutAction(
  state: SessionsShortcutState,
): SessionsShortcutAction {
  if (state.sessionPanelPinned) {
    return state.temporarilyUnpinned ? 'restore-pin' : 'temporarily-unpin';
  }
  return state.slideOutOpen ? 'close-slideout' : 'open-slideout';
}
