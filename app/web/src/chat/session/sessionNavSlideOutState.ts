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
  archivedOpen?: boolean;
};

export function isSessionNavSlideOutCloseSuppressed(
  input: SessionNavSlideOutSuppressionInput,
): boolean {
  return input.searchActive || input.menuOpen || input.pointerDownInList || input.archivedOpen === true;
}

export const SESSION_NAV_SLIDE_OUT_CLOSE_DELAY_MS = 2000;

export type SessionNavSlideOutAutoClose = {
  schedule: (suppressed: boolean) => void;
  cancel: () => void;
  closeNow: () => void;
  dispose: () => void;
};

export type SessionNavSlideOutAutoCloseSyncInput = {
  open: boolean;
  pointerInside: boolean;
  suppressed: boolean;
};

export function syncSessionNavSlideOutAutoClose(
  controller: SessionNavSlideOutAutoClose,
  input: SessionNavSlideOutAutoCloseSyncInput,
): void {
  if (!input.open || input.pointerInside) {
    controller.cancel();
    return;
  }
  controller.schedule(input.suppressed);
}

export function createSessionNavSlideOutAutoClose(
  onClose: () => void,
  delayMs = SESSION_NAV_SLIDE_OUT_CLOSE_DELAY_MS,
): SessionNavSlideOutAutoClose {
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (closeTimer === null) return;
    clearTimeout(closeTimer);
    closeTimer = null;
  };

  return {
    schedule(suppressed) {
      cancel();
      if (suppressed) return;
      closeTimer = setTimeout(() => {
        closeTimer = null;
        onClose();
      }, delayMs);
    },
    cancel,
    closeNow() {
      cancel();
      onClose();
    },
    dispose: cancel,
  };
}
