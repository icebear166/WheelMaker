import {
  getNativeWebSourceBridge,
  inferNativeRemoteWebCandidate,
  isNativeShellHost,
  isNativeWebViewHost,
  submitNativeRemoteWebCandidate,
} from '../web/src/shell/native/webSource';

describe('native Web source helpers', () => {
  afterEach(() => {
    delete (globalThis as {window?: unknown}).window;
  });

  test('infers remote Web URL from secure Registry address', () => {
    expect(inferNativeRemoteWebCandidate('wss://workspace.example.com/ws')).toEqual({
      source: 'registry',
      registryAddress: 'wss://workspace.example.com/ws',
      remoteWebUrl: 'https://workspace.example.com/',
    });
  });

  test('infers plain remote Web URL from plain Registry address', () => {
    expect(inferNativeRemoteWebCandidate('ws://47.86.63.26:28800/ws')).toEqual({
      source: 'registry',
      registryAddress: 'ws://47.86.63.26:28800/ws',
      remoteWebUrl: 'http://47.86.63.26:28800/',
    });
  });

  test('rejects loopback Registry candidates', () => {
    expect(inferNativeRemoteWebCandidate('ws://127.0.0.1:9630/ws')).toBeNull();
    expect(inferNativeRemoteWebCandidate('ws://localhost:9630/ws')).toBeNull();
    expect(inferNativeRemoteWebCandidate('ws://[::1]:9630/ws')).toBeNull();
  });

  test('prefers Android bridge when present', () => {
    const bridge = {
      enabled: true,
      setRemoteWebCandidate: jest.fn(),
    };
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroid: bridge,
      WheelMakerDesktop: {
        enabled: true,
        setRemoteWebCandidate: jest.fn(),
      },
    };

    expect(getNativeWebSourceBridge()).toBe(bridge);
  });

  test('detects Android native WebView hosts only', () => {
    expect(isNativeWebViewHost({WheelMakerAndroidNative: {}})).toBe(true);
    expect(isNativeWebViewHost({WheelMakerAndroid: {enabled: true}})).toBe(true);
    expect(isNativeWebViewHost({WheelMakerDesktop: {enabled: true}})).toBe(false);
    expect(isNativeWebViewHost({})).toBe(false);
  });

  test('detects all native shell hosts for browser-only features', () => {
    expect(isNativeShellHost({WheelMakerAndroidNative: {}})).toBe(true);
    expect(isNativeShellHost({WheelMakerAndroid: {enabled: true}})).toBe(true);
    expect(isNativeShellHost({WheelMakerDesktop: {enabled: true}})).toBe(true);
    expect(isNativeShellHost({})).toBe(false);
  });

  test('wraps Android native bridge when JavaScript facade is absent', async () => {
    const native = {
      getWebSourceState: jest.fn(() => JSON.stringify({
        preference: 'auto',
        actualSource: 'embedded',
        displayTitle: 'WheelMaker - Embedded',
        displaySource: 'Embedded',
        remoteUrl: '',
        remoteHost: '',
      })),
      setWebSourcePreference: jest.fn((preference: string) => JSON.stringify({
        preference,
        actualSource: 'embedded',
        displayTitle: 'WheelMaker - Embedded',
        displaySource: 'Embedded',
        remoteUrl: '',
        remoteHost: '',
      })),
      setRemoteWebCandidate: jest.fn(() => JSON.stringify({
        preference: 'auto',
        actualSource: 'remote',
        displayTitle: 'WheelMaker - workspace.example.com',
        displaySource: 'workspace.example.com',
        remoteUrl: 'https://workspace.example.com/',
        remoteHost: 'workspace.example.com',
      })),
    };
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroidNative: native,
    };

    const bridge = getNativeWebSourceBridge();
    expect(await bridge?.getWebSourceState?.()).toMatchObject({actualSource: 'embedded'});
    await bridge?.setWebSourcePreference?.('embedded');
    await bridge?.setRemoteWebCandidate?.({
      source: 'registry',
      registryAddress: 'wss://workspace.example.com/ws',
      remoteWebUrl: 'https://workspace.example.com/',
    });

    expect(native.setWebSourcePreference).toHaveBeenCalledWith('embedded');
    expect(native.setRemoteWebCandidate).toHaveBeenCalledWith(JSON.stringify({
      source: 'registry',
      registryAddress: 'wss://workspace.example.com/ws',
      remoteWebUrl: 'https://workspace.example.com/',
    }));
  });

  test('wraps Android native Web diagnostics drain payload', async () => {
    const payload = {
      records: [
        {
          level: 'info',
          event: 'android_web',
          details: {
            nativeEvent: 'remote_asset_success',
            asset: 'index.html',
          },
        },
      ],
    };
    const native = {
      drainWebDiagnostics: jest.fn(() => JSON.stringify(payload)),
    };
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroidNative: native,
    };

    const bridge = getNativeWebSourceBridge();

    await expect(bridge?.drainWebDiagnostics?.()).resolves.toEqual(payload);
    expect(native.drainWebDiagnostics).toHaveBeenCalledTimes(1);
  });

  test('wraps Android native diagnostic log level setting', async () => {
    const native = {
      setDiagnosticLogLevel: jest.fn((logLevel: string) => JSON.stringify({logLevel})),
    };
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroidNative: native,
    };

    const bridge = getNativeWebSourceBridge();

    await expect(bridge?.setDiagnosticLogLevel?.('warning')).resolves.toEqual({logLevel: 'warning'});
    expect(native.setDiagnosticLogLevel).toHaveBeenCalledWith('warning');
  });

  test('falls back to Desktop bridge when Android bridge is absent', () => {
    const bridge = {
      enabled: true,
      setRemoteWebCandidate: jest.fn(),
    };
    (globalThis as {window?: unknown}).window = {
      WheelMakerDesktop: bridge,
    };

    expect(getNativeWebSourceBridge()).toBe(bridge);
  });

  test('submits empty candidate when Registry address is not usable for remote Web', () => {
    const setRemoteWebCandidate = jest.fn();
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroid: {
        enabled: true,
        setRemoteWebCandidate,
      },
    };

    submitNativeRemoteWebCandidate('ws://127.0.0.1:9630/ws');

    expect(setRemoteWebCandidate).toHaveBeenCalledWith({
      source: 'registry',
      registryAddress: 'ws://127.0.0.1:9630/ws',
      remoteWebUrl: '',
    });
  });
});
