import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';

describe('web registry debug settings', () => {
  const projectRoot = path.join(__dirname, '..');

  test('persists log level without message viewer or file cache flags', () => {
    const workspacePersistence = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    expect(workspacePersistence).toContain("export type PersistedLogLevel = 'debug' | 'info' | 'warning' | 'error';");
    expect(workspacePersistence).toContain('logLevel: PersistedLogLevel;');
    expect(workspacePersistence).toContain("logLevel: 'logLevel',");
    expect(workspacePersistence).toContain("logLevel: 'warning',");
    expect(workspacePersistence).toContain('logLevel: normalizePersistedLogLevel(input.logLevel, base.logLevel)');
    expect(workspacePersistence).toContain(
      'const rows = globalRowsForPatch(patch, next, now);',
    );
    expect(workspacePersistence).toContain(
      '{k: GLOBAL_KEYS.logLevel, v: serialize(this.state.global.logLevel), updatedAt}',
    );
    expect(workspacePersistence).not.toContain('messageViewerEnabled: boolean;');
    expect(workspacePersistence).not.toContain("messageViewerEnabled: 'messageViewerEnabled'");
    expect(workspacePersistence).not.toContain('disableFileCache: boolean;');
    expect(workspacePersistence).not.toContain("disableFileCache: 'disableFileCache'");
    expect(workspacePersistence).not.toContain('registryDebug: boolean;');
  });

  test('keeps log level and logs controls without message viewer or file cache', () => {
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );
    const settingsNavigationTs = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'settings', 'settingsNavigation.ts'),
      'utf8',
    );
    const settingsRootTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'),
      'utf8',
    );
    const settingsSurfaceTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'settings', 'SettingsSurface.tsx'),
      'utf8',
    );

    expect(mainTsx).toContain('const [logLevel, setLogLevel] = useState(');
    expect(mainTsx).toContain('appDiagnosticStore.setLogLevel(logLevel);');
    expect(mainTsx).toContain('setNativeDiagnosticLogLevel(logLevel);');
    expect(mainTsx).toContain("detail === 'debugLogs'");
    expect(mainTsx).toContain('renderDebugLogsSettingsDetail()');
    expect(mainTsx).toContain('<DebugLogsSettingsDetail');
    expect(mainTsx).not.toContain('createRegistryDebugStore');
    expect(mainTsx).not.toContain('RegistryDebugPanel');
    expect(mainTsx).not.toContain('messageViewerEnabled');
    expect(mainTsx).not.toContain('disableFileCache');
    expect(mainTsx).not.toContain('registryDebugStore.recordCaptureEvent');
    expect(mainTsx).not.toContain('Open Debug Panel');
    expect(mainTsx).not.toContain('disabled={!registryDebug}');
    expect(mainTsx).not.toContain('registryDebugRecordsJson');

    expect(settingsRootTsx).toContain('<SettingsSection id="debug"');
    expect(settingsRootTsx).toContain('Log Level');
    expect(settingsRootTsx).not.toContain('Message Viewer');
    expect(settingsRootTsx).not.toContain('Disable File Cache');
    expect(settingsRootTsx).toContain('value={logLevel}');
    expect(settingsRootTsx).toContain(
      'onChange={event => setLogLevel(normalizeAppDiagnosticLogLevel(event.target.value))}',
    );

    expect(settingsNavigationTs).toContain("'debugLogs'");
    expect(settingsSurfaceTsx).toContain("case 'debugLogs':");
    expect(settingsSurfaceTsx).toContain("return 'Logs';");

    const debugSectionStart = settingsRootTsx.indexOf('<SettingsSection id="debug"');
    const debugSection = settingsRootTsx.slice(debugSectionStart);
    expect(debugSection).toContain("openSettingsDetail('debugLogs')");
    expect(debugSection).toContain('Log Level');
    expect(debugSection).not.toContain('Message Viewer');
    expect(debugSection).not.toContain('Disable File Cache');
    expect(debugSection).not.toContain('Logout');

    const stateSectionStart = settingsRootTsx.indexOf('<SettingsSection id="state"');
    const stateSection = settingsRootTsx.slice(stateSectionStart, debugSectionStart);
    expect(stateSection).toContain('Logout');
    expect(stateSection).toContain('requestLogout');
    expect(stateSection).not.toContain('Clear Local Cache');
  });

  test('renders compact uploadable logs with a bottom category selector', () => {
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );
    const detailPath = path.join(projectRoot, 'web', 'src', 'settings', 'DebugLogsSettingsDetail.tsx');
    const detailTsx = fs.existsSync(detailPath) ? fs.readFileSync(detailPath, 'utf8') : '';
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('appDiagnosticStore,');
    expect(mainTsx).not.toContain('filterAppDiagnosticRecords,');
    expect(mainTsx).not.toContain('formatAppDiagnosticRecordLine,');
    expect(mainTsx).not.toContain('serializeAppDiagnosticRecords,');
    expect(mainTsx).not.toContain('const [appDiagnosticRecords, setAppDiagnosticRecords] = useState');
    expect(mainTsx).not.toContain('const [selectedDiagnosticCategory, setSelectedDiagnosticCategory] = useState');
    expect(mainTsx).not.toContain('const uploadDebugLogs = async () => {');
    expect(mainTsx).not.toContain('formatAppDiagnosticRecordLine(record)');
    expect(fs.existsSync(detailPath)).toBe(true);
    expect(detailTsx).toContain('appDiagnosticStore.subscribe(setAppDiagnosticRecords)');
    expect(detailTsx).toContain('filterAppDiagnosticRecords(appDiagnosticRecords');
    expect(detailTsx).toContain('levels: appDiagnosticLevelsAtOrAbove(logLevel)');
    expect(detailTsx).toContain('await drainNativeWebDiagnosticsToAppLog();');
    expect(detailTsx).toContain('await uploadDebugLog({');
    expect(detailTsx).toContain('text: serializeAppDiagnosticRecords(records),');
    expect(detailTsx).toContain('formatAppDiagnosticRecordLine(record)');
    expect(detailTsx).toContain('className="debug-log-detail-footer"');
    expect(detailTsx).toContain('<option value="workspace">Workspace</option>');
    expect(detailTsx).toContain('<option value="http">HTTP</option>');
    expect(detailTsx).toContain('<option value="voice">Voice</option>');
    expect(detailTsx).toContain('No logs yet.');
    expect(detailTsx).toContain('Upload Log');
    expect(stylesCss).toContain('.debug-log-detail-footer');
    expect(stylesCss).toContain('.debug-log-line.error');
    const debugLogLineRule = stylesCss.match(/\.debug-log-line\s*\{[^}]+\}/)?.[0] ?? '';
    expect(debugLogLineRule).toContain('white-space: pre-wrap;');
    expect(debugLogLineRule).toContain('overflow-wrap: anywhere;');
    expect(debugLogLineRule).not.toContain('text-overflow: ellipsis;');
  });

  test('places debug settings after state, with the log level row last', () => {
    const settingsRootTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'),
      'utf8',
    );

    const codeSectionIndex = settingsRootTsx.indexOf('<SettingsSection id="code"');
    const stateSectionIndex = settingsRootTsx.indexOf('<SettingsSection id="state"');
    const debugSectionIndex = settingsRootTsx.indexOf('<SettingsSection id="debug"');
    expect(stateSectionIndex).toBeGreaterThan(codeSectionIndex);
    expect(debugSectionIndex).toBeGreaterThan(stateSectionIndex);

    const stateSection = settingsRootTsx.slice(stateSectionIndex, debugSectionIndex);
    expect(stateSection.indexOf('Devices')).toBeLessThan(stateSection.indexOf('Database'));
    expect(stateSection.indexOf('Database')).toBeLessThan(stateSection.indexOf('label="Status"'));
    expect(stateSection.indexOf('label="Status"')).toBeLessThan(stateSection.indexOf('Logout'));
    expect(stateSection).not.toContain('Clear Local Cache');
    expect(stateSection).not.toContain('Connection Status');

    const debugSection = settingsRootTsx.slice(debugSectionIndex);
    expect(debugSection.indexOf('Log Level')).toBeLessThan(debugSection.indexOf('aria-label="Open logs"'));
    expect(debugSection).not.toContain('Message Viewer');
    expect(debugSection).not.toContain('Disable File Cache');
  });
});
