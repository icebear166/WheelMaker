export type NativeWebSourcePreference = 'auto' | 'embedded';
export type NativeWebSourceActual = 'embedded' | 'remote';
export type NativeDiagnosticLogLevel = 'debug' | 'info' | 'warning' | 'error';

export type NativeWebSourceState = {
  preference: NativeWebSourcePreference;
  actualSource: NativeWebSourceActual;
  displayTitle: string;
  displaySource: string;
  remoteUrl: string;
  remoteHost: string;
  remoteDebugEnabled?: boolean;
  remoteDebugPort?: number;
  remoteDebugUrl?: string;
};

export type NativeRemoteWebCandidate = {
  source: 'registry';
  registryAddress: string;
  remoteWebUrl: string;
};

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

export type NativeWebSourceBridge = {
  enabled?: boolean;
  getWebSourceState?: () => Promise<NativeWebSourceState> | NativeWebSourceState;
  setWebSourcePreference?: (
    preference: NativeWebSourcePreference,
  ) => Promise<NativeWebSourceState> | NativeWebSourceState;
  setRemoteWebCandidate?: (
    candidate: NativeRemoteWebCandidate,
  ) => Promise<NativeWebSourceState> | NativeWebSourceState;
  setRemoteDebugEnabled?: (
    enabled: boolean,
  ) => Promise<NativeWebSourceState> | NativeWebSourceState;
  drainWebDiagnostics?: () => Promise<NativeWebDiagnosticsPayload> | NativeWebDiagnosticsPayload;
  setDiagnosticLogLevel?: (
    logLevel: NativeDiagnosticLogLevel,
  ) => Promise<NativeDiagnosticLogLevelState> | NativeDiagnosticLogLevelState;
  clearPortRelaySiteData?: (
    relayUrl: string,
  ) => Promise<NativePortRelaySiteDataResult> | NativePortRelaySiteDataResult;
};

type NativeWindow = Window & {
  WheelMakerAndroid?: NativeWebSourceBridge;
  WheelMakerDesktop?: NativeWebSourceBridge;
  WheelMakerAndroidNative?: AndroidNativeMessageTarget;
};

function parseNativeState(value: string | undefined): NativeWebSourceState {
  return JSON.parse(value ?? '{}') as NativeWebSourceState;
}

function parseNativeWebDiagnostics(value: string | undefined): NativeWebDiagnosticsPayload {
  return JSON.parse(value ?? '{}') as NativeWebDiagnosticsPayload;
}

function parseNativeDiagnosticLogLevelState(value: string | undefined): NativeDiagnosticLogLevelState {
  return JSON.parse(value ?? '{}') as NativeDiagnosticLogLevelState;
}

function parseNativePortRelaySiteDataResult(value: string | undefined): NativePortRelaySiteDataResult {
  return JSON.parse(value ?? '{}') as NativePortRelaySiteDataResult;
}

function isLoopbackHost(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]';
}

function wrapAndroidNativeBridge(native: AndroidNativeRpcFacade): NativeWebSourceBridge {
  return {
    enabled: true,
    drainWebDiagnostics: async () => parseNativeWebDiagnostics(await native.drainWebDiagnostics()),
    setDiagnosticLogLevel: async logLevel =>
      parseNativeDiagnosticLogLevelState(await native.setDiagnosticLogLevel(logLevel)),
    clearPortRelaySiteData: async relayUrl =>
      parseNativePortRelaySiteDataResult(await native.clearPortRelaySiteData(relayUrl)),
  };
}

export function inferNativeRemoteWebCandidate(registryAddress: string): NativeRemoteWebCandidate | null {
  let parsed: URL;
  const trimmed = registryAddress.trim();
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'ws:' &&
    parsed.protocol !== 'wss:' &&
    parsed.protocol !== 'http:' &&
    parsed.protocol !== 'https:'
  ) {
    return null;
  }
  if (!parsed.host) {
    return null;
  }
  if (isLoopbackHost(parsed.hostname)) {
    return null;
  }
  const remoteProtocol = parsed.protocol === 'ws:' || parsed.protocol === 'http:' ? 'http:' : 'https:';
  return {
    source: 'registry',
    registryAddress: trimmed,
    remoteWebUrl: `${remoteProtocol}//${parsed.host}/`,
  };
}

export function getNativeWebSourceBridge(): NativeWebSourceBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const nativeWindow = window as NativeWindow;
  if (nativeWindow.WheelMakerAndroid) {
    return nativeWindow.WheelMakerAndroid;
  }
  const androidBridge = getAndroidNativeRpcFacade(nativeWindow);
  if (androidBridge) {
    return wrapAndroidNativeBridge(androidBridge);
  }
  return nativeWindow.WheelMakerDesktop ?? null;
}

export function isNativeWebViewHost(
  target: unknown = typeof window === 'undefined' ? undefined : window,
): boolean {
  const nativeWindow = target as Partial<NativeWindow> | undefined;
  return Boolean(
    nativeWindow?.WheelMakerAndroid ||
    typeof nativeWindow?.WheelMakerAndroidNative?.postMessage === 'function'
  );
}

export function isNativeShellHost(
  target: unknown = typeof window === 'undefined' ? undefined : window,
): boolean {
  const nativeWindow = target as Partial<NativeWindow> | undefined;
  return Boolean(
    nativeWindow?.WheelMakerAndroid ||
    typeof nativeWindow?.WheelMakerAndroidNative?.postMessage === 'function' ||
    nativeWindow?.WheelMakerDesktop,
  );
}

export function submitNativeRemoteWebCandidate(registryAddress: string): void {
  const bridge = getNativeWebSourceBridge();
  const submit = bridge?.setRemoteWebCandidate;
  if (!submit) {
    return;
  }
  const trimmed = registryAddress.trim();
  const candidate = inferNativeRemoteWebCandidate(trimmed);
  void Promise.resolve(submit(candidate ?? {
    source: 'registry',
    registryAddress: trimmed,
    remoteWebUrl: '',
  })).catch(() => undefined);
}
import {
  getAndroidNativeRpcFacade,
  type AndroidNativeMessageTarget,
  type AndroidNativeRpcFacade,
} from '../android/androidNativeMessageBridge';
