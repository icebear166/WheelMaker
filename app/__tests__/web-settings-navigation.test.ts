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
    expect(SETTINGS_PEER_DETAILS).toEqual(['update', 'skills', 'portRelay', 'tokenStats']);
    expect(SETTINGS_CHILD_DETAILS).toEqual(['connectionStatus', 'database', 'debugLogs', 'skillDetail']);

    expect(settingsPageKind(null)).toBe('root');
    expect(settingsPageKind('update')).toBe('peer');
    expect(settingsPageKind('connectionStatus')).toBe('child');
    expect(settingsPageKind('database')).toBe('child');
    expect(settingsPageKind('skillDetail')).toBe('child');

    expect(isSettingsPeerDetail('tokenStats')).toBe(true);
    expect(isSettingsPeerDetail('database')).toBe(false);
    expect(isSettingsChildDetail('debugLogs')).toBe(true);
    expect(isSettingsChildDetail('skills')).toBe(false);
  });

  test('resolves mobile shortcut indexes for root and peer pages', () => {
    expect(mobileSettingsShortcutIndex(null)).toBe(0);
    expect(mobileSettingsShortcutIndex('update')).toBe(1);
    expect(mobileSettingsShortcutIndex('skills')).toBe(2);
    expect(mobileSettingsShortcutIndex('portRelay')).toBe(3);
    expect(mobileSettingsShortcutIndex('tokenStats')).toBe(4);
    expect(mobileSettingsShortcutIndex('database')).toBe(0);
  });

  test('keeps settings surface labels and mobile shortcut order together', () => {
    expect(MOBILE_SETTINGS_SHORTCUTS.map(shortcut => shortcut.detail)).toEqual(SETTINGS_PEER_DETAILS);
    expect(settingsDetailTitle('update')).toBe('Update');
    expect(settingsDetailTitle('skills')).toBe('Skills');
    expect(settingsDetailTitle('portRelay')).toBe('Port Relay');
    expect(settingsDetailTitle('tokenStats')).toBe('Token Stats');
    expect(settingsDetailTitle('connectionStatus')).toBe('Connection Status');
    expect(settingsDetailTitle('database')).toBe('Database');
    expect(settingsDetailTitle('debugLogs')).toBe('Logs');
    expect(settingsDetailTitle('skillDetail')).toBe('Skill Detail');
  });

  test('keeps settings content stable while exposing workbench layout hooks', () => {
    const projectRoot = path.join(__dirname, '..');
    const surface = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsSurface.tsx'), 'utf8');
    const root = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');

    expect(surface).toContain('settings-workbench-screen');
    expect(surface).toContain('settings-workbench-panel');
    expect(surface).toContain('settings-workbench-nav');
    expect(surface).toContain('settings-workbench-detail-page');
    expect(root).toContain("type SettingsSectionId = 'appearance' | 'chat' | 'connection' | 'code-display' | 'debug';");
    expect(root).toContain('settings-section-${id}');
    for (const id of ['appearance', 'chat', 'connection', 'code-display', 'debug']) {
      expect(root).toContain(`id: '${id}'`);
    }
    expect(root.indexOf("id: 'appearance'")).toBeLessThan(root.indexOf("id: 'chat'"));
    expect(root.indexOf("id: 'chat'")).toBeLessThan(root.indexOf("id: 'connection'"));
    expect(root.indexOf("id: 'connection'")).toBeLessThan(root.indexOf("id: 'code-display'"));
    expect(root.indexOf("id: 'code-display'")).toBeLessThan(root.indexOf("id: 'debug'"));
  });

  test('styles settings groups without changing shortcut order', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../web/src/styles/settings.css'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(mobileSettingsShortcutIndex(null)).toBe(0);
    expect(mobileSettingsShortcutIndex('update')).toBe(1);
    expect(mobileSettingsShortcutIndex('skills')).toBe(2);
    expect(mobileSettingsShortcutIndex('portRelay')).toBe(3);
    expect(mobileSettingsShortcutIndex('tokenStats')).toBe(4);
    expect(css).toContain('/* workspace-ui-targeted-evolution: settings */');
    expect(css).toContain('.settings-danger-row');
    expect(css).toContain('var(--state-danger)');
  });
});
