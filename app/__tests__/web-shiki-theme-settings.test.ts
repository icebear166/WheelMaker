import fs from 'fs';
import path from 'path';

describe('web shiki theme settings', () => {
  test('uses curated Shiki theme metadata and grouped theme settings UI', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'main.tsx'), 'utf8');
    const shikiRenderer = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'services', 'shikiRenderer.ts'), 'utf8');
    const shikiSettings = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'services', 'shikiSettings.ts'), 'utf8');
    const workspacePersistence = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'services', 'workspacePersistence.ts'), 'utf8');

    expect(shikiRenderer).toContain("createHighlighterCore");
    expect(shikiRenderer).toContain("from './shikiSettings'");
    expect(shikiRenderer).toContain("'material-theme-darker'");
    expect(shikiRenderer).toContain("'material-theme-lighter'");
    expect(shikiRenderer).toContain("'tokyo-night'");
    expect(shikiRenderer).toContain("import('@shikijs/themes/monokai')");
    expect(shikiSettings).toContain("'monokai'");
    expect(shikiSettings).toContain("export type CodeThemeId = 'auto-plus' | CuratedCodeThemeId;");
    expect(shikiSettings).toContain('export const CODE_THEME_OPTION_GROUPS');
    expect(shikiSettings).toContain('label: \'Dark Themes\'');
    expect(shikiSettings).toContain('label: \'Light Themes\'');
    expect(shikiSettings).toContain('CURATED_CODE_THEME_OPTIONS');

    expect(mainTsx).toContain('CODE_THEME_OPTION_GROUPS');
    expect(mainTsx).toContain('<optgroup key={group.label} label={group.label}>');
    expect(mainTsx).toContain('CODE_THEME_OPTIONS[0].label');
    expect(mainTsx).toContain("renderSettingsSection('Code Display'");
    expect(mainTsx).toContain('Code Font');
    expect(mainTsx).toContain('Font Size');
    expect(mainTsx).toContain('Line Height');
    expect(mainTsx).toContain('Tab Size');

    expect(workspacePersistence).toContain("isCodeThemeId(input.codeTheme)");
    expect(workspacePersistence).toContain('codeTheme: typeof input.codeTheme === \'string\' && isCodeThemeId(input.codeTheme) ? input.codeTheme : base.codeTheme');
    expect(workspacePersistence).toContain("from './shikiSettings'");
    expect(workspacePersistence).not.toContain("from './shikiRenderer'");
  });
});
