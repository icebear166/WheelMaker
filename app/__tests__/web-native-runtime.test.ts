import {
  getNativeRuntimeBridge,
  isNativeShellHost,
  isNativeWebViewHost,
} from '../web/src/platform/native/nativeRuntime';
import {createAndroidNativeMessageTestHost} from '../testUtils/androidNativeMessageTestHost';

describe('native runtime bridge', () => {
  afterEach(() => {
    delete (globalThis as {window?: unknown}).window;
  });

  test('detects Android WebViews and all native shell hosts', () => {
    expect(isNativeWebViewHost({WheelMakerAndroidNative: {postMessage: jest.fn()}})).toBe(true);
    expect(isNativeWebViewHost({WheelMakerAndroid: {enabled: true}})).toBe(true);
    expect(isNativeWebViewHost({WheelMakerDesktop: {enabled: true}})).toBe(false);
    expect(isNativeShellHost({WheelMakerAndroidNative: {postMessage: jest.fn()}})).toBe(true);
    expect(isNativeShellHost({WheelMakerAndroid: {enabled: true}})).toBe(true);
    expect(isNativeShellHost({WheelMakerDesktop: {enabled: true}})).toBe(true);
    expect(isNativeShellHost({})).toBe(false);
  });

  test('keeps diagnostics and relay cleanup without Web source controls', async () => {
    const diagnosticsPayload = {records: [{level: 'info' as const, event: 'android_web'}]};
    const {target, requests} = createAndroidNativeMessageTestHost({
      'diagnostics.drain': () => diagnosticsPayload,
      'diagnostics.setLogLevel': payload => ({logLevel: payload.logLevel}),
      'relay.clearSiteData': payload => ({ok: true, relayUrl: payload.relayUrl}),
    });
    (globalThis as {window?: unknown}).window = {WheelMakerAndroidNative: target};

    const bridge = getNativeRuntimeBridge();
    await expect(bridge?.drainWebDiagnostics?.()).resolves.toEqual(diagnosticsPayload);
    await expect(bridge?.setDiagnosticLogLevel?.('warning')).resolves.toEqual({logLevel: 'warning'});
    await expect(bridge?.clearPortRelaySiteData?.('https://relay.example.com/')).resolves.toEqual({
      ok: true,
      relayUrl: 'https://relay.example.com/',
    });
    expect(bridge).not.toHaveProperty('getWebSourceState');
    expect(bridge).not.toHaveProperty('setWebSourcePreference');
    expect(bridge).not.toHaveProperty('setRemoteWebCandidate');
    expect(bridge).not.toHaveProperty('setRemoteDebugEnabled');
    expect(requests.map(request => request.action)).toEqual([
      'diagnostics.drain',
      'diagnostics.setLogLevel',
      'relay.clearSiteData',
    ]);
  });

  test('prefers an explicit Android bridge and falls back to Desktop', () => {
    const android = {enabled: true, drainWebDiagnostics: jest.fn()};
    const desktop = {enabled: true, drainWebDiagnostics: jest.fn()};
    (globalThis as {window?: unknown}).window = {
      WheelMakerAndroid: android,
      WheelMakerDesktop: desktop,
    };
    expect(getNativeRuntimeBridge()).toBe(android);

    (globalThis as {window?: unknown}).window = {WheelMakerDesktop: desktop};
    expect(getNativeRuntimeBridge()).toBe(desktop);
  });
});
