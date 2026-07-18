import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  DesktopDragRegion,
  DesktopWindowControls,
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

  test('renders frameless window actions without a Web source chooser', async () => {
    const minimize = jest.fn();
    const toggleMaximize = jest.fn();
    const close = jest.fn();
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
      renderer = ReactTestRenderer.create(<DesktopWindowControls />);
    });

    const root = renderer!.root;
    expect(root.findByProps({'data-desktop-window-controls': true})).toBeDefined();
    expect(root.findAllByProps({'data-desktop-titlebar': true})).toHaveLength(0);
    expect(root.findAllByProps({className: 'desktop-window-source-button'})).toHaveLength(0);
    expect(root.findAllByProps({className: 'desktop-titlebar-title-group'})).toHaveLength(0);

    const buttons = root.findAllByType('button');
    expect(buttons.map(button => button.props['aria-label']).filter(Boolean)).toEqual([
      'Minimize',
      'Maximize or restore',
      'Close',
    ]);

    root.findByProps({'aria-label': 'Minimize'}).props.onClick();
    root.findByProps({'aria-label': 'Maximize or restore'}).props.onClick();
    root.findByProps({'aria-label': 'Close'}).props.onClick();

    expect(minimize).toHaveBeenCalled();
    expect(toggleMaximize).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  test('opens a separate Local Dev configuration dialog from the extensions menu', async () => {
	const requestLocalDevMode = jest.fn();
	(global as typeof globalThis & { window?: unknown }).window = {
		WheelMakerDesktop: {enabled: true, requestLocalDevMode},
	};

	let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
	await ReactTestRenderer.act(async () => {
		renderer = ReactTestRenderer.create(<DesktopWindowControls />);
	});
	const root = renderer!.root;
	const labels = root.findAllByType('button').map(button => button.props['aria-label']).filter(Boolean);
	expect(labels).toEqual(['Windows extensions', 'Minimize', 'Maximize or restore', 'Close']);
	await ReactTestRenderer.act(async () => {
		root.findByProps({'aria-label': 'Windows extensions'}).props.onClick();
	});
	const menuItem = root.findByProps({role: 'menuitemcheckbox'});
	expect(menuItem.props['aria-checked']).toBe(false);
	expect(menuItem.findAllByType('span').some(span => span.children.includes('Dev Mode'))).toBe(true);
	expect(root.findAllByProps({className: 'desktop-windows-extension-source'})).toHaveLength(0);
	await ReactTestRenderer.act(async () => {
		menuItem.props.onClick();
	});
	expect(requestLocalDevMode).not.toHaveBeenCalled();
	const dialog = root.findByProps({'aria-label': 'Configure Local Dev'});
	const sourceInput = dialog.findByProps({'aria-label': 'WheelMaker source directory'});
	await ReactTestRenderer.act(async () => {
		sourceInput.props.onChange({target: {value: 'E:\\_Code\\WheelMaker'}});
	});
	await ReactTestRenderer.act(async () => {
		root.findByProps({'data-local-dev-enter': true}).props.onClick();
	});
	expect(requestLocalDevMode).toHaveBeenCalledWith('E:\\_Code\\WheelMaker');
  });

  test('marks Dev Mode as checked when the local native bridge is active', async () => {
    (global as typeof globalThis & { window?: unknown }).window = {
      WheelMakerDesktop: {
        enabled: true,
        localDev: {
          getState: jest.fn(),
          saveSource: jest.fn(),
          run: jest.fn(),
        },
      },
      dispatchEvent: jest.fn(),
    };

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<DesktopWindowControls />);
    });
    const root = renderer!.root;
    await ReactTestRenderer.act(async () => {
      root.findByProps({'aria-label': 'Windows extensions'}).props.onClick();
    });
    const menuItem = root.findByProps({role: 'menuitemcheckbox'});
    expect(menuItem.props['aria-checked']).toBe(true);
    expect(menuItem.findByProps({'data-local-dev-check': true})).toBeDefined();
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
