const PWA_CACHE_PREFIX = 'wheelmaker-web-pwa-';

type ServiceWorkerRegistrationLike = {
  unregister?: () => Promise<boolean> | boolean;
};

type ServiceWorkerContainerLike = {
  getRegistrations?: () => Promise<readonly ServiceWorkerRegistrationLike[]>;
};

type CacheStorageLike = {
  keys?: () => Promise<string[]>;
  delete?: (key: string) => Promise<boolean> | boolean;
};

function defaultServiceWorker(): ServiceWorkerContainerLike | undefined {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return undefined;
  }
  return navigator.serviceWorker as unknown as ServiceWorkerContainerLike;
}

function defaultCaches(): CacheStorageLike | undefined {
  if (typeof caches === 'undefined') {
    return undefined;
  }
  return caches as CacheStorageLike;
}

async function unregisterNativeServiceWorkers(
  serviceWorker: ServiceWorkerContainerLike | undefined,
): Promise<void> {
  if (!serviceWorker?.getRegistrations) {
    return;
  }
  try {
    const registrations = await serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => {
      try {
        return Promise.resolve(registration.unregister?.()).catch(() => undefined);
      } catch {
        return Promise.resolve(undefined);
      }
    }));
  } catch {
    // Native WebView startup should not depend on browser PWA cleanup.
  }
}

async function deleteNativePWACaches(cacheStorage: CacheStorageLike | undefined): Promise<void> {
  if (!cacheStorage?.keys || !cacheStorage.delete) {
    return;
  }
  try {
    const keys = await cacheStorage.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(PWA_CACHE_PREFIX))
      .map(key => {
        try {
          return Promise.resolve(cacheStorage.delete?.(key)).catch(() => undefined);
        } catch {
          return Promise.resolve(undefined);
        }
      }));
  } catch {
    // Cache cleanup is best effort because native can always load through StableOrigin.
  }
}

export async function cleanupNativeWebViewPWA(options?: {
  serviceWorker?: ServiceWorkerContainerLike;
  caches?: CacheStorageLike;
}): Promise<void> {
  await Promise.all([
    unregisterNativeServiceWorkers(options?.serviceWorker ?? defaultServiceWorker()),
    deleteNativePWACaches(options?.caches ?? defaultCaches()),
  ]);
}
