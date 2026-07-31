import {getNativeRuntimeBridge} from '../platform/native/nativeRuntime';

export function nativeDeepSeekLoginAvailable(): boolean {
  return typeof getNativeRuntimeBridge()?.deepSeekLogin === 'function';
}

export function requestNativeDeepSeekLogin(): Promise<string> {
  const bridge = getNativeRuntimeBridge();
  if (typeof bridge?.deepSeekLogin !== 'function') {
    return Promise.reject(new Error('Native DeepSeek login is unavailable'));
  }
  return bridge.deepSeekLogin();
}
