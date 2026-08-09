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
  reserveUserAction(action: 'image.share' | 'html.share' | 'speech.start'): Promise<string>;
  deepSeekLogin(): Promise<string>;
  drainWebDiagnostics(): Promise<string>;
  setDiagnosticLogLevel(logLevel: string): Promise<string>;
  getSpeechCredentialState(): Promise<string>;
  configureSpeechCredential(accessToken: string, version: string): Promise<string>;
  clearSpeechCredential(): Promise<string>;
  startSpeech(payloadJson: string): Promise<string>;
  finishSpeech(streamId: string): Promise<string>;
  cancelSpeech(streamId: string, reason: string): Promise<string>;
  requestNotificationPermission(): Promise<string>;
  getNotificationPermissionState(): Promise<string>;
  showNotification(payloadJson: string): Promise<string>;
  getAndroidReleaseState(): Promise<string>;
  installAndroidRelease(payloadJson: string): Promise<string>;
  beginResponseImageShare(fileName: string, size: number, userActionToken: string): Promise<string>;
  appendResponseImageShare(transferId: string, index: number, data: string): Promise<string>;
  commitResponseImageShare(transferId: string): Promise<string>;
  cancelResponseImageShare(transferId: string): Promise<string>;
  beginMarkdownHtmlShare(fileName: string, size: number, userActionToken: string): Promise<string>;
  appendMarkdownHtmlShare(transferId: string, index: number, data: string): Promise<string>;
  commitMarkdownHtmlShare(transferId: string): Promise<string>;
  cancelMarkdownHtmlShare(transferId: string): Promise<string>;
  clearPortRelaySiteData(relayUrl: string): Promise<string>;
};

let fallbackRequestSequence = 0;
let cachedTarget: AndroidNativeMessageTarget | undefined;
let cachedClient: AndroidNativeMessageClient | null = null;
const MAX_ANDROID_NATIVE_MESSAGE_LENGTH = 512 * 1024;

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
  const previous = target.onmessage;
  target.onmessage = event => {
    try {
      previous?.(event);
    } catch {
      // A stale consumer must not block replies for the active bridge client.
    }
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
      const message = JSON.stringify({requestId, action, payload});
      if (message.length > MAX_ANDROID_NATIVE_MESSAGE_LENGTH) {
        reject(new Error('Request exceeds the Android native message limit.'));
        return;
      }
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('Android native request timed out.'));
      }, 30_000);
      pending.set(requestId, {resolve, reject, timeout});
      try {
        target.postMessage(message);
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

/** Tells the Android host the first meaningful frame has painted, so it can
   fade out the native splash. No-op outside the Android WebView host. */
export function notifyAndroidLaunchReady(): void {
  try {
    getAndroidNativeMessageClient()?.request('app.launchReady').catch(() => undefined);
  } catch {
    // Not an Android host.
  }
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

function requiredStringResult(rawJson: string, key: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson || '{}');
  } catch {
    throw new Error('Android native bridge returned invalid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Android native bridge returned an invalid result.');
  }
  const value = (parsed as Record<string, unknown>)[key];
  if (typeof value !== 'string' || !value) {
    const error = (parsed as Record<string, unknown>).error;
    const status = (parsed as Record<string, unknown>).status;
    throw new Error(
      typeof error === 'string' && error ? error :
        typeof status === 'string' && status ? status :
          `Android native bridge returned no ${key}.`,
    );
  }
  return value;
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
    reserveUserAction: async action => requiredStringResult(
      await request('userAction.reserve', {action}),
      'token',
    ),
    deepSeekLogin: () => request('deepseek.login'),
    drainWebDiagnostics: () => request('diagnostics.drain'),
    setDiagnosticLogLevel: logLevel => request('diagnostics.setLogLevel', {logLevel}),
    getSpeechCredentialState: () => request('speech.credentialState'),
    configureSpeechCredential: (accessToken, version) =>
      request('speech.configureCredential', {accessToken, version}),
    clearSpeechCredential: () => request('speech.clearCredential'),
    startSpeech: payloadJson => request('speech.start', objectPayload(payloadJson)),
    finishSpeech: streamId => request('speech.finish', {streamId}),
    cancelSpeech: (streamId, reason) => request('speech.cancel', {streamId, reason}),
    requestNotificationPermission: () => request('notification.requestPermission'),
    getNotificationPermissionState: () => request('notification.getPermissionState'),
    showNotification: payloadJson => request('notification.show', objectPayload(payloadJson)),
    getAndroidReleaseState: () => request('apk.getReleaseState'),
    installAndroidRelease: payloadJson => request('apk.install', objectPayload(payloadJson)),
    beginResponseImageShare: async (fileName, size, userActionToken) => requiredStringResult(
      await request('image.share.begin', {fileName, size, userActionToken}),
      'transferId',
    ),
    appendResponseImageShare: (transferId, index, data) =>
      request('image.share.chunk', {transferId, index, data}),
    commitResponseImageShare: transferId => request('image.share.commit', {transferId}),
    cancelResponseImageShare: transferId => request('image.share.cancel', {transferId}),
    beginMarkdownHtmlShare: async (fileName, size, userActionToken) => requiredStringResult(
      await request('html.share.begin', {fileName, size, userActionToken}),
      'transferId',
    ),
    appendMarkdownHtmlShare: (transferId, index, data) =>
      request('html.share.chunk', {transferId, index, data}),
    commitMarkdownHtmlShare: transferId => request('html.share.commit', {transferId}),
    cancelMarkdownHtmlShare: transferId => request('html.share.cancel', {transferId}),
    clearPortRelaySiteData: relayUrl => request('relay.clearSiteData', {relayUrl}),
  };
}

// WebViewCompat injects the message target at document start. Initialize eagerly so
// gestures that happen before a feature module makes its first request are retained.
if (typeof window !== 'undefined') {
  getAndroidNativeMessageClient(window as unknown as AndroidNativeMessageEnvironment);
}
