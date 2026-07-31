import fs from 'fs';
import path from 'path';

describe('connection settings UI source structure', () => {
  test('adds a Connection section with status detail', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const settingsSurfaceTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsSurface.tsx'), 'utf8');
    const settingsRootTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');
    const detailPath = path.join(projectRoot, 'web', 'src', 'settings', 'ConnectionStatusSettingsDetail.tsx');
    const detailTsx = fs.existsSync(detailPath) ? fs.readFileSync(detailPath, 'utf8') : '';

    expect(mainTsx).toContain("'connectionStatus'");
    expect(settingsSurfaceTsx).toContain("case 'connectionStatus':");
    expect(settingsSurfaceTsx).toContain("return 'Connection Status';");
    expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ '../settings/SettingsBundle')");
    expect(mainTsx).toContain('renderConnectionStatusSettingsDetail()');
    expect(mainTsx).toContain('<ConnectionStatusSettingsDetail');
    expect(mainTsx).toContain('<React.Suspense fallback={null}>');
    expect(mainTsx).not.toContain('resolveRegistryConnectionStatus,');
    expect(mainTsx).not.toContain('resolveVoiceCapabilityStatus,');
    expect(mainTsx).not.toContain('resolveWebResourceConnectionStatus,');
    expect(settingsRootTsx).toContain('<SettingsSection id="state"');
    expect(settingsRootTsx).toContain("openSettingsDetail('connectionStatus')");
    expect(settingsRootTsx).toContain('Connection Status');
    expect(settingsRootTsx).not.toContain('Local Hub Read');
    expect(fs.existsSync(detailPath)).toBe(true);
    expect(detailTsx).not.toContain('Web Resources');
    expect(detailTsx).not.toContain('webSourceState');
    expect(detailTsx).toContain('resolveRegistryConnectionStatus({');
    expect(detailTsx).toContain('resolveVoiceCapabilityStatus({');
    expect(detailTsx).toContain('baseURL');
    expect(detailTsx).not.toContain('Local Hub Read');

    const chatSectionStart = settingsRootTsx.indexOf('<SettingsSection id="chat"');
    const codeSectionStart = settingsRootTsx.indexOf('<SettingsSection id="code"');
    const stateSectionStart = settingsRootTsx.indexOf('<SettingsSection id="state"');
    const debugSectionStart = settingsRootTsx.indexOf('<SettingsSection id="debug"');
    const stateSection = settingsRootTsx.slice(stateSectionStart, debugSectionStart);
    const connectionStatusIndex = stateSection.indexOf('Connection Status');

    expect(chatSectionStart).toBeGreaterThanOrEqual(0);
    expect(codeSectionStart).toBeGreaterThan(chatSectionStart);
    expect(stateSectionStart).toBeGreaterThan(codeSectionStart);
    expect(debugSectionStart).toBeGreaterThan(stateSectionStart);
    expect(connectionStatusIndex).toBeGreaterThanOrEqual(0);
  });
});
