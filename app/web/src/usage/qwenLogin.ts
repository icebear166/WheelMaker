import {getNativeRuntimeBridge} from '../platform/native/nativeRuntime';
import type {RegistryQwenOAuthCredential} from '../registry/registryTypes';

export function nativeQwenLoginAvailable(): boolean {
  return typeof getNativeRuntimeBridge()?.qwenLogin === 'function';
}

export async function requestNativeQwenLogin(): Promise<RegistryQwenOAuthCredential> {
  const bridge = getNativeRuntimeBridge();
  if (typeof bridge?.qwenLogin !== 'function') {
    throw new Error('Native Qwen login is unavailable in this browser');
  }
  const raw = await bridge.qwenLogin();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Native Qwen login returned invalid OAuth data');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Native Qwen login returned invalid OAuth data');
  }
  const value = parsed as Record<string, unknown>;
  if (typeof value.accessToken !== 'string' || value.accessToken.trim() === '') {
    throw new Error('Native Qwen login returned no OAuth access token');
  }
  return {
    accessToken: value.accessToken,
    refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : undefined,
    expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : undefined,
    region: typeof value.region === 'string' ? value.region : undefined,
    site: typeof value.site === 'string' ? value.site : undefined,
  };
}
