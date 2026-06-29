import fs from 'fs';
import path from 'path';

describe('cc switch settings detail source structure', () => {
  test('does not expose the removed CC Switch settings detail', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const bundleTs = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsBundle.ts'), 'utf8');
    const detailPath = path.join(projectRoot, 'web', 'src', 'settings', 'CCSwitchSettingsDetail.tsx');

    expect(fs.existsSync(detailPath)).toBe(false);
    expect(mainTsx).not.toContain('CCSwitchSettingsDetail');
    expect(mainTsx).not.toContain('renderCCSwitchSettingsDetail');
    expect(mainTsx).not.toContain("openSettingsPeer('ccSwitch')");
    expect(mainTsx).not.toContain("settingsDetailView === 'ccSwitch'");
    expect(bundleTs).not.toContain('CCSwitchSettingsDetail');
    expect(mainTsx).not.toContain('No CC Switch profile metadata found.');
  });
});
