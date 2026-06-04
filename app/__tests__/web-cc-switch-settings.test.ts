import fs from 'fs';
import path from 'path';

describe('cc switch settings detail source structure', () => {
  test('lazy loads the CC Switch detail body from the settings module', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'main.tsx'), 'utf8');
    const detailPath = path.join(projectRoot, 'web', 'src', 'settings', 'CCSwitchSettingsDetail.tsx');
    const detailTsx = fs.existsSync(detailPath) ? fs.readFileSync(detailPath, 'utf8') : '';

    expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ './settings/SettingsBundle')");
    expect(mainTsx).toContain('renderCCSwitchSettingsDetail(options)');
    expect(mainTsx).toContain('<CCSwitchSettingsDetail');
    expect(detailTsx).toContain('export function CCSwitchSettingsDetail');
    expect(detailTsx).toContain('No CC Switch profile metadata found.');
    expect(detailTsx).toContain("tagVariantClass('wide-project-hub', activeHub)");
    expect(mainTsx).not.toContain('No CC Switch profile metadata found.');
  });
});
