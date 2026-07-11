export type SessionListDensity = 'relaxed' | 'compact';

export const DEFAULT_SESSION_LIST_DENSITY: SessionListDensity = 'relaxed';

export const SESSION_LIST_DENSITY_OPTIONS: Array<{id: SessionListDensity; label: string}> = [
  {id: 'relaxed', label: 'Relaxed'},
  {id: 'compact', label: 'Compact'},
];

const SESSION_LIST_DENSITY_IDS = new Set<SessionListDensity>(
  SESSION_LIST_DENSITY_OPTIONS.map(option => option.id),
);

export function isSessionListDensity(value: unknown): value is SessionListDensity {
  return typeof value === 'string' && SESSION_LIST_DENSITY_IDS.has(value as SessionListDensity);
}

export function normalizeSessionListDensity(
  value: unknown,
  fallback: SessionListDensity = DEFAULT_SESSION_LIST_DENSITY,
): SessionListDensity {
  return isSessionListDensity(value) ? value : fallback;
}
