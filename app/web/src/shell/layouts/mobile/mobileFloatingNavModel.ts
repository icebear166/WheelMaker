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
  {id: 'preview', icon: 'eye', label: 'Preview'},
  {id: 'terminal', icon: 'terminal', label: 'Terminal'},
  {id: 'relay', icon: 'radioTower', label: 'Relay'},
  {id: 'monitor', icon: 'activity', label: 'Monitor'},
  {id: 'settings', icon: 'settings', label: 'Settings'},
  {id: 'chat', icon: 'messageCircle', label: 'Chat'},
];

export const FLOATING_NAV_BUTTON_SIZE_PX = 48;
export const FLOATING_NAV_ITEM_SIZE_PX = 44;
export const FLOATING_NAV_CARD_PADDING_PX = 4;
export const FLOATING_NAV_CARD_HEIGHT_PX =
  FLOATING_NAV_ITEMS.length * FLOATING_NAV_ITEM_SIZE_PX + FLOATING_NAV_CARD_PADDING_PX * 2;
export const FLOATING_NAV_EXPANDED_OVERFLOW_PX =
  FLOATING_NAV_CARD_HEIGHT_PX - FLOATING_NAV_BUTTON_SIZE_PX;

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

export type FloatingNavRelayState = {
  /** Mirrors the legacy bubble: only shown when the relay is up with a frame URL. */
  visible: boolean;
  frameOpen: boolean;
  /** Tappable: a target exists or the frame is already open (tap closes it). */
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
  return {
    visible: ready && frameUrl !== '',
    frameOpen,
    enabled: hasTarget || frameOpen,
    active: frameOpen,
  };
}
