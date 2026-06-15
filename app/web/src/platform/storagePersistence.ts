export type BrowserStoragePersistenceRequestResult =
  | 'already-persisted'
  | 'granted'
  | 'denied'
  | 'unavailable';

type BrowserStoragePersistenceManager = {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
};

type BrowserStoragePersistenceNavigator = {
  storage?: BrowserStoragePersistenceManager;
};

export async function requestPersistentBrowserStorage(
  navigatorLike: BrowserStoragePersistenceNavigator | undefined = globalThis.navigator,
): Promise<BrowserStoragePersistenceRequestResult> {
  const storage = navigatorLike?.storage;
  if (!storage?.persist) {
    return 'unavailable';
  }
  try {
    if (storage.persisted && await storage.persisted()) {
      return 'already-persisted';
    }
    return await storage.persist() ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export function requestPersistentBrowserStorageOnStartup(
  navigatorLike?: BrowserStoragePersistenceNavigator,
): void {
  requestPersistentBrowserStorage(navigatorLike).catch(() => undefined);
}
