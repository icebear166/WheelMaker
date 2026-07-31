export type StandalonePageKind = 'release-publish' | 'port-relay';

export type StandalonePageHistoryState = {
  wheelMakerStandalonePage: StandalonePageKind;
};

const STANDALONE_PAGE_KINDS: readonly StandalonePageKind[] = [
  'release-publish',
  'port-relay',
];

export function createStandalonePageHistoryState(
  page: StandalonePageKind,
): StandalonePageHistoryState {
  return {wheelMakerStandalonePage: page};
}

export function isStandalonePageHistoryState(
  value: unknown,
  page?: StandalonePageKind,
): value is StandalonePageHistoryState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const marker = (value as Record<string, unknown>).wheelMakerStandalonePage;
  if (page !== undefined) {
    return marker === page;
  }
  return STANDALONE_PAGE_KINDS.includes(marker as StandalonePageKind);
}
