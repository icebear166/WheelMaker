import fs from 'fs';
import path from 'path';

describe('web disable file cache settings', () => {
  const projectRoot = path.join(__dirname, '..');

  test('persists disable file cache as a default-off global setting', () => {
    const workspacePersistence = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );
    const workspaceStore = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspaceStore.ts'),
      'utf8',
    );

    expect(workspacePersistence).toContain('disableFileCache: boolean;');
    expect(workspacePersistence).toContain("disableFileCache: 'disableFileCache',");
    expect(workspacePersistence).toContain('disableFileCache: false,');
    expect(workspacePersistence).toContain(
      "disableFileCache: typeof input.disableFileCache === 'boolean' ? input.disableFileCache : base.disableFileCache",
    );
    expect(workspaceStore).toContain('setDisableFileCache(disableFileCache: boolean): void {');
    expect(workspaceStore).toContain('clearFileCache(): void {');
    expect(workspaceStore).toContain('this.persistence.clearFileCache();');
  });

  test('adds the debug setting and clears Preview directory cache when enabled', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const settingsRootTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');

    expect(mainTsx).toContain('const [disableFileCache, setDisableFileCache] = useState(');
    expect(mainTsx).toContain('workspaceStore.setDisableFileCache(disableFileCache);');
    expect(mainTsx).toContain('workspaceStore.clearFileCache();');
    expect(mainTsx).toContain('dirHashRef.current = {};');
    expect(settingsRootTsx).toContain('Disable File Cache');
    expect(settingsRootTsx).toContain('checked={disableFileCache}');
  });

  test('bypasses Preview directory cache while disabled', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const loadStart = mainTsx.indexOf('const loadPreviewDirectory = async');
    const loadEnd = mainTsx.indexOf('const openChatFilePeek = useCallback', loadStart);
    const loadBody = mainTsx.slice(loadStart, loadEnd);

    expect(loadBody).toContain('const fileCacheDisabled = disableFileCache === true;');
    expect(loadBody).toContain('const persistedCache = !fileCacheDisabled');
    expect(loadBody).toContain('const knownHash = !fileCacheDisabled && cachedEntries');
    expect(loadBody).toContain('if (!fileCacheDisabled) {');
    expect(loadBody).toContain('workspaceStore.cacheDirectory(targetProjectId, path, nextHash, entries);');
    expect(mainTsx).not.toContain('workspaceStore.cacheFile(');
  });
});
