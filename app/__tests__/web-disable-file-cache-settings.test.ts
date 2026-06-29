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
    expect(workspacePersistence).toContain(
      '{k: GLOBAL_KEYS.disableFileCache, v: serialize(next.disableFileCache), updatedAt: now}',
    );
    expect(workspaceStore).toContain('setDisableFileCache(disableFileCache: boolean): void {');
    expect(workspaceStore).toContain('clearFileCache(): void {');
    expect(workspaceStore).toContain('this.persistence.clearFileCache();');
  });

  test('gates cached directory hydration and validation when file cache is disabled', () => {
    const workspaceStore = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspaceStore.ts'),
      'utf8',
    );
    const workspaceController = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspaceController.ts'),
      'utf8',
    );

    expect(workspaceStore).toContain('hydrateProject(projectId: string, rootEntries: RegistryFsEntry[], options?: {disableFileCache?: boolean}): HydratedProjectState');
    expect(workspaceStore).toContain('if (!options?.disableFileCache) {');
    expect(workspaceStore).toContain('hydrateCachedProject(projectId: string, options?: {disableFileCache?: boolean}): HydratedProjectState');
    expect(workspaceController).toContain('options?: {disableFileCache?: boolean}');
    expect(workspaceController).toContain('const disableFileCache = options?.disableFileCache === true;');
    expect(workspaceController).toContain('this.store.hydrateProject(session.selectedProjectId, session.fileEntries, options)');
    expect(workspaceController).toContain('this.store.hydrateCachedProject(session.selectedProjectId, options)');
    expect(workspaceController).toContain('const cached = disableFileCache ? null : this.store.getCachedDirectory(projectId, dirPath);');
    expect(workspaceController).toContain('const result = await this.service.listDirectory(dirPath, disableFileCache ? undefined : cached?.hash || undefined);');
    expect(workspaceController).toContain('if (!disableFileCache) {');
  });

  test('adds debug setting and clears file cache when enabled', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const settingsRootTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');

    expect(mainTsx).toContain('const [disableFileCache, setDisableFileCache] = useState(');
    expect(mainTsx).toContain("typeof persistedGlobal.disableFileCache === 'boolean'");
    expect(mainTsx).toContain('workspaceStore.setDisableFileCache(disableFileCache);');
    expect(mainTsx).toContain('if (disableFileCache) {');
    expect(mainTsx).toContain('workspaceStore.clearFileCache();');
    expect(mainTsx).toContain('dirHashRef.current = {};');
    expect(mainTsx).toContain('fileHashRef.current = {};');
    expect(mainTsx).toContain('fileCacheRef.current = {};');
    expect(settingsRootTsx).toContain('Disable File Cache');
    expect(settingsRootTsx).toContain('checked={disableFileCache}');
    expect(settingsRootTsx).toContain('onChange={event => setDisableFileCache(event.target.checked)}');
  });

  test('bypasses directory and file cache while disabled setting is enabled', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');

    expect(mainTsx).toContain('const fileCacheDisabled = disableFileCache === true;');
    expect(mainTsx).toContain('const persistedCache = !fileCacheDisabled && targetProjectId');
    expect(mainTsx).toContain("const knownHash = fileCacheDisabled ? '' :");
    expect(mainTsx).toContain('fileCacheDisabled ? undefined : knownHash || undefined');
    expect(mainTsx).toContain('if (!fileCacheDisabled && targetProjectId) {');
    expect(mainTsx).toContain('const persistedFile = fileCacheDisabled ? null : workspaceStore.getCachedFile(targetProjectId, path);');
    expect(mainTsx).toContain("const knownHash = !fileCacheDisabled && typeof cachedContent === 'string'");
    expect(mainTsx).toContain('if (result.notModified && fileCacheDisabled) {');
    expect(mainTsx).toContain('const freshResult = await service.readProjectFile(path, targetProjectId);');
    expect(mainTsx).toContain('if (!fileCacheDisabled) {');
    expect(mainTsx).toContain('workspaceController.connect(ws, trimmedToken, {disableFileCache})');
    expect(mainTsx).toContain('workspaceController.switchProject(nextProjectId, {disableFileCache})');
    expect(mainTsx).toContain('workspaceController.switchProjectLightweight(nextProjectId, {disableFileCache})');
    expect(mainTsx).toContain('workspaceController.refreshProject(activeProjectId, [');
    expect(mainTsx).toContain('{disableFileCache}');
  });
});
