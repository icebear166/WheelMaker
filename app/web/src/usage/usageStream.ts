import {UsageAccount, UsageBalance, UsageLimit, mergeAccountsAcrossHubs} from './usageTypes';

export interface UsageSnapshot {
  accounts: UsageAccount[];
  updatedAt: number;
}

// parseLimitString turns the compact server format "77% (07-22 15:04)" into a
// structured UsageLimit. "77%" is remaining; usedPercent = 100 - remaining.
export function parseLimitString(raw: string | undefined, id: string, label: string): UsageLimit | null {
  if (!raw || typeof raw !== 'string') return null;
  const match = raw.match(/^(\d+)%(?:\s*\(([^)]+)\))?/);
  if (!match) return null;
  const remaining = parseInt(match[1], 10);
  if (!Number.isFinite(remaining)) return null;
  const usedPercent = Math.max(0, Math.min(100, 100 - remaining));
  let resetsAt: number | undefined;
  if (match[2]) {
    // Format "MM-DD HH:MM" (server local time, current year implied).
    const parts = match[2].match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if (parts) {
      const now = new Date();
      const d = new Date(now.getFullYear(), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), parseInt(parts[3], 10), parseInt(parts[4], 10), 0, 0);
      resetsAt = Math.floor(d.getTime() / 1000);
    }
  }
  return {id, label, usedPercent, resetsAt};
}

// parseProviderResult converts a server-side tokenProviderScanResult into an
// array of hub-scoped accounts (before cross-hub merge).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseProviderResult(result: any, hubId: string): Array<Omit<UsageAccount, 'hubIds'> & {hubId: string}> {
  const provider = String(result?.id ?? '').toLowerCase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts: any[] = Array.isArray(result?.accounts) ? result.accounts : [];
  return accounts.map(acc => {
    const limits: UsageLimit[] = [];
    const fiveHour = parseLimitString(acc.fiveHourLimit, '5h', '5h window');
    if (fiveHour) limits.push(fiveHour);
    const week = parseLimitString(acc.weeklyLimit, 'week', 'Weekly');
    if (week) limits.push(week);
    const mcp = parseLimitString(acc.mcpLimit, 'mcp-month', 'MCP monthly');
    if (mcp) limits.push(mcp);

    let balance: UsageBalance | undefined;
    if (acc.balance && Array.isArray(acc.balance.items) && acc.balance.items.length > 0) {
      balance = {
        isAvailable: acc.balance.isAvailable !== false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items: acc.balance.items.map((item: any) => ({
          currency: String(item.currency ?? ''),
          total: String(item.totalBalance ?? item.total ?? ''),
          granted: String(item.grantedBalance ?? item.granted ?? ''),
          toppedUp: String(item.toppedUpBalance ?? item.toppedUp ?? ''),
        })),
      };
    }

    return {
      provider,
      identity: {
        email: acc.email || undefined,
        accountId: provider === 'codex' ? String(acc.id ?? '').split(':')[0] || undefined : undefined,
        userId: provider === 'kimi' ? String(acc.id ?? '').split(':')[0] || undefined : undefined,
        customerNumber: provider === 'zai' ? String(acc.id ?? '').split(':')[0] || undefined : undefined,
      },
      status: acc.status === 'error' ? 'error' as const : 'ok' as const,
      message: acc.message,
      limits,
      balance,
      hubId,
    };
  });
}

interface RegistryEventEnvelope {
  type: 'event';
  method: string;
  hubId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

export class UsageStream {
  private byHub = new Map<string, Array<Omit<UsageAccount, 'hubIds'> & {hubId: string}>>();
  private listeners = new Set<(snapshot: UsageSnapshot) => void>();

  ingest(envelope: RegistryEventEnvelope): void {
    if (envelope.method !== 'tokenStats.update') return;
    const parsed = parseProviderResult(envelope.payload, envelope.hubId);
    // Replace the entire provider set for this hub on each event (idempotent).
    const list = this.byHub.get(envelope.hubId) ?? [];
    for (const entry of parsed) {
      const idx = list.findIndex(
        a => a.provider === entry.provider && JSON.stringify(a.identity) === JSON.stringify(entry.identity),
      );
      if (idx >= 0) list[idx] = entry;
      else list.push(entry);
    }
    this.byHub.set(envelope.hubId, list);
    this.emit();
  }

  snapshot(): UsageSnapshot {
    const all: Array<Omit<UsageAccount, 'hubIds'> & {hubId: string}> = [];
    for (const list of this.byHub.values()) all.push(...list);
    return {accounts: mergeAccountsAcrossHubs(all), updatedAt: Date.now()};
  }

  subscribe(fn: (snapshot: UsageSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }
}
