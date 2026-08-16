export type MobileStandaloneSurfaceState = {
  settingsOpen: boolean;
  releasePublishingOpen: boolean;
  portRelayOpen: boolean;
  sharesOpen: boolean;
  portRelayFrameOpen: boolean;
};

export function isMobileStandaloneSurfaceOpen(
  state: MobileStandaloneSurfaceState,
): boolean {
  return state.settingsOpen ||
    state.releasePublishingOpen ||
    state.portRelayOpen ||
    state.sharesOpen ||
    state.portRelayFrameOpen;
}
