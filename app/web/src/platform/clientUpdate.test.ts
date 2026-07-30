import {clientUpdateView, type ClientUpdateState} from './clientUpdate';

describe('client update menu projection', () => {
  test.each([
    [{status: 'checking'}, {meta: 'Checking…', disabled: true, showDot: false}],
    [
      {status: 'current', currentVersion: 'v1.9'},
      {meta: 'v1.9 · Current', disabled: true, showDot: false},
    ],
    [
      {status: 'available', currentVersion: 'v1.8', latestVersion: 'v1.9'},
      {meta: 'v1.8 → v1.9', disabled: false, showDot: true},
    ],
    [
      {status: 'available', currentVersion: '', latestVersion: 'v1.9'},
      {meta: 'Unknown → v1.9', disabled: false, showDot: true},
    ],
    [{status: 'failed'}, {meta: 'Retry', disabled: false, showDot: false}],
    [
      {status: 'updating', meta: 'Downloading…'},
      {meta: 'Downloading…', disabled: true, showDot: false},
    ],
  ] as Array<[ClientUpdateState, ReturnType<typeof clientUpdateView>]>)(
    'projects %j',
    (state, expected) => {
      expect(clientUpdateView(state)).toEqual(expected);
    },
  );
});
