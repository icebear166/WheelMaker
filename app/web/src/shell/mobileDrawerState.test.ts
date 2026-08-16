import {
  isMobileStandaloneSurfaceOpen,
  type MobileStandaloneSurfaceState,
} from './mobileDrawerState';

const baseState: MobileStandaloneSurfaceState = {
  settingsOpen: false,
  releasePublishingOpen: false,
  portRelayOpen: false,
  sharesOpen: false,
  portRelayFrameOpen: false,
};

test.each([
  ['Settings', 'settingsOpen'],
  ['Release Publishing', 'releasePublishingOpen'],
  ['Port Relay', 'portRelayOpen'],
  ['Public shares', 'sharesOpen'],
  ['Port Relay frame', 'portRelayFrameOpen'],
] as const)('%s marks the mobile drawer as unavailable', (_label, key) => {
  expect(isMobileStandaloneSurfaceOpen({...baseState, [key]: true})).toBe(true);
});

test('the mobile drawer remains available on chat when no standalone surface is open', () => {
  expect(isMobileStandaloneSurfaceOpen(baseState)).toBe(false);
});
