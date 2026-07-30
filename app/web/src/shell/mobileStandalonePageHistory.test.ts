import {
  createStandalonePageHistoryState,
  isStandalonePageHistoryState,
} from './mobileStandalonePageHistory';

test('recognizes only the Release Publishing history entry', () => {
  expect(createStandalonePageHistoryState()).toEqual({
    wheelMakerStandalonePage: 'release-publish',
  });
  expect(isStandalonePageHistoryState({
    wheelMakerStandalonePage: 'release-publish',
  })).toBe(true);
  expect(isStandalonePageHistoryState({
    wheelMakerStandalonePage: 'settings',
  })).toBe(false);
  expect(isStandalonePageHistoryState(null)).toBe(false);
});
