export type SessionNavSlideOutState = {
  open: boolean;
  scrollTop: number;
};

export type SessionNavSlideOutAction =
  | { type: 'open' }
  | { type: 'requestClose'; suppressed: boolean }
  | { type: 'scroll'; scrollTop: number }
  | { type: 'forceReset' };

export function createSessionNavSlideOutState(): SessionNavSlideOutState {
  return { open: false, scrollTop: 0 };
}

export function sessionNavSlideOutReducer(
  state: SessionNavSlideOutState,
  action: SessionNavSlideOutAction,
): SessionNavSlideOutState {
  switch (action.type) {
    case 'open':
      return { ...state, open: true };
    case 'requestClose':
      return action.suppressed ? state : { ...state, open: false };
    case 'scroll':
      return { ...state, scrollTop: Math.max(0, action.scrollTop) };
    case 'forceReset':
      return createSessionNavSlideOutState();
    default:
      return state;
  }
}

export type SessionNavSlideOutSuppressionInput = {
  searchActive: boolean;
  menuOpen: boolean;
  pointerDownInList: boolean;
};

export function isSessionNavSlideOutCloseSuppressed(
  input: SessionNavSlideOutSuppressionInput,
): boolean {
  return input.searchActive || input.menuOpen || input.pointerDownInList;
}
