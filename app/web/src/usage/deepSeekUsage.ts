import type {RegistryDeepSeekUsageCost, RegistryDeepSeekUsageDay, RegistryDeepSeekUsageResponse} from '../registry/registryTypes';

export interface DeepSeekUsageDay extends RegistryDeepSeekUsageDay {
  cacheHitRate: number;
  costs: Array<{currency: string; amount: number}>;
}

export interface DeepSeekCurrencySpend {
  currency: string;
  monthlyCost: number;
  todayCost: number | null;
}

export interface DeepSeekUsageView {
  status: RegistryDeepSeekUsageResponse['status'];
  message?: string;
  month: {year: number; month: number};
  balance: NonNullable<RegistryDeepSeekUsageResponse['balance']>;
  days: DeepSeekUsageDay[];
  spend: DeepSeekCurrencySpend[];
  cachedAt?: string;
  isCurrentMonth: boolean;
  isEmpty: boolean;
}

export function deepSeekHitRate(day: Pick<RegistryDeepSeekUsageDay, 'hitTokens' | 'missTokens'>): number {
  const total = day.hitTokens + day.missTokens;
  return total > 0 ? day.hitTokens / total : 0;
}

export function normalizeDeepSeekUsage(raw: RegistryDeepSeekUsageResponse, now = new Date()): DeepSeekUsageView {
  const costs: RegistryDeepSeekUsageCost[] = raw.costs ?? [];
  const isCurrentMonth = raw.month.year === now.getFullYear() && raw.month.month === now.getMonth() + 1;
  const days = (raw.days ?? []).map(day => ({
    ...day,
    cacheHitRate: deepSeekHitRate(day),
    costs: costs.map(block => ({
      currency: block.currency,
      amount: block.daily.find(entry => entry.date === day.date)?.amount ?? 0,
    })),
  }));
  return {
    status: raw.status,
    message: raw.message,
    month: raw.month,
    balance: raw.balance ?? [],
    days,
    spend: costs.map(block => ({
      currency: block.currency,
      monthlyCost: block.monthlyCost,
      todayCost: isCurrentMonth ? block.todayCost : null,
    })),
    cachedAt: raw.cachedAt,
    isCurrentMonth,
    isEmpty: days.every(day => day.totalTokens === 0),
  };
}
