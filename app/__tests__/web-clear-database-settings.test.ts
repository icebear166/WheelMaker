import fs from 'fs';
import path from 'path';

describe('web clear database settings', () => {
  const projectRoot = path.join(__dirname, '..');

  test('moves the destructive reset into the database detail page', () => {
    const settingsRootTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'),
      'utf8',
    );
    const databaseDetailTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'settings', 'DatabaseSettingsDetail.tsx'),
      'utf8',
    );

    expect(settingsRootTsx).not.toContain('Clear Local Cache');
    expect(databaseDetailTsx).toContain('Clear Database');
    expect(databaseDetailTsx).toContain('onClearDatabase');
    expect(databaseDetailTsx).toContain('set-btn--danger');
  });

  test('wires a confirm dialog that wipes local data and reloads', () => {
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );
    const appDialogsTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'shell', 'AppDialogs.tsx'),
      'utf8',
    );

    expect(mainTsx).toContain('const requestClearDatabase = () => {');
    expect(mainTsx).toContain("setConfirmTarget({kind: 'clearDatabase'});");
    expect(mainTsx).toContain('workspaceStore.resetDatabase();');
    expect(mainTsx).toContain('registryAuthController.logout()');
    expect(mainTsx).toContain('window.location.reload();');
    expect(mainTsx).not.toContain("kind: 'clearCache'");
    expect(mainTsx).not.toContain('requestClearLocalCache');

    expect(appDialogsTsx).toContain("kind: 'clearDatabase'");
    expect(appDialogsTsx).toContain('Clear database?');
    expect(appDialogsTsx).toContain('Clear Database');
    expect(appDialogsTsx).not.toContain('Clear local cache?');
    expect(appDialogsTsx).not.toContain('Settings will be preserved.');
  });

  test('keeps the destructive action single-flight and surfaces failures in the confirm dialog', () => {
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(mainTsx).toContain('const [clearDatabasePending, setClearDatabasePending] = useState(false);');
    expect(mainTsx).toContain('const clearDatabasePendingRef = useRef(false);');
    expect(mainTsx).toContain('if (clearDatabasePendingRef.current)');
    expect(mainTsx).toContain('setConfirmError(message);');
    expect(mainTsx).toMatch(/confirmTarget\?\.kind === 'clearDatabase'[\s\S]{0,160}clearDatabasePending/);
    expect(mainTsx).not.toContain('registryAuthController.logout().catch(() => undefined)');
    expect(mainTsx).toContain('await androidSpeechRuntimeRef.current?.clearCredential();');
  });

  test('drops the whole IndexedDB and resets in-memory workspace state', () => {
    const workspaceStore = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspaceStore.ts'),
      'utf8',
    );
    const workspacePersistence = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    expect(workspaceStore).toContain('resetDatabase(): Promise<void>');
    expect(workspaceStore).toContain('return this.persistence.resetDatabase();');
    expect(workspacePersistence).toContain('async resetDatabase(): Promise<void>');
    expect(workspacePersistence).toContain('indexedDB.deleteDatabase(WORKSPACE_DB_NAME)');
    expect(workspacePersistence).toContain('db?.close();');
    expect(workspacePersistence).toContain('db.onversionchange = () => {');
    expect(workspacePersistence).toContain('this.invalidated = true;');
    expect(workspacePersistence).not.toContain('clearCache(): void {');
    expect(workspacePersistence).not.toContain('messageViewerEnabled: boolean;');
    expect(workspacePersistence).not.toContain("messageViewerEnabled: 'messageViewerEnabled'");
    expect(workspacePersistence).not.toContain('disableFileCache: boolean;');
    expect(workspacePersistence).not.toContain("disableFileCache: 'disableFileCache'");
  });

  test('removes registry-debug naming from the remaining logout action', () => {
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );
    const settingsRootTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'),
      'utf8',
    );

    expect(mainTsx).not.toContain('handleRegistryDebugLogout');
    expect(settingsRootTsx).not.toContain('handleRegistryDebugLogout');
    expect(mainTsx).toContain('handleRegistryLogout={handleRegistryLogout}');
  });
});
