import type {
  RegistryUsageHistoryLimit,
  RegistryUsageHistoryResponse,
  RegistryUsageHistorySample,
} from '../registry/registryTypes';
import type {UsageAccountSource} from './usageTypes';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const FRESH_HISTORY_MILLIS = 20 * MINUTE;

export type UsageHistoryLimit = RegistryUsageHistoryLimit;

export interface UsageHistoryCandidate {
  hubId: string;
  limit: UsageHistoryLimit;
}

export interface UsageForecast {
  status: 'insufficient' | 'depletesBeforeReset' | 'safeUntilReset';
  speedPerHour?: number;
  depletionAtMillis?: number;
  remainingAtReset?: number;
  projection: RegistryUsageHistorySample[];
  validIntervalCount: number;
}

export interface UsageForecastInput {
  samples: RegistryUsageHistorySample[];
  resetsAtMillis: number;
  lookbackMillis: number;
}

export type UsageHistoryLoadResult =
  | {status: 'error'}
  | {status: 'empty'}
  | {
      status: 'ready';
      hubId: string;
      limit: UsageHistoryLimit;
      forecast: UsageForecast;
    };

export interface UsageHistoryLoadInput {
  providerId: string;
  sources: UsageAccountSource[];
  nowMillis: number;
  request: (source: UsageAccountSource) => Promise<RegistryUsageHistoryResponse>;
}

export function selectLongestLimit(limits: UsageHistoryLimit[]): UsageHistoryLimit | undefined {
  return [...limits].sort((left, right) => {
    const durationDifference = limitDurationScore(right) - limitDurationScore(left);
    if (durationDifference !== 0) return durationDifference;
    return left.id.localeCompare(right.id) || left.label.localeCompare(right.label);
  })[0];
}

export function selectBestHistory(
  candidates: UsageHistoryCandidate[],
  nowMillis: number,
): UsageHistoryCandidate | undefined {
  const scored = candidates
    .map(candidate => {
      const samples = normalizeSamples(candidate.limit.samples);
      const firstMillis = samples[0]?.observedAtMillis;
      const lastMillis = samples.at(-1)?.observedAtMillis;
      return {
        candidate,
        count: samples.length,
        firstMillis,
        lastMillis,
        span: firstMillis === undefined || lastMillis === undefined ? 0 : lastMillis - firstMillis,
      };
    })
    .filter(item => item.lastMillis !== undefined);
  const eligible = scored.filter(item => {
    const age = nowMillis - (item.lastMillis ?? 0);
    return item.count >= 3 && age >= 0 && age <= FRESH_HISTORY_MILLIS;
  });
  const pool = eligible.length > 0 ? eligible : scored;
  return pool.sort((left, right) => {
    if (eligible.length > 0) {
      return right.span - left.span
        || right.count - left.count
        || (right.lastMillis ?? 0) - (left.lastMillis ?? 0)
        || left.candidate.hubId.localeCompare(right.candidate.hubId);
    }
    return (right.lastMillis ?? 0) - (left.lastMillis ?? 0)
      || left.candidate.hubId.localeCompare(right.candidate.hubId);
  })[0]?.candidate;
}

export function usageForecastLookbackMillis(limit: UsageHistoryLimit): number {
  return limit.windowKind === 'calendarMonth' ? 72 * HOUR : 24 * HOUR;
}

export function calculateUsageForecast(input: UsageForecastInput): UsageForecast {
  const insufficient = (validIntervalCount = 0): UsageForecast => ({
    status: 'insufficient',
    projection: [],
    validIntervalCount,
  });
  if (
    !Number.isFinite(input.resetsAtMillis)
    || !Number.isFinite(input.lookbackMillis)
    || input.lookbackMillis <= 0
  ) {
    return insufficient();
  }

  const normalized = normalizeSamples(input.samples);
  const latest = normalized.at(-1);
  if (!latest || input.resetsAtMillis < latest.observedAtMillis) return insufficient();
  const cutoff = latest.observedAtMillis - input.lookbackMillis;
  const samples = normalized.filter(sample => sample.observedAtMillis >= cutoff);
  if (samples.length < 3) return insufficient();

  const halfLifeMillis = input.lookbackMillis / 2;
  let weightedSpeed = 0;
  let totalWeight = 0;
  let validIntervalCount = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const elapsedMillis = current.observedAtMillis - previous.observedAtMillis;
    const consumed = previous.remainingPercent - current.remainingPercent;
    if (elapsedMillis <= 0 || consumed < 0) continue;
    const elapsedHours = elapsedMillis / HOUR;
    const speed = consumed / elapsedHours;
    const midpoint = previous.observedAtMillis + elapsedMillis / 2;
    const age = latest.observedAtMillis - midpoint;
    const weight = 2 ** (-age / halfLifeMillis);
    weightedSpeed += speed * weight;
    totalWeight += weight;
    validIntervalCount += 1;
  }
  if (validIntervalCount === 0 || totalWeight <= 0) return insufficient(validIntervalCount);

  const speedPerHour = Math.max(0, weightedSpeed / totalWeight);
  const latestRemaining = clampPercent(latest.remainingPercent);
  const hoursUntilReset = Math.max(0, input.resetsAtMillis - latest.observedAtMillis) / HOUR;
  if (speedPerHour > 0) {
    const depletionAtMillis = latest.observedAtMillis + (latestRemaining / speedPerHour) * HOUR;
    if (depletionAtMillis <= input.resetsAtMillis) {
      return {
        status: 'depletesBeforeReset',
        speedPerHour,
        depletionAtMillis,
        projection: [
          latest,
          {observedAtMillis: depletionAtMillis, remainingPercent: 0},
        ],
        validIntervalCount,
      };
    }
  }

  const remainingAtReset = clampPercent(latestRemaining - speedPerHour * hoursUntilReset);
  return {
    status: 'safeUntilReset',
    speedPerHour,
    remainingAtReset,
    projection: [
      latest,
      {observedAtMillis: input.resetsAtMillis, remainingPercent: remainingAtReset},
    ],
    validIntervalCount,
  };
}

export async function loadUsageHistoryFromSources(
  input: UsageHistoryLoadInput,
): Promise<UsageHistoryLoadResult> {
  if (input.sources.length === 0) return {status: 'error'};
  const settled = await Promise.allSettled(input.sources.map(source =>
    Promise.resolve().then(() => input.request(source))));
  const histories = settled.flatMap(result =>
    result.status === 'fulfilled' && result.value.providerId === input.providerId
      ? [result.value]
      : []);
  if (histories.length === 0) return {status: 'error'};

  const longest = selectLongestLimit(histories.flatMap(history => history.limits));
  if (!longest) return {status: 'empty'};
  const candidates = histories.flatMap(history =>
    history.limits
      .filter(limit => limit.id === longest.id)
      .map(limit => ({hubId: history.hubId, limit})));
  const best = selectBestHistory(candidates, input.nowMillis);
  if (!best) return {status: 'empty'};
  const resetAtMillis = Date.parse(best.limit.resetsAt ?? '');
  if (!Number.isFinite(resetAtMillis)) return {status: 'empty'};
  return {
    status: 'ready',
    hubId: best.hubId,
    limit: best.limit,
    forecast: calculateUsageForecast({
      samples: best.limit.samples,
      resetsAtMillis: resetAtMillis,
      lookbackMillis: usageForecastLookbackMillis(best.limit),
    }),
  };
}

function limitDurationScore(limit: UsageHistoryLimit): number {
  if (limit.windowKind === 'calendarMonth') return Number.MAX_SAFE_INTEGER;
  return Number.isFinite(limit.windowDurationMins) ? Math.max(0, limit.windowDurationMins ?? 0) : 0;
}

function normalizeSamples(samples: RegistryUsageHistorySample[]): RegistryUsageHistorySample[] {
  const byTimestamp = new Map<number, RegistryUsageHistorySample>();
  for (const sample of samples) {
    if (
      !Number.isFinite(sample.observedAtMillis)
      || !Number.isInteger(sample.observedAtMillis)
      || sample.observedAtMillis < 0
      || !Number.isFinite(sample.remainingPercent)
      || sample.remainingPercent < 0
      || sample.remainingPercent > 100
    ) {
      continue;
    }
    byTimestamp.set(sample.observedAtMillis, sample);
  }
  return Array.from(byTimestamp.values())
    .sort((left, right) => left.observedAtMillis - right.observedAtMillis);
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
