// @ts-nocheck
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {WheelMakerAppMenu} from './WheelMakerAppMenu';

const originalWindow = (global as typeof globalThis & {window?: unknown}).window;

afterEach(() => {
  (global as typeof globalThis & {window?: unknown}).window = originalWindow;
});

function actionNames(root: ReactTestRenderer.ReactTestInstance): string[] {
  return root
    .findAll(node => typeof node.props['data-app-menu-action'] === 'string')
    .map(node => node.props['data-app-menu-action']);
}

const baseProps = {
  themeMode: 'dark' as const,
  setThemeMode: jest.fn(),
  onOpenSettings: jest.fn(),
  onOpenPortRelay: jest.fn(),
  onOpenShares: jest.fn(),
  onOpenReleasePublishing: jest.fn(),
};

test('browser menu exposes Settings, the current Theme, Port Relay, Public shares, and standalone Release Publishing', async () => {
  (global as typeof globalThis & {window?: unknown}).window = {};
  const setThemeMode = jest.fn();
  const onOpenPortRelay = jest.fn();
  const onOpenShares = jest.fn();
  const onOpenReleasePublishing = jest.fn();
  let renderer: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <WheelMakerAppMenu
        {...baseProps}
        setThemeMode={setThemeMode}
        onOpenPortRelay={onOpenPortRelay}
        onOpenShares={onOpenShares}
        onOpenReleasePublishing={onOpenReleasePublishing}
      />,
    );
  });
  await ReactTestRenderer.act(async () => {
    renderer!.root.findByProps({'aria-label': 'Open WheelMaker menu'}).props.onClick();
  });

  expect(actionNames(renderer!.root)).toEqual(['settings', 'theme', 'port-relay', 'shares', 'release-publish']);
  let theme = renderer!.root.findByProps({'data-app-menu-action': 'theme'});
  expect(theme.props['data-app-menu-meta']).toBe('Dark');
  expect(theme.findByProps({'data-icon-name': 'moon'})).toBeDefined();
  await ReactTestRenderer.act(async () => {
    theme.props.onClick();
  });
  expect(setThemeMode).toHaveBeenCalledWith('light');

  await ReactTestRenderer.act(async () => {
    renderer!.update(
      <WheelMakerAppMenu
        {...baseProps}
        themeMode="light"
        setThemeMode={setThemeMode}
        onOpenPortRelay={onOpenPortRelay}
        onOpenShares={onOpenShares}
        onOpenReleasePublishing={onOpenReleasePublishing}
      />,
    );
  });
  theme = renderer!.root.findByProps({'data-app-menu-action': 'theme'});
  expect(theme.props['data-app-menu-meta']).toBe('Light');
  expect(theme.findByProps({'data-icon-name': 'sun'})).toBeDefined();
  await ReactTestRenderer.act(async () => {
    theme.props.onClick();
  });
  expect(setThemeMode).toHaveBeenLastCalledWith('dark');

  await ReactTestRenderer.act(async () => {
    renderer!.root.findByProps({'aria-label': 'Open WheelMaker menu'}).props.onClick();
    renderer!.root.findByProps({'data-app-menu-action': 'port-relay'}).props.onClick();
  });
  expect(onOpenPortRelay).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => {
    renderer!.root.findByProps({'aria-label': 'Open WheelMaker menu'}).props.onClick();
    renderer!.root.findByProps({'data-app-menu-action': 'shares'}).props.onClick();
  });
  expect(onOpenShares).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => {
    renderer!.root.findByProps({'aria-label': 'Open WheelMaker menu'}).props.onClick();
    renderer!.root.findByProps({'data-app-menu-action': 'release-publish'}).props.onClick();
  });
  expect(onOpenReleasePublishing).toHaveBeenCalledTimes(1);
});

test('native update checks on every open and starts only once', async () => {
  (global as typeof globalThis & {window?: unknown}).window = {};
  const check = jest.fn(async () => ({
    status: 'available' as const,
    currentVersion: 'v1.8',
    latestVersion: 'v1.9',
  }));
  let resolveStart: (() => void) | undefined;
  const start = jest.fn(() => new Promise<void>(resolve => {
    resolveStart = resolve;
  }));
  let updateListener: ((state: {
    status: 'updating';
    meta: string;
  }) => void) | undefined;
  const unsubscribe = jest.fn();
  const subscribe = jest.fn(listener => {
    updateListener = listener;
    return unsubscribe;
  });
  let renderer: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <WheelMakerAppMenu {...baseProps} updateController={{check, start, subscribe}} />,
    );
  });
  await ReactTestRenderer.act(async () => {
    renderer!.root.findByProps({'aria-label': 'Open WheelMaker menu'}).props.onClick();
  });

  expect(actionNames(renderer!.root)).toEqual([
    'settings',
    'theme',
    'port-relay',
    'shares',
    'update',
    'release-publish',
  ]);
  expect(check).toHaveBeenCalledTimes(1);
  expect(renderer!.root.findByProps({'data-app-menu-action': 'update'}).props['data-app-menu-meta'])
    .toBe('v1.8 → v1.9');
  expect(renderer!.root.findByProps({'data-client-update-dot': 'app-menu'})).toBeDefined();
  expect(renderer!.root.findByProps({'data-client-update-dot': 'menu'})).toBeDefined();

  await ReactTestRenderer.act(async () => {
    const update = renderer!.root.findByProps({'data-app-menu-action': 'update'});
    void update.props.onClick();
    void update.props.onClick();
  });
  expect(start).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(async () => {
    updateListener?.({status: 'updating', meta: 'Downloading…'});
  });
  expect(renderer!.root.findByProps({'data-app-menu-action': 'update'}).props['data-app-menu-meta'])
    .toBe('Downloading…');
  await ReactTestRenderer.act(async () => {
    resolveStart?.();
  });

  await ReactTestRenderer.act(async () => {
    renderer!.root.findByProps({'aria-label': 'Open WheelMaker menu'}).props.onClick();
  });
  await ReactTestRenderer.act(async () => {
    renderer!.root.findByProps({'aria-label': 'Open WheelMaker menu'}).props.onClick();
  });
  expect(check).toHaveBeenCalledTimes(2);

  await ReactTestRenderer.act(async () => {
    renderer!.unmount();
  });
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('Desktop keeps Dev Mode below Release Publishing', async () => {
  (global as typeof globalThis & {window?: unknown}).window = {
    WheelMakerDesktop: {
      enabled: true,
      requestLocalDevMode: jest.fn(),
    },
  };
  const updateController = {
    check: jest.fn(async () => ({status: 'failed' as const})),
    start: jest.fn(async () => undefined),
  };
  let renderer: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <WheelMakerAppMenu {...baseProps} updateController={updateController} />,
    );
  });
  await ReactTestRenderer.act(async () => {
    renderer!.root.findByProps({'aria-label': 'Open WheelMaker menu'}).props.onClick();
  });

  expect(actionNames(renderer!.root)).toEqual([
    'settings',
    'theme',
    'port-relay',
    'shares',
    'update',
    'release-publish',
    'local-dev',
  ]);
});

test('failed update checks retry in place and disable once current', async () => {
  (global as typeof globalThis & {window?: unknown}).window = {};
  const check = jest.fn()
    .mockResolvedValueOnce({status: 'failed' as const})
    .mockResolvedValueOnce({status: 'current' as const, currentVersion: 'v1.9'});
  let renderer: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <WheelMakerAppMenu
        {...baseProps}
        updateController={{check, start: jest.fn(async () => undefined)}}
      />,
    );
  });
  await ReactTestRenderer.act(async () => {
    renderer!.root.findByProps({'aria-label': 'Open WheelMaker menu'}).props.onClick();
  });
  let update = renderer!.root.findByProps({'data-app-menu-action': 'update'});
  expect(update.props['data-app-menu-meta']).toBe('Retry');
  expect(update.props.disabled).toBe(false);

  await ReactTestRenderer.act(async () => {
    update.props.onClick();
  });
  update = renderer!.root.findByProps({'data-app-menu-action': 'update'});
  expect(check).toHaveBeenCalledTimes(2);
  expect(update.props['data-app-menu-meta']).toBe('v1.9 · Current');
  expect(update.props.disabled).toBe(true);
});
