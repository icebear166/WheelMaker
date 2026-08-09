import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {MENU_EXIT_MS} from '../sessionlist/menuExit';
import type {ChatComposerMenuState} from './chatComposerMenu';
import {useChatComposerMenu, type ChatComposerMenuSetter} from './useChatComposerMenu';

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
  menu: ChatComposerMenuState;
  exiting: boolean;
  setMenu: ChatComposerMenuSetter;
};

function Probe({handle}: {handle: ProbeHandle}) {
  const [menu, setMenu, exiting] = useChatComposerMenu();
  handle.menu = menu;
  handle.exiting = exiting;
  handle.setMenu = setMenu;
  return null;
}

async function renderProbe(): Promise<ProbeHandle> {
  const handle: ProbeHandle = {menu: {id: 'none'}, exiting: false, setMenu: () => undefined};
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(<Probe handle={handle} />);
  });
  expect(tree).toBeDefined();
  return handle;
}

describe('useChatComposerMenu', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMatchMedia(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps at most one menu open', async () => {
    const handle = await renderProbe();
    await act(async () => {
      handle.setMenu({id: 'slash'});
    });
    expect(handle.menu).toEqual({id: 'slash'});

    await act(async () => {
      handle.setMenu({id: 'file-mention'});
    });
    expect(handle.menu).toEqual({id: 'file-mention'});
    expect(handle.exiting).toBe(false); // switch is immediate, no exit for the previous menu
  });

  it('closes keyboard-driven menus immediately', async () => {
    const handle = await renderProbe();

    await act(async () => {
      handle.setMenu({id: 'slash'});
    });
    await act(async () => {
      handle.setMenu(null);
    });
    expect(handle.menu).toEqual({id: 'none'});
    expect(handle.exiting).toBe(false);

    await act(async () => {
      handle.setMenu({id: 'file-mention'});
    });
    await act(async () => {
      handle.setMenu(null);
    });
    expect(handle.menu).toEqual({id: 'none'});
    expect(handle.exiting).toBe(false);
  });

  it('delays close until the exit animation finishes', async () => {
    const handle = await renderProbe();
    await act(async () => {
      handle.setMenu({id: 'context-usage'});
    });
    await act(async () => {
      handle.setMenu(null);
    });
    expect(handle.menu).toEqual({id: 'context-usage'}); // still mounted during exit
    expect(handle.exiting).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(MENU_EXIT_MS);
    });
    expect(handle.menu).toEqual({id: 'none'});
    expect(handle.exiting).toBe(false);
  });

  it('closes immediately under reduced motion', async () => {
    mockMatchMedia(true);
    const handle = await renderProbe();
    await act(async () => {
      handle.setMenu({id: 'slash'});
    });
    await act(async () => {
      handle.setMenu(null);
    });
    expect(handle.menu).toEqual({id: 'none'});
    expect(handle.exiting).toBe(false);
  });

  it('reopening the same menu during its exit cancels the exit', async () => {
    const handle = await renderProbe();
    await act(async () => {
      handle.setMenu({id: 'context-usage'});
    });
    await act(async () => {
      handle.setMenu(null);
    });
    expect(handle.exiting).toBe(true);

    await act(async () => {
      handle.setMenu({id: 'context-usage'});
    });
    expect(handle.exiting).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(MENU_EXIT_MS * 5);
    });
    expect(handle.menu).toEqual({id: 'context-usage'}); // survived
  });

  it('tracks config-value optionId and treats id-only equality per variant', async () => {
    const handle = await renderProbe();
    await act(async () => {
      handle.setMenu({id: 'config-value', optionId: 'model'});
    });
    expect(handle.menu).toEqual({id: 'config-value', optionId: 'model'});

    await act(async () => {
      handle.setMenu({id: 'config-value', optionId: 'effort'});
    });
    expect(handle.menu).toEqual({id: 'config-value', optionId: 'effort'});

    await act(async () => {
      handle.setMenu(current => (current.id === 'none' ? {id: 'slash'} : null));
    });
    expect(handle.exiting).toBe(true); // functional close
  });

  it('ignores close when nothing is open', async () => {
    const handle = await renderProbe();
    await act(async () => {
      handle.setMenu(null);
    });
    expect(handle.menu).toEqual({id: 'none'});
    expect(handle.exiting).toBe(false);
  });
});
