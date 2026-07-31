import type {RegistryDeepSeekUsageCost, RegistryDeepSeekUsageDay, RegistryDeepSeekUsageResponse} from '../registry/registryTypes';

export type {RegistryDeepSeekUsageCost} from '../registry/registryTypes';

export interface DeepSeekUsageDay extends RegistryDeepSeekUsageDay {
  cacheHitRate: number;
  cost: number;
}

export interface DeepSeekUsageView {
  status: RegistryDeepSeekUsageResponse['status'];
  month: {year: number; month: number};
  balance: RegistryDeepSeekUsageResponse['balance'];
  days: DeepSeekUsageDay[];
  costs: RegistryDeepSeekUsageCost[];
  monthlyCost: number;
  todayCost: number;
  currency: string;
  cachedAt?: string;
}

export function deepSeekHitRate(day: Pick<RegistryDeepSeekUsageDay, 'hitTokens' | 'missTokens'>): number {
  const total = day.hitTokens + day.missTokens;
  return total > 0 ? day.hitTokens / total : 0;
}

export function deepSeekDayCost(date: string, costs: RegistryDeepSeekUsageCost[]): number {
  for (const cost of costs) {
    const day = cost.daily.find(entry => entry.date === date);
    if (day) return day.amount;
  }
  return 0;
}

export function deepSeekTodayCost(now: Date, daily: Array<{date: string; amount: number}>): number {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return daily.find(entry => entry.date === today)?.amount ?? 0;
}

export function normalizeDeepSeekUsage(raw: RegistryDeepSeekUsageResponse, now = new Date()): DeepSeekUsageView {
  const days = (raw.days ?? []).map(day => ({
    ...day,
    cacheHitRate: deepSeekHitRate(day),
    cost: deepSeekDayCost(day.date, raw.costs ?? []),
  }));
  const costs = raw.costs ?? [];
  const primary = costs[0];
  const todayCost = primary ? deepSeekTodayCost(now, primary.daily) : 0;
  return {
    status: raw.status,
    month: raw.month,
    balance: raw.balance,
    days,
    costs,
    monthlyCost: primary?.monthlyCost ?? 0,
    todayCost,
    currency: primary?.currency ?? '',
    cachedAt: raw.cachedAt,
  };
}

export function deepSeekMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function deepSeekMonthLabel(year: number, month: number): string {
  return deepSeekMonthKey(year, month);
}

export function previousDeepSeekMonth(year: number, month: number): {year: number; month: number} {
  return month === 1 ? {year: year - 1, month: 12} : {year, month: month - 1};
}
