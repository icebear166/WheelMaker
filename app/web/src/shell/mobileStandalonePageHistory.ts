export type StandalonePageHistoryState = {
  wheelMakerStandalonePage: 'release-publish';
};

export function createStandalonePageHistoryState(): StandalonePageHistoryState {
  return {wheelMakerStandalonePage: 'release-publish'};
}

export function isStandalonePageHistoryState(
  value: unknown,
): value is StandalonePageHistoryState {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as Record<string, unknown>).wheelMakerStandalonePage === 'release-publish',
  );
}
