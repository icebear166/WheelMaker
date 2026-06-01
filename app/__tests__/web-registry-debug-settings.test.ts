import fs from 'fs';
import path from 'path';

describe('web registry debug settings', () => {
  const projectRoot = path.join(__dirname, '..');

  test('persists registry debug as a default-off global setting', () => {
    const workspacePersistence = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'services', 'workspacePersistence.ts'),
      'utf8',
    );

    expect(workspacePersistence).toContain('registryDebug: boolean;');
    expect(workspacePersistence).toContain("registryDebug: 'registryDebug',");
    expect(workspacePersistence).toContain('registryDebug: false,');
    expect(workspacePersistence).toContain(
      "registryDebug: typeof input.registryDebug === 'boolean' ? input.registryDebug : base.registryDebug",
    );
    expect(workspacePersistence).toContain(
      '{k: GLOBAL_KEYS.registryDebug, v: serialize(next.registryDebug), updatedAt: now}',
    );
  });

  test('adds a settings debug switch and open button without making records persistent', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'main.tsx'), 'utf8');

    expect(mainTsx).toContain("import {createRegistryDebugStore} from './debug/registryDebug';");
    expect(mainTsx).toContain('const registryDebugStore = createRegistryDebugStore();');
    expect(mainTsx).toContain('const service = new RegistryWorkspaceService(registryDebugStore.recordCaptureEvent);');
    expect(mainTsx).toContain('const [registryDebug, setRegistryDebug] = useState(');
    expect(mainTsx).toContain('const [registryDebugPanelOpen, setRegistryDebugPanelOpen] = useState(');
    expect(mainTsx).toContain('registryDebugStore.setEnabled(registryDebug);');
    expect(mainTsx).toContain('setNativeDebugLoggingEnabled(registryDebug);');
    expect(mainTsx).toContain("renderSettingsSection('Debug'");
    expect(mainTsx).toContain('Debug');
    expect(mainTsx).toContain("'debugLogs'");
    expect(mainTsx).toContain("settingsDetailView === 'debugLogs'");
    expect(mainTsx).toContain('renderDebugLogsSettingsDetail(options)');
    expect(mainTsx).toContain('checked={registryDebug}');
    expect(mainTsx).toContain('onChange={event => setRegistryDebug(event.target.checked)}');
    expect(mainTsx).toContain('disabled={!registryDebug}');
    expect(mainTsx).toContain('setRegistryDebugPanelOpen(true)');
    const debugSectionStart = mainTsx.indexOf("renderSettingsSection('Debug'");
    const debugSectionEnd = mainTsx.indexOf("), 'bug')", debugSectionStart);
    const debugSection = mainTsx.slice(debugSectionStart, debugSectionEnd);
    expect(debugSection).toContain("openSettingsChild('debugLogs')");
    expect(debugSection).toContain('Logs');
    expect(debugSection).toContain('Logout');
    expect(debugSection).toContain('handleRegistryDebugLogout');
    expect(debugSection).toContain('settings-danger-row');
    expect(mainTsx).toContain('workspaceStore.clearLocalToken();');
    expect(mainTsx).toContain("setToken('');");
    expect(mainTsx).toContain('supervisorManagedCloseRef.current = true;');
    expect(mainTsx).not.toContain('registryDebugRecordsJson');
  });

  test('renders compact uploadable logs with a bottom category selector', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'main.tsx'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles.css'), 'utf8');

    expect(mainTsx).toContain('appDiagnosticStore,');
    expect(mainTsx).toContain('filterAppDiagnosticRecords,');
    expect(mainTsx).toContain('formatAppDiagnosticRecordLine,');
    expect(mainTsx).toContain('serializeAppDiagnosticRecords,');
    expect(mainTsx).toContain('const [appDiagnosticRecords, setAppDiagnosticRecords] = useState');
    expect(mainTsx).toContain("const [selectedDiagnosticCategory, setSelectedDiagnosticCategory] = useState<AppDiagnosticCategory>('http');");
    expect(mainTsx).toContain("levels: ['info', 'warn', 'error']");
    expect(mainTsx).toContain('const uploadDebugLogs = async () => {');
    expect(mainTsx).toContain('await service.uploadDebugLog({');
    expect(mainTsx).toContain('text: serializeAppDiagnosticRecords(records),');
    expect(mainTsx).toContain('formatAppDiagnosticRecordLine(record)');
    expect(mainTsx).toContain('className="debug-log-detail-footer"');
    expect(mainTsx).toContain('<option value="workspace">Workspace</option>');
    expect(mainTsx).toContain('<option value="http">HTTP</option>');
    expect(mainTsx).toContain('<option value="voice">Voice</option>');
    expect(mainTsx).toContain('No logs yet.');
    expect(mainTsx).toContain('Upload Log');
    expect(stylesCss).toContain('.debug-log-detail-footer');
    expect(stylesCss).toContain('.debug-log-line.error');
    const debugLogLineRule = stylesCss.match(/\.debug-log-line\s*\{[^}]+\}/)?.[0] ?? '';
    expect(debugLogLineRule).toContain('white-space: pre-wrap;');
    expect(debugLogLineRule).toContain('overflow-wrap: anywhere;');
    expect(debugLogLineRule).not.toContain('text-overflow: ellipsis;');
  });

  test('places debug maintenance settings at the bottom after code display', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'main.tsx'), 'utf8');

    const codeDisplaySectionIndex = mainTsx.indexOf("renderSettingsSection('Code Display'");
    const debugSectionIndex = mainTsx.indexOf("renderSettingsSection('Debug'");
    expect(debugSectionIndex).toBeGreaterThan(codeDisplaySectionIndex);
    expect(mainTsx).not.toContain("renderSettingsSection('More'");

    const debugSection = mainTsx.slice(debugSectionIndex);
    expect(debugSection.indexOf('Open Debug Panel')).toBeLessThan(debugSection.indexOf('Logs'));
    expect(debugSection.indexOf('Logs')).toBeLessThan(debugSection.indexOf('Database'));
    expect(debugSection.indexOf('Database')).toBeLessThan(debugSection.indexOf('Clear Local Cache'));
    expect(debugSection.indexOf('Clear Local Cache')).toBeLessThan(debugSection.indexOf('Logout'));
  });
});
