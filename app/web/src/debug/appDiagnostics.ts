export type AppDiagnosticCategory = 'voice' | 'workspace' | 'http';
export type AppDiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';
export type AppDiagnosticLogLevel = 'debug' | 'info' | 'warning' | 'error';

export type AppDiagnosticRecord = {
  id: number;
  timestamp: number;
  timeText: string;
  category: AppDiagnosticCategory;
  level: AppDiagnosticLevel;
  event: string;
  details: Record<string, unknown>;
};

export type AppDiagnosticInput = {
  category: AppDiagnosticCategory;
  level: AppDiagnosticLevel;
  event: string;
  details?: Record<string, unknown>;
};

export type AppDiagnosticFilter = {
  category: AppDiagnosticCategory;
  levels: AppDiagnosticLevel[];
};

export type AppDiagnosticSubscriber = (records: AppDiagnosticRecord[]) => void;

export type AppDiagnosticStore = {
  clear: () => void;
  getRecords: () => AppDiagnosticRecord[];
  getLogLevel: () => AppDiagnosticLogLevel;
  setLogLevel: (level: AppDiagnosticLogLevel) => void;
  record: (input: AppDiagnosticInput) => boolean;
  subscribe: (subscriber: AppDiagnosticSubscriber) => () => void;
};

const MAX_APP_DIAGNOSTIC_RECORDS = 200;
const SENSITIVE_DETAIL_KEYS = new Set(['apiKey', 'streamId']);
const OMITTED_DETAIL_KEYS = new Set(['pcm', 'base64']);
const APP_DIAGNOSTIC_LEVEL_ORDER: Record<AppDiagnosticLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
const APP_DIAGNOSTIC_LOG_LEVEL_MINIMUM: Record<AppDiagnosticLogLevel, AppDiagnosticLevel> = {
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  error: 'error',
};
const APP_DIAGNOSTIC_LEVELS: AppDiagnosticLevel[] = ['debug', 'info', 'warn', 'error'];

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

export function formatAppDiagnosticTime(timestamp: number): string {
  const date = new Date(timestamp);
  return [
    pad(date.getHours(), 2),
    pad(date.getMinutes(), 2),
    pad(date.getSeconds(), 2),
  ].join(':') + `.${pad(date.getMilliseconds(), 3)}`;
}

function sanitizeDiagnosticValue(value: unknown, depth: number): unknown {
  if (depth > 4) {
    return '[truncated]';
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeDiagnosticValue(item, depth + 1));
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_DETAIL_KEYS.has(key)) {
      output[key] = '[redacted]';
      continue;
    }
    if (OMITTED_DETAIL_KEYS.has(key)) {
      output[key] = '[omitted]';
      continue;
    }
    output[key] = sanitizeDiagnosticValue(item, depth + 1);
  }
  return output;
}

export function sanitizeAppDiagnosticDetails(details: Record<string, unknown> = {}): Record<string, unknown> {
  return sanitizeDiagnosticValue(details, 0) as Record<string, unknown>;
}

export function normalizeAppDiagnosticLogLevel(
  value: unknown,
  fallback: AppDiagnosticLogLevel = 'warning',
): AppDiagnosticLogLevel {
  if (value === 'debug' || value === 'info' || value === 'warning' || value === 'error') {
    return value;
  }
  if (value === 'warn') {
    return 'warning';
  }
  return fallback;
}

export function appDiagnosticLevelsAtOrAbove(logLevel: AppDiagnosticLogLevel): AppDiagnosticLevel[] {
  const minimumLevel = APP_DIAGNOSTIC_LOG_LEVEL_MINIMUM[logLevel];
  const minimumOrder = APP_DIAGNOSTIC_LEVEL_ORDER[minimumLevel];
  return APP_DIAGNOSTIC_LEVELS.filter(level => APP_DIAGNOSTIC_LEVEL_ORDER[level] >= minimumOrder);
}

export function filterAppDiagnosticRecords(
  records: AppDiagnosticRecord[],
  filter: AppDiagnosticFilter,
): AppDiagnosticRecord[] {
  const levels = new Set(filter.levels);
  return records.filter(record => record.category === filter.category && levels.has(record.level));
}

function formatDiagnosticDetailValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ');
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  return (JSON.stringify(value) ?? String(value)).replace(/\s+/g, ' ');
}

export function formatAppDiagnosticRecordLine(record: AppDiagnosticRecord): string {
  const detailParts = Object.entries(record.details).map(
    ([key, value]) => `${key}=${formatDiagnosticDetailValue(value)}`,
  );
  return [
    record.timeText,
    record.level,
    record.category,
    record.event,
    ...detailParts,
  ].join(' ');
}

export function serializeAppDiagnosticRecords(records: AppDiagnosticRecord[]): string {
  if (records.length === 0) {
    return '';
  }
  return `${records.map(formatAppDiagnosticRecordLine).join('\n')}\n`;
}

function cloneRecords(records: AppDiagnosticRecord[]): AppDiagnosticRecord[] {
  return records.slice();
}

function shouldRecordAppDiagnostic(level: AppDiagnosticLevel, logLevel: AppDiagnosticLogLevel): boolean {
  const minimumLevel = APP_DIAGNOSTIC_LOG_LEVEL_MINIMUM[logLevel];
  return APP_DIAGNOSTIC_LEVEL_ORDER[level] >= APP_DIAGNOSTIC_LEVEL_ORDER[minimumLevel];
}

export function createAppDiagnosticStore(
  now: () => number = () => Date.now(),
  initialLogLevel: AppDiagnosticLogLevel = 'warning',
): AppDiagnosticStore {
  let nextId = 1;
  let records: AppDiagnosticRecord[] = [];
  let logLevel = normalizeAppDiagnosticLogLevel(initialLogLevel);
  const subscribers = new Set<AppDiagnosticSubscriber>();

  const notify = () => {
    const snapshot = cloneRecords(records);
    for (const subscriber of subscribers) {
      subscriber(snapshot);
    }
  };

  return {
    clear: () => {
      records = [];
      notify();
    },
    getRecords: () => cloneRecords(records),
    getLogLevel: () => logLevel,
    setLogLevel: nextLogLevel => {
      logLevel = normalizeAppDiagnosticLogLevel(nextLogLevel, logLevel);
    },
    record: input => {
      if (!shouldRecordAppDiagnostic(input.level, logLevel)) {
        return false;
      }
      const timestamp = now();
      records = [
        ...records,
        {
          id: nextId,
          timestamp,
          timeText: formatAppDiagnosticTime(timestamp),
          category: input.category,
          level: input.level,
          event: input.event,
          details: sanitizeAppDiagnosticDetails(input.details),
        },
      ].slice(-MAX_APP_DIAGNOSTIC_RECORDS);
      nextId += 1;
      notify();
      return true;
    },
    subscribe: subscriber => {
      subscribers.add(subscriber);
      subscriber(cloneRecords(records));
      return () => {
        subscribers.delete(subscriber);
      };
    },
  };
}

export const appDiagnosticStore = createAppDiagnosticStore();
