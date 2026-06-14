import {buildWorkspaceDatabaseStorageStats} from '../web/src/workspace/WorkspacePersistence';

const jsonBytes = (value: unknown): number => new Blob([JSON.stringify(value)]).size;

describe('workspace database storage stats', () => {
  test('summarizes browser quota and approximate per-store JSON sizes', () => {
    const globalRows = [{k: 'themeMode', v: '"dark"', updatedAt: 1}];
    const chatRows = [{k: 'chat:1', turnsJson: JSON.stringify([{content: 'hello world'}]), updatedAt: 2}];
    const fileRows = [{k: 'file:1', hash: 'abc', v: 'cached-file-content', updatedAt: 3}];

    const stats = buildWorkspaceDatabaseStorageStats(
      {
        wm_global_kv: globalRows,
        wm_chat_session_content: chatRows,
        wm_file_cache: fileRows,
      },
      {
        usage: 4096,
        quota: 8192,
        usageDetails: {
          indexedDB: 3072,
          caches: 1024,
        },
      },
      true,
    );

    expect(stats.usageBytes).toBe(4096);
    expect(stats.quotaBytes).toBe(8192);
    expect(stats.persisted).toBe(true);
    expect(stats.usageDetails).toEqual({indexedDB: 3072, caches: 1024});
    expect(stats.totalApproximateStoreBytes).toBe(
      jsonBytes(globalRows) + jsonBytes(chatRows) + jsonBytes(fileRows),
    );
    expect(stats.stores.map(store => store.approximateBytes)).toEqual(
      [...stats.stores.map(store => store.approximateBytes)].sort((left, right) => right - left),
    );
    expect(stats.stores.map(store => store.store)).toEqual(
      expect.arrayContaining(['wm_file_cache', 'wm_chat_session_content', 'wm_global_kv']),
    );
    expect(stats.stores.find(store => store.store === 'wm_chat_session_content')).toMatchObject({
      rows: 1,
      approximateBytes: jsonBytes(chatRows),
    });
  });
});
