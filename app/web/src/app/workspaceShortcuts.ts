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

export function resolveSessionsShortcutAction(
  state: SessionsShortcutState,
): SessionsShortcutAction {
  if (state.sessionPanelPinned) {
    return state.temporarilyUnpinned ? 'restore-pin' : 'temporarily-unpin';
  }
  return state.slideOutOpen ? 'close-slideout' : 'open-slideout';
}
