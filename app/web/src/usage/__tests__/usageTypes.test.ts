import {remainingPercent, tightnessColor, mergeAccountsAcrossHubs} from '../usageTypes';

describe('remainingPercent', () => {
  it('converts usedPercent to remaining', () => {
    expect(remainingPercent({id: '5h', label: '5h', usedPercent: 23})).toBe(77);
    expect(remainingPercent({id: '5h', label: '5h', usedPercent: 100})).toBe(0);
    expect(remainingPercent({id: '5h', label: '5h', usedPercent: 0})).toBe(100);
  });
});

describe('tightnessColor', () => {
  it('red below 10% remaining, yellow 10-30, default otherwise', () => {
    expect(tightnessColor(5)).toBe('danger');
    expect(tightnessColor(20)).toBe('warning');
    expect(tightnessColor(77)).toBe('default');
  });
});

describe('mergeAccountsAcrossHubs', () => {
  it('dedupes same provider + email', () => {
    const a = {provider: 'codex', identity: {email: 'x@y.z', accountId: 'a1'}, hubId: 'h1', status: 'ok' as const, limits: []};
    const b = {provider: 'codex', identity: {email: 'x@y.z', accountId: 'a1'}, hubId: 'h2', status: 'ok' as const, limits: []};
    const merged = mergeAccountsAcrossHubs([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].hubIds).toEqual(['h1', 'h2']);
  });
  it('keeps distinct providers', () => {
    const merged = mergeAccountsAcrossHubs([
      {provider: 'codex', identity: {email: 'x@y.z'}, hubId: 'h1', status: 'ok' as const, limits: []},
      {provider: 'kimi', identity: {userId: 'u1'}, hubId: 'h1', status: 'ok' as const, limits: []},
    ]);
    expect(merged).toHaveLength(2);
  });
});
