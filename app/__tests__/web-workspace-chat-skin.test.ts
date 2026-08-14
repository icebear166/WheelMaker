import {WorkspacePersistenceRepository} from '../web/src/workspace/WorkspacePersistence';

type DatabaseMutation = {
  storeName: string;
  clear?: boolean;
  puts?: unknown[];
  deletes?: unknown[];
};

function cloneValue(value: unknown): unknown {
  if (value instanceof Blob) {
    return value.slice(0, value.size, value.type);
  }
  if (Array.isArray(value)) {
    return value.map(item => cloneValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
    );
  }
  return value;
}

function clone<T>(value: T): T {
  return cloneValue(value) as T;
}

class MemoryWorkspaceDatabase {
  private readonly stores = new Map<string, unknown[]>();
  private readonly mutationLog: DatabaseMutation[][] = [];
  private readonly mutationFailures: unknown[] = [];

  constructor(seed: Record<string, unknown[]> = {}) {
    for (const [storeName, rows] of Object.entries(seed)) {
      this.stores.set(storeName, clone(rows));
    }
  }

  async getAllRows<T>(storeName: string): Promise<T[]> {
    return clone((this.stores.get(storeName) ?? []) as T[]);
  }

  async mutateStores(mutations: DatabaseMutation[]): Promise<void> {
    const failure = this.mutationFailures.shift();
    if (failure) throw failure;

    const nextStores = new Map(
      [...this.stores.entries()].map(([storeName, rows]) => [storeName, clone(rows)]),
    );
    for (const mutation of mutations) {
      const rows = mutation.clear ? [] : [...(nextStores.get(mutation.storeName) ?? [])];
      const deleteKeys = new Set(mutation.deletes ?? []);
      const retained = rows.filter(row => !deleteKeys.has(this.rowKey(row)));
      for (const put of mutation.puts ?? []) {
        const key = this.rowKey(put);
        const existingIndex = retained.findIndex(row => this.rowKey(row) === key);
        if (existingIndex >= 0) {
          retained[existingIndex] = clone(put);
        } else {
          retained.push(clone(put));
        }
      }
      nextStores.set(mutation.storeName, retained);
    }
    this.stores.clear();
    for (const [storeName, rows] of nextStores.entries()) {
      this.stores.set(storeName, rows);
    }
    this.mutationLog.push(clone(mutations));
  }

  async putRow(storeName: string, row: unknown): Promise<void> {
    await this.mutateStores([{storeName, puts: [row]}]);
  }

  async deleteRow(storeName: string, key: unknown): Promise<void> {
    await this.mutateStores([{storeName, deletes: [key]}]);
  }

  async clearStores(storeNames: string[]): Promise<void> {
    await this.mutateStores(storeNames.map(storeName => ({storeName, clear: true})));
  }

  async resetDatabase(): Promise<void> {
    this.stores.clear();
    this.mutationLog.push([{storeName: '*', clear: true}]);
  }

  rows<T>(storeName: string): T[] {
    return clone((this.stores.get(storeName) ?? []) as T[]);
  }

  failNextMutation(error: unknown): void {
    this.mutationFailures.push(error);
  }

  clearedStores(): string[] {
    return this.mutationLog
      .flat()
      .filter(mutation => mutation.clear)
      .map(mutation => mutation.storeName);
  }

  private rowKey(row: unknown): unknown {
    if (!row || typeof row !== 'object') return undefined;
    const record = row as Record<string, unknown>;
    return record.k ?? record.projectId;
  }
}

function dbWithTheme(themeMode: 'dark' | 'light' = 'light'): MemoryWorkspaceDatabase {
  return new MemoryWorkspaceDatabase({
    wm_global_kv: [
      {k: 'themeMode', v: JSON.stringify(themeMode), updatedAt: Date.now()},
    ],
  });
}

function dbWithAsset(asset: {blob: Blob; name: string; mimeType: string}): MemoryWorkspaceDatabase {
  return new MemoryWorkspaceDatabase({
    wm_global_kv: [
      {k: 'themeMode', v: JSON.stringify('light'), updatedAt: Date.now()},
    ],
    wm_global_assets: [
      {k: 'chatSkin', ...asset, updatedAt: Date.now()},
    ],
  });
}

describe('workspace chat skin persistence', () => {
  test('stores and restores the chat skin Blob separately from global settings', async () => {
    const db = dbWithTheme();
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();
    const blob = new Blob(['skin'], {type: 'image/png'});

    await repository.saveChatSkinAsset({blob, name: 'skin.png', mimeType: 'image/png'});

    await expect(repository.getChatSkinAsset()).resolves.toMatchObject({
      name: 'skin.png',
      mimeType: 'image/png',
      blob,
    });
    expect(repository.getGlobalState()).not.toHaveProperty('chatSkin');
    expect(db.rows('wm_global_assets')).toHaveLength(1);
  });

  test('persists the chat skin scale and opacity as global preferences', async () => {
    const db = dbWithTheme();
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();

    repository.patchGlobalState({chatSkinScale: 0, chatSkinOpacity: 0.42});
    await repository.flushPendingWrites();

    expect(repository.getGlobalState()).toMatchObject({
      chatSkinScale: 0,
      chatSkinOpacity: 0.42,
    });
    expect(db.rows('wm_global_kv')).toEqual(expect.arrayContaining([
      expect.objectContaining({k: 'chatSkinScale', v: JSON.stringify(0)}),
      expect.objectContaining({k: 'chatSkinOpacity', v: JSON.stringify(0.42)}),
    ]));
  });

  test('deletes only the chat skin asset and preserves global settings', async () => {
    const db = dbWithTheme('light');
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();
    await repository.saveChatSkinAsset({blob: new Blob(['skin']), name: 'skin', mimeType: ''});

    await repository.deleteChatSkinAsset();

    await expect(repository.getChatSkinAsset()).resolves.toBeNull();
    expect(repository.getGlobalState().themeMode).toBe('light');
  });

  test('reports a skin quota failure without clearing caches or changing the active asset', async () => {
    const oldAsset = {blob: new Blob(['old']), name: 'old.png', mimeType: 'image/png'};
    const db = dbWithAsset(oldAsset);
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();
    db.failNextMutation(new DOMException('quota', 'QuotaExceededError'));

    await expect(repository.saveChatSkinAsset({
      blob: new Blob(['new']),
      name: 'new.png',
      mimeType: 'image/png',
    })).rejects.toThrow();
    await expect(repository.getChatSkinAsset()).resolves.toMatchObject({name: 'old.png'});
    expect(db.clearedStores()).not.toContain('wm_chat_session_content');
  });

  test('exposes asset metadata without serializing the Blob and removes it on reset', async () => {
    const db = dbWithTheme();
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();
    await repository.saveChatSkinAsset({
      blob: new Blob(['skin'], {type: 'image/png'}),
      name: 'skin.png',
      mimeType: 'image/png',
    });

    const dump = await repository.dumpDatabase();
    expect(dump.globalAssets).toEqual([
      expect.objectContaining({k: 'chatSkin', name: 'skin.png', mimeType: 'image/png', size: 4}),
    ]);
    expect(dump.globalAssets[0]).not.toHaveProperty('blob');
    expect(JSON.stringify(dump.globalAssets)).not.toContain('"blob"');

    await repository.resetDatabase();

    await expect(repository.getChatSkinAsset()).resolves.toBeNull();
    expect(db.rows('wm_global_assets')).toHaveLength(0);
  });
});
