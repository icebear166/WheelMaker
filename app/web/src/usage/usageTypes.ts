export interface UsageLimit {
  id: string;        // "5h" | "week" | "mcp-month"
  label: string;     // "5h window" | "Weekly" | "MCP monthly"
  usedPercent: number;
  resetsAt?: number; // unix seconds
}

export interface UsageBalanceItem {
  currency: string;
  total: string;
  granted: string;
  toppedUp: string;
}

export interface UsageBalance {
  isAvailable: boolean;
  items: UsageBalanceItem[];
}

export interface UsageAccountIdentity {
  email?: string;
  accountId?: string;
  userId?: string;
  customerNumber?: string;
}

export interface UsageAccount {
  provider: string;
  identity: UsageAccountIdentity;
  status: 'ok' | 'error';
  message?: string;
  limits: UsageLimit[];
  balance?: UsageBalance;
  hubIds: string[];
}

export type Tightness = 'default' | 'warning' | 'danger';

export function remainingPercent(limit: UsageLimit): number {
  return Math.max(0, Math.min(100, 100 - limit.usedPercent));
}

export function tightnessColor(remaining: number): Tightness {
  if (remaining < 10) return 'danger';
  if (remaining < 30) return 'warning';
  return 'default';
}

export function accountIdentityKey(provider: string, identity: UsageAccountIdentity): string {
  const id = identity.email ?? identity.accountId ?? identity.userId ?? identity.customerNumber ?? '';
  return `${provider}:${id.toLowerCase()}`;
}

type HubAccount = Omit<UsageAccount, 'hubIds'> & {hubId: string};

export function mergeAccountsAcrossHubs(accounts: HubAccount[]): UsageAccount[] {
  const map = new Map<string, UsageAccount>();
  for (const a of accounts) {
    const key = accountIdentityKey(a.provider, a.identity);
    const existing = map.get(key);
    if (existing) {
      if (!existing.hubIds.includes(a.hubId)) existing.hubIds.push(a.hubId);
      if (existing.status === 'error' && a.status === 'ok') {
        existing.status = 'ok';
        existing.limits = a.limits;
        existing.balance = a.balance;
        existing.message = undefined;
      }
      continue;
    }
    map.set(key, {...a, hubIds: [a.hubId]});
  }
  return Array.from(map.values());
}
