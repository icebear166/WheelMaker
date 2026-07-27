import {
  createSessionNavSlideOutState,
  isSessionNavSlideOutCloseSuppressed,
  sessionNavSlideOutReducer,
} from './sessionNavSlideOutState';
import * as slideOutStateModule from './sessionNavSlideOutState';

describe('sessionNavSlideOutReducer', () => {
  it('opens from the closed state', () => {
    const next = sessionNavSlideOutReducer(createSessionNavSlideOutState(), { type: 'open' });
    expect(next.open).toBe(true);
  });

  it('closes on requestClose when nothing suppresses it', () => {
    const open = sessionNavSlideOutReducer(createSessionNavSlideOutState(), { type: 'open' });
    const next = sessionNavSlideOutReducer(open, { type: 'requestClose', suppressed: false });
    expect(next.open).toBe(false);
  });

  it('stays open on requestClose while suppressed', () => {
    const open = sessionNavSlideOutReducer(createSessionNavSlideOutState(), { type: 'open' });
    const next = sessionNavSlideOutReducer(open, { type: 'requestClose', suppressed: true });
    expect(next.open).toBe(true);
  });

  it('remembers scrollTop across open/close cycles', () => {
    let state = sessionNavSlideOutReducer(createSessionNavSlideOutState(), { type: 'open' });
    state = sessionNavSlideOutReducer(state, { type: 'scroll', scrollTop: 240 });
    state = sessionNavSlideOutReducer(state, { type: 'requestClose', suppressed: false });
    expect(state.open).toBe(false);
    expect(state.scrollTop).toBe(240);
    state = sessionNavSlideOutReducer(state, { type: 'open' });
    expect(state.scrollTop).toBe(240);
  });

  it('resets state on forceReset (mode switch)', () => {
    let state = sessionNavSlideOutReducer(createSessionNavSlideOutState(), { type: 'open' });
    state = sessionNavSlideOutReducer(state, { type: 'scroll', scrollTop: 240 });
    state = sessionNavSlideOutReducer(state, { type: 'forceReset' });
    expect(state).toEqual({ open: false, scrollTop: 0 });
  });
});

describe('isSessionNavSlideOutCloseSuppressed', () => {
  it('is suppressed while searching, a menu is open, or the pointer is down in the list', () => {
    expect(isSessionNavSlideOutCloseSuppressed({ searchActive: true, menuOpen: false, pointerDownInList: false })).toBe(true);
    expect(isSessionNavSlideOutCloseSuppressed({ searchActive: false, menuOpen: true, pointerDownInList: false })).toBe(true);
    expect(isSessionNavSlideOutCloseSuppressed({ searchActive: false, menuOpen: false, pointerDownInList: true })).toBe(true);
    expect(isSessionNavSlideOutCloseSuppressed({ searchActive: false, menuOpen: false, pointerDownInList: false })).toBe(false);
  });

  it('is suppressed while the archived view is open', () => {
    expect(isSessionNavSlideOutCloseSuppressed({ searchActive: false, menuOpen: false, pointerDownInList: false, archivedOpen: true })).toBe(true);
    expect(isSessionNavSlideOutCloseSuppressed({ searchActive: false, menuOpen: false, pointerDownInList: false, archivedOpen: false })).toBe(false);
    expect(isSessionNavSlideOutCloseSuppressed({ searchActive: false, menuOpen: false, pointerDownInList: false })).toBe(false);
  });
});

describe('session nav slide-out delayed close', () => {
  it('starts delayed close when the panel opens with the pointer outside', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    const autoClose = slideOutStateModule.createSessionNavSlideOutAutoClose(onClose);

    slideOutStateModule.syncSessionNavSlideOutAutoClose(autoClose, {
      open: true,
      pointerInside: false,
      suppressed: false,
    });
    jest.advanceTimersByTime(2000);

    expect(onClose).toHaveBeenCalledTimes(1);
    autoClose.dispose();
    jest.useRealTimers();
  });

  it('cancels a pending close while the pointer is inside the panel', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    const autoClose = slideOutStateModule.createSessionNavSlideOutAutoClose(onClose);

    autoClose.schedule(false);
    slideOutStateModule.syncSessionNavSlideOutAutoClose(autoClose, {
      open: true,
      pointerInside: true,
      suppressed: false,
    });
    jest.advanceTimersByTime(2000);

    expect(onClose).not.toHaveBeenCalled();
    autoClose.dispose();
    jest.useRealTimers();
  });

  it('waits two seconds and cancels when the pointer returns', () => {
    jest.useFakeTimers();
    const createAutoClose = (
      slideOutStateModule as typeof slideOutStateModule & {
        createSessionNavSlideOutAutoClose?: (onClose: () => void) => {
          schedule: (suppressed: boolean) => void;
          cancel: () => void;
          closeNow: () => void;
          dispose: () => void;
        };
      }
    ).createSessionNavSlideOutAutoClose;
    expect(createAutoClose).toBeDefined();
    if (!createAutoClose) return;

    const onClose = jest.fn();
    const autoClose = createAutoClose(onClose);
    autoClose.schedule(false);
    jest.advanceTimersByTime(1999);
    expect(onClose).not.toHaveBeenCalled();
    autoClose.cancel();
    jest.advanceTimersByTime(1);
    expect(onClose).not.toHaveBeenCalled();

    autoClose.schedule(false);
    jest.advanceTimersByTime(2000);
    expect(onClose).toHaveBeenCalledTimes(1);
    autoClose.dispose();
    jest.useRealTimers();
  });

  it('keeps suppressed exits open and lets explicit close bypass the delay', () => {
    jest.useFakeTimers();
    const createAutoClose = (
      slideOutStateModule as typeof slideOutStateModule & {
        createSessionNavSlideOutAutoClose?: (onClose: () => void) => {
          schedule: (suppressed: boolean) => void;
          cancel: () => void;
          closeNow: () => void;
          dispose: () => void;
        };
      }
    ).createSessionNavSlideOutAutoClose;
    expect(createAutoClose).toBeDefined();
    if (!createAutoClose) return;

    const onClose = jest.fn();
    const autoClose = createAutoClose(onClose);
    autoClose.schedule(true);
    jest.advanceTimersByTime(2000);
    expect(onClose).not.toHaveBeenCalled();
    autoClose.closeNow();
    expect(onClose).toHaveBeenCalledTimes(1);
    autoClose.dispose();
    jest.useRealTimers();
  });
});
