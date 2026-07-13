import type {
  RegistrySpeechCancelPayload,
  RegistrySpeechStartPayload,
  RegistrySpeechStartResponse,
} from '../../registry/registryTypes';
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
  | {
      type: 'status';
      streamId: string;
      status: AndroidNativeSpeechStatus;
    }
  | {
      type: 'level';
      streamId: string;
      level: number;
    }
  | {
      type: 'transcript';
      streamId: string;
      text: string;
      final: boolean;
    }
  | {
      type: 'error';
      streamId?: string;
      code: string;
      message: string;
      retryable: boolean;
    }
  | {
      type: 'closed';
      streamId: string;
      reason: string;
    };

export type AndroidNativeSpeechBridge = {
  startSpeech: (payloadJson: string) => Promise<string>;
  finishSpeech: (streamId: string) => Promise<string>;
  cancelSpeech: (streamId: string, reason: RegistrySpeechCancelPayload['reason']) => Promise<string>;
};

export type AndroidNativeSpeechRuntime = {
  start: (payload: RegistrySpeechStartPayload) => Promise<RegistrySpeechStartResponse>;
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
let callbackInstalled = false;

function nativeWindow(): NativeSpeechWindow | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window as NativeSpeechWindow;
}

function parseCommandResponse(raw: string): AndroidSpeechCommandResponse {
  try {
    const parsed = JSON.parse(raw || '{}') as AndroidSpeechCommandResponse;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }
}

function assertAccepted(raw: string): AndroidSpeechCommandResponse {
  const response = parseCommandResponse(raw);
  if (response.accepted === false) {
    throw new Error(response.message || response.code || 'Android native speech command was rejected.');
  }
  return response;
}

function normalizeEvent(raw: unknown): AndroidNativeSpeechEvent | null {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const event = value as Partial<AndroidNativeSpeechEvent>;
  if (typeof event.type !== 'string') {
    return null;
  }
  return event as AndroidNativeSpeechEvent;
}

function ensureCallbackInstalled(): void {
  const target = nativeWindow();
  if (!target || callbackInstalled) {
    return;
  }
  callbackInstalled = true;
  const previous = target.__wheelmakerAndroidSpeechEvent;
  target.__wheelmakerAndroidSpeechEvent = event => {
    previous?.(event);
    const normalized = normalizeEvent(event);
    if (!normalized) {
      return;
    }
    for (const listener of Array.from(listeners)) {
      listener(normalized);
    }
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
  if (!bridge) {
    return null;
  }
  ensureCallbackInstalled();
  return {
    start: async payload => {
      const response = assertAccepted(await bridge.startSpeech(JSON.stringify(payload)));
      if (!response.streamId) {
        throw new Error('Android native speech returned no streamId.');
      }
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
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
