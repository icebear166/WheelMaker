import type {IconName} from '../../../common/Icon';

export type FloatingNavDestination =
  | 'preview'
  | 'terminal'
  | 'relay'
  | 'monitor'
  | 'settings'
  | 'chat';

export type FloatingNavItem = {
  id: FloatingNavDestination;
  icon: IconName;
  label: string;
};

// Fixed top-to-bottom order inside the expanded card. Chat stays at the
// bottom, adjacent to where the collapsed button rests.
export const FLOATING_NAV_ITEMS: ReadonlyArray<FloatingNavItem> = [
  {id: 'preview', icon: 'appWindow', label: 'Preview'},
  {id: 'terminal', icon: 'terminal', label: 'Terminal'},
  {id: 'relay', icon: 'radioTower', label: 'Relay'},
  {id: 'monitor', icon: 'activity', label: 'Monitor'},
  {id: 'settings', icon: 'settings', label: 'Settings'},
  {id: 'chat', icon: 'messageCircle', label: 'Chat'},
];

export const FLOATING_NAV_BUTTON_SIZE_PX = 48;
export const FLOATING_NAV_ITEM_SIZE_PX = 44;
export const FLOATING_NAV_CARD_PADDING_PX = 2;
export const FLOATING_NAV_CARD_HEIGHT_PX =
  FLOATING_NAV_ITEMS.length * FLOATING_NAV_ITEM_SIZE_PX + FLOATING_NAV_CARD_PADDING_PX * 2;
export const FLOATING_NAV_EXPANDED_OVERFLOW_PX =
  FLOATING_NAV_CARD_HEIGHT_PX - FLOATING_NAV_BUTTON_SIZE_PX;
export const WORKBENCH_FULLSCREEN_BUTTON_SIZE_PX = 36;
export const WORKBENCH_FULLSCREEN_NAV_GAP_PX = 8;
export const WORKBENCH_FULLSCREEN_EDGE_PX = 14;
export const TERMINAL_MOBILE_KEYBAR_BASE_HEIGHT_PX = 57;

export function resolveFloatingNavReservedBottomInset(
  current: FloatingNavDestination,
  safeAreaBottomInset: number,
): number {
  if (current === 'preview' || current === 'relay') {
    return Math.max(WORKBENCH_FULLSCREEN_EDGE_PX, safeAreaBottomInset)
      + WORKBENCH_FULLSCREEN_BUTTON_SIZE_PX
      + WORKBENCH_FULLSCREEN_NAV_GAP_PX;
  }
  if (current === 'terminal') {
    return safeAreaBottomInset
      + TERMINAL_MOBILE_KEYBAR_BASE_HEIGHT_PX
      + WORKBENCH_FULLSCREEN_EDGE_PX
      + WORKBENCH_FULLSCREEN_BUTTON_SIZE_PX
      + WORKBENCH_FULLSCREEN_NAV_GAP_PX;
  }
  return 0;
}

export type FloatingNavSurfaceFlags = {
  relayFrameOpen: boolean;
  settingsOpen: boolean;
  usageOpen: boolean;
  terminalOpen: boolean;
  previewOpen: boolean;
};

export function resolveFloatingNavCurrent(flags: FloatingNavSurfaceFlags): FloatingNavDestination {
  if (flags.relayFrameOpen) return 'relay';
  if (flags.settingsOpen) return 'settings';
  if (flags.usageOpen) return 'monitor';
  if (flags.terminalOpen) return 'terminal';
  if (flags.previewOpen) return 'preview';
  return 'chat';
}

export function shouldOpenDrawerWithFloatingNav(current: FloatingNavDestination): boolean {
  return current === 'chat';
}

export type FloatingNavRelayState = {
  frameOpen: boolean;
  /** Can open the frame right now (relay up with a target, or frame already open). */
  enabled: boolean;
  active: boolean;
};

export function resolveFloatingNavRelayState({
  ready,
  frameUrl,
  hasTarget,
  frameOpen,
}: {
  ready: boolean;
  frameUrl: string;
  hasTarget: boolean;
  frameOpen: boolean;
}): FloatingNavRelayState {
  const frameReady = ready && frameUrl !== '';
  return {
    frameOpen,
    enabled: frameOpen || (frameReady && hasTarget),
    active: frameOpen,
  };
}
