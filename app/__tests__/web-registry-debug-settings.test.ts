import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
describe('web registry debug settings', () => {
  const projectRoot = path.join(__dirname, '..');

  test('persists message viewer and log level as separate global settings', () => {
    const workspacePersistence = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    expect(workspacePersistence).toContain("export type PersistedLogLevel = 'debug' | 'info' | 'warning' | 'error';");
    expect(workspacePersistence).toContain('messageViewerEnabled: boolean;');
    expect(workspacePersistence).toContain('logLevel: PersistedLogLevel;');
    expect(workspacePersistence).toContain("messageViewerEnabled: 'messageViewerEnabled',");
    expect(workspacePersistence).toContain("logLevel: 'logLevel',");
    expect(workspacePersistence).toContain('messageViewerEnabled: false,');
    expect(workspacePersistence).toContain("logLevel: 'warning',");
    expect(workspacePersistence).toContain(
      "messageViewerEnabled: typeof input.messageViewerEnabled === 'boolean' ? input.messageViewerEnabled : base.messageViewerEnabled",
    );
    expect(workspacePersistence).toContain(
      'logLevel: normalizePersistedLogLevel(input.logLevel, base.logLevel)',
    );
    expect(workspacePersistence).toContain(
      'const rows = globalRowsForPatch(patch, next, now);',
    );
    expect(workspacePersistence).toContain(
      '{k: GLOBAL_KEYS.messageViewerEnabled, v: serialize(this.state.global.messageViewerEnabled), updatedAt}',
    );
    expect(workspacePersistence).toContain(
      '{k: GLOBAL_KEYS.logLevel, v: serialize(this.state.global.logLevel), updatedAt}',
    );
    expect(workspacePersistence).not.toContain('registryDebug: boolean;');
  });

  test('adds separate message viewer and log level controls without making records persistent', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const settingsNavigationTs = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'settingsNavigation.ts'), 'utf8');
    const settingsRootTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');
    const settingsSurfaceTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsSurface.tsx'), 'utf8');

    expect(mainTsx).toContain("import {createRegistryDebugStore} from '../debug/registryDebug';");
    expect(mainTsx).toContain('const registryDebugStore = createRegistryDebugStore();');
    expect(mainTsx).toContain('const registryClientName = isAndroidNativeSpeechHost()');
    expect(mainTsx).toContain('const service = new RegistryWorkspaceService(registryDebugStore.recordCaptureEvent, {clientName: registryClientName});');
    expect(mainTsx).toContain('const [messageViewerEnabled, setMessageViewerEnabled] = useState(');
    expect(mainTsx).toContain('const [logLevel, setLogLevel] = useState(');
    expect(mainTsx).toContain('registryDebugStore.setEnabled(messageViewerEnabled);');
    expect(mainTsx).toContain('appDiagnosticStore.setLogLevel(logLevel);');
    expect(mainTsx).toContain('setNativeDiagnosticLogLevel(logLevel);');
    expect(settingsRootTsx).toContain("renderSettingsSection({id: 'debug'");
    expect(settingsRootTsx).toContain('Message Viewer');
    expect(settingsRootTsx).toContain('Log Level');
    expect(settingsNavigationTs).toContain("'debugLogs'");
    expect(settingsSurfaceTsx).toContain("case 'debugLogs':");
    expect(settingsSurfaceTsx).toContain("return 'Logs';");
    expect(mainTsx).toContain("detail === 'debugLogs'");
    expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ '../settings/SettingsBundle')");
    expect(mainTsx).toContain('renderDebugLogsSettingsDetail(options)');
    expect(mainTsx).toContain('<DebugLogsSettingsDetail');
    expect(mainTsx).toContain('<React.Suspense fallback={null}>');
    expect(settingsRootTsx).toContain('checked={messageViewerEnabled}');
    expect(settingsRootTsx).toContain('onChange={event => setMessageViewerEnabled(event.target.checked)}');
    expect(settingsRootTsx).toContain('value={logLevel}');
    expect(settingsRootTsx).toContain('onChange={event => setLogLevel(normalizeAppDiagnosticLogLevel(event.target.value))}');
    expect(settingsRootTsx).not.toContain('WebView2 Remote Debug');
    expect(mainTsx).not.toContain('persistDesktopRemoteDebugEnabled');
    expect(mainTsx).not.toContain('handleDesktopRemoteDebugEnabledChange');
    expect(mainTsx).not.toContain('Open Debug Panel');
    expect(mainTsx).not.toContain('disabled={!registryDebug}');
    const debugSectionStart = settingsRootTsx.indexOf("renderSettingsSection({id: 'debug'");
    const debugSectionEnd = settingsRootTsx.indexOf("), 'bug')", debugSectionStart);
    const debugSection = settingsRootTsx.slice(debugSectionStart, debugSectionEnd);
    expect(debugSection).toContain("openSettingsChild('debugLogs')");
    expect(debugSection).toContain('Logs');
    expect(debugSection).toContain('Logout');
    expect(debugSection).toContain('handleRegistryDebugLogout');
    expect(debugSection).toContain('settings-danger-row');
    expect(mainTsx).toContain('registryAuthController.logout()');
    expect(mainTsx).toContain('supervisorManagedCloseRef.current = true;');
    expect(mainTsx).not.toContain('registryDebugRecordsJson');
  });

  test('renders compact uploadable logs with a bottom category selector', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
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

  test('places debug maintenance settings at the bottom after code display', () => {
    const settingsRootTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');

    const codeDisplaySectionIndex = settingsRootTsx.indexOf("renderSettingsSection({id: 'code-display'");
    const debugSectionIndex = settingsRootTsx.indexOf("renderSettingsSection({id: 'debug'");
    expect(debugSectionIndex).toBeGreaterThan(codeDisplaySectionIndex);
    expect(settingsRootTsx).not.toContain("renderSettingsSection('More'");

    const debugSection = settingsRootTsx.slice(debugSectionIndex);
    expect(debugSection.indexOf('Message Viewer')).toBeLessThan(debugSection.indexOf('Log Level'));
    expect(debugSection.indexOf('Log Level')).toBeLessThan(debugSection.indexOf('Logs'));
    expect(debugSection.indexOf('Logs')).toBeLessThan(debugSection.indexOf('Database'));
    expect(debugSection.indexOf('Database')).toBeLessThan(debugSection.indexOf('Clear Local Cache'));
    expect(debugSection.indexOf('Clear Local Cache')).toBeLessThan(debugSection.indexOf('Logout'));
  });
});
