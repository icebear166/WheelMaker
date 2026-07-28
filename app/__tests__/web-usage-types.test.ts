import type {UsageViewAccount} from '../web/src/usage/usageTypes';
import {formatResetCountdown, formatUpdatedAgo, tightnessTone} from '../web/src/usage/usageTypes';

describe('usage formatters', () => {
  it('formats full reset timestamps without reparsing a partial date', () => {
    const now = Date.parse('2027-01-01T00:00:00Z');
    expect(formatResetCountdown('2027-01-01T02:14:00Z', now)).toBe('in 2h 14m');
  });

  it('formats freshness and threshold tones', () => {
    const now = Date.parse('2027-01-01T00:00:00Z');
    expect(formatUpdatedAgo('2026-12-31T23:57:00Z', now)).toBe('3m ago');
    expect(tightnessTone(8)).toBe('danger');
    expect(tightnessTone(24)).toBe('warning');
    expect(tightnessTone(60)).toBe('normal');
  });

  it('models the concrete Hub-local sources needed for history requests', () => {
    const account: UsageViewAccount = {
      localId: 'latest',
      identity: {kind: 'email', value: 'user@example.com'},
      status: 'ok',
      limits: [],
      hubIds: ['hub-a'],
      sources: [{hubId: 'hub-a', accountLocalId: 'local-a'}],
    };
    expect(account.sources[0]).toEqual({hubId: 'hub-a', accountLocalId: 'local-a'});
  });
});
