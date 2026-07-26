import type {RegistrySessionGoalStatus} from '../registry/registryTypes';

export function formatGoalTokens(value: number): string {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  return new Intl.NumberFormat('en', {
    notation: normalized >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: normalized >= 10_000 ? 0 : undefined,
  }).format(normalized);
}

export function formatGoalElapsed(seconds: number): string {
  const normalized = Number.isFinite(seconds) ? Math.max(0, Math.trunc(seconds)) : 0;
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function canResumeGoal(status: RegistrySessionGoalStatus): boolean {
  return status === 'paused'
    || status === 'blocked'
    || status === 'usageLimited'
    || status === 'budgetLimited';
}

export function goalStatusLabel(status: RegistrySessionGoalStatus): string {
  switch (status) {
    case 'usageLimited':
      return 'Usage limited';
    case 'budgetLimited':
      return 'Budget limited';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function goalStatusTone(status: RegistrySessionGoalStatus): string {
  switch (status) {
    case 'active':
      return 'active';
    case 'paused':
      return 'paused';
    case 'complete':
      return 'complete';
    default:
      return 'attention';
  }
}
