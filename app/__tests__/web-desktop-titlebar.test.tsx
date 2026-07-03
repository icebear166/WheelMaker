import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  DesktopDragRegion,
  DesktopWindowControls,
  DesktopWindowMenu,
} from '../web/src/shell/layouts/desktop/DesktopTitleBar';

describe('desktop window controls', () => {
  const originalWindow = (global as typeof globalThis & { window?: unknown }).window;

  afterEach(() => {
    (global as typeof globalThis & { window?: unknown }).window = originalWindow;
  });

  test('renders nothing outside the desktop WebView runtime', async () => {
    (global as typeof globalThis & { window?: unknown }).window = {};

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<DesktopWindowControls />);
    });

    expect(renderer!.toJSON()).toBeNull();
  });

  test('renders frameless controls with settings and window actions', async () => {
    const minimize = jest.fn();
    const toggleMaximize = jest.fn();
    const close = jest.fn();
    const onSettingsSelect = jest.fn();
    (global as typeof globalThis & { window?: unknown }).window = {
      WheelMakerDesktop: {
        enabled: true,
        minimize,
        toggleMaximize,
        close,
      },
    };

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<DesktopWindowControls onSettingsSelect={onSettingsSelect} />);
    });

    const root = renderer!.root;
    expect(root.findByProps({'data-desktop-window-controls': true})).toBeDefined();
    expect(root.findAllByProps({'data-desktop-titlebar': true})).toHaveLength(0);
    expect(root.findAllByProps({className: 'desktop-window-menu-button'})).toHaveLength(0);
    expect(root.findAllByProps({className: 'desktop-titlebar-title-group'})).toHaveLength(0);

    const buttons = root.findAllByType('button');
    expect(buttons.map(button => button.props['aria-label']).filter(Boolean)).toEqual([
      'Open settings',
      'Minimize',
      'Maximize or restore',
      'Close',
    ]);

    root.findByProps({'aria-label': 'Open settings'}).props.onClick();
    expect(onSettingsSelect).toHaveBeenCalledTimes(1);
    root.findByProps({'aria-label': 'Minimize'}).props.onClick();
    root.findByProps({'aria-label': 'Maximize or restore'}).props.onClick();
    root.findByProps({'aria-label': 'Close'}).props.onClick();

    expect(minimize).toHaveBeenCalled();
    expect(toggleMaximize).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  test('renders the WheelMaker menu with source panel controls', async () => {
    const getWebSourceState = jest.fn(async () => ({
      preference: 'auto',
      actualSource: 'remote',
      displayTitle: 'WheelMaker - example.com',
      displaySource: 'example.com',
      remoteUrl: 'https://example.com/',
      remoteHost: 'example.com',
    }));
    const setWebSourcePreference = jest.fn(async () => ({
      preference: 'embedded',
      actualSource: 'embedded',
      displayTitle: 'WheelMaker - Embedded',
      displaySource: 'Embedded',
      remoteUrl: '',
      remoteHost: '',
    }));
    const reload = jest.fn();
    (global as typeof globalThis & { window?: unknown }).window = {
      location: {reload},
      WheelMakerDesktop: {
        enabled: true,
        getWebSourceState,
        setWebSourcePreference,
      },
    };

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<DesktopWindowMenu />);
    });

    const root = renderer!.root;
    expect(root.findByProps({className: 'desktop-window-menu-button'}).findByProps({className: 'desktop-titlebar-icon'})).toBeDefined();

    const menuButton = root.findByProps({className: 'desktop-window-menu-button'});
    expect(menuButton.props['aria-expanded']).toBe(false);
    await ReactTestRenderer.act(async () => {
      menuButton.props.onClick();
    });
    expect(root.findByProps({className: 'desktop-window-menu'}).props.role).toBe('menu');

    const menuItems = root.findAllByProps({className: 'desktop-window-menu-item'});
    expect(menuItems.map(item => item.props.children).flat().filter(Boolean).join(' ')).toContain('显示来源');
    expect(menuItems.map(item => item.props.children).flat().filter(Boolean).join(' ')).not.toContain('设置');

    await ReactTestRenderer.act(async () => {
      menuItems[0].props.onClick();
    });
    expect(root.findByProps({className: 'desktop-window-source-panel'})).toBeDefined();
    expect(root.findByProps({className: 'desktop-window-source-current'}).props.title).toBe('https://example.com/');
    const sourceRefreshButton = root.findByProps({className: 'desktop-window-source-refresh'});
    sourceRefreshButton.props.onClick();
    expect(reload).toHaveBeenCalledTimes(1);

    const sourceItems = root.findAllByProps({className: 'desktop-window-source-choice'});
    expect(sourceItems.map(item => item.props.children)).toEqual(['example.com', 'Embedded']);
    await ReactTestRenderer.act(async () => {
      await sourceItems[1].props.onClick();
    });
    expect(setWebSourcePreference).toHaveBeenCalledWith('embedded');
    expect(reload).toHaveBeenCalledTimes(2);
  });

  test('renders plain embedded source text when no remote URL is available', async () => {
    const getWebSourceState = jest.fn(async () => ({
      preference: 'auto',
      actualSource: 'embedded',
      displayTitle: 'WheelMaker - Embedded',
      displaySource: 'Embedded',
      remoteUrl: '',
      remoteHost: '',
    }));
    (global as typeof globalThis & { window?: unknown }).window = {
      WheelMakerDesktop: {
        enabled: true,
        getWebSourceState,
      },
    };

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<DesktopWindowMenu />);
    });

    const root = renderer!.root;
    await ReactTestRenderer.act(async () => {
      root.findByProps({className: 'desktop-window-menu-button'}).props.onClick();
    });
    await ReactTestRenderer.act(async () => {
      root.findByProps({className: 'desktop-window-menu-item'}).props.onClick();
    });

    expect(root.findByProps({className: 'desktop-window-source-current'}).props.children).toBe('Embedded');
    expect(root.findAllByProps({className: 'desktop-window-source-choice'})).toHaveLength(0);
    expect(root.findAllByProps({className: 'desktop-window-source-refresh'})).toHaveLength(0);
  });

  test('drags desktop title rows except interactive targets', async () => {
    const startDrag = jest.fn();
    const toggleMaximize = jest.fn();
    (global as typeof globalThis & { window?: unknown }).window = {
      WheelMakerDesktop: {
        enabled: true,
        startDrag,
        toggleMaximize,
      },
    };

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DesktopDragRegion className="block-title chat-title-bar">
          <span>Title</span>
          <button type="button">Action</button>
        </DesktopDragRegion>,
      );
    });

    const region = renderer!.root.findByProps({'data-desktop-drag-region': true});
    const dragTarget = {closest: () => null};
    const buttonTarget = {closest: (selector: string) => selector.includes('button') ? ({} as Element) : null};
    const preventDefault = jest.fn();

    region.props.onMouseDown({button: 0, detail: 1, target: dragTarget, preventDefault});
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(startDrag).toHaveBeenCalledTimes(1);

    region.props.onMouseDown({button: 0, detail: 2, target: dragTarget, preventDefault});
    expect(toggleMaximize).toHaveBeenCalledTimes(1);

    region.props.onMouseDown({button: 0, detail: 1, target: buttonTarget, preventDefault});
    expect(startDrag).toHaveBeenCalledTimes(1);
  });
});
