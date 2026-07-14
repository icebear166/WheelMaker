import type {RegistrySpeechCancelPayload} from '../../registry/registryTypes';
import type {ServerSettings, SpeechModelId} from '../../settings/serverSettings';
import {
  getAndroidNativeRpcFacade,
  type AndroidNativeMessageTarget,
} from './androidNativeMessageBridge';

export type AndroidNativeSpeechStatus =
  | 'permission'
  | 'connecting'
  | 'recording'
  | 'finishing'
  | 'recognizing'
  | 'closed';

export type AndroidNativeSpeechEvent =
  | {type: 'status'; streamId: string; status: AndroidNativeSpeechStatus}
  | {type: 'level'; streamId: string; level: number}
  | {type: 'transcript'; streamId: string; text: string; final: boolean}
  | {type: 'error'; streamId?: string; code: string; message: string; retryable: boolean}
  | {type: 'closed'; streamId: string; reason: string};

export type AndroidNativeSpeechStartPayload = {
  provider: 'volcengine';
  model: SpeechModelId;
  audio: {
    format: 'pcm';
    codec: 'raw';
    rate: 16000;
    bits: 16;
    channel: 1;
  };
};

export type AndroidSpeechCredentialState = {
  configured: boolean;
  version: string;
};

export type AndroidNativeSpeechBridge = {
  getSpeechCredentialState: () => Promise<string>;
  configureSpeechCredential: (accessToken: string, version: string) => Promise<string>;
  clearSpeechCredential: () => Promise<string>;
  startSpeech: (payloadJson: string) => Promise<string>;
  finishSpeech: (streamId: string) => Promise<string>;
  cancelSpeech: (streamId: string, reason: RegistrySpeechCancelPayload['reason']) => Promise<string>;
};

export type AndroidNativeSpeechRuntime = {
  credentialState: () => Promise<AndroidSpeechCredentialState>;
  configureCredential: (accessToken: string, version: string) => Promise<AndroidSpeechCredentialState>;
  clearCredential: () => Promise<AndroidSpeechCredentialState>;
  start: (payload: AndroidNativeSpeechStartPayload) => Promise<{streamId: string}>;
  finish: (streamId: string) => Promise<void>;
  cancel: (streamId: string, reason: RegistrySpeechCancelPayload['reason']) => Promise<void>;
  onEvent: (listener: (event: AndroidNativeSpeechEvent) => void) => () => void;
};

type AndroidSpeechCommandResponse = {
  accepted?: boolean;
  streamId?: string;
  code?: string;
  message?: string;
};

type NativeSpeechWindow = Window & {
  WheelMakerAndroidNative?: AndroidNativeMessageTarget;
  __wheelmakerAndroidSpeechEvent?: (event: unknown) => void;
};

const listeners = new Set<(event: AndroidNativeSpeechEvent) => void>();
let callbackTarget: NativeSpeechWindow | null = null;

function nativeWindow(): NativeSpeechWindow | null {
  return typeof window === 'undefined' ? null : window as NativeSpeechWindow;
}

function parseObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw || '{}') as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid Android native speech response.');
  }
  return parsed as Record<string, unknown>;
}

function assertAccepted(raw: string): AndroidSpeechCommandResponse {
  const response = parseObject(raw) as AndroidSpeechCommandResponse;
  if (response.accepted === false) {
    throw new Error(response.message || response.code || 'Android native speech command was rejected.');
  }
  return response;
}

function parseCredentialState(raw: string): AndroidSpeechCredentialState {
  const response = parseObject(raw);
  return {
    configured: response.configured === true,
    version: typeof response.version === 'string' ? response.version : '',
  };
}

function normalizeEvent(raw: unknown): AndroidNativeSpeechEvent | null {
  let value: unknown;
  try {
    value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const streamId = typeof event.streamId === 'string' ? event.streamId : '';
  if (event.type === 'transcript' && streamId && typeof event.text === 'string') {
    return {type: 'transcript', streamId, text: event.text, final: event.final === true};
  }
  if (event.type === 'level' && streamId && typeof event.level === 'number') {
    return {type: 'level', streamId, level: event.level};
  }
  if (event.type === 'status' && streamId && typeof event.status === 'string') {
    const known: AndroidNativeSpeechStatus[] = ['permission', 'connecting', 'recording', 'finishing', 'recognizing', 'closed'];
    if (known.includes(event.status as AndroidNativeSpeechStatus)) {
      return {type: 'status', streamId, status: event.status as AndroidNativeSpeechStatus};
    }
  }
  if (
    event.type === 'error' && typeof event.code === 'string' &&
    typeof event.message === 'string' && typeof event.retryable === 'boolean'
  ) {
    return {
      type: 'error',
      ...(streamId ? {streamId} : {}),
      code: event.code,
      message: event.message,
      retryable: event.retryable,
    };
  }
  if (event.type === 'closed' && streamId && typeof event.reason === 'string') {
    return {type: 'closed', streamId, reason: event.reason};
  }
  return null;
}

function ensureCallbackInstalled(): void {
  const target = nativeWindow();
  if (!target || callbackTarget === target) return;
  callbackTarget = target;
  const previous = target.__wheelmakerAndroidSpeechEvent;
  target.__wheelmakerAndroidSpeechEvent = event => {
    previous?.(event);
    const normalized = normalizeEvent(event);
    if (!normalized) return;
    for (const listener of Array.from(listeners)) listener(normalized);
  };
}

export function isAndroidNativeSpeechHost(): boolean {
  return !!getAndroidNativeRpcFacade(nativeWindow() ?? undefined);
}

export function getAndroidNativeSpeechBridge(): AndroidNativeSpeechBridge | null {
  return getAndroidNativeRpcFacade(nativeWindow() ?? undefined);
}

export function createAndroidNativeSpeechRuntime(): AndroidNativeSpeechRuntime | null {
  const bridge = getAndroidNativeSpeechBridge();
  if (!bridge) return null;
  ensureCallbackInstalled();
  return {
    credentialState: async () => parseCredentialState(await bridge.getSpeechCredentialState()),
    configureCredential: async (accessToken, version) =>
      parseCredentialState(await bridge.configureSpeechCredential(accessToken, version)),
    clearCredential: async () => parseCredentialState(await bridge.clearSpeechCredential()),
    start: async payload => {
      const response = assertAccepted(await bridge.startSpeech(JSON.stringify(payload)));
      if (!response.streamId) throw new Error('Android native speech returned no streamId.');
      return {streamId: response.streamId};
    },
    finish: async streamId => {
      assertAccepted(await bridge.finishSpeech(streamId));
    },
    cancel: async (streamId, reason) => {
      assertAccepted(await bridge.cancelSpeech(streamId, reason));
    },
    onEvent: listener => {
      ensureCallbackInstalled();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export async function synchronizeAndroidSpeechCredential(
  runtime: AndroidNativeSpeechRuntime,
  snapshot: ServerSettings,
  loadCredential: () => Promise<{accessToken: string; version: string; model: SpeechModelId}>,
): Promise<void> {
  const state = await runtime.credentialState();
  const version = snapshot.voiceInput.updatedAt ?? '';
  if (!snapshot.voiceInput.configured) {
    if (state.configured) await runtime.clearCredential();
    return;
  }
  if (state.configured && state.version === version) return;

  let credential: {accessToken: string; version: string; model: SpeechModelId} | null = null;
  try {
    credential = await loadCredential();
    await runtime.configureCredential(credential.accessToken, credential.version);
  } catch (error) {
    if (error instanceof Error && /not[_ -]?configured/i.test(error.message)) {
      await runtime.clearCredential();
      return;
    }
    throw error;
  } finally {
    if (credential) credential.accessToken = '';
  }
}

export function isAndroidNativeSpeechAuthenticationError(code: string): boolean {
  const normalized = code.trim().toUpperCase();
  return /^DOUBAO_45\d{6}$/.test(normalized) ||
    normalized === 'UNAUTHORIZED' ||
    normalized === 'FORBIDDEN' ||
    normalized === 'AUTHENTICATION_FAILED';
}
