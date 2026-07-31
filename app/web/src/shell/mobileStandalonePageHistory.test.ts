import {
  createStandalonePageHistoryState,
  isStandalonePageHistoryState,
} from './mobileStandalonePageHistory';

test('recognizes each standalone page history entry', () => {
  expect(createStandalonePageHistoryState('release-publish')).toEqual({
    wheelMakerStandalonePage: 'release-publish',
  });
  expect(createStandalonePageHistoryState('port-relay')).toEqual({
    wheelMakerStandalonePage: 'port-relay',
  });
  expect(isStandalonePageHistoryState({
    wheelMakerStandalonePage: 'release-publish',
  })).toBe(true);
  expect(isStandalonePageHistoryState({
    wheelMakerStandalonePage: 'port-relay',
  })).toBe(true);
  expect(isStandalonePageHistoryState({
    wheelMakerStandalonePage: 'settings',
  })).toBe(false);
  expect(isStandalonePageHistoryState(null)).toBe(false);
});

test('matches a specific standalone page when a kind is given', () => {
  const releaseState = {wheelMakerStandalonePage: 'release-publish'};
  const relayState = {wheelMakerStandalonePage: 'port-relay'};
  expect(isStandalonePageHistoryState(releaseState, 'release-publish')).toBe(true);
  expect(isStandalonePageHistoryState(releaseState, 'port-relay')).toBe(false);
  expect(isStandalonePageHistoryState(relayState, 'port-relay')).toBe(true);
  expect(isStandalonePageHistoryState(null, 'port-relay')).toBe(false);
});
