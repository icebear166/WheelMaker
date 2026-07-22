import {
  EFFORT_ORDER,
  MODEL_FAMILIES,
  type ModelEfficiencyEffort,
  type ModelEfficiencyFamily,
  type ModelEfficiencyItem,
  type ModelEfficiencyRecommendations,
} from './modelEfficiencyTypes';

type JsonRecord = Record<string, unknown>;

type CandidateRecord = {
  item: ModelEfficiencyItem;
  date?: string;
  root: boolean;
};

type CostedItem = {
  item: ModelEfficiencyItem;
  combinedCost: number;
};

const familyOrder = new Map<ModelEfficiencyFamily, number>(
  MODEL_FAMILIES.map((family, index) => [family, index]),
);

const effortOrder = new Map<ModelEfficiencyEffort, number>(
  EFFORT_ORDER.map((effort, index) => [effort, index]),
);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFamily(value: unknown): value is ModelEfficiencyFamily {
  return typeof value === 'string'
    && (MODEL_FAMILIES as readonly string[]).includes(value);
}

function isEffort(value: unknown): value is ModelEfficiencyEffort {
  return typeof value === 'string'
    && (EFFORT_ORDER as readonly string[]).includes(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const result = finiteNumber(value);
  return result !== undefined && result >= 0 ? result : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const result = finiteNumber(value);
  return result !== undefined && result > 0 ? result : undefined;
}

function parseCandidate(value: unknown, root: boolean): CandidateRecord | null {
  if (!isRecord(value)) return null;

  const family = value.model;
  const effort = value.reasoning_effort;
  const score = finiteNumber(value.score);
  if (!isFamily(family) || !isEffort(effort) || score === undefined) return null;

  const averageCostUsd = nonNegativeNumber(value.average_cost_usd);
  const averageTaskSeconds = positiveNumber(value.average_task_seconds);
  const date = typeof value.date === 'string' ? value.date : undefined;

  return {
    item: {
      family,
      effort,
      score,
      ...(averageCostUsd === undefined ? {} : {averageCostUsd}),
      ...(averageTaskSeconds === undefined ? {} : {averageTaskSeconds}),
    },
    date,
    root,
  };
}

function dateTimestamp(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function shouldReplace(existing: CandidateRecord, incoming: CandidateRecord): boolean {
  const existingDate = dateTimestamp(existing.date);
  const incomingDate = dateTimestamp(incoming.date);

  if (existingDate !== undefined && incomingDate !== undefined) {
    if (incomingDate !== existingDate) return incomingDate > existingDate;
    return incoming.root && !existing.root;
  }

  if (existing.root !== incoming.root) return incoming.root;
  return false;
}

function compareEffort(left: ModelEfficiencyItem, right: ModelEfficiencyItem): number {
  return (effortOrder.get(left.effort) ?? Number.MAX_SAFE_INTEGER)
    - (effortOrder.get(right.effort) ?? Number.MAX_SAFE_INTEGER);
}

export function normalizeModelEfficiencyPayload(payload: unknown): ModelEfficiencyItem[] {
  if (!isRecord(payload) || !isRecord(payload.model_iq)) return [];

  const modelIq = payload.model_iq;
  const candidates: CandidateRecord[] = [];
  const root = parseCandidate(modelIq.latest, true);
  if (root) candidates.push(root);

  if (isRecord(modelIq.comparisons)) {
    for (const comparison of Object.values(modelIq.comparisons)) {
      if (!isRecord(comparison)) continue;
      const candidate = parseCandidate(comparison.latest, false);
      if (candidate) candidates.push(candidate);
    }
  }

  const deduplicated = new Map<string, CandidateRecord>();
  for (const candidate of candidates) {
    const key = `${candidate.item.family}:${candidate.item.effort}`;
    const existing = deduplicated.get(key);
    if (!existing || shouldReplace(existing, candidate)) {
      deduplicated.set(key, candidate);
    }
  }

  return Array.from(deduplicated.values(), ({item}) => item).sort((left, right) => {
    const familyDifference = (familyOrder.get(left.family) ?? Number.MAX_SAFE_INTEGER)
      - (familyOrder.get(right.family) ?? Number.MAX_SAFE_INTEGER);
    return familyDifference || compareEffort(left, right);
  });
}

export function readModelEfficiencyUpdatedAt(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.model_iq)) return undefined;
  return typeof payload.model_iq.updated_at === 'string'
    ? payload.model_iq.updated_at
    : undefined;
}

export function calculateCombinedCost(
  item: Pick<ModelEfficiencyItem, 'averageCostUsd' | 'averageTaskSeconds'>,
): number | undefined {
  const {averageCostUsd, averageTaskSeconds} = item;
  if (
    averageCostUsd === undefined
    || averageTaskSeconds === undefined
    || !Number.isFinite(averageCostUsd)
    || !Number.isFinite(averageTaskSeconds)
    || averageCostUsd < 0
    || averageTaskSeconds <= 0
  ) {
    return undefined;
  }

  const exponent = Math.log(2.5) / Math.log(1.35);
  return averageCostUsd * Math.pow(averageTaskSeconds / 60 / 10, exponent);
}

function compareQuality(left: CostedItem, right: CostedItem): number {
  return right.item.score - left.item.score
    || left.combinedCost - right.combinedCost
    || compareEffort(left.item, right.item);
}

function compareEconomy(left: CostedItem, right: CostedItem): number {
  return left.combinedCost - right.combinedCost
    || right.item.score - left.item.score
    || compareEffort(left.item, right.item);
}

function isDominated(candidate: CostedItem, items: readonly CostedItem[]): boolean {
  return items.some((other) => other !== candidate
    && other.item.score >= candidate.item.score
    && other.combinedCost <= candidate.combinedCost
    && (
      other.item.score > candidate.item.score
      || other.combinedCost < candidate.combinedCost
    ));
}

function selectBalanced(
  remaining: readonly CostedItem[],
  all: readonly CostedItem[],
): ModelEfficiencyItem | null {
  const frontier = remaining.filter((candidate) => !isDominated(candidate, remaining));
  if (frontier.length === 0) return null;

  const scores = all.map(({item}) => item.score);
  const logCosts = all.map(({combinedCost}) => Math.log(Math.max(combinedCost, Number.EPSILON)));
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const minLogCost = Math.min(...logCosts);
  const maxLogCost = Math.max(...logCosts);

  const scored = frontier.map((candidate) => {
    const scoreRange = maxScore - minScore;
    const costRange = maxLogCost - minLogCost;
    const normalizedScore = scoreRange === 0
      ? 1
      : (candidate.item.score - minScore) / scoreRange;
    const normalizedCost = costRange === 0
      ? 0
      : (Math.log(Math.max(candidate.combinedCost, Number.EPSILON)) - minLogCost) / costRange;
    return {
      ...candidate,
      distance: Math.hypot(1 - normalizedScore, normalizedCost),
    };
  });

  scored.sort((left, right) => left.distance - right.distance
    || right.item.score - left.item.score
    || left.combinedCost - right.combinedCost
    || compareEffort(left.item, right.item));
  return scored[0]?.item ?? null;
}

export function selectModelRecommendations(
  items: readonly ModelEfficiencyItem[],
): ModelEfficiencyRecommendations {
  const complete: CostedItem[] = items.flatMap((item) => {
    const combinedCost = calculateCombinedCost(item);
    return combinedCost === undefined ? [] : [{item, combinedCost}];
  });

  const quality = [...complete].sort(compareQuality)[0] ?? null;
  const afterQuality = quality
    ? complete.filter((candidate) => candidate.item.effort !== quality.item.effort)
    : complete;
  const economy = [...afterQuality].sort(compareEconomy)[0] ?? null;
  const remaining = economy
    ? afterQuality.filter((candidate) => candidate.item.effort !== economy.item.effort)
    : afterQuality;

  return {
    quality: quality?.item ?? null,
    balanced: selectBalanced(remaining, complete),
    economy: economy?.item ?? null,
  };
}
