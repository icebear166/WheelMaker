export type SettingsDetail =
  | 'connectionStatus'
  | 'database'
  | 'debugLogs'
  | 'deviceSessions';

export type SettingsPageKind = 'root' | 'detail';

export const SETTINGS_DETAILS: readonly SettingsDetail[] = [
  'connectionStatus',
  'database',
  'debugLogs',
  'deviceSessions',
];

export function isSettingsDetail(detail: unknown): detail is SettingsDetail {
  return typeof detail === 'string'
    && SETTINGS_DETAILS.includes(detail as SettingsDetail);
}

export function settingsPageKind(
  detail: SettingsDetail | null | undefined,
): SettingsPageKind {
  return isSettingsDetail(detail) ? 'detail' : 'root';
}
