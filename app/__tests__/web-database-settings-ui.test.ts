import fs from 'fs';
import path from 'path';

describe('database settings UI source structure', () => {
  test('lazy loads the Database detail body while keeping export action in main', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const detailPath = path.join(projectRoot, 'web', 'src', 'settings', 'DatabaseSettingsDetail.tsx');
    const detailTsx = fs.existsSync(detailPath) ? fs.readFileSync(detailPath, 'utf8') : '';

    expect(mainTsx).toContain("'database'");
    expect(mainTsx).toContain('renderDatabaseSettingsDetail(options)');
    expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ '../settings/SettingsBundle')");
    expect(mainTsx).toContain('<DatabaseSettingsDetail');
    expect(mainTsx).toContain('loading={databaseLoading}');
    expect(mainTsx).toContain('error={databaseError}');
    expect(mainTsx).toContain('dumpText={databaseDumpText}');
    expect(mainTsx).toContain('storageStats={databaseStorageStats}');
    expect(mainTsx).toContain('onClick={exportDatabaseDump}');
    expect(mainTsx).not.toContain('<pre className="settings-database-dump">{databaseDumpText}</pre>');
    expect(fs.existsSync(detailPath)).toBe(true);
    expect(detailTsx).toContain('Loading database...');
    expect(detailTsx).toContain('Database error: {error}');
    expect(detailTsx).toContain('className="settings-database-storage-summary"');
    expect(detailTsx).toContain('storageStats.stores.map(store => (');
    expect(detailTsx).toContain('IndexedDB stores');
    expect(detailTsx).toContain('Quota');
    expect(detailTsx).toContain('<pre className="settings-database-dump">{dumpText}</pre>');
  });
});
