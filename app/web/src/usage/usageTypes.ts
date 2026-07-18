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

export function labelForProvider(provider: string): string {
  switch (provider) {
    case 'codex': return 'Codex';
    case 'kimi': return 'Kimi';
    case 'zai': return 'ZAI';
    case 'deepseek': return 'DeepSeek';
    default: return provider;
  }
}

// formatResetCountdown renders a reset timestamp as a relative phrase
// ("in 2h 14m"), which stays useful longer than an absolute locale string.
export function formatResetCountdown(resetsAt: number | undefined, now: number): string | null {
  if (!resetsAt) return null;
  const deltaMs = resetsAt * 1000 - now;
  if (deltaMs <= 0) return 'soon';
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return 'in <1m';
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const remMinutes = minutes % 60;
    return remMinutes > 0 ? `in ${hours}h ${remMinutes}m` : `in ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `in ${days}d ${remHours}h` : `in ${days}d`;
}

// formatUpdatedAgo renders the snapshot refresh time as a short relative phrase.
export function formatUpdatedAgo(updatedAt: number, now: number): string {
  if (!updatedAt) return '';
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
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
