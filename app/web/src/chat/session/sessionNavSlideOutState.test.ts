import {
  createSessionNavSlideOutState,
  isSessionNavSlideOutCloseSuppressed,
  sessionNavSlideOutReducer,
} from './sessionNavSlideOutState';

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
});
