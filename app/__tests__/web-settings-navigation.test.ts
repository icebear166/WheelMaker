import fs from 'fs';
import path from 'path';

import {
  SETTINGS_DETAILS,
  isSettingsDetail,
  settingsPageKind,
} from '../web/src/settings/settingsNavigation';
import {
  settingsDetailTitle,
} from '../web/src/settings/SettingsSurface';

describe('settings navigation model', () => {
  test('classifies settings pages into root and details', () => {
    expect(SETTINGS_DETAILS).toEqual([
      'keyboardShortcuts',
      'connectionStatus',
      'database',
      'debugLogs',
      'deviceSessions',
    ]);

    expect(settingsPageKind(null)).toBe('root');
    expect(settingsPageKind('keyboardShortcuts')).toBe('detail');
    expect(settingsPageKind('connectionStatus')).toBe('detail');
    expect(settingsPageKind('database')).toBe('detail');

    expect(isSettingsDetail('debugLogs')).toBe(true);
    expect(isSettingsDetail('database')).toBe(true);
    expect(isSettingsDetail('portRelay')).toBe(false);
  });

  test('keeps settings detail titles stable', () => {
    expect(settingsDetailTitle('connectionStatus')).toBe('Status');
    expect(settingsDetailTitle('keyboardShortcuts')).toBe('Keyboard Shortcuts');
    expect(settingsDetailTitle('database')).toBe('Database');
    expect(settingsDetailTitle('debugLogs')).toBe('Logs');
    expect(settingsDetailTitle('deviceSessions')).toBe('Devices');
  });

  test('adds a PC-only application group before the existing settings groups', () => {
    const projectRoot = path.join(__dirname, '..');
    const surface = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsSurface.tsx'), 'utf8');
    const root = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');

    expect(surface).toContain('settings-workbench-screen');
    expect(surface).toContain('settings-workbench-panel');
    expect(surface).toContain('settings-workbench-nav');
    expect(surface).toContain('settings-workbench-detail-page');
    expect(root).toContain("type SettingsSectionId = 'application' | 'chat' | 'code' | 'state' | 'debug';");
    expect(root).toContain('settings-section-${id}');
    for (const id of ['application', 'chat', 'code', 'state', 'debug']) {
      expect(root).toContain(`id="${id}"`);
    }
    expect(root).toContain('{isWide ? (');
    expect(root).toContain('label="Keyboard Shortcuts"');
    expect(root).toContain("openSettingsDetail('keyboardShortcuts')");
    expect(root.indexOf('id="application"')).toBeLessThan(root.indexOf('id="chat"'));
    expect(root.indexOf('id="chat"')).toBeLessThan(root.indexOf('id="code"'));
    expect(root.indexOf('id="code"')).toBeLessThan(root.indexOf('id="state"'));
    expect(root.indexOf('id="state"')).toBeLessThan(root.indexOf('id="debug"'));
    expect(root).not.toContain('Dark Mode');
    expect(root).not.toContain('Android APK');
    expect(root).not.toContain('Release publishing');
    expect(root).not.toContain('Port Relay');
    expect(root).toContain('Code Theme');
    expect(root).toContain('settings-subsection-title">Voice Input');
    expect(root).toContain('settings-subsection-title">Speech');
    expect(root).toContain('label="Status"');
    expect(root).toContain('Log Level');

    const bundle = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsBundle.ts'), 'utf8');
    expect(bundle).toContain("export { KeyboardShortcutsSettingsDetail } from './KeyboardShortcutsSettingsDetail';");
  });

  test('lays out the desktop settings workbench without hand-placed sections', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../web/src/styles/settings.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    expect(css).toMatch(/\.desktop-settings-screen \.settings-workbench-panel \{[\s\S]*width: min\(920px, calc\(100vw - 56px\)\);[\s\S]*\}/);
    expect(css).not.toContain('.desktop-settings-screen.has-settings-side-panel');
    expect(css).toMatch(/@media \(min-width: 860px\) \{[\s\S]*\.desktop-settings-screen \.settings-list \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*\}/);
    expect(css).not.toContain('.desktop-settings-screen .settings-section-chat');
    expect(css).not.toContain('.desktop-settings-screen .settings-section-debug');
    expect(css).not.toContain('.mobile-settings-shortcut-bar');
    expect(css).not.toContain('.mobile-settings-shortcut-button');
  });

  test('uses restrained root controls while preserving mobile touch targets', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../web/src/styles/settings.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    expect(css).toMatch(/\.settings-section-title \{[\s\S]*text-transform: none;[\s\S]*font-weight: 600;[\s\S]*\}/);
    expect(css).toMatch(/\.settings-row \{[\s\S]*transition:[\s\S]*background var\(--motion-fast\) var\(--ease-standard\),[\s\S]*color var\(--motion-fast\) var\(--ease-standard\),[\s\S]*box-shadow var\(--motion-fast\) var\(--ease-standard\);[\s\S]*\}/);
    expect(css).toMatch(/\.settings-workbench-panel \.sidebar-setting-select,[\s\S]*\.settings-workbench-panel \.sidebar-setting-input \{[\s\S]*border-radius: var\(--radius-control\);[\s\S]*\}/);
    expect(css).toMatch(/\.mobile-settings-screen \.settings-row \{[\s\S]*min-height: 56px;[\s\S]*\}/);
    expect(css).toMatch(/\.settings-switch:checked \{[\s\S]*background: color-mix\(in srgb, var\(--accent-primary\)[\s\S]*\}/);
  });

  test('shares a durable surface contract across settings details', () => {
    const projectRoot = path.join(__dirname, '..');
    const settingsCss = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'styles', 'settings.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const portRelayCss = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'styles', 'portRelay.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const debugCss = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'styles', 'debug.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    expect(settingsCss).toMatch(/\.settings-metadata-card,[\s\S]*\.settings-database-storage-metric,[\s\S]*\.settings-database-store-list \{[\s\S]*border-radius: var\(--radius-panel\);[\s\S]*\}/);
    expect(settingsCss).toMatch(/\.settings-detail-action-btn \{[\s\S]*border-radius: var\(--radius-control\);[\s\S]*\}/);
    expect(settingsCss).not.toMatch(/var\(--(?:bg|panel|panel-2|panel-3|text|muted|border|accent|danger)\)/);
    expect(settingsCss).toContain('.port-relay-stack');
    expect(settingsCss).toContain('var(--state-warning)');
    expect(settingsCss).toContain('var(--state-success)');
    expect(debugCss).toContain('var(--state-warning)');
    expect(debugCss).toMatch(/\.debug-log-detail-footer \{[\s\S]*background: color-mix\(in srgb, var\(--surface-panel\) 96%, transparent\);[\s\S]*\}/);
  });

  test('styles settings groups with the shared workbench vocabulary', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../web/src/styles/settings.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(css).toContain('.settings-workbench-screen {');
    expect(css).not.toContain('/* workspace-ui-targeted-evolution: settings */');
    expect(css).toContain('.settings-danger-row');
    expect(css).toContain('var(--state-danger)');
  });

  test('styles the shortcut command index, recording state, and reduced motion', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../web/src/styles/settings.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    expect(css).toMatch(/\.keyboard-shortcuts-detail \{[\s\S]*display: grid;[\s\S]*\}/);
    expect(css).toMatch(/\.keyboard-shortcut-command \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*transition:[\s\S]*var\(--motion-fast\)[\s\S]*\}/);
    expect(css).toMatch(/\.keyboard-shortcut-recorder \{[\s\S]*border-color: color-mix\(in srgb, var\(--accent-primary\)[\s\S]*\}/);
    expect(css).toMatch(/\.keyboard-shortcut-keycaps kbd[\s\S]*font-family: var\(--font-mono\);/);
    expect(css).toMatch(/\.keyboard-shortcut-record-button:focus-visible[\s\S]*outline: 2px solid var\(--accent-primary\);/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.keyboard-shortcut-command,[\s\S]*\.keyboard-shortcut-recorder,[\s\S]*\.keyboard-shortcut-recorder kbd \{[\s\S]*animation: none;[\s\S]*transition: none;[\s\S]*transform: none;[\s\S]*\}/);
  });
});
