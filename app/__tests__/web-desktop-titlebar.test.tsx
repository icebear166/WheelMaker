import fs from 'fs';
import path from 'path';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {WheelMakerAppMenu} from '../web/src/shell/WheelMakerAppMenu';
import {
  DesktopDragRegion,
  DesktopWindowControls,
} from '../web/src/shell/layouts/desktop/DesktopTitleBar';

describe('desktop title bar', () => {
  const originalWindow = (global as typeof globalThis & {window?: unknown}).window;
  const originalSetTimeout = globalThis.setTimeout;

  afterEach(() => {
    (global as typeof globalThis & {window?: unknown}).window = originalWindow;
    jest.useRealTimers();
    // This jest/node combination can drop global setTimeout after fake timers;
    // restore it explicitly so later tests keep a working timer.
    globalThis.setTimeout = originalSetTimeout;
  });

  test('renders window controls only in the desktop runtime', async () => {
    (global as typeof globalThis & {window?: unknown}).window = {};
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<DesktopWindowControls />);
    });
    expect(renderer!.toJSON()).toBeNull();

    const minimize = jest.fn();
    const toggleMaximize = jest.fn();
    const close = jest.fn();
    (global as typeof globalThis & {window?: unknown}).window = {
      WheelMakerDesktop: {enabled: true, minimize, toggleMaximize, close},
    };
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<DesktopWindowControls />);
    });
    const root = renderer!.root;
    for (const label of ['Minimize', 'Maximize or restore', 'Close']) {
      root.findByProps({'aria-label': label}).props.onClick();
    }
    expect(minimize).toHaveBeenCalledTimes(1);
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('uses the shared app menu with Desktop-only Dev Mode last', async () => {
    const check = jest.fn(async () => ({
      status: 'available' as const,
      currentVersion: 'v1.8',
      latestVersion: 'v1.9',
    }));
    const start = jest.fn(async () => undefined);
    (global as typeof globalThis & {window?: unknown}).window = {
      WheelMakerDesktop: {enabled: true, requestLocalDevMode: jest.fn()},
    };

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <WheelMakerAppMenu
          themeMode="dark"
          setThemeMode={jest.fn()}
          onOpenSettings={jest.fn()}
          onOpenPortRelay={jest.fn()}
          onOpenReleasePublishing={jest.fn()}
          updateController={{check, start}}
        />,
      );
    });
    await ReactTestRenderer.act(async () => {
      renderer!.root.findByProps({'aria-label': 'Open WheelMaker menu'}).props.onClick();
    });

    const actions = renderer!.root.findAll(
      node => typeof node.props['data-app-menu-action'] === 'string',
    );
    expect(actions.map(action => action.props['data-app-menu-action'])).toEqual([
      'settings',
      'theme',
      'port-relay',
      'update',
      'release-publish',
      'local-dev',
    ]);
    expect(renderer!.root.findByProps({role: 'menuitemcheckbox'}).props['aria-checked']).toBe(false);
  });

  test('portals the menu and keeps focus trapped in the Local Dev dialog', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'shell', 'WheelMakerAppMenu.tsx'),
      'utf8',
    );
    expect(source).toContain("import {createPortal} from 'react-dom';");
    expect(source).toContain('createPortal(appMenu, document.body)');
    expect(source).toContain("if (event.key !== 'Tab') return;");
    expect(source).toContain('previouslyFocused?.focus();');
  });

  test('plays the exit animation before unmounting the menu', async () => {
    jest.useFakeTimers();
    (global as typeof globalThis & {window?: unknown}).window = {
      WheelMakerDesktop: {enabled: true, requestLocalDevMode: jest.fn()},
      matchMedia: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    };
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <WheelMakerAppMenu
          themeMode="dark"
          setThemeMode={jest.fn()}
          onOpenSettings={jest.fn()}
          onOpenPortRelay={jest.fn()}
          onOpenReleasePublishing={jest.fn()}
        />,
      );
    });
    const trigger = renderer!.root.findByProps({'aria-label': 'Open WheelMaker menu'});
    await ReactTestRenderer.act(() => trigger.props.onClick());
    await ReactTestRenderer.act(() => trigger.props.onClick());
    expect(renderer!.root.findByProps({role: 'menu'}).props.className).toContain('sl-menu-exit');
    await ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(renderer!.root.findAllByProps({role: 'menu'})).toHaveLength(0);
  });

  test('opens the legacy Local Dev configuration dialog', async () => {
    const requestLocalDevMode = jest.fn();
    (global as typeof globalThis & {window?: unknown}).window = {
      WheelMakerDesktop: {enabled: true, requestLocalDevMode},
    };
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <WheelMakerAppMenu
          themeMode="light"
          setThemeMode={jest.fn()}
          onOpenSettings={jest.fn()}
          onOpenPortRelay={jest.fn()}
          onOpenReleasePublishing={jest.fn()}
        />,
      );
    });
    await ReactTestRenderer.act(() => {
      renderer!.root.findByProps({'aria-label': 'Open WheelMaker menu'}).props.onClick();
    });
    await ReactTestRenderer.act(() => {
      renderer!.root.findByProps({role: 'menuitemcheckbox'}).props.onClick();
    });
    const input = renderer!.root.findByProps({'aria-label': 'WheelMaker source directory'});
    await ReactTestRenderer.act(() => {
      input.props.onChange({target: {value: 'E:\\Code\\WheelMaker'}});
    });
    await ReactTestRenderer.act(() => {
      renderer!.root.findByProps({'data-local-dev-enter': true}).props.onClick();
    });
    expect(requestLocalDevMode).toHaveBeenCalledWith('E:\\Code\\WheelMaker');
  });

  test('drags desktop title rows except interactive targets', async () => {
    const startDrag = jest.fn();
    const toggleMaximize = jest.fn();
    (global as typeof globalThis & {window?: unknown}).window = {
      WheelMakerDesktop: {enabled: true, startDrag, toggleMaximize},
    };
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <DesktopDragRegion className="chat-title-bar">
          <span>Title</span>
          <button type="button">Action</button>
        </DesktopDragRegion>,
      );
    });
    const region = renderer!.root.findByProps({'data-desktop-drag-region': true});
    const preventDefault = jest.fn();
    const dragTarget = {closest: () => null};
    region.props.onMouseDown({button: 0, detail: 1, target: dragTarget, preventDefault});
    region.props.onMouseDown({button: 0, detail: 2, target: dragTarget, preventDefault});
    region.props.onMouseDown({
      button: 0,
      detail: 1,
      target: {closest: () => ({})},
      preventDefault,
    });
    expect(startDrag).toHaveBeenCalledTimes(1);
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
  });
});
