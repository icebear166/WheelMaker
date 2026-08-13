import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import fs from 'node:fs';
import path from 'node:path';
import {LocalDevModePanel} from '../web/src/shell/layouts/desktop/LocalDevModePanel';

describe('Windows Local Dev panel', () => {
  const originalWindow = (global as typeof globalThis & {window?: unknown}).window;

  afterEach(() => {
    (global as typeof globalThis & {window?: unknown}).window = originalWindow;
  });

  test('loads native state and exposes only fixed Local Dev actions', async () => {
    const run = jest.fn(async (operation: string) => ({sourcePath: 'D:\\Code\\WheelMaker', running: operation !== 'stop'}));
    (global as typeof globalThis & {window?: unknown}).window = {
      WheelMakerDesktop: {
        enabled: true,
        localDev: {
          getState: async () => ({sourcePath: 'D:\\Code\\WheelMaker', running: true}),
          saveSource: async (sourcePath: string) => ({sourcePath, running: true}),
          run,
        },
      },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<LocalDevModePanel />);
    });
    const root = renderer!.root;
    expect(root.findByProps({'data-local-dev-status': true}).children).toContain('Running');
    expect(root.findByProps({'aria-label': 'WheelMaker source directory'}).props.value).toBe('D:\\Code\\WheelMaker');
    const operations = root.findAllByType('button').map(button => button.props['data-local-dev-operation']).filter(Boolean);
    expect(operations).toEqual(['build', 'start', 'stop', 'restart', 'open-directory', 'exit']);
    expect(root.findByProps({'aria-label': 'Close Local Dev panel'}).findByType('svg').props['data-icon-name']).toBe('x');
    expect(root.findAll(node => typeof node.props['data-local-dev-operation'] === 'string')
      .map(button => button.findByType('svg').props['data-icon-name']))
      .toEqual(['package', 'play', 'square', 'power', 'folderOpen', 'logOut']);
    await ReactTestRenderer.act(async () => {
      root.findByProps({'data-local-dev-operation': 'restart'}).props.onClick();
    });
    expect(run).toHaveBeenCalledWith('restart');
  });

  test('renders nothing when the native Local Dev bridge is absent', async () => {
    (global as typeof globalThis & {window?: unknown}).window = {};
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<LocalDevModePanel />);
    });
    expect(renderer!.toJSON()).toBeNull();
  });

  test('keeps the local WebSocket and HMR transport on loopback HTTP', () => {
    const config = fs.readFileSync(path.join(__dirname, '../web/webpack.config.js'), 'utf8');
    expect(config).toContain('LOCAL_WEB_SECURITY_POLICY');
    expect(config).toContain("connect-src 'self' ws: wss:");
    expect(config).toContain("target: 'http://127.0.0.1:9630'");
    expect(config).toContain('ws: true');
  });
});
