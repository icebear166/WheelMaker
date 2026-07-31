import {RegistryMethods} from '../registry/registryMethods';
import type {
  RegistryEnvelope,
  RegistryHubState,
  RegistryHubStateRefreshResponse,
  RegistryHubStateSection,
  RegistryHubStateSectionName,
} from '../registry/registryTypes';

export interface HubStoreSnapshot {
  hubs: Record<string, RegistryHubState>;
}

export interface HubStoreOptions {
  get?: (hubId: string) => Promise<RegistryHubState>;
  refresh?: (
    hubId: string,
    sections: RegistryHubStateSectionName[],
    force: boolean,
  ) => Promise<RegistryHubStateRefreshResponse>;
}

export class HubStore {
  private readonly hubs = new Map<string, RegistryHubState>();
  private readonly listeners = new Set<(snapshot: HubStoreSnapshot) => void>();
  private readonly refreshes = new Map<string, Promise<RegistryHubStateRefreshResponse>>();
  private readonly discoveries = new Map<string, {generation: number; promise: Promise<void>}>();
  private readonly discoveryGenerations = new Map<string, number>();
  private desiredHubs = new Set<string>();

  constructor(private readonly options: HubStoreOptions = {}) {}

  replace(state: RegistryHubState): void {
    this.hubs.set(state.hubId, cloneHubState(state));
    this.emit();
  }

  ingest(event: RegistryEnvelope): void {
    if (
      event.type !== 'event'
      || event.method !== RegistryMethods.HubStateUpdated
      || !event.hubId
      || !event.payload
      || typeof event.payload !== 'object'
      || Array.isArray(event.payload)
    ) {
      return;
    }
    const payload = event.payload as {
      instanceId?: unknown;
      sections?: unknown;
    };
    if (
      typeof payload.instanceId !== 'string'
      || !payload.sections
      || typeof payload.sections !== 'object'
      || Array.isArray(payload.sections)
    ) {
      return;
    }
    const incoming: RegistryHubState = {
      hubId: event.hubId,
      instanceId: payload.instanceId,
      sections: payload.sections as RegistryHubState['sections'],
    };
    const current = this.hubs.get(event.hubId);
    if (!current || current.instanceId !== incoming.instanceId) {
      this.replace(incoming);
      return;
    }
    let changed = false;
    const sections = {...current.sections};
    for (const [name, section] of Object.entries(incoming.sections)) {
      const previous = sections[name];
      if (!previous || section.revision > previous.revision) {
        sections[name] = cloneHubStateSection(section);
        changed = true;
      }
    }
    if (changed) {
      this.hubs.set(event.hubId, {...current, sections});
      this.emit();
    }
  }

  getHub(hubId: string): RegistryHubState | undefined {
    const state = this.hubs.get(hubId);
    return state ? cloneHubState(state) : undefined;
  }

  getSection<T>(
    hubId: string,
    section: RegistryHubStateSectionName,
  ): RegistryHubStateSection<T> | undefined {
    const value = this.hubs.get(hubId)?.sections[section];
    return value ? cloneHubStateSection(value) as RegistryHubStateSection<T> : undefined;
  }

  async discover(hubIds: string[]): Promise<void> {
    const normalizedHubIds = [...new Set(hubIds)];
    const nextDesiredHubs = new Set(normalizedHubIds);
    for (const hubId of new Set([...this.desiredHubs, ...nextDesiredHubs])) {
      if (this.desiredHubs.has(hubId) !== nextDesiredHubs.has(hubId)) {
        this.discoveryGenerations.set(hubId, (this.discoveryGenerations.get(hubId) ?? 0) + 1);
      }
    }
    this.desiredHubs = nextDesiredHubs;
    this.retainHubs(normalizedHubIds);
    if (!this.options.get) {
      return;
    }
    await Promise.all(normalizedHubIds.map(async hubId => {
      const generation = this.discoveryGenerations.get(hubId) ?? 0;
      const existing = this.discoveries.get(hubId);
      if (existing?.generation === generation) {
        return existing.promise;
      }
      let request: Promise<RegistryHubState>;
      try {
        request = this.options.get!(hubId);
      } catch (error) {
        request = Promise.reject(error);
      }
      let discovery: Promise<void>;
      discovery = request
        .then(state => {
          if (
            this.desiredHubs.has(hubId)
            && this.discoveryGenerations.get(hubId) === generation
          ) {
            this.replace(state);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (this.discoveries.get(hubId)?.promise === discovery) {
            this.discoveries.delete(hubId);
          }
        });
      this.discoveries.set(hubId, {generation, promise: discovery});
      return discovery;
    }));
  }

  refresh(
    hubId: string,
    sections: RegistryHubStateSectionName[],
    force = false,
  ): Promise<RegistryHubStateRefreshResponse> {
    if (!this.options.refresh) {
      return Promise.reject(new Error('hub state refresh is unavailable'));
    }
    const normalized = [...new Set(sections)].sort();
    const key = `${hubId}\u0000${normalized.join(',')}\u0000${force ? '1' : '0'}`;
    const existing = this.refreshes.get(key);
    if (existing) {
      return existing;
    }
    const request = this.options.refresh(hubId, normalized, force)
      .then(response => {
        if (response.state) {
          this.mergeRefreshState(response.state);
        }
        return response;
      })
      .finally(() => this.refreshes.delete(key));
    this.refreshes.set(key, request);
    return request;
  }

  subscribe(listener: (snapshot: HubStoreSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private mergeRefreshState(state: RegistryHubState): void {
    const current = this.hubs.get(state.hubId);
    if (!current || current.instanceId !== state.instanceId) {
      this.replace(state);
      return;
    }
    this.ingest({
      type: 'event',
      method: RegistryMethods.HubStateUpdated,
      hubId: state.hubId,
      payload: {instanceId: state.instanceId, sections: state.sections},
    });
  }

  private snapshot(): HubStoreSnapshot {
    return {
      hubs: Object.fromEntries([...this.hubs].map(([hubId, state]) => [hubId, cloneHubState(state)])),
    };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private retainHubs(hubIds: string[]): void {
    const retained = new Set(hubIds);
    let changed = false;
    for (const hubId of this.hubs.keys()) {
      if (!retained.has(hubId)) {
        this.hubs.delete(hubId);
        changed = true;
      }
    }
    if (changed) this.emit();
  }
}

function cloneHubState(state: RegistryHubState): RegistryHubState {
  return {
    ...state,
    sections: Object.fromEntries(
      Object.entries(state.sections).map(([name, section]) => [name, cloneHubStateSection(section)]),
    ),
  };
}

function cloneHubStateSection(section: RegistryHubStateSection): RegistryHubStateSection {
  return {
    ...section,
    data: cloneHubStateValue(section.data),
  };
}

function cloneHubStateValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => cloneHubStateValue(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneHubStateValue(item)]),
    ) as T;
  }
  return value;
}
