import {UsageStream, parseLimitString} from '../web/src/usage/usageStream';
import {formatResetCountdown, formatUpdatedAgo} from '../web/src/usage/usageTypes';

describe('formatResetCountdown', () => {
  const now = 1_000_000_000_000; // fixed ms reference
  it('returns null without a reset time', () => {
    expect(formatResetCountdown(undefined, now)).toBeNull();
  });
  it('returns "soon" for past resets', () => {
    expect(formatResetCountdown(Math.floor(now / 1000) - 60, now)).toBe('soon');
  });
  it('formats minutes, hours, and days', () => {
    expect(formatResetCountdown(Math.floor((now + 45 * 60000) / 1000), now)).toBe('in 45m');
    expect(formatResetCountdown(Math.floor((now + (2 * 60 + 14) * 60000) / 1000), now)).toBe('in 2h 14m');
    expect(formatResetCountdown(Math.floor((now + (3 * 24 * 60 + 4 * 60) * 60000) / 1000), now)).toBe('in 3d 4h');
  });
});

describe('formatUpdatedAgo', () => {
  const now = 1_000_000_000_000;
  it('returns empty string when never updated', () => {
    expect(formatUpdatedAgo(0, now)).toBe('');
  });
  it('formats recent and older updates', () => {
    expect(formatUpdatedAgo(now - 5000, now)).toBe('just now');
    expect(formatUpdatedAgo(now - 30000, now)).toBe('30s ago');
    expect(formatUpdatedAgo(now - 3 * 60000, now)).toBe('3m ago');
    expect(formatUpdatedAgo(now - 2 * 3600000, now)).toBe('2h ago');
  });
});

describe('parseLimitString', () => {
  it('parses remaining percent with reset time', () => {
    const limit = parseLimitString('77% (07-22 15:04)', '5h', '5h window');
    expect(limit).not.toBeNull();
    expect(limit!.usedPercent).toBe(23); // 100 - 77
    expect(limit!.resetsAt).toBeGreaterThan(0);
  });
  it('parses remaining percent without reset time', () => {
    const limit = parseLimitString('50%', 'week', 'Weekly');
    expect(limit).not.toBeNull();
    expect(limit!.usedPercent).toBe(50);
    expect(limit!.resetsAt).toBeUndefined();
  });
  it('returns null for empty string', () => {
    expect(parseLimitString('', '5h', '5h')).toBeNull();
    expect(parseLimitString(undefined, '5h', '5h')).toBeNull();
  });
});

describe('UsageStream', () => {
  function makeProviderEvent(provider: string, hubId: string, accounts: Array<Record<string, unknown>>) {
    return {
      type: 'event' as const,
      method: 'tokenStats.update',
      hubId,
      payload: {id: provider, name: provider, accounts},
    };
  }

  it('accumulates accounts across events + dedupes by identity', () => {
    const stream = new UsageStream();
    stream.ingest(makeProviderEvent('codex', 'h1', [{id: 'a1:current', email: 'a@b.c', status: 'ok', fiveHourLimit: '77%'}]));
    stream.ingest(makeProviderEvent('codex', 'h2', [{id: 'a1:current', email: 'a@b.c', status: 'ok', fiveHourLimit: '77%'}]));
    stream.ingest(makeProviderEvent('kimi', 'h1', [{id: 'u1:kimi', status: 'ok', fiveHourLimit: '98%'}]));
    const snap = stream.snapshot();
    expect(snap.accounts).toHaveLength(2);
    const codex = snap.accounts.find(a => a.provider === 'codex');
    expect(codex!.hubIds).toEqual(['h1', 'h2']);
  });

  it('updates an account in place when same provider+identity reappears', () => {
    const stream = new UsageStream();
    stream.ingest(makeProviderEvent('codex', 'h1', [{id: 'a1:current', email: 'a@b.c', status: 'error', message: 'oops'}]));
    stream.ingest(makeProviderEvent('codex', 'h1', [{id: 'a1:current', email: 'a@b.c', status: 'ok', fiveHourLimit: '10%'}]));
    const snap = stream.snapshot();
    expect(snap.accounts[0].status).toBe('ok');
    expect(snap.accounts[0].limits).toHaveLength(1);
    expect(snap.accounts[0].limits[0].usedPercent).toBe(90); // 100 - 10
  });

  it('parses DeepSeek balance', () => {
    const stream = new UsageStream();
    stream.ingest(makeProviderEvent('deepseek', 'h1', [{
      id: 'deepseek:****',
      status: 'ok',
      balance: {isAvailable: true, items: [{currency: 'CNY', totalBalance: '110', grantedBalance: '10', toppedUpBalance: '100'}]},
    }]));
    const snap = stream.snapshot();
    expect(snap.accounts[0].balance).toBeDefined();
    expect(snap.accounts[0].balance!.items[0].total).toBe('110');
  });

  it('ignores non-tokenStats events', () => {
    const stream = new UsageStream();
    stream.ingest({type: 'event', method: 'other.method', hubId: 'h1', payload: {}});
    expect(stream.snapshot().accounts).toHaveLength(0);
  });
});
