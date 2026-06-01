import {getDefaultRegistryAddress, toRegistryWsUrl} from '../web/src/runtime';

type TestWindow = {
  location: {
    hostname: string;
    host: string;
    protocol: string;
  };
};

describe('runtime Registry address resolution', () => {
  const originalWindow = (globalThis as {window?: unknown}).window;

  afterEach(() => {
    if (typeof originalWindow === 'undefined') {
      Reflect.deleteProperty(globalThis, 'window');
      return;
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  function setWindow(input: TestWindow) {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: input,
    });
  }

  test('uses registry port 9630 for localhost ws default', () => {
    setWindow({
      location: {
        hostname: '127.0.0.1',
        host: '127.0.0.1:8080',
        protocol: 'http:',
      },
    });

    expect(getDefaultRegistryAddress()).toBe('ws://127.0.0.1:9630/ws');
  });

  test('does not infer Registry address from Android appassets origin', () => {
    setWindow({
      location: {
        hostname: 'appassets.androidplatform.net',
        host: 'appassets.androidplatform.net',
        protocol: 'https:',
      },
    });

    expect(getDefaultRegistryAddress()).toBe('127.0.0.1:9630');
  });

  test('ignores legacy runtime config globals', () => {
    setWindow({
      __WHEELMAKER_RUNTIME_CONFIG__: {
        defaultRegistryAddress: 'ws://legacy.example/ws',
        defaultRegistryPort: 28800,
      },
      location: {
        hostname: 'workspace.example.com',
        host: 'workspace.example.com',
        protocol: 'https:',
      },
    } as unknown as TestWindow);

    expect(getDefaultRegistryAddress()).toBe('wss://workspace.example.com/ws');
  });

  test('still infers same-origin WebSocket for normal HTTPS host', () => {
    setWindow({
      location: {
        hostname: 'workspace.example.com',
        host: 'workspace.example.com:28800',
        protocol: 'https:',
      },
    });

    expect(getDefaultRegistryAddress()).toBe('wss://workspace.example.com:28800/ws');
  });

  test('converts host and port to ws URL', () => {
    expect(toRegistryWsUrl('workspace.example.com:28800')).toBe('ws://workspace.example.com:28800/ws');
  });
});
