import fs from 'fs';
import path from 'path';

import {
  SETTINGS_CHILD_DETAILS,
  SETTINGS_PEER_DETAILS,
  isSettingsChildDetail,
  isSettingsPeerDetail,
  mobileSettingsShortcutIndex,
  settingsPageKind,
} from '../web/src/settings/settingsNavigation';
import {
  MOBILE_SETTINGS_SHORTCUTS,
  settingsDetailTitle,
} from '../web/src/settings/SettingsSurface';

describe('settings navigation model', () => {
  test('classifies settings pages into root, peers, and children', () => {
    expect(SETTINGS_PEER_DETAILS).toEqual(['portRelay']);
    expect(SETTINGS_CHILD_DETAILS).toEqual([
      'connectionStatus',
      'database',
      'debugLogs',
      'deviceSessions',
    ]);

    expect(settingsPageKind(null)).toBe('root');
    expect(settingsPageKind('connectionStatus')).toBe('child');
    expect(settingsPageKind('database')).toBe('child');

    expect(isSettingsPeerDetail('portRelay')).toBe(true);
    expect(isSettingsPeerDetail('database')).toBe(false);
    expect(isSettingsChildDetail('debugLogs')).toBe(true);
  });

  test('resolves mobile shortcut indexes for root and peer pages', () => {
    expect(mobileSettingsShortcutIndex(null)).toBe(0);
    expect(mobileSettingsShortcutIndex('portRelay')).toBe(1);
    expect(mobileSettingsShortcutIndex('database')).toBe(0);
  });

  test('keeps settings surface labels and mobile shortcut order together', () => {
    expect(MOBILE_SETTINGS_SHORTCUTS.map(shortcut => shortcut.detail)).toEqual(SETTINGS_PEER_DETAILS);
    expect(settingsDetailTitle('portRelay')).toBe('Port Relay');
    expect(settingsDetailTitle('connectionStatus')).toBe('Connection Status');
    expect(settingsDetailTitle('database')).toBe('Database');
    expect(settingsDetailTitle('debugLogs')).toBe('Logs');
    expect(settingsDetailTitle('deviceSessions')).toBe('Devices');
  });

  test('keeps settings content stable while exposing workbench layout hooks', () => {
    const projectRoot = path.join(__dirname, '..');
    const surface = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsSurface.tsx'), 'utf8');
    const root = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');

    expect(surface).toContain('settings-workbench-screen');
    expect(surface).toContain('settings-workbench-panel');
    expect(surface).toContain('settings-workbench-nav');
    expect(surface).toContain('settings-workbench-detail-page');
    expect(root).toContain("type SettingsSectionId = 'chat' | 'server' | 'connection' | 'code-display' | 'debug';");
    expect(root).toContain('settings-section-${id}');
    for (const id of ['chat', 'server', 'connection', 'code-display', 'debug']) {
      expect(root).toContain(`id: '${id}'`);
    }
    expect(root.indexOf("id: 'chat'")).toBeLessThan(root.indexOf("id: 'connection'"));
    expect(root.indexOf("id: 'connection'")).toBeLessThan(root.indexOf("id: 'code-display'"));
    expect(root.indexOf("id: 'code-display'")).toBeLessThan(root.indexOf("id: 'debug'"));
    expect(root).not.toContain('Dark Mode');
    expect(root).not.toContain('Android APK');
    expect(root).not.toContain('Release publishing');
    expect(root).toContain('Code Theme');
  });

  test('lays out the desktop settings workbench without changing mobile navigation', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../web/src/styles/settings.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    expect(css).toMatch(/\.desktop-settings-screen \.settings-workbench-panel \{[\s\S]*width: min\(920px, calc\(100vw - 56px\)\);[\s\S]*\}/);
    expect(css).not.toContain('.desktop-settings-screen.has-settings-side-panel');
    expect(css).not.toContain(".mobile-settings-shortcut-bar[data-active-index='2']");
    expect(css).not.toContain(".mobile-settings-shortcut-bar[data-active-index='3']");
    expect(css).toMatch(/@media \(min-width: 860px\) \{[\s\S]*\.desktop-settings-screen \.settings-list \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*\}/);
    expect(css).toMatch(/\.desktop-settings-screen \.settings-section-chat \{[\s\S]*grid-column: 2;[\s\S]*grid-row: 1 \/ span 2;[\s\S]*\}/);
    expect(css).toMatch(/\.desktop-settings-screen \.settings-section-debug \{[\s\S]*grid-column: 2;[\s\S]*grid-row: 3;[\s\S]*\}/);
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
    expect(css).toMatch(/\.mobile-settings-shortcut-button\.active \{[\s\S]*color: var\(--accent-primary\);[\s\S]*background: transparent;[\s\S]*\}/);
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

    expect(settingsCss).toMatch(/\.settings-detail-header \{[\s\S]*background: color-mix\(in srgb, var\(--surface-panel\) 96%, transparent\);[\s\S]*\}/);
    expect(settingsCss).toMatch(/\.settings-metadata-card,[\s\S]*\.settings-database-storage-metric,[\s\S]*\.settings-database-store-list \{[\s\S]*border-radius: var\(--radius-panel\);[\s\S]*\}/);
    expect(settingsCss).toMatch(/\.settings-detail-action-btn \{[\s\S]*border-radius: var\(--radius-control\);[\s\S]*\}/);
    expect(settingsCss).not.toMatch(/var\(--(?:bg|panel|panel-2|panel-3|text|muted|border|accent|danger)\)/);
    expect(settingsCss).toContain('.port-relay-stack');
    expect(settingsCss).toContain('var(--state-warning)');
    expect(settingsCss).toContain('var(--state-success)');
    expect(debugCss).toContain('var(--state-warning)');
    expect(debugCss).toMatch(/\.debug-log-detail-footer \{[\s\S]*background: color-mix\(in srgb, var\(--surface-panel\) 96%, transparent\);[\s\S]*\}/);
  });

  test('styles settings groups without changing shortcut order', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../web/src/styles/settings.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(mobileSettingsShortcutIndex(null)).toBe(0);
    expect(mobileSettingsShortcutIndex('portRelay')).toBe(1);
    expect(css).toContain('.settings-workbench-screen {');
    expect(css).not.toContain('/* workspace-ui-targeted-evolution: settings */');
    expect(css).toContain('.settings-danger-row');
    expect(css).toContain('var(--state-danger)');
  });
});
