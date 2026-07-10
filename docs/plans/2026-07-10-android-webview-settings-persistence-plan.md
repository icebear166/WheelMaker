# Android WebView Settings Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent APK restarts, chat-cache repair, and browser storage pressure from resetting durable user settings while keeping rebuildable caches bounded.

**Architecture:** Replace destructive clear-then-reinsert persistence with atomic, store-scoped IndexedDB mutations. Durable global settings are written incrementally through a serialized queue; rebuildable caches use age/count/byte LRU limits and may be discarded on quota pressure without touching global or project settings. Persistence failures are retained as diagnostics and surfaced through the existing application toast.

**Tech Stack:** TypeScript, IndexedDB, React 19, Jest 30, Android WebView asset origin

---

### Task 1: Reproduce the startup data-loss path

**Files:**
- Create: `app/__tests__/web-workspace-persistence-safety.test.ts`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts:690-1145`

- [x] **Step 1: Write a failing repository-level regression test**

Create an in-memory `WorkspaceDatabaseAdapter` that seeds `wm_global_kv`, stale `wm_chat_session_index`, and `wm_chat_session_content` rows, records each mutation, and implements the same atomic mutation contract as IndexedDB. Instantiate the repository with that adapter and assert both the loaded settings and stored global rows remain unchanged:

```ts
test('repairs stale chat cache without rewriting global settings', async () => {
  const db = new MemoryWorkspaceDatabase({
    wm_global_kv: [
      {k: 'themeMode', v: JSON.stringify('light'), updatedAt: 1},
      {k: 'deepseekApiKey', v: JSON.stringify('secret-key'), updatedAt: 1},
    ],
    wm_chat_session_index: [staleChatIndexRow()],
    wm_chat_session_content: [staleChatContentRow()],
  });
  const before = db.rows('wm_global_kv');

  const repository = new WorkspacePersistenceRepository(db);
  await repository.ready();

  expect(repository.getGlobalState()).toMatchObject({
    themeMode: 'light',
    deepseekApiKey: 'secret-key',
  });
  expect(db.rows('wm_global_kv')).toEqual(before);
  expect(db.mutationsFor('wm_global_kv')).toEqual([]);
  expect(db.lastMutationStores()).toEqual([
    'wm_chat_session_index',
    'wm_chat_session_content',
  ]);
});
```

- [x] **Step 2: Run the focused test and observe RED**

Run: `npm test -- --runInBand __tests__/web-workspace-persistence-safety.test.ts` from `app/`

Expected: FAIL because `WorkspacePersistenceRepository` ignores the injected adapter and the current repair path calls `saveAllStateToDb()`, which clears `wm_global_kv`.

- [x] **Step 3: Add an atomic database mutation boundary**

Introduce and export the adapter contract, then implement it in `WorkspaceDatabase`:

```ts
export type WorkspaceDatabaseMutation = {
  storeName: string;
  clear?: boolean;
  puts?: unknown[];
  deletes?: IDBValidKey[];
};

export interface WorkspaceDatabaseAdapter {
  getAllRows<T>(storeName: string): Promise<T[]>;
  mutateStores(mutations: WorkspaceDatabaseMutation[]): Promise<void>;
  putRow(storeName: string, row: unknown): Promise<void>;
  deleteRow(storeName: string, key: IDBValidKey): Promise<void>;
  clearStores(storeNames: string[]): Promise<void>;
}

async mutateStores(mutations: WorkspaceDatabaseMutation[]): Promise<void> {
  const stores = Array.from(new Set(mutations.map(item => item.storeName)));
  await this.run(stores, 'readwrite', async tx => {
    for (const mutation of mutations) {
      const store = tx.objectStore(mutation.storeName);
      if (mutation.clear) await this.request(store.clear());
      for (const key of mutation.deletes ?? []) await this.request(store.delete(key));
      for (const row of mutation.puts ?? []) await this.request(store.put(row));
    }
  });
}
```

Make `putRow`, `deleteRow`, and `clearStores` delegate to this method and accept a default adapter in the repository constructor:

```ts
constructor(private readonly db: WorkspaceDatabaseAdapter = new WorkspaceDatabase()) {
  this.state = defaultWorkspaceState();
  this.readyPromise = this.initialize();
}
```

- [x] **Step 4: Replace full startup rewrite with chat-only repair**

Build chat index/content rows from the repaired in-memory maps and replace only those two stores in one mutation:

```ts
private async persistRepairedChatCache(): Promise<void> {
  const now = Date.now();
  await this.db.mutateStores([
    {storeName: TABLE_CHAT_SESSION_INDEX, clear: true, puts: this.chatIndexRows(now)},
    {storeName: TABLE_CHAT_SESSION_CONTENT, clear: true, puts: this.chatContentRows(now)},
  ]);
}
```

Change `initialize()` to call this method when `repairedChatCache` is true. Replace the empty-database `saveAllStateToDb()` call with an atomic initial seed that only puts default global rows and schema metadata; remove `saveAllStateToDb()` entirely.

- [x] **Step 5: Run the focused test and observe GREEN**

Run: `npm test -- --runInBand __tests__/web-workspace-persistence-safety.test.ts` from `app/`

Expected: PASS, with no mutation targeting `wm_global_kv` during chat repair.

### Task 2: Make global setting writes incremental and recover safely from quota pressure

**Files:**
- Modify: `app/__tests__/web-workspace-persistence-safety.test.ts`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts:1389-1436`
- Modify: `app/web/src/workspace/WorkspaceStore.ts:130-150,380-410`

- [x] **Step 1: Write failing tests for incremental settings and quota recovery**

Add tests that wait for the in-memory adapter's next mutation:

```ts
test('persists only patched global keys in one mutation', async () => {
  const db = new MemoryWorkspaceDatabase(seedWithGlobalSettings());
  const repository = new WorkspacePersistenceRepository(db);
  await repository.ready();
  db.resetMutationLog();

  repository.patchGlobalState({themeMode: 'dark', codeFontSize: 16});
  await db.nextMutation();

  expect(db.lastMutation()).toMatchObject([{storeName: 'wm_global_kv'}]);
  expect(db.lastMutation()[0].puts.map(row => row.k).sort()).toEqual([
    'codeFontSize',
    'themeMode',
  ]);
});

test('clears only rebuildable caches and retries a setting after quota failure', async () => {
  const db = new MemoryWorkspaceDatabase(seedWithGlobalSettingsAndCaches());
  const repository = new WorkspacePersistenceRepository(db);
  await repository.ready();
  db.failNextMutation(new DOMException('quota', 'QuotaExceededError'));

  repository.patchGlobalState({themeMode: 'dark'});
  await db.waitUntil(rowValue(db.rows('wm_global_kv'), 'themeMode') === 'dark');

  expect(rowValue(db.rows('wm_global_kv'), 'themeMode')).toBe('dark');
  expect(rowValue(db.rows('wm_global_kv'), 'deepseekApiKey')).toBe('secret-key');
  expect(db.clearedStores()).not.toContain('wm_global_kv');
  expect(db.clearedStores()).not.toContain('wm_project_state');
});
```

- [x] **Step 2: Run the focused tests and observe RED**

Run: `npm test -- --runInBand __tests__/web-workspace-persistence-safety.test.ts` from `app/`

Expected: FAIL because the current method writes every global key with separate transactions and has no quota recovery.

- [x] **Step 3: Implement serialized incremental global writes**

Create rows only for durable keys present in the patch, excluding the localStorage identity keys:

```ts
function globalRowsForPatch(
  patch: Partial<PersistedGlobalState>,
  state: PersistedGlobalState,
  updatedAt: number,
): RawKVRow[] {
  const storageKeys = GLOBAL_KEYS as Partial<Record<keyof PersistedGlobalState, string>>;
  const rows: RawKVRow[] = [];
  for (const key of Object.keys(patch) as Array<keyof PersistedGlobalState>) {
    const storageKey = storageKeys[key];
    if (!storageKey) continue;
    rows.push({k: storageKey, v: serialize(state[key]), updatedAt});
  }
  return rows;
}
```

Serialize mutations through `globalWriteQueue` and persist all rows from one patch in one `mutateStores()` call.

- [x] **Step 4: Add quota recovery that sacrifices caches, never settings**

Detect `QuotaExceededError`. Clear only `wm_project_commits`, `wm_chat_session_index`, `wm_chat_session_content`, `wm_diff_cache`, and `wm_file_cache`, update their in-memory mirrors, then retry the original global mutation once. If retry fails, record a `WorkspaceStorageError` containing operation, error name, message, quota flag, and timestamp.

Expose `subscribeStorageErrors(listener)` from the repository through `WorkspaceStore`; the subscription immediately receives an existing last error and returns an unsubscribe callback.

- [x] **Step 5: Run the focused tests and observe GREEN**

Run: `npm test -- --runInBand __tests__/web-workspace-persistence-safety.test.ts` from `app/`

Expected: PASS; each patch uses one global-store mutation and quota recovery never clears durable stores.

### Task 3: Bound rebuildable caches with age/count/byte LRU policy

**Files:**
- Modify: `app/__tests__/web-workspace-persistence-safety.test.ts`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts:198-230,960-1015,1240-1530`

- [x] **Step 1: Write a failing pure-policy test**

```ts
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
```

Add repository tests proving evicted file/diff rows are deleted and chat-content eviction resets the matching cached cursor to zero without touching its global selected-session setting.

- [x] **Step 2: Run the focused tests and observe RED**

Run: `npm test -- --runInBand __tests__/web-workspace-persistence-safety.test.ts` from `app/`

Expected: FAIL because cache eviction policy and global cache budgets do not exist.

- [x] **Step 3: Implement the shared LRU selector**

```ts
export function selectCacheEvictionKeys(
  entries: CacheBudgetEntry[],
  limits: CacheBudgetLimits,
): string[] {
  const expiredKeys = new Set(
    entries
      .filter(item => limits.now - item.updatedAt > limits.maxAgeMs)
      .map(item => item.key),
  );
  const survivors = entries.filter(item => !expiredKeys.has(item.key));
  const evicted = [...expiredKeys];
  let remainingCount = survivors.length;
  let bytes = survivors.reduce((sum, item) => sum + item.approximateBytes, 0);
  for (const item of [...survivors].sort((a, b) => a.updatedAt - b.updatedAt || a.key.localeCompare(b.key))) {
    if (remainingCount <= limits.maxEntries && bytes <= limits.maxBytes) break;
    evicted.push(item.key);
    remainingCount -= 1;
    bytes -= item.approximateBytes;
  }
  return evicted;
}
```

- [x] **Step 4: Apply explicit cache budgets**

Use a 30-day maximum age and these conservative caps:

```ts
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FILE_CACHE_MAX_ENTRIES = 1500;
const FILE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const DIFF_CACHE_MAX_ENTRIES = 600;
const DIFF_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const CHAT_CONTENT_CACHE_MAX_ENTRIES = 250;
const CHAT_CONTENT_CACHE_MAX_BYTES = 48 * 1024 * 1024;
const PROJECT_COMMITS_CACHE_MAX_ENTRIES = 40;
const PROJECT_COMMITS_CACHE_MAX_BYTES = 24 * 1024 * 1024;
```

Apply limits both during initialization and after each cache write. Persist puts, evictions, and cursor resets as one store-scoped mutation; a single entry larger than its entire budget is neither cached nor persisted.

- [x] **Step 5: Run the focused tests and observe GREEN**

Run: `npm test -- --runInBand __tests__/web-workspace-persistence-safety.test.ts` from `app/`

Expected: PASS with deterministic eviction order and no durable-store mutation.

### Task 4: Make “Clear Local Cache” preserve all user settings

**Files:**
- Modify: `app/__tests__/web-clear-local-cache-settings.test.ts`
- Modify: `app/__tests__/web-workspace-persistence-safety.test.ts`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts:1540-1580`
- Modify: `app/web/src/shell/AppDialogs.tsx`

- [x] **Step 1: Write failing behavior and source-policy assertions**

Seed non-default global and project settings plus cache rows, invoke `clearCachePreservingToken()`, wait for its mutation, and assert global/project rows and in-memory settings are unchanged. Update the existing dialog assertion to require `Settings and connection details will be preserved.` and assert the clear method block contains neither `TABLE_GLOBAL_KV`, `TABLE_PROJECT_STATE`, nor `defaultWorkspaceState()`.

- [x] **Step 2: Run both focused suites and observe RED**

Run: `npm test -- --runInBand __tests__/web-workspace-persistence-safety.test.ts __tests__/web-clear-local-cache-settings.test.ts` from `app/`

Expected: FAIL because the current explicit cache action resets global/project state.

- [x] **Step 3: Restrict the clear action to rebuildable stores**

Keep `this.state.global` and `this.state.projects` intact. Clear the project-commit, chat-index, chat-content, diff, and file maps and stores in one atomic mutation, then put `cacheClearedAt` metadata without clearing `wm_meta`.

- [x] **Step 4: Run both focused suites and observe GREEN**

Run: `npm test -- --runInBand __tests__/web-workspace-persistence-safety.test.ts __tests__/web-clear-local-cache-settings.test.ts` from `app/`

Expected: PASS; explicit cache clearing preserves all settings and connection identity.

### Task 5: Surface persistence failures and verify the APK path

**Files:**
- Modify: `app/__tests__/web-workspace-persistence-safety.test.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx:430-440,3221-3225,3930-3940`
- Modify: `app/web/src/workspace/WorkspaceStore.ts`

- [x] **Step 1: Add a failing error-subscription test**

Configure the in-memory database to fail both the original global mutation and the retry, subscribe through `WorkspaceStore`, patch a setting, and assert exactly one error with `quotaExceeded: true` reaches the subscriber and remains available to a later subscriber.

- [x] **Step 2: Run the focused test and observe RED**

Run: `npm test -- --runInBand __tests__/web-workspace-persistence-safety.test.ts` from `app/`

Expected: FAIL until repository error subscriptions and the store pass-through exist.

- [x] **Step 3: Subscribe the existing toast once**

Add a single effect next to the current toast timeout:

```tsx
useEffect(() => workspaceStore.subscribeStorageErrors(storageError => {
  setToastMessage(storageError.quotaExceeded
    ? 'Local storage is full. Cache was cleared, but settings could not be saved.'
    : 'Local settings could not be saved. Export the database from Settings for diagnostics.');
}), []);
```

This follows the existing module-level singleton and does not create duplicate global listeners or broad effect dependencies.

- [x] **Step 4: Run full fresh verification**

Run from `app/`:

```powershell
npm test -- --runInBand __tests__/web-workspace-persistence-safety.test.ts __tests__/web-workspace-persistence-reset-policy.test.ts __tests__/web-clear-local-cache-settings.test.ts __tests__/web-chat-selection-persistence.test.ts __tests__/web-workspace-database-storage-stats.test.ts
npm run tsc:web
npm run build:web
```

Run from `mobile/android/`:

```powershell
./gradlew testReleaseUnitTest
./gradlew assembleRelease
```

Expected: every command exits 0, the Jest summary reports no failed tests, TypeScript emits no errors, and the release APK assembles.

- [x] **Step 5: Review and publish**

Run `git diff --check`, inspect `git diff --stat` and `git status --short`, then follow the repository completion gate exactly: `git add -A`, commit with a message naming the non-destructive atomic persistence fix, and `git push origin main`.
