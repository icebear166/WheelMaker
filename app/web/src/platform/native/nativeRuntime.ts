import {
  getAndroidNativeRpcFacade,
  type AndroidNativeMessageTarget,
  type AndroidNativeRpcFacade,
} from '../android/androidNativeMessageBridge';

export type NativeDiagnosticLogLevel = 'debug' | 'info' | 'warning' | 'error';

export type NativeWebDiagnosticRecord = {
  level?: 'info' | 'warn' | 'error';
  event?: string;
  details?: Record<string, unknown>;
};

export type NativeWebDiagnosticsPayload = {
  records?: NativeWebDiagnosticRecord[];
};

export type NativeDiagnosticLogLevelState = {
  logLevel?: NativeDiagnosticLogLevel;
};

export type NativePortRelaySiteDataResult = {
  ok?: boolean;
  relayUrl?: string;
  error?: string;
};

export type NativeRuntimeBridge = {
  enabled?: boolean;
  deepSeekLogin?: () => Promise<string>;
  qwenLogin?: () => Promise<string>;
  drainWebDiagnostics?: () => Promise<NativeWebDiagnosticsPayload> | NativeWebDiagnosticsPayload;
  setDiagnosticLogLevel?: (
    logLevel: NativeDiagnosticLogLevel,
  ) => Promise<NativeDiagnosticLogLevelState> | NativeDiagnosticLogLevelState;
  clearPortRelaySiteData?: (
    relayUrl: string,
  ) => Promise<NativePortRelaySiteDataResult> | NativePortRelaySiteDataResult;
};

type NativeWindow = Window & {
  WheelMakerAndroid?: NativeRuntimeBridge;
  WheelMakerDesktop?: NativeRuntimeBridge;
  WheelMakerAndroidNative?: AndroidNativeMessageTarget;
};

function parseWebDiagnostics(value: string | undefined): NativeWebDiagnosticsPayload {
  return JSON.parse(value ?? '{}') as NativeWebDiagnosticsPayload;
}

function parseDiagnosticLogLevelState(value: string | undefined): NativeDiagnosticLogLevelState {
  return JSON.parse(value ?? '{}') as NativeDiagnosticLogLevelState;
}

function parsePortRelaySiteDataResult(value: string | undefined): NativePortRelaySiteDataResult {
  return JSON.parse(value ?? '{}') as NativePortRelaySiteDataResult;
}

function wrapAndroidRuntime(native: AndroidNativeRpcFacade): NativeRuntimeBridge {
  return {
    enabled: true,
    deepSeekLogin: async () => {
      const raw = await native.deepSeekLogin();
      const parsed = JSON.parse(raw) as {token?: unknown};
      if (typeof parsed.token !== 'string' || parsed.token === '') {
        throw new Error('DeepSeek login returned no token');
      }
      return parsed.token;
    },
    qwenLogin: async () => {
      const raw = await native.qwenLogin();
      const parsed = JSON.parse(raw) as {accessToken?: unknown};
      if (typeof parsed.accessToken !== 'string' || parsed.accessToken === '') {
        throw new Error('Qwen login returned no OAuth credential');
      }
      return raw;
    },
    drainWebDiagnostics: async () => parseWebDiagnostics(await native.drainWebDiagnostics()),
    setDiagnosticLogLevel: async logLevel =>
      parseDiagnosticLogLevelState(await native.setDiagnosticLogLevel(logLevel)),
    clearPortRelaySiteData: async relayUrl =>
      parsePortRelaySiteDataResult(await native.clearPortRelaySiteData(relayUrl)),
  };
}

export function getNativeRuntimeBridge(): NativeRuntimeBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const nativeWindow = window as NativeWindow;
  if (nativeWindow.WheelMakerAndroid) {
    return nativeWindow.WheelMakerAndroid;
  }
  const androidBridge = getAndroidNativeRpcFacade(nativeWindow);
  if (androidBridge) {
    return wrapAndroidRuntime(androidBridge);
  }
  return nativeWindow.WheelMakerDesktop ?? null;
}

export function isNativeWebViewHost(
  target: unknown = typeof window === 'undefined' ? undefined : window,
): boolean {
  const nativeWindow = target as Partial<NativeWindow> | undefined;
  return Boolean(
    nativeWindow?.WheelMakerAndroid
    || typeof nativeWindow?.WheelMakerAndroidNative?.postMessage === 'function'
  );
}

export function isNativeShellHost(
  target: unknown = typeof window === 'undefined' ? undefined : window,
): boolean {
  const nativeWindow = target as Partial<NativeWindow> | undefined;
  return Boolean(
    nativeWindow?.WheelMakerAndroid
    || typeof nativeWindow?.WheelMakerAndroidNative?.postMessage === 'function'
    || nativeWindow?.WheelMakerDesktop
  );
}
