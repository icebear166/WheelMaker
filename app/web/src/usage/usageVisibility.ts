import type {UsageViewSnapshot} from './usageTypes';

export function filterUnavailableUsageSnapshot(
  snapshot: UsageViewSnapshot,
  myFlickerAvailable: boolean,
): UsageViewSnapshot {
  if (myFlickerAvailable) {
    return snapshot;
  }
  const providers = snapshot.providers.filter(provider => provider.id !== 'flicker');
  if (providers.length === snapshot.providers.length) {
    return snapshot;
  }
  return {...snapshot, providers};
}
