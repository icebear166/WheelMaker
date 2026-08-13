import fs from 'fs';
import path from 'path';
import {
  WorkspacePersistenceRepository,
  selectCacheEvictionKeys,
} from '../web/src/workspace/WorkspacePersistence';
import {WorkspaceStore} from '../web/src/workspace/WorkspaceStore';

type DatabaseMutation = {
  storeName: string;
  clear?: boolean;
  puts?: unknown[];
  deletes?: unknown[];
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class MemoryWorkspaceDatabase {
  private readonly stores = new Map<string, unknown[]>();
  private readonly mutationLog: DatabaseMutation[][] = [];
  private readonly mutationFailures: unknown[] = [];
  private readonly resetFailures: unknown[] = [];
  private readonly mutationWaiters = new Set<{count: number; resolve: () => void}>();

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
    for (const waiter of [...this.mutationWaiters]) {
      if (this.mutationLog.length < waiter.count) continue;
      this.mutationWaiters.delete(waiter);
      waiter.resolve();
    }
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
    const failure = this.resetFailures.shift();
    if (failure) throw failure;
    this.stores.clear();
    this.mutationLog.push([{storeName: '*', clear: true}]);
    for (const waiter of [...this.mutationWaiters]) {
      if (this.mutationLog.length < waiter.count) continue;
      this.mutationWaiters.delete(waiter);
      waiter.resolve();
    }
  }

  rows<T>(storeName: string): T[] {
    return clone((this.stores.get(storeName) ?? []) as T[]);
  }

  mutationsFor(storeName: string): DatabaseMutation[] {
    return this.mutationLog.flat().filter(mutation => mutation.storeName === storeName);
  }

  lastMutationStores(): string[] {
    return (this.mutationLog.at(-1) ?? []).map(mutation => mutation.storeName);
  }

  lastMutation(): DatabaseMutation[] {
    return clone(this.mutationLog.at(-1) ?? []);
  }

  resetMutationLog(): void {
    this.mutationLog.length = 0;
  }

  failNextMutation(error: unknown): void {
    this.mutationFailures.push(error);
  }

  failNextReset(error: unknown): void {
    this.resetFailures.push(error);
  }

  clearedStores(): string[] {
    return this.mutationLog
      .flat()
      .filter(mutation => mutation.clear)
      .map(mutation => mutation.storeName);
  }

  waitForMutations(count: number): Promise<void> {
    if (this.mutationLog.length >= count) return Promise.resolve();
    return new Promise(resolve => {
      this.mutationWaiters.add({count, resolve});
    });
  }

  private rowKey(row: unknown): unknown {
    if (!row || typeof row !== 'object') return undefined;
    const record = row as Record<string, unknown>;
    return record.k ?? record.projectId;
  }
}

function seedWithGlobalSettings(extra: Record<string, unknown[]> = {}): Record<string, unknown[]> {
  const now = Date.now();
  return {
    wm_global_kv: [
      {k: 'themeMode', v: JSON.stringify('light'), updatedAt: now},
    ],
    ...extra,
  };
}

function rowValue(rows: Array<{k: string; v: string}>, key: string): unknown {
  const row = rows.find(item => item.k === key);
  return row ? JSON.parse(row.v) : undefined;
}

describe('workspace persistence safety', () => {
  test('uses a shared 512 MiB chat content cache budget for every web client', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    expect(source).toContain('const CHAT_CONTENT_CACHE_MAX_BYTES = 512 * 1024 * 1024;');
  });

  test('deletes obsolete browser credential and server-settings rows at startup', async () => {
    const now = Date.now();
    const db = new MemoryWorkspaceDatabase({
      wm_global_kv: [
        {k: 'deepseekApiKey', v: JSON.stringify('old-deepseek'), updatedAt: now},
        {k: 'speechSettings', v: JSON.stringify({enabled: true, volcengineApiKey: 'old-asr'}), updatedAt: now},
        {k: 'ttsSettings', v: JSON.stringify({enabled: true, model: 'mimo-v2.5-tts', voice: 'Mia', apiKey: 'old-tts'}), updatedAt: now},
      ],
    });
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();

    expect(rowValue(db.rows('wm_global_kv'), 'deepseekApiKey')).toBeUndefined();
    expect(rowValue(db.rows('wm_global_kv'), 'speechSettings')).toBeUndefined();
    expect(rowValue(db.rows('wm_global_kv'), 'ttsSettings')).toBeUndefined();
  });

  test('deletes removed settings rows at startup without disabling the active file cache', async () => {
    const now = Date.now();
    const db = new MemoryWorkspaceDatabase({
      wm_global_kv: [
        {k: 'themeMode', v: JSON.stringify('light'), updatedAt: now},
        {k: 'messageViewerEnabled', v: JSON.stringify(true), updatedAt: now},
        {k: 'disableFileCache', v: JSON.stringify(true), updatedAt: now},
      ],
      wm_file_cache: [{k: 'fc:p1:dir:.', hash: 'hash', v: '[]', updatedAt: now}],
    });
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();

    const globalKeys = db.rows<Array<{k: string}>[number]>('wm_global_kv').map(row => row.k);
    expect(globalKeys).not.toContain('messageViewerEnabled');
    expect(globalKeys).not.toContain('disableFileCache');
    expect(repository.getCachedFile('p1', 'dir', '.')).toMatchObject({hash: 'hash', value: '[]'});
  });

  test('evicts expired entries first and then the least recently used entries', () => {
    const evicted = selectCacheEvictionKeys([
      {key: 'expired', updatedAt: 1, approximateBytes: 2},
      {key: 'old', updatedAt: 90, approximateBytes: 4},
      {key: 'new', updatedAt: 100, approximateBytes: 4},
    ], {
      now: 110,
      maxAgeMs: 100,
      maxEntries: 1,
      maxBytes: 5,
    });

    expect(evicted).toEqual(['expired', 'old']);
  });

  test('keeps the newest chat entry when it alone exceeds the soft byte budget', () => {
    const evicted = selectCacheEvictionKeys([
      {key: 'old-small', updatedAt: 90, approximateBytes: 4},
      {key: 'new-oversize', updatedAt: 100, approximateBytes: 12},
    ], {
      now: 110,
      maxAgeMs: 100,
      maxEntries: 250,
      maxBytes: 5,
      minEntries: 1,
    });

    expect(evicted).toEqual(['old-small']);
  });

  test('repairs stale chat cache after the one-time credential scrub', async () => {
    const now = Date.now();
    const db = new MemoryWorkspaceDatabase({
      wm_global_kv: [
        {k: 'themeMode', v: JSON.stringify('light'), updatedAt: now},
        {k: 'deepseekApiKey', v: JSON.stringify('secret-key'), updatedAt: now},
      ],
      wm_chat_session_index: [{
        k: 'cs:p1:s1',
        projectId: 'p1',
        sessionId: 's1',
        sessionJson: JSON.stringify({
          sessionId: 's1',
          title: 'Session',
          preview: '',
          updatedAt: new Date(now).toISOString(),
          messageCount: 1,
          latestTurnIndex: 1,
        }),
        cursorJson: JSON.stringify({turnIndex: 2}),
        updatedAt: now,
      }],
      wm_chat_session_content: [{
        k: 'cs:p1:s1',
        projectId: 'p1',
        sessionId: 's1',
        turnsJson: JSON.stringify([{turnIndex: 1, content: 'turn-1', finished: true}]),
        updatedAt: now,
      }],
    });
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();

    expect(repository.getGlobalState()).toMatchObject({
      themeMode: 'light',
    });
    expect(db.rows('wm_global_kv')).toEqual([
      {k: 'themeMode', v: JSON.stringify('light'), updatedAt: now},
    ]);
    expect(db.mutationsFor('wm_global_kv')).toHaveLength(1);
    expect(db.lastMutationStores()).toEqual([
      'wm_chat_session_index',
      'wm_chat_session_content',
    ]);
  });

  test('keeps loaded settings available when chat cache repair aborts', async () => {
    const now = Date.now();
    const db = new MemoryWorkspaceDatabase({
      wm_global_kv: [
        {k: 'themeMode', v: JSON.stringify('light'), updatedAt: now},
      ],
      wm_chat_session_index: [{
        k: 'cs:p1:s1',
        projectId: 'p1',
        sessionId: 's1',
        sessionJson: JSON.stringify({
          sessionId: 's1',
          title: 'Session',
          preview: '',
          updatedAt: new Date(now).toISOString(),
          messageCount: 1,
          latestTurnIndex: 1,
        }),
        cursorJson: JSON.stringify({turnIndex: 2}),
        updatedAt: now,
      }],
      wm_chat_session_content: [{
        k: 'cs:p1:s1',
        projectId: 'p1',
        sessionId: 's1',
        turnsJson: JSON.stringify([{turnIndex: 1, content: 'turn-1', finished: true}]),
        updatedAt: now,
      }],
    });
    db.failNextMutation(new DOMException('repair aborted', 'AbortError'));
    const repository = new WorkspacePersistenceRepository(db as never);
    const errors: Array<{operation: string}> = [];
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const unsubscribe = repository.subscribeStorageErrors(error => errors.push(error));

    await expect(repository.ready()).resolves.toBeUndefined();
    expect(repository.getGlobalState()).toMatchObject({
      themeMode: 'light',
    });
    expect(errors).toEqual([expect.objectContaining({operation: 'repair chat cache'})]);
    unsubscribe();
    consoleError.mockRestore();
  });

  test('persists only patched global keys in one mutation', async () => {
    const db = new MemoryWorkspaceDatabase(seedWithGlobalSettings());
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();
    db.resetMutationLog();

    repository.patchGlobalState({themeMode: 'dark', codeFontSize: 16});
    await repository.flushPendingWrites();

    const mutation = db.lastMutation();
    const puts = mutation[0]?.puts as Array<{k: string}> | undefined;
    expect(mutation).toHaveLength(1);
    expect(mutation[0]).toMatchObject({storeName: 'wm_global_kv'});
    expect((puts ?? []).map(row => row.k).sort()).toEqual([
      'codeFontSize',
      'themeMode',
    ]);
  });

  test('persists the explicit desktop session-panel pin preference', async () => {
    const db = new MemoryWorkspaceDatabase(seedWithGlobalSettings());
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();
    db.resetMutationLog();

    repository.patchGlobalState({sessionPanelPinned: true} as never);
    await repository.flushPendingWrites();

    expect(repository.getGlobalState()).toMatchObject({sessionPanelPinned: true});
    expect(rowValue(db.rows('wm_global_kv'), 'sessionPanelPinned')).toBe(true);
  });

  test('persists the chat column width preference', async () => {
    const db = new MemoryWorkspaceDatabase(seedWithGlobalSettings());
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();
    db.resetMutationLog();

    repository.patchGlobalState({chatColumnWidth: 1200} as never);
    await repository.flushPendingWrites();

    expect(repository.getGlobalState()).toMatchObject({chatColumnWidth: 1200});
    expect(rowValue(db.rows('wm_global_kv'), 'chatColumnWidth')).toBe(1200);
  });

  test('sanitizes shortcut overrides loaded from older or damaged client data', async () => {
    const now = Date.now();
    const db = new MemoryWorkspaceDatabase({
      wm_global_kv: [{
        k: 'keyboardShortcutOverrides',
        v: JSON.stringify({
          unknown: {primary: true, key: 'x'},
          toggleSessions: {primary: true, key: '9'},
          togglePreview: {primary: true, key: '9'},
          toggleTerminal: null,
          quickOpen: {primary: 'yes', key: 'q'},
        }),
        updatedAt: now,
      }],
    });
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();

    expect(repository.getGlobalState()).toMatchObject({
      keyboardShortcutOverrides: {
        toggleSessions: {primary: true, key: '9'},
        togglePreview: null,
        toggleTerminal: null,
      },
    });
  });

  test('persists shortcut overrides as one patched global key', async () => {
    const db = new MemoryWorkspaceDatabase(seedWithGlobalSettings());
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();
    db.resetMutationLog();

    repository.patchGlobalState({
      keyboardShortcutOverrides: {
        toggleSessions: null,
        toggleTerminal: {alt: true, key: 'F8'},
      },
    } as never);
    await repository.flushPendingWrites();

    expect(repository.getGlobalState()).toMatchObject({
      keyboardShortcutOverrides: {
        toggleSessions: null,
        toggleTerminal: {alt: true, key: 'F8'},
      },
    });
    expect(rowValue(db.rows('wm_global_kv'), 'keyboardShortcutOverrides')).toEqual({
      toggleSessions: null,
      toggleTerminal: {alt: true, key: 'F8'},
    });
    const puts = db.lastMutation()[0]?.puts as Array<{k: string}> | undefined;
    expect((puts ?? []).map(row => row.k)).toEqual(['keyboardShortcutOverrides']);
  });

  test('clears only rebuildable caches and retries a setting after quota failure', async () => {
    const db = new MemoryWorkspaceDatabase(seedWithGlobalSettings({
      wm_project_state: [{projectId: 'p1', stateJson: '{}', updatedAt: Date.now()}],
      wm_file_cache: [{k: 'fc:p1:file:a.txt', hash: 'hash', v: 'cached', updatedAt: Date.now()}],
    }));
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();
    db.resetMutationLog();
    db.failNextMutation(new DOMException('quota', 'QuotaExceededError'));

    repository.patchGlobalState({themeMode: 'dark'});
    await repository.flushPendingWrites();

    expect(rowValue(db.rows('wm_global_kv'), 'themeMode')).toBe('dark');
    expect(rowValue(db.rows('wm_global_kv'), 'deepseekApiKey')).toBeUndefined();
    expect(db.clearedStores()).toEqual(expect.arrayContaining([
      'wm_chat_session_index',
      'wm_chat_session_content',
      'wm_file_cache',
    ]));
    expect(db.clearedStores()).not.toContain('wm_global_kv');
    expect(db.clearedStores()).not.toContain('wm_project_state');
  });

  test('prunes expired caches without changing global selection settings', async () => {
    const now = Date.now();
    const db = new MemoryWorkspaceDatabase(seedWithGlobalSettings({
      wm_global_kv: [
        {k: 'themeMode', v: JSON.stringify('light'), updatedAt: now},
        {k: 'selectedChatProjectId', v: JSON.stringify('p1'), updatedAt: now},
        {k: 'selectedChatSessionId', v: JSON.stringify('s1'), updatedAt: now},
      ],
      wm_chat_session_index: [{
        k: 'cs:p1:s1',
        projectId: 'p1',
        sessionId: 's1',
        sessionJson: JSON.stringify({
          sessionId: 's1',
          title: 'Session',
          preview: '',
          updatedAt: new Date(now).toISOString(),
          messageCount: 1,
          latestTurnIndex: 1,
        }),
        cursorJson: JSON.stringify({turnIndex: 1}),
        updatedAt: now,
      }],
      wm_chat_session_content: [{
        k: 'cs:p1:s1',
        projectId: 'p1',
        sessionId: 's1',
        turnsJson: JSON.stringify([{turnIndex: 1, content: 'turn-1', finished: true}]),
        updatedAt: 1,
      }],
      wm_file_cache: [{k: 'fc:p1:file:a.txt', hash: 'hash', v: 'cached', updatedAt: 1}],
    }));

    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();

    expect(db.rows('wm_chat_session_content')).toEqual([]);
    expect(db.rows('wm_file_cache')).toEqual([]);
    const indexRows = db.rows<Array<{cursorJson: string}>[number]>('wm_chat_session_index');
    expect(JSON.parse(indexRows[0].cursorJson)).toEqual({turnIndex: 0});
    expect(repository.getGlobalState()).toMatchObject({
      selectedChatProjectId: 'p1',
      selectedChatSessionId: 's1',
    });
    expect(db.mutationsFor('wm_global_kv')).toEqual([]);
  });

  test('applies global LRU budgets after cache writes', async () => {
    const now = Date.now();
    const fileRows = Array.from({length: 1500}, (_, index) => ({
      k: `fc:p${index}:file:f${index}.txt`,
      hash: `h${index}`,
      v: `file-${index}`,
      updatedAt: now - 1500 + index,
    }));
    const chatIndexRows = Array.from({length: 251}, (_, index) => ({
      k: `cs:p-chat:s${index}`,
      projectId: 'p-chat',
      sessionId: `s${index}`,
      sessionJson: JSON.stringify({
        sessionId: `s${index}`,
        title: `Session ${index}`,
        preview: '',
        updatedAt: new Date(now).toISOString(),
        messageCount: 0,
        latestTurnIndex: 0,
      }),
      cursorJson: JSON.stringify({turnIndex: 0}),
      updatedAt: now - 251 + index,
    }));
    const chatContentRows = chatIndexRows.slice(0, 250).map((row, index) => ({
      k: row.k,
      projectId: row.projectId,
      sessionId: row.sessionId,
      turnsJson: '[]',
      updatedAt: now - 250 + index,
    }));
    const db = new MemoryWorkspaceDatabase(seedWithGlobalSettings({
      wm_chat_session_index: chatIndexRows,
      wm_chat_session_content: chatContentRows,
      wm_file_cache: fileRows,
    }));
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();
    db.resetMutationLog();

    repository.patchProjectChatSessionContent('p-chat', 's250', []);
    repository.putCachedFile('p-new', 'file', 'new.txt', 'new-hash', 'new-file');
    await db.waitForMutations(2);

    const chatKeys = db.rows<Array<{k: string}>[number]>('wm_chat_session_content').map(row => row.k);
    const fileKeys = db.rows<Array<{k: string}>[number]>('wm_file_cache').map(row => row.k);
    expect(chatKeys).toHaveLength(250);
    expect(chatKeys).not.toContain('cs:p-chat:s0');
    expect(chatKeys).toContain('cs:p-chat:s250');
    expect(fileKeys).toHaveLength(1500);
    expect(fileKeys).not.toContain('fc:p0:file:f0.txt');
    expect(fileKeys).toContain('fc:p-new:file:new.txt');
  });

  test('resetDatabase wipes every store and resets in-memory state', async () => {
    const now = Date.now();
    const db = new MemoryWorkspaceDatabase(seedWithGlobalSettings({
      wm_project_state: [{
        projectId: 'p1',
        stateJson: JSON.stringify({
          selectedChatSessionId: '',
        }),
        updatedAt: now,
      }],
      wm_chat_session_index: [{
        k: 'cs:p1:s1',
        projectId: 'p1',
        sessionId: 's1',
        sessionJson: JSON.stringify({sessionId: 's1', title: 'Session', preview: '', updatedAt: new Date(now).toISOString(), messageCount: 0}),
        cursorJson: JSON.stringify({turnIndex: 0}),
        updatedAt: now,
      }],
      wm_chat_session_content: [{k: 'cs:p1:s1', projectId: 'p1', sessionId: 's1', turnsJson: '[]', updatedAt: now}],
      wm_file_cache: [{k: 'fc:p1:file:a.txt', hash: 'hash', v: 'cached', updatedAt: now}],
    }));
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();
    db.resetMutationLog();

    await repository.resetDatabase();

    expect(repository.getGlobalState()).toMatchObject({
      themeMode: 'dark',
    });
    expect(repository.getProjectState('p1')).toMatchObject({
      selectedChatSessionId: '',
    });
    expect(db.rows('wm_global_kv')).toEqual([]);
    expect(db.rows('wm_project_state')).toEqual([]);
    expect(db.rows('wm_chat_session_index')).toEqual([]);
    expect(db.rows('wm_chat_session_content')).toEqual([]);
    expect(db.rows('wm_file_cache')).toEqual([]);
  });

  test('resetDatabase preserves in-memory state when deleting the database fails', async () => {
    const now = Date.now();
    const db = new MemoryWorkspaceDatabase(seedWithGlobalSettings({
      wm_file_cache: [{k: 'fc:p1:dir:.', hash: 'hash', v: '[]', updatedAt: now}],
    }));
    const repository = new WorkspacePersistenceRepository(db as never);
    await repository.ready();
    db.failNextReset(new Error('delete workspace db blocked'));

    await expect(repository.resetDatabase()).rejects.toThrow('delete workspace db blocked');

    expect(repository.getGlobalState()).toMatchObject({themeMode: 'light'});
    expect(repository.getCachedFile('p1', 'dir', '.')).toMatchObject({hash: 'hash', value: '[]'});
    expect(db.rows('wm_file_cache')).toHaveLength(1);
  });

  test('reports one quota error through the store and replays it to late subscribers', async () => {
    const db = new MemoryWorkspaceDatabase(seedWithGlobalSettings());
    const repository = new WorkspacePersistenceRepository(db as never);
    const store = new WorkspaceStore(repository);
    await repository.ready();
    const errors: Array<{quotaExceeded: boolean; operation: string}> = [];
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const unsubscribe = store.subscribeStorageErrors(error => errors.push(error));
    db.failNextMutation(new DOMException('quota', 'QuotaExceededError'));
    db.failNextMutation(new DOMException('cleanup aborted', 'AbortError'));

    store.rememberGlobalState({themeMode: 'dark'});
    await repository.flushPendingWrites();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      quotaExceeded: true,
      operation: 'save global settings after cache cleanup',
    });
    const lateErrors: typeof errors = [];
    const unsubscribeLate = store.subscribeStorageErrors(error => lateErrors.push(error));
    expect(lateErrors).toEqual(errors);
    const dump = await store.dumpDatabase();
    expect(dump.storageError).toMatchObject(errors[0]);
    unsubscribeLate();
    unsubscribe();
    consoleError.mockRestore();
  });

  test('subscribes the existing app toast to persistence errors', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(source).toContain('workspaceStore.subscribeStorageErrors(storageError => {');
    expect(source).toContain('Local storage is full. Cache was cleared, but settings could not be saved.');
    expect(source).toContain('Local settings could not be saved. Export the database from Settings for diagnostics.');
  });
});
