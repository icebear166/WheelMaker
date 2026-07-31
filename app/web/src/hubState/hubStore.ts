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
  private readonly discoveries = new Map<string, Promise<void>>();

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
        sections[name] = {...section};
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
    return value ? {...value} as RegistryHubStateSection<T> : undefined;
  }

  async discover(hubIds: string[]): Promise<void> {
    if (!this.options.get) {
      return;
    }
    await Promise.all([...new Set(hubIds)].map(async hubId => {
      if (this.hubs.has(hubId)) {
        return;
      }
      const existing = this.discoveries.get(hubId);
      if (existing) {
        return existing;
      }
      const discovery = this.options.get!(hubId)
        .then(state => this.replace(state))
        .finally(() => this.discoveries.delete(hubId));
      this.discoveries.set(hubId, discovery);
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
}

function cloneHubState(state: RegistryHubState): RegistryHubState {
  return {
    ...state,
    sections: Object.fromEntries(
      Object.entries(state.sections).map(([name, section]) => [name, {...section}]),
    ),
  };
}
