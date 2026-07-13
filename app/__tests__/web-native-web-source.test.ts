import {
  getNativeWebSourceBridge,
  inferNativeRemoteWebCandidate,
  isNativeShellHost,
  isNativeWebViewHost,
  submitNativeRemoteWebCandidate,
} from '../web/src/platform/native/webSource';
import {createAndroidNativeMessageTestHost} from '../testUtils/androidNativeMessageTestHost';

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
    expect(isNativeWebViewHost({WheelMakerAndroidNative: {postMessage: jest.fn()}})).toBe(true);
    expect(isNativeWebViewHost({WheelMakerAndroid: {enabled: true}})).toBe(true);
    expect(isNativeWebViewHost({WheelMakerDesktop: {enabled: true}})).toBe(false);
    expect(isNativeWebViewHost({})).toBe(false);
  });

  test('detects all native shell hosts for browser-only features', () => {
    expect(isNativeShellHost({WheelMakerAndroidNative: {postMessage: jest.fn()}})).toBe(true);
    expect(isNativeShellHost({WheelMakerAndroid: {enabled: true}})).toBe(true);
    expect(isNativeShellHost({WheelMakerDesktop: {enabled: true}})).toBe(true);
    expect(isNativeShellHost({})).toBe(false);
  });

  test('does not expose removed Android Web source controls', () => {
    const {target} = createAndroidNativeMessageTestHost({});
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroidNative: target,
    };

    const bridge = getNativeWebSourceBridge();
    expect(bridge?.getWebSourceState).toBeUndefined();
    expect(bridge?.setWebSourcePreference).toBeUndefined();
    expect(bridge?.setRemoteWebCandidate).toBeUndefined();
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
    const {target, requests} = createAndroidNativeMessageTestHost({
      'diagnostics.drain': () => payload,
    });
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroidNative: target,
    };

    const bridge = getNativeWebSourceBridge();

    await expect(bridge?.drainWebDiagnostics?.()).resolves.toEqual(payload);
    expect(requests.map(request => request.action)).toEqual(['diagnostics.drain']);
  });

  test('wraps Android native diagnostic log level setting', async () => {
    const {target, requests} = createAndroidNativeMessageTestHost({
      'diagnostics.setLogLevel': payload => ({logLevel: payload.logLevel}),
    });
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroidNative: target,
    };

    const bridge = getNativeWebSourceBridge();

    await expect(bridge?.setDiagnosticLogLevel?.('warning')).resolves.toEqual({logLevel: 'warning'});
    expect(requests[0]).toMatchObject({
      action: 'diagnostics.setLogLevel',
      payload: {logLevel: 'warning'},
    });
  });

  test('wraps Android native port relay site-data clearing', async () => {
    const {target, requests} = createAndroidNativeMessageTestHost({
      'relay.clearSiteData': payload => ({ok: true, relayUrl: payload.relayUrl}),
    });
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroidNative: target,
    };

    const bridge = getNativeWebSourceBridge();

    await expect(bridge?.clearPortRelaySiteData?.('https://relay.example.com:28801/')).resolves.toEqual({
      ok: true,
      relayUrl: 'https://relay.example.com:28801/',
    });
    expect(requests[0]).toMatchObject({
      action: 'relay.clearSiteData',
      payload: {relayUrl: 'https://relay.example.com:28801/'},
    });
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
