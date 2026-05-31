import {
  SETTINGS_CHILD_DETAILS,
  SETTINGS_PEER_DETAILS,
  isSettingsChildDetail,
  isSettingsPeerDetail,
  mobileSettingsShortcutIndex,
  settingsPageKind,
} from '../web/src/settings/settingsNavigation';

describe('settings navigation model', () => {
  test('classifies settings pages into root, peers, and children', () => {
    expect(SETTINGS_PEER_DETAILS).toEqual(['update', 'skills', 'portRelay', 'tokenStats', 'ccSwitch']);
    expect(SETTINGS_CHILD_DETAILS).toEqual(['connectionStatus', 'database', 'debugLogs']);

    expect(settingsPageKind(null)).toBe('root');
    expect(settingsPageKind('update')).toBe('peer');
    expect(settingsPageKind('ccSwitch')).toBe('peer');
    expect(settingsPageKind('connectionStatus')).toBe('child');
    expect(settingsPageKind('database')).toBe('child');

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
    expect(mobileSettingsShortcutIndex('ccSwitch')).toBe(5);
    expect(mobileSettingsShortcutIndex('database')).toBe(0);
  });
});
