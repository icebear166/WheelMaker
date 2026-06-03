import fs from 'fs';
import path from 'path';

describe('connection settings UI source structure', () => {
  test('adds a Connection section with status detail and local hub read settings', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'main.tsx'), 'utf8');
    const detailPath = path.join(projectRoot, 'web', 'src', 'settings', 'ConnectionStatusSettingsDetail.tsx');
    const detailTsx = fs.existsSync(detailPath) ? fs.readFileSync(detailPath, 'utf8') : '';

    expect(mainTsx).toContain("'connectionStatus'");
    expect(mainTsx).toContain("case 'connectionStatus':");
    expect(mainTsx).toContain("React.lazy(() => import('./settings/ConnectionStatusSettingsDetail')");
    expect(mainTsx).toContain('renderConnectionStatusSettingsDetail(options)');
    expect(mainTsx).toContain('<ConnectionStatusSettingsDetail');
    expect(mainTsx).toContain('<React.Suspense fallback={null}>');
    expect(mainTsx).not.toContain('resolveRegistryConnectionStatus,');
    expect(mainTsx).not.toContain('resolveVoiceCapabilityStatus,');
    expect(mainTsx).not.toContain('resolveWebResourceConnectionStatus,');
    expect(mainTsx).toContain("renderSettingsSection('Connection'");
    expect(mainTsx).toContain("openSettingsChild('connectionStatus')");
    expect(mainTsx).toContain('Connection Status');
    expect(mainTsx).toContain('Local Hub Read');
    expect(mainTsx).toContain('checked={localHubReadEnabled}');
    expect(fs.existsSync(detailPath)).toBe(true);
    expect(detailTsx).toContain('resolveWebResourceConnectionStatus(webSourceState)');
    expect(detailTsx).toContain('resolveRegistryConnectionStatus({');
    expect(detailTsx).toContain('resolveVoiceCapabilityStatus({');
    expect(detailTsx).toContain('registryHubs.map(hub =>');
    expect(detailTsx).toContain('chat-hub-read-tag');

    const chatSectionStart = mainTsx.indexOf("renderSettingsSection('Chat'");
    const connectionSectionStart = mainTsx.indexOf("renderSettingsSection('Connection'");
    const codeSectionStart = mainTsx.indexOf("renderSettingsSection('Code Display'");
    const connectionSection = mainTsx.slice(connectionSectionStart, codeSectionStart);
    const localHubReadIndex = connectionSection.indexOf('Local Hub Read');
    const connectionStatusIndex = connectionSection.indexOf('Connection Status');

    expect(connectionSectionStart).toBeGreaterThan(chatSectionStart);
    expect(connectionSectionStart).toBeLessThan(codeSectionStart);
    expect(localHubReadIndex).toBeGreaterThanOrEqual(0);
    expect(connectionStatusIndex).toBeGreaterThanOrEqual(0);
    expect(localHubReadIndex).toBeLessThan(connectionStatusIndex);
  });
});
