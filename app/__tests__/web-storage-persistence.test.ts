import {
  requestPersistentBrowserStorage,
  requestPersistentBrowserStorageOnStartup,
} from '../web/src/platform/storagePersistence';

describe('browser storage persistence', () => {
  test('does not request persistence when storage is already persisted', async () => {
    const persist = jest.fn<Promise<boolean>, []>().mockResolvedValue(true);
    const result = await requestPersistentBrowserStorage({
      storage: {
        persisted: jest.fn<Promise<boolean>, []>().mockResolvedValue(true),
        persist,
      },
    });

    expect(result).toBe('already-persisted');
    expect(persist).not.toHaveBeenCalled();
  });

  test('requests persistence when available and startup wrapper does not throw', async () => {
    const persist = jest.fn<Promise<boolean>, []>().mockResolvedValue(true);

    await expect(requestPersistentBrowserStorage({
      storage: {
        persisted: jest.fn<Promise<boolean>, []>().mockResolvedValue(false),
        persist,
      },
    })).resolves.toBe('granted');
    expect(persist).toHaveBeenCalledTimes(1);

    expect(() => requestPersistentBrowserStorageOnStartup({
      storage: {
        persisted: jest.fn<Promise<boolean>, []>().mockRejectedValue(new Error('blocked')),
        persist: jest.fn<Promise<boolean>, []>().mockRejectedValue(new Error('blocked')),
      },
    })).not.toThrow();
  });
});
