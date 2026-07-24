import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {MENU_EXIT_MS, useMenuExitFlag} from './menuExit';

function mockMatchMedia(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

type ProbeHandle = {
  open: boolean;
  exiting: boolean;
  setOpen: (next: boolean | ((current: boolean) => boolean)) => void;
};

function Probe({handle}: {handle: ProbeHandle}) {
  const [open, setOpen, exiting] = useMenuExitFlag();
  handle.open = open;
  handle.exiting = exiting;
  handle.setOpen = setOpen;
  return null;
}

async function renderProbe(): Promise<ProbeHandle> {
  const handle: ProbeHandle = {open: false, exiting: false, setOpen: () => undefined};
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(<Probe handle={handle} />);
  });
  expect(tree).toBeDefined();
  return handle;
}

describe('useMenuExitFlag', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMatchMedia(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('delays unmount until the exit animation finishes', async () => {
    const handle = await renderProbe();
    expect(handle.open).toBe(false);

    await act(async () => {
      handle.setOpen(true);
    });
    expect(handle.open).toBe(true);
    expect(handle.exiting).toBe(false);

    await act(async () => {
      handle.setOpen(false);
    });
    expect(handle.open).toBe(true); // still mounted during exit
    expect(handle.exiting).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(MENU_EXIT_MS);
    });
    expect(handle.open).toBe(false);
    expect(handle.exiting).toBe(false);
  });

  it('closes immediately under reduced motion', async () => {
    mockMatchMedia(true);
    const handle = await renderProbe();

    await act(async () => {
      handle.setOpen(true);
    });
    await act(async () => {
      handle.setOpen(false);
    });
    expect(handle.open).toBe(false);
    expect(handle.exiting).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(MENU_EXIT_MS * 2);
    });
    expect(handle.open).toBe(false);
  });

  it('does not restart the exit timer on repeated plain closes', async () => {
    const handle = await renderProbe();

    await act(async () => {
      handle.setOpen(true);
    });
    await act(async () => {
      handle.setOpen(false);
    });
    await act(async () => {
      jest.advanceTimersByTime(MENU_EXIT_MS / 2);
    });
    await act(async () => {
      handle.setOpen(false); // repeated outside-click close must not re-time
    });
    await act(async () => {
      jest.advanceTimersByTime(MENU_EXIT_MS / 2);
    });
    expect(handle.open).toBe(false); // closed 100ms after the FIRST close
  });

  it('reopens when toggled during the exit window', async () => {
    const handle = await renderProbe();

    await act(async () => {
      handle.setOpen(true);
    });
    await act(async () => {
      handle.setOpen(false);
    });
    expect(handle.exiting).toBe(true);

    await act(async () => {
      handle.setOpen(current => !current); // trigger toggle during exit
    });
    expect(handle.open).toBe(true);
    expect(handle.exiting).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(MENU_EXIT_MS * 5);
    });
    expect(handle.open).toBe(true);
  });
});
