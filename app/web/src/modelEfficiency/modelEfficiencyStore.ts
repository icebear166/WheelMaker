import {
  normalizeModelEfficiencyPayload,
  readModelEfficiencyUpdatedAt,
} from './modelEfficiencyModel';
import type {ModelEfficiencySnapshot} from './modelEfficiencyTypes';

export const CODEX_RADAR_CURRENT_URL = 'https://codexradar.com/current.json';

export type ModelEfficiencyFetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type ModelEfficiencyFetcher = (
  url: string,
) => Promise<ModelEfficiencyFetchResponse>;

const defaultFetcher: ModelEfficiencyFetcher = async (url) => fetch(url);

export class ModelEfficiencyStore {
  private current: ModelEfficiencySnapshot = {
    status: 'idle',
    refreshing: false,
    items: [],
  };

  private readonly listeners = new Set<(snapshot: ModelEfficiencySnapshot) => void>();
  private inFlight: Promise<void> | null = null;

  constructor(private readonly fetcher: ModelEfficiencyFetcher = defaultFetcher) {}

  snapshot(): ModelEfficiencySnapshot {
    return this.current;
  }

  subscribe(listener: (snapshot: ModelEfficiencySnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;

    this.current = {
      ...this.current,
      status: this.current.items.length > 0 ? 'ready' : 'loading',
      refreshing: true,
      error: undefined,
    };
    this.emit();

    this.inFlight = this.load().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async load(): Promise<void> {
    try {
      const response = await this.fetcher(CODEX_RADAR_CURRENT_URL);
      if (!response.ok) {
        throw new Error(`CodexRadar request failed (${response.status}).`);
      }
      const payload = await response.json();
      const updatedAt = readModelEfficiencyUpdatedAt(payload);
      this.current = {
        status: 'ready',
        refreshing: false,
        items: normalizeModelEfficiencyPayload(payload),
        ...(updatedAt ? {updatedAt} : {}),
      };
    } catch (error) {
      this.current = {
        status: this.current.items.length > 0 ? 'ready' : 'error',
        refreshing: false,
        items: this.current.items,
        ...(this.current.updatedAt ? {updatedAt: this.current.updatedAt} : {}),
        error: error instanceof Error && error.message
          ? error.message
          : 'Unable to refresh CodexRadar data.',
      };
    }
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.current);
  }
}
