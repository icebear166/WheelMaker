import {
  normalizeModelEfficiencyPayload,
  readModelEfficiencyUpdatedAt,
} from './modelEfficiencyModel';
import type {ModelEfficiencySnapshot} from './modelEfficiencyTypes';

export const CODEX_RADAR_EFFICIENCY_URL = 'https://codexradar.com/data/intelligence-efficiency.json';
export const MODEL_EFFICIENCY_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export type ModelEfficiencyLoader = () => Promise<unknown>;

const defaultLoader: ModelEfficiencyLoader = async () => {
  const response = await fetch(CODEX_RADAR_EFFICIENCY_URL, {cache: 'no-store'});
  if (!response.ok) {
    throw new Error(`CodexRadar request failed (${response.status}).`);
  }
  return response.json();
};

export class ModelEfficiencyStore {
  private current: ModelEfficiencySnapshot = {
    status: 'idle',
    refreshing: false,
    items: [],
  };

  private readonly listeners = new Set<(snapshot: ModelEfficiencySnapshot) => void>();
  private inFlight: Promise<void> | null = null;

  constructor(private readonly loader: ModelEfficiencyLoader = defaultLoader) {}

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
      const payload = await this.loader();
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
