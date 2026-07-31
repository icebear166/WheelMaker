import {
  isSettingsDetail,
  settingsPageKind,
  type SettingsDetail,
} from '../../../settings/settingsNavigation';

export type MobileSettingsHistoryDetail = SettingsDetail;

export type MobileSettingsHistoryState = {
  wheelMakerHistory: 'mobile-settings';
  detail: MobileSettingsHistoryDetail | null;
};

export type MobileSettingsPopAction = 'back-to-root' | 'close-settings' | 'none';
export type MobileSettingsHistoryWriteAction = 'push' | 'replace' | 'none';

const MOBILE_SETTINGS_HISTORY_MARKER = 'mobile-settings';

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
      || isSettingsDetail(state.detail)
    );
}

export function mobileSettingsHistoryKey(detail: MobileSettingsHistoryDetail | null): string {
  return `mobile-settings:${detail ?? 'root'}`;
}

export function resolveMobileSettingsHistoryWriteAction({
  currentKey,
  nextDetail,
}: {
  currentKey: string | null;
  nextDetail: MobileSettingsHistoryDetail | null;
}): MobileSettingsHistoryWriteAction {
  const nextKey = mobileSettingsHistoryKey(nextDetail);
  if (currentKey === nextKey) {
    return 'none';
  }
  if (currentKey === null) {
    return 'push';
  }
  if (currentKey === mobileSettingsHistoryKey(null) && nextDetail !== null) {
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
  if (currentKind === 'detail') {
    return isMobileSettingsHistoryState(nextState) ? 'back-to-root' : 'close-settings';
  }
  return isMobileSettingsHistoryState(nextState) ? 'none' : 'close-settings';
}
