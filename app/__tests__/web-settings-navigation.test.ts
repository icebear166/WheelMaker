import {
  SETTINGS_DETAILS,
  isSettingsDetail,
  settingsPageKind,
} from '../web/src/settings/settingsNavigation';
import {settingsDetailTitle} from '../web/src/settings/SettingsSurface';

describe('settings navigation model', () => {
  test('classifies root and supported detail pages', () => {
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

  test('keeps detail titles stable', () => {
    expect(settingsDetailTitle('connectionStatus')).toBe('Status');
    expect(settingsDetailTitle('keyboardShortcuts')).toBe('Keyboard Shortcuts');
    expect(settingsDetailTitle('database')).toBe('Database');
    expect(settingsDetailTitle('debugLogs')).toBe('Logs');
    expect(settingsDetailTitle('deviceSessions')).toBe('Devices');
  });
});
