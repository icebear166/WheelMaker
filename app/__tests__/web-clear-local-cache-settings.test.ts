import fs from 'fs';
import path from 'path';

describe('web clear local cache settings', () => {
  test('exposes settings action that clears local cache while preserving token/address identity', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'main.tsx'), 'utf8');
    const appDialogsTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'shell', 'AppDialogs.tsx'), 'utf8');
    const settingsRootTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');
    const workspaceStore = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'services', 'workspaceStore.ts'), 'utf8');
    const workspacePersistence = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'services', 'workspacePersistence.ts'), 'utf8');

    expect(settingsRootTsx).toContain('Clear Local Cache');
    expect(settingsRootTsx).not.toContain('Clear Local Cache (Keep Token)');
    const clearCacheStart = mainTsx.indexOf('const requestClearLocalCache = () => {');
    const switchProjectStart = mainTsx.indexOf('const switchProject = async', clearCacheStart);
    expect(clearCacheStart).toBeGreaterThanOrEqual(0);
    expect(switchProjectStart).toBeGreaterThan(clearCacheStart);
    const clearCacheFlow = mainTsx.slice(clearCacheStart, switchProjectStart);
    expect(clearCacheFlow).not.toContain('window.confirm(');
    expect(appDialogsTsx).toContain('export type ConfirmTarget =');
    expect(mainTsx).toContain("kind: 'clearCache'");
    expect(mainTsx).toContain("setConfirmTarget({kind: 'clearCache'});");
    expect(appDialogsTsx).toContain('Clear local cache?');
    expect(appDialogsTsx).toContain('Token and server address will be preserved.');
    expect(mainTsx).toContain('workspaceStore.clearLocalCachePreservingToken();');
    expect(mainTsx).toContain('window.location.reload();');
    expect(mainTsx).toContain('<AppConfirmDialog');
    expect(appDialogsTsx).toContain('className="app-confirm-backdrop"');
    expect(appDialogsTsx).toContain("'app-confirm-btn primary danger'");

    expect(workspaceStore).toContain('clearLocalCachePreservingToken(): void {');
    expect(workspaceStore).toContain('this.persistence.clearCachePreservingToken();');

    expect(mainTsx).toContain('exportDatabaseDump');
    expect(mainTsx).toContain('Export current database dump');
    expect(mainTsx).toContain('wheelmaker-local-db-');

    expect(workspacePersistence).toContain('const LOCAL_ADDRESS_KEY =');
    expect(workspacePersistence).toContain('const LOCAL_TOKEN_KEY =');
    expect(workspacePersistence).toContain('const WORKSPACE_DB_VERSION = 6;');
    expect(workspacePersistence).toContain('turnsJson');
    expect(workspacePersistence).not.toContain('messagesJson');
    expect(workspacePersistence).toContain('saveLocalIdentityState');
    expect(workspacePersistence).toContain('const preservedAddress =');
    expect(workspacePersistence).toContain('this.state.global.address = preservedAddress;');
    expect(workspacePersistence).toContain('this.state.global.token = preservedToken;');
    expect(workspacePersistence).not.toContain('STORAGE_KEY');
    expect(workspacePersistence).not.toContain('loadLegacyState');
    expect(workspacePersistence).not.toContain('metaJson');
  });
});


