import {
  EFFORT_ORDER,
  MODEL_FAMILIES,
  type ModelEfficiencyEffort,
  type ModelEfficiencyFamily,
  type ModelEfficiencyItem,
} from './modelEfficiencyTypes';

type JsonRecord = Record<string, unknown>;

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

function parsePoint(value: unknown): ModelEfficiencyItem | null {
  if (!isRecord(value)) return null;

  const family = value.model;
  const effort = value.effort;
  const score = finiteNumber(value.iq);
  if (!isFamily(family) || !isEffort(effort) || score === undefined) return null;

  const averageCostUsd = nonNegativeNumber(value.average_price_usd);
  const averageMinutes = positiveNumber(value.average_minutes);

  return {
    family,
    effort,
    score,
    ...(averageCostUsd === undefined ? {} : {averageCostUsd}),
    ...(averageMinutes === undefined ? {} : {averageTaskSeconds: averageMinutes * 60}),
  };
}

function compareEffort(left: ModelEfficiencyItem, right: ModelEfficiencyItem): number {
  return (effortOrder.get(left.effort) ?? Number.MAX_SAFE_INTEGER)
    - (effortOrder.get(right.effort) ?? Number.MAX_SAFE_INTEGER);
}

export function normalizeModelEfficiencyPayload(payload: unknown): ModelEfficiencyItem[] {
  if (!isRecord(payload) || !Array.isArray(payload.points)) return [];

  const deduplicated = new Map<string, ModelEfficiencyItem>();
  for (const value of payload.points) {
    const item = parsePoint(value);
    if (!item) continue;
    const key = `${item.family}:${item.effort}`;
    if (!deduplicated.has(key)) deduplicated.set(key, item);
  }

  return Array.from(deduplicated.values()).sort((left, right) => {
    const familyDifference = (familyOrder.get(left.family) ?? Number.MAX_SAFE_INTEGER)
      - (familyOrder.get(right.family) ?? Number.MAX_SAFE_INTEGER);
    return familyDifference || compareEffort(left, right);
  });
}

export function readModelEfficiencyUpdatedAt(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  return typeof payload.source_updated_at === 'string'
    ? payload.source_updated_at
    : undefined;
}

export function selectTopModelEfficiencyItems(
  items: readonly ModelEfficiencyItem[],
): ModelEfficiencyItem[] {
  return [...items]
    .sort((left, right) => right.score - left.score || compareEffort(left, right))
    .slice(0, 3);
}
