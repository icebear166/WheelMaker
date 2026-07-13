export type AndroidNativeMessageTarget = {
  postMessage(message: string): void;
  onmessage?: ((event: {data: unknown}) => void) | null;
};

export type AndroidNativeMessageEnvironment = {
  WheelMakerAndroidNative?: AndroidNativeMessageTarget;
  addEventListener?: (...args: any[]) => void;
  performance?: {now(): number};
  crypto?: {randomUUID?(): string};
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

export type AndroidNativeMessageClient = {
  request(action: string, payload?: Record<string, unknown>): Promise<unknown>;
};

export type AndroidNativeRpcFacade = {
  drainWebDiagnostics(): Promise<string>;
  setDiagnosticLogLevel(logLevel: string): Promise<string>;
  startSpeech(payloadJson: string): Promise<string>;
  finishSpeech(streamId: string): Promise<string>;
  cancelSpeech(streamId: string, reason: string): Promise<string>;
  requestNotificationPermission(): Promise<string>;
  getNotificationPermissionState(): Promise<string>;
  showNotification(payloadJson: string): Promise<string>;
  getAndroidReleaseState(): Promise<string>;
  installAndroidRelease(payloadJson: string): Promise<string>;
  shareResponseImage(payloadJson: string): Promise<string>;
  clearPortRelaySiteData(relayUrl: string): Promise<string>;
};

let fallbackRequestSequence = 0;
let cachedTarget: AndroidNativeMessageTarget | undefined;
let cachedClient: AndroidNativeMessageClient | null = null;

function newRequestId(env: AndroidNativeMessageEnvironment): string {
  return env.crypto?.randomUUID?.() ??
    `wm-${Date.now().toString(36)}-${(++fallbackRequestSequence).toString(36)}`;
}

export function createAndroidNativeMessageClient(
  env: AndroidNativeMessageEnvironment,
): AndroidNativeMessageClient {
  const target = env.WheelMakerAndroidNative;
  if (!target || typeof target.postMessage !== 'function') {
    throw new Error('Android native message bridge is unavailable.');
  }
  const pending = new Map<string, PendingRequest>();
  let lastUserGestureAt: number | null = null;
  const rememberGesture = () => {
    lastUserGestureAt = Math.round(env.performance?.now() ?? 0);
  };
  for (const eventName of ['pointerdown', 'keydown', 'touchstart']) {
    env.addEventListener?.(eventName, rememberGesture, {capture: true, passive: true});
  }

  const previous = target.onmessage;
  target.onmessage = event => {
    previous?.(event);
    let response: {requestId?: string; ok?: boolean; result?: unknown; error?: string};
    try {
      response = JSON.parse(typeof event.data === 'string' ? event.data : '') as typeof response;
    } catch {
      return;
    }
    const request = response.requestId ? pending.get(response.requestId) : undefined;
    if (!request || !response.requestId) {
      return;
    }
    pending.delete(response.requestId);
    clearTimeout(request.timeout);
    if (response.ok) {
      request.resolve(response.result);
    } else {
      request.reject(new Error(response.error || 'Android native request failed.'));
    }
  };

  return {
    request: (action, payload = {}) => new Promise((resolve, reject) => {
      const requestId = newRequestId(env);
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('Android native request timed out.'));
      }, 30_000);
      pending.set(requestId, {resolve, reject, timeout});
      try {
        target.postMessage(JSON.stringify({
          requestId,
          action,
          payload,
          userGestureAt: lastUserGestureAt,
        }));
      } catch (error) {
        pending.delete(requestId);
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }),
  };
}

export function getAndroidNativeMessageClient(
  env: AndroidNativeMessageEnvironment = globalThis as AndroidNativeMessageEnvironment,
): AndroidNativeMessageClient | null {
  const target = env.WheelMakerAndroidNative;
  if (!target || typeof target.postMessage !== 'function') {
    return null;
  }
  if (target !== cachedTarget || !cachedClient) {
    cachedTarget = target;
    cachedClient = createAndroidNativeMessageClient(env);
  }
  return cachedClient;
}

export async function requestAndroidNativeJson(
  action: string,
  payload: Record<string, unknown> = {},
  env: AndroidNativeMessageEnvironment = globalThis as AndroidNativeMessageEnvironment,
): Promise<string> {
  const client = getAndroidNativeMessageClient(env);
  if (!client) {
    throw new Error('Android native message bridge is unavailable.');
  }
  const result = await client.request(action, payload);
  return typeof result === 'string' ? result : JSON.stringify(result ?? {});
}

function objectPayload(rawJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function getAndroidNativeRpcFacade(
  env: AndroidNativeMessageEnvironment = globalThis as AndroidNativeMessageEnvironment,
): AndroidNativeRpcFacade | null {
  if (!getAndroidNativeMessageClient(env)) {
    return null;
  }
  const request = (action: string, payload: Record<string, unknown> = {}) =>
    requestAndroidNativeJson(action, payload, env);
  return {
    drainWebDiagnostics: () => request('diagnostics.drain'),
    setDiagnosticLogLevel: logLevel => request('diagnostics.setLogLevel', {logLevel}),
    startSpeech: payloadJson => request('speech.start', objectPayload(payloadJson)),
    finishSpeech: streamId => request('speech.finish', {streamId}),
    cancelSpeech: (streamId, reason) => request('speech.cancel', {streamId, reason}),
    requestNotificationPermission: () => request('notification.requestPermission'),
    getNotificationPermissionState: () => request('notification.getPermissionState'),
    showNotification: payloadJson => request('notification.show', objectPayload(payloadJson)),
    getAndroidReleaseState: () => request('apk.getReleaseState'),
    installAndroidRelease: payloadJson => request('apk.install', objectPayload(payloadJson)),
    shareResponseImage: payloadJson => request('image.share', objectPayload(payloadJson)),
    clearPortRelaySiteData: relayUrl => request('relay.clearSiteData', {relayUrl}),
  };
}

// WebViewCompat injects the message target at document start. Initialize eagerly so
// gestures that happen before a feature module makes its first request are retained.
if (typeof window !== 'undefined') {
  getAndroidNativeMessageClient(window as unknown as AndroidNativeMessageEnvironment);
}
