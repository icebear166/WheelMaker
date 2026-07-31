import type {
  UsageAccount,
  UsageAccountSource,
  UsageHubSnapshot,
  UsageLimit,
  UsageProviderId,
  UsageProviderSnapshot,
  UsageProviderStatus,
  UsageProviderView,
  UsageResetCredits,
  UsageViewAccount,
  UsageViewSnapshot,
} from './usageTypes';
import type {HubStore} from '../hubState/hubStore';

const providerOrder: UsageProviderId[] = ['codex', 'flicker', 'kimi', 'zai', 'deepseek'];

interface UsageProviderAggregate {
  name: string;
  statuses: UsageProviderStatus[];
  accounts: Map<string, {account: UsageViewAccount; updatedAt?: string}>;
  hubs: Map<string, {hubId: string; status: UsageProviderStatus; message?: string}>;
}

export class UsageStore {
  private readonly hubs = new Map<string, UsageHubSnapshot>();
  private readonly listeners = new Set<(snapshot: UsageViewSnapshot) => void>();

  replaceHub(hubId: string, snapshot: UsageHubSnapshot): void {
    const normalizedHubId = hubId.trim();
    if (!normalizedHubId || snapshot.hubId !== normalizedHubId) return;
    const existing = this.hubs.get(normalizedHubId);
    if (existing && isOlderSnapshot(existing, snapshot)) return;
    const next = existing && snapshot.status === 'scanning' && snapshot.providers.length === 0
      ? {...snapshot, providers: existing.providers}
      : snapshot;
    this.hubs.set(normalizedHubId, next);
    this.emit();
  }

  retainHubs(hubIds: string[]): void {
    const online = new Set(hubIds.map(value => value.trim()).filter(Boolean));
    let changed = false;
    for (const hubId of this.hubs.keys()) {
      if (!online.has(hubId)) {
        this.hubs.delete(hubId);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  ingest(envelope: unknown): boolean {
    const parsed = parseUsageHubStateEvent(envelope);
    if (!parsed) return false;
    this.replaceHub(parsed.hubId, parsed);
    return true;
  }

  bindHubStore(hubStore: HubStore): () => void {
    return hubStore.subscribe(snapshot => {
      const next = new Map<string, UsageHubSnapshot>();
      for (const [hubId, hub] of Object.entries(snapshot.hubs)) {
        const parsed = parseHubSnapshot(hub.sections.tokenStats?.data);
        if (parsed) next.set(hubId, parsed);
      }
      this.replaceAll(next);
    });
  }

  snapshot(): UsageViewSnapshot {
    const providers = new Map<UsageProviderId, UsageProviderAggregate>();
    let refreshing = false;
    let updatedAt = '';
    for (const [hubId, hub] of this.hubs) {
      refreshing ||= hub.status === 'scanning';
      if (hub.updatedAt && hub.updatedAt > updatedAt) updatedAt = hub.updatedAt;
      for (const provider of hub.providers) {
        const aggregate: UsageProviderAggregate = providers.get(provider.id) ?? {
          name: provider.name,
          statuses: [],
          accounts: new Map<string, {account: UsageViewAccount; updatedAt?: string}>(),
          hubs: new Map(),
        };
        aggregate.name = provider.name || aggregate.name;
        aggregate.statuses.push(provider.status);
        aggregate.hubs.set(hubId, {hubId, status: provider.status, message: provider.message});
        for (const account of provider.accounts) {
          const identityKind = account.identity.kind?.trim();
          const identityValue = account.identity.value?.trim();
          const localId = account.localId.trim();
          const normalizedIdentityKind = identityKind?.toLowerCase();
          const normalizedIdentityValue = normalizedIdentityKind === 'email'
            ? identityValue?.toLowerCase()
            : identityValue;
          const identityKey = identityKind && identityValue
            ? `${provider.id}:${normalizedIdentityKind}:${normalizedIdentityValue}`
            : normalizedIdentityKind === 'source' && localId
              ? `${provider.id}:source:${localId}`
              : `${hubId}:${provider.id}:${account.localId}`;
          const existing = aggregate.accounts.get(identityKey);
          const hubIds = existing
            ? Array.from(new Set([...existing.account.hubIds, hubId])).sort()
            : [hubId];
          const sources = mergeAccountSources(existing?.account.sources ?? [], {
            hubId,
            accountLocalId: account.localId,
            updatedAt: hub.updatedAt,
          });
          if (!existing || isNewerSnapshotTime(hub.updatedAt, existing.updatedAt)) {
            aggregate.accounts.set(identityKey, {
              account: {...account, hubIds, sources},
              updatedAt: hub.updatedAt,
            });
          } else {
            existing.account.hubIds = hubIds;
            existing.account.sources = sources;
          }
        }
        providers.set(provider.id, aggregate);
      }
    }
    const views = Array.from(providers, ([id, aggregate]) => summarizeProvider({
      id,
      name: aggregate.name,
      status: aggregateStatus(aggregate.statuses),
      accounts: Array.from(aggregate.accounts.values(), value => value.account),
      hubs: Array.from(aggregate.hubs.values()),
    })).sort((left, right) => providerOrder.indexOf(left.id) - providerOrder.indexOf(right.id));
    return {refreshing, updatedAt: updatedAt || undefined, providers: views};
  }

  subscribe(listener: (snapshot: UsageViewSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private replaceAll(next: Map<string, UsageHubSnapshot>): void {
    let changed = false;
    for (const hubId of this.hubs.keys()) {
      if (!next.has(hubId)) {
        this.hubs.delete(hubId);
        changed = true;
      }
    }
    for (const [hubId, snapshot] of next) {
      const existing = this.hubs.get(hubId);
      if (existing && isOlderSnapshot(existing, snapshot)) continue;
      this.hubs.set(hubId, snapshot);
      changed = true;
    }
    if (changed) this.emit();
  }
}

export function summarizeProvider(provider: Omit<UsageProviderView, 'accountCount' | 'remainingPercent'>): UsageProviderView {
  const remaining = provider.accounts.flatMap(account => account.limits.map(limit => limit.remainingPercent));
  return {
    ...provider,
    accountCount: provider.accounts.length,
    remainingPercent: remaining.length > 0 ? Math.min(...remaining) : undefined,
  };
}

function aggregateStatus(statuses: UsageProviderStatus[]): UsageProviderStatus {
  if (statuses.includes('ok')) return 'ok';
  if (statuses.includes('error')) return 'error';
  return 'unavailable';
}

export function parseUsageHubStateEvent(envelope: unknown): UsageHubSnapshot | null {
  if (!isRecord(envelope) || envelope.method !== 'hub.state.updated' || !isRecord(envelope.payload)) return null;
  const sections = envelope.payload.sections;
  if (!Array.isArray(sections) || !sections.includes('tokenStats')) return null;
  const state = envelope.payload.state;
  if (!isRecord(state) || !isRecord(state.sections) || !isRecord(state.sections.tokenStats)) return null;
  return parseHubSnapshot(state.sections.tokenStats.data);
}

export function parseHubSnapshot(value: unknown): UsageHubSnapshot | null {
  if (!isRecord(value) || typeof value.hubId !== 'string' || !Number.isFinite(value.generation)) return null;
  if (!isScanStatus(value.status) || !Array.isArray(value.providers)) return null;
  const providers: UsageProviderSnapshot[] = [];
  for (const rawProvider of value.providers) {
    const provider = parseProvider(rawProvider);
    if (!provider) return null;
    providers.push(provider);
  }
  return {
    hubId: value.hubId,
    generation: Number(value.generation),
    status: value.status,
    startedAt: optionalString(value.startedAt),
    updatedAt: optionalString(value.updatedAt),
    nextScanAt: optionalString(value.nextScanAt),
    message: optionalString(value.message),
    providers,
  };
}

function parseProvider(value: unknown): UsageProviderSnapshot | null {
  if (!isRecord(value) || !isProviderId(value.id) || typeof value.name !== 'string' || !isProviderStatus(value.status) || !Array.isArray(value.accounts)) return null;
  const accounts: UsageAccount[] = [];
  for (const rawAccount of value.accounts) {
    if (!isRecord(rawAccount) || typeof rawAccount.localId !== 'string' || !isRecord(rawAccount.identity) || !isProviderStatus(rawAccount.status) || !Array.isArray(rawAccount.limits)) return null;
    const limits = rawAccount.limits.map(rawLimit => {
      if (!isRecord(rawLimit) || typeof rawLimit.id !== 'string' || typeof rawLimit.label !== 'string' || typeof rawLimit.remainingPercent !== 'number') return null;
      const windowKind: UsageLimit['windowKind'] = rawLimit.windowKind === 'fixed' || rawLimit.windowKind === 'calendarMonth'
        ? rawLimit.windowKind
        : undefined;
      const windowDurationMins = typeof rawLimit.windowDurationMins === 'number'
        && Number.isFinite(rawLimit.windowDurationMins)
        && rawLimit.windowDurationMins > 0
        ? rawLimit.windowDurationMins
        : undefined;
      return {
        id: rawLimit.id,
        label: rawLimit.label,
        remainingPercent: rawLimit.remainingPercent,
        windowKind,
        windowDurationMins,
        resetsAt: optionalString(rawLimit.resetsAt),
      };
    });
    if (limits.some(limit => limit === null)) return null;
    accounts.push({
      localId: rawAccount.localId,
      identity: {kind: optionalString(rawAccount.identity.kind), value: optionalString(rawAccount.identity.value), label: optionalString(rawAccount.identity.label)},
      status: rawAccount.status,
      plan: optionalString(rawAccount.plan),
      message: optionalString(rawAccount.message),
      limits: limits.filter(limit => limit !== null),
      balance: isRecord(rawAccount.balance) && typeof rawAccount.balance.isAvailable === 'boolean' && Array.isArray(rawAccount.balance.items)
        ? {isAvailable: rawAccount.balance.isAvailable, items: rawAccount.balance.items.filter(isRecord).map(item => ({currency: optionalString(item.currency) ?? '', total: optionalString(item.total) ?? '', granted: optionalString(item.granted), toppedUp: optionalString(item.toppedUp)}))}
        : undefined,
      resetCredits: parseResetCredits(rawAccount.resetCredits),
    });
  }
  return {id: value.id, name: value.name, status: value.status, message: optionalString(value.message), accounts};
}

function parseResetCredits(value: unknown): UsageResetCredits | undefined {
  if (!isRecord(value) || typeof value.availableCount !== 'number') return undefined;
  const credits = Array.isArray(value.credits)
    ? value.credits
        .filter(isRecord)
        .map(credit => ({id: optionalString(credit.id), expiresAt: optionalString(credit.expiresAt)}))
        .filter(credit => credit.expiresAt)
    : undefined;
  return {availableCount: value.availableCount, credits: credits && credits.length ? credits : undefined};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isProviderId(value: unknown): value is UsageProviderId {
  return typeof value === 'string' && providerOrder.includes(value as UsageProviderId);
}

function isProviderStatus(value: unknown): value is UsageProviderStatus {
  return value === 'ok' || value === 'unavailable' || value === 'error';
}

function isScanStatus(value: unknown): value is UsageHubSnapshot['status'] {
  return value === 'idle' || value === 'scanning' || value === 'ready' || value === 'error';
}

function isOlderSnapshot(existing: UsageHubSnapshot, incoming: UsageHubSnapshot): boolean {
  const existingAt = parseSnapshotTime(existing.updatedAt);
  const incomingAt = parseSnapshotTime(incoming.updatedAt);
  if (existingAt === null || incomingAt === null) return false;
  return incomingAt < existingAt;
}

function parseSnapshotTime(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNewerSnapshotTime(incoming?: string, existing?: string): boolean {
  const incomingAt = parseSnapshotTime(incoming);
  if (incomingAt === null) return false;
  const existingAt = parseSnapshotTime(existing);
  return existingAt === null || incomingAt > existingAt;
}

function mergeAccountSources(
  existing: UsageAccountSource[],
  incoming: UsageAccountSource,
): UsageAccountSource[] {
  const sources = new Map<string, UsageAccountSource>();
  for (const source of [...existing, incoming]) {
    const key = `${source.hubId}\u0000${source.accountLocalId}`;
    const current = sources.get(key);
    if (!current || isNewerSnapshotTime(source.updatedAt, current.updatedAt)) {
      sources.set(key, source);
    }
  }
  return Array.from(sources.values()).sort((left, right) =>
    left.hubId.localeCompare(right.hubId) || left.accountLocalId.localeCompare(right.accountLocalId));
}
