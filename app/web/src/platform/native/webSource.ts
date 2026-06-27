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

type AndroidNativeBridge = {
  getWebSourceState?: () => string;
  setWebSourcePreference?: (preference: NativeWebSourcePreference) => string;
  setRemoteWebCandidate?: (candidateJson: string) => string;
  drainWebDiagnostics?: () => string;
  setDiagnosticLogLevel?: (logLevel: NativeDiagnosticLogLevel) => string;
  clearPortRelaySiteData?: (relayUrl: string) => string;
};

type NativeWindow = Window & {
  WheelMakerAndroid?: NativeWebSourceBridge;
  WheelMakerDesktop?: NativeWebSourceBridge;
  WheelMakerAndroidNative?: AndroidNativeBridge;
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

function wrapAndroidNativeBridge(native: AndroidNativeBridge): NativeWebSourceBridge {
  return {
    enabled: true,
    getWebSourceState: native.getWebSourceState
      ? () => Promise.resolve(parseNativeState(native.getWebSourceState?.()))
      : undefined,
    setWebSourcePreference: native.setWebSourcePreference
      ? preference => Promise.resolve(parseNativeState(native.setWebSourcePreference?.(preference)))
      : undefined,
    setRemoteWebCandidate: native.setRemoteWebCandidate
      ? candidate => Promise.resolve(parseNativeState(native.setRemoteWebCandidate?.(JSON.stringify(candidate))))
      : undefined,
    drainWebDiagnostics: native.drainWebDiagnostics
      ? () => Promise.resolve(parseNativeWebDiagnostics(native.drainWebDiagnostics?.()))
      : undefined,
    setDiagnosticLogLevel: native.setDiagnosticLogLevel
      ? logLevel => Promise.resolve(parseNativeDiagnosticLogLevelState(native.setDiagnosticLogLevel?.(logLevel)))
      : undefined,
    clearPortRelaySiteData: native.clearPortRelaySiteData
      ? relayUrl => Promise.resolve(parseNativePortRelaySiteDataResult(native.clearPortRelaySiteData?.(relayUrl)))
      : undefined,
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
  if (nativeWindow.WheelMakerAndroidNative) {
    return wrapAndroidNativeBridge(nativeWindow.WheelMakerAndroidNative);
  }
  return nativeWindow.WheelMakerDesktop ?? null;
}

export function isNativeWebViewHost(
  target: unknown = typeof window === 'undefined' ? undefined : window,
): boolean {
  const nativeWindow = target as Partial<NativeWindow> | undefined;
  return Boolean(nativeWindow?.WheelMakerAndroid || nativeWindow?.WheelMakerAndroidNative);
}

export function isNativeShellHost(
  target: unknown = typeof window === 'undefined' ? undefined : window,
): boolean {
  const nativeWindow = target as Partial<NativeWindow> | undefined;
  return Boolean(
    nativeWindow?.WheelMakerAndroid ||
    nativeWindow?.WheelMakerAndroidNative ||
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
