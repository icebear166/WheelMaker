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
});
