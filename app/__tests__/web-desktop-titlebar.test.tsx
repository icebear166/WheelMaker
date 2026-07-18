import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  DesktopDragRegion,
  DesktopWindowControls,
} from '../web/src/shell/layouts/desktop/DesktopTitleBar';

describe('desktop window controls', () => {
  const originalWindow = (global as typeof globalThis & { window?: unknown }).window;
  const originalFetch = global.fetch;

  afterEach(() => {
    (global as typeof globalThis & { window?: unknown }).window = originalWindow;
    global.fetch = originalFetch;
  });

  const stableResponse = (sha256: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
      schema: 2,
      version: 'v1.24',
      publishedAt: '2026-07-18T09:00:00Z',
      sourceSha: 'a'.repeat(40),
      desktopExe: {
        version: 'v1.22',
        path: '/releases/v1.22/WheelMakerDesktop.exe',
        sha256,
      },
    }),
  }) as Response;

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
    global.fetch = jest.fn() as unknown as typeof fetch;
    (global as typeof globalThis & { window?: unknown }).window = {
      WheelMakerDesktop: {
        enabled: true,
        localDev: {
          getState: jest.fn(),
          saveSource: jest.fn(),
          run: jest.fn(),
        },
        getDesktopUpdateInfo: jest.fn(),
        requestDesktopUpdate: jest.fn(),
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
    expect(root.findAllByProps({'data-desktop-extension-action': 'desktop-update'})).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('checks once and shows the Desktop update directly after Dev Mode', async () => {
    let resolveStable: ((response: Response) => void) | undefined;
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => {
      resolveStable = resolve;
    })) as unknown as typeof fetch;
    const requestDesktopUpdate = jest.fn(async () => undefined);
    (global as typeof globalThis & { window?: unknown }).window = {
      WheelMakerDesktop: {
        enabled: true,
        requestLocalDevMode: jest.fn(),
        getDesktopUpdateInfo: jest.fn(async () => ({
          sha256: 'a'.repeat(64),
          updaterReady: true,
        })),
        requestDesktopUpdate,
      },
    };

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<DesktopWindowControls />);
    });
    const root = renderer!.root;
    await ReactTestRenderer.act(async () => {
      root.findByProps({'aria-label': 'Windows extensions'}).props.onClick();
    });
    expect(root.findByProps({'data-desktop-update-label': true}).children).toContain(
      'Checking Desktop update…',
    );

    await ReactTestRenderer.act(async () => {
      resolveStable!(stableResponse('b'.repeat(64)));
    });

    const menuItems = root.findAll(node =>
      typeof node.props['data-desktop-extension-action'] === 'string',
    );
    expect(menuItems.map(item => item.props['data-desktop-extension-action'])).toEqual([
      'local-dev',
      'desktop-update',
    ]);
    expect(root.findByProps({'data-desktop-update-label': true}).children).toContain(
      'Update Desktop to v1.22',
    );
    expect(root.findByProps({'data-desktop-update-dot': 'titlebar'})).toBeDefined();
    expect(root.findByProps({'data-desktop-update-dot': 'menu'})).toBeDefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      root.findByProps({'data-desktop-extension-action': 'desktop-update'}).props.onClick();
    });
    expect(requestDesktopUpdate).toHaveBeenCalledTimes(1);
  });

  test('shows the current Desktop without an update dot when SHA matches', async () => {
    global.fetch = jest.fn(async () => stableResponse('a'.repeat(64))) as unknown as typeof fetch;
    (global as typeof globalThis & { window?: unknown }).window = {
      WheelMakerDesktop: {
        enabled: true,
        getDesktopUpdateInfo: jest.fn(async () => ({
          sha256: 'a'.repeat(64),
          updaterReady: true,
        })),
        requestDesktopUpdate: jest.fn(),
      },
    };

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<DesktopWindowControls />);
    });
    const root = renderer!.root;
    await ReactTestRenderer.act(async () => {
      root.findByProps({'aria-label': 'Windows extensions'}).props.onClick();
    });
    const updateButton = root.findByProps({'data-desktop-extension-action': 'desktop-update'});
    expect(root.findByProps({'data-desktop-update-label': true}).children).toContain(
      'Desktop is up to date',
    );
    expect(updateButton.props.disabled).toBe(true);
    expect(root.findAll(node => node.props['data-desktop-update-dot'] !== undefined)).toHaveLength(0);
  });

  test('retries a failed Desktop check from the menu', async () => {
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(stableResponse('a'.repeat(64))) as unknown as typeof fetch;
    (global as typeof globalThis & { window?: unknown }).window = {
      WheelMakerDesktop: {
        enabled: true,
        getDesktopUpdateInfo: jest.fn(async () => ({
          sha256: 'a'.repeat(64),
          updaterReady: true,
        })),
        requestDesktopUpdate: jest.fn(),
      },
    };

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<DesktopWindowControls />);
    });
    const root = renderer!.root;
    await ReactTestRenderer.act(async () => {
      root.findByProps({'aria-label': 'Windows extensions'}).props.onClick();
    });
    expect(root.findByProps({'data-desktop-update-label': true}).children).toContain(
      'Check failed · Retry',
    );
    await ReactTestRenderer.act(async () => {
      root.findByProps({'data-desktop-extension-action': 'desktop-update'}).props.onClick();
    });
    expect(root.findByProps({'data-desktop-update-label': true}).children).toContain(
      'Desktop is up to date',
    );
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('keeps the Desktop open and returns to retry when updater launch fails', async () => {
    global.fetch = jest.fn(async () => stableResponse('b'.repeat(64))) as unknown as typeof fetch;
    (global as typeof globalThis & { window?: unknown }).window = {
      WheelMakerDesktop: {
        enabled: true,
        getDesktopUpdateInfo: jest.fn(async () => ({
          sha256: 'a'.repeat(64),
          updaterReady: true,
        })),
        requestDesktopUpdate: jest.fn(async () => {
          throw new Error('start failed');
        }),
      },
    };

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<DesktopWindowControls />);
    });
    const root = renderer!.root;
    await ReactTestRenderer.act(async () => {
      root.findByProps({'aria-label': 'Windows extensions'}).props.onClick();
    });
    await ReactTestRenderer.act(async () => {
      root.findByProps({'data-desktop-extension-action': 'desktop-update'}).props.onClick();
    });
    expect(root.findByProps({'data-desktop-window-controls': true})).toBeDefined();
    expect(root.findByProps({'data-desktop-update-label': true}).children).toContain(
      'Check failed · Retry',
    );
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
