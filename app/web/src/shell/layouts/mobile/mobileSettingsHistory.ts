import {
  isSettingsDetailId,
  settingsPageKind,
  type SettingsDetailId,
} from '../../../settings/settingsNavigation';

export type MobileSettingsHistoryDetail = SettingsDetailId;

export type MobileSettingsHistoryState = {
  wheelMakerHistory: 'mobile-settings';
  detail: MobileSettingsHistoryDetail | null;
};

export type MobileSettingsPopAction = 'back-to-root' | 'close-settings' | 'none';
export type MobileSettingsHistoryWriteAction = 'push' | 'replace' | 'none';

const MOBILE_SETTINGS_HISTORY_MARKER = 'mobile-settings';

function detailFromMobileSettingsHistoryKey(key: string | null): MobileSettingsHistoryDetail | null | undefined {
  if (!key?.startsWith(`${MOBILE_SETTINGS_HISTORY_MARKER}:`)) {
    return undefined;
  }
  const value = key.slice(MOBILE_SETTINGS_HISTORY_MARKER.length + 1);
  if (value === 'root') {
    return null;
  }
  return isSettingsDetailId(value) ? value : undefined;
}

export function createMobileSettingsHistoryState(
  detail: MobileSettingsHistoryDetail | null,
): MobileSettingsHistoryState {
  return {
    wheelMakerHistory: MOBILE_SETTINGS_HISTORY_MARKER,
    detail,
  };
}

export function isMobileSettingsHistoryState(input: unknown): input is MobileSettingsHistoryState {
  if (!input || typeof input !== 'object') {
    return false;
  }
  const state = input as Partial<MobileSettingsHistoryState>;
  return state.wheelMakerHistory === MOBILE_SETTINGS_HISTORY_MARKER
    && (
      state.detail === null
      || isSettingsDetailId(state.detail)
    );
}

export function mobileSettingsHistoryKey(detail: MobileSettingsHistoryDetail | null): string {
  return `mobile-settings:${detail ?? 'root'}`;
}

export function resolveMobileSettingsHistoryWriteAction({
  currentKey,
  nextDetail,
  replaceRootWithDetail = false,
}: {
  currentKey: string | null;
  nextDetail: MobileSettingsHistoryDetail | null;
  replaceRootWithDetail?: boolean;
}): MobileSettingsHistoryWriteAction {
  const nextKey = mobileSettingsHistoryKey(nextDetail);
  if (currentKey === nextKey) {
    return 'none';
  }
  if (currentKey === null) {
    return 'push';
  }
  if (currentKey === mobileSettingsHistoryKey(null)) {
    return replaceRootWithDetail && nextDetail !== null ? 'replace' : 'push';
  }
  const currentDetail = detailFromMobileSettingsHistoryKey(currentKey);
  if (settingsPageKind(currentDetail) === 'peer' && settingsPageKind(nextDetail) === 'child') {
    return 'push';
  }
  return 'replace';
}

export function resolveMobileSettingsPopAction({
  settingsOpen,
  settingsDetailView,
  nextState,
}: {
  settingsOpen: boolean;
  settingsDetailView: MobileSettingsHistoryDetail | null;
  nextState: unknown;
}): MobileSettingsPopAction {
  if (!settingsOpen) {
    return 'none';
  }
  const currentKind = settingsPageKind(settingsDetailView);
  if (currentKind === 'child') {
    return isMobileSettingsHistoryState(nextState) ? 'back-to-root' : 'close-settings';
  }
  if (currentKind === 'peer') {
    return 'close-settings';
  }
  return isMobileSettingsHistoryState(nextState) ? 'none' : 'close-settings';
}
