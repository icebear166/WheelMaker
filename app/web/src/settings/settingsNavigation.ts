export type SettingsPeerDetail =
  | 'skills'
  | 'portRelay';

export type SettingsChildDetail =
  | 'connectionStatus'
  | 'database'
  | 'debugLogs'
  | 'deviceSessions'
  | 'skillDetail';

export type SettingsDetailId = SettingsPeerDetail | SettingsChildDetail;
export type SettingsPageKind = 'root' | 'peer' | 'child';

export const SETTINGS_PEER_DETAILS: readonly SettingsPeerDetail[] = [
  'skills',
  'portRelay',
];

export const SETTINGS_CHILD_DETAILS: readonly SettingsChildDetail[] = [
  'connectionStatus',
  'database',
  'debugLogs',
  'deviceSessions',
  'skillDetail',
];

export function isSettingsPeerDetail(
  detail: SettingsDetailId | null | undefined,
): detail is SettingsPeerDetail {
  return detail !== null
    && detail !== undefined
    && SETTINGS_PEER_DETAILS.includes(detail as SettingsPeerDetail);
}

export function isSettingsChildDetail(
  detail: SettingsDetailId | null | undefined,
): detail is SettingsChildDetail {
  return detail !== null
    && detail !== undefined
    && SETTINGS_CHILD_DETAILS.includes(detail as SettingsChildDetail);
}

export function isSettingsDetailId(detail: unknown): detail is SettingsDetailId {
  return isSettingsPeerDetail(detail as SettingsDetailId | null)
    || isSettingsChildDetail(detail as SettingsDetailId | null);
}

export function settingsPageKind(
  detail: SettingsDetailId | null | undefined,
): SettingsPageKind {
  if (isSettingsPeerDetail(detail)) {
    return 'peer';
  }
  if (isSettingsChildDetail(detail)) {
    return 'child';
  }
  return 'root';
}

export function mobileSettingsShortcutIndex(
  detail: SettingsDetailId | null | undefined,
): number {
  switch (detail) {
    case 'skills':
      return 1;
    case 'portRelay':
      return 2;
    default:
      return 0;
  }
}
