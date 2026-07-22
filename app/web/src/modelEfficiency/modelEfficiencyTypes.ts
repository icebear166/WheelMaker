export const MODEL_FAMILIES = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
] as const;

export const EFFORT_ORDER = [
  'ultra',
  'max',
  'xhigh',
  'high',
  'medium',
  'low',
] as const;

export type ModelEfficiencyFamily = (typeof MODEL_FAMILIES)[number];
export type ModelEfficiencyEffort = (typeof EFFORT_ORDER)[number];
export type RecommendationRole = 'quality' | 'balanced' | 'economy';

export type ModelEfficiencyItem = {
  family: ModelEfficiencyFamily;
  effort: ModelEfficiencyEffort;
  score: number;
  averageCostUsd?: number;
  averageTaskSeconds?: number;
};

export type ModelEfficiencyRecommendations = Record<
  RecommendationRole,
  ModelEfficiencyItem | null
>;

export type ModelEfficiencySnapshot = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  refreshing: boolean;
  items: readonly ModelEfficiencyItem[];
  updatedAt?: string;
  error?: string;
};
