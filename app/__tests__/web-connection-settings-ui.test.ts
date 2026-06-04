import fs from 'fs';
import path from 'path';

describe('connection settings UI source structure', () => {
  test('adds a Connection section with status detail and local hub read settings', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'main.tsx'), 'utf8');
    const settingsRootTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');
    const detailPath = path.join(projectRoot, 'web', 'src', 'settings', 'ConnectionStatusSettingsDetail.tsx');
    const detailTsx = fs.existsSync(detailPath) ? fs.readFileSync(detailPath, 'utf8') : '';

    expect(mainTsx).toContain("'connectionStatus'");
    expect(mainTsx).toContain("case 'connectionStatus':");
    expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ './settings/SettingsBundle')");
    expect(mainTsx).toContain('renderConnectionStatusSettingsDetail(options)');
    expect(mainTsx).toContain('<ConnectionStatusSettingsDetail');
    expect(mainTsx).toContain('<React.Suspense fallback={null}>');
    expect(mainTsx).not.toContain('resolveRegistryConnectionStatus,');
    expect(mainTsx).not.toContain('resolveVoiceCapabilityStatus,');
    expect(mainTsx).not.toContain('resolveWebResourceConnectionStatus,');
    expect(settingsRootTsx).toContain("renderSettingsSection('Connection'");
    expect(settingsRootTsx).toContain("openSettingsChild('connectionStatus')");
    expect(settingsRootTsx).toContain('Connection Status');
    expect(settingsRootTsx).toContain('Local Hub Read');
    expect(settingsRootTsx).toContain('checked={localHubReadEnabled}');
    expect(fs.existsSync(detailPath)).toBe(true);
    expect(detailTsx).toContain('resolveWebResourceConnectionStatus(webSourceState)');
    expect(detailTsx).toContain('resolveRegistryConnectionStatus({');
    expect(detailTsx).toContain('resolveVoiceCapabilityStatus({');
    expect(detailTsx).toContain('registryHubs.map(hub =>');
    expect(detailTsx).toContain('chat-hub-read-tag');

    const chatSectionStart = settingsRootTsx.indexOf("renderSettingsSection('Chat'");
    const connectionSectionStart = settingsRootTsx.indexOf("renderSettingsSection('Connection'");
    const codeSectionStart = settingsRootTsx.indexOf("renderSettingsSection('Code Display'");
    const connectionSection = settingsRootTsx.slice(connectionSectionStart, codeSectionStart);
    const localHubReadIndex = connectionSection.indexOf('Local Hub Read');
    const connectionStatusIndex = connectionSection.indexOf('Connection Status');

    expect(connectionSectionStart).toBeGreaterThan(chatSectionStart);
    expect(connectionSectionStart).toBeLessThan(codeSectionStart);
    expect(localHubReadIndex).toBeGreaterThanOrEqual(0);
    expect(connectionStatusIndex).toBeGreaterThanOrEqual(0);
    expect(localHubReadIndex).toBeLessThan(connectionStatusIndex);
  });
});
