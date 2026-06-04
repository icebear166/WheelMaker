import {
  appDiagnosticStore,
  type AppDiagnosticLogLevel,
  type AppDiagnosticLevel,
} from './appDiagnostics';
import {
  getNativeWebSourceBridge,
  type NativeWebDiagnosticRecord,
  type NativeWebSourceBridge,
} from '../platform/native/webSource';

type NativeWebDiagnosticBridge = Pick<NativeWebSourceBridge, 'drainWebDiagnostics'>;
type NativeDiagnosticLogLevelBridge = Pick<NativeWebSourceBridge, 'setDiagnosticLogLevel'>;
type UploadableDiagnosticLevel = Extract<AppDiagnosticLevel, 'info' | 'warn' | 'error'>;

const UPLOADABLE_LEVELS = new Set<UploadableDiagnosticLevel>(['info', 'warn', 'error']);

function normalizeNativeWebDiagnosticLevel(level: unknown): UploadableDiagnosticLevel | null {
  if (typeof level !== 'string') {
    return null;
  }
  return UPLOADABLE_LEVELS.has(level as UploadableDiagnosticLevel)
    ? level as UploadableDiagnosticLevel
    : null;
}

function isRecord(value: unknown): value is NativeWebDiagnosticRecord {
  return Boolean(value && typeof value === 'object');
}

function isDetails(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export async function drainNativeWebDiagnosticsToAppLog(
  bridge: NativeWebDiagnosticBridge | null = getNativeWebSourceBridge(),
): Promise<number> {
  const drain = bridge?.drainWebDiagnostics;
  if (!drain) {
    return 0;
  }

  let payload: Awaited<ReturnType<NonNullable<NativeWebDiagnosticBridge['drainWebDiagnostics']>>>;
  try {
    payload = await Promise.resolve(drain());
  } catch {
    return 0;
  }

  const records = Array.isArray(payload?.records) ? payload.records : [];
  let count = 0;
  for (const record of records) {
    if (!isRecord(record)) {
      continue;
    }
    const level = normalizeNativeWebDiagnosticLevel(record.level);
    if (!level) {
      continue;
    }
    const stored = appDiagnosticStore.record({
      category: 'http',
      level,
      event: typeof record.event === 'string' && record.event ? record.event : 'android_web',
      details: isDetails(record.details) ? record.details : {},
    });
    if (stored) {
      count += 1;
    }
  }
  return count;
}

export async function setNativeDiagnosticLogLevel(
  logLevel: AppDiagnosticLogLevel,
  bridge: NativeDiagnosticLogLevelBridge | null = getNativeWebSourceBridge(),
): Promise<boolean> {
  const setLogLevel = bridge?.setDiagnosticLogLevel;
  if (!setLogLevel) {
    return false;
  }
  try {
    await Promise.resolve(setLogLevel(logLevel));
    return true;
  } catch {
    return false;
  }
}
